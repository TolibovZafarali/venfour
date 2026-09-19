# Python backend scope

Start at the affected route in `api.py`, then its imported service and matching
`tests/test_*.py`. Use symbol/route searches and bounded reads: API, gateway, commerce,
and analysis modules are large. See the backend rows of
[repository-map.md](../docs/engineering/repository-map.md).

- Existing validated Python contracts are authoritative. Preserve deterministic
  evidence eligibility, scoring, historical verification, discrepancy classes,
  immutable runs, replay integrity, and provider-neutral interfaces.
- For extraction changes, interpretation must produce strict structured data
  before deterministic validation. Do not replace domain rules with subjective output.
- For commerce/release changes, preserve ownership, immutable matching lineage,
  strict assessment identity/digest, qualifying evidence, unresolved-check rejection,
  staff approval where enabled, idempotency, and recovery. Never fabricate paid
  entitlements or weaken gates to make tests pass.
- For providers/search, use fixtures and existing budgets/cache/retention rules.
  Read `docs/engineering/market-search.md` only for relevant search changes. Live
  MarketCheck or other metered calls require explicit task authorization.
- Prefer `.venv/bin/python scripts/run_offline_tests.py test_module` from repository
  root. It clears credentials and rejects unmocked networking/child processes.
  Select the actual affected module/class/test; no arguments runs the full suite.
- Broaden to API, presentation, persistence, or frontend contract tests only when
  those boundaries change. A backend edit alone never implies a deployment or
  a production database/provider probe. Apply this guidance when editing its tests.
