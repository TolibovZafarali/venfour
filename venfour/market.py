"""Provider-neutral contracts and discovery for external market listings.

This module defines only the Phase 3A boundary. It performs no network access,
listing ranking, CCC comparison, valuation analysis, or provider-specific work.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError


REPO_ROOT = Path(__file__).resolve().parents[1]
MARKET_SCHEMA_DIR = REPO_ROOT / "schemas" / "market"
SEARCH_REQUEST_SCHEMA_PATH = MARKET_SCHEMA_DIR / "search-request.schema.json"
LISTING_SCHEMA_PATH = MARKET_SCHEMA_DIR / "listing.schema.json"
SEARCH_RESULT_SCHEMA_PATH = MARKET_SCHEMA_DIR / "search-result.schema.json"


class MarketDiscoveryError(Exception):
    """Base class for expected market-discovery failures."""


class MarketContractError(MarketDiscoveryError):
    """A request or canonical domain value failed contract validation."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class MarketProviderDiagnostic:
    """Non-persisted, allowlisted context for local provider diagnostics."""

    endpoint_category: str
    http_status: int | None = None
    radius: int | None = None
    start: int | None = None
    rows: int | None = None
    page: int | None = None

    def __post_init__(self) -> None:
        if self.endpoint_category not in {"active", "recents", "history"}:
            raise ValueError("Provider diagnostic endpoint category is invalid")
        for name in ("radius", "start", "rows", "page"):
            value = getattr(self, name)
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, int) or value < 0
            ):
                raise ValueError(f"Provider diagnostic {name} is invalid")
        if self.http_status is not None and (
            isinstance(self.http_status, bool)
            or not isinstance(self.http_status, int)
            or self.http_status < 100
            or self.http_status > 599
        ):
            raise ValueError("Provider diagnostic HTTP status is invalid")

    def to_dict(self) -> dict[str, Any]:
        values = {
            "endpointCategory": self.endpoint_category,
            "httpStatus": self.http_status,
            "radius": self.radius,
            "start": self.start,
            "rows": self.rows,
            "page": self.page,
        }
        return {name: value for name, value in values.items() if value is not None}


class MarketProviderError(MarketDiscoveryError):
    """A provider failed behind the provider-neutral boundary."""

    def __init__(
        self,
        message: str,
        *,
        diagnostic: MarketProviderDiagnostic | None = None,
    ) -> None:
        super().__init__(message)
        if diagnostic is not None and not isinstance(
            diagnostic, MarketProviderDiagnostic
        ):
            raise TypeError("diagnostic must be MarketProviderDiagnostic or None")
        self.diagnostic = diagnostic

    def with_diagnostic(
        self, diagnostic: MarketProviderDiagnostic
    ) -> MarketProviderError:
        """Attach safe request context once without retaining raw provider data."""

        if not isinstance(diagnostic, MarketProviderDiagnostic):
            raise TypeError("diagnostic must be MarketProviderDiagnostic")
        if self.diagnostic is None:
            self.diagnostic = diagnostic
        return self


class MarketProviderUnavailableError(MarketProviderError):
    """The provider is temporarily unavailable."""


class MarketProviderAuthenticationError(MarketProviderError):
    """The provider rejected its adapter's credentials."""


class MarketProviderRateLimitError(MarketProviderError):
    """The provider rejected a request because of rate limiting."""


class MarketProviderResponseError(MarketProviderError):
    """The provider could not produce a valid canonical result."""

    def __init__(
        self,
        message: str,
        details: tuple[str, ...] = (),
        *,
        diagnostic: MarketProviderDiagnostic | None = None,
    ) -> None:
        super().__init__(message, diagnostic=diagnostic)
        self.details = details


