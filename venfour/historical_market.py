"""Provider-neutral contracts for date-specific historical market evidence.

Historical evidence is deliberately separate from current inventory discovery.
Only listing records whose own observed lifecycle overlaps the evidence date
may be projected into the existing Phase 3C comparable scorer.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from venfour.market import (
    MarketContractError,
    MarketListing,
    MarketProviderError,
    MarketProviderResponseError,
    MarketSearchRequest,
    MarketSearchResult,
    normalize_market_search_request,
    validate_market_listing,
    validate_market_search_request,
    validate_market_search_result,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
MARKET_SCHEMA_DIR = REPO_ROOT / "schemas" / "market"
HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH = (
    MARKET_SCHEMA_DIR / "historical-search-request.schema.json"
)
HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH = (
    MARKET_SCHEMA_DIR / "historical-evidence-item.schema.json"
)
HISTORICAL_SEARCH_RESULT_SCHEMA_PATH = (
    MARKET_SCHEMA_DIR / "historical-search-result.schema.json"
)

SUPPORTED = "SUPPORTED"
OUT_OF_PROVIDER_RANGE = "OUT_OF_PROVIDER_RANGE"
RESOLVED = "RESOLVED"
UNRESOLVED = "UNRESOLVED"
AMBIGUOUS = "AMBIGUOUS"
LISTING_RECORD_ACTIVE_ON_DATE = "LISTING_RECORD_ACTIVE_ON_DATE"


def _trim_required(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def _trim_optional(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip()
    return normalized or None


@dataclass(frozen=True)
class HistoricalMarketSearchRequest:
    """One exact calendar date and the vehicle/location to investigate."""

    evidence_date: str
    year: int
    make: str
    model: str
    postal_code: str
    trim: str | None = None
    loss_vehicle_mileage: int | None = None
    radius_miles: int = 50
    result_limit: int = 25

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_date", _trim_required(self.evidence_date))
        object.__setattr__(self, "make", _trim_required(self.make))
        object.__setattr__(self, "model", _trim_required(self.model))
        object.__setattr__(self, "postal_code", _trim_required(self.postal_code))
        object.__setattr__(self, "trim", _trim_optional(self.trim))

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidenceDate": self.evidence_date,
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "lossVehicleMileage": self.loss_vehicle_mileage,
            "postalCode": self.postal_code,
            "radiusMiles": self.radius_miles,
            "resultLimit": self.result_limit,
        }

    def to_market_search_request(self) -> MarketSearchRequest:
        """Project vehicle/search fields into the unchanged Phase 3A request."""

        request = MarketSearchRequest(
            year=self.year,
            make=self.make,
            model=self.model,
            trim=self.trim,
            loss_vehicle_mileage=self.loss_vehicle_mileage,
            postal_code=self.postal_code,
            radius_miles=self.radius_miles,
            result_limit=self.result_limit,
        )
        normalized = normalize_market_search_request(request)
        validate_market_search_request(normalized)
        return normalized


@dataclass(frozen=True)
class HistoricalCoverage:
    """One provider's rolling historical-search capability."""

    status: str
    history_window_days: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "historyWindowDays": self.history_window_days,
        }


@dataclass(frozen=True)
class TemporalEvidence:
    """The record-specific interval that supports one dated listing value."""

    evidence_date: str
    record_first_seen_at: str
    record_last_seen_at: str
    source_first_seen_at: str | None = None
    source_last_seen_at: str | None = None
    status: str = RESOLVED
    basis: str = LISTING_RECORD_ACTIVE_ON_DATE

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "basis": self.basis,
            "evidenceDate": self.evidence_date,
            "recordFirstSeenAt": self.record_first_seen_at,
            "recordLastSeenAt": self.record_last_seen_at,
            "sourceFirstSeenAt": self.source_first_seen_at,
            "sourceLastSeenAt": self.source_last_seen_at,
        }


@dataclass(frozen=True)
class HistoricalEvidenceItem:
    """A canonical listing wrapped in provider-neutral temporal provenance."""

    listing: MarketListing
    temporal_evidence: TemporalEvidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "listing": self.listing.to_dict(),
            "temporalEvidence": self.temporal_evidence.to_dict(),
        }


