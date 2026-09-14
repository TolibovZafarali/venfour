# Checkout activation

The production continuation endpoint is
`POST /api/v1/appraisal-cases/{caseId}/post-continue`. It accepts only
`expectedAnalysisInputId`, `expectedAnalysisInputRevision`, `expectedReportId`,
and `expectedReportRevision`. The backend validates the saved analysis and the
current ready insurer report, then freezes the existing presentation through the
service-only database initializer. It preserves the free-result classification.

Install the reviewed submission-fence and checkout-initialization migrations
before enabling this path. They must be selected explicitly when an unrelated
migration remains pending. The communications migration is not a prerequisite.

## Server configuration

Keep every setting on the backend; do not use `VITE_*` for payment configuration.

| Setting | Required value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Intended account's application key, test mode for staging |
| `STRIPE_PUBLISHABLE_KEY` | Matching account and mode |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the actual deployed webhook endpoint |
| `VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID` | Active one-time Price in the same account and mode |
| `VENFOUR_TOTAL_LOSS_EXPECTED_AMOUNT_MINOR_UNITS` | `19900` |
| `VENFOUR_TOTAL_LOSS_EXPECTED_CURRENCY` | `USD` |
| `VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER` | Existing product contract identifier |
| `VENFOUR_TOTAL_LOSS_PRODUCT_VERSION` | Reviewed immutable product version |
| `VENFOUR_TOTAL_LOSS_TERMS_VERSION` | Version of the terms shown to the customer |
| `VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION` | Version of the existing fair-result policy |
| `VENFOUR_PUBLIC_APP_ORIGIN` | Exact deployed application origin |

The amount and currency pins are optional as a pair in the generic integration;
set both for this launch. A retrieved Price that differs from either pin is
rejected before an order is reserved. The browser supplies neither amount nor
currency. Missing configuration keeps payment unavailable without altering the
saved review.

The staging sandbox price verified on September 14, 2026 is
`price_1UFUKrCCn7Q3DY3eiw4xCKzq`, product `prod_VG0LOj1iid1wx7`, in sandbox
`acct_1U8owxCCn7Q3DY3e`: one-time USD 199.00, `livemode=false`, lookup key
`venfour_total_loss_staging_199_usd_v1`. The separate $1 local QA price remains
unchanged. This is not a verified live-account price.

## Webhook and recovery checks

Use the existing Worker relay at `/webhooks/stripe`. It preserves the raw body
and signature and authenticates its backend request. Stripe must be able to
reach this route without an interactive Cloudflare Access login. If staging
requires a path-specific Access exception, keep the rest of the application
protected and verify missing or invalid signatures are rejected.

The browser return cannot grant entitlement. Signed, deduplicated webhook
processing verifies the Session and PaymentIntent against the frozen order
before fulfillment. Keep the existing refund, referral and report-binding
wrappers intact; this activation adds no refund or payout automation.

Before promotion, verify the candidate at zero general traffic. Use guarded
local fixtures for normal VIN/manual intake through ready PDF and checkout
initialization. Verify repeated clicks, cancel/refresh recovery, ownership,
stale versions, incomplete reports, paid/refunded cases, tampered requests and
disabled configuration. Do not confirm a real payment during verification.

Keep `MARKETCHECK_API_KEY` absent. No MarketCheck request or canary is required
for checkout activation.
