"""Preview or publish one local completed response's missing recommendation."""

from __future__ import annotations

import argparse
import json
import os
from urllib.parse import urlsplit

from venfour.insurer_response_processing import backfill_current_insurer_response_recommendation
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration


def require_local_configuration() -> SupabaseServerConfiguration:
    if any(os.environ.get(key) for key in ("K_SERVICE", "CLOUD_RUN_JOB", "VENFOUR_STAGING_PROXY_SECRET")):
        raise ValueError("Recommendation backfill is restricted to local development.")
    configured_url = urlsplit(os.environ.get("SUPABASE_URL", ""))
    if (
        configured_url.scheme != "http"
        or configured_url.hostname not in {"localhost", "127.0.0.1", "::1"}
        or configured_url.port != 54321
        or configured_url.username is not None
        or configured_url.path not in {"", "/"}
        or configured_url.query
        or configured_url.fragment
    ):
        raise ValueError("Recommendation backfill requires the local Supabase service on port 54321.")
    return SupabaseServerConfiguration.from_environment()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-id", required=True, help="One exact local case UUID")
    parser.add_argument("--apply", action="store_true", help="Publish the previewed policy result; default is read-only")
    args = parser.parse_args()
    gateway = SupabaseHttpGateway(require_local_configuration())
    try:
        result = backfill_current_insurer_response_recommendation(gateway, args.case_id, apply=args.apply)
        print(json.dumps(result, indent=2, sort_keys=True))
    finally:
        gateway.close()


if __name__ == "__main__":
    main()
