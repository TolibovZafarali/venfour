"""Versioned CCC source facts and deterministic cross-table relationships."""

from __future__ import annotations

import copy
import re
from collections import defaultdict
from collections.abc import Mapping
from decimal import Decimal
from datetime import date
from typing import Any


DRIVETRAINS = frozenset({"FWD", "RWD", "AWD", "4WD"})


def validate_ccc_source_claims(data: Mapping[str, Any], *, page_count: int | None = None) -> None:
    """Require explicit drivetrain provenance and valid physical PDF pages."""
    vehicle = data["vehicle"]
    drivetrain = vehicle["drivetrain"]
    source_text = _text(vehicle["drivetrainSource"]["text"]) or ""
    aliases = {
        "FWD": (r"\bfwd\b", r"\bfront[ -]wheel[ -]drive\b"),
        "RWD": (r"\brwd\b", r"\brear[ -]wheel[ -]drive\b"),
        "AWD": (r"\bawd\b", r"\ball[ -]wheel[ -]drive\b"),
        "4WD": (r"\b4wd\b", r"\b4x4\b", r"\bfour[ -]wheel[ -]drive\b"),
    }
    if drivetrain is not None and not any(re.search(pattern, source_text) for pattern in aliases[drivetrain]):
        raise ValueError("Subject drivetrain requires explicit source text")
    for row in (*data["comparables"], *data["contributionRows"]):
        price = row["sourcePrice"]
        label = _text(price["label"]) or ""
        expected_type = (
            "TAKE" if re.fullmatch(r"take", label) or re.search(r"\btake price\b", label)
            else "ADVERTISED" if re.fullmatch(r"(?:list|advertised|asking)", label) or re.search(r"\b(?:list|advertised|asking) price\b", label)
            else "SOLD" if re.fullmatch(r"sold", label) or re.search(r"\bsold price\b", label)
            else None
        )
        if expected_type and price["type"] != expected_type:
            raise ValueError("Price type conflicts with its explicit source label")
        source = row.get("source")
        if source:
            printed_dates: set[date] = set()
            for reference in row["sourceReferences"]:
                text = reference["text"] or ""
                for match in re.finditer(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", text):
                    try:
                        printed_dates.add(date(int(match[3]), int(match[1]), int(match[2])))
                    except ValueError:
                        continue
                for match in re.finditer(r"\b\d{4}-\d{2}-\d{2}\b", text):
                    try:
                        printed_dates.add(date.fromisoformat(match[0]))
                    except ValueError:
                        continue
            for field in ("sourceDate", "updateDate"):
                if source[field] is not None:
                    value = date.fromisoformat(source[field])
                    if value.year < 1886 or value not in printed_dates:
                        raise ValueError("Comparable date requires matching complete source-date text")
    if page_count is not None:
        references = [vehicle["drivetrainSource"]]
        for row in (*data["comparables"], *data["contributionRows"]):
            references.extend(row["sourceReferences"])
        if any(reference["page"] is not None and reference["page"] > page_count for reference in references):
            raise ValueError("Source page is outside the uploaded PDF")


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split()).casefold() or None


def _money(value: Any) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def _identity(row: Mapping[str, Any]) -> tuple[str, ...] | None:
    vin = _text(row.get("vin"))
    if vin:
        return ("VIN", vin)
    source = row.get("source") or {}
    stock = _text(source.get("stockNumber"))
    dealer = _text(row.get("dealer"))
    return ("DEALER_STOCK", dealer, stock) if dealer and stock else None


def _references(row: Mapping[str, Any]) -> list[dict[str, Any]]:
    return copy.deepcopy(list(row.get("sourceReferences") or []))


