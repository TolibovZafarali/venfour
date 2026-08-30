# Local Stripe sandbox checkout

This configuration is only for the loopback application, local Supabase, and
synthetic case data. It does not activate a hosted release. Keep document and
market providers disabled, and do not run report-review evaluations.

## Required configuration

The existing server configuration reads these values from the ignored root
`.env`; the normal launcher strips them from the frontend child environment:

| Setting | Local role |
| --- | --- |
| `STRIPE_SECRET_KEY` | Sandbox secret key for the backend SDK |
| `STRIPE_PUBLISHABLE_KEY` | Matching sandbox publishable key, returned only by authorized checkout initialization |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the active local Stripe CLI listener |
| `VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID` | Active one-time sandbox Price |
| `VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER` | Stable Venfour product identifier |
| `VENFOUR_TOTAL_LOSS_PRODUCT_VERSION` | Local product contract version |
| `VENFOUR_TOTAL_LOSS_TERMS_VERSION` | Local terms fixture version |
| `VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION` | Local refund policy fixture version |
| `VENFOUR_PUBLIC_APP_ORIGIN` | Launcher sets `http://localhost:5173` |

Both `VENFOUR_LOCAL_POST_CONTINUE=1` and `VENFOUR_LOCAL_STRIPE_CHECKOUT=1` are
required. Without the second flag, the local provider only returns a synthetic
$1 quote. Its configuration deliberately has no publishable key, so the verified
checkout returns HTTP 503 before creating a payable Session.

After configuration, a second compatibility issue rejected real Checkout client
secrets containing percent-encoded characters. The validator now preserves the
opaque value unchanged and accepts well-formed percent escapes while retaining
the exact Session prefix, nonempty suffix, and length bound.

