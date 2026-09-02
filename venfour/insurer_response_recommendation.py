"""Deterministic recommendations against a response's saved valuation evidence.

This policy compares one usable response offer with the already-published
advertised-price range. It does not recalculate value or select a customer
decision. Interpretation can withhold a recommendation, never supply its label.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from venfour.discrepancy import MAX_SAFE_MONEY_CENTS, ValuationDiscrepancyPolicy
from venfour.insurer_response_analysis import (
    _MONEY_TEXT_PATTERN,
    _derived_reference,
    _minor_unit_amounts_in_text,
    validate_insurer_response_analysis_v1,
)
from venfour.package_assessment import (
    PackageAssessmentError,
    validate_final_valuation_assessment_v1,
)


INSURER_RESPONSE_RECOMMENDATION_SCHEMA_VERSION = "1"
INSURER_RESPONSE_RECOMMENDATION_POLICY_VERSION = "1"
ACCEPT_OFFER = "ACCEPT_OFFER"
CONTINUE_CHALLENGING = "CONTINUE_CHALLENGING"
NO_CLEAR_RECOMMENDATION = "NO_CLEAR_RECOMMENDATION"

# Use the existing named policy thresholds, with a deliberately conservative
# lower-range-edge comparison instead of repeating its median classification.
_POLICY = ValuationDiscrepancyPolicy(
    potential_gap_basis_points=500, material_gap_basis_points=1000
)
_TEXT_OFFER_PATTERN = re.compile(
    _MONEY_TEXT_PATTERN.pattern, re.IGNORECASE | re.ASCII
)
_RANGE_SEMANTICS = "SELECTED_ADVERTISED_PRICE_RANGE"
_BASE_LIMITATION = (
    "This compares the offer with saved advertised-price evidence, not a "
    "guaranteed settlement amount or legal entitlement."
)
_STATE_SUMMARIES = {
    ACCEPT_OFFER: "Venfour recommends accepting this offer.",
    CONTINUE_CHALLENGING: "Venfour recommends continuing to challenge this offer.",
    NO_CLEAR_RECOMMENDATION: "Venfour has no clear recommendation yet.",
}
_REASON_DETAILS = {
    "OFFER_WITHIN_SUPPORTED_RANGE": (
        ACCEPT_OFFER,
        "The offer falls within the advertised-price range supported by the saved evidence.",
    ),
    "OFFER_ABOVE_SUPPORTED_RANGE": (
        ACCEPT_OFFER,
        "The offer is above the saved advertised-price range; this evidence does not support challenging for a higher vehicle valuation.",
    ),
    "REMAINING_GAP_BELOW_SCREENING_THRESHOLD": (
        ACCEPT_OFFER,
        "The offer is just below the saved advertised-price range. The remaining difference is below Venfour's 5% screening threshold for this comparison.",
    ),
    "OFFER_MATERIALLY_BELOW_SUPPORTED_RANGE": (
        CONTINUE_CHALLENGING,
        "Even the lower end of the saved advertised-price range is at least 10% above this offer. The remaining difference supports continuing to challenge the vehicle valuation.",
    ),
    "INTERMEDIATE_EVIDENCE_GAP": (
        NO_CLEAR_RECOMMENDATION,
        "The lower end of the saved advertised-price range is 5% to less than 10% above this offer. That difference does not clearly support either recommendation under this conservative policy.",
    ),
    "NO_USABLE_REVISED_OFFER": (
        NO_CLEAR_RECOMMENDATION,
        "This response does not establish a usable revised offer to compare with the saved evidence.",
    ),
    "REVISED_OFFER_UNCERTAIN": (
        NO_CLEAR_RECOMMENDATION,
        "The revised offer is unclear. Confirm the amount in the saved original before relying on it.",
    ),
    "OFFER_SOURCES_CONFLICT": (
        NO_CLEAR_RECOMMENDATION,
        "The analyzed offer and the customer-recorded amount do not match. Correct the response amount before relying on a recommendation.",
    ),
    "VISUAL_OFFER_REQUIRES_VERIFICATION": (
        NO_CLEAR_RECOMMENDATION,
        "The offer was read visually from an attachment and still requires verification against the saved original.",
    ),
    "SAVED_EVIDENCE_INSUFFICIENT": (
        NO_CLEAR_RECOMMENDATION,
        "The saved assessment does not provide a sufficiently clear, qualified advertised-price range for this recommendation.",
    ),
    "SAVED_EVIDENCE_REQUIRES_REVIEW": (
        NO_CLEAR_RECOMMENDATION,
        "The saved assessment contains unresolved validation or source-evidence changes that need review before recommending a direction.",
    ),
    "RESPONSE_UNCERTAINTY_UNRESOLVED": (
        NO_CLEAR_RECOMMENDATION,
        "The response analysis leaves uncertainty or incomplete response material that prevents a reliable recommendation.",
    ),
    "INSURER_ARGUMENT_REQUIRES_REVIEW": (
        NO_CLEAR_RECOMMENDATION,
        "The insurer presents reasoning or questions that have not been reassessed by the saved valuation evidence. A simple offer-to-range comparison is not enough.",
    ),
    "OFFER_CURRENCY_DIFFERS": (
        NO_CLEAR_RECOMMENDATION,
        "The offer and the saved advertised-price range use different currencies and cannot be compared here.",
    ),
}
_SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "schemas/analysis/insurer-response-recommendation-v1.schema.json"
)
_DIGEST = re.compile(r"[0-9a-f]{64}")
_CURRENCY = re.compile(r"[A-Z]{3}")


class InsurerResponseRecommendationError(ValueError):
    """Recommendation inputs or their deterministic projection are invalid."""


def _money(value: Any) -> bool:
    return type(value) is int and 0 < value <= MAX_SAFE_MONEY_CENTS


def _policy_input(
    final_assessment: Mapping[str, Any] | None, assessment_digest: str
) -> dict[str, Any]:
    if not isinstance(assessment_digest, str) or not _DIGEST.fullmatch(
        assessment_digest
    ):
        raise InsurerResponseRecommendationError("Assessment digest is invalid")
    if final_assessment is not None and not isinstance(final_assessment, Mapping):
        raise InsurerResponseRecommendationError("Saved assessment is invalid")
    assessment = final_assessment or {}
    if assessment.get("assessmentDigest", assessment_digest) != assessment_digest:
        raise InsurerResponseRecommendationError("Saved assessment digest changed")
    return {
        "assessmentDigest": assessment_digest,
        **{
            key: copy.deepcopy(assessment.get(key))
            for key in (
                "finalClassification",
                "evidenceStrength",
                "evidenceBasis",
                "continuationStatus",
                "supportedRange",
                "preliminaryToFinalComparison",
            )
        },
        "validationIssues": copy.deepcopy(assessment.get("validationIssues", [])),
    }


def _reference_sets(value: Any) -> tuple[set[str], set[str]]:
    response_refs: set[str] = set()
    case_refs: set[str] = set()
    if isinstance(value, Mapping):
        response_refs.update(value.get("responseEvidenceRefs", []))
        case_refs.update(value.get("caseEvidenceRefs", []))
        for child in value.values():
            child_response, child_case = _reference_sets(child)
            response_refs.update(child_response)
            case_refs.update(child_case)
    elif isinstance(value, list):
        for child in value:
            child_response, child_case = _reference_sets(child)
            response_refs.update(child_response)
            case_refs.update(child_case)
    return response_refs, case_refs


def _evidence_items(
    evidence_index: Mapping[str, Any], key: str, prefix: str
) -> dict[str, Mapping[str, Any]]:
    items = evidence_index.get(key)
    if not isinstance(items, list) or len(items) > 250:
        raise InsurerResponseRecommendationError("Saved evidence index is invalid")
    result: dict[str, Mapping[str, Any]] = {}
    for item in items:
        if not isinstance(item, Mapping):
            raise InsurerResponseRecommendationError("Saved evidence item is invalid")
        reference = item.get("evidenceRef")
        if (
            not isinstance(reference, str)
            or re.fullmatch(prefix + r"_[0-9a-f]{64}", reference) is None
            or reference in result
        ):
            raise InsurerResponseRecommendationError("Saved evidence reference is invalid")
        result[reference] = item
    return result


def _usable_offer(
    analysis: Mapping[str, Any],
    response_evidence: Mapping[str, Mapping[str, Any]],
    customer_offer: Mapping[str, Any] | None,
) -> tuple[dict[str, Any] | None, str | None]:
    revised = analysis["revisedOffer"]
    if revised["status"] == "UNCLEAR":
        return None, "REVISED_OFFER_UNCERTAIN"
    if revised["status"] != "PRESENT" or not _money(revised["amountMinorUnits"]):
        return None, "NO_USABLE_REVISED_OFFER"
    amount, currency = revised["amountMinorUnits"], revised["currency"]
    if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
        return None, "NO_USABLE_REVISED_OFFER"
    if customer_offer is not None:
        if (
            not isinstance(customer_offer, Mapping)
            or not _money(customer_offer.get("amountMinorUnits"))
            or not isinstance(customer_offer.get("currency"), str)
            or not _CURRENCY.fullmatch(customer_offer["currency"])
        ):
            raise InsurerResponseRecommendationError("Customer-recorded offer is invalid")
        if (
            customer_offer["amountMinorUnits"] != amount
            or customer_offer["currency"] != currency
        ):
            return None, "OFFER_SOURCES_CONFLICT"
        if revised["source"] in {"CUSTOMER_SUPPLIED", "BOTH"}:
            reference = _derived_reference(
                "response", "customer-supplied-offer", amount, currency
            )
            if (
                reference not in revised["responseEvidenceRefs"]
                or response_evidence.get(reference, {}).get("sourceType")
                != "CUSTOMER_SUPPLIED_OFFER"
            ):
                return None, "NO_USABLE_REVISED_OFFER"
        return {
            "amountMinorUnits": amount,
            "currency": currency,
            "source": "CUSTOMER_RECORDED",
        }, None
    if revised["visualSourceInterpretation"] is not None:
        return None, "VISUAL_OFFER_REQUIRES_VERIFICATION"
    if revised["source"] != "INSURER_RESPONSE":
        return None, "NO_USABLE_REVISED_OFFER"
    if currency != "USD":
        return None, "NO_USABLE_REVISED_OFFER"
    for reference in revised["responseEvidenceRefs"]:
        material = response_evidence.get(reference, {})
        content = material.get("content")
        if (
            material.get("sourceType") in {"PASTED_TEXT", "DOCUMENT_TEXT"}
            and isinstance(content, str)
            and amount in _minor_unit_amounts_in_text(content)
            and any(
                amount in _minor_unit_amounts_in_text(match.group(0))
                and (
                    match.end() == len(content)
                    or not (content[match.end()].isalnum() or content[match.end()] == "_")
                )
                for match in _TEXT_OFFER_PATTERN.finditer(content)
            )
        ):
            return {
                "amountMinorUnits": amount,
                "currency": currency,
                "source": "RESPONSE_TEXT",
            }, None
    return None, "NO_USABLE_REVISED_OFFER"


def _assessment_gate(policy_input: Mapping[str, Any]) -> str | None:
    expected_continuation = {
        "MATERIAL_UNDERVALUE_SIGNAL": "SUPPORTS_CONTINUATION",
        "POTENTIAL_UNDERVALUE": "SUPPORTS_CONTINUATION",
        "NO_MATERIAL_DISCREPANCY": "DOES_NOT_SUPPORT_CONTINUATION",
    }
    classification = policy_input["finalClassification"]
    supported_range = policy_input["supportedRange"]
    if (
        classification not in expected_continuation
        or policy_input["continuationStatus"] != expected_continuation[classification]
        or policy_input["evidenceStrength"] not in {"MODERATE", "STRONG"}
        or policy_input["evidenceBasis"] not in {"CURRENT_MARKET", "LOSS_DATE_HISTORICAL"}
        or not isinstance(supported_range, Mapping)
    ):
        return "SAVED_EVIDENCE_INSUFFICIENT"
    values = [supported_range.get(key) for key in (
        "lowMinorUnits", "medianMinorUnits", "highMinorUnits"
    )]
    if (
        supported_range.get("semantics") != _RANGE_SEMANTICS
        or supported_range.get("evidenceBasis") != policy_input["evidenceBasis"]
        or not all(_money(value) for value in values)
        or values != sorted(values)
        or supported_range.get("currency") != "USD"
        or not isinstance(supported_range.get("evidenceIds"), list)
        or not supported_range["evidenceIds"]
        or any(
            not isinstance(reference, str)
            or re.fullmatch(r"ev_[0-9a-f]{64}", reference) is None
            for reference in supported_range["evidenceIds"]
        )
    ):
        return "SAVED_EVIDENCE_INSUFFICIENT"
    comparison = policy_input["preliminaryToFinalComparison"]
    if (
        policy_input["validationIssues"]
        or not isinstance(comparison, Mapping)
        or comparison.get("materialChange") is not False
        or comparison.get("reasonCodes") != ["UNCHANGED_EVIDENCE"]
    ):
        return "SAVED_EVIDENCE_REQUIRES_REVIEW"
    return None


def _saved_assessment_valid(final_assessment: Mapping[str, Any] | None) -> bool:
    if final_assessment is None:
        return False
    try:
        validate_final_valuation_assessment_v1(final_assessment)
    except (PackageAssessmentError, TypeError, KeyError, ValueError):
        return False
    return True


def _recommendation_code(
    analysis: Mapping[str, Any], policy_input: Mapping[str, Any],
    offer: Mapping[str, Any] | None, offer_gate: str | None,
    assessment_valid: bool, case_evidence: Mapping[str, Mapping[str, Any]],
) -> str:
    if offer_gate is not None:
        return offer_gate
    if analysis["revisedOffer"]["visualSourceInterpretation"] is not None:
        return "VISUAL_OFFER_REQUIRES_VERIFICATION"
    if not assessment_valid:
        return "SAVED_EVIDENCE_INSUFFICIENT"
    assessment_gate = _assessment_gate(policy_input)
    if assessment_gate is not None:
        return assessment_gate
    coverage = analysis["inputCoverage"]
    if (
        analysis["confidence"] == "LOW"
        or analysis["uncertainties"]
        or analysis["untrustedInstructionDetected"]
        or analysis["insurerPosition"]["category"] == "UNCLEAR"
        or coverage["document"] in {"UNREADABLE", "UNSUPPORTED"}
        or coverage["limitations"]
    ):
        return "RESPONSE_UNCERTAINTY_UNRESOLVED"
    if analysis["insurerArguments"] or any(
        point["disposition"] in {"QUESTIONED", "UNRESOLVED", "UNCLEAR"}
        or point["confidence"] == "LOW"
        for point in analysis["responsePoints"]
    ) or any(
        any(
            case_evidence.get(reference, {}).get("evidenceType") != "INSURER_VALUATION"
            for reference in change["caseEvidenceRefs"]
        )
        for change in analysis["importantChanges"]
    ):
        return "INSURER_ARGUMENT_REQUIRES_REVIEW"
    if offer is None:
        return "NO_USABLE_REVISED_OFFER"
    supported_range = policy_input["supportedRange"]
    if offer["currency"] != supported_range["currency"]:
        return "OFFER_CURRENCY_DIFFERS"
    amount = offer["amountMinorUnits"]
    low = supported_range["lowMinorUnits"]
    high = supported_range["highMinorUnits"]
    if amount > high:
        return "OFFER_ABOVE_SUPPORTED_RANGE"
    if amount >= low:
        return "OFFER_WITHIN_SUPPORTED_RANGE"
    gap = low - amount
    if gap * 10_000 >= _POLICY.material_gap_basis_points * amount:
        return "OFFER_MATERIALLY_BELOW_SUPPORTED_RANGE"
    if gap * 10_000 < _POLICY.potential_gap_basis_points * amount:
        return "REMAINING_GAP_BELOW_SCREENING_THRESHOLD"
    return "INTERMEDIATE_EVIDENCE_GAP"


def _recommendation_references(
    analysis: Mapping[str, Any], policy_input: Mapping[str, Any],
    case_evidence: Mapping[str, Mapping[str, Any]], code: str,
) -> tuple[list[str], list[str]]:
    range_value = policy_input["supportedRange"]
    range_refs = {
        reference for reference, item in case_evidence.items()
        if isinstance(range_value, Mapping)
        and item.get("evidenceType") == "VENFOUR_FINDING"
        and item.get("amountMinorUnits") in {
            range_value.get("lowMinorUnits"), range_value.get("highMinorUnits")
        }
        and item.get("amountMinorUnits") is not None
        and item.get("currency") == range_value.get("currency")
    }
    response_refs = set(analysis["revisedOffer"]["responseEvidenceRefs"])
    case_refs = range_refs
    if _REASON_DETAILS[code][0] == NO_CLEAR_RECOMMENDATION:
        sections = [analysis["analysisSummary"]]
        if code == "RESPONSE_UNCERTAINTY_UNRESOLVED":
            sections.extend(analysis["uncertainties"])
        if code == "INSURER_ARGUMENT_REQUIRES_REVIEW":
            sections.extend(analysis["insurerArguments"])
            sections.extend(analysis["responsePoints"])
            sections.extend(analysis["importantChanges"])
        for section in sections:
            response_refs.update(section.get("responseEvidenceRefs", []))
            case_refs.update(section.get("caseEvidenceRefs", []))
    return sorted(response_refs), sorted(case_refs)


@lru_cache(maxsize=1)
def read_insurer_response_recommendation_schema() -> dict[str, Any]:
    schema = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return schema


def validate_insurer_response_recommendation_v1(value: Mapping[str, Any]) -> None:
    errors = list(Draft202012Validator(
        read_insurer_response_recommendation_schema()
    ).iter_errors(value))
    if errors:
        raise InsurerResponseRecommendationError("Recommendation failed schema validation")
    codes = value["reasonCodes"]
    if len(codes) != 1 or codes[0] not in _REASON_DETAILS:
        raise InsurerResponseRecommendationError("Recommendation reason is invalid")
    state, reason = _REASON_DETAILS[codes[0]]
    if value["state"] != state or value["reasons"] != [reason]:
        raise InsurerResponseRecommendationError("Recommendation reason or state changed")
    if value["summary"] != _STATE_SUMMARIES[state] or value["limitations"] != [_BASE_LIMITATION]:
        raise InsurerResponseRecommendationError("Recommendation explanation changed")
    if state == ACCEPT_OFFER and value["offer"] is None:
        raise InsurerResponseRecommendationError("Acceptance recommendation requires an offer")


def build_insurer_response_recommendation_v1(
    *,
    analysis: Mapping[str, Any],
    evidence_index: Mapping[str, Any],
    final_assessment: Mapping[str, Any] | None,
    assessment_digest: str,
    customer_offer: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Project an auditable recommendation without creating a customer choice."""

    validate_insurer_response_analysis_v1(analysis)
    if not isinstance(evidence_index, Mapping):
        raise InsurerResponseRecommendationError("Saved evidence index is invalid")
    response_evidence = _evidence_items(evidence_index, "responseEvidence", "response")
    case_evidence = _evidence_items(evidence_index, "caseEvidence", "case")
    response_refs, case_refs = _reference_sets(analysis)
    if not response_refs <= response_evidence.keys() or not case_refs <= case_evidence.keys():
        raise InsurerResponseRecommendationError("Analysis references unknown saved evidence")
    policy_input = _policy_input(final_assessment, assessment_digest)
    offer, offer_gate = _usable_offer(analysis, response_evidence, customer_offer)
    code = _recommendation_code(
        analysis, policy_input, offer, offer_gate,
        _saved_assessment_valid(final_assessment), case_evidence,
    )
    selected_response_refs, selected_case_refs = _recommendation_references(
        analysis, policy_input, case_evidence, code
    )
    if code in {
        "OFFER_WITHIN_SUPPORTED_RANGE", "OFFER_ABOVE_SUPPORTED_RANGE",
        "REMAINING_GAP_BELOW_SCREENING_THRESHOLD",
        "OFFER_MATERIALLY_BELOW_SUPPORTED_RANGE", "INTERMEDIATE_EVIDENCE_GAP",
    }:
        range_value = policy_input["supportedRange"]
        cited_amounts = {
            case_evidence[reference].get("amountMinorUnits")
            for reference in selected_case_refs
        }
        if not {
            range_value["lowMinorUnits"], range_value["highMinorUnits"]
        } <= cited_amounts:
            code = "SAVED_EVIDENCE_INSUFFICIENT"
            selected_response_refs, selected_case_refs = _recommendation_references(
                analysis, policy_input, case_evidence, code
            )
    state, reason = _REASON_DETAILS[code]
    result = {
        "schemaVersion": INSURER_RESPONSE_RECOMMENDATION_SCHEMA_VERSION,
        "policyVersion": INSURER_RESPONSE_RECOMMENDATION_POLICY_VERSION,
        "state": state,
        "summary": _STATE_SUMMARIES[state],
        "reasons": [reason],
        "reasonCodes": [code],
        "limitations": [_BASE_LIMITATION],
        "responseEvidenceRefs": selected_response_refs,
        "caseEvidenceRefs": selected_case_refs,
        "offer": offer,
        "policyInput": policy_input,
    }
    validate_insurer_response_recommendation_v1(result)
    return result


__all__ = [
    "ACCEPT_OFFER", "CONTINUE_CHALLENGING", "NO_CLEAR_RECOMMENDATION",
    "INSURER_RESPONSE_RECOMMENDATION_SCHEMA_VERSION",
    "INSURER_RESPONSE_RECOMMENDATION_POLICY_VERSION",
    "InsurerResponseRecommendationError",
    "build_insurer_response_recommendation_v1",
    "read_insurer_response_recommendation_schema",
    "validate_insurer_response_recommendation_v1",
]