@dataclass(frozen=True)
class HistoricalEvidenceIssue:
    """A rejected or ambiguous record without exposing its undated price."""

    status: str
    reason: str
    vin: str | None = None
    source_listing_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "vin", _trim_optional(self.vin))
        object.__setattr__(
            self, "source_listing_id", _trim_optional(self.source_listing_id)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "vin": self.vin,
            "sourceListingId": self.source_listing_id,
        }


@dataclass(frozen=True)
class HistoricalMarketSearchResult:
    """Resolved evidence plus explicit coverage and rejected-record diagnostics."""

    provider: str
    evidence_date: str
    as_of_date: str
    coverage: HistoricalCoverage
    request: HistoricalMarketSearchRequest
    evidence: tuple[HistoricalEvidenceItem, ...]
    issues: tuple[HistoricalEvidenceIssue, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider", _trim_required(self.provider))
        object.__setattr__(self, "evidence", tuple(self.evidence))
        object.__setattr__(self, "issues", tuple(self.issues))

    @property
    def listing_count(self) -> int:
        return len(self.evidence)

    @property
    def unresolved_count(self) -> int:
        return sum(issue.status == UNRESOLVED for issue in self.issues)

    @property
    def ambiguous_count(self) -> int:
        return sum(issue.status == AMBIGUOUS for issue in self.issues)

    @property
    def listings(self) -> tuple[MarketListing, ...]:
        return tuple(item.listing for item in self.evidence)

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "evidenceDate": self.evidence_date,
            "asOfDate": self.as_of_date,
            "coverage": self.coverage.to_dict(),
            "request": self.request.to_dict(),
            "evidence": [item.to_dict() for item in self.evidence],
            "listingCount": self.listing_count,
            "issues": [issue.to_dict() for issue in self.issues],
            "unresolvedCount": self.unresolved_count,
            "ambiguousCount": self.ambiguous_count,
        }


@runtime_checkable
class HistoricalMarketProvider(Protocol):
    """Small provider boundary kept separate from current-market search."""

    name: str

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        ...


@lru_cache(maxsize=None)
def _read_schema(path: Path) -> dict[str, Any]:
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise MarketContractError(f"Market schema could not be read: {path}") from exc
    except json.JSONDecodeError as exc:
        raise MarketContractError(f"Market schema is not valid JSON: {path}") from exc
    if not isinstance(schema, dict):
        raise MarketContractError(f"Market schema root must be an object: {path}")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise MarketContractError(
            f"Market schema is invalid: {path}", (exc.message,)
        ) from exc
    return schema


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=False)}]"
    return path


def _validate_schema(data: Any, schema_path: Path, label: str) -> None:
    errors = sorted(
        Draft202012Validator(
            _read_schema(schema_path), format_checker=FormatChecker()
        ).iter_errors(data),
        key=lambda error: (_json_path(list(error.absolute_path)), error.message),
    )
    if errors:
        raise MarketContractError(
            f"{label} failed contract validation",
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )


def _serialize(value: Any, expected_type: type[Any], label: str) -> Any:
    if not isinstance(value, expected_type):
        raise MarketContractError(
            f"{label} failed contract validation",
            (f"$: expected {expected_type.__name__}",),
        )
    try:
        return value.to_dict()
    except (AttributeError, TypeError, ValueError) as exc:
        raise MarketContractError(
            f"{label} failed contract validation",
            (f"$: could not serialize canonical value ({exc})",),
        ) from exc


def _parse_contract_date(value: str) -> date:
    return date.fromisoformat(value)


