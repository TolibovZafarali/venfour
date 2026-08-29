# Local post-Continue design checkpoint

This workflow is for synthetic localhost cases only. It does not activate any
deployed environment. Milestone 7 is not included.

## Start

From the repository root:

```sh
colima start
VENFOUR_LOCAL_POST_CONTINUE=1 node scripts/dev-local.mjs
```

Once the launcher reports ready, install the local SQL from a second terminal
in the repository root (safe to repeat):

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow install
```

Open `http://localhost:5173/_local/claims`. Create a supportable or exception
case. The harness creates a genuine completed analysis from deterministic
offline providers and attaches it to your current session. It does not submit
an uploaded report or contact a report-review model. If signed out, the normal
guest-session flow creates an anonymous session.

On the preview, **Continue my review** initializes the claim and opens `/claim`.
An anonymous owner first sees **Secure and save your claim**. Its email is shown
on that screen. Select **Send secure link**, then open the message in
`http://127.0.0.1:54324`. The actual magic-link callback transfers the same case
to its matching permanent account. A matching permanent owner goes directly to
checkout.

## Payment and package processing

No sandbox Stripe configuration was present at this checkpoint. Checkout shows
a **synthetic $1 fixture**, not a proposed product price. The regular checkout
button cannot create a fake paid state. For design iteration, copy the case ID
from the URL and run:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow pay CASE_ID
```

This terminal-only helper requires a marked synthetic case and a permanently
secured owner. It uses the existing checkout reservation, session attachment,
verified-payment fulfillment, and entitlement/package enqueue operations. Its
identifiers are explicitly local and its provider mode is always test mode.
Refresh checkout to see processing. To finish processing:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow process CASE_ID
```

The command processes only that case's durable work items. Generation, private
PDF storage, release decisions, and customer access use the existing contracts.
The injected reviewer produces either `PASS / HIGH` or `HUMAN_REVIEW`. Its
model identifier is `local-deterministic-fixture-v1` and usage counters are zero.
The fixture evaluation attestation is local test input, not production approval.

- **Supportable:** the real guide, report download, deterministic email draft,
  sent confirmation, and waiting state are available.
- **Exception:** the real quality-review hold is available; no report is released.
- **No-dispute:** manual mode is not enabled. The current package contract
  reproduces the immutable preliminary classification, so an eligible undervalue
  preview cannot become no-dispute through the injected reviewer. Existing
  offline report/release/refund and customer-flow tests cover this state. A
  separate downstream fixture requires an explicit scope decision; the harness
  does not alter frozen evidence or loosen release validation to manufacture it.

To use actual hosted test Checkout separately, supply the repository's existing
Stripe sandbox settings and start with both `VENFOUR_LOCAL_POST_CONTINUE=1` and
`VENFOUR_LOCAL_STRIPE_CHECKOUT=1`. Live keys are rejected. Actual sandbox Checkout
payments must complete through Stripe and its existing verified webhook endpoint;
the terminal helper refuses to fulfill an actual Checkout session. This was not
functionally tested because sandbox configuration was absent.

## Repeat or reset

The simplest repeat is another case from `/_local/claims`; other fixtures remain
untouched. To repeat secure-claim, sign out first. For the same synthetic case:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow reset CASE_ID
```

Then reopen `/total-loss/cases/CASE_ID/analysis`. Reset removes only the selected
marked case's post-Continue database rows. It preserves the completed analysis,
intake, contact, and current owner. It does not turn a permanent owner back into
an anonymous owner. Previously generated private PDF blobs remain inaccessible
after their authorization records are removed; they are not shared fixtures.

Reset refuses unmarked cases and cases with an active processing lease. The
local CLI discovers the repository's running local stack; it accepts no database
URL, project-ref, or linked-project option and requires loopback ports 54321 and
54322. Immutable-row cleanup uses a transaction-scoped database setting and a
fixed table allowlist; there is no reset RPC or browser button.

## Guards and initialization

- The frontend requires development compilation, the explicit feature flag,
  and a loopback hostname. Production compilation removes the harness route.
- The launcher sets `VITE_ENABLE_POST_CONTINUE_FLOW=true` only when its local
  server flag is explicitly enabled. Normal startup keeps Continue inert.
- Only `scripts.local_claim_flow:create_app` mounts the initializer and fixture
  endpoints. `venfour.api:create_app` never mounts them.
- The local factory rejects deployed-process markers, staging proxy secrets,
  remote service origins, live payment keys, remote request hosts/origins, and
  nonloopback clients. It strips report/market provider credentials and blocks
  external DNS connections except the challenge verifier and explicitly enabled
  Stripe test Checkout.
- SQL is installed from `scripts/local-post-continue.sql`, not a migration. It
  is never pushed to linked Supabase. Both initialization functions are denied
  to `anon` and `authenticated`; only the trusted local server can invoke them.
- The bodyless initialization API authenticates the current owner, validates
  and projects the stored artifact, and sends only server-derived values to the
  database. A case/details lock fences source identity and concurrent tabs. One
  immutable snapshot and one workflow are created atomically. Existing workflows
  are returned through the real resolver without creating payments or packages.
- The local SQL also fixes the empty-statistic projection exposed by manual
  fixtures with zero insurer comparables. This correction has not been migrated
  or deployed to any remote environment.

The normal `/ready` endpoint correctly remains unavailable without provider
credentials. The local design launcher checks `/health` instead; this is not
evidence that real report ingestion or market discovery is configured.

## Verification commands

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m unittest tests.local_claim_flow_integration -v
.venv/bin/python -m unittest tests.test_local_claim_flow tests.test_case_claim_access tests.test_customer_delivery tests.test_commerce tests.test_package_processing tests.test_package_processing_api tests.test_report_processing tests.test_report_release_gate tests.test_report_review -v
frontend/node_modules/.bin/supabase test db
cd frontend
npm test -- --run
npm run typecheck
```

The integration suite creates separately marked synthetic cases and synthetic
accounts. It exercises actual local database authorization, simultaneous
initialization, paid and released resume states, exception review, and reset
preservation. It performs no remote customer flows.

Stop the launcher with Ctrl+C. Restart without `VENFOUR_LOCAL_POST_CONTINUE=1`
to restore the ordinary dormant local behavior. No commit, push, deployment,
linked migration, or remote customer test is part of this procedure.
