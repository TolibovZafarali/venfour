# Preview result return and recovery

This flow preserves the saved Total Loss preview. It does not rerun valuation,
change a result classification, create a preliminary snapshot, unlock checkout,
or modify paid-review eligibility.

## Customer behavior

- An anonymous guest who still has their original Supabase session sees **View
  my result** on the homepage header and hero, or **View analysis progress**
  while processing. A failed attempt shows **Return to my review** so the guest
  can reach its existing retry or correction options. The destination comes
  from an owner-scoped case lookup.
  Newer blank drafts do not hide an earlier completed analysis.
- Signed-out visitors keep the usual start action and can use **Find my review**.
  Permanent account holders retain their existing homepage and case list.
- Each analysis started by a guest queues one completion email when its saved
  job becomes completed. All five result classifications qualify. Existing
  completed jobs are not backfilled; processing guest jobs are included.
- The completion email uses the Contact Details email. It contains no VIN,
  valuation, classification, offer, or other claim facts.
- Opening the email with an already authorized session goes directly to that
  exact saved result, without consuming the verification token. Otherwise the
  customer verifies the email and uses the existing case-identity claim flow.
  Successful verification can establish a permanent email identity; the case
  then appears in that identity's case list. The old anonymous session loses
  access when ownership transfers.
- Expired or previously consumed verification links retain the case route and
  offer a fresh link for that same case. `/find-review` accepts only an email
  and selects its most recently active eligible analysis. It always returns a
  neutral acknowledgement, including for unknown email addresses.
- The earlier intake email remains available for unfinished-intake recovery.
  Completion emails have distinct ready copy. A newer Supabase email token may
  supersede an older token; the older case-specific route can still request a
  fresh verification link.

## Deploy and configure together

1. Apply `20260829000100_total_loss_preview_return.sql`. It adds the private
   delivery queue, narrow service RPCs, guest-origin/completion triggers, and a
   cron job. It does not modify existing case authorization functions.
2. Deploy the API and frontend changes. Keep the existing server-only
   `VENFOUR_PUBLIC_APP_ORIGIN`, `VENFOUR_TURNSTILE_SECRET`, and
   `VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET` configured. The public application
   origin must match the environment's Supabase Auth Site URL, with no trailing
   slash. Never expose service-role or recovery secrets in frontend variables.
3. Add these exact route patterns to that environment's Supabase Auth redirect
   allowlist, substituting only its trusted application origin:
   - `/auth/callback/preview-ready/*/*`
   - `/auth/callback/preview/*/*`
4. Publish both Auth email templates from `supabase/templates/confirmation.html`
   and `supabase/templates/magic-link.html`, including the corresponding subject
   expressions in `supabase/config.toml`. Confirmation and magic-link templates
   are both required because the email identity may be new or already exist.
   Preserve the token-hash callback links. Do not replace them with a callback
   that loses the case and claim IDs. Local config changes do not update a
   hosted project's Auth settings.
5. Configure a separate random server secret,
   `VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET` (32–512 non-whitespace ASCII
   characters). It is only for the internal email dispatcher, not a Supabase
   key, browser credential, or staging proxy secret.
6. In the same database's Vault, securely create or update:
   - `venfour_preview_email_api_origin`: the trusted HTTPS API origin, without a
     trailing slash or path.
   - `venfour_preview_email_dispatch_secret`: the same dispatcher secret as the
     API environment.

   Do not put secret values in migration files, command history, screenshots,
   tickets, or logs. The minute-based `venfour-preview-email-delivery` cron job
   stays inert until both Vault entries exist. The endpoint must be reachable
   from the database; use the API's direct service origin when a marketing-site
   proxy or interactive staging login would block the request. The internal
   endpoint validates its own secret and does not accept the browser's session
   as dispatch authorization.

The API makes an immediate delivery attempt after completed analysis and after
a recovery request. The durable queue plus cron handles failed sends and worker
interruptions even when no browser is open or an API instance has been recycled.
Do not rely on background CPU in a request-billed host for retries. Confirm the
existing Auth SMTP provider, redirect allowlist, sender configuration, and email
rate limits in the target environment before enabling customer traffic.

## Delivery and security checks

Delivery leases last two minutes. Failed sends back off from one minute to one
hour with at most eight attempts. A sent completion is never selected again;
the queue's unique run key prevents duplicate completion jobs. There remains a
small accepted-send/failed-acknowledgement window in which a provider retry can
send twice; the Auth mail endpoint has no per-message idempotency contract.

Before every send, the database rechecks the current contact, ownership, case
stage, and existing transfer restrictions. A delayed ready email is cancelled
if its completed run is no longer the case's current completed analysis.
It will not transfer a case with
commerce, financial, entitlement, or published-report state. A verified permanent
owner can recover their own case without transferring it. A claim expires after
30 minutes; a still-valid matching claim with at least five minutes remaining
can be reused. Email possession is verified by Supabase Auth, never by comparing
a caller-supplied address or trusting a case ID.

Recovery requires Turnstile. Existing database rate-limit machinery limits the
requester to five and the email target to three requests per fifteen minutes,
including non-matches. Only HMAC fingerprints enter those rate-limit records.
The private email queue contains the delivery address and must not be exposed
through customer APIs. API responses are `private, no-store`; application logs
use generic error codes/messages without contact details or provider responses.

Safe operational checks can aggregate queue status, attempt counts, and age;
do not select recipient addresses, identity-claim IDs, or Auth tokens into logs.
Investigate `failed` queue entries and unsuccessful cron HTTP status codes.
After resolving a provider problem, use a reviewed operator action or customer
recovery request to retry; do not rerun the saved valuation to trigger mail.

## Local verification

Use the normal startup procedure: `colima start`, then
`node scripts/dev-local.mjs`. The launcher supplies a local-only dispatcher
secret and uses the local email inbox. Reload the local Supabase stack, keeping
its database volumes, after changing Auth template or redirect settings.

The scheduler is intentionally inert without Vault settings. For a local retry
canary, call the internal dispatcher with the launcher's local-only secret;
never copy that secret to a hosted environment. Use synthetic addresses and
cases. Verify a ready email, same-session return, verification in a different
browser, an expired-link recovery, and an insufficient-evidence result.

Run the Python suite, frontend tests/typecheck/build, and Supabase database tests.
The dedicated preview tests cover owner isolation, every classification,
completion idempotency, leases/retries, contact changes, email-only recovery,
expired claims, and removal of guest return links when the session is lost.
