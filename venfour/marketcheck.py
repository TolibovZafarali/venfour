"""MarketCheck adapter for Venfour's provider-neutral market contracts."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
from time import sleep
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, quote_plus, urlencode, urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    Request,
    build_opener,
)

from venfour.comparables import (
    comparable_target_from_search_request,
    rank_market_comparables,
)
from venfour.historical_market import (
    AMBIGUOUS,
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    UNRESOLVED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
    validate_historical_market_search_result,
)
from venfour.market import (
    DrivetrainDiscovery,
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProviderAuthenticationError,
    MarketProviderDiagnostic,
    MarketProviderError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    MarketSearchResult,
    VehicleConfigurationIdentity,
    normalize_drivetrain,
    validate_market_listing,
)
from venfour.vehicle_catalog import (
    MAX_VEHICLE_CATALOG_TEXT_LENGTH,
    VehicleTrimCatalogRequest,
    VehicleTrimOption,
    VehicleTrimQueryValuesLimitError,
    explicit_version_drivetrain,
    normalize_vehicle_trim_catalog,
    normalize_vehicle_trim_options,
)


MARKETCHECK_ACTIVE_INVENTORY_URL = (
    "https://api.marketcheck.com/v2/search/car/active"
)
MARKETCHECK_PAST_INVENTORY_URL = (
    "https://api.marketcheck.com/v2/search/car/recents"
)
MARKETCHECK_VIN_HISTORY_URL = "https://api.marketcheck.com/v2/history/car"
MARKETCHECK_CAR_TERMS_URL = "https://api.marketcheck.com/v2/specs/car/terms"
MARKETCHECK_MAX_ROWS = 50
MARKETCHECK_MAX_TAXONOMY_TERMS = 1000
MARKETCHECK_ACTIVE_MAX_RADIUS_MILES = 100
MARKETCHECK_PAST_MAX_RADIUS_MILES = 100
MARKETCHECK_HISTORY_WINDOW_DAYS = 90
MARKETCHECK_HISTORICAL_MAX_PAGES = 10
MARKETCHECK_HISTORICAL_MIN_ROWS = 10
MARKETCHECK_VIN_HISTORY_MAX_PAGES = 10
MARKETCHECK_VIN_HISTORY_PAGE_SIZE = 50
MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS = 100
MARKETCHECK_BOUNDED_VIN_HISTORY_MAX_PAGES = 3
DEFAULT_TIMEOUT_SECONDS = 15.0
MARKETCHECK_TRANSIENT_RETRY_DELAY_SECONDS = 0.25
MARKETCHECK_MAX_REQUEST_ATTEMPTS = 2
MARKETCHECK_DRIVETRAIN_LOOKUP_VERSION = "1"
MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS = 50
MARKETCHECK_SAVED_BUILD_MAX_IDENTITIES = 1000

QueryValue = str | int


@dataclass(frozen=True)
class MarketCheckDiscoveryPage:
    """One discovery page, with normalized observations kept before screening."""

    listings: tuple[MarketListing, ...]
    observations: tuple[Mapping[str, Any], ...]
    start: int
    rows: int
    num_found: int | None
    has_more: bool
    issues: tuple[HistoricalEvidenceIssue, ...] = ()


@dataclass(frozen=True)
class MarketCheckVerifiedBatch:
    """Verified observations plus a terminal failure after any usable progress."""

    result: HistoricalMarketSearchResult
    observations: tuple[Mapping[str, Any], ...]
    failure: MarketProviderError | None = None


def _retry_after_seconds(value: str | None) -> float | None:
    if not isinstance(value, str):
        return None
    if re.fullmatch(r"[0-9]+", value.strip()):
        return float(value.strip())
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            return None
        return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return None


def marketcheck_account_radius_from_environment(
    environment: Mapping[str, str],
) -> int:
    """Read an operator-verified account limit without detecting capabilities."""

    key = "MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES"
    value = environment.get(key, "")
    if isinstance(value, str) and not value.strip():
        raise ValueError(f"{key} requires a confirmed account entitlement")
    if (
        not isinstance(value, str)
        or len(value) > 10
        or re.fullmatch(r"[1-9][0-9]*", value) is None
        or int(value) > 2**31 - 1
    ):
        raise ValueError(f"{key} must be a canonical positive 32-bit integer")
    return int(value)


def _lookup_time() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _lookup_text(value: Any, maximum: int = 100) -> str:
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum
            or _has_unsupported_provider_text_character(value)):
        raise ValueError("Invalid drivetrain lookup text")
    return " ".join(value.split())


def _lookup_identity(vin: str, year: int, make: str, model: str) -> tuple[str, dict[str, Any]]:
    normalized_vin = _lookup_text(vin, 17).upper()
    if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", normalized_vin):
        raise ValueError("Drivetrain lookup requires a full VIN")
    if isinstance(year, bool) or not isinstance(year, int) or not 1886 <= year <= 9999:
        raise ValueError("Invalid drivetrain lookup year")
    return normalized_vin, {"year": year, "make": _lookup_text(make), "model": _lookup_text(model)}


def _drivetrain_evidence_digest(evidence: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(evidence, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def validate_drivetrain_lookup_result(data: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a safe, identity-bound provider specification observation."""
    required = {"provider", "resolverVersion", "vin", "vehicle", "status", "drivetrain",
                "reasonCode", "evidence", "evidenceDigest", "retrievedAt", "lookupSource",
                "cacheHit", "providerRequestCount"}
    if not isinstance(data, Mapping) or set(data) != required:
        raise ValueError("Invalid drivetrain lookup result fields")
    vehicle = data["vehicle"]
    if not isinstance(vehicle, Mapping) or set(vehicle) != {"year", "make", "model"}:
        raise ValueError("Invalid drivetrain lookup vehicle")
    vin, normalized_vehicle = _lookup_identity(data["vin"], **dict(vehicle))
    if vin != data["vin"] or normalized_vehicle != vehicle:
        raise ValueError("Noncanonical drivetrain lookup identity")
    if data["provider"] != "marketcheck" or data["resolverVersion"] != "1":
        raise ValueError("Unsupported drivetrain lookup version")
    if data["status"] not in {"RESOLVED", "UNAVAILABLE", "CONFLICT", "FAILED"}:
        raise ValueError("Invalid drivetrain lookup status")
    if data["lookupSource"] not in {"SAVED_PROVIDER_EVIDENCE", "ACTIVE_VIN_LOOKUP"}:
        raise ValueError("Invalid drivetrain lookup source")
    if not isinstance(data["cacheHit"], bool):
        raise ValueError("Invalid drivetrain lookup cache status")
    count = data["providerRequestCount"]
    if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= MARKETCHECK_MAX_REQUEST_ATTEMPTS:
        raise ValueError("Invalid drivetrain lookup request count")
    if (data["cacheHit"] or data["lookupSource"] == "SAVED_PROVIDER_EVIDENCE") and count:
        raise ValueError("Saved drivetrain evidence cannot add provider requests")
    if not isinstance(data["reasonCode"], str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", data["reasonCode"]):
        raise ValueError("Invalid drivetrain lookup reason")
    def timestamp(value: Any) -> None:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise ValueError("Drivetrain lookup time must be UTC")
        datetime.fromisoformat(value[:-1] + "+00:00")
    timestamp(data["retrievedAt"])
    evidence = data["evidence"]
    if not isinstance(evidence, list) or len(evidence) > MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS:
        raise ValueError("Invalid drivetrain evidence collection")
    values: set[str] = set()
    for row in evidence:
        if not isinstance(row, Mapping) or set(row) != {"listingId", "vin", "year", "make", "model", "rawDrivetrain", "drivetrain", "sourcePath", "endpointCategory", "retrievedAt"}:
            raise ValueError("Invalid drivetrain evidence fields")
        _lookup_text(row["listingId"], 512)
        row_vin, row_vehicle = _lookup_identity(row["vin"], row["year"], row["make"], row["model"])
        if row_vin != vin or row_vehicle["year"] != vehicle["year"] or any(row_vehicle[key].casefold() != vehicle[key].casefold() for key in ("make", "model")):
            raise ValueError("Drivetrain evidence identity does not match the request")
        if row["rawDrivetrain"] is not None:
            _lookup_text(row["rawDrivetrain"], 128)
        if row["drivetrain"] != normalize_drivetrain(row["rawDrivetrain"]):
            raise ValueError("Drivetrain evidence differs from its explicit source")
        if row["endpointCategory"] not in {"active", "recents", "history"}:
            raise ValueError("Invalid drivetrain evidence endpoint")
        if not isinstance(row["sourcePath"], str) or not re.fullmatch(r"\$(?:\.listings)?\[\d+\]\.build\.drivetrain", row["sourcePath"]):
            raise ValueError("Invalid drivetrain evidence source path")
        timestamp(row["retrievedAt"])
        if row["drivetrain"] is not None:
            values.add(row["drivetrain"])
    if data["evidenceDigest"] != _drivetrain_evidence_digest(evidence):
        raise ValueError("Drivetrain evidence digest does not match")
    if data["status"] == "RESOLVED":
        if len(values) != 1 or data["drivetrain"] != next(iter(values)):
            raise ValueError("Resolved drivetrain requires unanimous explicit evidence")
    elif data["drivetrain"] is not None:
        raise ValueError("Unresolved drivetrain must remain unknown")
    if data["status"] == "CONFLICT" and len(values) < 2:
        raise ValueError("Conflicting drivetrain requires contradictory explicit values")
    if data["status"] in {"UNAVAILABLE", "FAILED"} and values:
        raise ValueError("Unresolved lookup cannot discard an explicit value")
    return copy.deepcopy(dict(data))


def _drivetrain_lookup_result(vin: str, vehicle: dict[str, Any], *, status: str,
                             reason: str, evidence: list[dict[str, Any]],
                             lookup_source: str, request_count: int,
                             retrieved_at: str | None = None) -> dict[str, Any]:
    values = {row["drivetrain"] for row in evidence if row["drivetrain"] is not None}
    return validate_drivetrain_lookup_result({
        "provider": "marketcheck", "resolverVersion": MARKETCHECK_DRIVETRAIN_LOOKUP_VERSION,
        "vin": vin, "vehicle": vehicle, "status": status,
        "drivetrain": next(iter(values)) if status == "RESOLVED" and len(values) == 1 else None,
        "reasonCode": reason, "evidence": evidence,
        "evidenceDigest": _drivetrain_evidence_digest(evidence),
        "retrievedAt": retrieved_at or _lookup_time(), "lookupSource": lookup_source,
        "cacheHit": False, "providerRequestCount": request_count,
    })


def drivetrain_lookup_failure(vin: str, *, year: int, make: str, model: str,
                              reason_code: str, retrieved_at: str | None = None) -> dict[str, Any]:
    canonical_vin, vehicle = _lookup_identity(vin, year, make, model)
    return _drivetrain_lookup_result(canonical_vin, vehicle, status="FAILED", reason=reason_code,
                                    evidence=[], lookup_source="ACTIVE_VIN_LOOKUP", request_count=0,
                                    retrieved_at=retrieved_at)


def configuration_drivetrain(
    configuration: VehicleConfigurationIdentity | None,
) -> str | None:
    """Interpret only this provider's explicit version drivetrain facets."""

    if (
        configuration is None
        or configuration.source != "marketcheck"
        or configuration.field != "version"
    ):
        return None
    return explicit_version_drivetrain(configuration.values)


_HISTORY_PAGE_EXHAUSTED = object()
_HISTORY_RECORD_MATCHED = "MATCHED"
_HISTORY_RECORD_IRRELEVANT = "IRRELEVANT"
_HISTORY_RECORD_UNVERIFIABLE = "UNVERIFIABLE"


def _has_unsupported_provider_text_character(value: str) -> bool:
    return any(
        ord(character) < 32
        or ord(character) == 127
        or ord(character) == 0x061C
        or ord(character) in (0x200E, 0x200F)
        or 0x202A <= ord(character) <= 0x202E
        or 0x2066 <= ord(character) <= 0x2069
        for character in value
    )


def _battery_electric_only(raw_values: Any) -> bool:
    if (
        not isinstance(raw_values, list)
        or not raw_values
        or len(raw_values) > MARKETCHECK_MAX_TAXONOMY_TERMS
    ):
        return False
    values: list[str] = []
    for value in raw_values:
        if not isinstance(value, str):
            return False
        normalized = " ".join(value.split())
        if (
            not normalized
            or len(normalized) > MAX_VEHICLE_CATALOG_TEXT_LENGTH
            or _has_unsupported_provider_text_character(value)
        ):
            return False
        values.append(normalized.casefold())
    return all(
        value in {"battery electric", "bev", "electric"}
        for value in values
    )


class MarketCheckTransport(Protocol):
    """Injectable byte-oriented HTTP boundary used by ``MarketCheckProvider``."""

    def get(
        self,
        endpoint: str,
        params: Mapping[str, QueryValue],
        headers: Mapping[str, str],
        timeout: float,
    ) -> bytes:
        """Perform one GET request and return the response body."""

        ...


class _RejectRedirects(HTTPRedirectHandler):
    """Keep query-string credentials on the fixed MarketCheck HTTPS origin."""

    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


class _UrllibMarketCheckTransport:
    """Small standard-library transport with no logging or automatic retries."""

    def __init__(self) -> None:
        self._opener = build_opener(_RejectRedirects())

    def get(
        self,
        endpoint: str,
        params: Mapping[str, QueryValue],
        headers: Mapping[str, str],
        timeout: float,
    ) -> bytes:
        query = urlencode(params)
        request = Request(
            f"{endpoint}?{query}",
            headers=dict(headers),
            method="GET",
        )
        with self._opener.open(request, timeout=timeout) as response:
            return response.read()


def _mapping(value: Any, path: str, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MarketProviderResponseError(
            label,
            (f"{path}: expected an object",),
        )
    return value


def _reject_nonstandard_number(value: str) -> None:
    raise ValueError(f"Non-standard JSON number: {value}")


class MarketCheckProvider:
    """Search active used inventory and normalize only canonical listing fields.

    The API key is supplied explicitly so core request objects never contain it.
    The provider emits no logs and never returns raw MarketCheck payloads.
    """

    name = "marketcheck"
    maximum_search_radius_miles = MARKETCHECK_ACTIVE_MAX_RADIUS_MILES

    def __init__(
        self,
        api_key: str | None,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: MarketCheckTransport | None = None,
        maximum_search_radius_miles: int | None = None,
        request_budget: Any = None,
        _allow_missing_api_key: bool = False,
    ) -> None:
        missing_key = not isinstance(api_key, str) or not api_key.strip()
        if missing_key and not (
            _allow_missing_api_key and (api_key is None or isinstance(api_key, str))
        ):
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or timeout <= 0
        ):
            raise ValueError("MarketCheck timeout must be a positive finite number")
        declared_maximum_radius = (
            type(self).maximum_search_radius_miles
            if maximum_search_radius_miles is None
            else maximum_search_radius_miles
        )
        if (
            isinstance(declared_maximum_radius, bool)
            or not isinstance(declared_maximum_radius, int)
            or declared_maximum_radius < 0
        ):
            raise ValueError(
                "MarketCheck maximum search radius must be a non-negative integer"
            )

        self._api_key = None if missing_key else api_key.strip()
        self._timeout = float(timeout)
        self.maximum_search_radius_miles = declared_maximum_radius
        self.request_budget = request_budget
        self._request_phase: ContextVar[str] = ContextVar(
            f"marketcheck_request_phase_{id(self)}", default="baseline"
        )
        self._uses_default_transport = transport is None or isinstance(transport, _UrllibMarketCheckTransport)
        self._transport = (
            transport if transport is not None else _UrllibMarketCheckTransport()
        )
        self._trim_catalog_cache: dict[str, tuple[VehicleTrimOption, ...]] = {}
        self._saved_drivetrain_evidence: dict[str, list[dict[str, Any]]] = {}
        self._drivetrain_lookup_cache: dict[tuple[Any, ...], dict[str, Any]] = {}
        if self._api_key is None:
            self._secret_variants = ()
        else:
            self._secret_variants = tuple(
                sorted(
                    {
                        self._api_key,
                        json.dumps(self._api_key, ensure_ascii=False)[1:-1],
                        repr(self._api_key)[1:-1],
                        quote(self._api_key, safe=""),
                        quote_plus(self._api_key),
                    },
                    key=len,
                    reverse=True,
                )
            )

    def __repr__(self) -> str:
        return f"MarketCheckProvider(timeout={self._timeout!r})"

    def _redact(self, value: str) -> str:
        redacted = value
        for secret in self._secret_variants:
            redacted = redacted.replace(secret, "[REDACTED]")
        return redacted

    def _contains_secret(self, value: Any) -> bool:
        if isinstance(value, str):
            return any(secret in value for secret in self._secret_variants)
        if isinstance(value, Mapping):
            return any(
                self._contains_secret(key) or self._contains_secret(child)
                for key, child in value.items()
            )
        if isinstance(value, (list, tuple)):
            return any(self._contains_secret(child) for child in value)
        return False

    @staticmethod
    def _has_api_key_parameter(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        try:
            parsed = urlsplit(value)
        except ValueError:
            return False
        for component in (parsed.query, parsed.fragment):
            if any(
                name.casefold() == "api_key"
                for name, _ in parse_qsl(component, keep_blank_values=True)
            ):
                return True
        return False

    @staticmethod
    def drivetrain_discovery(subject_drive: str | None) -> DrivetrainDiscovery:
        """Describe the exact drivetrain filter supported by the REST inventory API."""
        if subject_drive in {"FWD", "RWD", "4WD"}:
            return DrivetrainDiscovery(version="1", status="EXACT_FILTER", filter_value=subject_drive)
        if subject_drive is None:
            return DrivetrainDiscovery(version="1", status="SUBJECT_DRIVETRAIN_UNKNOWN", filter_value=None)
        if subject_drive == "AWD":
            return DrivetrainDiscovery(version="1", status="PROVIDER_MAPPING_UNVERIFIED", filter_value=None)
        raise MarketContractError("Drivetrain discovery requires a canonical subject drivetrain")

    def _discovery_drivetrain_filter(
        self, request: MarketSearchRequest | HistoricalMarketSearchRequest,
    ) -> str | None:
        marker = request.drivetrain_discovery
        if marker is None:
            return None
        if marker.to_dict() != self.drivetrain_discovery(request.drivetrain).to_dict():
            raise MarketContractError("Drivetrain discovery does not match the MarketCheck mapping")
        return marker.filter_value

    def _enforce_search_radius(
        self, radius_miles: int, *, maximum_radius_miles: int | None = None,
    ) -> None:
        maximum = (
            self.maximum_search_radius_miles
            if maximum_radius_miles is None
            else maximum_radius_miles
        )
        if radius_miles > maximum:
            raise MarketContractError(
                "Requested search radius exceeds the configured provider maximum"
            )

    def _params(
        self,
        request: MarketSearchRequest,
        *,
        start: int,
        rows: int,
    ) -> dict[str, QueryValue]:
        if self._api_key is None:
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )
        params: dict[str, QueryValue] = {
            "api_key": self._api_key,
            "append_api_key": "false",
            "car_type": "used",
            "year": request.year,
            "make": request.make,
            "model": request.model,
            "has_price": "true",
            "start": start,
            "rows": rows,
        }
        if request.configuration is not None:
            if request.configuration.source != self.name:
                raise MarketContractError(
                    "Vehicle configuration source is incompatible with MarketCheck"
                )
            params[request.configuration.field] = ",".join(
                request.configuration.values
            )
        elif request.trim is not None:
            params["trim"] = request.trim
        drivetrain_filter = self._discovery_drivetrain_filter(request)
        if drivetrain_filter is not None:
            params["drivetrain"] = drivetrain_filter
        if request.postal_code is not None:
            self._enforce_search_radius(request.radius_miles)
            params["zip"] = request.postal_code
            params["radius"] = request.radius_miles
        return params

    @staticmethod
    def _http_error(status: int) -> MarketProviderError:
        if status in (401, 403):
            return MarketProviderAuthenticationError(
                "MarketCheck rejected the configured credentials"
            )
        if status == 429:
            return MarketProviderRateLimitError(
                "MarketCheck temporarily rate limited the request"
            )
        if status == 408 or 500 <= status <= 599:
            return MarketProviderUnavailableError(
                "MarketCheck is temporarily unavailable"
            )
        return MarketProviderResponseError(
            f"MarketCheck rejected the search request (HTTP {status})"
        )

    @staticmethod
    def _endpoint_category(endpoint: str) -> str | None:
        if endpoint == MARKETCHECK_ACTIVE_INVENTORY_URL:
            return "active"
        if endpoint == MARKETCHECK_PAST_INVENTORY_URL:
            return "recents"
        if endpoint.startswith(f"{MARKETCHECK_VIN_HISTORY_URL}/"):
            return "history"
        return None

    @staticmethod
    def _diagnostic_integer(
        params: Mapping[str, QueryValue], name: str
    ) -> int | None:
        value = params.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
        return value

    def _provider_diagnostic(
        self,
        params: Mapping[str, QueryValue],
        endpoint: str,
        *,
        http_status: int | None = None,
    ) -> MarketProviderDiagnostic | None:
        category = self._endpoint_category(endpoint)
        if category is None:
            return None
        safe_status = (
            http_status
            if isinstance(http_status, int)
            and not isinstance(http_status, bool)
            and 100 <= http_status <= 599
            else None
        )
        return MarketProviderDiagnostic(
            endpoint_category=category,
            http_status=safe_status,
            radius=self._diagnostic_integer(params, "radius"),
            start=self._diagnostic_integer(params, "start"),
            rows=self._diagnostic_integer(params, "rows"),
            page=self._diagnostic_integer(params, "page"),
        )

    def _annotate_provider_failure(
        self,
        failure: MarketProviderError,
        params: Mapping[str, QueryValue],
        endpoint: str,
        *,
        http_status: int | None = None,
    ) -> MarketProviderError:
        diagnostic = self._provider_diagnostic(
            params, endpoint, http_status=http_status
        )
        if diagnostic is not None:
            failure.with_diagnostic(diagnostic)
        return failure

    def _request_json(
        self,
        params: Mapping[str, QueryValue],
        *,
        endpoint: str = MARKETCHECK_ACTIVE_INVENTORY_URL,
        allow_history_page_exhaustion: bool = False,
        request_counter: list[int] | None = None,
        request_phase: str | None = None,
    ) -> Any:
        if self._uses_default_transport and self.request_budget is None:
            raise MarketProviderUnavailableError(
                "Live market requests require shared request accounting. "
                "Submit or resume the owned case analysis workflow."
            )
        body: bytes | None = None
        for attempt in range(MARKETCHECK_MAX_REQUEST_ATTEMPTS):
            failure: MarketProviderError | None = None
            failure_status: int | None = None
            transient = False
            retry_delay = MARKETCHECK_TRANSIENT_RETRY_DELAY_SECONDS
            if self.request_budget is not None:
                vin = (
                    endpoint.rsplit("/", 1)[-1]
                    if endpoint.startswith(f"{MARKETCHECK_VIN_HISTORY_URL}/")
                    else params.get("vin")
                )
                paced_seconds = 0.0
                for _ in range(100):
                    try:
                        self.request_budget.reserve_attempt(
                            endpoint, phase=request_phase or self._request_phase.get(),
                            vin=vin if isinstance(vin, str) else None,
                        )
                        break
                    except MarketProviderError as exc:
                        reason = getattr(exc, "reason_code", None)
                        delay = getattr(exc, "retry_after_seconds", None)
                        if (reason not in {"MARKET_ACCOUNT_RATE_LIMIT_REACHED", "MARKET_ACCOUNT_THROTTLED"}
                                or isinstance(delay, bool) or not isinstance(delay, (int, float))
                                or not math.isfinite(delay) or delay < 0
                                or paced_seconds + max(0.01, delay) > 60):
                            raise
                        delay = max(0.01, delay)
                        sleep(delay)
                        paced_seconds += delay
                else:
                    raise MarketProviderUnavailableError("MarketCheck account pacing could not obtain capacity")
            try:
                if request_counter is not None:
                    request_counter[0] += 1
                body = self._transport.get(
                    endpoint,
                    params,
                    {"Accept": "application/json"},
                    self._timeout,
                )
            except HTTPError as exc:
                status = exc.code
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if self.request_budget is not None:
                    self.request_budget.report_response(
                        status_code=status, retry_after=retry_after,
                        quota_exhausted=False,
                    )
                parsed_retry = _retry_after_seconds(retry_after)
                if parsed_retry is not None:
                    retry_delay = max(retry_delay, parsed_retry)
                try:
                    exc.close()
                except Exception:
                    pass
                if allow_history_page_exhaustion and status == 422:
                    return _HISTORY_PAGE_EXHAUSTED
                failure = self._http_error(status)
                failure_status = status
                transient = isinstance(
                    failure,
                    (MarketProviderRateLimitError, MarketProviderUnavailableError),
                )
            except (URLError, TimeoutError, ConnectionError, OSError):
                failure = MarketProviderUnavailableError(
                    "MarketCheck is temporarily unavailable"
                )
                transient = True
            except Exception:
                failure = MarketProviderUnavailableError(
                    "MarketCheck is temporarily unavailable"
                )

            if failure is None:
                break
            annotated = self._annotate_provider_failure(
                failure,
                params,
                endpoint,
                http_status=failure_status,
            )
            if (transient and attempt + 1 < MARKETCHECK_MAX_REQUEST_ATTEMPTS
                    and retry_delay <= 60):
                sleep(retry_delay)
                continue
            raise annotated

        if not isinstance(body, bytes):
            raise MarketProviderResponseError(
                "MarketCheck returned an unreadable response",
                diagnostic=self._provider_diagnostic(params, endpoint),
            )

        parse_failed = False
        payload: Any = None
        try:
            payload = json.loads(
                body.decode("utf-8"),
                parse_constant=_reject_nonstandard_number,
            )
        except (
            UnicodeDecodeError,
            json.JSONDecodeError,
            ValueError,
            RecursionError,
        ):
            parse_failed = True
        if parse_failed:
            raise MarketProviderResponseError(
                "MarketCheck returned malformed JSON",
                diagnostic=self._provider_diagnostic(params, endpoint),
            )
        return payload

    def _request_page(
        self,
        params: Mapping[str, QueryValue],
        *,
        endpoint: str = MARKETCHECK_ACTIVE_INVENTORY_URL,
    ) -> Mapping[str, Any]:
        payload = self._request_json(params, endpoint=endpoint)
        try:
            return _mapping(
                payload,
                "$",
                "MarketCheck response is malformed",
            )
        except MarketProviderError as exc:
            self._annotate_provider_failure(exc, params, endpoint)
            raise

    @staticmethod
    def _num_found(payload: Mapping[str, Any]) -> int | None:
        if "num_found" not in payload:
            return None
        value = payload["num_found"]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise MarketProviderResponseError(
                "MarketCheck response is malformed",
                ("$.num_found: expected a non-negative integer",),
            )
        return value

    def _listing_page(
        self,
        payload: Mapping[str, Any],
        *,
        start: int,
        rows: int,
    ) -> tuple[list[Any], int | None]:
        """Validate one search page without interpreting its listing records."""

        page_num_found = self._num_found(payload)
        raw_listings = payload.get("listings")
        if not isinstance(raw_listings, list):
            raise MarketProviderResponseError(
                "MarketCheck response is malformed",
                ("$.listings: expected an array",),
            )
        if len(raw_listings) > rows:
            raise MarketProviderResponseError(
                "MarketCheck response is malformed",
                ("$.listings: returned more records than requested",),
            )
        if (
            page_num_found is not None
            and raw_listings
            and start + len(raw_listings) > page_num_found
        ):
            raise MarketProviderResponseError(
                "MarketCheck response is malformed",
                ("$.num_found: smaller than the returned listing range",),
            )
        if (
            page_num_found is not None
            and raw_listings
            and len(raw_listings) < rows
            and start + len(raw_listings) < page_num_found
        ):
            raise MarketProviderResponseError(
                "MarketCheck response is malformed",
                ("$.listings: short page before num_found was exhausted",),
            )
        return raw_listings, page_num_found

    def _normalize_listing(
        self,
        value: Any,
        response_index: int,
        *,
        path_prefix: str = "$.listings",
        canonical_trim: str | None = None,
        configuration: VehicleConfigurationIdentity | None = None,
        source_endpoint_category: str | None = "active",
    ) -> MarketListing:
        path = f"{path_prefix}[{response_index}]"
        record = _mapping(
            value,
            path,
            "MarketCheck listing is malformed",
        )
        build = _mapping(
            record.get("build"),
            f"{path}.build",
            "MarketCheck listing is malformed",
        )
        if self._has_api_key_parameter(record.get("vdp_url")):
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )

        dealer_value = record.get("dealer")
        dealer: MarketDealer | None
        if dealer_value is None:
            dealer = None
        else:
            raw_dealer = _mapping(
                dealer_value,
                f"{path}.dealer",
                "MarketCheck listing is malformed",
            )
            dealer = MarketDealer(
                name=raw_dealer.get("name"),
                city=raw_dealer.get("city"),
                state=raw_dealer.get("state"),
                postal_code=raw_dealer.get("zip"),
            )

        verified_canonical_trim: str | None = None
        if canonical_trim is not None and configuration is not None:
            returned_value = build.get(configuration.field)
            if isinstance(returned_value, str):
                returned_key = " ".join(returned_value.split()).casefold()
                if returned_key in {
                    " ".join(value.split()).casefold()
                    for value in configuration.values
                }:
                    verified_canonical_trim = canonical_trim

        listing = MarketListing(
            source=self.name,
            source_listing_id=record.get("id"),
            listing_url=record.get("vdp_url"),
            year=build.get("year"),
            make=build.get("make"),
            model=build.get("model"),
            trim=(
                verified_canonical_trim
                if verified_canonical_trim is not None
                else build.get("trim")
            ),
            vin=record.get("vin"),
            mileage=record.get("miles"),
            price=record.get("price"),
            dealer=dealer,
            distance_miles=record.get("dist"),
            drivetrain=normalize_drivetrain(build.get("drivetrain")),
            drivetrain_recorded=True,
        )

        contract_error: MarketContractError | None = None
        try:
            validate_market_listing(listing)
        except MarketContractError as exc:
            contract_error = exc
        if contract_error is not None:
            details = tuple(
                self._redact(f"{path}{detail[1:]}")
                for detail in contract_error.details
            )
            raise MarketProviderResponseError(
                "MarketCheck listing could not be normalized to MarketListing",
                details,
            )

        if self._contains_secret(listing.to_dict()):
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )
        if source_endpoint_category is not None:
            self._remember_drivetrain_record(record, response_index, source_endpoint_category)
        return listing

    def _drivetrain_record(self, record: Mapping[str, Any], index: int,
                           endpoint_category: str, retrieved_at: str) -> dict[str, Any]:
        build = record.get("build")
        if not isinstance(build, Mapping):
            raise ValueError("Missing explicit build record")
        vin, vehicle = _lookup_identity(record.get("vin"), build.get("year"), build.get("make"), build.get("model"))
        raw = build.get("drivetrain")
        if raw is not None:
            _lookup_text(raw, 128)
        evidence = {
            "listingId": _lookup_text(record.get("id"), 512), "vin": vin,
            **vehicle, "rawDrivetrain": raw, "drivetrain": normalize_drivetrain(raw),
            "sourcePath": (f"$[{index}]" if endpoint_category == "history" else f"$.listings[{index}]") + ".build.drivetrain",
            "endpointCategory": endpoint_category, "retrievedAt": retrieved_at,
        }
        if self._contains_secret(evidence):
            raise ValueError("Unsafe provider specification evidence")
        return evidence

    def _remember_drivetrain_record(self, record: Mapping[str, Any], index: int,
                                    endpoint_category: str) -> None:
        """Retain only explicit safe build evidence without changing search output."""
        try:
            row = self._drivetrain_record(record, index, endpoint_category, _lookup_time())
        except (ValueError, TypeError):
            return
        if row["drivetrain"] is None:
            return
        if row["vin"] not in self._saved_drivetrain_evidence and len(self._saved_drivetrain_evidence) >= MARKETCHECK_SAVED_BUILD_MAX_IDENTITIES:
            self._saved_drivetrain_evidence.pop(next(iter(self._saved_drivetrain_evidence)))
        rows = self._saved_drivetrain_evidence.setdefault(row["vin"], [])
        if any(all(prior[key] == row[key] for key in row if key != "retrievedAt") for prior in rows):
            return
        if len(rows) < MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS:
            rows.append(row)
        elif not any(all(prior[key] == row[key] for key in ("year", "make", "model", "drivetrain")) for prior in rows):
            rows[-1] = row

    @staticmethod
    def _observation_text(value: Any) -> str | None:
        if not isinstance(value, str) or len(value) > 512:
            return None
        text = " ".join(value.split())
        if not text or _has_unsupported_provider_text_character(text):
            return None
        return text

    def _observation(
        self, listing: MarketListing, record: Mapping[str, Any], *,
        endpoint: str, relevant_date: str, supporting: bool,
        verified: bool, material_facts: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Project bounded facts; retain no unrestricted provider response."""

        build = record.get("build")
        build = build if isinstance(build, Mapping) else {}
        facts: dict[str, Any] = {}
        for public, raw in (
            ("bodyType", "body_type"), ("bodySubtype", "body_subtype"),
            ("powertrain", "powertrain_type"), ("engine", "engine"),
            ("fuelType", "fuel_type"), ("transmission", "transmission"),
            ("cylinders", "cylinders"), ("doors", "doors"),
            ("bedLength", "bed_length"), ("cabType", "cab_type"),
        ):
            value = build.get(raw)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                value = str(value)
            facts[public] = self._observation_text(value)
        certified = record.get("is_certified")
        facts["certified"] = True if certified == 1 else False if certified == 0 else None
        facts["warranty"] = record.get("warranty") if isinstance(record.get("warranty"), bool) else None
        equipment = build.get("options_packages")
        if isinstance(equipment, str):
            equipment = [equipment]
        normalized_equipment = (
            [self._observation_text(item) for item in equipment]
            if isinstance(equipment, list) and len(equipment) <= 100 else None
        )
        facts["equipment"] = (
            sorted(set(normalized_equipment))
            if normalized_equipment is not None and all(value is not None for value in normalized_equipment)
            else None
        )
        if material_facts is not None:
            # VIN build facts may be retained; dated selling benefits and
            # changing market facts must come from the history record.
            for key in ("bodyType", "bodySubtype", "powertrain", "engine", "fuelType",
                        "transmission", "cylinders", "doors", "bedLength", "cabType"):
                if facts[key] is None:
                    facts[key] = material_facts.get(key)
        dealer = record.get("dealer") if endpoint != "history" else record
        dealer = dealer if isinstance(dealer, Mapping) else {}

        def coordinate(names: tuple[str, ...], maximum: int) -> float | None:
            value = next((dealer[name] for name in names if name in dealer), None)
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    return None
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or abs(value) > maximum):
                return None
            return float(value)

        observation = {
            "listing": listing.to_dict(), "materialFacts": facts,
            "location": {
                "latitude": coordinate(("latitude", "lat"), 90),
                "longitude": coordinate(("longitude", "lng", "lon"), 180),
                "postalCode": self._observation_text(dealer.get("zip")),
                "city": self._observation_text(dealer.get("city")),
                "state": self._observation_text(dealer.get("state")),
                "source": "HISTORY_RECORD" if endpoint == "history" else "DISCOVERY_RECORD",
                "verified": False,
            },
            "sourceEndpoint": endpoint, "relevantDate": relevant_date,
            "stream": "current" if endpoint == "active" else "historical",
            "purpose": "supporting" if supporting else "baseline",
            "dateVerified": verified, "priceVerified": verified,
            "materialFactsSource": ("HISTORY_AND_VIN_BUILD" if material_facts is not None
                                    else "HISTORY_RECORD" if endpoint == "history" else "DISCOVERY_RECORD"),
        }
        if self._contains_secret(observation):
            raise MarketProviderResponseError("MarketCheck observation could not be safely normalized")
        return observation

    def discover_page(
        self, request: MarketSearchRequest, *, start: int = 0,
        rows: int = MARKETCHECK_MAX_ROWS, supporting: bool = False,
        center: Mapping[str, Any] | None = None,
    ) -> MarketCheckDiscoveryPage:
        """Fetch one explicitly sorted page without candidate or VIN fan-out."""

        return self._discover_page(request, start=start, rows=rows, supporting=supporting, center=center)

    def _discover_page(
        self, request: MarketSearchRequest | HistoricalMarketSearchRequest, *,
        start: int, rows: int, supporting: bool, historical: bool = False,
        center: Mapping[str, Any] | None = None,
    ) -> MarketCheckDiscoveryPage:
        if isinstance(start, bool) or not isinstance(start, int) or not 0 <= start < 10000:
            raise MarketContractError("Discovery offset must be between 0 and 9999")
        if isinstance(rows, bool) or not isinstance(rows, int) or not 1 <= rows <= MARKETCHECK_MAX_ROWS:
            raise MarketContractError("Discovery page size must be between 1 and 50")
        if not isinstance(supporting, bool):
            raise MarketContractError("Discovery purpose must be explicit")
        if historical:
            params = self._historical_params(request, start=start, rows=rows)
            endpoint = MARKETCHECK_PAST_INVENTORY_URL
            category = "recents"
        else:
            params = self._params(request, start=start, rows=rows)
            endpoint = MARKETCHECK_ACTIVE_INVENTORY_URL
            category = "active"
        if center is not None:
            for field, maximum in (("latitude", 90), ("longitude", 180)):
                value = center.get(field)
                if (isinstance(value, bool) or not isinstance(value, (int, float))
                        or not math.isfinite(value) or abs(value) > maximum):
                    raise MarketContractError("Discovery center requires valid coordinates")
                params[field] = str(value)
            params.pop("zip", None)
            self._enforce_search_radius(request.radius_miles)
            params["radius"] = request.radius_miles
        # Both endpoint references explicitly support dist/price sorting.
        params.update(sort_by="price" if supporting else "dist", sort_order="desc" if supporting else "asc")
        token = self._request_phase.set("supporting" if supporting else "baseline")
        try:
            payload = self._request_page(params, endpoint=endpoint)
        finally:
            self._request_phase.reset(token)
        records, total = self._listing_page(payload, start=start, rows=rows)
        listings: list[MarketListing] = []
        observations: list[Mapping[str, Any]] = []
        for offset, record in enumerate(records):
            listing = self._normalize_listing(
                record, start + offset,
                canonical_trim=request.trim if request.configuration is not None else None,
                configuration=request.configuration, source_endpoint_category=category,
            )
            listings.append(listing)
            observations.append(self._observation(
                listing, record, endpoint=category,
                relevant_date=request.evidence_date if historical else datetime.now(timezone.utc).date().isoformat(),
                supporting=supporting, verified=not historical,
            ))
        more = bool(records) and (start + len(records) < total if total is not None else len(records) == rows)
        return MarketCheckDiscoveryPage(tuple(listings), tuple(observations), start, rows, total, more)

    def saved_drivetrain(self, vin: str, *, year: int, make: str, model: str) -> dict[str, Any] | None:
        """Resolve cached raw build evidence without making a provider request."""
        vin, vehicle = _lookup_identity(vin, year, make, model)
        evidence = copy.deepcopy(self._saved_drivetrain_evidence.get(vin, []))
        if not evidence:
            return None
        key = (vin, year, vehicle["make"].casefold(), vehicle["model"].casefold())
        prior_lookup = self._drivetrain_lookup_cache.get(key)
        if prior_lookup is not None:
            for row in prior_lookup["evidence"]:
                if row["drivetrain"] is not None and not any(
                    all(prior[field] == row[field] for field in ("year", "make", "model", "drivetrain"))
                    for prior in evidence
                ):
                    if len(evidence) == MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS:
                        evidence.pop()
                    evidence.append(copy.deepcopy(row))
        if any(row["year"] != year or any(row[key].casefold() != vehicle[key].casefold() for key in ("make", "model")) for row in evidence):
            return _drivetrain_lookup_result(vin, vehicle, status="FAILED", reason="PROVIDER_IDENTITY_MISMATCH",
                                            evidence=[], lookup_source="SAVED_PROVIDER_EVIDENCE", request_count=0)
        values = {row["drivetrain"] for row in evidence}
        return _drivetrain_lookup_result(vin, vehicle,
            status="RESOLVED" if len(values) == 1 else "CONFLICT",
            reason="EXPLICIT_SAVED_PROVIDER_DRIVETRAIN" if len(values) == 1 else "CONFLICTING_EXPLICIT_DRIVETRAIN",
            evidence=evidence, lookup_source="SAVED_PROVIDER_EVIDENCE", request_count=0,
            retrieved_at=max(row["retrievedAt"] for row in evidence))

    def lookup_drivetrain(self, vin: str, *, year: int, make: str, model: str) -> dict[str, Any]:
        """Bounded exact-VIN specification lookup, independent of valuation inputs."""
        vin, vehicle = _lookup_identity(vin, year, make, model)
        key = (vin, year, vehicle["make"].casefold(), vehicle["model"].casefold())
        saved = self.saved_drivetrain(vin, **vehicle)
        if saved is not None:
            return saved
        if key in self._drivetrain_lookup_cache:
            cached = copy.deepcopy(self._drivetrain_lookup_cache[key])
            cached.update(cacheHit=True, providerRequestCount=0)
            return validate_drivetrain_lookup_result(cached)
        count = [0]
        evidence: list[dict[str, Any]] = []
        status, reason = "UNAVAILABLE", "NO_ACTIVE_LISTING_FOR_VIN"
        retrieved_at = _lookup_time()
        try:
            if self._api_key is None:
                raise MarketProviderAuthenticationError("MarketCheck API key is required")
            payload = self._request_json({
                "api_key": self._api_key, "append_api_key": "false", "vin": vin,
                "start": 0, "rows": MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS,
            }, request_counter=count, request_phase="enrichment")
            if not isinstance(payload, Mapping):
                raise ValueError("Invalid specification lookup response")
            records = payload.get("listings")
            total = self._num_found(payload)
            if (not isinstance(records, list) or len(records) > MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS
                    or total is None or total != len(records)):
                raise ValueError("Incomplete specification lookup response")
            retrieved_at = _lookup_time()
            for index, record in enumerate(records):
                if not isinstance(record, Mapping):
                    raise ValueError("Invalid specification record")
                row = self._drivetrain_record(record, index, "active", retrieved_at)
                if row["vin"] != vin or row["year"] != year or any(row[field].casefold() != vehicle[field].casefold() for field in ("make", "model")):
                    status, reason = "FAILED", "PROVIDER_IDENTITY_MISMATCH"
                    evidence = []
                    break
                evidence.append(row)
            else:
                values = {row["drivetrain"] for row in evidence if row["drivetrain"] is not None}
                if len(values) == 1:
                    status, reason = "RESOLVED", "EXPLICIT_ACTIVE_VIN_DRIVETRAIN"
                elif len(values) > 1:
                    status, reason = "CONFLICT", "CONFLICTING_EXPLICIT_DRIVETRAIN"
                elif records:
                    reason = "EXPLICIT_DRIVETRAIN_UNAVAILABLE"
        except MarketProviderAuthenticationError:
            status, reason, evidence = "FAILED", "PROVIDER_ACCESS_UNAVAILABLE", []
        except MarketProviderRateLimitError:
            status, reason, evidence = "FAILED", "PROVIDER_RATE_LIMITED", []
        except MarketProviderUnavailableError:
            status, reason, evidence = "FAILED", "PROVIDER_TEMPORARILY_UNAVAILABLE", []
        except (MarketProviderResponseError, ValueError, TypeError):
            status, reason, evidence = "FAILED", "PROVIDER_RESPONSE_INVALID", []
        result = _drivetrain_lookup_result(vin, vehicle, status=status, reason=reason,
                                          evidence=evidence, lookup_source="ACTIVE_VIN_LOOKUP",
                                          request_count=count[0], retrieved_at=retrieved_at)
        if len(self._drivetrain_lookup_cache) >= MARKETCHECK_SAVED_BUILD_MAX_IDENTITIES:
            self._drivetrain_lookup_cache.pop(next(iter(self._drivetrain_lookup_cache)))
        self._drivetrain_lookup_cache[key] = copy.deepcopy(result)
        return result

    def list_trims(
        self, request: VehicleTrimCatalogRequest
    ) -> tuple[VehicleTrimOption, ...]:
        """Return complete trim taxonomy for one exact year, make, and model."""

        if not isinstance(request, VehicleTrimCatalogRequest):
            raise TypeError("request must be VehicleTrimCatalogRequest")
        cache_key = "\0".join(
            (
                str(request.year),
                request.make.casefold(),
                request.model.casefold(),
            )
        )
        cached = self._trim_catalog_cache.get(cache_key)
        if cached is not None:
            return cached
        if self._api_key is None:
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )

        params: dict[str, QueryValue] = {
            "api_key": self._api_key,
            "append_api_key": "false",
            "field": (
                f"trim|0|{MARKETCHECK_MAX_TAXONOMY_TERMS},"
                f"version|0|{MARKETCHECK_MAX_TAXONOMY_TERMS},"
                f"fuel_type|0|{MARKETCHECK_MAX_TAXONOMY_TERMS}"
            ),
            "year": request.year,
            "make": request.make,
            "model": request.model,
        }
        payload = self._request_page(params, endpoint=MARKETCHECK_CAR_TERMS_URL)
        raw_trims = payload.get("trim")
        if (
            not isinstance(raw_trims, list)
            or len(raw_trims) > MARKETCHECK_MAX_TAXONOMY_TERMS
        ):
            raise MarketProviderResponseError(
                "MarketCheck trim taxonomy is malformed"
            )

        trim_terms: list[str] = []
        for index, value in enumerate(raw_trims):
            if not isinstance(value, str):
                raise MarketProviderResponseError(
                    "MarketCheck trim taxonomy is malformed",
                    (f"$.trim[{index}]: expected a string",),
                )
            term = " ".join(value.split())
            if (
                not term
                or len(term) > MAX_VEHICLE_CATALOG_TEXT_LENGTH
                or "," in term
                or _has_unsupported_provider_text_character(value)
            ):
                raise MarketProviderResponseError(
                    "MarketCheck trim taxonomy is malformed",
                    (f"$.trim[{index}]: expected a bounded non-blank string",),
                )
            trim_terms.append(term)
        if self._contains_secret(trim_terms):
            raise MarketProviderResponseError(
                "MarketCheck trim taxonomy could not be safely normalized"
            )

        version_terms: list[str] | None = None
        raw_versions = payload.get("version")
        if (
            isinstance(raw_versions, list)
            and raw_versions
            and len(raw_versions) <= MARKETCHECK_MAX_TAXONOMY_TERMS
        ):
            candidate_versions: list[str] = []
            for value in raw_versions:
                if not isinstance(value, str):
                    candidate_versions = []
                    break
                term = " ".join(value.split())
                if (
                    not term
                    or len(term) > MAX_VEHICLE_CATALOG_TEXT_LENGTH
                    or _has_unsupported_provider_text_character(value)
                ):
                    candidate_versions = []
                    break
                candidate_versions.append(term)
            if candidate_versions and not self._contains_secret(candidate_versions):
                version_terms = candidate_versions

        options: tuple[VehicleTrimOption, ...] | None = None
        if version_terms is not None:
            try:
                options = normalize_vehicle_trim_catalog(
                    trim_terms,
                    version_terms,
                    source="marketcheck",
                    battery_electric_only=_battery_electric_only(
                        payload.get("fuel_type")
                    ),
                    redundant_prefixes=(
                        f"{request.year} {request.make} {request.model}",
                        f"{request.make} {request.model}",
                        f"{request.year} {request.model}",
                        request.model,
                    ),
                )
            except VehicleTrimQueryValuesLimitError as exc:
                raise MarketProviderResponseError(
                    "MarketCheck trim taxonomy is malformed"
                ) from exc
            except (TypeError, ValueError):
                options = None
        if options is None:
            try:
                options = normalize_vehicle_trim_options(
                    trim_terms,
                    source="marketcheck",
                    query_field="trim",
                )
            except (TypeError, ValueError) as exc:
                raise MarketProviderResponseError(
                    "MarketCheck trim taxonomy is malformed"
                ) from exc
        if options is None:
            raise MarketProviderResponseError(
                "MarketCheck trim taxonomy is malformed"
            )
        if self._contains_secret(tuple(option.to_dict() for option in options)):
            raise MarketProviderResponseError(
                "MarketCheck trim taxonomy could not be safely normalized"
            )
        self._trim_catalog_cache[cache_key] = options
        return options

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        """Search active used inventory, preserving MarketCheck result order."""

        listings: list[MarketListing] = []
        start = 0
        known_num_found: int | None = None

        while len(listings) < request.result_limit:
            remaining = request.result_limit - len(listings)
            rows = min(MARKETCHECK_MAX_ROWS, remaining)
            if known_num_found is not None:
                available = known_num_found - start
                if available <= 0:
                    break
                rows = min(rows, available)

            params = self._params(request, start=start, rows=rows)
            try:
                payload = self._request_page(params)
                raw_listings, page_num_found = self._listing_page(
                    payload, start=start, rows=rows
                )
            except MarketProviderError as exc:
                self._annotate_provider_failure(
                    exc, params, MARKETCHECK_ACTIVE_INVENTORY_URL
                )
                raise
            if page_num_found is not None:
                known_num_found = page_num_found
            if not raw_listings:
                break

            try:
                for index, raw_listing in enumerate(raw_listings):
                    listings.append(
                        self._normalize_listing(
                            raw_listing,
                            start + index,
                            canonical_trim=(
                                request.trim
                                if request.configuration is not None
                                else None
                            ),
                            configuration=request.configuration,
                        )
                    )
            except MarketProviderError as exc:
                self._annotate_provider_failure(
                    exc, params, MARKETCHECK_ACTIVE_INVENTORY_URL
                )
                raise

            if len(listings) >= request.result_limit:
                break
            next_start = start + rows
            if known_num_found is not None and next_start >= known_num_found:
                break
            if len(raw_listings) < rows:
                break
            start = next_start

        return MarketSearchResult(
            provider=self.name,
            request=request,
            listings=tuple(listings),
        )


def _coerce_calendar_date(value: date | str, label: str) -> date:
    if isinstance(value, datetime) or not isinstance(value, (date, str)):
        raise MarketContractError(
            f"{label} must be an ISO calendar date",
            (f"$: expected YYYY-MM-DD, got {type(value).__name__}",),
        )
    if isinstance(value, date):
        return value
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise MarketContractError(
            f"{label} must be an ISO calendar date",
            ("$: expected YYYY-MM-DD",),
        ) from exc
    if parsed.isoformat() != value:
        raise MarketContractError(
            f"{label} must be an ISO calendar date",
            ("$: expected YYYY-MM-DD",),
        )
    return parsed


def marketcheck_historical_coverage(
    evidence_date: date | str,
    *,
    as_of_date: date | str | None = None,
) -> HistoricalCoverage:
    """Return deterministic MarketCheck coverage without making an API call."""

    evidence = _coerce_calendar_date(evidence_date, "Evidence date")
    current = (
        datetime.now(timezone.utc).date()
        if as_of_date is None
        else _coerce_calendar_date(as_of_date, "As-of date")
    )
    age_days = (current - evidence).days
    if age_days < 0:
        raise MarketContractError(
            "Historical market search request is in the future",
            ("$.evidenceDate: future evidence dates are not allowed",),
        )
    return HistoricalCoverage(
        status=(
            SUPPORTED
            if age_days <= MARKETCHECK_HISTORY_WINDOW_DAYS
            else OUT_OF_PROVIDER_RANGE
        ),
        history_window_days=MARKETCHECK_HISTORY_WINDOW_DAYS,
    )


@dataclass(frozen=True)
class _RecordInterval:
    first: datetime
    last: datetime
    source_first: datetime | None = None
    source_last: datetime | None = None


def _parse_iso_timestamp(value: Any) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("expected an ISO timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include an offset")
    return parsed.astimezone(timezone.utc)


def _parse_epoch_timestamp(value: Any) -> datetime:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("expected finite Unix seconds")
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _record_timestamp(
    record: Mapping[str, Any], stem: str
) -> tuple[datetime | None, str | None]:
    iso_key = f"{stem}_date"
    raw_iso = record.get(iso_key)
    raw_epoch = record.get(stem)
    has_iso = raw_iso is not None
    has_epoch = raw_epoch is not None
    if not has_iso and not has_epoch:
        return None, "MISSING_RECORD_TIMESTAMPS"

    parsed_iso: datetime | None = None
    parsed_epoch: datetime | None = None
    try:
        if has_iso:
            parsed_iso = _parse_iso_timestamp(raw_iso)
        if has_epoch:
            parsed_epoch = _parse_epoch_timestamp(raw_epoch)
    except (ValueError, OverflowError, OSError):
        return None, "MALFORMED_RECORD_TIMESTAMPS"

    if (
        parsed_iso is not None
        and parsed_epoch is not None
        and abs((parsed_iso - parsed_epoch).total_seconds()) >= 1
    ):
        return None, "INCONSISTENT_RECORD_TIMESTAMPS"
    return parsed_iso if parsed_iso is not None else parsed_epoch, None


def _record_interval(
    record: Mapping[str, Any],
) -> tuple[_RecordInterval | None, str | None]:
    first, first_error = _record_timestamp(record, "first_seen_at")
    last, last_error = _record_timestamp(record, "last_seen_at")
    errors = {error for error in (first_error, last_error) if error is not None}
    for reason in (
        "INCONSISTENT_RECORD_TIMESTAMPS",
        "MALFORMED_RECORD_TIMESTAMPS",
        "MISSING_RECORD_TIMESTAMPS",
    ):
        if reason in errors:
            return None, reason
    if first is None or last is None:
        return None, "MISSING_RECORD_TIMESTAMPS"
    if first > last:
        return None, "INVALID_RECORD_INTERVAL"

    source_first_present = any(
        record.get(key) is not None
        for key in ("first_seen_at_source", "first_seen_at_source_date")
    )
    source_last_present = any(
        record.get(key) is not None
        for key in ("last_seen_at_source", "last_seen_at_source_date")
    )
    source_first: datetime | None = None
    source_last: datetime | None = None
    source_errors: set[str] = set()
    if source_first_present:
        source_first, error = _record_timestamp(record, "first_seen_at_source")
        if error == "MALFORMED_RECORD_TIMESTAMPS":
            source_errors.add("MALFORMED_SOURCE_TIMESTAMPS")
        elif error == "INCONSISTENT_RECORD_TIMESTAMPS":
            source_errors.add("INCONSISTENT_SOURCE_TIMESTAMPS")
    if source_last_present:
        source_last, error = _record_timestamp(record, "last_seen_at_source")
        if error == "MALFORMED_RECORD_TIMESTAMPS":
            source_errors.add("MALFORMED_SOURCE_TIMESTAMPS")
        elif error == "INCONSISTENT_RECORD_TIMESTAMPS":
            source_errors.add("INCONSISTENT_SOURCE_TIMESTAMPS")
    for reason in (
        "INCONSISTENT_SOURCE_TIMESTAMPS",
        "MALFORMED_SOURCE_TIMESTAMPS",
    ):
        if reason in source_errors:
            return None, reason
    if (
        source_first is not None
        and source_last is not None
        and source_first > source_last
    ):
        return None, "INVALID_SOURCE_INTERVAL"
    if source_first is not None and first < source_first:
        return None, "RECORD_OUTSIDE_SOURCE_INTERVAL"
    if source_last is not None and last > source_last:
        return None, "RECORD_OUTSIDE_SOURCE_INTERVAL"
    return _RecordInterval(
        first=first,
        last=last,
        source_first=source_first,
        source_last=source_last,
    ), None


def _normalized_timestamp(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="auto")
        .replace("+00:00", "Z")
    )


@dataclass(frozen=True)
class _HistoricalCandidate:
    response_index: int
    vin: str
    listing: MarketListing


@dataclass(frozen=True)
class _VinHistoryFetchOutcome:
    records: tuple[Mapping[str, Any], ...]
    issue: HistoricalEvidenceIssue | None = None


class MarketCheckHistoricalProvider(MarketCheckProvider):
    """Discover dated candidate VINs and verify them with VIN History.

    Past Inventory Search supplies a complete, bounded candidate VIN universe.
    Each candidate is then resolved from the separate VIN History endpoint.
    Only the history record's price and record-level lifecycle can establish
    evidence for the requested calendar date.
    """

    maximum_search_radius_miles = MARKETCHECK_PAST_MAX_RADIUS_MILES

    def __init__(
        self,
        api_key: str | None = None,
        *,
        as_of_date: date | str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: MarketCheckTransport | None = None,
        max_vin_verifications: int = MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS,
        maximum_search_radius_miles: int | None = None,
        request_budget: Any = None,
    ) -> None:
        if (
            isinstance(max_vin_verifications, bool)
            or not isinstance(max_vin_verifications, int)
            or max_vin_verifications < 0
        ):
            raise ValueError(
                "MarketCheck maximum VIN verifications must be a non-negative "
                "integer"
            )
        super().__init__(
            api_key,
            timeout=timeout,
            transport=transport,
            maximum_search_radius_miles=maximum_search_radius_miles,
            request_budget=request_budget,
            _allow_missing_api_key=True,
        )
        self.maximum_search_radius_miles = min(
            self.maximum_search_radius_miles, MARKETCHECK_PAST_MAX_RADIUS_MILES
        )
        self._as_of_date = (
            datetime.now(timezone.utc).date()
            if as_of_date is None
            else _coerce_calendar_date(as_of_date, "As-of date")
        )
        self._max_vin_verifications = max_vin_verifications
        self._vin_history_cache: dict[str, _VinHistoryFetchOutcome] = {}
        self._bounded_history: ContextVar[bool] = ContextVar(
            f"marketcheck_bounded_history_{id(self)}", default=False
        )

    def __repr__(self) -> str:
        return (
            "MarketCheckHistoricalProvider("
            f"as_of_date={self._as_of_date.isoformat()!r}, "
            f"timeout={self._timeout!r}, "
            f"max_vin_verifications={self._max_vin_verifications!r})"
        )

    def begin_historical_search_session(self) -> None:
        """Start one analysis-scoped VIN cache and verification budget."""

        self._vin_history_cache.clear()

    def discover_page(
        self, request: HistoricalMarketSearchRequest, *, start: int = 0,
        rows: int = MARKETCHECK_MAX_ROWS, supporting: bool = False,
        center: Mapping[str, Any] | None = None,
    ) -> MarketCheckDiscoveryPage:
        """Discover dated candidates without fetching any VIN histories."""

        request.to_market_search_request()
        coverage = marketcheck_historical_coverage(request.evidence_date, as_of_date=self._as_of_date)
        if coverage.status == OUT_OF_PROVIDER_RANGE:
            return MarketCheckDiscoveryPage((), (), start, rows, 0, False)
        return self._discover_page(
            request, start=start, rows=rows, supporting=supporting,
            center=center, historical=True,
        )

    def verify_historical_candidates(
        self, request: HistoricalMarketSearchRequest,
        listings: Sequence[MarketListing], *,
        max_history_pages: int = MARKETCHECK_BOUNDED_VIN_HISTORY_MAX_PAGES,
        observations: Sequence[Mapping[str, Any]] = (), supporting: bool = False,
    ) -> MarketCheckVerifiedBatch:
        """Verify a caller-ranked batch while preserving earlier valid evidence."""

        if (isinstance(max_history_pages, bool) or not isinstance(max_history_pages, int)
                or not 1 <= max_history_pages <= MARKETCHECK_VIN_HISTORY_MAX_PAGES):
            raise MarketContractError("VIN history pages must be between 1 and 10")
        request.to_market_search_request()
        coverage = marketcheck_historical_coverage(request.evidence_date, as_of_date=self._as_of_date)
        if coverage.status == OUT_OF_PROVIDER_RANGE:
            return MarketCheckVerifiedBatch(self._result(request, coverage), ())
        facts_by_identity = {
            (row["listing"].get("vin"), row["listing"].get("sourceListingId")): row.get("materialFacts", {})
            for row in observations if isinstance(row.get("listing"), Mapping)
        }
        evidence: list[HistoricalEvidenceItem] = []
        issues: list[HistoricalEvidenceIssue] = []
        verified_observations: list[Mapping[str, Any]] = []
        failure: MarketProviderError | None = None
        seen: set[str] = set()
        token = self._request_phase.set("supporting" if supporting else "baseline")
        bounded_token = self._bounded_history.set(True)
        try:
            for index, listing in enumerate(listings):
                validate_market_listing(listing)
                if listing.vin is None:
                    issues.append(HistoricalEvidenceIssue(status=UNRESOLVED, reason="MISSING_LISTING_IDENTITY"))
                    continue
                identity = listing.vin.casefold()
                if identity in seen:
                    continue
                seen.add(identity)
                candidate = _HistoricalCandidate(index, listing.vin, listing)
                try:
                    outcome = self._vin_history_outcome(candidate, max_history_pages=max_history_pages)
                    if outcome is None:
                        issues.append(HistoricalEvidenceIssue(status=UNRESOLVED, reason="CANDIDATE_VERIFICATION_LIMIT_REACHED"))
                        break
                    if outcome.issue is not None:
                        issues.append(outcome.issue)
                        continue
                    item, issue = self._resolve_vin_history(
                        candidate, list(outcome.records), request,
                        strict_location=True, observation_output=verified_observations,
                        material_facts=facts_by_identity.get((listing.vin, listing.source_listing_id)),
                        supporting=supporting,
                    )
                    if item is not None:
                        evidence.append(item)
                    if issue is not None:
                        issues.append(issue)
                except MarketProviderError as exc:
                    failure = exc
                    break
        finally:
            self._request_phase.reset(token)
            self._bounded_history.reset(bounded_token)
        return MarketCheckVerifiedBatch(
            self._result(request, coverage, evidence, issues),
            tuple(verified_observations), failure,
        )

    def _historical_params(
        self,
        request: HistoricalMarketSearchRequest,
        *,
        start: int,
        rows: int,
    ) -> dict[str, QueryValue]:
        if self._api_key is None:
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )
        self._enforce_search_radius(
            request.radius_miles,
            maximum_radius_miles=min(
                self.maximum_search_radius_miles, MARKETCHECK_PAST_MAX_RADIUS_MILES
            ),
        )
        compact_date = request.evidence_date.replace("-", "")
        params: dict[str, QueryValue] = {
            "api_key": self._api_key,
            "append_api_key": "false",
            "car_type": "used",
            "has_price": "true",
            "year": request.year,
            "make": request.make,
            "model": request.model,
            "zip": request.postal_code,
            "radius": request.radius_miles,
            "active_inventory_date_range": f"{compact_date}-{compact_date}",
            "start": start,
            "rows": rows,
        }
        if request.configuration is not None:
            if request.configuration.source != self.name:
                raise MarketContractError(
                    "Vehicle configuration source is incompatible with MarketCheck"
                )
            params[request.configuration.field] = ",".join(
                request.configuration.values
            )
        elif request.trim is not None:
            params["trim"] = request.trim
        drivetrain_filter = self._discovery_drivetrain_filter(request)
        if drivetrain_filter is not None:
            params["drivetrain"] = drivetrain_filter
        return params

    def _vin_history_params(self, *, page: int) -> dict[str, QueryValue]:
        if self._api_key is None:
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )
        params: dict[str, QueryValue] = {
            "api_key": self._api_key,
            "page": page,
            "sort_order": "desc",
        }
        if self._bounded_history.get():
            params["fields"] = (
                "id,vin,price,miles,vdp_url,seller_type,inventory_type,status_date,"
                "last_seen_at,last_seen_at_date,first_seen_at,first_seen_at_date,"
                "source,seller_name,city,state,zip,is_certified,latitude,longitude"
            )
        return params

    @staticmethod
    def _safe_identity_value(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _context_value(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = " ".join(value.split()).casefold()
        return normalized or None

    def _candidate_from_record(
        self,
        value: Any,
        response_index: int,
        *,
        canonical_trim: str | None = None,
        configuration: VehicleConfigurationIdentity | None = None,
    ) -> tuple[_HistoricalCandidate | None, HistoricalEvidenceIssue | None]:
        path = f"$.listings[{response_index}]"
        record = _mapping(
            value,
            path,
            "MarketCheck listing is malformed",
        )
        vin = self._safe_identity_value(record.get("vin"))
        if vin is None:
            return None, HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason="MISSING_LISTING_IDENTITY",
            )
        if self._contains_secret(vin):
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )
        listing = self._normalize_listing(
            record,
            response_index,
            canonical_trim=canonical_trim,
            configuration=configuration,
            source_endpoint_category="recents",
        )
        if listing.vin is None:
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )
        return (
            _HistoricalCandidate(
                response_index=response_index,
                vin=listing.vin,
                listing=listing,
            ),
            None,
        )

    def _discover_historical_candidates(
        self,
        request: HistoricalMarketSearchRequest,
    ) -> tuple[
        list[_HistoricalCandidate],
        list[tuple[int, HistoricalEvidenceIssue]],
        str | None,
    ]:
        page_rows = min(
            MARKETCHECK_MAX_ROWS,
            max(MARKETCHECK_HISTORICAL_MIN_ROWS, request.result_limit),
        )
        candidates: list[_HistoricalCandidate] = []
        issues: list[tuple[int, HistoricalEvidenceIssue]] = []
        seen_vins: set[str] = set()
        start = 0
        known_num_found: int | None = None
        pages = 0
        consumed = 0
        last_page_size = 0
        last_rows = page_rows

        while pages < MARKETCHECK_HISTORICAL_MAX_PAGES:
            rows = page_rows
            if known_num_found is not None:
                available = known_num_found - start
                if available <= 0:
                    break
                rows = min(rows, available)
            params = self._historical_params(request, start=start, rows=rows)
            try:
                payload = self._request_page(
                    params,
                    endpoint=MARKETCHECK_PAST_INVENTORY_URL,
                )
                page, page_num_found = self._listing_page(
                    payload,
                    start=start,
                    rows=rows,
                )
            except MarketProviderError as exc:
                self._annotate_provider_failure(
                    exc, params, MARKETCHECK_PAST_INVENTORY_URL
                )
                raise
            pages += 1
            last_page_size = len(page)
            last_rows = rows
            if (
                known_num_found is not None
                and page_num_found is not None
                and page_num_found != known_num_found
            ):
                return candidates, issues, "INCOMPLETE_PROVIDER_PAGINATION"
            if page_num_found is not None:
                known_num_found = page_num_found
            try:
                for offset, raw_candidate in enumerate(page):
                    response_index = start + offset
                    candidate, issue = self._candidate_from_record(
                        raw_candidate,
                        response_index,
                        canonical_trim=(
                            request.trim
                            if request.configuration is not None
                            else None
                        ),
                        configuration=request.configuration,
                    )
                    if issue is not None:
                        issues.append((response_index, issue))
                        continue
                    assert candidate is not None
                    identity = candidate.vin.casefold()
                    if identity not in seen_vins:
                        seen_vins.add(identity)
                        candidates.append(candidate)
            except MarketProviderError as exc:
                self._annotate_provider_failure(
                    exc, params, MARKETCHECK_PAST_INVENTORY_URL
                )
                raise
            consumed += len(page)
            if not page:
                break
            next_start = start + rows
            if known_num_found is not None and next_start >= known_num_found:
                break
            if len(page) < rows:
                break
            start = next_start

        more_records_possible = (
            known_num_found is not None and consumed < known_num_found
        ) or (known_num_found is None and last_page_size == last_rows)
        if not more_records_possible:
            return candidates, issues, None
        reason = (
            "PAGINATION_SAFETY_LIMIT_REACHED"
            if pages >= MARKETCHECK_HISTORICAL_MAX_PAGES
            else "INCOMPLETE_PROVIDER_PAGINATION"
        )
        return candidates, issues, reason

    def _request_vin_history_page(
        self,
        vin: str,
        *,
        page: int,
    ) -> list[Mapping[str, Any]] | object:
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{quote(vin, safe='')}"
        params = self._vin_history_params(page=page)
        payload = self._request_json(
            params,
            endpoint=endpoint,
            allow_history_page_exhaustion=page > 1,
        )
        if payload is _HISTORY_PAGE_EXHAUSTED:
            return payload
        try:
            if not isinstance(payload, list):
                raise MarketProviderResponseError(
                    "MarketCheck VIN history response is malformed",
                    ("$: expected an array",),
                )
            if len(payload) > MARKETCHECK_VIN_HISTORY_PAGE_SIZE:
                raise MarketProviderResponseError(
                    "MarketCheck VIN history response is malformed",
                    ("$: returned more than 50 records",),
                )
            return [
                _mapping(
                    value,
                    f"$[{index}]",
                    "MarketCheck VIN history response is malformed",
                )
                for index, value in enumerate(payload)
            ]
        except MarketProviderError as exc:
            self._annotate_provider_failure(exc, params, endpoint)
            raise

    def _fetch_vin_history(
        self,
        candidate: _HistoricalCandidate,
        *, max_history_pages: int = MARKETCHECK_VIN_HISTORY_MAX_PAGES,
    ) -> tuple[list[Mapping[str, Any]], HistoricalEvidenceIssue | None]:
        records: list[Mapping[str, Any]] = []

        for page_number in range(1, max_history_pages + 1):
            page = self._request_vin_history_page(
                candidate.vin,
                page=page_number,
            )
            if page is _HISTORY_PAGE_EXHAUSTED:
                return records, None
            assert isinstance(page, list)
            for index, record in enumerate(page):
                if isinstance(record, Mapping):
                    self._remember_drivetrain_record(record, len(records) + index, "history")
            records.extend(page)

            if len(page) < MARKETCHECK_VIN_HISTORY_PAGE_SIZE:
                return records, None

        return records, HistoricalEvidenceIssue(
            status=UNRESOLVED,
            reason="PAGINATION_SAFETY_LIMIT_REACHED",
            vin=candidate.vin,
        )

    def _vin_history_outcome(
        self,
        candidate: _HistoricalCandidate,
        *, max_history_pages: int = MARKETCHECK_VIN_HISTORY_MAX_PAGES,
    ) -> _VinHistoryFetchOutcome | None:
        """Reuse one VIN fetch or decline a new fetch after the hard budget."""

        identity = candidate.vin.casefold()
        cached = self._vin_history_cache.get(identity)
        if cached is not None:
            return cached
        if len(self._vin_history_cache) >= self._max_vin_verifications:
            return None

        records, issue = self._fetch_vin_history(candidate, max_history_pages=max_history_pages)
        outcome = _VinHistoryFetchOutcome(tuple(records), issue)
        self._vin_history_cache[identity] = outcome
        return outcome

    def _validate_history_record_vin(
        self,
        record: Mapping[str, Any],
        candidate: _HistoricalCandidate,
    ) -> None:
        if "vin" not in record:
            return
        vin = self._safe_identity_value(record.get("vin"))
        if (
            vin is None
            or self._contains_secret(vin)
            or vin.casefold() != candidate.vin.casefold()
        ):
            raise MarketProviderResponseError(
                "MarketCheck VIN history response is inconsistent",
                ("$.vin: does not match the requested candidate VIN",),
            )

    def _history_listing_id_matches_candidate(
        self,
        record: Mapping[str, Any],
        candidate: _HistoricalCandidate,
    ) -> bool:
        history_id = self._safe_identity_value(record.get("id"))
        return (
            history_id is not None
            and candidate.listing.source_listing_id is not None
            and history_id == candidate.listing.source_listing_id
        )

    def _history_search_qualification(
        self,
        record: Mapping[str, Any],
        candidate: _HistoricalCandidate,
    ) -> str:
        inventory_type = self._context_value(record.get("inventory_type"))
        seller_type = self._context_value(record.get("seller_type"))
        if (
            inventory_type is not None and inventory_type != "used"
        ) or (
            seller_type is not None and seller_type != "dealer"
        ):
            return (
                _HISTORY_RECORD_UNVERIFIABLE
                if self._history_listing_id_matches_candidate(record, candidate)
                else _HISTORY_RECORD_IRRELEVANT
            )
        if inventory_type is None or seller_type is None:
            return _HISTORY_RECORD_UNVERIFIABLE
        return _HISTORY_RECORD_MATCHED

    def _history_context_qualification(
        self,
        record: Mapping[str, Any],
        candidate: _HistoricalCandidate,
    ) -> str:
        listing_id_match = self._history_listing_id_matches_candidate(
            record,
            candidate,
        )
        dealer = candidate.listing.dealer
        candidate_context = (
            (dealer.name, dealer.city, dealer.state, dealer.postal_code)
            if dealer is not None
            else (None, None, None, None)
        )
        history_context = (
            record.get("seller_name"),
            record.get("city"),
            record.get("state"),
            record.get("zip"),
        )
        context_matches = 0
        malformed_context = False
        for candidate_value, history_value in zip(
            candidate_context,
            history_context,
        ):
            normalized_candidate = self._context_value(candidate_value)
            normalized_history = self._context_value(history_value)
            if history_value is not None and normalized_history is None:
                malformed_context = True
                continue
            if normalized_candidate is None or normalized_history is None:
                continue
            if normalized_candidate != normalized_history:
                return (
                    _HISTORY_RECORD_UNVERIFIABLE
                    if listing_id_match
                    else _HISTORY_RECORD_IRRELEVANT
                )
            context_matches += 1
        if malformed_context:
            return _HISTORY_RECORD_UNVERIFIABLE
        if listing_id_match or context_matches >= 2:
            return _HISTORY_RECORD_MATCHED
        return _HISTORY_RECORD_UNVERIFIABLE

    def _normalize_vin_history_listing(
        self,
        record: Mapping[str, Any],
        response_index: int,
        candidate: _HistoricalCandidate,
        *,
        history_drivetrain: str | None = None,
        strict_location: bool = False,
    ) -> MarketListing:
        dealer_fields = {
            "name": record.get("seller_name"),
            "city": record.get("city"),
            "state": record.get("state"),
            "zip": record.get("zip"),
        }
        dealer: Mapping[str, Any] | None = (
            dealer_fields
            if any(value is not None for value in dealer_fields.values())
            else None
        )
        adapted = {
            "id": record.get("id"),
            "vin": candidate.vin,
            "price": record.get("price"),
            "miles": record.get("miles"),
            "vdp_url": record.get("vdp_url"),
            "dealer": dealer,
            "build": {
                "year": candidate.listing.year,
                "make": candidate.listing.make,
                "model": candidate.listing.model,
                "trim": candidate.listing.trim,
                "drivetrain": history_drivetrain or candidate.listing.drivetrain,
            },
            "dist": None if strict_location else candidate.listing.distance_miles,
        }
        return self._normalize_listing(
            adapted,
            response_index,
            path_prefix="$",
            source_endpoint_category=None,
        )

    def _resolve_vin_history(
        self,
        candidate: _HistoricalCandidate,
        raw_records: list[Mapping[str, Any]],
        request: HistoricalMarketSearchRequest,
        *, strict_location: bool = False,
        observation_output: list[Mapping[str, Any]] | None = None,
        material_facts: Mapping[str, Any] | None = None,
        supporting: bool = False,
    ) -> tuple[HistoricalEvidenceItem | None, HistoricalEvidenceIssue | None]:
        evidence_day = date.fromisoformat(request.evidence_date)
        day_start = datetime.combine(evidence_day, time.min, tzinfo=timezone.utc)
        next_day = day_start + timedelta(days=1)

        intervals: list[
            tuple[int, Mapping[str, Any], _RecordInterval | None, str]
        ] = []
        for index, record in enumerate(raw_records):
            self._validate_history_record_vin(record, candidate)
            search_qualification = self._history_search_qualification(
                record,
                candidate,
            )
            context_qualification = self._history_context_qualification(
                record,
                candidate,
            )
            if _HISTORY_RECORD_IRRELEVANT in {
                search_qualification,
                context_qualification,
            }:
                continue
            first, first_error = _record_timestamp(record, "first_seen_at")
            last, last_error = _record_timestamp(record, "last_seen_at")
            if first is not None and last is not None and first > last:
                return None, HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason="INVALID_RECORD_INTERVAL",
                    vin=candidate.vin,
                )
            if last is not None and last < day_start:
                if (
                    search_qualification == _HISTORY_RECORD_MATCHED
                    and context_qualification == _HISTORY_RECORD_MATCHED
                ):
                    intervals.append((index, record, None, "before"))
                continue
            if first is not None and first >= next_day:
                if (
                    search_qualification == _HISTORY_RECORD_MATCHED
                    and context_qualification == _HISTORY_RECORD_MATCHED
                ):
                    intervals.append((index, record, None, "after"))
                continue
            if _HISTORY_RECORD_UNVERIFIABLE in {
                search_qualification,
                context_qualification,
            }:
                return None, HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason="UNVERIFIABLE_RECORD_CONTEXT",
                    vin=candidate.vin,
                )
            errors = {
                error
                for error in (first_error, last_error)
                if error is not None
            }
            error = next(
                (
                    reason
                    for reason in (
                        "INCONSISTENT_RECORD_TIMESTAMPS",
                        "MALFORMED_RECORD_TIMESTAMPS",
                        "MISSING_RECORD_TIMESTAMPS",
                    )
                    if reason in errors
                ),
                None,
            )
            if error is not None:
                return None, HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason=error,
                    vin=candidate.vin,
                )
            interval, error = _record_interval(record)
            if error is not None:
                return None, HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason=error,
                    vin=candidate.vin,
                )
            assert interval is not None
            intervals.append((index, record, interval, "overlap"))

        if not intervals:
            return None, HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason="NO_RECORD_ACTIVE_ON_EVIDENCE_DATE",
                vin=candidate.vin,
            )

        overlapping = [item for item in intervals if item[3] == "overlap"]
        if not overlapping:
            relations = {item[3] for item in intervals}
            reason = (
                "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE"
                if relations == {"before"}
                else "RECORD_INTERVAL_AFTER_EVIDENCE_DATE"
                if relations == {"after"}
                else "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE"
            )
            return None, HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason=reason,
                vin=candidate.vin,
            )

        distinct: list[
            tuple[int, Mapping[str, Any], _RecordInterval | None, str]
        ] = []
        for item in overlapping:
            if not any(item[1] == existing[1] for existing in distinct):
                distinct.append(item)
        if len(distinct) != 1:
            return None, HistoricalEvidenceIssue(
                status=AMBIGUOUS,
                reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                vin=candidate.vin,
            )

        selected_index, record, interval, _ = distinct[0]
        assert interval is not None
        listing_id = self._safe_identity_value(record.get("id"))
        if listing_id is None:
            return None, HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason="MISSING_LISTING_IDENTITY",
                vin=candidate.vin,
            )
        if self._contains_secret(listing_id):
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )
        history_drivetrain = None
        if request.drivetrain_discovery is not None:
            build = record.get("build")
            history_drivetrain = (
                normalize_drivetrain(build.get("drivetrain"))
                if isinstance(build, Mapping)
                else None
            )
            if (
                history_drivetrain is not None
                and candidate.listing.drivetrain is not None
                and history_drivetrain != candidate.listing.drivetrain
            ):
                return None, HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason="VEHICLE_CONFIGURATION_CONFLICT",
                    vin=candidate.vin,
                    source_listing_id=listing_id,
                )
        listing = self._normalize_vin_history_listing(
            record,
            selected_index,
            candidate,
            history_drivetrain=history_drivetrain,
            strict_location=strict_location,
        )
        item = HistoricalEvidenceItem(
            listing=listing,
            temporal_evidence=TemporalEvidence(
                evidence_date=request.evidence_date,
                record_first_seen_at=_normalized_timestamp(interval.first),
                record_last_seen_at=_normalized_timestamp(interval.last),
                source_first_seen_at=(
                    _normalized_timestamp(interval.source_first)
                    if interval.source_first is not None
                    else None
                ),
                source_last_seen_at=(
                    _normalized_timestamp(interval.source_last)
                    if interval.source_last is not None
                    else None
                ),
            ),
        )
        if observation_output is not None:
            observation = self._observation(
                listing, record, endpoint="history", relevant_date=request.evidence_date,
                supporting=supporting, verified=True, material_facts=material_facts,
            )
            observation["historicalEvidence"] = item.to_dict()
            observation_output.append(observation)
        return item, None

    def _result(
        self,
        request: HistoricalMarketSearchRequest,
        coverage: HistoricalCoverage,
        evidence: list[HistoricalEvidenceItem] | None = None,
        issues: list[HistoricalEvidenceIssue] | None = None,
    ) -> HistoricalMarketSearchResult:
        result = HistoricalMarketSearchResult(
            provider=self.name,
            evidence_date=request.evidence_date,
            as_of_date=self._as_of_date.isoformat(),
            coverage=coverage,
            request=request,
            evidence=tuple(evidence or ()),
            issues=tuple(issues or ()),
        )
        validate_historical_market_search_result(result)
        if self._contains_secret(result.to_dict()):
            raise MarketProviderResponseError(
                "MarketCheck response could not be safely normalized"
            )
        return result

    def _limit_resolved_evidence(
        self,
        request: HistoricalMarketSearchRequest,
        evidence: list[HistoricalEvidenceItem],
    ) -> list[HistoricalEvidenceItem]:
        if len(evidence) <= request.result_limit:
            return evidence
        market_request = request.to_market_search_request()
        market_result = MarketSearchResult(
            provider=self.name,
            request=market_request,
            listings=tuple(item.listing for item in evidence),
        )
        ranking = rank_market_comparables(
            comparable_target_from_search_request(market_request),
            market_result,
        )
        items_by_listing = {id(item.listing): item for item in evidence}
        return [
            items_by_listing[id(candidate.listing)]
            for candidate in ranking.candidates[: request.result_limit]
        ]

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        """Discover all bounded candidates, then verify every candidate VIN."""

        coverage = marketcheck_historical_coverage(
            request.evidence_date,
            as_of_date=self._as_of_date,
        )
        if coverage.status == OUT_OF_PROVIDER_RANGE:
            return self._result(request, coverage)
        if self._api_key is None:
            raise MarketProviderAuthenticationError(
                "MarketCheck API key is required"
            )

        candidates, issue_rows, pagination_failure = (
            self._discover_historical_candidates(request)
        )
        if pagination_failure is not None:
            issues = [issue for _, issue in sorted(issue_rows)]
            issues.append(
                HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason=pagination_failure,
                )
            )
            return self._result(request, coverage, issues=issues)

        resolved_rows: list[tuple[int, HistoricalEvidenceItem]] = []
        verification_limit_reached = False
        for candidate in candidates:
            try:
                outcome = self._vin_history_outcome(candidate)
                if outcome is None:
                    verification_limit_reached = True
                    continue
                if outcome.issue is not None:
                    issue_rows.append((candidate.response_index, outcome.issue))
                    continue
                evidence, issue = self._resolve_vin_history(
                    candidate,
                    list(outcome.records),
                    request,
                )
            except MarketProviderError as exc:
                exc.with_diagnostic(
                    MarketProviderDiagnostic(endpoint_category="history")
                )
                raise
            if evidence is not None:
                resolved_rows.append((candidate.response_index, evidence))
            if issue is not None:
                issue_rows.append((candidate.response_index, issue))

        resolved_rows.sort(key=lambda item: item[0])
        issue_rows.sort(key=lambda item: item[0])
        resolved = self._limit_resolved_evidence(
            request,
            [item for _, item in resolved_rows],
        )
        issues = [item for _, item in issue_rows]
        if verification_limit_reached:
            issues.append(
                HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason="CANDIDATE_VERIFICATION_LIMIT_REACHED",
                )
            )
        return self._result(request, coverage, resolved, issues)


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MARKETCHECK_ACTIVE_INVENTORY_URL",
    "MARKETCHECK_ACTIVE_MAX_RADIUS_MILES",
    "MARKETCHECK_CAR_TERMS_URL",
    "MARKETCHECK_HISTORICAL_MAX_PAGES",
    "MARKETCHECK_HISTORICAL_MIN_ROWS",
    "MARKETCHECK_HISTORY_WINDOW_DAYS",
    "MARKETCHECK_MAX_REQUEST_ATTEMPTS",
    "MARKETCHECK_MAX_ROWS",
    "MARKETCHECK_MAX_TAXONOMY_TERMS",
    "MARKETCHECK_PAST_INVENTORY_URL",
    "MARKETCHECK_PAST_MAX_RADIUS_MILES",
    "MARKETCHECK_TRANSIENT_RETRY_DELAY_SECONDS",
    "MARKETCHECK_VIN_HISTORY_MAX_PAGES",
    "MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS",
    "MARKETCHECK_BOUNDED_VIN_HISTORY_MAX_PAGES",
    "MARKETCHECK_VIN_HISTORY_PAGE_SIZE",
    "MARKETCHECK_VIN_HISTORY_URL",
    "MarketCheckHistoricalProvider",
    "MarketCheckDiscoveryPage",
    "MarketCheckVerifiedBatch",
    "MarketCheckProvider",
    "MarketCheckTransport",
    "drivetrain_lookup_failure",
    "marketcheck_account_radius_from_environment",
    "marketcheck_historical_coverage",
    "validate_drivetrain_lookup_result",
]
