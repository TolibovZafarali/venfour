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

Live keys enforce USD 199.00 even when the amount and currency pins are omitted;
conflicting live pins are rejected. Test keys retain optional paired pins so the
separate $1 local sandbox remains usable. Set both pins explicitly for staging
and production. A retrieved Price that differs from either pin is
rejected before an order is reserved. The browser supplies neither amount nor
currency. Missing configuration keeps payment unavailable without altering the
saved review.

The staging sandbox price verified on September 14, 2026 is
`price_1UFUKrCCn7Q3DY3eiw4xCKzq`, product `prod_VG0LOj1iid1wx7`, in sandbox
`acct_1U8owxCCn7Q3DY3e`: one-time USD 199.00, `livemode=false`, lookup key
`venfour_total_loss_staging_199_usd_v1`. The separate $1 local QA price remains
unchanged. This is not a verified live-account price.

## Billing, email, and receipts

Checkout continues to use the existing Checkout Sessions API with `ui_mode=elements`.
New Sessions require a full billing address. The embedded Stripe Billing Address
Element collects the cardholder's full name and address and validates them at
confirmation. The Payment Element suppresses duplicate billing fields. No shipping
address or phone number is requested, and Venfour does not read or store card or
billing-field values in application state.

The service uses the frozen purchaser email from the verified account/claim
authorization for both `customer_email` and `payment_intent_data.receipt_email`.
It never accepts a replacement email or price from the browser. Existing minimal
order/attempt metadata, signed webhook fulfillment, refunds, and immutable order
amounts remain authoritative. Retries spanning this rollout recover the prior
Elements or hosted Session with the same idempotency key.

In the live Dashboard, select or create an active one-time **USD 199.00** Price
on the intended Venfour product and configure its ID on the backend. Do not use
the staging or $1 local Price in production. Review the receipt branding, support
details, and customer email settings under **Settings → Customer emails**.
Stripe receipts use the actual charged amount; Venfour does not maintain a
separate hard-coded receipt price.

## Tax audit and launch boundary

On September 15, 2026, read-only API inspection of the connected **sandbox** found:

- Tax settings `pending`, with `head_office` missing;
- no default tax code or tax behavior and no active tax registrations;
- the USD 199.00 staging Price active, with unspecified tax behavior and no product
  tax code; and
- the separate local USD 1.00 Price still active.

These observations do not verify the live account or establish tax obligations.
The existing application has no tax-calculation integration. New Sessions now
explicitly send `automatic_tax.enabled=false`; no manual tax rates, shipping fees,
or misleading zero-tax line are added. The purchase summary remains a single total.

Before launch, confirm the service's tax classification and actual collection
obligations. If collection is required, complete **Tax → Settings** (business
address and correct product tax code/tax behavior) and **Tax → Registrations**
only for jurisdictions where collection is required. Do not enable tax merely
as a precaution. Dashboard changes alone do not enable tax in this application.

Tax collection requires a coordinated follow-up before accepting affected
payments: display Stripe's authoritative Subtotal, Tax, and Total as the billing
address changes, and extend the frozen-order, webhook, refund, and referral amount
contracts. Today those contracts require the Session and PaymentIntent totals to
equal the frozen product amount. Turning tax on in isolation would break payment
reconciliation. See [Stripe's Elements tax integration](https://docs.stripe.com/tax/checkout/elements).

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
