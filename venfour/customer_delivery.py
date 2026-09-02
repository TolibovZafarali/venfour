"""Customer-safe Total-Loss delivery and initial-request application boundary.

All authorization, revision fencing, immutable history, and idempotency live in
database RPCs.  This module validates their deliberately small projections and
never accepts a storage locator or report payload from a browser.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlsplit
from uuid import UUID

from venfour.supabase_gateway import (
    CUSTOMER_TOTAL_LOSS_REPORT_FILENAME,
    SupabaseContractError,
)


_STEP_IDENTIFIERS = {
    "result",
    "insurer_review",
    "valuation",
    "report",
    "what_next",
    "send",
}
_PROGRESS_STATES = {"viewed", "completed", "skipped"}
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_REPORT_IDENTITY_FILENAME = re.compile(
    r"Venfour_Valuation_Evidence_[A-Za-z0-9_-]+_v[1-9][0-9]*\.pdf"
)
_CURRENCY = re.compile(r"[A-Z]{3}")
_CONTENT_DIGEST = re.compile(r"[0-9a-f]{64}")
_CASE_EVIDENCE_REFERENCE = re.compile(r"case_[0-9a-f]{64}")
_RESPONSE_EVIDENCE_REFERENCE = re.compile(r"response_[0-9a-f]{64}")
_INSURER_RESPONSE_MEDIA_EXTENSIONS = {
    "application/pdf": ("pdf", {".pdf"}),
    "image/jpeg": ("jpg", {".jpg", ".jpeg"}),
    "image/png": ("png", {".png"}),
    "image/heic": ("heic", {".heic"}),
    "image/heif": ("heif", {".heif"}),
}
_MAX_INSURER_RESPONSE_UPLOAD_BYTES = 10 * 1024 * 1024
_MAX_SAFE_MINOR_UNITS = 9_007_199_254_740_991
_RESPONSE_DECISION_CHOICES = {"ACCEPT_OFFER", "CONTINUE_CHALLENGING"}


class CustomerDeliveryError(Exception):
    """Base class for customer-delivery failures."""


class CustomerDeliveryInputError(CustomerDeliveryError):
    """The browser supplied malformed customer-delivery input."""


class CustomerDeliveryNotFoundError(CustomerDeliveryError):
    """No authorized current customer-delivery resource was found."""


class CustomerDeliveryConflictError(CustomerDeliveryError):
    """An optimistic revision or immutable identity is stale."""


class CustomerDeliveryUnavailableError(CustomerDeliveryError):
    """A required customer-delivery dependency is unavailable."""


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _request_uuid(value: Any, label: str) -> str:
    try:
        return _uuid(value, label)
    except SupabaseContractError as exc:
        raise CustomerDeliveryInputError(f"{label} is invalid") from exc


def _positive_revision(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise CustomerDeliveryInputError(f"{label} is invalid")
    return value


def _nonnegative_revision(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CustomerDeliveryInputError(f"{label} is invalid")
    return value


def _timestamp(value: Any, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not value or len(value) > 64:
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _bounded_text(
    value: Any,
    label: str,
    maximum: int,
    *,
    nullable: bool = False,
    empty: bool = False,
) -> str | None:
    if value is None and nullable:
        return None
    if (
        not isinstance(value, str)
        or (not empty and not value)
        or len(value) > maximum
        or any(ord(character) == 127 for character in value)
    ):
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _bounded_json_mapping(value: Any, label: str, maximum: int = 524_288) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if len(encoded) > maximum:
        raise SupabaseContractError(f"{label} is invalid")
    return dict(value)


def _safe_customer_text(
    value: Any, label: str, maximum: int, *, email: bool = False
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CustomerDeliveryInputError(f"{label} is invalid")
    if any(
        ord(character) < 32
        or ord(character) == 127
        or character in {"\u061c", "\u200e", "\u200f"}
        or "\u202a" <= character <= "\u202e"
        or "\u2066" <= character <= "\u2069"
        for character in value
    ):
        raise CustomerDeliveryInputError(f"{label} is invalid")
    if email:
        normalized = unicodedata.normalize("NFKC", value).strip().lower()
        if (
            not normalized
            or len(normalized) > maximum
            or any(character.isspace() for character in normalized)
            or _EMAIL.fullmatch(normalized) is None
        ):
            raise CustomerDeliveryInputError(f"{label} is invalid")
        return normalized
    normalized = " ".join(unicodedata.normalize("NFKC", value).split())
    if not normalized or len(normalized) > maximum:
        raise CustomerDeliveryInputError(f"{label} is invalid")
    return normalized


def _has_unsafe_customer_character(
    value: str, *, allow_multiline_whitespace: bool = False
) -> bool:
    allowed_controls = {"\t", "\n", "\r"} if allow_multiline_whitespace else set()
    return any(
        (ord(character) < 32 and character not in allowed_controls)
        or 127 <= ord(character) <= 159
        or character in {"\u061c", "\u200e", "\u200f"}
        or "\u202a" <= character <= "\u202e"
        or "\u2066" <= character <= "\u2069"
        for character in value
    )


def _response_text(value: Any, *, browser_input: bool) -> str | None:
    if value is None:
        return None
    invalid = (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 100_000
        or (
            isinstance(value, str)
            and _has_unsafe_customer_character(
                value, allow_multiline_whitespace=True
            )
        )
    )
    if invalid:
        error = (
            CustomerDeliveryInputError
            if browser_input
            else SupabaseContractError
        )
        raise error("Insurer response text is invalid")
    return value


def _safe_filename(
    value: Any, media_type: Any, *, browser_input: bool
) -> str:
    media = (
        _INSURER_RESPONSE_MEDIA_EXTENSIONS.get(media_type)
        if isinstance(media_type, str)
        else None
    )
    invalid = (
        not isinstance(value, str)
        or not value.strip()
        or not 1 <= len(value) <= 255
        or (isinstance(value, str) and value != " ".join(value.split()))
        or "/" in value
        or "\\" in value
        or (isinstance(value, str) and _has_unsafe_customer_character(value))
        or media is None
        or (
            isinstance(value, str)
            and not any(value.casefold().endswith(extension) for extension in media[1])
        )
    )
    if invalid:
        error = (
            CustomerDeliveryInputError
            if browser_input
            else SupabaseContractError
        )
        raise error("Insurer response filename is invalid")
    return value


def _upload_byte_size(value: Any, *, browser_input: bool) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= _MAX_INSURER_RESPONSE_UPLOAD_BYTES
    ):
        error = (
            CustomerDeliveryInputError
            if browser_input
            else SupabaseContractError
        )
        raise error("Insurer response file size is invalid")
    return value


def _minor_units(
    value: Any, *, browser_input: bool, nullable: bool = True
) -> int | None:
    if value is None and nullable:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= _MAX_SAFE_MINOR_UNITS
    ):
        error = (
            CustomerDeliveryInputError
            if browser_input
            else SupabaseContractError
        )
        raise error("Revised offer amount is invalid")
    return value


def _validate_insurer_response_analysis_evidence(
    value: Any,
    analysis: Mapping[str, Any],
) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {
        "responseEvidence",
        "caseEvidence",
    }:
        raise SupabaseContractError("Insurer response analysis evidence is invalid")

    response_values = value.get("responseEvidence")
    case_values = value.get("caseEvidence")
    if (
        not isinstance(response_values, list)
        or not isinstance(case_values, list)
        or len(response_values) > 250
        or len(case_values) > 250
    ):
        raise SupabaseContractError("Insurer response analysis evidence is invalid")

    response_refs: set[str] = set()
    response_evidence: list[dict[str, Any]] = []
    for item in response_values:
        if not isinstance(item, Mapping) or set(item) != {
            "evidenceRef",
            "sourceType",
            "content",
            "pageNumber",
        }:
            raise SupabaseContractError(
                "Insurer response analysis response evidence is invalid"
            )
        reference = item.get("evidenceRef")
        if (
            not isinstance(reference, str)
            or _RESPONSE_EVIDENCE_REFERENCE.fullmatch(reference) is None
            or reference in response_refs
        ):
            raise SupabaseContractError(
                "Insurer response analysis response evidence is invalid"
            )
        source_type = item.get("sourceType")
        if source_type not in {
            "PASTED_TEXT",
            "DOCUMENT",
            "DOCUMENT_TEXT",
            "DOCUMENT_IMAGE",
            "CUSTOMER_SUPPLIED_OFFER",
        }:
            raise SupabaseContractError(
                "Insurer response analysis response evidence is invalid"
            )
        content = _bounded_text(
            item.get("content"),
            "Insurer response analysis evidence content",
            100_000,
            nullable=True,
        )
        page_number = item.get("pageNumber")
        if page_number is not None and (
            isinstance(page_number, bool)
            or not isinstance(page_number, int)
            or not 1 <= page_number <= 200
        ):
            raise SupabaseContractError(
                "Insurer response analysis response evidence is invalid"
            )
        response_refs.add(reference)
        response_evidence.append(
            {
                "evidenceRef": reference,
                "sourceType": source_type,
                "content": content,
                "pageNumber": page_number,
            }
        )

    case_refs: set[str] = set()
    case_evidence: list[dict[str, Any]] = []
    for item in case_values:
        if not isinstance(item, Mapping) or set(item) != {
            "evidenceRef",
            "evidenceType",
            "summary",
            "amountMinorUnits",
            "currency",
        }:
            raise SupabaseContractError(
                "Insurer response analysis case evidence is invalid"
            )
        reference = item.get("evidenceRef")
        if (
            not isinstance(reference, str)
            or _CASE_EVIDENCE_REFERENCE.fullmatch(reference) is None
            or reference in case_refs
        ):
            raise SupabaseContractError(
                "Insurer response analysis case evidence is invalid"
            )
        evidence_type = item.get("evidenceType")
        if evidence_type not in {
            "INSURER_VALUATION",
            "VENFOUR_FINDING",
            "VENFOUR_COMPARABLE",
            "CUSTOMER_REQUEST",
            "OTHER",
        }:
            raise SupabaseContractError(
                "Insurer response analysis case evidence is invalid"
            )
        summary = _bounded_text(
            item.get("summary"),
            "Insurer response analysis evidence summary",
            2_000,
        )
        amount = item.get("amountMinorUnits")
        currency = item.get("currency")
        if amount is not None and (
            isinstance(amount, bool)
            or not isinstance(amount, int)
            or not 0 <= amount <= _MAX_SAFE_MINOR_UNITS
        ):
            raise SupabaseContractError(
                "Insurer response analysis case evidence is invalid"
            )
        if (amount is None) is not (currency is None) or (
            currency is not None
            and (
                not isinstance(currency, str)
                or _CURRENCY.fullmatch(currency) is None
            )
        ):
            raise SupabaseContractError(
                "Insurer response analysis case evidence is invalid"
            )
        case_refs.add(reference)
        case_evidence.append(
            {
                "evidenceRef": reference,
                "evidenceType": evidence_type,
                "summary": summary,
                "amountMinorUnits": amount,
                "currency": currency,
            }
        )

    cited_response_refs: set[str] = set()
    cited_case_refs: set[str] = set()

    def collect(node: Any) -> None:
        if isinstance(node, Mapping):
            for key, child in node.items():
                if key == "responseEvidenceRefs" and isinstance(child, list):
                    cited_response_refs.update(
                        item for item in child if isinstance(item, str)
                    )
                elif key == "caseEvidenceRefs" and isinstance(child, list):
                    cited_case_refs.update(
                        item for item in child if isinstance(item, str)
                    )
                else:
                    collect(child)
        elif isinstance(node, list):
            for child in node:
                collect(child)

    collect(analysis)
    if not cited_response_refs.issubset(response_refs) or not cited_case_refs.issubset(
        case_refs
    ):
        raise SupabaseContractError(
            "Insurer response analysis evidence references are incomplete"
        )
    return {
        "responseEvidence": response_evidence,
        "caseEvidence": case_evidence,
    }


def _validate_response_recommendation(value: Mapping[str, Any]) -> None:
    recommendation = value.get("recommendation")
    offer = value.get("usableOffer")
    decision = value.get("decision")
    if recommendation is None:
        if offer is not None or decision is not None:
            raise SupabaseContractError("Insurer response recommendation is missing")
        return
    if value.get("processingState") != "completed":
        raise SupabaseContractError("Insurer response recommendation is premature")
    if not isinstance(recommendation, Mapping) or set(recommendation) != {
        "recommendationId", "versionNumber", "analysisResultId",
        "schemaVersion", "policyVersion", "state", "summary", "reasons",
        "reasonCodes", "limitations", "responseEvidenceRefs", "caseEvidenceRefs",
    }:
        raise SupabaseContractError("Insurer response recommendation is invalid")
    _uuid(recommendation.get("recommendationId"), "Recommendation ID")
    _uuid(recommendation.get("analysisResultId"), "Response analysis result ID")
    version = recommendation.get("versionNumber")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise SupabaseContractError("Recommendation version is invalid")
    if recommendation.get("schemaVersion") != "1" or recommendation.get("policyVersion") not in ("1", "2"):
        raise SupabaseContractError("Recommendation policy version is invalid")
    state = recommendation.get("state")
    if not isinstance(state, str) or state not in (
        _RESPONSE_DECISION_CHOICES | {"NO_CLEAR_RECOMMENDATION"}
    ):
        raise SupabaseContractError("Recommendation state is invalid")
    if recommendation.get("policyVersion") == "1" and state != "NO_CLEAR_RECOMMENDATION":
        raise SupabaseContractError("Prior recommendation policy requires withheld advice")
    if recommendation.get("policyVersion") == "2" and state == "ACCEPT_OFFER":
        raise SupabaseContractError("Current assessment policy does not support an Accept recommendation")
    _bounded_text(recommendation.get("summary"), "Recommendation summary", 2_000)
    for key in ("reasons", "limitations", "reasonCodes"):
        items = recommendation.get(key)
        if not isinstance(items, list) or not 1 <= len(items) <= 10:
            raise SupabaseContractError("Recommendation explanation is invalid")
        for item in items:
            _bounded_text(item, "Recommendation explanation", 2_000)
            if key == "reasonCodes" and re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", item) is None:
                raise SupabaseContractError("Recommendation reason code is invalid")
    evidence = value["analysisEvidence"]
    for key, evidence_key, pattern in (
        ("responseEvidenceRefs", "responseEvidence", _RESPONSE_EVIDENCE_REFERENCE),
        ("caseEvidenceRefs", "caseEvidence", _CASE_EVIDENCE_REFERENCE),
    ):
        references = recommendation.get(key)
        available = {item["evidenceRef"] for item in evidence[evidence_key]}
        if (
            not isinstance(references, list)
            or len(references) > 250
            or any(not isinstance(ref, str) or pattern.fullmatch(ref) is None for ref in references)
            or len(set(references)) != len(references)
            or not set(references).issubset(available)
        ):
            raise SupabaseContractError("Recommendation evidence references are invalid")
    if offer is not None:
        if not isinstance(offer, Mapping) or set(offer) != {
            "offerId", "amountMinorUnits", "currency", "source",
        }:
            raise SupabaseContractError("Recommendation offer is invalid")
        _uuid(offer.get("offerId"), "Insurer offer ID")
        _minor_units(offer.get("amountMinorUnits"), browser_input=False, nullable=False)
        currency = offer.get("currency")
        if not isinstance(currency, str) or _CURRENCY.fullmatch(currency) is None:
            raise SupabaseContractError("Recommendation offer currency is invalid")
        source = offer.get("source")
        if not isinstance(source, str) or source not in {"CUSTOMER_RECORDED", "RESPONSE_TEXT"}:
            raise SupabaseContractError("Recommendation offer source is invalid")
        analyzed_offer = value["analysis"]["revisedOffer"]
        if (
            analyzed_offer["status"] != "PRESENT"
            or analyzed_offer["amountMinorUnits"] != offer["amountMinorUnits"]
            or analyzed_offer["currency"] != currency
        ):
            raise SupabaseContractError("Recommendation offer differs from the analyzed offer")
        if source == "CUSTOMER_RECORDED":
            recorded_offer = value.get("revisedOffer")
            if (
                not isinstance(recorded_offer, Mapping)
                or recorded_offer.get("amountMinorUnits") != offer["amountMinorUnits"]
                or recorded_offer.get("currency") != currency
            ):
                raise SupabaseContractError("Recommendation customer offer is invalid")
        elif (
            analyzed_offer["visualSourceInterpretation"] is not None
            or analyzed_offer["source"] != "INSURER_RESPONSE"
        ):
            raise SupabaseContractError("Recommendation response offer is unverified")
    elif state == "ACCEPT_OFFER":
        raise SupabaseContractError("Accept recommendation requires a usable offer")

    if decision is None:
        return
    if not isinstance(decision, Mapping) or set(decision) != {
        "decisionId", "clientRequestId", "recommendationId", "analysisResultId",
        "choice", "offerId", "amountMinorUnits", "currency", "recordedAt",
    }:
        raise SupabaseContractError("Insurer response decision is invalid")
    for key in ("decisionId", "clientRequestId", "recommendationId", "analysisResultId"):
        _uuid(decision.get(key), "Insurer response decision identity")
    if any(decision[key] != recommendation[key] for key in ("recommendationId", "analysisResultId")):
        raise SupabaseContractError("Insurer response decision lineage is invalid")
    choice = decision.get("choice")
    if not isinstance(choice, str) or choice not in _RESPONSE_DECISION_CHOICES:
        raise SupabaseContractError("Insurer response decision choice is invalid")
    if choice == "ACCEPT_OFFER":
        if offer is None or any(decision[key] != offer[key] for key in ("offerId", "amountMinorUnits", "currency")):
            raise SupabaseContractError("Accepted insurer offer identity is invalid")
    elif any(decision[key] is not None for key in ("offerId", "amountMinorUnits", "currency")):
        raise SupabaseContractError("Continue decision cannot accept an offer")
    _timestamp(decision.get("recordedAt"), "Insurer response decision time")


def validate_insurer_response_projection(value: Any) -> dict[str, Any]:
    """Validate the owner-safe projection of one recorded insurer response."""

    base_keys = {
        "responseId",
        "negotiationRoundId",
        "outboundCommunicationId",
        "canCorrect",
        "clientRequestId",
        "receivedAt",
        "sourceType",
        "text",
        "document",
        "revisedOffer",
        "processingState",
        "failureReason",
        "supersedesResponseId",
        "recommendation",
        "usableOffer",
        "decision",
    }
    if not isinstance(value, Mapping):
        raise SupabaseContractError("Insurer response is invalid")
    processing_state = value.get("processingState")
    expected_keys = (
        base_keys | {"analysis", "analysisEvidence"}
        if processing_state == "completed"
        else base_keys
    )
    if set(value) != expected_keys:
        raise SupabaseContractError("Insurer response is invalid")

    response_id = _uuid(value.get("responseId"), "Insurer response ID")
    _uuid(value.get("negotiationRoundId"), "Insurer response negotiation round ID")
    outbound_id = _uuid(value.get("outboundCommunicationId"), "Insurer response outbound communication ID")
    if outbound_id == response_id:
        raise SupabaseContractError("Insurer response outbound lineage is invalid")
    if not isinstance(value.get("canCorrect"), bool):
        raise SupabaseContractError("Insurer response correction eligibility is invalid")
    _uuid(value.get("clientRequestId"), "Insurer response client request ID")
    _timestamp(value.get("receivedAt"), "Insurer response receipt time")
    source_type = value.get("sourceType")
    if not isinstance(source_type, str) or source_type not in {
        "pasted_message",
        "uploaded_document",
    }:
        raise SupabaseContractError("Insurer response source is invalid")
    text = _response_text(value.get("text"), browser_input=False)

    document = value.get("document")
    if document is not None:
        if not isinstance(document, Mapping) or set(document) != {
            "documentId",
            "originalFilename",
            "mediaType",
            "byteSize",
        }:
            raise SupabaseContractError("Insurer response document is invalid")
        _uuid(document.get("documentId"), "Insurer response document ID")
        media_type = document.get("mediaType")
        _safe_filename(
            document.get("originalFilename"),
            media_type,
            browser_input=False,
        )
        _upload_byte_size(document.get("byteSize"), browser_input=False)

    revised_offer = value.get("revisedOffer")
    if revised_offer is not None:
        if not isinstance(revised_offer, Mapping) or set(revised_offer) != {
            "amountMinorUnits",
            "currency",
        }:
            raise SupabaseContractError("Insurer response revised offer is invalid")
        _minor_units(
            revised_offer.get("amountMinorUnits"),
            browser_input=False,
            nullable=False,
        )
        currency = revised_offer.get("currency")
        if not isinstance(currency, str) or _CURRENCY.fullmatch(currency) is None:
            raise SupabaseContractError("Insurer response currency is invalid")

    if processing_state not in {
        "pending",
        "processing",
        "completed",
        "retryable_failed",
        "terminal_failed",
        "unsupported",
    }:
        raise SupabaseContractError("Insurer response processing state is invalid")
    failure_reason = value.get("failureReason")
    allowed_failure_reasons = {
        "pending": {None},
        "processing": {None},
        "completed": {None},
        "retryable_failed": {"generic"},
        "terminal_failed": {"generic", "unreadable_document"},
        "unsupported": {"unsupported_document"},
    }
    if failure_reason not in allowed_failure_reasons[processing_state]:
        raise SupabaseContractError("Insurer response failure reason is invalid")
    if processing_state == "completed":
        from venfour.insurer_response_analysis import (
            validate_insurer_response_analysis_v1,
        )

        analysis = value.get("analysis")
        validate_insurer_response_analysis_v1(analysis)
        assert isinstance(analysis, Mapping)
        _validate_insurer_response_analysis_evidence(
            value.get("analysisEvidence"), analysis
        )
    _validate_response_recommendation(value)
    supersedes = value.get("supersedesResponseId")
    if supersedes is not None:
        supersedes = _uuid(supersedes, "Superseded insurer response ID")
        if supersedes == response_id:
            raise SupabaseContractError("Insurer response lineage is invalid")
    if document is None and text is None and revised_offer is None:
        raise SupabaseContractError("Insurer response material is missing")
    if (source_type == "uploaded_document") is not (document is not None):
        raise SupabaseContractError("Insurer response source is invalid")
    return dict(value)


def _validate_insurer_response_upload_projection(
    value: Any,
    *,
    case_id: str,
    document_id: str,
    original_filename: str,
    media_type: str,
    byte_size: int,
    content_digest: str,
) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {
        "documentId",
        "uploadPath",
        "originalFilename",
        "mediaType",
        "byteSize",
        "contentDigest",
    }:
        raise SupabaseContractError("Insurer response upload is invalid")
    if value.get("documentId") != document_id:
        raise SupabaseContractError("Insurer response upload identity is invalid")
    _uuid(value.get("documentId"), "Insurer response document ID")
    if (
        value.get("originalFilename") != original_filename
        or value.get("mediaType") != media_type
        or value.get("byteSize") != byte_size
        or value.get("contentDigest") != content_digest
    ):
        raise SupabaseContractError("Insurer response upload metadata is invalid")
    _safe_filename(
        value.get("originalFilename"),
        value.get("mediaType"),
        browser_input=False,
    )
    _upload_byte_size(value.get("byteSize"), browser_input=False)
    if (
        not isinstance(value.get("contentDigest"), str)
        or _CONTENT_DIGEST.fullmatch(value["contentDigest"]) is None
    ):
        raise SupabaseContractError("Insurer response content digest is invalid")
    canonical_extension = _INSURER_RESPONSE_MEDIA_EXTENSIONS[media_type][0]
    upload_path = value.get("uploadPath")
    if (
        not isinstance(upload_path, str)
        or not 1 <= len(upload_path) <= 1024
        or _has_unsafe_customer_character(upload_path)
        or "//" in upload_path
    ):
        raise SupabaseContractError("Insurer response upload path is invalid")
    segments = upload_path.split("/")
    if (
        len(segments) != 4
        or any(segment in {"", ".", ".."} for segment in segments)
        or segments[1] != case_id
        or segments[2] != "insurer-responses"
        or segments[3] != f"{document_id}.{canonical_extension}"
    ):
        raise SupabaseContractError("Insurer response upload path is invalid")
    try:
        _uuid(segments[0], "Insurer response upload owner ID")
    except SupabaseContractError as exc:
        raise SupabaseContractError(
            "Insurer response upload path is invalid"
        ) from exc
    return dict(value)


def _money(value: Any, label: str, *, nullable: bool = False) -> dict[str, Any] | None:
    if value is None and nullable:
        return None
    if not isinstance(value, Mapping) or set(value) != {
        "amountMinorUnits",
        "currency",
        "formatted",
    }:
        raise SupabaseContractError(f"{label} is invalid")
    amount = value.get("amountMinorUnits")
    currency = value.get("currency")
    formatted = value.get("formatted")
    if (
        (amount is not None and (isinstance(amount, bool) or not isinstance(amount, int)))
        or not isinstance(currency, str)
        or _CURRENCY.fullmatch(currency) is None
        or not isinstance(formatted, str)
        or not formatted
        or len(formatted) > 100
    ):
        raise SupabaseContractError(f"{label} is invalid")
    return dict(value)


def _price_summary(value: Any, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping) or set(value) != {
        "count",
        "low",
        "median",
        "high",
    }:
        raise SupabaseContractError(f"{label} is invalid")
    count = value.get("count")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise SupabaseContractError(f"{label} is invalid")
    for key in ("low", "median", "high"):
        _money(value.get(key), f"{label} {key}", nullable=True)
    return dict(value)


def validate_report_projection(value: Any) -> dict[str, Any]:
    report = _bounded_json_mapping(value, "Published report")
    required = {
        "reportId",
        "versionNumber",
        "versionLabel",
        "issueDate",
        "suggestedFilename",
        "status",
        "title",
        "conclusion",
        "subjectVehicle",
        "insurerEvidence",
        "marketEvidence",
    }
    if set(report) != required:
        raise SupabaseContractError("Published report is invalid")
    _uuid(report.get("reportId"), "Report ID")
    version = report.get("versionNumber")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise SupabaseContractError("Report version is invalid")
    if report.get("versionLabel") != f"v{version}":
        raise SupabaseContractError("Report version label is invalid")
    issue_date = report.get("issueDate")
    try:
        if not isinstance(issue_date, str):
            raise ValueError
        datetime.strptime(issue_date, "%Y-%m-%d")
    except ValueError as exc:
        raise SupabaseContractError("Report issue date is invalid") from exc
    filename = report.get("suggestedFilename")
    if (
        not isinstance(filename, str)
        or _REPORT_IDENTITY_FILENAME.fullmatch(filename) is None
    ):
        raise SupabaseContractError("Report filename is invalid")
    if (
        report.get("status") != "published"
        or report.get("title") != "Venfour Total-Loss Valuation Evidence Package"
    ):
        raise SupabaseContractError("Published report status is invalid")

    conclusion = report.get("conclusion")
    if not isinstance(conclusion, Mapping):
        raise SupabaseContractError("Report conclusion is invalid")
    expected_conclusion = {
        "classificationLabel",
        "continuingSupported",
        "insurerValuation",
        "supportedRange",
        "indicatedDifference",
        "summary",
        "limitations",
        "preliminaryComparison",
    }
    if set(conclusion) != expected_conclusion:
        raise SupabaseContractError("Report conclusion is invalid")
    for key in ("classificationLabel", "summary"):
        _bounded_text(conclusion.get(key), f"Report {key}", 10_000)
    if not isinstance(conclusion.get("continuingSupported"), bool):
        raise SupabaseContractError("Report continuation status is invalid")
    _money(conclusion.get("insurerValuation"), "Insurer valuation")
    supported_range = conclusion.get("supportedRange")
    if supported_range is not None:
        if not isinstance(supported_range, Mapping) or set(supported_range) != {
            "low",
            "median",
            "high",
            "evidenceBasis",
        }:
            raise SupabaseContractError("Supported range is invalid")
        for key in ("low", "median", "high"):
            _money(supported_range.get(key), f"Supported range {key}")
        _bounded_text(supported_range.get("evidenceBasis"), "Range basis", 1_000)
    _money(conclusion.get("indicatedDifference"), "Indicated difference", nullable=True)
    limitations = conclusion.get("limitations")
    if not isinstance(limitations, list) or not limitations or len(limitations) > 100:
        raise SupabaseContractError("Report limitations are invalid")
    for limitation in limitations:
        _bounded_text(limitation, "Report limitation", 10_000)
    preliminary = _bounded_json_mapping(
        conclusion.get("preliminaryComparison"),
        "Preliminary comparison",
        65_536,
    )
    if set(preliminary) != {"status", "summary"}:
        raise SupabaseContractError("Preliminary comparison is invalid")
    for key in ("status", "summary"):
        _bounded_text(preliminary.get(key), f"Preliminary comparison {key}", 2_000)
    subject_vehicle = _bounded_json_mapping(
        report.get("subjectVehicle"), "Report subject vehicle"
    )
    if set(subject_vehicle) != {"description"}:
        raise SupabaseContractError("Report subject vehicle is invalid")
    _bounded_text(
        subject_vehicle.get("description"),
        "Report vehicle description",
        1_000,
        nullable=True,
    )

    insurer_evidence = _bounded_json_mapping(
        report.get("insurerEvidence"), "Report insurer evidence"
    )
    if set(insurer_evidence) != {
        "insurerName",
        "comparableCount",
        "summary",
        "comparables",
        "methodologyStatement",
        "adjustmentContext",
    }:
        raise SupabaseContractError("Report insurer evidence is invalid")
    _bounded_text(
        insurer_evidence.get("insurerName"),
        "Report insurer name",
        500,
        nullable=True,
    )
    comparable_count = insurer_evidence.get("comparableCount")
    if (
        isinstance(comparable_count, bool)
        or not isinstance(comparable_count, int)
        or comparable_count < 0
    ):
        raise SupabaseContractError("Report insurer comparable count is invalid")
    insurer_summary = _bounded_json_mapping(
        insurer_evidence.get("summary"), "Report insurer summary", 65_536
    )
    count_keys = {
        "totalCount",
        "advertisedPriceMissingCount",
        "adjustedValueMissingCount",
        "fullyDisclosedAdjustmentCount",
        "partiallyDisclosedAdjustmentCount",
        "undisclosedAdjustmentCount",
        "unavailableAdjustmentCount",
    }
    if set(insurer_summary) != count_keys | {
        "advertisedPrices",
        "adjustedValues",
    }:
        raise SupabaseContractError("Report insurer summary is invalid")
    for key in count_keys:
        count = insurer_summary.get(key)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise SupabaseContractError("Report insurer summary is invalid")
    _price_summary(
        insurer_summary.get("advertisedPrices"),
        "Report insurer advertised prices",
    )
    _price_summary(
        insurer_summary.get("adjustedValues"),
        "Report insurer adjusted values",
    )
    insurer_comparables = insurer_evidence.get("comparables")
    if not isinstance(insurer_comparables, list) or len(insurer_comparables) > 500:
        raise SupabaseContractError("Report insurer comparables are invalid")
    insurer_comparable_keys = {
        "vehicle",
        "mileage",
        "advertisedPrice",
        "adjustedValue",
        "netAdjustment",
        "adjustments",
        "adjustmentDisclosure",
        "contributionPercent",
    }
    for comparable in insurer_comparables:
        if (
            not isinstance(comparable, Mapping)
            or set(comparable) != insurer_comparable_keys
        ):
            raise SupabaseContractError("Report insurer comparable is invalid")
        for key in (
            "vehicle",
            "advertisedPrice",
            "adjustedValue",
            "netAdjustment",
            "adjustmentDisclosure",
        ):
            _bounded_text(
                comparable.get(key),
                f"Report insurer comparable {key}",
                2_000,
                nullable=True,
            )
        adjustments = comparable.get("adjustments")
        if not isinstance(adjustments, Mapping) or set(adjustments) != {
            "package",
            "options",
            "mileage",
            "condition",
        }:
            raise SupabaseContractError("Report insurer adjustments are invalid")
        for key, adjustment in adjustments.items():
            _bounded_text(
                adjustment,
                f"Report insurer adjustment {key}",
                2_000,
                nullable=True,
            )
        for key in ("mileage", "contributionPercent"):
            number = comparable.get(key)
            if number is not None and (
                isinstance(number, bool) or not isinstance(number, (int, float))
            ):
                raise SupabaseContractError("Report insurer comparable is invalid")
    for key in ("methodologyStatement", "adjustmentContext"):
        _bounded_text(
            insurer_evidence.get(key),
            f"Report insurer {key}",
            10_000,
            nullable=True,
        )

    market = _bounded_json_mapping(
        report.get("marketEvidence"), "Report market evidence"
    )
    if set(market) != {
        "primary",
        "secondary",
        "comparables",
        "methodologyStatement",
        "evidenceDateContext",
    }:
        raise SupabaseContractError("Report market evidence is invalid")
    for role in ("primary", "secondary"):
        summary = market.get(role)
        if summary is None:
            continue
        if not isinstance(summary, Mapping) or set(summary) != {
            "label",
            "description",
            "evidenceDate",
            "selectedCount",
            "prices",
        }:
            raise SupabaseContractError("Report market summary is invalid")
        for key in ("label", "description", "evidenceDate"):
            _bounded_text(
                summary.get(key),
                f"Report market {key}",
                10_000,
                nullable=True,
            )
        selected_count = summary.get("selectedCount")
        if (
            isinstance(selected_count, bool)
            or not isinstance(selected_count, int)
            or selected_count < 0
        ):
            raise SupabaseContractError("Report market selected count is invalid")
        _price_summary(summary.get("prices"), "Report market prices")
    comparables = market.get("comparables")
    if not isinstance(comparables, list) or len(comparables) > 500:
        raise SupabaseContractError("Report market comparables are invalid")
    comparable_keys = {
        "role",
        "vehicle",
        "mileage",
        "advertisedPrice",
        "dealer",
        "location",
        "distanceMiles",
        "evidenceDate",
        "temporalBasis",
    }
    for comparable in comparables:
        if not isinstance(comparable, Mapping) or set(comparable) != comparable_keys:
            raise SupabaseContractError("Report market comparable is invalid")
        for key in (
            "role",
            "vehicle",
            "advertisedPrice",
            "dealer",
            "location",
            "evidenceDate",
            "temporalBasis",
        ):
            _bounded_text(
                comparable.get(key),
                f"Report comparable {key}",
                2_000,
                nullable=True,
            )
        for key in ("mileage", "distanceMiles"):
            amount = comparable.get(key)
            if amount is not None and (
                isinstance(amount, bool)
                or not isinstance(amount, (int, float))
                or amount < 0
            ):
                raise SupabaseContractError("Report comparable value is invalid")
    _bounded_text(
        market.get("methodologyStatement"),
        "Report market methodology",
        10_000,
        nullable=True,
    )
    evidence_dates = _bounded_json_mapping(
        market.get("evidenceDateContext"),
        "Report market evidence-date context",
        65_536,
    )
    if set(evidence_dates) != {
        "lossDate",
        "currentObservedDate",
        "historicalEvidenceDate",
    }:
        raise SupabaseContractError("Report market evidence-date context is invalid")
    for key, date_value in evidence_dates.items():
        _bounded_text(
            date_value,
            f"Report market evidence date {key}",
            64,
            nullable=True,
        )
    return report


def validate_education_projection(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {"reportVersionId", "steps"}:
        raise SupabaseContractError("Education progress is invalid")
    _uuid(value.get("reportVersionId"), "Education report ID")
    steps = value.get("steps")
    if not isinstance(steps, Mapping) or set(steps) != _STEP_IDENTIFIERS:
        raise SupabaseContractError("Education progress is invalid")
    for step, progress in steps.items():
        if not isinstance(progress, Mapping) or set(progress) != {
            "viewedAt",
            "completedAt",
            "skippedAt",
        }:
            raise SupabaseContractError(f"Education {step} progress is invalid")
        viewed = _timestamp(progress.get("viewedAt"), "Viewed time", nullable=True)
        completed = _timestamp(progress.get("completedAt"), "Completed time", nullable=True)
        skipped = _timestamp(progress.get("skippedAt"), "Skipped time", nullable=True)
        if (completed is not None or skipped is not None) and viewed is None:
            raise SupabaseContractError("Education progress is invalid")
        if completed is not None and skipped is not None:
            raise SupabaseContractError("Education progress is invalid")
    return dict(value)


def validate_sending_details(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {
        "customerName",
        "insurerName",
        "claimReference",
        "vehicleDescription",
        "adjusterName",
        "adjusterEmail",
        "claimReferenceConfirmed",
        "adjusterEmailConfirmed",
        "revision",
    }:
        raise SupabaseContractError("Sending details are invalid")
    for key, maximum in (
        ("customerName", 250),
        ("insurerName", 200),
        ("claimReference", 200),
        ("vehicleDescription", 500),
        ("adjusterName", 200),
        ("adjusterEmail", 320),
    ):
        _bounded_text(value.get(key), key, maximum, nullable=True)
    email = value.get("adjusterEmail")
    if email is not None and _EMAIL.fullmatch(email) is None:
        raise SupabaseContractError("Adjuster email is invalid")
    for key in ("claimReferenceConfirmed", "adjusterEmailConfirmed"):
        if not isinstance(value.get(key), bool):
            raise SupabaseContractError("Sending confirmation is invalid")
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise SupabaseContractError("Sending-details revision is invalid")
    return dict(value)


def validate_message_draft(
    value: Any, *, nullable: bool = False, purpose: str = "initial_reconsideration"
) -> dict[str, Any] | None:
    if value is None and nullable:
        return None
    if not isinstance(value, Mapping) or set(value) != {
        "draftId",
        "reportVersionId",
        "purpose",
        "recipient",
        "subject",
        "body",
        "revision",
        "updatedAt",
    }:
        raise SupabaseContractError("Message draft is invalid")
    _uuid(value.get("draftId"), "Draft ID")
    _uuid(value.get("reportVersionId"), "Draft report ID")
    if value.get("purpose") != purpose:
        raise SupabaseContractError("Message purpose is invalid")
    recipient = _bounded_text(value.get("recipient"), "Draft recipient", 320, nullable=True)
    if recipient is not None and _EMAIL.fullmatch(recipient) is None:
        raise SupabaseContractError("Draft recipient is invalid")
    _bounded_text(value.get("subject"), "Draft subject", 998, empty=True)
    _bounded_text(value.get("body"), "Draft body", 50_000, empty=True)
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise SupabaseContractError("Draft revision is invalid")
    _timestamp(value.get("updatedAt"), "Draft update time")
    return dict(value)


def validate_follow_up_projection(value: Any) -> dict[str, Any] | None:
    """Validate a distinct follow-up without reinterpreting the initial request."""
    if value is None:
        return None
    if not isinstance(value, Mapping) or set(value) != {
        "state", "decisionId", "responseId", "analysisResultId", "reportVersionId",
        "draft", "preparedMessage", "sentMessage", "reasonCode",
    }:
        raise SupabaseContractError("Follow-up response is invalid")
    if value.get("state") not in {"available", "draft", "sent", "unavailable"}:
        raise SupabaseContractError("Follow-up state is invalid")
    for key in ("decisionId", "responseId", "analysisResultId", "reportVersionId"):
        _uuid(value.get(key), key)
    draft = validate_message_draft(
        value.get("draft"), nullable=True, purpose="follow_up_reconsideration"
    )
    if (value.get("state") in {"draft", "sent"}) != (draft is not None):
        raise SupabaseContractError("Follow-up draft state is invalid")
    if draft is not None and draft["reportVersionId"] != value["reportVersionId"]:
        raise SupabaseContractError("Follow-up report lineage is invalid")
    for key, state in (("preparedMessage", "prepared"), ("sentMessage", "sent")):
        version = value.get(key)
        if version is None:
            continue
        extra = {"customerReportedSentAt", "communicationId", "negotiationRoundId"} if state == "sent" else set()
        if not isinstance(version, Mapping) or set(version) != {
            "messageVersionId", "versionNumber", "state", "reportVersionId",
            "recipient", "subject", "body", "createdAt",
        } | extra:
            raise SupabaseContractError("Follow-up message version is invalid")
        if draft is None or version.get("reportVersionId") != value["reportVersionId"] or version.get("state") != state:
            raise SupabaseContractError("Follow-up message lineage is invalid")
        CustomerDeliveryService._prepared({
            "draft": draft,
            "messageVersion": {**{k: v for k, v in version.items() if k not in extra}, "state": "prepared"},
            "workflowRevision": 1,
        }, purpose="follow_up_reconsideration")
        if state == "sent":
            for identifier in ("communicationId", "negotiationRoundId"):
                _uuid(version.get(identifier), identifier)
            _timestamp(version.get("customerReportedSentAt"), "Follow-up sent time")
    if (value.get("state") == "sent") != (value.get("sentMessage") is not None):
        raise SupabaseContractError("Follow-up sent state is invalid")
    reason = value.get("reasonCode")
    if value.get("state") == "unavailable":
        if not isinstance(reason, str) or re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", reason) is None:
            raise SupabaseContractError("Follow-up recovery reason is invalid")
    elif reason is not None:
        raise SupabaseContractError("Follow-up recovery reason is invalid")
    return dict(value)


def validate_sent_message_projection(value: Any) -> dict[str, Any]:
    """Validate an immutable sent message when revisiting a negotiation round."""
    if not isinstance(value, Mapping) or set(value) != {
        "messageVersionId", "versionNumber", "state", "reportVersionId",
        "recipient", "subject", "body", "createdAt", "customerReportedSentAt",
        "communicationId", "negotiationRoundId",
    }:
        raise SupabaseContractError("Sent message history is invalid")
    for key in ("messageVersionId", "reportVersionId", "communicationId", "negotiationRoundId"):
        _uuid(value.get(key), key)
    if value.get("state") != "sent" or type(value.get("versionNumber")) is not int or value["versionNumber"] < 1:
        raise SupabaseContractError("Sent message history state is invalid")
    recipient = _bounded_text(value.get("recipient"), "Sent message recipient", 320)
    if _EMAIL.fullmatch(recipient) is None:
        raise SupabaseContractError("Sent message recipient is invalid")
    _bounded_text(value.get("subject"), "Sent message subject", 998)
    _bounded_text(value.get("body"), "Sent message body", 50_000)
    for key in ("createdAt", "customerReportedSentAt"):
        _timestamp(value.get(key), "Sent message time")
    return dict(value)


def validate_negotiation_history(value: Any) -> list[dict[str, Any]]:
    """Retain response corrections within their round and validate the outbound chain."""
    if not isinstance(value, list):
        raise SupabaseContractError("Negotiation history is invalid")
    history: list[dict[str, Any]] = []
    round_ids: set[str] = set()
    response_ids: set[str] = set()
    last_number = 0
    for item in value:
        if not isinstance(item, Mapping) or set(item) != {
            "negotiationRoundId", "roundNumber", "outbound", "responses", "followUp",
        }:
            raise SupabaseContractError("Negotiation history round is invalid")
        round_id = _uuid(item.get("negotiationRoundId"), "Negotiation history round ID")
        number = item.get("roundNumber")
        if round_id in round_ids or type(number) is not int or number != last_number + 1:
            raise SupabaseContractError("Negotiation history round sequence is invalid")
        outbound = validate_sent_message_projection(item.get("outbound"))
        if history:
            if history[-1]["followUp"] != outbound:
                raise SupabaseContractError("Negotiation history outbound chain is invalid")
        elif outbound["negotiationRoundId"] != round_id:
            raise SupabaseContractError("Initial request round lineage is invalid")
        responses = item.get("responses")
        if not isinstance(responses, list):
            raise SupabaseContractError("Negotiation history responses are invalid")
        previous_response: str | None = None
        projected_responses = []
        for response_value in responses:
            response = validate_insurer_response_projection(response_value)
            if (
                response["responseId"] in response_ids
                or response["negotiationRoundId"] != round_id
                or response["outboundCommunicationId"] != outbound["communicationId"]
                or response["supersedesResponseId"] != previous_response
            ):
                raise SupabaseContractError("Negotiation history response lineage is invalid")
            previous_response = response["responseId"]
            response_ids.add(previous_response)
            projected_responses.append(response)
        follow_up = (
            validate_sent_message_projection(item["followUp"])
            if item["followUp"] is not None else None
        )
        if follow_up is not None and (
            follow_up["negotiationRoundId"] != round_id
            or follow_up["communicationId"] == outbound["communicationId"]
            or not projected_responses
            or (projected_responses[-1].get("decision") or {}).get("choice") != "CONTINUE_CHALLENGING"
        ):
            raise SupabaseContractError("Negotiation history follow-up lineage is invalid")
        round_ids.add(round_id)
        last_number = number
        history.append({**item, "outbound": outbound, "responses": projected_responses, "followUp": follow_up})
    return history


@runtime_checkable
class CustomerDeliveryGateway(Protocol):
    def authenticate(self, access_token: str) -> str: ...

    def put_total_loss_education_progress(
        self, case_id: str, step: str, state: str, workflow_revision: int, access_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_customer_reports(
        self, case_id: str, report_version_id: str | None, access_token: str
    ) -> list[Mapping[str, Any]]: ...

    def create_total_loss_customer_report_download(
        self, case_id: str, report_version_id: str, user_id: str
    ) -> Mapping[str, Any] | None: ...

    def create_total_loss_insurer_response_original_download(
        self, case_id: str, response_id: str, user_id: str
    ) -> Mapping[str, Any] | None: ...

    def put_total_loss_sending_details(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_customer_message_draft(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None: ...

    def patch_total_loss_customer_message_draft(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...

    def prepare_total_loss_customer_message(
        self, case_id: str, client_request_id: str, workflow_revision: int, access_token: str
    ) -> Mapping[str, Any]: ...

    def record_total_loss_customer_email_opened(
        self, case_id: str, message_version_id: str, client_request_id: str, access_token: str
    ) -> Mapping[str, Any]: ...

    def confirm_total_loss_customer_message_sent(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...

    def prepare_total_loss_insurer_response_upload(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...

    def record_total_loss_insurer_response(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...

    def record_total_loss_insurer_response_decision(
        self, case_id: str, response_id: str, values: Mapping[str, Any], access_token: str
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class CustomerDeliveryService:
    gateway: CustomerDeliveryGateway

    def __post_init__(self) -> None:
        if not isinstance(self.gateway, CustomerDeliveryGateway):
            raise TypeError("gateway must implement CustomerDeliveryGateway")

    def record_response_decision(
        self, case_id: str, response_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_response = _request_uuid(response_id, "Insurer response ID")
        if not isinstance(values, Mapping) or set(values) != {
            "clientRequestId", "recommendationId", "choice", "offerId", "workflowRevision",
        }:
            raise CustomerDeliveryInputError("Insurer response decision request is invalid")
        client_request = _request_uuid(values.get("clientRequestId"), "Client request ID")
        recommendation_id = _request_uuid(values.get("recommendationId"), "Recommendation ID")
        revision = _positive_revision(values.get("workflowRevision"), "Workflow revision")
        choice = values.get("choice")
        if not isinstance(choice, str) or choice not in _RESPONSE_DECISION_CHOICES:
            raise CustomerDeliveryInputError("Insurer response decision choice is invalid")
        offer_id = values.get("offerId")
        if choice == "ACCEPT_OFFER":
            offer_id = _request_uuid(offer_id, "Insurer offer ID")
        elif offer_id is not None:
            raise CustomerDeliveryInputError("Continue decision cannot accept an offer")
        self.gateway.authenticate(access_token)
        result = self.gateway.record_total_loss_insurer_response_decision(
            canonical_case, canonical_response, dict(values), access_token
        )
        if not isinstance(result, Mapping) or set(result) != {"state", "response", "workflowRevision"}:
            raise SupabaseContractError("Insurer response decision result is invalid")
        if result.get("state") != "insurer_response_reviewed":
            raise SupabaseContractError("Insurer response decision cannot advance the case")
        response = validate_insurer_response_projection(result.get("response"))
        decision = response.get("decision")
        if (
            response.get("responseId") != canonical_response
            or not isinstance(decision, Mapping)
            or decision.get("clientRequestId") != client_request
            or decision.get("recommendationId") != recommendation_id
            or decision.get("choice") != choice
            or decision.get("offerId") != offer_id
        ):
            raise SupabaseContractError("Insurer response decision acknowledgement differs from the request")
        current_revision = result.get("workflowRevision")
        if isinstance(current_revision, bool) or not isinstance(current_revision, int) or current_revision < revision:
            raise SupabaseContractError("Workflow revision is invalid")
        return {"state": "insurer_response_reviewed", "response": response, "workflowRevision": current_revision}

    def education(
        self, case_id: str, step: str, state: str, workflow_revision: int, access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if step not in _STEP_IDENTIFIERS or state not in _PROGRESS_STATES:
            raise CustomerDeliveryInputError("Education progress is invalid")
        if state == "skipped" and step in {"result", "send"}:
            raise CustomerDeliveryInputError("Required education steps cannot be skipped")
        revision = _positive_revision(workflow_revision, "Workflow revision")
        self.gateway.authenticate(access_token)
        return validate_education_projection(
            self.gateway.put_total_loss_education_progress(
                canonical_case, step, state, revision, access_token
            )
        )

    def reports(
        self, case_id: str, report_version_id: str | None, access_token: str
    ) -> list[dict[str, Any]]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_report = (
            _request_uuid(report_version_id, "Report version ID")
            if report_version_id is not None
            else None
        )
        self.gateway.authenticate(access_token)
        rows = self.gateway.get_total_loss_customer_reports(
            canonical_case, canonical_report, access_token
        )
        if not isinstance(rows, list):
            raise SupabaseContractError("Published reports response is invalid")
        reports = [validate_report_projection(row) for row in rows]
        if len(reports) > 1:
            raise SupabaseContractError("Published reports response is invalid")
        if canonical_report is not None and not reports:
            raise CustomerDeliveryNotFoundError("Published report was not found")
        return reports

    def download(
        self, case_id: str, report_version_id: str, access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_report = _request_uuid(report_version_id, "Report version ID")
        user_id = self.gateway.authenticate(access_token)
        result = self.gateway.create_total_loss_customer_report_download(
            canonical_case, canonical_report, user_id
        )
        if result is None:
            raise CustomerDeliveryNotFoundError("Published report was not found")
        if not isinstance(result, Mapping) or set(result) != {
            "downloadUrl",
            "suggestedFilename",
            "expiresAt",
        }:
            raise SupabaseContractError("Report download response is invalid")
        url = result.get("downloadUrl")
        filename = result.get("suggestedFilename")
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise SupabaseContractError("Report download URL is invalid")
        if filename != CUSTOMER_TOTAL_LOSS_REPORT_FILENAME:
            raise SupabaseContractError("Report filename is invalid")
        _timestamp(result.get("expiresAt"), "Report download expiry")
        return dict(result)

    def download_response_original(
        self, case_id: str, response_id: str, access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_response = _request_uuid(response_id, "Response ID")
        user_id = self.gateway.authenticate(access_token)
        result = self.gateway.create_total_loss_insurer_response_original_download(
            canonical_case, canonical_response, user_id
        )
        if result is None:
            raise CustomerDeliveryNotFoundError("Insurer response original was not found")
        if not isinstance(result, Mapping) or set(result) != {
            "downloadUrl", "suggestedFilename", "expiresAt",
        }:
            raise SupabaseContractError("Insurer response original download is invalid")
        url = result.get("downloadUrl")
        if not isinstance(url, str):
            raise SupabaseContractError("Insurer response original download URL is invalid")
        try:
            parsed = urlsplit(url)
        except ValueError as exc:
            raise SupabaseContractError(
                "Insurer response original download URL is invalid"
            ) from exc
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if (
            (parsed.scheme != "https" and not local_http)
            or not parsed.hostname or parsed.username or parsed.password or parsed.fragment
        ):
            raise SupabaseContractError("Insurer response original download URL is invalid")
        filename = result.get("suggestedFilename")
        if not isinstance(filename, str) or re.fullmatch(
            r"Insurer_Response_Original\.(pdf|jpg|png|heic|heif)", filename
        ) is None:
            raise SupabaseContractError("Insurer response original filename is invalid")
        _timestamp(result.get("expiresAt"), "Insurer response original download expiry")
        return dict(result)

    def save_sending_details(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        expected = {
            "claimReference",
            "adjusterName",
            "adjusterEmail",
            "claimReferenceConfirmed",
            "adjusterEmailConfirmed",
            "expectedRevision",
            "expectedWorkflowRevision",
        }
        if not isinstance(values, Mapping) or set(values) != expected:
            raise CustomerDeliveryInputError("Sending details request is invalid")
        _nonnegative_revision(values.get("expectedRevision"), "Sending-details revision")
        _positive_revision(values.get("expectedWorkflowRevision"), "Workflow revision")
        normalized = dict(values)
        normalized["claimReference"] = _safe_customer_text(
            values.get("claimReference"), "Claim reference", 200
        )
        normalized["adjusterName"] = _safe_customer_text(
            values.get("adjusterName"), "Adjuster name", 200
        )
        normalized["adjusterEmail"] = _safe_customer_text(
            values.get("adjusterEmail"), "Adjuster email", 320, email=True
        )
        for key in ("claimReferenceConfirmed", "adjusterEmailConfirmed"):
            if not isinstance(values.get(key), bool):
                raise CustomerDeliveryInputError("Sending details request is invalid")
        if (
            values.get("claimReferenceConfirmed") is True
            and normalized["claimReference"] is None
        ) or (
            values.get("adjusterEmailConfirmed") is True
            and normalized["adjusterEmail"] is None
        ):
            raise CustomerDeliveryInputError(
                "Confirmed sending details require a value"
            )
        self.gateway.authenticate(access_token)
        return validate_sending_details(
            self.gateway.put_total_loss_sending_details(
                canonical_case, normalized, access_token
            )
        )

    def draft(self, case_id: str, access_token: str) -> dict[str, Any] | None:
        canonical_case = _request_uuid(case_id, "Case ID")
        self.gateway.authenticate(access_token)
        return validate_message_draft(
            self.gateway.get_total_loss_customer_message_draft(canonical_case, access_token),
            nullable=True,
        )

    def follow_up(self, case_id: str, access_token: str) -> dict[str, Any] | None:
        canonical_case = _request_uuid(case_id, "Case ID")
        self.gateway.authenticate(access_token)
        return validate_follow_up_projection(
            self.gateway.get_total_loss_customer_follow_up(canonical_case, access_token)
        )

    def generate_follow_up(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        from venfour.insurer_response_followup import build_insurer_response_followup_v1
        from venfour.package_assessment import canonical_package_digest

        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {"decisionId"}:
            raise CustomerDeliveryInputError("Follow-up generation request is invalid")
        decision_id = _request_uuid(values.get("decisionId"), "Decision ID")
        user_id = self.gateway.authenticate(access_token)
        existing = validate_follow_up_projection(
            self.gateway.get_total_loss_customer_follow_up(canonical_case, access_token)
        )
        if existing is None or existing["decisionId"] != decision_id:
            raise CustomerDeliveryConflictError("The saved Continue decision is no longer current")
        if existing["state"] in {"draft", "sent"}:
            return existing
        context = self.gateway.resolve_total_loss_follow_up_generation_context(
            canonical_case, user_id, decision_id
        )
        if context is None:
            return {**existing, "state": "unavailable", "reasonCode": "FOLLOW_UP_SOURCE_UNAVAILABLE"}
        if not isinstance(context, Mapping) or set(context) != {
            "sourceIdentity", "analysis", "evidenceIndex", "recommendation",
            "finalAssessment", "report", "initialRequest", "sendingDetails",
            "customerOffer", "contextDigest",
        }:
            raise SupabaseContractError("Follow-up source context is invalid")
        digest = context.get("contextDigest")
        identity = context.get("sourceIdentity")
        if (not isinstance(digest, str) or _CONTENT_DIGEST.fullmatch(digest) is None
            or canonical_package_digest({k: v for k, v in context.items() if k != "contextDigest"}) != digest
            or not isinstance(identity, Mapping)
            or identity.get("caseId") != canonical_case
            or identity.get("decisionId") != decision_id
            or identity.get("decision") != "CONTINUE_CHALLENGING"
            or identity.get("responseId") != existing["responseId"]
            or identity.get("analysisResultId") != existing["analysisResultId"]
            or identity.get("reportId") != existing["reportVersionId"]):
            raise SupabaseContractError("Follow-up source identity is invalid")
        generated = build_insurer_response_followup_v1(
            source_identity=identity,
            analysis=context["analysis"], evidence_index=context["evidenceIndex"],
            recommendation=context["recommendation"], final_assessment=context["finalAssessment"],
            initial_request=context["initialRequest"], sending_details=context["sendingDetails"],
            customer_offer=context["customerOffer"], report=context["report"],
        )
        result = validate_follow_up_projection(self.gateway.store_total_loss_follow_up_draft(
            canonical_case, user_id, decision_id, digest, generated
        ))
        if result is None or any(result[key] != existing[key] for key in (
            "decisionId", "responseId", "analysisResultId", "reportVersionId"
        )):
            raise SupabaseContractError("Generated follow-up identity is invalid")
        return result

    def prepare_follow_up(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {
            "draftId", "clientRequestId", "expectedWorkflowRevision", "expectedDraftRevision",
        }:
            raise CustomerDeliveryInputError("Follow-up preparation request is invalid")
        for key in ("draftId", "clientRequestId"):
            _request_uuid(values.get(key), key)
        for key in ("expectedWorkflowRevision", "expectedDraftRevision"):
            _positive_revision(values.get(key), key)
        self.gateway.authenticate(access_token)
        prepared = self._prepared(
            self.gateway.prepare_total_loss_customer_follow_up(canonical_case, values, access_token),
            purpose="follow_up_reconsideration",
        )
        if prepared["draft"]["draftId"] != values["draftId"]:
            raise SupabaseContractError("Prepared follow-up identity is invalid")
        return prepared

    def edit_draft(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
        *, follow_up: bool = False,
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {
            "recipient",
            "subject",
            "body",
            "expectedRevision",
        } | ({"draftId"} if follow_up else set()):
            raise CustomerDeliveryInputError("Message draft request is invalid")
        recipient = values.get("recipient")
        subject = values.get("subject")
        body = values.get("body")
        if (
            not isinstance(recipient, str)
            or _EMAIL.fullmatch(recipient.strip()) is None
            or len(recipient) > 320
            or not isinstance(subject, str)
            or not subject.strip()
            or len(subject) > 998
            or not isinstance(body, str)
            or not body.strip()
            or len(body) > 50_000
        ):
            raise CustomerDeliveryInputError("Message draft request is invalid")
        _positive_revision(values.get("expectedRevision"), "Draft revision")
        if follow_up:
            _request_uuid(values.get("draftId"), "Draft ID")
        self.gateway.authenticate(access_token)
        save = (
            self.gateway.patch_total_loss_customer_follow_up_draft
            if follow_up else self.gateway.patch_total_loss_customer_message_draft
        )
        draft = save(
            canonical_case, values, access_token
        )
        validated = validate_message_draft(
            draft, purpose="follow_up_reconsideration" if follow_up else "initial_reconsideration"
        )
        if follow_up and validated and validated["draftId"] != values["draftId"]:
            raise SupabaseContractError("Follow-up draft identity is invalid")
        assert validated is not None
        return validated

    def prepare(
        self, case_id: str, client_request_id: str, workflow_revision: int, access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_request = _request_uuid(client_request_id, "Client request ID")
        revision = _positive_revision(workflow_revision, "Workflow revision")
        self.gateway.authenticate(access_token)
        result = self.gateway.prepare_total_loss_customer_message(
            canonical_case, canonical_request, revision, access_token
        )
        return self._prepared(result)

    @staticmethod
    def _prepared(value: Any, *, purpose: str = "initial_reconsideration") -> dict[str, Any]:
        if not isinstance(value, Mapping) or set(value) != {
            "draft",
            "messageVersion",
            "workflowRevision",
        }:
            raise SupabaseContractError("Prepared message response is invalid")
        draft = validate_message_draft(value.get("draft"), purpose=purpose)
        version = value.get("messageVersion")
        if not isinstance(version, Mapping) or set(version) != {
            "messageVersionId",
            "versionNumber",
            "state",
            "reportVersionId",
            "recipient",
            "subject",
            "body",
            "createdAt",
        }:
            raise SupabaseContractError("Prepared message version is invalid")
        _uuid(version.get("messageVersionId"), "Message version ID")
        _uuid(version.get("reportVersionId"), "Message report ID")
        number = version.get("versionNumber")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            raise SupabaseContractError("Message version number is invalid")
        if version.get("state") != "prepared":
            raise SupabaseContractError("Prepared message state is invalid")
        recipient = _bounded_text(version.get("recipient"), "Message recipient", 320)
        if recipient is None or _EMAIL.fullmatch(recipient) is None:
            raise SupabaseContractError("Message recipient is invalid")
        _bounded_text(version.get("subject"), "Message subject", 998)
        _bounded_text(version.get("body"), "Message body", 50_000)
        _timestamp(version.get("createdAt"), "Message version time")
        revision = value.get("workflowRevision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise SupabaseContractError("Workflow revision is invalid")
        return {
            "draft": draft,
            "messageVersion": dict(version),
            "workflowRevision": revision,
        }

    def opened(
        self, case_id: str, message_version_id: str, client_request_id: str, access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_version = _request_uuid(message_version_id, "Message version ID")
        canonical_request = _request_uuid(client_request_id, "Client request ID")
        self.gateway.authenticate(access_token)
        value = self.gateway.record_total_loss_customer_email_opened(
            canonical_case, canonical_version, canonical_request, access_token
        )
        if not isinstance(value, Mapping) or set(value) != {
            "status",
            "eventId",
            "messageVersionId",
            "authoritativeSent",
        }:
            raise SupabaseContractError("Email-open response is invalid")
        _uuid(value.get("eventId"), "Email-open event ID")
        if (
            value.get("status") != "opened"
            or value.get("messageVersionId") != canonical_version
            or value.get("authoritativeSent") is not False
        ):
            raise SupabaseContractError("Email-open response is invalid")
        return dict(value)

    def sent(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
        *, follow_up: bool = False,
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {
            "messageVersionId",
            "clientRequestId",
            "expectedWorkflowRevision",
            "confirmedReportAttached",
        }:
            raise CustomerDeliveryInputError("Sent confirmation request is invalid")
        _request_uuid(values.get("messageVersionId"), "Message version ID")
        _request_uuid(values.get("clientRequestId"), "Client request ID")
        _positive_revision(values.get("expectedWorkflowRevision"), "Workflow revision")
        if values.get("confirmedReportAttached") is not True:
            raise CustomerDeliveryInputError("Report attachment confirmation is required")
        self.gateway.authenticate(access_token)
        confirm = (
            self.gateway.confirm_total_loss_customer_follow_up_sent
            if follow_up else self.gateway.confirm_total_loss_customer_message_sent
        )
        result = confirm(
            canonical_case, values, access_token
        )
        if not isinstance(result, Mapping) or set(result) != {
            "state",
            "messageVersionId",
            "communicationId",
            "negotiationRoundId",
            "customerReportedSentAt",
            "workflowRevision",
        }:
            raise SupabaseContractError("Sent confirmation response is invalid")
        if result.get("state") != "awaiting_insurer_response":
            raise SupabaseContractError("Sent confirmation state is invalid")
        for key in ("messageVersionId", "communicationId", "negotiationRoundId"):
            _uuid(result.get(key), key)
        _timestamp(result.get("customerReportedSentAt"), "Sent confirmation time")
        revision = result.get("workflowRevision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise SupabaseContractError("Workflow revision is invalid")
        return dict(result)

    def prepare_response_upload(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {
            "clientRequestId",
            "expectedWorkflowRevision",
            "originalFilename",
            "mediaType",
            "byteSize",
            "contentDigest",
            "outboundCommunicationId",
            "supersedesResponseId",
        }:
            raise CustomerDeliveryInputError(
                "Insurer response upload request is invalid"
            )
        canonical_request = _request_uuid(
            values.get("clientRequestId"), "Client request ID"
        )
        outbound_id = _request_uuid(values.get("outboundCommunicationId"), "Outbound communication ID")
        supersedes_id = (
            _request_uuid(values.get("supersedesResponseId"), "Superseded insurer response ID")
            if values.get("supersedesResponseId") is not None else None
        )
        _positive_revision(
            values.get("expectedWorkflowRevision"), "Workflow revision"
        )
        media_type = values.get("mediaType")
        original_filename = _safe_filename(
            values.get("originalFilename"),
            media_type,
            browser_input=True,
        )
        byte_size = _upload_byte_size(
            values.get("byteSize"), browser_input=True
        )
        content_digest = values.get("contentDigest")
        if (
            not isinstance(content_digest, str)
            or _CONTENT_DIGEST.fullmatch(content_digest) is None
        ):
            raise CustomerDeliveryInputError(
                "Insurer response content digest is invalid"
            )
        normalized = dict(values)
        normalized["clientRequestId"] = canonical_request
        normalized["outboundCommunicationId"] = outbound_id
        normalized["supersedesResponseId"] = supersedes_id
        normalized["originalFilename"] = original_filename
        normalized["byteSize"] = byte_size
        self.gateway.authenticate(access_token)
        return _validate_insurer_response_upload_projection(
            self.gateway.prepare_total_loss_insurer_response_upload(
                canonical_case, normalized, access_token
            ),
            case_id=canonical_case,
            document_id=canonical_request,
            original_filename=original_filename,
            media_type=media_type,
            byte_size=byte_size,
            content_digest=content_digest,
        )

    def record_insurer_response(
        self, case_id: str, values: Mapping[str, Any], access_token: str
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        if not isinstance(values, Mapping) or set(values) != {
            "clientRequestId",
            "expectedWorkflowRevision",
            "responseText",
            "revisedOfferMinorUnits",
            "documentId",
            "retainedDocumentId",
            "supersedesResponseId",
            "outboundCommunicationId",
        }:
            raise CustomerDeliveryInputError("Insurer response request is invalid")
        canonical_request = _request_uuid(
            values.get("clientRequestId"), "Client request ID"
        )
        outbound_id = _request_uuid(values.get("outboundCommunicationId"), "Outbound communication ID")
        _positive_revision(
            values.get("expectedWorkflowRevision"), "Workflow revision"
        )
        response_text = _response_text(
            values.get("responseText"), browser_input=True
        )
        revised_offer = _minor_units(
            values.get("revisedOfferMinorUnits"), browser_input=True
        )
        document_id = (
            _request_uuid(values.get("documentId"), "Document ID")
            if values.get("documentId") is not None
            else None
        )
        retained_document_id = (
            _request_uuid(
                values.get("retainedDocumentId"), "Retained document ID"
            )
            if values.get("retainedDocumentId") is not None
            else None
        )
        supersedes_response_id = (
            _request_uuid(
                values.get("supersedesResponseId"),
                "Superseded insurer response ID",
            )
            if values.get("supersedesResponseId") is not None
            else None
        )
        if document_id is not None and retained_document_id is not None:
            raise CustomerDeliveryInputError(
                "Insurer response documents are mutually exclusive"
            )
        if document_id is not None and document_id != canonical_request:
            raise CustomerDeliveryInputError(
                "New insurer response document identity is invalid"
            )
        if retained_document_id is not None and supersedes_response_id is None:
            raise CustomerDeliveryInputError(
                "Only a correction can retain a prior response document"
            )
        selected_document_id = document_id or retained_document_id
        if (
            response_text is None
            and revised_offer is None
            and selected_document_id is None
        ):
            raise CustomerDeliveryInputError(
                "Insurer response material is required"
            )

        normalized = dict(values)
        normalized.update(
            {
                "clientRequestId": canonical_request,
                "responseText": response_text,
                "revisedOfferMinorUnits": revised_offer,
                "documentId": document_id,
                "retainedDocumentId": retained_document_id,
                "supersedesResponseId": supersedes_response_id,
                "outboundCommunicationId": outbound_id,
            }
        )
        self.gateway.authenticate(access_token)
        result = self.gateway.record_total_loss_insurer_response(
            canonical_case, normalized, access_token
        )
        if not isinstance(result, Mapping) or set(result) != {
            "state",
            "response",
            "workflowRevision",
        }:
            raise SupabaseContractError("Insurer response result is invalid")
        if result.get("state") != "insurer_response_received":
            raise SupabaseContractError("Insurer response state is invalid")
        response = validate_insurer_response_projection(result.get("response"))
        if (
            response.get("clientRequestId") != canonical_request
            or response.get("text") != response_text
            or response.get("supersedesResponseId") != supersedes_response_id
            or response.get("outboundCommunicationId") != outbound_id
        ):
            raise SupabaseContractError("Insurer response result is invalid")
        projected_document = response.get("document")
        if (projected_document is None) is not (selected_document_id is None):
            raise SupabaseContractError("Insurer response document is invalid")
        if (
            projected_document is not None
            and projected_document.get("documentId") != selected_document_id
        ):
            raise SupabaseContractError("Insurer response document is invalid")
        projected_offer = response.get("revisedOffer")
        if (projected_offer is None) is not (revised_offer is None):
            raise SupabaseContractError("Insurer response revised offer is invalid")
        if (
            projected_offer is not None
            and projected_offer.get("amountMinorUnits") != revised_offer
        ):
            raise SupabaseContractError("Insurer response revised offer is invalid")
        revision = result.get("workflowRevision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise SupabaseContractError("Workflow revision is invalid")
        return {
            "state": "insurer_response_received",
            "response": response,
            "workflowRevision": revision,
        }


__all__ = [
    "CustomerDeliveryConflictError",
    "CustomerDeliveryError",
    "CustomerDeliveryGateway",
    "CustomerDeliveryInputError",
    "CustomerDeliveryNotFoundError",
    "CustomerDeliveryService",
    "CustomerDeliveryUnavailableError",
    "validate_education_projection",
    "validate_insurer_response_projection",
    "validate_message_draft",
    "validate_report_projection",
    "validate_sending_details",
]
