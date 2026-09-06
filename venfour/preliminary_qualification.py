"""Versioned preliminary qualification over frozen market and report evidence."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Mapping
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from venfour.analysis import analyze_report


PRELIMINARY_QUALIFICATION_VERSION = "1"
QUALIFICATION_OUTCOMES = (
    "CLEAR_MARKET_VALUE_GAP",
    "MATERIAL_INSURER_REPORT_ISSUE",
    "IMPORTANT_INFORMATION_NEEDED",
    "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW",
)
MARKET_QUALIFYING_CLASSIFICATIONS = frozenset({
    "POTENTIAL_UNDERVALUE", "MATERIAL_UNDERVALUE_SIGNAL",
})
MATERIAL_REPORT_FINDING_CODES = frozenset({
    "VALUATION_ARITHMETIC", "CONDITION_ADJUSTMENT_RECONCILIATION",
    "COMPARABLE_ADJUSTMENT_RECONCILIATION",
})
_SCHEMA_PATH = Path(__file__).parents[1] / "schemas/analysis/preliminary-qualification.schema.json"


class PreliminaryQualificationContractError(ValueError):
    """A qualification fails its versioned structural or semantic contract."""


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _decimal(value: Any) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = Decimal(str(value))
    return result if result.is_finite() else None


def _cents(value: Decimal) -> int:
    return int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _rounding_allowance(values: list[Any]) -> int:
    """Bound independent rounding of the displayed operands and result.

    JSON numbers do not preserve trailing displayed zeroes. Whole-dollar values
    therefore conservatively allow half a dollar each; decimal values allow half
    their retained display unit, with currency precision no finer than a cent.
    This is an arithmetic uncertainty bound, not an economic materiality cutoff.
    """
    allowance = Decimal(0)
    for value in values:
        number = _decimal(value)
        if number is None:
            raise PreliminaryQualificationContractError("rounding bound requires finite source amounts")
        exponent = max(-2, min(0, number.as_tuple().exponent))
        allowance += Decimal(10) ** exponent / 2
    return int((allowance * 100).to_integral_value(rounding=ROUND_CEILING))


def _evidence(path: str, value: Any) -> dict[str, Any]:
    return {"path": path, "value": copy.deepcopy(value)}


def _bind_source_evidence(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bound = copy.deepcopy(evidence)
    for item in bound:
        if re.match(r"\$\.(vehicle|valuation|condition|comparables|evidence|schemaVersion)(\.|\[|$)", item["path"]):
            item["path"] = "$.sourceReport." + item["path"][2:]
    return bound


def _source_references(report: Mapping[str, Any], evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    rows = report.get("comparables") or []
    for item in evidence:
        path = item["path"].replace("$.sourceReport.", "$.", 1)
        match = re.match(r"\$\.comparables\[(\d+)\]", path)
        if match and int(match[1]) < len(rows):
            references.extend(rows[int(match[1])].get("sourceReferences") or [])
        if path == "$.vehicle.drivetrain":
            source = _mapping(report.get("vehicle")).get("drivetrainSource")
            if isinstance(source, Mapping):
                references.append(dict(source))
        canonical_path = re.sub(r"\[(\d+)\]", r".\1", path.removeprefix("$."))
        if re.fullmatch(r"evidence\.fieldChecks\.\d+", canonical_path) and isinstance(item["value"], Mapping):
            references.extend(item["value"].get("sourceReferences") or [])
        for check in _mapping(report.get("evidence")).get("fieldChecks") or []:
            if check.get("path") == canonical_path:
                references.extend(check.get("sourceReferences") or [])
    unique: list[dict[str, Any]] = []
    for reference in references:
        if isinstance(reference, Mapping) and reference not in unique:
            unique.append(copy.deepcopy(dict(reference)))
    return unique


def _bound_percentage(report: Mapping[str, Any], index: int) -> Decimal | None:
    row = report["comparables"][index]
    percentage = _decimal(row.get("contributionPercent"))
    binding = _mapping(row.get("contributionBinding"))
    if percentage is None or percentage < 0 or binding.get("status") != "BOUND":
        return None
    evidence = _mapping(report.get("evidence"))
    source_rows = evidence.get("contributionRows") or []
    row_indexes = binding.get("rowIndexes") or []
    if not row_indexes:
        return None
    for source_index in row_indexes:
        if isinstance(source_index, bool) or not isinstance(source_index, int) or not 0 <= source_index < len(source_rows):
            return None
        matches = [item for item in evidence.get("contributionBindings") or [] if item.get("rowIndex") == source_index]
        if (len(matches) != 1 or matches[0].get("status") != "BOUND"
                or matches[0].get("comparableIndex") != index
                or _decimal(source_rows[source_index].get("contributionPercent")) != percentage):
            return None
    return percentage


def _same_fact(left: Any, right: Any) -> bool:
    if isinstance(left, str) and isinstance(right, str):
        return " ".join(left.split()).casefold() == " ".join(right.split()).casefold()
    return left == right


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(_SCHEMA_PATH.read_text()))


def validate_preliminary_qualification(data: Mapping[str, Any]) -> dict[str, Any]:
    errors = sorted(_validator().iter_errors(data), key=lambda error: str(list(error.path)))
    if errors:
        raise PreliminaryQualificationContractError("; ".join(error.message for error in errors))
    findings = data["qualifyingReportFindings"]
    unresolved = data["unresolvedMaterialChecks"]
    expected = (
        QUALIFICATION_OUTCOMES[0] if data["marketClassification"] in MARKET_QUALIFYING_CLASSIFICATIONS
        else QUALIFICATION_OUTCOMES[1] if findings
        else QUALIFICATION_OUTCOMES[2] if unresolved
        else QUALIFICATION_OUTCOMES[3]
    )
    if data["outcome"] != expected:
        raise PreliminaryQualificationContractError("outcome does not follow qualification precedence")
    if data["applicableMaterialReviewComplete"] != (not unresolved):
        raise PreliminaryQualificationContractError("material review completeness disagrees with unresolved checks")
    if not data["reportReviewApplicable"] and (findings or data["reportAnalysisVersion"] is not None):
        raise PreliminaryQualificationContractError("manual qualification cannot contain report findings or report analysis")
    for finding in findings:
        if finding["findingCode"] not in MATERIAL_REPORT_FINDING_CODES:
            raise PreliminaryQualificationContractError("report finding is outside the supported material policy")
        impact = finding["financialImpact"]
        if impact is None or impact["amountCents"] <= impact["roundingAllowanceCents"]:
            raise PreliminaryQualificationContractError("material arithmetic finding requires an adverse discrepancy beyond its rounding bound")
    return copy.deepcopy(dict(data))


def qualify_preliminary(
    *, source_report: Mapping[str, Any] | None,
    evidence_context: Mapping[str, Any],
    discrepancy_request: Mapping[str, Any],
    discrepancy_result: Mapping[str, Any],
    current_ranking: Mapping[str, Any] | None,
    historical_ranking: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Qualify frozen evidence without modifying the market decision or inputs.

    ``source_report`` contains printed report facts, before customer overrides.
    Market requests retain the effective customer facts and offer separately.
    """
    inputs = {
        "qualificationVersion": PRELIMINARY_QUALIFICATION_VERSION,
        "sourceReport": source_report, "evidenceContext": evidence_context,
        "discrepancyRequest": discrepancy_request, "discrepancyResult": discrepancy_result,
        "currentRanking": current_ranking, "historicalRanking": historical_ranking,
    }
    digest = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True,
                                       separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    market_classification = discrepancy_result.get("classification")
    applicable = evidence_context.get("inputMode") == "REPORT"
    report = _mapping(source_report)
    source_v2 = report.get("schemaVersion") == "2"
    qualifying: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []

    def cover(code: str, scope: str, status: str, *reasons: str) -> None:
        coverage.append({"checkCode": code, "scope": scope, "status": status, "reasonCodes": list(reasons)})

    def need(code: str, reason: str, resolution: str, basis: str, evidence: list[dict[str, Any]]) -> None:
        item = {"checkCode": code, "reasonCode": reason, "resolution": resolution,
                "sourceEvidence": _bind_source_evidence(evidence), "sourceReferences": _source_references(report, evidence),
                "materialityBasis": basis}
        if item not in unresolved:
            unresolved.append(item)

    def issue(finding: Mapping[str, Any], indexes: list[int], impact: Decimal,
              values: list[Any], scope: str, reason: str) -> bool:
        allowance = _rounding_allowance(values)
        amount = _cents(impact)
        if amount <= allowance:
            return False
        evidence = _bind_source_evidence(finding["evidence"])
        if not source_v2:
            need(finding["code"], "REPORT_SOURCE_PROVENANCE_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                 "ADVERSE_ARITHMETIC_REQUIRES_SOURCE_EVIDENCE", evidence)
            return False
        qualifying.append({
            "findingCode": finding["code"], "comparableIndexes": indexes,
            "sourceEvidence": evidence, "sourceReferences": _source_references(report, evidence),
            "reasonCode": reason,
            "financialImpact": {"amountCents": amount, "scope": scope, "roundingAllowanceCents": allowance},
            "materialityBasis": "ADVERSE_SOURCE_ARITHMETIC_DIFFERENCE_NOT_SETTLEMENT_VALUE",
        })
        return True

    if market_classification in {"INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE"} or discrepancy_result.get("evidenceStrength") == "LOW":
        need("INDEPENDENT_MARKET_EVIDENCE", "MARKET_EVIDENCE_INCOMPLETE_OR_CONFLICTING", "PROVIDER_MARKET_DATA",
             "MARKET_EVIDENCE_CANNOT_SUPPORT_ADEQUATE_NEGATIVE_REVIEW",
             [_evidence("$.discrepancyResult.classification", market_classification),
              _evidence("$.discrepancyResult.evidenceStrength", discrepancy_result.get("evidenceStrength"))])
    cover("INDEPENDENT_MARKET_EVIDENCE", "MARKET", "UNRESOLVED" if unresolved else "COMPLETE", "EXISTING_MARKET_CLASSIFICATION_REUSED")
    target = _mapping(discrepancy_request.get("lossVehicle"))
    for field in ("year", "make", "model", "trim", "mileage", "drivetrain"):
        if target.get(field) is None:
            need("SUBJECT_CONFIGURATION", "EFFECTIVE_SUBJECT_FACT_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE" if applicable else "CUSTOMER_RESOLVABLE",
                 "SUBJECT_FACT_CAN_CHANGE_COMPARABLE_RELEVANCE", [_evidence(f"$.discrepancyRequest.lossVehicle.{field}", None)])
    summary_key = "historicalExternalSummary" if discrepancy_result.get("evidenceBasis") == "LOSS_DATE_HISTORICAL" else "currentExternalSummary"
    selected_summary = discrepancy_result.get(summary_key)
    selected = _mapping(selected_summary).get("selectedEvidence") or []
    unknown_drive = [row for row in selected if target.get("drivetrain") is not None and row.get("drivetrain") is None]
    mismatched_drive = [row for row in selected if target.get("drivetrain") is not None and row.get("drivetrain") not in {None, target["drivetrain"]}]
    if unknown_drive or mismatched_drive:
        need("SELECTED_MARKET_CONFIGURATION", "SELECTED_COMPARABLE_DRIVETRAIN_UNVERIFIED" if unknown_drive else "SELECTED_COMPARABLE_DRIVETRAIN_CONFLICT",
             "PROVIDER_MARKET_DATA", "DRIVETRAIN_CAN_CHANGE_COMPARABLE_ELIGIBILITY",
             [_evidence("$.discrepancyRequest.lossVehicle.drivetrain", target.get("drivetrain")),
              _evidence(f"$.discrepancyResult.{summary_key}.selectedEvidence", selected)])
    unknown_market_facts = [(index, field) for index, row in enumerate(selected)
                            for field in ("year", "make", "model", "trim", "mileage", "distanceMiles")
                            if row.get(field) is None]
    if unknown_market_facts:
        need("SELECTED_MARKET_RELEVANCE", "SELECTED_COMPARABLE_MATERIAL_FACT_UNAVAILABLE", "PROVIDER_MARKET_DATA",
             "MISSING_SELECTED_COMPARABLE_FACT_CAN_CHANGE_CONFIGURATION_OR_GEOGRAPHIC_RELEVANCE",
             [_evidence(f"$.discrepancyResult.{summary_key}.selectedEvidence[{index}].{field}", None)
              for index, field in unknown_market_facts])
    cover("SUBJECT_CONFIGURATION", "SUBJECT", "UNRESOLVED" if any(item["checkCode"] == "SUBJECT_CONFIGURATION" for item in unresolved) else "COMPLETE", "EFFECTIVE_VEHICLE_FACTS_CHECKED")
    cover("SELECTED_MARKET_CONFIGURATION", "MARKET", "UNRESOLVED" if unknown_drive or mismatched_drive else "COMPLETE", "SELECTED_PRIMARY_CONFIGURATION_CHECKED")
    cover("SELECTED_MARKET_RELEVANCE", "MARKET", "UNRESOLVED" if unknown_market_facts else "COMPLETE", "SELECTED_PRIMARY_RELEVANCE_FACTS_CHECKED")

    report_analysis: dict[str, Any] | None = None
    if not applicable:
        cover("INSURER_REPORT_REVIEW", "REPORT", "NOT_APPLICABLE", "MANUAL_CASE_HAS_NO_INSURER_REPORT")
    elif not source_report:
        need("INSURER_REPORT_REVIEW", "SOURCE_REPORT_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
             "REPORT_FINDINGS_CANNOT_BE_EVALUATED_WITHOUT_SOURCE_REPORT", [])
        cover("INSURER_REPORT_REVIEW", "REPORT", "UNRESOLVED", "SOURCE_REPORT_UNAVAILABLE")
    else:
        report_analysis = analyze_report(report)
        metrics = report_analysis["metrics"]
        findings = report_analysis["findings"]
        valuation = _mapping(report.get("valuation"))
        condition = _mapping(report.get("condition"))
        comparables = report.get("comparables") or []
        if not comparables:
            need("COMPARABLE_IDENTITIES", "SOURCE_COMPARABLES_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                 "SOURCE_REPORT_COMPARABLE_EVIDENCE_CANNOT_BE_CHECKED", [_evidence("$.comparables", comparables)])
        if not source_v2:
            need("REPORT_EVIDENCE_PROVENANCE", "REPORT_SOURCE_PROVENANCE_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                 "LEGACY_REPORT_LACKS_FIELD_COMPLETENESS_AND_SOURCE_RELATIONSHIPS", [_evidence("$.schemaVersion", report.get("schemaVersion"))])
        for field in ("year", "make", "model", "trim", "mileage", "drivetrain"):
            printed = _mapping(report.get("vehicle")).get(field)
            effective = target.get(field)
            if printed is None:
                need("SOURCE_VEHICLE_CONSISTENCY", "SOURCE_VEHICLE_FACT_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                     "SOURCE_VEHICLE_FACT_CANNOT_BE_CHECKED_AGAINST_EFFECTIVE_VEHICLE",
                     [_evidence(f"$.vehicle.{field}", None)])
            elif effective is not None and not _same_fact(printed, effective):
                need("SOURCE_VEHICLE_CONSISTENCY", "SOURCE_AND_EFFECTIVE_VEHICLE_FACTS_CONFLICT", "DOCUMENT_SOURCE_RESOLVABLE",
                     "CUSTOMER_FACT_CONFLICT_CAN_CHANGE_EVIDENCE_BUT_DOES_NOT_PROVE_SOURCE_ERROR",
                     [_evidence(f"$.vehicle.{field}", printed), _evidence(f"$.discrepancyRequest.lossVehicle.{field}", effective)])
        arithmetic = metrics["valuationArithmetic"]
        arithmetic_finding = next(item for item in findings if item["code"] == "VALUATION_ARITHMETIC")
        if arithmetic["status"] == "unverifiable":
            need("VALUATION_ARITHMETIC", "VALUATION_EQUATION_SOURCE_FACT_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                 "SOURCE_VEHICLE_VALUE_EQUATION_CANNOT_BE_CHECKED", arithmetic_finding["evidence"])
        elif arithmetic["status"] == "mismatch":
            issue(arithmetic_finding, [], -Decimal(str(arithmetic["difference"])),
                  [valuation.get(key) for key in ("baseVehicleValue", "conditionAdjustment", "adjustedVehicleValue")],
                  "VALUATION_ARITHMETIC", "SOURCE_ADJUSTED_VALUE_BELOW_DISPLAYED_EQUATION")
        condition_metric = metrics["condition"]
        condition_finding = next(item for item in findings if item["code"] == "CONDITION_ADJUSTMENT_RECONCILIATION")
        condition_has_effect = any(_decimal(value) not in {None, Decimal(0)} for value in [valuation.get("conditionAdjustment"), condition.get("totalAdjustment"), *[item.get("valueImpact") for item in condition.get("items") or []]])
        if condition_metric["status"] == "unverifiable" and condition_has_effect:
            need("CONDITION_ADJUSTMENT_RECONCILIATION", "NONZERO_CONDITION_ADJUSTMENT_SOURCE_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                 "DISCLOSED_NONZERO_CONDITION_EFFECT_CANNOT_BE_RECONCILED", condition_finding["evidence"])
        elif condition_metric["status"] == "mismatch":
            qualified_condition = issue(condition_finding, [], Decimal(str(condition_metric["differenceFromValuationAdjustment"])),
                  [item.get("valueImpact") for item in condition.get("items") or []] + [valuation.get("conditionAdjustment")],
                  "CONDITION_ARITHMETIC", "VALUATION_CONDITION_ALLOWANCE_BELOW_DISCLOSED_ITEMS")
            subtotal_difference = Decimal(str(condition_metric["differenceFromTotalAdjustment"]))
            subtotal_values = [item.get("valueImpact") for item in condition.get("items") or []] + [condition.get("totalAdjustment")]
            if (not qualified_condition and condition_metric["differenceFromValuationAdjustment"] == 0
                    and _cents(abs(subtotal_difference)) > _rounding_allowance(subtotal_values)):
                need("CONDITION_ADJUSTMENT_RECONCILIATION", "CONFLICTING_SOURCE_CONDITION_TOTALS", "DOCUMENT_SOURCE_RESOLVABLE",
                     "CONFLICTING_PRINTED_CONDITION_TOTAL_REQUIRES_SOURCE_CLARIFICATION_WITHOUT_ASSUMED_DOLLAR_IMPACT",
                     condition_finding["evidence"])
        for index, row in enumerate(comparables):
            if _bound_percentage(report, index) == Decimal(0):
                continue
            for field in ("year", "make", "model", "trim", "mileage", "drivetrain", "adjustedValue"):
                if row.get(field) is None:
                    need("REPORT_MATERIAL_SOURCE_FACT", "CONTRIBUTING_COMPARABLE_FACT_UNAVAILABLE", "DOCUMENT_SOURCE_RESOLVABLE",
                         "SOURCE_COMPARABLE_FACT_NEEDED_FOR_IDENTITY_OR_ADJUSTMENT_REVIEW",
                         [_evidence(f"$.comparables[{index}].{field}", None)])
        adjustment_findings = [item for item in findings if item["code"] == "COMPARABLE_ADJUSTMENT_RECONCILIATION" and item["status"] == "WARNING"]
        for entry in metrics["comparableAdjustments"]["entries"]:
            if entry["reconciled"] is not False or not adjustment_findings:
                continue
            index = entry["index"]
            values = [entry["sourcePrice"]["amount"] if source_v2 else entry["listPrice"], *entry["components"].values(), entry["adjustedValue"]]
            impact = -Decimal(str(entry["difference"]))
            if _cents(impact) <= _rounding_allowance(values):
                continue
            finding = copy.deepcopy(adjustment_findings[0])
            finding["evidence"] = [item for item in finding["evidence"] if item["path"].startswith(f"$.comparables[{index}].")]
            percentage = _bound_percentage(report, index)
            if percentage is not None and percentage > 0:
                issue(finding, [index], impact, values, "COMPARABLE_ARITHMETIC", "CONTRIBUTING_COMPARABLE_BELOW_DISPLAYED_EQUATION")
            elif percentage != Decimal(0):
                need("COMPARABLE_ADJUSTMENT_RECONCILIATION", "ADVERSE_COMPARABLE_ERROR_CONTRIBUTION_UNRESOLVED", "DOCUMENT_SOURCE_RESOLVABLE",
                     "KNOWN_COMPARABLE_ARITHMETIC_DIFFERENCE_HAS_UNRESOLVED_VALUATION_ROLE", finding["evidence"])
        for finding in findings:
            finding_indexes = {int(match[1]) for item in finding["evidence"]
                               if (match := re.match(r"\$\.comparables\[(\d+)\]", item["path"]))}
            potentially_contributing = {index for index in finding_indexes if _bound_percentage(report, index) != Decimal(0)}
            if finding["code"] == "DUPLICATE_COMPARABLE_VIN":
                if len(potentially_contributing) > 1:
                    need("COMPARABLE_IDENTITIES", "REPEATED_COMPARABLE_IDENTITY_REQUIRES_SOURCE_REVIEW", "DOCUMENT_SOURCE_RESOLVABLE",
                         "REPEATED_IDENTITY_MAY_REPRESENT_THE_SAME_VEHICLE_AS_SEPARATE_EVIDENCE", finding["evidence"])
            elif finding["code"] == "MILEAGE_ADJUSTMENT_DIRECTION" and finding["status"] == "REVIEW":
                if potentially_contributing:
                    relevant = [item for item in finding["evidence"]
                                if not (match := re.match(r"\$\.comparables\[(\d+)\]", item["path"]))
                                or int(match[1]) in potentially_contributing]
                    need("MILEAGE_ADJUSTMENT_DIRECTION", "MILEAGE_DIRECTION_REQUIRES_SOURCE_INTERPRETATION", "DOCUMENT_SOURCE_RESOLVABLE",
                         "OPPOSITE_ADJUSTMENT_SIGN_MAY_CHANGE_A_CONTRIBUTING_COMPARABLE_VALUE", relevant)
        source_evidence = _mapping(report.get("evidence"))
        if source_evidence.get("contributionRows") and metrics["contributionPercentages"].get("bindingStatus") != "BOUND":
            need("CONTRIBUTION_BINDING", "PRINTED_CONTRIBUTION_RELATIONSHIP_UNRESOLVED", "DOCUMENT_SOURCE_RESOLVABLE",
                 "UNRESOLVED_SOURCE_RELATIONSHIP_CAN_ASSIGN_EFFECT_TO_THE_WRONG_COMPARABLE",
                 [_evidence("$.evidence.contributionBindings", source_evidence.get("contributionBindings"))])
        for check_index, check in enumerate(source_evidence.get("fieldChecks") or []):
            if check.get("materiality") != "MATERIAL" or check.get("status") == "CAPTURED":
                continue
            path = check.get("path", "")
            if ".source.sourceDate" in path or ".source.updateDate" in path:
                continue
            if path.endswith("contributionPercent") and not source_evidence.get("contributionRows"):
                continue
            if path.endswith(".vin"):
                match = re.match(r"comparables\.(\d+)\.vin$", path)
                if match:
                    row = comparables[int(match[1])]
                    if row.get("dealer") and _mapping(row.get("source")).get("stockNumber"):
                        continue
            if not (path == "vehicle.drivetrain" or re.match(r"comparables\.\d+\.(vin|drivetrain|sourcePrice\.(amount|type)|adjustedValue|mileage|year|make|model|trim|contributionPercent|adjustments\.)", path)):
                continue
            need("REPORT_MATERIAL_SOURCE_FACT", "MATERIAL_SOURCE_FACT_UNAVAILABLE_OR_AMBIGUOUS", "DOCUMENT_SOURCE_RESOLVABLE",
                 "MISSING_SOURCE_FACT_CAN_CHANGE_COMPARABLE_IDENTITY_VALUE_OR_ATTRIBUTION",
                 [_evidence(f"$.evidence.fieldChecks[{check_index}]", check)])
        for code in ("REPORT_EVIDENCE_PROVENANCE", "SOURCE_VEHICLE_CONSISTENCY", "VALUATION_ARITHMETIC",
                     "CONDITION_ADJUSTMENT_RECONCILIATION", "COMPARABLE_ADJUSTMENT_RECONCILIATION",
                     "COMPARABLE_IDENTITIES", "MILEAGE_ADJUSTMENT_DIRECTION", "CONTRIBUTION_BINDING",
                     "REPORT_MATERIAL_SOURCE_FACT"):
            related = [item for item in unresolved if item["checkCode"] == code]
            unassessed = (code == "COMPARABLE_ADJUSTMENT_RECONCILIATION" and not metrics["comparableAdjustments"]["fullyDisclosedCount"]
                          or code == "MILEAGE_ADJUSTMENT_DIRECTION" and not metrics["mileageAdjustmentDirection"]["checkedCount"]
                          or code == "CONTRIBUTION_BINDING" and not source_evidence.get("contributionRows")
                          or code == "CONDITION_ADJUSTMENT_RECONCILIATION" and condition_metric["status"] == "unverifiable")
            cover(code, "REPORT", "UNRESOLVED" if related else "NOT_ASSESSED" if unassessed else "COMPLETE",
                  *(list(dict.fromkeys(item["reasonCode"] for item in related)) or ["DISCLOSURE_ABSENCE_ALONE_IS_NOT_A_SUPPORTED_ISSUE" if unassessed else "APPLICABLE_SOURCE_CHECKS_EVALUATED"]))
        for code, reason in (
            ("PROPRIETARY_ADJUSTMENT_METHODOLOGY", "UNDISCLOSED_COMPONENTS_ALONE_DO_NOT_ESTABLISH_AN_ISSUE"),
            ("CONTRIBUTION_WEIGHTING_METHODOLOGY", "DISPLAYED_WEIGHTS_DO_NOT_PROVE_THE_BASE_VALUE_FORMULA"),
            ("INDEPENDENT_EQUIPMENT_AND_CONDITION_VERIFICATION", "NO_STRONGER_AUTHORITATIVE_EQUIPMENT_OR_CONDITION_EVIDENCE"),
            ("INSURER_COMPARABLE_AGE_AND_GEOGRAPHY", "NO_SUPPORTED_REPORT_SPECIFIC_ELIGIBILITY_POLICY"),
            ("INSURER_COMPARABLE_CONFIGURATION_VALIDITY", "ATTRIBUTE_DIFFERENCES_ALONE_DO_NOT_PROVE_INVALIDITY"),
        ):
            cover(code, "REPORT", "NOT_ASSESSED", reason)

    outcome = (
        QUALIFICATION_OUTCOMES[0] if market_classification in MARKET_QUALIFYING_CLASSIFICATIONS
        else QUALIFICATION_OUTCOMES[1] if qualifying
        else QUALIFICATION_OUTCOMES[2] if unresolved
        else QUALIFICATION_OUTCOMES[3]
    )
    reason_codes = [outcome]
    reason_codes.extend(item["reasonCode"] for item in qualifying)
    reason_codes.extend(item["reasonCode"] for item in unresolved)
    return validate_preliminary_qualification({
        "qualificationVersion": PRELIMINARY_QUALIFICATION_VERSION, "inputDigest": digest,
        "outcome": outcome, "marketClassification": market_classification,
        "reportReviewApplicable": applicable, "applicableMaterialReviewComplete": not unresolved,
        "reportAnalysisVersion": report_analysis["analysisVersion"] if report_analysis else None,
        "qualifyingReportFindings": qualifying, "unresolvedMaterialChecks": unresolved,
        "reasonCodes": list(dict.fromkeys(reason_codes)), "checkCoverage": coverage,
    })
