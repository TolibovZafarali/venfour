# Full-flow local development

Use this mode to exercise intake, real value checks, claim continuation, email
verification, Stripe sandbox checkout, background processing, and report delivery
in one running application. Hosted environments and the ordinary launcher mode
are unchanged. Use synthetic customer information and test payment details.

From the repository root:

```sh
colima start
node scripts/dev-local.mjs --full-flow
```

Open `http://localhost:5173`. Verification messages go to the local email inbox at
`http://127.0.0.1:54324`. Real document understanding, market evidence, and report
review use the configured providers and incur their normal development usage.
Stripe uses test mode only; no real customer payment is accepted in this mode.

## Startup and configuration

Keep the existing document/market keys and complete Stripe sandbox configuration
in the ignored root `.env`, following `.env.example`. The sandbox Price and local
webhook signing secret must match that same sandbox account. The launcher checks
the signing secret privately, applies checked-in migrations only to local
Supabase, and installs the existing local continuation SQL. It never resets data.

The launcher starts the sandbox listener automatically. It reuses an existing
managed listener only when its configuration matches. Port 54325 is the loopback
listener health and single-instance boundary. Stop older manually started CLI
listeners before using this workflow; do not run a second listener alongside it.
On shutdown, the launcher stops the listener it started; a reused standalone
listener remains running.

If review settings are absent, this mode selects the exact model and contract
versions from the checked-in report-review qualification, after validating its
current hashes, all-pass result, and integrity. These defaults exist only in the
local backend process. An incomplete override, disabled release gate, missing
qualification, or stale qualification fails startup. No evaluation result is
fabricated and no qualification or release contract is changed. A report still
requires its own successful review; uncertain or failed reviews remain held.

Full-flow startup rejects live payment keys, remote database origins, deployed
process markers, remote task dispatch, the legacy API, and mixed fixture mode.
The backend accepts only local hosts, clients, and the configured local browser
origins. Outbound connections are restricted to loopback services and the
document, market, test-payment, and challenge-verification providers.

## Processing and recovery

The local worker uses the existing dispatcher reservations, lease expiry,
execution fencing, retry delays, immutable evidence, payment entitlements, and
report processors. It does not edit ledger rows or create paid states. It handles
one work item at a time and resumes due work after a restart. No remote queue or
public worker endpoint is needed. `/ready` includes worker health.

The continuation initializer authenticates the existing owner and uses the saved
analysis. Only eligible results may continue. The browser never supplies a frozen
valuation, payment success, report approval, or another owner's identity.

Test intake → value check → Continue my review → local email code → sandbox
payment → processing → report or honest review hold. Also check reload, returning
to an existing case, wrong-owner recovery, declined payment, and duplicate events.
Customer downloads must still come through the existing private Storage boundary.

Uploaded-report analyses save their exact extraction alongside the immutable run.
Package preparation uses that evidence without changing customer-confirmed intake
or guessing an insurer name absent from the document.

For a local sandbox purchase created before this handoff, a missing-source failure
can be recovered with `scripts/recover_local_report_package.py`. First obtain a
validated extraction wrapper from the original private PDF; keep that temporary
file private. The helper verifies the PDF hash and every original valuation input,
previews source sealing and assessment, and defaults to rolling back all changes:

```sh
VENFOUR_LOCAL_FULL_FLOW=1 .venv/bin/python -m scripts.recover_local_report_package \
  --case-id <local-case-id> --evidence <private-extraction-json>
```

Add `--apply` only after a successful preview. Recovery creates one successor
attempt under the existing active sandbox entitlement. It preserves the failed
attempt, payment, saved valuation, and customer details. Changed inputs, existing
sealed sources, remote databases, and live-payment purchases are rejected. The
normal worker still performs report review and release. Delete the temporary
extraction file after recovery; the durable evidence stays in private storage.
“Check again” only refreshes status; it does not restart terminal failures.

## Separate fixture workflow

The existing `VENFOUR_LOCAL_POST_CONTINUE=1` workflow remains intentionally offline
and keeps its synthetic cases, payment helper, and deterministic review fixtures.
Its setup is documented in [local claim testing](local-claim-testing.md). Do not
combine that flag with `--full-flow`. Fixture-creation routes are absent from the
full-flow server and browser. Do not mix queued synthetic-payment cases into a
full-flow run; keep sandbox purchases and their immutable records intact.
