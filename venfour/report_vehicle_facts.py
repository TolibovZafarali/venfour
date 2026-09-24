"""Preserve explicitly labeled engine specifications and their document sources."""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping, Sequence
from typing import Any

from venfour.vehicle_specs import engine_attributes


def _value(label: str, text: str) -> int | float | None:
    if label.casefold() == "cylinders":
        match = re.fullmatch(r"(?:Cylinders\s*:?\s*)?(\d{1,2})", text.strip(), re.I)
        return int(match[1]) if match and 0 < int(match[1]) < 20 else None
    if label.casefold() == "displacement":
        match = re.fullmatch(r"(?:Displacement\s*:?\s*)?(\d+(?:\.\d+)?)\s*(L|liters?|litres?|cc)", text.strip(), re.I)
        if match:
            value = float(match[1]) / (1000 if match[2].casefold() == "cc" else 1)
            return value if 0 < value < 20 else None
    return None


def validate_engine_details(vehicle: Mapping[str, Any], *, page_count: int | None = None) -> None:
    details = vehicle.get("engineDetails")
    if not details:
        return
    references = details["sourceReferences"]
    if page_count is not None and any(ref["page"] > page_count for ref in references):
        raise ValueError("Engine specification source page is outside the uploaded PDF")
    attributes = engine_attributes({"engine": vehicle.get("engine")})
    for field, label in (("cylinders", "Cylinders"), ("displacementLiters", "Displacement")):
        value = details[field]
        if value is None:
            continue
        printed = {_value(label, ref["text"]) for ref in references if ref["label"].casefold() == label.casefold()}
        if printed != {value}:
            raise ValueError(f"Engine specification {field} requires consistent labeled source text")
        if attributes[field] is not None and attributes[field] != value:
            raise ValueError(f"Engine specification {field} conflicts with the printed engine description")


def recover_labeled_engine_details(vehicle: Mapping[str, Any], pages: Sequence[str]) -> dict[str, Any]:
    """Recover only unambiguous CCC loss-vehicle rows bound to the same VIN.

    Scanned pages and unrecognized layouts remain for structured extraction.
    Comparable headings, equipment lists, and vehicle history are never sources.
    """
    result = copy.deepcopy(dict(vehicle))
    vin = str(vehicle.get("vin") or "").strip().upper()
    if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin):
        return result
    references = []
    for page_number, text in enumerate(pages, 1):
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if "VEHICLE DETAILS" not in lines:
            continue
        lines = lines[lines.index("VEHICLE DETAILS") + 1:]
        end = next((i for i, line in enumerate(lines) if line in {
            "VEHICLE HISTORY SUMMARY", "VEHICLE EQUIPMENT", "COMPARABLE VEHICLES",
        }), len(lines))
        section = "\n".join(lines[:end])
        vins = re.findall(r"(?mi)^VIN\s*:?\s*\n?([A-HJ-NPR-Z0-9]{17})\s*$", section)
        if vins != [vin]:
            continue
        for label in ("Cylinders", "Displacement"):
            for match in re.finditer(rf"(?mi)^{label}[ \t]*:?[ \t]*(?:\n)?([^\n]+)$", section):
                value = _value(label, match[1])
                if value is not None:
                    references.append({"page": page_number, "section": "VEHICLE DETAILS",
                                       "label": label, "text": f"{label}: {match[1].strip()}"})
    if not references:
        return result
    details = copy.deepcopy(vehicle.get("engineDetails") or {
        "displacementLiters": None, "cylinders": None, "sourceReferences": [],
    })
    for field, label in (("cylinders", "Cylinders"), ("displacementLiters", "Displacement")):
        sources = [ref for ref in references if ref["label"] == label]
        values = {_value(label, ref["text"]) for ref in sources}
        if not values:
            continue
        if len(values) != 1 or (details[field] is not None and details[field] not in values):
            raise ValueError(f"Conflicting loss-vehicle {label.lower()} rows require review")
        details[field] = next(iter(values))
        for source in sources:
            if source not in details["sourceReferences"]:
                details["sourceReferences"].append(source)
    result["engineDetails"] = details
    validate_engine_details(result, page_count=len(pages))
    return result


def engine_matching_facts(vehicle: Mapping[str, Any]) -> dict[str, str]:
    """Compose matching inputs without changing the literal report fields."""
    details = vehicle.get("engineDetails")
    if not details:
        return {}
    validate_engine_details(vehicle)
    raw = str(vehicle.get("engine") or "").strip()
    parts = [] if raw in {"", "-", "—"} else [raw]
    attributes = engine_attributes({"engine": raw})
    if details["displacementLiters"] is not None and attributes["displacementLiters"] is None:
        parts.append(f"{details['displacementLiters']:g}L")
    if details["cylinders"] is not None and attributes["cylinders"] is None:
        parts.append(f"{details['cylinders']} cylinder")
    result = {"engine": " ".join(parts)} if parts else {}
    if details["cylinders"] is not None:
        result["cylinders"] = str(details["cylinders"])
    return result
