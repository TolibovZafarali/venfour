# Local combined purchase review

This workflow is for synthetic localhost cases only. It does not activate any
deployed environment. Milestone 7 is not included.

For real intake and analysis followed by sandbox checkout and automatic local
processing, use [full-flow local development](local-full-flow.md) instead.

## Start

From the repository root:

```sh
colima start
VENFOUR_LOCAL_POST_CONTINUE=1 node scripts/dev-local.mjs
```

Once the launcher reports ready, apply outstanding migrations only to the local
stack and install the local harness SQL from a second terminal (safe to repeat):

```sh
frontend/node_modules/.bin/supabase migration up --local
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow install
```

Open `http://localhost:5173/_local/claims`. Create a supportable or exception
case. The harness creates a genuine completed analysis from deterministic
offline providers and attaches it to your current session. It does not submit
an uploaded report or contact a report-review model. If signed out, the normal
guest-session flow creates an anonymous session.

On the preview, **Continue my review** initializes the claim; `/claim` resolves
the recognized owner directly to `/total-loss/cases/CASE_ID/claim/checkout`.
This one page contains the saved, masked email, verification, payment, package
summary, server-provided price, refund policy, and settlement disclaimer.

## Three identity scenarios

### A. Recognized anonymous owner

1. Open `http://localhost:5173/_local/claims` and select **Start a new anonymous session**.
2. Select **Create supportable case**, then **Continue my review**.
3. Expect the combined purchase page with the masked saved email, **Send verification code**,
   and a locked payment section. There is no email-entry form and no payable client secret.
4. Select **Send verification code**. The purchase page stays visible with the inline
   six-digit code field and **Verify**. A resend countdown is shown; **Resend code**
   appears only when the cooldown ends and remains subject to Supabase Auth's throttle.
5. Open `http://127.0.0.1:54324` and open the newest message for the synthetic
   `local-claim-CASE_PREFIX@example.test` address. The subject is **Your Venfour
   verification code** and the body displays the code as `123-456`, without a
   magic-link button. Read the code, then type or paste it into the purchase page;
   raw digits, a dash, or a space are accepted and formatted as `123-456`.
6. Select **Verify**. Successful verification completes the existing case-bound
   ownership transfer and shows the masked email as verified on the same checkout
   URL. There is no `/auth/callback` or `/appraisals` navigation. Payment becomes
   available subject to the existing sandbox configuration.

See [local purchase-page email verification](local-claim-email-otp.md) for template
selection, rate limits, six-digit formatting, and the separately authorized hosted
configuration checklist. Local Auth email goes to Mailpit, not an external inbox.

### B. Lost-session recovery

1. Copy the case ID from scenario A's URL before ending its session.
2. Return to `/_local/claims` and select **Start a new anonymous session**.
3. Paste the copied ID into **Case ID to reopen** and select **Reopen purchase**.
4. Expect the separate neutral **Email used for this claim** form. It must not
   show the saved email, quote, or payment fields. The same holds for a different
   permanent account. Submitting the known synthetic email follows existing
   neutral recovery behavior; the local inbox link can restore the matching owner.

The test panel signs out the current local test account using the existing
global sign-out behavior, which can revoke its other local sessions, then starts
a new anonymous session. It does not delete cases or payments.
Creating a new case in the current anonymous session is the easiest way to return
to scenario A. An inaccessible old anonymous case requires email recovery.

### C. Already verified permanent owner

1. Complete scenario A's verification and remain signed in.
2. Reload or reopen `/total-loss/cases/CASE_ID/claim/checkout`.
3. Expect the masked saved email marked **verified** immediately, no code request
   or email-entry field, and payment initialization if Stripe sandbox configuration
   is available. A verified permanent owner whose email matches the saved contact
   email does not receive another code.
4. Alternatively create another fixture while signed in; its contact email uses
   the permanent account's email, so Continue skips verification.

Normal post-Continue verification now stays inline on checkout. Previously issued
post-Continue links and the separate recovery flow still support the legacy
callback and return to checkout. Existing intake-purpose links retain their prior
`/appraisals` behavior. Replay, expiry, exact email, current source, and paid
ownership-transfer protections remain in force.

## Payment and package processing

Without sandbox Stripe configuration, checkout shows a **synthetic $1 fixture**,
not a proposed product price. After verification it truthfully reports payment
setup as unavailable; it does not render pretend card fields. The regular
checkout button cannot create a fake paid state. For design iteration, copy the
case ID from the URL and run:

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

## Stripe sandbox Payment Element

Set the existing commerce values from `.env.example` in the ignored root `.env`,
including `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID`, product/version/terms/refund identifiers,
and the webhook signing secret. Use test keys and a one-time test Price. Never
place the secret key or webhook secret in a `VITE_*` variable. The publishable
key is returned by the authenticated checkout API only when payment is ready.

Use an authenticated Stripe CLI in test mode to forward sandbox webhook events:

```sh
stripe listen --forward-to http://127.0.0.1:8000/webhooks/stripe
```

