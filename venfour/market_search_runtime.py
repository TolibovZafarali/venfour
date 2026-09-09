"""Explicit runtime settings for bounded case-owned market research."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime

from venfour.efficient_search import EfficientSearchPolicy
from venfour.market_request_budget import MarketAccountLimits, MarketRequestPolicy, market_account_key


def search_policy_from_environment(
    environment: Mapping[str, str], request_policy: MarketRequestPolicy,
    *, case_maximum_distance_miles: int | None = None,
) -> EfficientSearchPolicy:
    names = {
        "local_radius_miles": "MARKETCHECK_SEARCH_LOCAL_RADIUS_MILES",
        "outer_boundary_miles": "MARKETCHECK_SEARCH_OUTER_BOUNDARY_MILES",
        "additional_centers": "MARKETCHECK_SEARCH_ADDITIONAL_CENTERS",
        "page_size": "MARKETCHECK_SEARCH_PAGE_SIZE",
        "pages_per_center": "MARKETCHECK_SEARCH_PAGES_PER_CENTER",
        "verification_batch_size": "MARKETCHECK_SEARCH_VERIFICATION_BATCH_SIZE",
        "max_observations": "MARKETCHECK_SEARCH_MAX_OBSERVATIONS",
        "supporting_maximum_listings": "MARKETCHECK_SUPPORTING_MAXIMUM_LISTINGS",
        "current_context_pages_after_historical": "MARKETCHECK_SEARCH_CURRENT_CONTEXT_PAGES",
    }
    values = {}
    for field, name in names.items():
        value = environment.get(name, "").strip()
        if value:
            if re.fullmatch(r"0|[1-9][0-9]*", value) is None:
                raise ValueError(f"{name} must be a nonnegative integer")
            values[field] = int(value)
    return EfficientSearchPolicy(
        **values, case_maximum_distance_miles=case_maximum_distance_miles,
        history_pages_per_vin=min(3, max(1, request_policy.per_vin_history_attempts)),
        supporting_attempts=min(5, request_policy.supporting_attempts),
        supporting_discovery_requests=min(2, request_policy.supporting_discovery_attempts),
    )


def case_evidence_retention_days(environment: Mapping[str, str]) -> int | None:
    """No checkpoint retention is inferred from access to an endpoint."""
    value = environment.get("MARKETCHECK_CASE_EVIDENCE_RETENTION_DAYS", "").strip()
    if not value:
        return None
    if re.fullmatch(r"[1-9][0-9]*", value) is None or not 1 <= int(value) <= 30:
        raise ValueError("Confirmed case evidence retention must be between 1 and 30 days")
    return int(value)


def market_search_configuration_reason(environment: Mapping[str, str], *, now: datetime | None = None) -> str | None:
    """Validate configured account/search facts without contacting any service."""
    identifier = environment.get("MARKETCHECK_ACCOUNT_IDENTIFIER", "").strip()
    if not identifier:
        return "MARKET_ACCOUNT_IDENTIFIER_REQUIRED"
    try:
        market_account_key(identifier)
    except (TypeError, ValueError):
        return "MARKET_ACCOUNT_IDENTIFIER_INVALID"
    account_groups = (
        (("MARKETCHECK_RATE_LIMIT_REQUESTS", "MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS"), "MARKET_ACCOUNT_RATE_LIMIT_INVALID"),
        (("MARKETCHECK_MONTHLY_REQUEST_ALLOWANCE", "MARKETCHECK_ACCOUNT_METERED"), "MARKET_ACCOUNT_MONTHLY_ALLOWANCE_INVALID"),
        (("MARKETCHECK_MONTHLY_USAGE_BEFORE_TRACKING",), "MARKET_ACCOUNT_PRIOR_USAGE_INVALID"),
        (("MARKETCHECK_QUOTA_PERIOD_START", "MARKETCHECK_QUOTA_PERIOD_END"), "MARKET_ACCOUNT_QUOTA_PERIOD_INVALID"),
        (("MARKETCHECK_CONFIRMED_TARIFF_USD_PER_ATTEMPT",), "MARKET_ACCOUNT_TARIFF_INVALID"),
    )
    for names, reason in account_groups:
        try:
            MarketAccountLimits.from_environment({name: environment[name] for name in names if name in environment})
        except (TypeError, ValueError):
            return reason
    account = MarketAccountLimits.from_environment(environment)
    reason = account.configuration_reason(now or datetime.now(UTC))
    if reason is not None:
        return reason
    try:
        request_policy = MarketRequestPolicy.from_environment(environment)
    except (TypeError, ValueError):
        return "MARKET_REQUEST_POLICY_INVALID"
    if not environment.get("MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES", "").strip():
        return "MARKET_ACCOUNT_RADIUS_UNCONFIGURED"
    try:
        from venfour.marketcheck import marketcheck_account_radius_from_environment
        marketcheck_account_radius_from_environment(environment)
        search_policy_from_environment(environment, request_policy)
    except (TypeError, ValueError):
        return "MARKET_SEARCH_POLICY_INVALID"
    try:
        case_evidence_retention_days(environment)
    except (TypeError, ValueError):
        return "MARKET_CASE_EVIDENCE_RETENTION_INVALID"
    return None