def _merge_appearances(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Merge repeated detail appearances, preserving distinct numbered entries."""
    logical: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    groups: dict[tuple[Any, ...], int] = {}
    conflicts: list[dict[str, Any]] = []
    conflict_paths: set[str] = set()
    for index, raw in enumerate(rows):
        row = copy.deepcopy(raw)
        identity = _identity(row)
        number = row.get("number")
        key = (*identity, number) if identity and number is not None else None
        if key is None or key not in groups:
            target = len(logical)
            logical.append(row)
            if key is not None:
                groups[key] = target
        else:
            target = groups[key]
            prior = logical[target]
            for field in row:
                if field == "sourceReferences":
                    for reference in row[field]:
                        if reference not in prior[field]:
                            prior[field].append(reference)
                elif isinstance(row[field], dict):
                    for child, value in row[field].items():
                        path = f"comparables.{target}.{field}.{child}"
                        if path in conflict_paths:
                            continue
                        old = prior[field].get(child)
                        if old is None:
                            prior[field][child] = value
                        elif value is not None and value != old:
                            conflicts.append({"path": path, "appearanceIndexes": [index], "reason": "CONFLICTING_REPEATED_SOURCE_FACT"})
                            conflict_paths.add(path)
                            prior[field][child] = "UNKNOWN" if child == "type" else None
                elif f"comparables.{target}.{field}" in conflict_paths:
                    continue
                elif prior.get(field) is None:
                    prior[field] = row[field]
                elif row[field] is not None and row[field] != prior[field]:
                    conflicts.append({"path": f"comparables.{target}.{field}", "appearanceIndexes": [index], "reason": "CONFLICTING_REPEATED_SOURCE_FACT"})
                    conflict_paths.add(f"comparables.{target}.{field}")
                    prior[field] = None
        links.append({"appearanceIndex": index, "comparableIndex": target})
    return logical, links, conflicts


def _match(row: Mapping[str, Any], comparable: Mapping[str, Any]) -> tuple[bool, list[str]]:
    """Require stable identity or a corroborated dealer/price/value tuple."""
    vin, candidate_vin = _text(row.get("vin")), _text(comparable.get("vin"))
    stock = _text(row.get("stockNumber"))
    candidate_stock = _text(comparable["source"].get("stockNumber"))
    dealer, candidate_dealer = _text(row.get("dealer")), _text(comparable.get("dealer"))
    if vin and candidate_vin and vin != candidate_vin:
        return False, []
    if stock and candidate_stock and stock != candidate_stock:
        return False, []
    if dealer and candidate_dealer and dealer != candidate_dealer:
        return False, []
    reasons: list[str] = []
    if vin and vin == candidate_vin:
        reasons.append("VIN_MATCH")
    if stock and stock == candidate_stock and dealer and dealer == candidate_dealer:
        reasons.append("DEALER_STOCK_MATCH")
    amount, candidate_amount = row["sourcePrice"]["amount"], comparable["sourcePrice"]["amount"]
    price_type, candidate_type = row["sourcePrice"]["type"], comparable["sourcePrice"]["type"]
    if price_type != "UNKNOWN" and candidate_type != "UNKNOWN" and price_type != candidate_type:
        return False, []
    adjusted, candidate_adjusted = row.get("adjustedValue"), comparable.get("adjustedValue")
    # Contradictory printed amounts must remain unbound even with a VIN match.
    if amount is not None and candidate_amount is not None and _money(amount) != _money(candidate_amount):
        return False, []
    if adjusted is not None and candidate_adjusted is not None and _money(adjusted) != _money(candidate_adjusted):
        return False, []
    if (amount is not None
            and candidate_amount is not None and adjusted is not None
            and candidate_adjusted is not None and price_type != "UNKNOWN"
            and price_type == candidate_type):
        reasons.append("SOURCE_PRICE_TYPE_AND_ADJUSTED_VALUE_MATCH")
    return bool(reasons), reasons


def normalize_ccc_evidence_v2(data: Mapping[str, Any], normalized: dict[str, Any]) -> dict[str, Any]:
    """Add explicit source semantics without relabeling historical V1 records."""
    output = copy.deepcopy(normalized)
    output["schemaVersion"] = "2"
    output["report"]["insurer"] = data["report"].get("insurer")
    output["report"]["effectiveDate"] = data["report"].get("effectiveDate")
    output["vehicle"]["drivetrain"] = data["vehicle"]["drivetrain"]
    output["vehicle"]["drivetrainSource"] = copy.deepcopy(data["vehicle"]["drivetrainSource"])
    comparables, links, conflicts = _merge_appearances(copy.deepcopy(data["comparables"]))
    raw_contributions = copy.deepcopy(data["contributionRows"])
    bindings: list[dict[str, Any]] = []
    for index, contribution in enumerate(raw_contributions):
        matches = [(candidate, reasons) for candidate, row in enumerate(comparables)
                   for matched, reasons in [_match(contribution, row)] if matched]
        bindings.append({
            "rowIndex": index,
            "status": "BOUND" if len(matches) == 1 else "AMBIGUOUS" if matches else "UNBOUND",
            "comparableIndex": matches[0][0] if len(matches) == 1 else None,
            "candidateIndexes": [candidate for candidate, _ in matches],
            "reasonCodes": matches[0][1] if len(matches) == 1 else ["MULTIPLE_IDENTITY_MATCHES" if matches else "NO_CORROBORATED_IDENTITY_MATCH"],
        })
    field_checks: list[dict[str, Any]] = []

    def check(path: str, value: Any, materiality: str, sources: list[dict[str, Any]], *, status: str | None = None, reasons: list[str] | None = None) -> None:
        field_checks[:] = [item for item in field_checks if item["path"] != path]
        field_checks.append({"path": path, "status": status or ("CAPTURED" if value is not None else "UNAVAILABLE"),
                             "materiality": materiality, "reasonCodes": reasons or ([] if value is not None else ["SOURCE_FACT_UNAVAILABLE"]),
                             "sourceReferences": copy.deepcopy(sources)})

    check("report.insurer", output["report"]["insurer"], "OPTIONAL", [])
    check("vehicle.drivetrain", output["vehicle"]["drivetrain"], "MATERIAL", [output["vehicle"]["drivetrainSource"]])
    output_rows: list[dict[str, Any]] = []
    for index, row in enumerate(comparables):
        source_price = row["sourcePrice"]
        row["listPrice"] = source_price["amount"] if source_price["type"] == "ADVERTISED" else None
        row_bindings = [binding for binding in bindings if binding["comparableIndex"] == index]
        ambiguous = [binding for binding in bindings if binding["status"] == "AMBIGUOUS" and index in binding["candidateIndexes"]]
        percentages = {raw_contributions[binding["rowIndex"]]["contributionPercent"] for binding in row_bindings}
        valid = len(percentages) == 1 and None not in percentages and not ambiguous
        conflict = len(percentages) > 1 or bool(ambiguous)
        status = "BOUND" if valid else "AMBIGUOUS" if conflict else "UNBOUND" if raw_contributions else "UNAVAILABLE"
        row["contributionPercent"] = next(iter(percentages)) if valid else None
        row["contributionBinding"] = {
            "status": status,
            "rowIndexes": [binding["rowIndex"] for binding in row_bindings + ambiguous],
            "reasonCodes": [] if valid else ["CONFLICTING_OR_AMBIGUOUS_CONTRIBUTIONS" if conflict else "NO_BOUND_CONTRIBUTION"],
        }
        if conflict:
            for binding in row_bindings:
                binding["status"] = "AMBIGUOUS"
                binding["reasonCodes"] = ["CONFLICTING_CONTRIBUTION_PERCENTAGES"]
        row["adjustments"].update({"priorDamage": None, "other": None})
        output_rows.append(row)
        sources = _references(row)
        for field, value, materiality in (
            ("vin", row["vin"], "MATERIAL"),
            ("sourcePrice.amount", source_price["amount"], "MATERIAL"),
            ("sourcePrice.type", None if source_price["type"] == "UNKNOWN" else source_price["type"], "MATERIAL"),
            ("source.sourceDate", row["source"]["sourceDate"], "OPTIONAL" if row["source"]["updateDate"] is not None else "MATERIAL"),
            ("source.updateDate", row["source"]["updateDate"], "OPTIONAL" if row["source"]["sourceDate"] is not None else "MATERIAL"),
            ("source.stockNumber", row["source"]["stockNumber"], "OPTIONAL"),
        ):
            check(f"comparables.{index}.{field}", value, materiality, sources)
        contribution_sources = [reference for binding in row_bindings + ambiguous
                                for reference in _references(raw_contributions[binding["rowIndex"]])]
        check(f"comparables.{index}.contributionPercent", row["contributionPercent"], "MATERIAL", contribution_sources,
              status="AMBIGUOUS" if conflict else None, reasons=row["contributionBinding"]["reasonCodes"])
    duplicate_groups: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for index, row in enumerate(output_rows):
        identity = _identity(row)
        if identity:
            duplicate_groups[identity].append(index)
    for conflict in conflicts:
        check(conflict["path"], None, "MATERIAL", [], status="AMBIGUOUS", reasons=[conflict["reason"]])
    output["comparables"] = output_rows
    output["evidence"] = {
        "schemaVersion": "1",
        "fieldChecks": field_checks,
        "contributionRows": raw_contributions,
        "contributionBindings": bindings,
        "comparableAppearances": copy.deepcopy(data["comparables"]),
        "appearanceLinks": links,
        "duplicateIdentities": [{"identityType": identity[0], "identityValues": list(identity[1:]), "comparableIndexes": indexes, "status": "REVIEW"}
                                for identity, indexes in duplicate_groups.items() if len(indexes) > 1],
    }
    return output