Set that listener's signing secret in `STRIPE_WEBHOOK_SECRET` without copying it
into logs or documentation. Then restart the ordinary local launcher with both flags:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 VENFOUR_LOCAL_STRIPE_CHECKOUT=1 node scripts/dev-local.mjs
```

The integration preserves Checkout Sessions using the installed SDK's supported
`ui_mode=elements` (the current name for custom Elements Checkout), with official
`@stripe/react-stripe-js/checkout` and `@stripe/stripe-js/pure`. It does not create
direct PaymentIntents. The server owns the Price, amount, purchaser email,
return URL, metadata, and idempotency keys. Existing attached hosted Sessions
are expired and reconciled before a replacement attempt can be created on the
same logical order. A narrowly detected legacy pre-attachment idempotency
conflict recovers the original hosted Session using its exact old request;
unrecognized errors fail closed.

Only a permanent verified user who exactly owns the secured eligible case and
matches the saved contact email can receive a payable client secret. Anonymous
owners can retrieve only the read-only quote. Stripe.js loads after successful
authorized initialization. Card number, expiry, and CVC stay in Stripe-hosted
iframes and go directly to Stripe; Venfour has no raw card input or proxy.

Successful confirmation stays on the purchase page while the server reconciles.
Only authoritative entitlement routes to `/claim/processing`; the browser cannot
grant access. Orders, attempts, payment transactions, entitlements, refunds,
disputes, and the entitlement-to-package hook keep their existing contracts.

Test the following using Stripe's [official sandbox cards](https://docs.stripe.com/testing):

- Successful payment: confirm in-page waiting, a verified webhook, exactly one
  order/payment/entitlement, then processing.
- Required card authentication: complete and cancel the challenge; cancellation
  must allow retry without granting access.
- Decline: show the Stripe error and allow retry without a second logical order.
- Refresh/two tabs/close and reopen before paying: reuse the open Session.
- Close during confirmation or pause webhook forwarding: never claim payment
  success early; resume from the saved server state when forwarding restarts.
- Expired, unpaid, invalid, or cross-case return Session: no entitlement; recover
  an authorized unpaid checkout only after checking its server state.

The terminal helper refuses to fulfill a real Stripe Session. Synthetic helper
success and mocked SDK tests do not prove iframe loading or 3-D Secure completion.

## Local content security policy

Only the development purchase server adds the policy in `frontend/vite.config.ts`.
Ordinary development, production builds, and the deployed Worker policy remain
unchanged. Based on Stripe's [integration security guide](https://docs.stripe.com/security/guide),
the added Stripe sources are:

| Source | Directive | Purpose |
| --- | --- | --- |
| `https://js.stripe.com` | script, frame | Official Stripe.js and secure payment fields |
| `https://*.js.stripe.com` | script, frame | Stripe.js documented isolated frame origins |
| `https://hooks.stripe.com` | frame | Supported card authentication frames |
| `https://api.stripe.com` | connect | Stripe.js requests directly to Stripe |

There is no broad `https:` connection/script/frame allowance and no `*.stripe.com`
wildcard. Link, address autocomplete, hosted Checkout, and external fonts are not
enabled. A per-server random nonce permits Vite's inline development bootstrap;
scripts do not use `unsafe-inline` or `unsafe-eval`. Inline styles support the
existing styling runtime. Remaining sources cover same-origin assets, loopback
Supabase, Vite's loopback WebSocket, and the existing Turnstile test widget.
The local server also sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Repeat or reset

The simplest repeat is another case from `/_local/claims`; other fixtures remain
untouched. To repeat secure-claim, sign out first. For the same synthetic case:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow reset CASE_ID
```

Use this database reset for synthetic terminal-helper purchases only. It does
not expire or refund real Stripe sandbox Sessions/payments. For real Stripe
test repeats, create a fresh case; manage any prior sandbox Session/payment
through Stripe's test tools rather than removing its local ledger records.

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
- The launcher enables continuation for an explicit fixture or full-flow mode.
  Fixture creation has a separate flag. Normal startup keeps Continue inert.
- The fixture factory mounts initializer and fixture endpoints. The separate
  full-flow factory mounts only the initializer. `venfour.api:create_app` never
  mounts either local endpoint.
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

## Review verification: 2026-08-29

- Full Python suite: 1,139 tests passed, including 110 commerce/API regressions.
- Full frontend suite: 834 tests passed across 68 files; Worker coverage also
  passed independently (39 tests).
- Local database suite: 1,254 assertions passed across 19 files.
- Local harness integration: four tests passed, including concurrent
  initialization, authorization, resume/reset, package release, and review holds.
- Production build and typecheck passed. The build reports a bundle-size warning.
- Changed-file lint passed. Full lint retains the existing unrelated
  `react-hooks/set-state-in-effect` error at
  `frontend/src/pages/total-loss-start-page.tsx:1013`.
- Browser checks passed for recognized anonymous Continue, masked saved email,
  locked payment, verification waiting state, actual local magic-link transfer,
  direct checkout return, verified reload, already permanent owner Continue,
  lost-session privacy, neutral recovery, and restored permanent ownership.
  Desktop and mobile layouts were reviewed without horizontal overflow.
- Synthetic fulfillment produced one order, one attempt, one payment
  transaction, and one entitlement after repeat invocation. Checkout resumed
  into processing; existing package/report processing completed to `report_ready`.
- Real Stripe iframe loading, card confirmation, and 3-D Secure were not run:
  no supported sandbox credentials were configured. SDK/component mocks and
  synthetic terminal helpers do not replace that remaining sandbox exercise.
- Only local migrations were applied. Deployed environments, provider
  configuration, valuation/analysis logic, and report processing code were
  unchanged. The next milestone was not started.
