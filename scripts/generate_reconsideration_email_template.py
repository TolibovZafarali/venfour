"""Snapshot the shared reconsideration copy into its database migration."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "templates/total-loss-reconsideration-email.json"
TARGET = ROOT / "supabase/migrations/20260916000100_total_loss_reconsideration_template.sql"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    template = json.loads(SOURCE.read_text())
    content = json.dumps(template, ensure_ascii=False, indent=2)
    if "$copy$" in content:
        raise ValueError("Template contains the SQL delimiter")
    sql = (
        "-- Generated from templates/total-loss-reconsideration-email.json.\n"
        "-- Run scripts/generate_reconsideration_email_template.py to refresh this snapshot.\n"
        "create function public.total_loss_reconsideration_template_internal()\n"
        "returns jsonb language sql immutable set search_path = '' as $function$\n"
        "  select $copy$" + content + "$copy$::jsonb;\n"
        "$function$;\n"
        "revoke execute on function public.total_loss_reconsideration_template_internal()\n"
        "  from public, anon, authenticated, service_role;\n"
    )
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != sql:
            raise SystemExit("Reconsideration email template migration is stale.")
    else:
        TARGET.write_text(sql)


if __name__ == "__main__":
    main()
