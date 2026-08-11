"""MarketCheck adapter for Venfour's provider-neutral market contracts."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, quote_plus, urlencode, urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    Request,
    build_opener,
)

from venfour.market import (
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProviderAuthenticationError,
    MarketProviderError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    MarketSearchResult,
    validate_market_listing,
)


MARKETCHECK_ACTIVE_INVENTORY_URL = (
    "https://api.marketcheck.com/v2/search/car/active"
)
MARKETCHECK_MAX_ROWS = 50
DEFAULT_TIMEOUT_SECONDS = 15.0

QueryValue = str | int


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

    def __init__(
        self,
        api_key: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: MarketCheckTransport | None = None,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
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

        self._api_key = api_key.strip()
        self._timeout = float(timeout)
        self._transport = (
            transport if transport is not None else _UrllibMarketCheckTransport()
        )
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

    def _params(
        self,
        request: MarketSearchRequest,
        *,
        start: int,
        rows: int,
    ) -> dict[str, QueryValue]:
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
        if request.trim is not None:
            params["trim"] = request.trim
        if request.postal_code is not None:
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
                "MarketCheck rate limit or quota was exceeded"
            )
        if status == 408 or 500 <= status <= 599:
            return MarketProviderUnavailableError(
                "MarketCheck is temporarily unavailable"
            )
        return MarketProviderResponseError(
            f"MarketCheck rejected the search request (HTTP {status})"
        )

    def _request_page(self, params: Mapping[str, QueryValue]) -> Mapping[str, Any]:
        failure: MarketProviderError | None = None
        body: bytes | None = None
        try:
            body = self._transport.get(
                MARKETCHECK_ACTIVE_INVENTORY_URL,
                params,
                {"Accept": "application/json"},
                self._timeout,
            )
        except HTTPError as exc:
            status = exc.code
            try:
                exc.close()
            except Exception:
                pass
            failure = self._http_error(status)
        except (URLError, TimeoutError, ConnectionError, OSError):
            failure = MarketProviderUnavailableError(
                "MarketCheck is temporarily unavailable"
            )
        except Exception:
            failure = MarketProviderUnavailableError(
                "MarketCheck is temporarily unavailable"
            )

        if failure is not None:
            raise failure
        if not isinstance(body, bytes):
            raise MarketProviderResponseError(
                "MarketCheck returned an unreadable response"
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
                "MarketCheck returned malformed JSON"
            )
        return _mapping(
            payload,
            "$",
            "MarketCheck response is malformed",
        )

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

    def _normalize_listing(
        self,
        value: Any,
        response_index: int,
    ) -> MarketListing:
        path = f"$.listings[{response_index}]"
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

        listing = MarketListing(
            source=self.name,
            source_listing_id=record.get("id"),
            listing_url=record.get("vdp_url"),
            year=build.get("year"),
            make=build.get("make"),
            model=build.get("model"),
            trim=build.get("trim"),
            vin=record.get("vin"),
            mileage=record.get("miles"),
            price=record.get("price"),
            dealer=dealer,
            distance_miles=record.get("dist"),
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
        return listing

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

            payload = self._request_page(
                self._params(request, start=start, rows=rows)
            )
            page_num_found = self._num_found(payload)
            if page_num_found is not None:
                known_num_found = page_num_found

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
            if not raw_listings:
                break

            for index, raw_listing in enumerate(raw_listings):
                listings.append(
                    self._normalize_listing(raw_listing, start + index)
                )

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


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MARKETCHECK_ACTIVE_INVENTORY_URL",
    "MARKETCHECK_MAX_ROWS",
    "MarketCheckProvider",
    "MarketCheckTransport",
]
