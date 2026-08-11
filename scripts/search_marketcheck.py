#!/usr/bin/env python3
"""Run an explicit live MarketCheck search and print canonical Venfour JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from venfour.market import (  # noqa: E402
    MarketDiscoveryError,
    MarketSearchRequest,
    discover_market_listings,
)
from venfour.marketcheck import MarketCheckProvider  # noqa: E402


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Search active used MarketCheck inventory and print only the "
            "provider-neutral MarketSearchResult JSON."
        )
    )
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--make", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--trim")
    parser.add_argument("--mileage", type=int)
    parser.add_argument("--postal-code")
    parser.add_argument("--radius", type=int, default=50)
    parser.add_argument("--limit", type=int, default=25)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = MarketSearchRequest(
            year=args.year,
            make=args.make,
            model=args.model,
            trim=args.trim,
            loss_vehicle_mileage=args.mileage,
            postal_code=args.postal_code,
            radius_miles=args.radius,
            result_limit=args.limit,
        )
        provider = MarketCheckProvider(os.environ.get("MARKETCHECK_API_KEY", ""))
        result = discover_market_listings(request, provider)
    except MarketDiscoveryError as exc:
        print(f"Error: {exc}", file=sys.stderr)
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