def _parse_contract_datetime(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include an offset")
    return parsed.astimezone(timezone.utc)


def _day_bounds(value: str) -> tuple[datetime, datetime]:
    evidence_date = _parse_contract_date(value)
    start = datetime.combine(evidence_date, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def validate_historical_market_search_request(
    request: HistoricalMarketSearchRequest | Mapping[str, Any],
) -> None:
    data = (
        _serialize(
            request,
            HistoricalMarketSearchRequest,
            "Historical market search request",
        )
        if isinstance(request, HistoricalMarketSearchRequest)
        else request
    )
    _validate_schema(
        data,
        HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH,
        "Historical market search request",
    )
    if isinstance(request, HistoricalMarketSearchRequest):
        request.to_market_search_request()


def validate_historical_evidence_item(
    item: HistoricalEvidenceItem | Mapping[str, Any],
) -> None:
    data = (
        _serialize(item, HistoricalEvidenceItem, "Historical evidence item")
        if isinstance(item, HistoricalEvidenceItem)
        else item
    )
    _validate_schema(
        data,
        HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH,
        "Historical evidence item",
    )
    validate_market_listing(data["listing"])
    temporal = data["temporalEvidence"]
    try:
        first = _parse_contract_datetime(temporal["recordFirstSeenAt"])
        last = _parse_contract_datetime(temporal["recordLastSeenAt"])
        source_first = (
            _parse_contract_datetime(temporal["sourceFirstSeenAt"])
            if temporal["sourceFirstSeenAt"] is not None
            else None
        )
        source_last = (
            _parse_contract_datetime(temporal["sourceLastSeenAt"])
            if temporal["sourceLastSeenAt"] is not None
            else None
        )
        day_start, next_day = _day_bounds(temporal["evidenceDate"])
    except (TypeError, ValueError) as exc:
        raise MarketContractError(
            "Historical evidence item failed contract validation",
            ("$.temporalEvidence: contains an invalid ISO date or timestamp",),
        ) from exc
    details: list[str] = []
    if first > last:
        details.append("$.temporalEvidence: record interval is inverted")
    if (
        source_first is not None
        and source_last is not None
        and source_first > source_last
    ):
        details.append("$.temporalEvidence: source interval is inverted")
    if source_first is not None and first < source_first:
        details.append(
            "$.temporalEvidence: record starts before its source interval"
        )
    if source_last is not None and last > source_last:
        details.append(
            "$.temporalEvidence: record ends after its source interval"
        )
    if not (first < next_day and last >= day_start):
        details.append(
            "$.temporalEvidence: record interval does not overlap evidenceDate"
        )
    if details:
        raise MarketContractError(
            "Historical evidence item failed contract validation", tuple(details)
        )


def validate_historical_market_search_result(
    result: HistoricalMarketSearchResult | Mapping[str, Any],
) -> None:
    data = (
        _serialize(
            result,
            HistoricalMarketSearchResult,
            "Historical market search result",
        )
        if isinstance(result, HistoricalMarketSearchResult)
        else result
    )
    _validate_schema(
        data,
        HISTORICAL_SEARCH_RESULT_SCHEMA_PATH,
        "Historical market search result",
    )
    validate_historical_market_search_request(data["request"])

    details: list[str] = []
    evidence_date = _parse_contract_date(data["evidenceDate"])
    as_of_date = _parse_contract_date(data["asOfDate"])
    if evidence_date > as_of_date:
        details.append("$.evidenceDate: future evidence dates are not allowed")
    if data["request"]["evidenceDate"] != data["evidenceDate"]:
        details.append("$.request.evidenceDate: must match $.evidenceDate")

    age_days = (as_of_date - evidence_date).days
    expected_coverage = (
        SUPPORTED
        if 0 <= age_days <= data["coverage"]["historyWindowDays"]
        else OUT_OF_PROVIDER_RANGE
    )
    if data["coverage"]["status"] != expected_coverage:
        details.append(
            "$.coverage.status: inconsistent with evidenceDate, asOfDate, and "
            "historyWindowDays"
        )

    if data["listingCount"] != len(data["evidence"]):
        details.append("$.listingCount: does not match the evidence array")
    if data["listingCount"] > data["request"]["resultLimit"]:
        details.append("$.listingCount: exceeds request.resultLimit")

    seen_identities: set[tuple[str, str]] = set()
    seen_listing_ids: set[str] = set()
    for index, item in enumerate(data["evidence"]):
        try:
            validate_historical_evidence_item(item)
        except MarketContractError as exc:
            details.extend(
                f"$.evidence[{index}]{detail[1:]}" for detail in exc.details
            )
            continue
        listing = item["listing"]
        temporal = item["temporalEvidence"]
        if listing["source"] != data["provider"]:
            details.append(
                f"$.evidence[{index}].listing.source: must match $.provider"
            )
        if temporal["evidenceDate"] != data["evidenceDate"]:
            details.append(
                f"$.evidence[{index}].temporalEvidence.evidenceDate: must match "
                "$.evidenceDate"
            )
        vin = listing.get("vin")
        listing_id = listing.get("sourceListingId")
        if listing_id is not None:
            if listing_id in seen_listing_ids:
                details.append(
                    f"$.evidence[{index}].listing.sourceListingId: duplicate "
                    f"same-provider ID {listing_id!r}"
                )
            seen_listing_ids.add(listing_id)
        if vin is not None:
            identity = ("vin", vin.casefold())
        elif listing_id is not None:
            identity = ("sourceListingId", listing_id)
        else:
            details.append(
                f"$.evidence[{index}].listing: VIN or sourceListingId is required"
            )
            continue
        if identity in seen_identities:
            details.append(f"$.evidence[{index}].listing: duplicate vehicle identity")
        seen_identities.add(identity)

    unresolved = sum(issue["status"] == UNRESOLVED for issue in data["issues"])
    ambiguous = sum(issue["status"] == AMBIGUOUS for issue in data["issues"])
    if data["unresolvedCount"] != unresolved:
        details.append("$.unresolvedCount: does not match unresolved issues")
    if data["ambiguousCount"] != ambiguous:
        details.append("$.ambiguousCount: does not match ambiguous issues")
    for index, issue in enumerate(data["issues"]):
        has_identity = (
            issue["vin"] is not None or issue["sourceListingId"] is not None
        )
        if (
            issue["reason"] == "MISSING_LISTING_IDENTITY"
            and issue["sourceListingId"] is not None
        ):
            details.append(
                f"$.issues[{index}].sourceListingId: must be null when the "
                "required listing identity is missing"
            )
        elif issue["reason"] not in {
            "MISSING_LISTING_IDENTITY",
            "PAGINATION_SAFETY_LIMIT_REACHED",
            "INCOMPLETE_PROVIDER_PAGINATION",
        } and not has_identity:
            details.append(f"$.issues[{index}]: an identity field is required")
        if (
            issue["reason"]
            in {"PAGINATION_SAFETY_LIMIT_REACHED", "INCOMPLETE_PROVIDER_PAGINATION"}
            and (
                issue["vin"] is not None
                and ("vin", issue["vin"].casefold()) in seen_identities
                or issue["sourceListingId"] in seen_listing_ids
            )
        ):
            details.append(
                f"$.issues[{index}]: pagination-incomplete identity cannot also "
                "appear as resolved evidence"
            )
        is_ambiguous_reason = (
            issue["reason"] == "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE"
        )
        if (issue["status"] == AMBIGUOUS) != is_ambiguous_reason:
            details.append(
                f"$.issues[{index}]: ambiguous status and reason must agree"
            )

    if data["coverage"]["status"] == OUT_OF_PROVIDER_RANGE and (
        data["evidence"] or data["issues"]
    ):
        details.append(
            "$: out-of-range results cannot contain evidence or provider issues"
        )
    if any(
        issue["reason"]
        in {"PAGINATION_SAFETY_LIMIT_REACHED", "INCOMPLETE_PROVIDER_PAGINATION"}
        and issue["vin"] is None
        and issue["sourceListingId"] is None
        for issue in data["issues"]
    ) and data["evidence"]:
        details.append(
            "$: globally incomplete pagination cannot contain resolved evidence"
        )
    if details:
        raise MarketContractError(
            "Historical market search result failed contract validation",
            tuple(details),
        )


def normalize_historical_market_search_request(
    request: HistoricalMarketSearchRequest,
) -> HistoricalMarketSearchRequest:
    if not isinstance(request, HistoricalMarketSearchRequest):
        raise MarketContractError(
            "Historical market search request must be HistoricalMarketSearchRequest"
        )
    normalized = HistoricalMarketSearchRequest(
        evidence_date=request.evidence_date,
        year=request.year,
        make=request.make,
        model=request.model,
        postal_code=request.postal_code,
        trim=request.trim,
        loss_vehicle_mileage=request.loss_vehicle_mileage,
        radius_miles=request.radius_miles,
        result_limit=request.result_limit,
    )
    validate_historical_market_search_request(normalized)
    return normalized


def discover_historical_market_evidence(
    request: HistoricalMarketSearchRequest,
    provider: HistoricalMarketProvider,
) -> HistoricalMarketSearchResult:
    """Validate one exact-date request and one provider's canonical response."""

    normalized = normalize_historical_market_search_request(request)
    try:
        provider_name = _trim_required(getattr(provider, "name", None))
    except MarketProviderError:
        raise
    except Exception as exc:
        raise MarketProviderResponseError(
            "Historical market provider name could not be read"
        ) from exc
    if not isinstance(provider_name, str) or not provider_name:
        raise MarketProviderResponseError(
            "Historical market provider must expose a non-empty stable name"
        )

    try:
        result = provider.search_historical(normalized)
    except MarketProviderError:
        raise
    except MarketContractError as exc:
        raise MarketProviderResponseError(
            "Provider could not produce canonical historical market data",
            exc.details,
        ) from exc
    except Exception as exc:
        raise MarketProviderError(
            f"Historical market provider {provider_name!r} search failed"
        ) from exc
    if not isinstance(result, HistoricalMarketSearchResult):
        raise MarketProviderResponseError(
            "Provider did not return HistoricalMarketSearchResult",
            (f"$: got {type(result).__name__}",),
        )
    try:
        validate_historical_market_search_result(result)
    except MarketContractError as exc:
        raise MarketProviderResponseError(
            "Provider returned invalid historical market evidence", exc.details
        ) from exc
    if result.provider != provider_name:
        raise MarketProviderResponseError(
            "Provider returned inconsistent historical market evidence",
            ("$.provider: does not match the provider name",),
        )
    if result.request != normalized:
        raise MarketProviderResponseError(
            "Provider returned inconsistent historical market evidence",
            ("$.request: provider did not echo the normalized request",),
        )
    return result


def historical_evidence_to_market_search_result(
    result: HistoricalMarketSearchResult,
) -> MarketSearchResult:
    """Project only resolved listings into the unchanged Phase 3C input."""

    if not isinstance(result, HistoricalMarketSearchResult):
        raise MarketContractError(
            "Historical market search result failed contract validation",
            (f"$: expected HistoricalMarketSearchResult, got {type(result).__name__}",),
        )
    validate_historical_market_search_result(result)
    if result.coverage.status != SUPPORTED:
        raise MarketContractError(
            "Unsupported historical coverage cannot be projected as market data",
            ("$.coverage.status: expected 'SUPPORTED'",),
        )
    if any(
        issue.reason
        in {"PAGINATION_SAFETY_LIMIT_REACHED", "INCOMPLETE_PROVIDER_PAGINATION"}
        and issue.vin is None
        and issue.source_listing_id is None
        for issue in result.issues
    ):
        raise MarketContractError(
            "Incomplete historical pagination cannot be projected as market data",
            ("$.issues: historical provider pagination is incomplete",),
        )
    projected = MarketSearchResult(
        provider=result.provider,
        request=result.request.to_market_search_request(),
        listings=result.listings,
    )
    validate_market_search_result(projected)
    return projected


__all__ = [
    "AMBIGUOUS",
    "HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH",
    "HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH",
    "HISTORICAL_SEARCH_RESULT_SCHEMA_PATH",
    "HistoricalCoverage",
    "HistoricalEvidenceIssue",
    "HistoricalEvidenceItem",
    "HistoricalMarketProvider",
    "HistoricalMarketSearchRequest",
    "HistoricalMarketSearchResult",
    "LISTING_RECORD_ACTIVE_ON_DATE",
    "OUT_OF_PROVIDER_RANGE",
    "RESOLVED",
    "SUPPORTED",
    "TemporalEvidence",
    "UNRESOLVED",
    "discover_historical_market_evidence",
    "historical_evidence_to_market_search_result",
    "normalize_historical_market_search_request",
    "validate_historical_evidence_item",
    "validate_historical_market_search_request",
    "validate_historical_market_search_result",
]