def _trim_required(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def _trim_optional(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip()
    return normalized or None


def _normalize_state(value: Any) -> Any:
    normalized = _trim_optional(value)
    if (
        isinstance(normalized, str)
        and len(normalized) == 2
        and normalized.isascii()
        and normalized.isalpha()
    ):
        return normalized.upper()
    return normalized


@dataclass(frozen=True)
class MarketSearchRequest:
    """The vehicle and search bounds Venfour wants a provider to search for.

    Year, make, and model identify the requested vehicle. Trim and loss-vehicle
    mileage are descriptive inputs, not mandatory match rules. Location is
    optional because an upstream report may not contain it.
    """

    year: int
    make: str
    model: str
    trim: str | None = None
    loss_vehicle_mileage: int | None = None
    postal_code: str | None = None
    radius_miles: int = 50
    result_limit: int = 25

    def __post_init__(self) -> None:
        object.__setattr__(self, "make", _trim_required(self.make))
        object.__setattr__(self, "model", _trim_required(self.model))
        object.__setattr__(self, "trim", _trim_optional(self.trim))
        object.__setattr__(self, "postal_code", _trim_optional(self.postal_code))

    def to_dict(self) -> dict[str, Any]:
        """Return the canonical camelCase JSON representation."""

        return {
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "lossVehicleMileage": self.loss_vehicle_mileage,
            "postalCode": self.postal_code,
            "radiusMiles": self.radius_miles,
            "resultLimit": self.result_limit,
        }


@dataclass(frozen=True)
class MarketDealer:
    """Optional seller location details supplied with a market listing."""

    name: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _trim_optional(self.name))
        object.__setattr__(self, "city", _trim_optional(self.city))
        object.__setattr__(self, "state", _normalize_state(self.state))
        object.__setattr__(self, "postal_code", _trim_optional(self.postal_code))

    def to_dict(self) -> dict[str, Any]:
        """Return the canonical camelCase JSON representation."""

        return {
            "name": self.name,
            "city": self.city,
            "state": self.state,
            "postalCode": self.postal_code,
        }


@dataclass(frozen=True)
class MarketListing:
    """One provider-normalized external vehicle listing."""

    source: str
    year: int
    make: str
    model: str
    price: int | float
    source_listing_id: str | None = None
    listing_url: str | None = None
    trim: str | None = None
    vin: str | None = None
    mileage: int | None = None
    dealer: MarketDealer | None = None
    distance_miles: int | float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", _trim_required(self.source))
        object.__setattr__(self, "make", _trim_required(self.make))
        object.__setattr__(self, "model", _trim_required(self.model))
        object.__setattr__(
            self, "source_listing_id", _trim_optional(self.source_listing_id)
        )
        object.__setattr__(self, "listing_url", _trim_optional(self.listing_url))
        object.__setattr__(self, "trim", _trim_optional(self.trim))
        object.__setattr__(self, "vin", _trim_optional(self.vin))

    def to_dict(self) -> dict[str, Any]:
        """Return canonical data without provider-specific payload fields."""

        dealer = self.dealer.to_dict() if self.dealer is not None else None
        return {
            "source": self.source,
            "sourceListingId": self.source_listing_id,
            "listingUrl": self.listing_url,
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "vin": self.vin,
            "mileage": self.mileage,
            "price": self.price,
            "dealer": dealer,
            "distanceMiles": self.distance_miles,
        }


@dataclass(frozen=True)
class MarketSearchResult:
    """The canonical listings returned by one provider search."""

    provider: str
    request: MarketSearchRequest
    listings: tuple[MarketListing, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider", _trim_required(self.provider))
        object.__setattr__(self, "listings", tuple(self.listings))

    @property
    def listing_count(self) -> int:
        """Return the number of listings without duplicating mutable state."""

        return len(self.listings)

    def to_dict(self) -> dict[str, Any]:
        """Return the canonical camelCase JSON representation."""

        return {
            "provider": self.provider,
            "request": self.request.to_dict(),
            "listings": [listing.to_dict() for listing in self.listings],
            "listingCount": self.listing_count,
        }


@runtime_checkable
class MarketProvider(Protocol):
    """Small adapter boundary implemented by each market-listing source."""

    name: str

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        """Search the provider and return only canonical market data."""

        ...


def normalize_market_search_request(
    request: MarketSearchRequest,
) -> MarketSearchRequest:
    """Return a new conservatively normalized request without mutating input."""

    if not isinstance(request, MarketSearchRequest):
        raise MarketContractError("Market search request must be MarketSearchRequest")
    return MarketSearchRequest(
        year=request.year,
        make=request.make,
        model=request.model,
        trim=request.trim,
        loss_vehicle_mileage=request.loss_vehicle_mileage,
        postal_code=request.postal_code,
        radius_miles=request.radius_miles,
        result_limit=request.result_limit,
    )


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


def _json_compatibility_errors(data: Any) -> list[str]:
    errors: list[str] = []
    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if value is None or isinstance(value, (str, bool, int)):
            continue
        if isinstance(value, float):
            if not math.isfinite(value):
                errors.append(f"{path}: non-finite numbers are not valid JSON")
            continue
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    errors.append(f"{path}: object keys must be strings")
                    continue
                stack.append((f"{path}.{key}", child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        errors.append(
            f"{path}: {type(value).__name__} is not a JSON-compatible value"
        )
    return sorted(errors)


def _validate_contract(data: Any, schema_path: Path, label: str) -> None:
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise MarketContractError(
            f"{label} failed contract validation", tuple(compatibility_errors)
        )

    validator = Draft202012Validator(_read_schema(schema_path))
    validation_errors = sorted(
        validator.iter_errors(data),
        key=lambda error: (_json_path(list(error.absolute_path)), error.message),
    )
    if not validation_errors:
        return
    details = tuple(
        f"{_json_path(list(error.absolute_path))}: {error.message}"
        for error in validation_errors
    )
    raise MarketContractError(f"{label} failed contract validation", details)


def _serialized_contract(value: Any, expected_type: type[Any], label: str) -> Any:
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


def validate_market_search_request(
    request: MarketSearchRequest | Mapping[str, Any],
) -> None:
    """Validate one normalized search request against its JSON contract."""

    data = (
        _serialized_contract(request, MarketSearchRequest, "Market search request")
        if isinstance(request, MarketSearchRequest)
        else request
    )
    _validate_contract(data, SEARCH_REQUEST_SCHEMA_PATH, "Market search request")


def validate_market_listing(
    listing: MarketListing | Mapping[str, Any],
) -> None:
    """Validate one canonical listing against its JSON contract."""

    data = (
        _serialized_contract(listing, MarketListing, "Market listing")
        if isinstance(listing, MarketListing)
        else listing
    )
    _validate_contract(data, LISTING_SCHEMA_PATH, "Market listing")


def validate_market_search_result(
    result: MarketSearchResult | Mapping[str, Any],
) -> None:
    """Validate one canonical provider result against its JSON contract."""

    data = (
        _serialized_contract(result, MarketSearchResult, "Market search result")
        if isinstance(result, MarketSearchResult)
        else result
    )
    _validate_contract(data, SEARCH_RESULT_SCHEMA_PATH, "Market search result")

    details: list[str] = []
    provider = data["provider"]
    listings = data["listings"]
    if data["listingCount"] != len(listings):
        details.append("$.listingCount: does not match the number of listings")

    seen_listing_ids: set[str] = set()
    for index, listing in enumerate(listings):
        if listing["source"] != provider:
            details.append(
                f"$.listings[{index}].source: expected {provider!r}, "
                f"got {listing['source']!r}"
            )
        listing_id = listing.get("sourceListingId")
        if listing_id is not None:
            if listing_id in seen_listing_ids:
                details.append(
                    f"$.listings[{index}].sourceListingId: duplicate "
                    f"same-provider ID {listing_id!r}"
                )
            seen_listing_ids.add(listing_id)

    if details:
        raise MarketContractError(
            "Market search result failed contract validation", tuple(details)
        )


def _validate_result_semantics(
    result: MarketSearchResult,
    request: MarketSearchRequest,
    provider_name: str,
) -> None:
    details: list[str] = []
    if result.provider != provider_name:
        details.append(
            f"$.provider: expected {provider_name!r}, got {result.provider!r}"
        )
    if result.request != request:
        details.append("$.request: provider did not echo the normalized request")

    if details:
        raise MarketProviderResponseError(
            "Provider returned an inconsistent market search result", tuple(details)
        )


def discover_market_listings(
    request: MarketSearchRequest,
    provider: MarketProvider,
) -> MarketSearchResult:
    """Validate, search one provider, and validate its canonical result.

    Empty results are valid. Listing order is retained exactly as supplied by the
    provider; this function performs no ranking, scoring, or VIN deduplication.
    """

    normalized_request = normalize_market_search_request(request)
    validate_market_search_request(normalized_request)

    try:
        raw_provider_name = getattr(provider, "name", None)
        provider_name = _trim_required(raw_provider_name)
    except MarketProviderError:
        raise
    except Exception as exc:
        raise MarketProviderResponseError(
            "Market provider name could not be read"
        ) from exc
    if not isinstance(provider_name, str) or not provider_name:
        raise MarketProviderResponseError(
            "Market provider must expose a non-empty stable name"
        )

    try:
        result = provider.search(normalized_request)
    except MarketProviderError:
        raise
    except MarketContractError as exc:
        raise MarketProviderResponseError(
            "Provider could not produce canonical market data", exc.details
        ) from exc
    except Exception as exc:
        raise MarketProviderError(
            f"Market provider {provider_name!r} search failed"
        ) from exc

    if not isinstance(result, MarketSearchResult):
        raise MarketProviderResponseError(
            "Provider did not return MarketSearchResult",
            (f"$: got {type(result).__name__}",),
        )

    try:
        validate_market_search_result(result)
    except MarketContractError as exc:
        raise MarketProviderResponseError(
            "Provider returned an invalid market search result", exc.details
        ) from exc

    _validate_result_semantics(result, normalized_request, provider_name)
    return result


__all__ = [
    "LISTING_SCHEMA_PATH",
    "MARKET_SCHEMA_DIR",
    "SEARCH_REQUEST_SCHEMA_PATH",
    "SEARCH_RESULT_SCHEMA_PATH",
    "MarketContractError",
    "MarketDealer",
    "MarketDiscoveryError",
    "MarketListing",
    "MarketProvider",
    "MarketProviderAuthenticationError",
    "MarketProviderError",
    "MarketProviderDiagnostic",
    "MarketProviderRateLimitError",
    "MarketProviderResponseError",
    "MarketProviderUnavailableError",
    "MarketSearchRequest",
    "MarketSearchResult",
    "discover_market_listings",
    "normalize_market_search_request",
    "validate_market_listing",
    "validate_market_search_request",
    "validate_market_search_result",
]
