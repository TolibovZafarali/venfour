#!/usr/bin/env python3
"""Search dated MarketCheck inventory and print canonical Venfour JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote, quote_plus


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from venfour.historical_market import (  # noqa: E402
    OUT_OF_PROVIDER_RANGE,
    HistoricalMarketSearchRequest,
    discover_historical_market_evidence,
    normalize_historical_market_search_request,
)
from venfour.market import MarketDiscoveryError  # noqa: E402
from venfour.marketcheck import (  # noqa: E402
    MarketCheckHistoricalProvider,
    marketcheck_historical_coverage,
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Search MarketCheck past inventory for one exact evidence date and "
            "print only the provider-neutral HistoricalMarketSearchResult JSON."
        )
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--make", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--trim")
    parser.add_argument("--mileage", type=int)
    parser.add_argument("--postal-code", required=True)
    parser.add_argument("--radius", type=int, default=50)
    parser.add_argument("--limit", type=int, default=25)
    return parser.parse_args(argv)


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _read_api_key() -> str:
    return os.environ.get("MARKETCHECK_API_KEY", "")


def _redact_secret(value: str, secret: str | None) -> str:
    if not isinstance(secret, str) or not secret:
        return value
    variants = {
        secret,
        json.dumps(secret, ensure_ascii=False)[1:-1],
        repr(secret)[1:-1],
        quote(secret, safe=""),
        quote_plus(secret),
    }
    redacted = value
    for variant in sorted(variants, key=len, reverse=True):
        if variant:
            redacted = redacted.replace(variant, "[REDACTED]")
    return redacted


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    api_key: str | None = None
    try:
        request = normalize_historical_market_search_request(
            HistoricalMarketSearchRequest(
                evidence_date=args.date,
                year=args.year,
                make=args.make,
                model=args.model,
                trim=args.trim,
                loss_vehicle_mileage=args.mileage,
                postal_code=args.postal_code,
                radius_miles=args.radius,
                result_limit=args.limit,
            )
        )
        as_of_date = _utc_today()
        coverage = marketcheck_historical_coverage(
            request.evidence_date,
            as_of_date=as_of_date,
        )

        if coverage.status == OUT_OF_PROVIDER_RANGE:
            provider = MarketCheckHistoricalProvider(
                None,
                as_of_date=as_of_date,
            )
        else:
            api_key = _read_api_key()
            provider = MarketCheckHistoricalProvider(
                api_key,
                as_of_date=as_of_date,
            )
        result = discover_historical_market_evidence(request, provider)
    except MarketDiscoveryError as exc:
        message = _redact_secret(str(exc), api_key)
        print(f"Error: {message}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            result.to_dict(),
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
