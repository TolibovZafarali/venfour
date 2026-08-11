"""MarketCheck adapter for Venfour's provider-neutral market contracts."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
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


MARKETCHECK_ACTIVE_INVENTORY_URL = (
    "https://api.marketcheck.com/v2/search/car/active"
)
MARKETCHECK_PAST_INVENTORY_URL = (
    "https://api.marketcheck.com/v2/search/car/recents"
)
MARKETCHECK_MAX_ROWS = 50
MARKETCHECK_HISTORY_WINDOW_DAYS = 90
MARKETCHECK_HISTORICAL_MAX_PAGES = 10
MARKETCHECK_HISTORICAL_MIN_ROWS = 10
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
        api_key: str | None,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: MarketCheckTransport | None = None,
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

        self._api_key = None if missing_key else api_key.strip()
        self._timeout = float(timeout)
        self._transport = (
            transport if transport is not None else _UrllibMarketCheckTransport()
        )
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

    def _request_page(
        self,
        params: Mapping[str, QueryValue],
        *,
        endpoint: str = MARKETCHECK_ACTIVE_INVENTORY_URL,
    ) -> Mapping[str, Any]:
        failure: MarketProviderError | None = None
        body: bytes | None = None
        try:
            body = self._transport.get(
                endpoint,
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
            raw_listings, page_num_found = self._listing_page(
                payload, start=start, rows=rows
            )
            if page_num_found is not None:
                known_num_found = page_num_found
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


class MarketCheckHistoricalProvider(MarketCheckProvider):
    """Search expired lifecycle records and resolve exact-date price evidence.

    ``active_inventory_date_range`` discovers candidate VINs. MarketCheck's
    documented ``first_seen_at``/``last_seen_at`` interval is then checked on
    each specific price/mileage record. Broader source-tenure timestamps are
    retained as corroborating provenance when available, but never substituted
    for this record-level interval.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        as_of_date: date | str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: MarketCheckTransport | None = None,
    ) -> None:
        super().__init__(
            api_key,
            timeout=timeout,
            transport=transport,
            _allow_missing_api_key=True,
        )
        self._as_of_date = (
            datetime.now(timezone.utc).date()
            if as_of_date is None
            else _coerce_calendar_date(as_of_date, "As-of date")
        )

    def __repr__(self) -> str:
        return (
            "MarketCheckHistoricalProvider("
            f"as_of_date={self._as_of_date.isoformat()!r}, "
            f"timeout={self._timeout!r})"
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
            "nodedup": "true",
            "start": start,
            "rows": rows,
        }
        if request.trim is not None:
            params["trim"] = request.trim
        return params

    @staticmethod
    def _safe_identity_value(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    def _resolve_historical_records(
        self,
        raw_records: list[Any],
        request: HistoricalMarketSearchRequest,
    ) -> tuple[list[HistoricalEvidenceItem], list[HistoricalEvidenceIssue]]:
        evidence_day = date.fromisoformat(request.evidence_date)
        day_start = datetime.combine(evidence_day, time.min, tzinfo=timezone.utc)
        next_day = day_start + timedelta(days=1)

        groups: dict[tuple[str, str], list[tuple[int, Mapping[str, Any]]]] = {}
        issue_rows: list[tuple[int, HistoricalEvidenceIssue]] = []
        for index, value in enumerate(raw_records):
            record = _mapping(
                value,
                f"$.listings[{index}]",
                "MarketCheck listing is malformed",
            )
            vin = self._safe_identity_value(record.get("vin"))
            listing_id = self._safe_identity_value(record.get("id"))
            if self._contains_secret(vin) or self._contains_secret(listing_id):
                raise MarketProviderResponseError(
                    "MarketCheck response could not be safely normalized"
                )
            if vin is not None:
                identity = ("vin", vin.casefold())
            elif listing_id is not None:
                identity = ("sourceListingId", listing_id)
            else:
                issue_rows.append(
                    (
                        index,
                        HistoricalEvidenceIssue(
                            status=UNRESOLVED,
                            reason="MISSING_LISTING_IDENTITY",
                        ),
                    )
                )
                continue
            groups.setdefault(identity, []).append((index, record))

        resolved_rows: list[tuple[int, HistoricalEvidenceItem]] = []
        for (identity_kind, identity_value), records in groups.items():
            intervals: list[tuple[int, Mapping[str, Any], _RecordInterval, str]] = []
            interval_error: str | None = None
            for index, record in records:
                interval, error = _record_interval(record)
                if error is not None:
                    interval_error = error
                    break
                assert interval is not None
                relation = (
                    "before"
                    if interval.last < day_start
                    else "after"
                    if interval.first >= next_day
                    else "overlap"
                )
                intervals.append((index, record, interval, relation))

            vin = (
                self._safe_identity_value(records[0][1].get("vin"))
                if identity_kind == "vin"
                else None
            )
            listing_id = (
                identity_value if identity_kind == "sourceListingId" else None
            )
            first_index = records[0][0]
            if interval_error is not None:
                issue_rows.append(
                    (
                        first_index,
                        HistoricalEvidenceIssue(
                            status=UNRESOLVED,
                            reason=interval_error,
                            vin=vin,
                            source_listing_id=listing_id,
                        ),
                    )
                )
                continue

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
                issue_rows.append(
                    (
                        first_index,
                        HistoricalEvidenceIssue(
                            status=UNRESOLVED,
                            reason=reason,
                            vin=vin,
                            source_listing_id=listing_id,
                        ),
                    )
                )
                continue

            distinct: list[tuple[int, Mapping[str, Any], _RecordInterval, str]] = []
            for item in overlapping:
                if not any(item[1] == existing[1] for existing in distinct):
                    distinct.append(item)
            if len(distinct) != 1:
                issue_rows.append(
                    (
                        distinct[0][0],
                        HistoricalEvidenceIssue(
                            status=AMBIGUOUS,
                            reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                            vin=vin,
                            source_listing_id=listing_id,
                        ),
                    )
                )
                continue

            selected_index, raw_listing, interval, _ = distinct[0]
            listing = self._normalize_listing(raw_listing, selected_index)
            resolved_rows.append(
                (
                    first_index,
                    HistoricalEvidenceItem(
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
                    ),
                )
            )

        resolved_rows.sort(key=lambda item: item[0])
        issue_rows.sort(key=lambda item: item[0])
        return (
            [item for _, item in resolved_rows[: request.result_limit]],
            [item for _, item in issue_rows],
        )

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

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        """Search bounded past inventory and resolve unique dated records."""

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

        page_rows = min(
            MARKETCHECK_MAX_ROWS,
            max(MARKETCHECK_HISTORICAL_MIN_ROWS, request.result_limit),
        )
        raw_records: list[Any] = []
        start = 0
        known_num_found: int | None = None
        pages = 0
        last_page_size = 0
        last_rows = page_rows
        resolved: list[HistoricalEvidenceItem] = []
        issues: list[HistoricalEvidenceIssue] = []

        while pages < MARKETCHECK_HISTORICAL_MAX_PAGES:
            rows = page_rows
            if known_num_found is not None:
                available = known_num_found - start
                if available <= 0:
                    break
                rows = min(rows, available)
            payload = self._request_page(
                self._historical_params(request, start=start, rows=rows),
                endpoint=MARKETCHECK_PAST_INVENTORY_URL,
            )
            page, page_num_found = self._listing_page(
                payload, start=start, rows=rows
            )
            pages += 1
            last_page_size = len(page)
            last_rows = rows
            if page_num_found is not None:
                known_num_found = page_num_found
            if not page:
                break
            raw_records.extend(page)
            next_start = start + rows
            if known_num_found is not None and next_start >= known_num_found:
                break
            if len(page) < rows:
                break
            start = next_start

        consumed = len(raw_records)
        more_records_possible = (
            known_num_found is not None and consumed < known_num_found
        ) or (known_num_found is None and last_page_size == last_rows)
        resolved, issues = self._resolve_historical_records(raw_records, request)
        if more_records_possible:
            resolved = []
            issues.append(
                HistoricalEvidenceIssue(
                    status=UNRESOLVED,
                    reason=(
                        "PAGINATION_SAFETY_LIMIT_REACHED"
                        if pages >= MARKETCHECK_HISTORICAL_MAX_PAGES
                        else "INCOMPLETE_PROVIDER_PAGINATION"
                    ),
                )
            )
        return self._result(request, coverage, resolved, issues)


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MARKETCHECK_ACTIVE_INVENTORY_URL",
    "MARKETCHECK_HISTORICAL_MAX_PAGES",
    "MARKETCHECK_HISTORICAL_MIN_ROWS",
    "MARKETCHECK_HISTORY_WINDOW_DAYS",
    "MARKETCHECK_MAX_ROWS",
    "MARKETCHECK_PAST_INVENTORY_URL",
    "MarketCheckHistoricalProvider",
    "MarketCheckProvider",
    "MarketCheckTransport",
    "marketcheck_historical_coverage",
]
