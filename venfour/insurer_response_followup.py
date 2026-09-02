"""Prepare a bounded follow-up from immutable, server-owned case evidence.

The caller establishes ownership and current-source identity before and after
generation. This projection neither sends a message nor changes the saved
assessment, recommendation, customer decision, or original sent request.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from venfour.insurer_response_analysis import (
    InsurerResponseAnalysisError,
    _derived_reference,
    detect_insurer_response_instruction_signals,
    make_case_evidence_reference,
)
from venfour.insurer_response_recommendation import (
    InsurerResponseRecommendationError,
    _evidence_items,
    build_insurer_response_recommendation_v1,
)
from venfour.package_assessment import (
    PackageAssessmentError,
    canonical_package_digest,
    validate_final_valuation_assessment_v1,
)
from venfour.presentation import FINDING_DESCRIPTIONS


INSURER_RESPONSE_FOLLOWUP_SCHEMA_VERSION = "1"
INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION = "1"
_IDENTITIES = (
    "caseId", "responseId", "analysisResultId", "recommendationId", "decisionId",
    "reportId", "finalAssessmentId", "initialCommunicationId",
    "initialPreparedMessageId",
)
_REASONS = {
    "CONTINUE_DECISION_REQUIRED": "Choose Continue challenging before preparing a follow-up.",
    "SOURCE_INFORMATION_UNAVAILABLE": (
        "The saved response, analysis, report, or original sent request is incomplete. "
        "Return to the case and review those records before trying again."
    ),
    "SOURCE_EVIDENCE_UNAVAILABLE": (
        "The saved analysis cannot be matched to its supporting evidence. "
        "Review the response analysis before trying again."
    ),
    "RECOMMENDATION_REQUIRES_REFRESH": (
        "The saved recommendation does not match the current evidence policy. "
        "Venfour cannot safely prepare a follow-up from it. "
        "Your Continue decision and original records are preserved."
    ),
    "NO_SUPPORTED_FOLLOWUP": (
        "The saved evidence does not establish a supported remaining valuation issue "
        "that Venfour can turn into a follow-up. Your Continue decision is saved; "
        "review the response and existing evidence before proceeding."
    ),
    "RESPONSE_REQUIRES_CLARIFICATION": (
        "The saved response is too unclear to identify a supported follow-up. "
        "Review the original response and its analysis before trying again."
    ),
}
_EMAIL = re.compile(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+")
_TOPICS = (
    ("condition", re.compile(r"\bcondition\b", re.I)),
    ("mileage", re.compile(r"\bmileage\b", re.I)),
    ("equipment", re.compile(r"\b(?:equipment|options?|packages?|trim)\b", re.I)),
    ("adjustments", re.compile(r"\badjustments?\b", re.I)),
    ("comparables", re.compile(r"\b(?:comparables?|listings?|market evidence)\b", re.I)),
)
_SAFE_QUOTE = re.compile(r"[\w\s.,;:'’()!?/\-]+", re.UNICODE)


def _clean_line(value: Any, maximum: int) -> str | None:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        return None
    if any(ord(character) < 32 for character in value):
        return None
    return value.strip()


def _valid_identity(source: Mapping[str, Any]) -> bool:
    try:
        for field in _IDENTITIES:
            value = source[field]
            if not isinstance(value, str) or str(UUID(value)) != value:
                return False
    except (KeyError, ValueError, TypeError, AttributeError):
        return False
    return bool(re.fullmatch(r"[0-9a-f]{64}", str(source.get("assessmentDigest", ""))))


def _finding(assessment: Mapping[str, Any], code: str) -> Mapping[str, Any] | None:
    return next((
        row for row in assessment["findings"]
        if row["code"] == code and row["description"] == FINDING_DESCRIPTIONS.get(code)
        and row["evidenceIds"]
    ), None)


def _remaining_nodes(analysis: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [
        *analysis["insurerArguments"], *analysis["unresolvedIssues"],
        *analysis["uncertainties"],
        *(point for point in analysis["responsePoints"] if point["disposition"] != "ACCEPTED"),
    ]


def _node_text(node: Mapping[str, Any]) -> str:
    return " ".join(
        value for key, value in node.items()
        if isinstance(value, str) and key not in {"disposition", "confidence"}
    )


def _response_topic(
    nodes: list[Mapping[str, Any]], response: Mapping[str, Mapping[str, Any]],
    case: Mapping[str, Mapping[str, Any]],
) -> str | None:
    for node in nodes:
        stated = _node_text(node)
        cited = " ".join(
            str(response[reference].get("content") or "")
            for reference in node.get("responseEvidenceRefs", [])
        ) + " " + " ".join(
            str(case[reference].get("summary") or "")
            for reference in node.get("caseEvidenceRefs", [])
        )
        for topic, pattern in _TOPICS:
            if pattern.search(stated) and pattern.search(cited):
                return topic
    return None


def _literal_reason(
    analysis: Mapping[str, Any], response: Mapping[str, Mapping[str, Any]],
) -> tuple[str, str] | None:
    """Quote only a short exact textual reason, never an interpreted amount."""
    nodes = [*analysis["insurerArguments"], *analysis["responsePoints"]]
    uncertain_refs = {
        reference for item in analysis["uncertainties"]
        for reference in item["responseEvidenceRefs"]
    }
    for node in nodes:
        if node.get("confidence") == "LOW":
            continue
        for reference in node["responseEvidenceRefs"]:
            material = response[reference]
            content = material.get("content")
            if (reference in uncertain_refs
                or material.get("sourceType") not in {"PASTED_TEXT", "DOCUMENT_TEXT"}
                or not isinstance(content, str)):
                continue
            candidates = [node.get("argument"), node.get("whatInsurerSaid")]
            candidates.extend(re.split(r"(?<=[.!?])\s+", content))
            for candidate in candidates:
                if (not isinstance(candidate, str) or not 15 <= len(candidate) <= 200
                    or candidate not in content or any(c.isdigit() for c in candidate)
                    or not _SAFE_QUOTE.fullmatch(candidate)
                    or not any(pattern.search(candidate) for _, pattern in _TOPICS)
                    or re.search(r"\b(?:must|owed|law|legal|entitled|deadline|guarantee)\b", candidate, re.I)
                    or detect_insurer_response_instruction_signals(candidate)):
                    continue
                return candidate, reference
    return None


def _format_money(amount: int, currency: str) -> str:
    symbol = "$" if currency == "USD" else f"{currency} "
    return f"{symbol}{amount // 100:,}.{amount % 100:02d}"


def _market_evidence(
    assessment: Mapping[str, Any],
) -> tuple[str, list[str]] | None:
    selected = assessment["externalEvidence"]["selectedComparables"]["primary"]
    if not selected:
        return None
    # Preserve the saved ranking. Do not score, substitute, or rerank evidence.
    row = selected[0]
    facts = row["facts"]
    vehicle = " ".join(str(facts.get(key) or "") for key in ("year", "make", "model")).strip()
    price = facts.get("advertisedPrice")
    if (not _clean_line(vehicle, 250) or not isinstance(price, Mapping)
        or type(price.get("cents")) is not int or price["cents"] <= 0
        or not row["evidenceIds"]):
        return None
    # The presentation money contract stores cents/display for USD. Other
    # currencies need an explicit listing currency before any amount is quoted.
    currency = price.get("currency")
    if currency is None and isinstance(price.get("display"), str) and price["display"].startswith("$"):
        currency = "USD"
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    amount = _format_money(price["cents"], currency)
    description = (
        f"The existing Venfour report includes a selected {vehicle} listing "
        f"advertised at {amount}."
    )
    return description, list(row["evidenceIds"])


def build_insurer_response_followup_v1(
    *, source_identity: Mapping[str, Any], analysis: Mapping[str, Any],
    evidence_index: Mapping[str, Any], recommendation: Mapping[str, Any],
    final_assessment: Mapping[str, Any], initial_request: Mapping[str, Any],
    sending_details: Mapping[str, Any] | None = None,
    customer_offer: Mapping[str, Any] | None = None,
    report: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the same draft, or recoverable blocked result, for exact sources."""
    inputs = {
        "sourceIdentity": source_identity, "analysis": analysis,
        "evidenceIndex": evidence_index, "recommendation": recommendation,
        "finalAssessment": final_assessment, "initialRequest": initial_request,
        "sendingDetails": sending_details, "customerOffer": customer_offer,
        "report": report,
    }
    digest = canonical_package_digest({
        "schemaVersion": INSURER_RESPONSE_FOLLOWUP_SCHEMA_VERSION,
        "templateVersion": INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION,
        "inputs": inputs,
    })
    result: dict[str, Any] = {
        "schemaVersion": INSURER_RESPONSE_FOLLOWUP_SCHEMA_VERSION,
        "templateVersion": INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION,
        "status": "BLOCKED", "generationDigest": digest,
        "recipientEmail": None, "subject": None, "body": None,
        "grounding": {
            "responseEvidenceRefs": [], "caseEvidenceRefs": [], "assessmentEvidenceIds": [],
        },
        "blockedReasonCode": None, "blockedMessage": None,
    }

    def blocked(code: str) -> dict[str, Any]:
        return {**result, "blockedReasonCode": code, "blockedMessage": _REASONS[code]}

    if not isinstance(source_identity, Mapping) or source_identity.get("decision") != "CONTINUE_CHALLENGING":
        return blocked("CONTINUE_DECISION_REQUIRED")
    if not _valid_identity(source_identity) or not all(isinstance(item, Mapping) for item in (
        analysis, evidence_index, recommendation, final_assessment, initial_request,
    )):
        return blocked("SOURCE_INFORMATION_UNAVAILABLE")
    subject = _clean_line(initial_request.get("subject"), 998)
    original_body = initial_request.get("body")
    if not subject or not isinstance(original_body, str) or not original_body.strip():
        return blocked("SOURCE_INFORMATION_UNAVAILABLE")
    try:
        validate_final_valuation_assessment_v1(final_assessment)
        if (final_assessment["assessmentDigest"] != source_identity["assessmentDigest"]
            or final_assessment["lineage"]["caseId"] != source_identity["caseId"]):
            return blocked("SOURCE_INFORMATION_UNAVAILABLE")
        response = _evidence_items(evidence_index, "responseEvidence", "response")
        case = _evidence_items(evidence_index, "caseEvidence", "case")
        projected = build_insurer_response_recommendation_v1(
            analysis=analysis, evidence_index=evidence_index,
            final_assessment=final_assessment,
            assessment_digest=source_identity["assessmentDigest"], customer_offer=customer_offer,
        )
    except (InsurerResponseAnalysisError, InsurerResponseRecommendationError,
            PackageAssessmentError, KeyError, TypeError, ValueError):
        return blocked("SOURCE_EVIDENCE_UNAVAILABLE")
    if dict(recommendation) != projected:
        return blocked("RECOMMENDATION_REQUIRES_REFRESH")
    request_refs = (
        make_case_evidence_reference("customer_request", hashlib.sha256(original_body.strip().encode("utf-8")).hexdigest()),
        _derived_reference("case", "customer-request", subject, original_body.strip()),
    )
    request_ref = next((reference for reference in request_refs if (
        case.get(reference, {}).get("evidenceType") == "CUSTOMER_REQUEST"
        and case[reference].get("summary") == f"{subject}: {original_body.strip()}"[:2_000]
    )), None)
    if request_ref is None:
        return blocked("SOURCE_INFORMATION_UNAVAILABLE")
    if (final_assessment["continuationStatus"] != "SUPPORTS_CONTINUATION"
        or final_assessment["evidenceStrength"] not in {"MODERATE", "STRONG"}
        or final_assessment["validationIssues"]
        or final_assessment["assumptions"]):
        return blocked("NO_SUPPORTED_FOLLOWUP")
    market = _market_evidence(final_assessment)
    if not market:
        return blocked("NO_SUPPORTED_FOLLOWUP")
    nodes = _remaining_nodes(analysis)
    if (analysis["untrustedInstructionDetected"] or analysis["confidence"] == "LOW"
        or analysis["inputCoverage"]["document"] in {"UNREADABLE", "UNSUPPORTED"}
        or (analysis["insurerPosition"]["category"] == "UNCLEAR" and not nodes)):
        return blocked("RESPONSE_REQUIRES_CLARIFICATION")
    if ((analysis["requestDisposition"]["category"] == "ACCEPTED"
         or analysis["insurerPosition"]["category"] == "ACCEPTS_REQUEST")
        and not analysis["unresolvedIssues"] and not analysis["uncertainties"]
        and not any(point["disposition"] != "ACCEPTED" for point in analysis["responsePoints"])):
        return blocked("NO_SUPPORTED_FOLLOWUP")

    details = sending_details if isinstance(sending_details, Mapping) else {}
    recipient = next((value for value in (
        details.get("adjusterEmail"), initial_request.get("recipientEmail"),
    ) if isinstance(value, str) and _EMAIL.fullmatch(value)), None)
    if recipient is None:
        return blocked("SOURCE_INFORMATION_UNAVAILABLE")
    claim = _clean_line(details.get("claimReference"), 200)
    vehicle = final_assessment["subjectVehicle"]
    vehicle_label = " ".join(str(vehicle[key]) for key in ("year", "make", "model"))
    if not _clean_line(vehicle_label, 250):
        return blocked("SOURCE_INFORMATION_UNAVAILABLE")
    identification = f"claim {claim}" if claim else f"the total-loss valuation of my {vehicle_label}"
    paragraphs = ["Hello,", f"Thank you for your response regarding {identification}."]
    response_refs: set[str] = set(analysis["analysisSummary"]["responseEvidenceRefs"])
    case_refs = {request_ref}
    evidence_ids = set(vehicle["evidenceIds"])
    quote = _literal_reason(analysis, response)
    if quote:
        paragraphs.append(f'Your response says, “{quote[0]}” I would appreciate clarification on how that reasoning applies to the evidence in the existing Venfour report.')
        response_refs.add(quote[1])
    offer = projected["offer"]
    visual_offer = analysis["revisedOffer"]["visualSourceInterpretation"] is not None
    if offer is not None and not visual_offer:
        value = _format_money(offer["amountMinorUnits"], offer["currency"])
        if offer["source"] == "RESPONSE_TEXT":
            paragraphs.append(f"I understand the vehicle valuation amount in your response is {value}. Please explain how this amount was calculated.")
        else:
            paragraphs.append(f"I have recorded {value} as the vehicle valuation amount. Please confirm that amount and explain how it was calculated.")
        response_refs.update(analysis["revisedOffer"]["responseEvidenceRefs"])
    elif visual_offer or analysis["revisedOffer"]["status"] == "UNCLEAR":
        paragraphs.append("Please confirm the vehicle valuation amount in writing so I can review it accurately.")

    topic = _response_topic(nodes, response, case)
    adjustment = _finding(final_assessment, "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES")
    if topic in {"condition", "mileage", "equipment", "adjustments"} and adjustment:
        paragraphs.append(
            "The existing report records that adjustments reduce the median of the paired insurer comparables. "
            "This describes their effect and does not establish that an adjustment is incorrect. "
            "Could you explain the basis for the relevant adjustments and how they apply to my vehicle?"
        )
        evidence_ids.update(adjustment["evidenceIds"])
    else:
        paragraphs.append(
            market[0] + " Could you explain how the selected comparable evidence in that report "
            "was considered, including any differences that affect its relevance to my vehicle?"
        )
        evidence_ids.update(market[1])
    for node in nodes:
        response_refs.update(node.get("responseEvidenceRefs", []))
        case_refs.update(node.get("caseEvidenceRefs", []))
    paragraphs.extend([
        "Please review the remaining valuation questions and reconsider the amount if the evidence supports a change. "
        "The report's advertised prices are supporting evidence, not verified sale prices or a settlement target.",
        "Thank you.",
    ])
    followup_subject = f"Follow-up: {subject}"
    if claim and claim not in followup_subject:
        followup_subject = f"Follow-up on vehicle valuation — claim {claim}"
    return {
        **result, "status": "READY", "recipientEmail": recipient,
        "subject": followup_subject[:998], "body": "\n\n".join(paragraphs),
        "grounding": {
            "responseEvidenceRefs": sorted(response_refs), "caseEvidenceRefs": sorted(case_refs),
            "assessmentEvidenceIds": sorted(evidence_ids),
        },
    }


__all__ = [
    "INSURER_RESPONSE_FOLLOWUP_SCHEMA_VERSION", "INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION",
    "build_insurer_response_followup_v1",
]
