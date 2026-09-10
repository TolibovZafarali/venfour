"""Atomic accounting for every physical market-provider request attempt.

Reservations are never refunded: failed requests and transport retries consume
the same allowances as successful requests. This ledger contains accounting
metadata only; it is not a cache of customer or provider evidence.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from venfour.market import MarketProviderUnavailableError


_ENDPOINTS = ("active_inventory", "historical_inventory", "vin_history", "vehicle_terms")
_PHASES = ("baseline", "supporting", "enrichment")
_OPERATIONS = ("active_discovery", "historical_discovery", "vin_history", "enrichment", "vehicle_terms")
_HEX = re.compile(r"[0-9a-f]{64}")


def _integer(value: Any, label: str, *, minimum: int = 0, maximum: int = 2**31 - 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} is invalid")
    return value


def _timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Quota period timestamp is invalid")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Quota period timestamp requires an explicit timezone")
    return parsed.astimezone(UTC)


def market_account_key(identifier: str) -> str:
    """Hash a configured non-secret account identifier shared by all workers."""
    if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 200:
        raise ValueError("Market account identifier is invalid")
    return hashlib.sha256(identifier.strip().encode()).hexdigest()


@dataclass(frozen=True)
class MarketRequestPolicy:
    total_attempts: int = 60
    supporting_attempts: int = 5
    supporting_discovery_attempts: int = 2
    active_discovery_attempts: int = 8
    historical_discovery_attempts: int = 8
    history_attempts: int = 40
    enrichment_attempts: int = 9
    vehicle_terms_attempts: int = 2
    per_vin_history_attempts: int = 3
    monthly_reserve_fraction: float = 0.20
    optimization_target_min: int = 20
    optimization_target_max: int = 30

    def __post_init__(self) -> None:
        for name in self.__dataclass_fields__:
            if name != "monthly_reserve_fraction":
                _integer(getattr(self, name), name, minimum=1 if name == "total_attempts" else 0)
        if (isinstance(self.monthly_reserve_fraction, bool)
                or not isinstance(self.monthly_reserve_fraction, (int, float))
                or not math.isfinite(self.monthly_reserve_fraction)
                or not 0 <= self.monthly_reserve_fraction < 1):
            raise ValueError("Monthly reserve fraction is invalid")
        if self.optimization_target_min > self.optimization_target_max:
            raise ValueError("Optimization target range is invalid")
        if self.supporting_discovery_attempts > self.supporting_attempts:
            raise ValueError("Supporting discovery allowance exceeds its pass allowance")

    def to_dict(self) -> dict[str, Any]:
        return {
            "totalAttempts": self.total_attempts,
            "supportingAttempts": self.supporting_attempts,
            "supportingDiscoveryAttempts": self.supporting_discovery_attempts,
            "operationLimits": dict(zip(_OPERATIONS, (
                self.active_discovery_attempts, self.historical_discovery_attempts,
                self.history_attempts, self.enrichment_attempts, self.vehicle_terms_attempts,
            ))),
            "perVinHistoryAttempts": self.per_vin_history_attempts,
            "monthlyReserveBasisPoints": round(self.monthly_reserve_fraction * 10_000),
            "optimizationTarget": [self.optimization_target_min, self.optimization_target_max],
        }

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]) -> "MarketRequestPolicy":
        names = {
            "total_attempts": "MARKETCHECK_BUDGET_TOTAL_ATTEMPTS",
            "supporting_attempts": "MARKETCHECK_BUDGET_SUPPORTING_ATTEMPTS",
            "supporting_discovery_attempts": "MARKETCHECK_BUDGET_SUPPORTING_DISCOVERY_ATTEMPTS",
            "active_discovery_attempts": "MARKETCHECK_BUDGET_ACTIVE_DISCOVERY_ATTEMPTS",
            "historical_discovery_attempts": "MARKETCHECK_BUDGET_HISTORICAL_DISCOVERY_ATTEMPTS",
            "history_attempts": "MARKETCHECK_BUDGET_HISTORY_ATTEMPTS",
            "enrichment_attempts": "MARKETCHECK_BUDGET_ENRICHMENT_ATTEMPTS",
            "vehicle_terms_attempts": "MARKETCHECK_BUDGET_VEHICLE_TERMS_ATTEMPTS",
            "per_vin_history_attempts": "MARKETCHECK_BUDGET_PER_VIN_HISTORY_ATTEMPTS",
            "optimization_target_min": "MARKETCHECK_OPTIMIZATION_TARGET_MIN",
            "optimization_target_max": "MARKETCHECK_OPTIMIZATION_TARGET_MAX",
        }
        values: dict[str, Any] = {}
        for field_name, key in names.items():
            value = environment.get(key, "").strip()
            if value:
                if re.fullmatch(r"0|[1-9][0-9]*", value) is None:
                    raise ValueError(f"{key} must be a nonnegative integer")
                values[field_name] = int(value)
        reserve = environment.get("MARKETCHECK_MONTHLY_RESERVE_FRACTION", "").strip()
        if reserve:
            values["monthly_reserve_fraction"] = float(reserve)
        return cls(**values)


@dataclass(frozen=True)
class MarketAccountLimits:
    monthly_allowance: int | None = None
    metered: bool = False
    max_requests_per_window: int | None = None
    rate_window_seconds: int | None = None
    monthly_period_start: str | None = None
    monthly_period_end: str | None = None
    monthly_usage_before_tracking: int | None = None
    # Only a confirmed tariff that bills every actual attempt belongs here.
    # Response-based or unknown tariffs remain unpriced, rather than guessed.
    confirmed_tariff_usd_per_attempt: Mapping[str, str] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.metered, bool):
            raise ValueError("Metered account declaration is invalid")
        for name in ("monthly_allowance", "max_requests_per_window", "rate_window_seconds"):
            if getattr(self, name) is not None:
                _integer(getattr(self, name), name, minimum=1)
        if self.monthly_usage_before_tracking is not None:
            _integer(self.monthly_usage_before_tracking, "Monthly usage before tracking")
        for name in ("monthly_period_start", "monthly_period_end"):
            if getattr(self, name) is not None:
                _timestamp(getattr(self, name))
        if self.monthly_period_start is not None and self.monthly_period_end is not None:
            if _timestamp(self.monthly_period_start) >= _timestamp(self.monthly_period_end):
                raise ValueError("Monthly quota period is invalid")
        tariff = self.confirmed_tariff_usd_per_attempt
        if tariff is not None:
            if not isinstance(tariff, Mapping) or set(tariff) - set(_ENDPOINTS):
                raise ValueError("Confirmed request tariff has an invalid endpoint")
            for amount in tariff.values():
                _cost_micros(amount)
            object.__setattr__(self, "confirmed_tariff_usd_per_attempt", dict(tariff))

    def configuration_reason(self, now: datetime) -> str | None:
        if self.max_requests_per_window is None or self.rate_window_seconds is None:
            return "MARKET_ACCOUNT_RATE_LIMIT_UNCONFIGURED"
        if self.monthly_allowance is None:
            return "MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED"
        if self.monthly_period_start is None or self.monthly_period_end is None:
            return "MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED"
        if self.monthly_usage_before_tracking is None:
            return "MARKET_ACCOUNT_PRIOR_USAGE_UNCONFIGURED"
        if not _timestamp(self.monthly_period_start) <= now < _timestamp(self.monthly_period_end):
            return "MARKET_ACCOUNT_QUOTA_PERIOD_INACTIVE"
        return None

    def to_dict(self, policy: MarketRequestPolicy) -> dict[str, Any]:
        return {
            "monthlyAllowance": self.monthly_allowance, "metered": self.metered,
            "requestsPerWindow": self.max_requests_per_window,
            "rateWindowSeconds": self.rate_window_seconds,
            "periodStart": (_timestamp(self.monthly_period_start).isoformat() if self.monthly_period_start else None),
            "periodEnd": (_timestamp(self.monthly_period_end).isoformat() if self.monthly_period_end else None),
            "priorMonthlyAttempts": self.monthly_usage_before_tracking,
            "reserveBasisPoints": policy.to_dict()["monthlyReserveBasisPoints"],
        }

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]) -> "MarketAccountLimits":
        def number(name: str, *, allow_zero: bool = False) -> int | None:
            value = environment.get(name, "").strip()
            if not value:
                return None
            if re.fullmatch(r"0|[1-9][0-9]*" if allow_zero else r"[1-9][0-9]*", value) is None:
                raise ValueError(f"{name} must be a positive integer")
            return int(value)
        metered = environment.get("MARKETCHECK_ACCOUNT_METERED", "false").strip().lower()
        if metered not in {"true", "false"}:
            raise ValueError("MARKETCHECK_ACCOUNT_METERED must be true or false")
        raw_tariff = environment.get("MARKETCHECK_CONFIRMED_TARIFF_USD_PER_ATTEMPT", "").strip()
        return cls(
            monthly_allowance=number("MARKETCHECK_MONTHLY_REQUEST_ALLOWANCE"), metered=metered == "true",
            max_requests_per_window=number("MARKETCHECK_RATE_LIMIT_REQUESTS"),
            rate_window_seconds=number("MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS"),
            monthly_period_start=environment.get("MARKETCHECK_QUOTA_PERIOD_START", "").strip() or None,
            monthly_period_end=environment.get("MARKETCHECK_QUOTA_PERIOD_END", "").strip() or None,
            monthly_usage_before_tracking=number("MARKETCHECK_MONTHLY_USAGE_BEFORE_TRACKING", allow_zero=True),
            confirmed_tariff_usd_per_attempt=json.loads(raw_tariff) if raw_tariff else None,
        )


def _cost_micros(value: Any) -> int:
    if not isinstance(value, str):
        raise ValueError("Confirmed tariff amounts must be exact decimal strings")
    try:
        amount = Decimal(value) * 1_000_000
    except InvalidOperation as exc:
        raise ValueError("Confirmed tariff amount is invalid") from exc
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value() or amount > 10**12:
        raise ValueError("Confirmed tariff must be nonnegative with at most six decimal places")
    return int(amount)


class MarketRequestBudgetExceeded(MarketProviderUnavailableError):
    def __init__(self, reason_code: str, retry_after_seconds: float | None = None) -> None:
        super().__init__("Market request could not be reserved within the configured allowances")
        self.reason_code = reason_code
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class AttemptReservation:
    reservation_id: str
    usage: Mapping[str, Any]


@runtime_checkable
class MarketRequestGateway(Protocol):
    def reserve_market_request_attempt(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def get_market_request_usage(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def record_market_request_account_state(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...


def _endpoint(value: str) -> str:
    aliases = {"active": "active_inventory", "historical": "historical_inventory", "past": "historical_inventory",
               "history": "vin_history", "terms": "vehicle_terms", "taxonomy": "vehicle_terms"}
    if value in _ENDPOINTS:
        return value
    if value in aliases:
        return aliases[value]
    parsed = urlsplit(value)
    if parsed.scheme == "https" and parsed.netloc == "api.marketcheck.com":
        paths = {"/v2/search/car/active": "active_inventory", "/v2/search/car/recents": "historical_inventory",
                 "/v2/specs/car/terms": "vehicle_terms"}
        if parsed.path in paths:
            return paths[parsed.path]
        if re.fullmatch(r"/v2/history/car/[A-HJ-NPR-Z0-9]{17}", parsed.path):
            return "vin_history"
    raise ValueError("Market request endpoint is not allowlisted")


def _operation(endpoint: str, phase: str, vin_key: str | None) -> str:
    if endpoint == "active_inventory":
        return "enrichment" if vin_key is not None or phase == "enrichment" else "active_discovery"
    return {"historical_inventory": "historical_discovery", "vin_history": "vin_history", "vehicle_terms": "vehicle_terms"}[endpoint]


def validate_market_request_payload(request: Mapping[str, Any], *, operation: str) -> dict[str, Any]:
    """Validate the service-owned accounting payload before a durable RPC."""
    if not isinstance(request, Mapping):
        raise ValueError("Market request accounting payload is invalid")
    data = copy.deepcopy(dict(request))
    base = {"accountKey", "caseId", "policy", "accountLimits"}
    extras = ({"reservationId", "endpoint", "phase", "vinKey", "estimatedCostMicros"} if operation == "reserve"
              else {"retryAfterSeconds", "quotaExhausted"} if operation == "state" else set())
    if operation == "reserve" and "executionFence" in data:
        extras.add("executionFence")
    if set(data) != base | extras or _HEX.fullmatch(str(data.get("accountKey", ""))) is None:
        raise ValueError("Market request accounting identity is invalid")
    if str(UUID(str(data["caseId"]))) != data["caseId"]:
        raise ValueError("Market request case identity is invalid")
    policy = data["policy"]
    if not isinstance(policy, Mapping) or set(policy) != set(MarketRequestPolicy().to_dict()):
        raise ValueError("Market request policy is invalid")
    for key in ("totalAttempts", "supportingAttempts", "supportingDiscoveryAttempts", "perVinHistoryAttempts"):
        _integer(policy[key], key, minimum=1 if key == "totalAttempts" else 0)
    _integer(policy["monthlyReserveBasisPoints"], "Monthly reserve", maximum=9999)
    if not isinstance(policy["operationLimits"], Mapping) or set(policy["operationLimits"]) != set(_OPERATIONS):
        raise ValueError("Market endpoint allowances are invalid")
    for value in policy["operationLimits"].values():
        _integer(value, "Market operation allowance")
    if not isinstance(policy["optimizationTarget"], list) or len(policy["optimizationTarget"]) != 2:
        raise ValueError("Market optimization target is invalid")
    for value in policy["optimizationTarget"]:
        _integer(value, "Market optimization target")
    limits = data["accountLimits"]
    if not isinstance(limits, Mapping) or set(limits) != {
        "monthlyAllowance", "metered", "requestsPerWindow", "rateWindowSeconds", "periodStart", "periodEnd", "priorMonthlyAttempts", "reserveBasisPoints"
    }:
        raise ValueError("Market account limits are invalid")
    MarketAccountLimits(monthly_allowance=limits["monthlyAllowance"], metered=limits["metered"],
                        max_requests_per_window=limits["requestsPerWindow"], rate_window_seconds=limits["rateWindowSeconds"],
                        monthly_period_start=limits["periodStart"], monthly_period_end=limits["periodEnd"],
                        monthly_usage_before_tracking=limits["priorMonthlyAttempts"])
    if limits["reserveBasisPoints"] != policy["monthlyReserveBasisPoints"]:
        raise ValueError("Market monthly reserve policy is inconsistent")
    if operation == "reserve":
        if "executionFence" in data:
            fence = data["executionFence"]
            if not isinstance(fence, Mapping) or set(fence) != {"jobId", "processingToken"}:
                raise ValueError("Market execution lease is invalid")
            for value in fence.values():
                if not isinstance(value, str) or str(UUID(value)) != value:
                    raise ValueError("Market execution lease is invalid")
        if str(UUID(str(data["reservationId"]))) != data["reservationId"]:
            raise ValueError("Market reservation identity is invalid")
        if data["endpoint"] not in _ENDPOINTS or data["phase"] not in _PHASES:
            raise ValueError("Market request classification is invalid")
        if data["vinKey"] is not None and _HEX.fullmatch(str(data["vinKey"])) is None:
            raise ValueError("Market request vehicle identity is invalid")
        if data["endpoint"] == "vin_history" and data["vinKey"] is None:
            raise ValueError("VIN history reservations require a vehicle identity")
        if data["estimatedCostMicros"] is not None:
            _integer(data["estimatedCostMicros"], "Market estimated cost", maximum=10**12)
    if operation == "state":
        delay = data["retryAfterSeconds"]
        if delay is not None and (isinstance(delay, bool) or not isinstance(delay, (int, float))
                                  or not math.isfinite(delay) or delay < 0):
            raise ValueError("Market account retry delay is invalid")
        if not isinstance(data["quotaExhausted"], bool):
            raise ValueError("Market account quota response is invalid")
    return data


class MarketRequestBudget:
    def __init__(self, gateway: MarketRequestGateway, account_key: str, case_id: str, *,
                 policy: MarketRequestPolicy | None = None, account_limits: MarketAccountLimits | None = None,
                 job_id: str | None = None, processing_token: str | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        if not isinstance(gateway, MarketRequestGateway):
            raise TypeError("A shared market request accounting gateway is required")
        self._gateway = gateway
        self.policy = policy or MarketRequestPolicy()
        self.account_limits = account_limits or MarketAccountLimits()
        self._clock = clock
        self._identity = {"accountKey": account_key, "caseId": case_id, "policy": self.policy.to_dict(),
                          "accountLimits": self.account_limits.to_dict(self.policy)}
        validate_market_request_payload(self._identity, operation="read")
        self._execution_fence = None
        if job_id is not None or processing_token is not None:
            for value in (job_id, processing_token):
                if not isinstance(value, str) or str(UUID(value)) != value:
                    raise ValueError("A complete market execution lease is required")
            self._execution_fence = {"jobId": job_id, "processingToken": processing_token}

    def reserve_attempt(self, endpoint: str, phase: str = "baseline", vin: str | None = None,
                        *, reservation_id: str | None = None) -> AttemptReservation:
        reason = self.account_limits.configuration_reason(self._clock().astimezone(UTC))
        if reason is not None:
            raise MarketRequestBudgetExceeded(reason)
        category = _endpoint(endpoint)
        if vin is not None and (not isinstance(vin, str) or re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin.upper()) is None):
            raise ValueError("Market request VIN is invalid")
        vin_key = hashlib.sha256(vin.upper().encode()).hexdigest() if vin else None
        tariff = self.account_limits.confirmed_tariff_usd_per_attempt or {}
        payload = validate_market_request_payload({**self._identity,
            **({"executionFence": self._execution_fence} if self._execution_fence is not None else {}),
            "reservationId": reservation_id or str(uuid4()),
            "endpoint": category, "phase": phase, "vinKey": vin_key,
            "estimatedCostMicros": _cost_micros(tariff[category]) if category in tariff else None}, operation="reserve")
        try:
            result = self._gateway.reserve_market_request_attempt(payload)
        except Exception as exc:
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_UNAVAILABLE") from exc
        if not isinstance(result, Mapping) or not isinstance(result.get("allowed"), bool):
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_INVALID")
        if not result["allowed"]:
            raise MarketRequestBudgetExceeded(str(result.get("reasonCode", "MARKET_REQUEST_ACCOUNTING_INVALID")), result.get("retryAfterSeconds"))
        if result.get("reservationId") != payload["reservationId"] or not isinstance(result.get("usage"), Mapping):
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_INVALID")
        return AttemptReservation(payload["reservationId"], copy.deepcopy(result["usage"]))

    def report_response(self, status_code: int, retry_after: str | int | float | None = None,
                        quota_exhausted: bool = False,
                        *, headers: Mapping[str, str] | None = None) -> None:
        """Tighten shared state without rebasing usage or trusting a larger plan.

        The installed ledger supports durable cooldowns and a period stop, not
        arbitrary changes to pinned account limits. A stricter monthly header
        therefore stops this period for operator reconciliation. A lower rate
        contract also stops until period end; a depleted rate window only waits.
        """
        observed_delay, observed_stop = self._response_constraints(headers)
        quota_exhausted = quota_exhausted or observed_stop
        if retry_after is None and headers is not None:
            retries = [v for k, v in headers.items() if isinstance(k, str) and k.lower() == "retry-after"]
            if len(retries) == 1:
                retry_after = retries[0]
        if not quota_exhausted and status_code != 429 and retry_after is None:
            if observed_delay is None:
                return
        delay: float | None = None
        if retry_after is not None:
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                try:
                    parsed = parsedate_to_datetime(str(retry_after))
                    delay = (parsed.astimezone(UTC) - self._clock().astimezone(UTC)).total_seconds()
                except (TypeError, ValueError, OverflowError):
                    pass
            if delay is not None and (not math.isfinite(delay) or delay < 0):
                delay = None
        if status_code == 429 and delay is None:
            delay = float(self.account_limits.rate_window_seconds or 1)
        if observed_delay is not None:
            delay = max(delay or 0, observed_delay)
        payload = validate_market_request_payload({**self._identity, "retryAfterSeconds": delay,
                                                   "quotaExhausted": quota_exhausted}, operation="state")
        try:
            result = self._gateway.record_market_request_account_state(payload)
        except Exception as exc:
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_UNAVAILABLE") from exc
        if not isinstance(result, Mapping) or result.get("recorded") is not True:
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_INVALID")

    def _response_constraints(self, headers: Mapping[str, str] | None) -> tuple[float | None, bool]:
        if headers is None:
            return None, False
        values: dict[str, list[str]] = {}
        for name, value in headers.items():
            if isinstance(name, str) and isinstance(value, str):
                values.setdefault(name.lower(), []).append(value.strip())

        def value(name: str) -> str | None:
            items = values.get(name, [])
            return items[0] if len(items) == 1 and len(items[0]) <= 64 else None

        def integer(name: str) -> int | None:
            raw = value(name)
            if raw is not None and re.fullmatch(r"0|[1-9][0-9]{0,9}", raw):
                number = int(raw)
                return number if number <= 2**31 - 1 else None
            return None

        def reset_time(name: str) -> datetime | None:
            raw = value(name)
            if raw is None:
                return None
            try:
                # Accept absolute epoch seconds or explicitly zoned ISO times.
                # A bare wall time or relative count cannot establish a period.
                if re.fullmatch(r"[1-9][0-9]{9}", raw):
                    return datetime.fromtimestamp(int(raw), UTC)
                return _timestamp(raw)
            except (TypeError, ValueError, OverflowError, OSError):
                return None

        now = self._clock().astimezone(UTC)
        limits = self.account_limits
        quota_limit, quota_remaining = integer("quota-limit"), integer("quota-remaining")
        rate_limit, rate_remaining = integer("ratelimit-limit"), integer("ratelimit-remaining")
        quota_reset, rate_reset = reset_time("quota-reset-time"), reset_time("ratelimit-reset-time")
        usage = self.snapshot() if quota_remaining is not None or rate_remaining is not None else None
        stop = False
        delay = None
        if limits.monthly_allowance is not None:
            stop = quota_limit is not None and quota_limit < limits.monthly_allowance
            if quota_remaining is not None and usage is not None:
                expected = max(0, limits.monthly_allowance - usage["monthlyAttempts"])
                stop = stop or quota_remaining < expected
            if quota_reset is not None and limits.monthly_period_end is not None:
                stop = stop or quota_reset != _timestamp(limits.monthly_period_end)
        if (rate_limit is not None and limits.max_requests_per_window is not None
                and rate_limit < limits.max_requests_per_window):
            # The fixed rate contract needs operator review; a worker restart
            # must not silently restore the looser configured rate.
            if limits.monthly_period_end is not None:
                delay = max(0, (_timestamp(limits.monthly_period_end) - now).total_seconds())
            else:
                stop = True
        if rate_remaining is not None and usage is not None:
            expected_rate = max(0, (limits.max_requests_per_window or 0) - usage["rateWindowAttempts"])
            if rate_remaining == 0 or rate_remaining < expected_rate:
                cooldown = float(limits.rate_window_seconds or 1)
                if rate_reset is not None:
                    cooldown = max(cooldown, (rate_reset - now).total_seconds())
                delay = max(delay or 0, cooldown)
        return delay, stop

    def snapshot(self) -> dict[str, Any]:
        try:
            result = self._gateway.get_market_request_usage(self._identity)
        except Exception as exc:
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_UNAVAILABLE") from exc
        if not isinstance(result, Mapping) or not isinstance(result.get("totalAttempts"), int):
            raise MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_INVALID")
        return copy.deepcopy(dict(result))

    @property
    def remaining(self) -> int:
        return self.snapshot()["remainingAttempts"]


class MemoryMarketRequestGateway:
    """Atomic fixture/standalone gateway; hosted workers use the database RPCs."""

    def __init__(self, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._accounts: dict[str, dict[str, Any]] = {}
        self._case_accounts: dict[str, str] = {}
        self._policies: dict[tuple[str, str], dict[str, Any]] = {}
        self._attempts: dict[str, dict[str, Any]] = {}

    def _usage(self, data: Mapping[str, Any], now: datetime) -> dict[str, Any]:
        account_key, case_id = data["accountKey"], data["caseId"]
        account = self._accounts.get(account_key, {})
        limits = account.get("limits", data["accountLimits"])
        policy = self._policies.get((account_key, case_id), data["policy"])
        account_rows = [r for r in self._attempts.values() if r["accountKey"] == account_key]
        rows = [r for r in account_rows if r["caseId"] == case_id]
        phases = {phase: sum(r["phase"] == phase for r in rows) for phase in _PHASES}
        endpoints = {endpoint: sum(r["endpoint"] == endpoint for r in rows) for endpoint in _ENDPOINTS}
        operations = {operation: sum(r["operation"] == operation for r in rows) for operation in _OPERATIONS}
        start = _timestamp(limits["periodStart"]) if limits["periodStart"] else None
        end = _timestamp(limits["periodEnd"]) if limits["periodEnd"] else None
        monthly = ((limits["priorMonthlyAttempts"] or 0) + sum(start <= r["at"] < end for r in account_rows)
                   if start and end else 0)
        monthly_limit = ((limits["monthlyAllowance"] * (10_000 - limits["reserveBasisPoints"])) // 10_000
                         if limits["monthlyAllowance"] is not None else None)
        rate = sum((now - r["at"]).total_seconds() < (limits["rateWindowSeconds"] or 0) for r in account_rows)
        priced = [r["estimatedCostMicros"] for r in rows if r["estimatedCostMicros"] is not None]
        amount = f"{Decimal(sum(priced)) / 1_000_000:.6f}"
        return {"schemaVersion": "1", "totalAttempts": len(rows), "remainingAttempts": max(0, policy["totalAttempts"] - len(rows)),
                "phaseAttempts": phases, "endpointAttempts": endpoints, "operationAttempts": operations,
                "supportingDiscoveryAttempts": sum(r["phase"] == "supporting" and r["operation"] in {"active_discovery", "historical_discovery"} for r in rows),
                "monthlyAttempts": monthly, "monthlyRoutineLimit": monthly_limit,
                "monthlyRemainingRoutineAttempts": max(0, monthly_limit - monthly) if monthly_limit is not None else None,
                "rateWindowAttempts": rate, "estimatedBillableUsd": amount if len(priced) == len(rows) else None,
                "estimatedPricedAttemptsUsd": amount, "pricedAttempts": len(priced), "unpricedAttempts": len(rows) - len(priced),
                "policy": copy.deepcopy(policy)}

    def get_market_request_usage(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        data = validate_market_request_payload(request, operation="read")
        with self._lock:
            return self._usage(data, self._clock())

    def reserve_market_request_attempt(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        data = validate_market_request_payload(request, operation="reserve")
        with self._lock:
            now = self._clock()
            key, case = data["accountKey"], data["caseId"]
            limits = data["accountLimits"]
            account = self._accounts.setdefault(key, {"limits": copy.deepcopy(limits), "blockedUntil": None, "quotaExhaustedAt": None})
            policy = self._policies.setdefault((key, case), copy.deepcopy(data["policy"]))
            def denied(reason: str, delay: float | None = None) -> Mapping[str, Any]:
                return {"allowed": False, "reasonCode": reason, "retryAfterSeconds": delay, "usage": self._usage(data, now)}
            if self._case_accounts.setdefault(case, key) != key:
                return denied("MARKET_CASE_ACCOUNT_CHANGED")
            if account["limits"] != limits:
                old_end, new_start = account["limits"]["periodEnd"], limits["periodStart"]
                old_without_prior = {k: v for k, v in account["limits"].items() if k != "priorMonthlyAttempts"}
                new_without_prior = {k: v for k, v in limits.items() if k != "priorMonthlyAttempts"}
                monotonic_reconciliation = (old_without_prior == new_without_prior
                    and limits["priorMonthlyAttempts"] is not None and account["limits"]["priorMonthlyAttempts"] is not None
                    and limits["priorMonthlyAttempts"] >= account["limits"]["priorMonthlyAttempts"])
                if monotonic_reconciliation or (old_end and new_start and _timestamp(old_end) <= now and _timestamp(new_start) >= _timestamp(old_end)):
                    account["limits"] = copy.deepcopy(limits)
                else:
                    return denied("MARKET_ACCOUNT_CONFIGURATION_CHANGED")
            if policy != data["policy"]:
                return denied("MARKET_CASE_POLICY_CHANGED")
            actual_limits = MarketAccountLimits(monthly_allowance=limits["monthlyAllowance"], metered=limits["metered"],
                max_requests_per_window=limits["requestsPerWindow"], rate_window_seconds=limits["rateWindowSeconds"],
                monthly_period_start=limits["periodStart"], monthly_period_end=limits["periodEnd"],
                monthly_usage_before_tracking=limits["priorMonthlyAttempts"])
            reason = actual_limits.configuration_reason(now)
            if reason:
                return denied(reason)
            exhausted = account["quotaExhaustedAt"]
            if exhausted is not None and (limits["periodStart"] is None or exhausted >= _timestamp(limits["periodStart"])):
                return denied("MARKET_ACCOUNT_QUOTA_EXHAUSTED")
            if account["blockedUntil"] is not None and account["blockedUntil"] > now.timestamp():
                return denied("MARKET_ACCOUNT_THROTTLED", account["blockedUntil"] - now.timestamp())
            if data["reservationId"] in self._attempts:
                return denied("MARKET_ATTEMPT_ALREADY_RESERVED")
            usage = self._usage(data, now)
            operation = _operation(data["endpoint"], data["phase"], data["vinKey"])
            if usage["remainingAttempts"] == 0:
                return denied("MARKET_CASE_BUDGET_EXHAUSTED")
            if usage["operationAttempts"][operation] >= policy["operationLimits"][operation]:
                return denied("MARKET_ENDPOINT_BUDGET_EXHAUSTED")
            if data["phase"] == "supporting":
                if usage["phaseAttempts"]["supporting"] >= policy["supportingAttempts"]:
                    return denied("MARKET_SUPPORTING_BUDGET_EXHAUSTED")
                if operation in {"active_discovery", "historical_discovery"} and usage["supportingDiscoveryAttempts"] >= policy["supportingDiscoveryAttempts"]:
                    return denied("MARKET_SUPPORTING_DISCOVERY_BUDGET_EXHAUSTED")
            if data["endpoint"] == "vin_history":
                used = sum(r["accountKey"] == key and r["caseId"] == case and r["endpoint"] == "vin_history" and r["vinKey"] == data["vinKey"] for r in self._attempts.values())
                if used >= policy["perVinHistoryAttempts"]:
                    return denied("MARKET_VIN_HISTORY_BUDGET_EXHAUSTED")
            if usage["monthlyRoutineLimit"] is not None and usage["monthlyAttempts"] >= usage["monthlyRoutineLimit"]:
                return denied("MARKET_MONTHLY_RESERVE_REACHED")
            if usage["rateWindowAttempts"] >= limits["requestsPerWindow"]:
                recent = [r["at"] for r in self._attempts.values() if r["accountKey"] == key and (now - r["at"]).total_seconds() < limits["rateWindowSeconds"]]
                return denied("MARKET_ACCOUNT_RATE_LIMIT_REACHED", max(0.0, limits["rateWindowSeconds"] - (now - min(recent)).total_seconds()))
            self._attempts[data["reservationId"]] = {**data, "operation": operation, "at": now}
            return {"allowed": True, "reservationId": data["reservationId"], "reasonCode": "MARKET_REQUEST_RESERVED", "usage": self._usage(data, now)}

    def record_market_request_account_state(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        data = validate_market_request_payload(request, operation="state")
        with self._lock:
            now = self._clock()
            account = self._accounts.setdefault(data["accountKey"], {"limits": copy.deepcopy(data["accountLimits"]), "blockedUntil": None, "quotaExhaustedAt": None})
            if data["retryAfterSeconds"] is not None:
                account["blockedUntil"] = max(account["blockedUntil"] or 0, now.timestamp() + data["retryAfterSeconds"])
            if data["quotaExhausted"]:
                account["quotaExhaustedAt"] = now
            return {"recorded": True}
