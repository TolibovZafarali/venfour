# Email audit before implementation

Read-only audit of commit `b512e94`, linked Supabase project
`bjvsgaqitehtwasugvla`, and GCP project `venfour-prod`, September 11, 2026.
No email, configuration, DNS, customer data, or provider settings were changed.
Credentials were consumed privately; only configuration allowlists and aggregate
queue counts were printed.

## Hosted facts

The only visible Cloud Run service is `venfour-api-staging` in `us-east4`.
`venfour-api-staging-subject-ready-20260911-1740` receives 100% of service traffic.
Its public application origin is `https://staging.venfour.com`. The repository's
Cloudflare deployment also targets staging. These are the available live hosted
resources, not evidence of an independently configured `venfour.com` production
application. GCP's Cloud Scheduler API is disabled; database cron is separate.

Supabase Auth's Site URL is `https://staging.venfour.com`. Email signup is enabled,
confirmation required, and secure double email change enabled. Auth uses custom
Resend SMTP at `smtp.resend.com:465`, with **Venfour <auth@venfour.com>** and a
configured SMTP credential. The Send Email Hook is disabled. No explicit Reply-To
setting was returned by Auth configuration; a received message/provider inspection
is required to establish actual Reply-To headers. It must not be inferred from From.

Hosted confirmation and magic-link bodies contain tokens and token hashes but are
generic, not the repository's branded/context-aware templates. All six Auth
subjects are generic. Auth OTP length is **8**, expiry **3600 seconds**, SMTP
minimum interval **60 seconds**, email rate **30/hour**. Local OTP length is **6**.
The current six-digit UI/local tests therefore do not prove hosted code entry.
Existing generic hosted token-hash links remain a separate authentication path.

The redirect allowlist includes root production/localhost callbacks and staging
root, case-claim, preview, and preview-ready callbacks. Production case-specific
callbacks and hosted checkout-code redirect patterns are absent. Reconcile the
actual launch origin and routes deliberately during deployment.

The database has all **64** migrations through `20260911000100`. Preview and
partner queues exist and are empty. Both minute cron jobs
`venfour-preview-email-delivery` and `venfour-referral-partner-delivery` are
**inactive**. No email/partner Vault entries exist. Cloud Run has no
`VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET`, partner dispatcher secret, partner provider,
partner From/Reply-To, or `RESEND_API_KEY`. **Direct Resend partner email is not
enabled.** Source, documentation, and verified DNS do not make this path operational.

The sole deployed Edge Function is abandoned-anonymous-guest cleanup. Its daily
cron is active; it does not send email. Insurer-response processing cron is paused.
All seven optional Auth security-notification toggles are disabled.

## Current email inventory

| Email | Trigger | Sender and implementation |
| --- | --- | --- |
| Sign-in / new email confirmation code | User requests email sign-in, including partner sign-in | Browser `auth-service.ts` calls Supabase `signInWithOtp`; Auth chooses confirmation or magic-link template and sends SMTP |
| Claim verification code | Customer secures a case before checkout | `email-otp-service.ts` calls the same Auth OTP API; exact verified-email claim transfer remains a separate database operation |
| Secure case-access / unfinished-intake recovery link | Customer explicitly requests access/recovery | `case_claim_access.py` prepares/renews the existing identity claim; `supabase_gateway.py` requests `/auth/v1/otp`; Auth sends SMTP |
| Preview ready | A guest-origin analysis transitions to completed | Database inserts one `total_loss_preview_emails` row per run; `preview_access.py` leases it and asks Auth for a context-specific OTP link |
| Preview recovery | Customer explicitly uses Find my review or case recovery | Enumeration-safe, rate-limited SQL selects an eligible case, enqueues recovery; same preview worker and Auth SMTP |
| Partner invitation / replacement invitation | Authorized manager invites or resends | `referral_partner_jobs`, `partner_delivery.py`; direct Resend API or local Mailpit, currently disabled on hosted service |
| Completed partner agreement copy | Countersignature activates partner and retained PDF preparation succeeds; explicit manager copy retry | Same durable partner jobs; sends sealed PDF bytes, direct Resend/Mailpit |
| Auth invite, password recovery, email change, reauthentication | Supported Auth platform/admin actions, no corresponding customer UI calls found | Supabase platform templates/SMTP; distinguish capability from active application trigger |
| Password/email/phone changed, MFA added/removed, identity linked/unlinked | Optional Auth platform notifications | All seven disabled in inspected hosted Auth |
| Stripe receipt/refund receipt | Stripe account settings, if enabled | Stripe controls these; repository passes `customer_email`, not explicit `receipt_email`/`invoice_creation`. Dashboard receipt toggles were not verified |

Insurer requests are **not sent by Venfour**. The customer copies text or opens a
`mailto:` draft, attaches the report, and explicitly records “I sent it.” There is
no Gmail/Outlook sending integration or verified insurer delivery/read receipt.
Support links likewise open the customer's mail application. No other mail sender
was found across Python, frontend, functions, migrations, scripts, or configuration.

## Queues, design, and environments

Auth security and access mail uses `supabase/templates/confirmation.html` and
`magic-link.html` locally, selected through `supabase/config.toml`. Hosted templates
are independently configured and have drifted. Local Auth delivers to Mailpit at
`127.0.0.1:54324` (SMTP container port 1025). No application Auth delivery ledger
or provider webhook exists. OTP throttling is not delivery idempotency.

Preview jobs have RLS, a unique completion/run index, two-minute leases, current
owner/contact/run revalidation, stale cancellation, eight attempts, and exponential
60-second-to-one-hour backoff. Immediate API attempts supplement minute cron. Each
retry asks Auth for an OTP again; SMTP acceptance ambiguity is not provider-level
deduplication. Recovery is neutral, rate-limited, and binds both case and claim IDs.

Partner jobs preserve immutable prepared payloads, provider message IDs, fenced
leases, bounded retries and a 23-hour uncertainty cutoff before Resend's 24-hour
idempotency window. `sent` means accepted by the provider, not delivered. They have
no delivery/bounce/complaint webhook. Templates are plain text inside
`partner_delivery.py`; From and Reply-To are separate required partner environment
values. Local startup overrides them with `Venfour <partners@venfour.test>` and
`partners@venfour.test`, uses Mailpit, and polls dispatch every 15 seconds.

No state-driven customer follow-ups exist. The actual contact record already has
optional `operational_follow_up_allowed` consent, explicitly separate from essential
requested messages. The authoritative workflow is `total_loss_claim_workflows`,
with current package/report/response/round pointers; intake/analysis are projected
by `total_loss_case_operations_internal`. Email must observe these records, never
advance or duplicate their workflow.

Public DNS has Google root MX/SPF, a Resend DKIM record, SES-backed
`send.venfour.com` MX, and DMARC `p=none`. These establish DNS configuration only;
Resend domain verification, account tracking options, inbox placement, and Stripe
receipt settings remain unverified control-plane items.