Stripe CLI browser login uses OAuth. A successful CLI login does not supply the
application's sandbox secret/publishable pair. Obtain the existing keys from the
selected sandbox's API Keys page and put them directly into the ignored local
file, never chat, committed configuration, or `VITE_*` variables. Do not extract
CLI OAuth tokens as a substitute for application keys.
See [CLI authentication](https://docs.stripe.com/cli/login) and
[sandbox key management](https://docs.stripe.com/keys#reveal-an-api-key).

## Dedicated manual-QA price

The configured **New business sandbox** `acct_1U8owxCCn7Q3DY3e` contains:

- Product: `prod_VAIQ4yMkmzd6M4`, **Venfour Total Loss - Local Sandbox QA**.
- Price: `price_1U9xpKCCn7Q3DY3eCQMgDIL2`, one-time USD 1.00.
- Lookup key: `venfour_localhost_checkout_qa_v1`.
- Both resources have `livemode=false` and the fixture metadata value
  `venfour_test_fixture=localhost_checkout_qa`.

The previous archived local Product/Price was left unchanged. These identifiers
are not secrets. The frontend must use the authenticated server quote; this is a
manual-test amount, not a production product price.

The CLI initially selected a different test account. The supplied application
keys identified the sandbox above, so the Price and listener were aligned to
those keys. Do not mix the CLI's saved OAuth context with this sandbox's keys.
The initial unused QA Product/Price in that other test account is not configured
in this application.

## Listener and launcher

Start the sandbox listener from the repository root:

```sh
node scripts/dev-stripe-listener.mjs
```

The helper uses the application sandbox key, not the CLI's default OAuth account,
checks the configured signing secret privately, redacts credentials from output,
and forwards the four Checkout lifecycle events directly to
`http://127.0.0.1:8000/webhooks/stripe`. Do not start a second listener alongside
an already running one. Never use `--live`. After all configuration is present,
use the normal launcher in another terminal:

```sh
colima start
VENFOUR_LOCAL_POST_CONTINUE=1 VENFOUR_LOCAL_STRIPE_CHECKOUT=1 node scripts/dev-local.mjs
```

The existing integration creates a server-owned Checkout Session with
`ui_mode=elements`, using the official Stripe-hosted Payment Element. No Venfour
input receives card number, expiration, or CVC. Browser confirmation cannot grant
entitlement. A verified signed webhook validates the Session/PaymentIntent and
creates the payment/entitlement, then the shared local package coordinator
enqueues durable package work. Leave processing queued for checkout-only QA; do
not use the terminal `pay` helper or modify ledger rows to imitate fulfillment.

## Repeat testing safely

Create a new supportable fixture from `http://localhost:5173/_local/claims` while
remaining signed into the verified local account. This keeps previous real
sandbox Sessions, payments, and ledger records intact. Do not use the database
`reset` helper on a case with a real Stripe sandbox Session/payment.

Mailpit remains available at `http://127.0.0.1:54324` for a fresh anonymous
verification test. [The combined-purchase guide](local-claim-testing.md) describes
the existing fixture and recovery controls.

## Manual checkout

The prepared unpaid synthetic case is
[`e509a979-c696-49ca-bd63-54a58ba56bf1`](http://localhost:5173/total-loss/cases/e509a979-c696-49ca-bd63-54a58ba56bf1/claim/checkout).
It is open in the verified local browser session with empty Stripe-hosted card
fields and one open USD 1.00 Checkout Session. A different browser session must
recover/verify the claim through the normal email flow; the local inbox is
[Mailpit](http://127.0.0.1:54324).

Use only Stripe test data:

| Scenario | Card number | Other fields |
| --- | --- | --- |
| Success | `4242 4242 4242 4242` | Future expiration such as `12/34`, CVC `123`, US ZIP `60601` |
| Insufficient funds | `4000 0000 0000 9995` | Same future expiration/CVC/ZIP |
| Authentication | `4000 0025 0000 3155` | Same fields; choose **Fail** or **Complete** in Stripe's test challenge |

These are [Stripe's published testing cards](https://docs.stripe.com/testing).
Test the decline before success on the same case, or create a fresh case after
successful payment. A paid case correctly resumes processing and is not payable
again. The original customer case `66cde699-7613-49bd-bc4b-8c1e217d83b6` was not
reset, paid, or otherwise modified during this verification.

## Verified local results — 2026-08-29

| Check | Observed result |
| --- | --- |
| Hosted fields | Card number, expiration, CVC, and billing fields rendered inside `https://js.stripe.com` iframes; no top-level Venfour card inputs |
| Retry setup and refresh before payment | Reused the original attempt and exact Stripe Session; no additional purchase |
| Decline then success | Insufficient-funds message, zero ledger payment/entitlement, then successful `4242` retry on the same Session |
| Signed direct webhook | `checkout.session.completed` returned HTTP 200 and was recorded as processed, `livemode=false` |
| Return before webhook | Temporarily held authentic signed delivery; browser displayed confirmation pending while payments, entitlements, and package jobs were all zero |
| Browser close and duplicate delivery | Closed the pending browser, released the same raw signed event twice, and obtained exactly one payment, entitlement, and package job; reopening reached processing |
| Authentication | Stripe's real 3-D Secure test challenge failed safely, then succeeded on retry with one purchase |
| Wrong owner/case | Neutral recovery, without saved contact details, quote, or payment initialization; contract regressions also pass |
| Duplicate clicks | Component tests verify concurrent submissions call Stripe confirmation once and retain safe retry after failure |

All three successful sandbox cases (`dd1ad7c9-c23b-4d59-bfd2-2aa0ac18d6e8`,
`aa498aea-78e7-46da-b175-7c204b80ffa9`, and
`2c38c8b8-f0e2-48de-b9ad-b3a07d065595`) reached `/claim/processing` with exactly
one USD 1.00 payment, one active entitlement, one processed signed completion
event, and one queued package job/work item. The temporary delay relay was
drained and stopped; direct forwarding to port 8000 was restored and verified
with the authentication payment.

The embedded card flow uses `redirect: if_required`; these tests required no
external success-page redirect. The browser-close check therefore closed the
page while it awaited authoritative fulfillment, before any processing-page
return. It did not interrupt a redirecting payment method.

Validation: 154 offline Python tests, 55 targeted frontend tests, 15 listener
tests, and 202 rollback-only local database assertions passed. Typecheck, scoped
ESLint, production build, and whitespace checks passed. The build retains its
existing large-bundle warning; browser-environment tests emit non-failing
`scrollTo` notices.

Package work is deliberately **queued, not executed** in this checkout-only
exercise. No report-review evaluation, external model request, hosted/staging
change, deployment, commit, push, or pull request was performed. Only local data
and explicitly test-mode Stripe resources were used.
