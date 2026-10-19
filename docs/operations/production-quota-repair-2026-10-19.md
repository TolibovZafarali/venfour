# Production quota repair — October 19, 2026

Production analysis admission is restored. At 17:04 Central (22:04 UTC),
`venfour-api-production-quota-20261019` served 100% of production API traffic;
backend health/readiness and application health returned HTTP 200.

## Cause

The serving revision still declared the MarketCheck quota period as September 1
through October 1, 2026 UTC. The backend returned HTTP 503 from `/ready` with
`MARKET_ACCOUNT_QUOTA_PERIOD_INACTIVE`. Analysis availability was therefore false,
and submission stopped before claiming a job or creating a run. The customer
intake and retry behavior were working as designed.

The provider dashboard showed the Free subscription, 500 calls per month,
5 calls per second and a 100-mile radius. Its October 1–19 account-wide usage
view showed zero calls, with data last synchronized at 21:49 UTC. The production
credential matched the prefix/suffix of the dashboard's sole active key.
[Provider documentation](https://docs.marketcheck.com/docs/get-started/api/quota-and-rate-limits)
confirms calendar-month quota resets across all account keys.

## Change

Only two runtime variables changed:

| Variable | Previous value | New value |
| --- | --- | --- |
| `MARKETCHECK_QUOTA_PERIOD_START` | `2026-09-01T00:00:00Z` | `2026-10-01T00:00:00Z` |
| `MARKETCHECK_QUOTA_PERIOD_END` | `2026-10-01T00:00:00Z` | `2026-11-01T00:00:00Z` |

The exact deployed image remained
`us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:be418a75d6e437440e303da4cc130a920258ccc1a561446dc20b3cadac3279ed`.
All other runtime specification fields and existing traffic tags were preserved.
The 500-call allowance, 20% reserve, 60-attempt case cap and rate/radius limits
remain unchanged. The previous four-attempt prior-usage allowance was retained
conservatively, despite the provider's zero-call October display.

No ledger rows were changed or removed. The existing reservation function accepts
the next non-overlapping period on the first normal request while retaining all
historical attempts and cumulative case limits. The saved September accounting
snapshot reported 97 attempts including prior usage. Staging has no market
credential and was left unchanged.

## Verification

- Twelve targeted offline backend tests passed, covering readiness expiry,
  submission admission, cumulative limits across months, overlapping-period
  rejection and monotonic usage reconciliation. No unexpected network attempts.
- The frontend saved-intake/unavailable/retry regression passed. It verifies that
  retry confirms intake and submits exactly once after availability returns.
- The read-only due-response-job query returned zero jobs; the production task
  queue was running and empty before candidate startup.
- A tagged candidate first received zero traffic. Health and readiness returned
  HTTP 200; the runtime diff contained only the two date variables above.
- After promotion, service metadata confirmed the exact candidate at 100%.
  Backend `/health`, backend `/ready` and application `/health` returned their
  expected JSON with HTTP 200. The candidate's sampled error log was empty.
- An initial Python HTTP smoke attempt received HTTP 403; the standard curl
  checks above passed. No actual customer valuation was submitted for testing.

These checks establish restored admission readiness, not a completed hosted
valuation. Saved customers can use **Try again**. No provider request, payment,
customer message, application rebuild or database migration was performed.

## Renewal and recovery

This is a fixed-period configuration repair. Reconcile provider usage and renew
the quota window before **October 31, 2026 at 19:00 Central** (November 1 at
00:00 UTC), or admission will close again. Automatic rollover must account for
all usage across shared keys; it must not assume unknown outside usage is zero.

The previous revision, `venfour-api-production-release-0924-3b10a43`, and all
existing tags remain available. Returning traffic there restores the expired
configuration and is containment only. Prefer a forward configuration correction;
never rewind quota accounting after the new period has been adopted.

Private before/candidate/after service snapshots and preflight/postpromotion
reports are retained in
`/Users/zafaralitolibov/.venfour-releases/2026-10-19-quota-repair/`.
