# Venfour communications

This change is ready for a staged rollout, not an automatic production cutover.
Applying the migration or deploying the application sends no new lifecycle mail.
See [the observed hosted baseline](email-audit-2026-09-11.md) before changing settings.

## Architecture and ownership

`venfour/email_design.py` owns the single master layout, design tokens, shared
components, responsive rules, HTML/plain-text composition and layout version.
`venfour/email_templates.py` owns the 27 content-only definitions and subjects.
`venfour/email_delivery.py` owns validated
sender identities and Resend/Mailpit transport. `venfour/communications.py` owns
signed Auth delivery, lifecycle dispatch, safe previews and delivery events.
The API extends the existing Python application and Supabase gateway.

The existing partner invitation/agreement queue and guest-preview/recovery queue
remain authoritative. Partner mail uses the shared renderer and transport; already
prepared messages retain their original bytes, attachments and idempotency keys.
Guest-preview/recovery still asks Supabase Auth for an OTP. The optional Send Email
Hook renders that same Auth request through the shared system. No new claim,
credential, case ownership, report-access or insurer-send workflow is introduced.

New lifecycle jobs observe `total_loss_case_operations_internal`, current workflow
pointers, published report access, paid entitlements, message versions and response
analysis jobs. The migration adds delivery/control records, not a second customer
state machine. Signed-in verified owners must exactly match the case contact.
Existing anonymous preview completion uses its established secure claim path.

### Email catalogue

| Key / group | Trigger and default timing | Conditions |
| --- | --- | --- |
| `auth_sign_in` | Requested sign-in or signup OTP | Supabase generates and verifies the token |
| `auth_claim` | Requested checkout identity verification OTP | Original case checkout route retained |
| `auth_access` | Requested case claim, intake recovery or preview recovery | Original token-hash callback with case/claim identifiers retained |
| `auth_preview_ready` | Existing guest-origin result-ready queue | Existing Auth OTP/claim producer and retry policy retained |
| `auth_invite`, `auth_recovery`, `auth_email_change`, `auth_reauthentication` | Explicit supported Supabase action | No new customer UI trigger; secure email change handles both addresses |
| `auth_password_changed_notification`, `auth_email_changed_notification`, `auth_phone_changed_notification`, `auth_mfa_factor_enrolled_notification`, `auth_mfa_factor_unenrolled_notification`, `auth_identity_linked_notification`, `auth_identity_unlinked_notification` | Corresponding Supabase security event, only if its hosted notification toggle is enabled | All seven were disabled in the audited hosted configuration |
| `partner_invitation` | Staff explicitly creates an invitation | Existing durable partner job |
| `partner_agreement_copy` | Partner completes/signs the agreement | Existing immutable agreement and attachment job |
| `intake_reminder` | 24 hours of inactivity during unfinished intake | Once per case, consent, no purchase |
| `free_review_ready` | Current free analysis completes | Once per job; guest-origin jobs excluded to avoid overlap with preview mail |
| `free_review_reminder` | 72 hours after completion/latest activity without purchasing | Once per case, consent; neutral saved-review reminder, no upsell |
| `paid_review_started` | Five minutes after confirmed payment while report preparation remains pending | Active entitlement; skipped if the report is already ready |
| `paid_review_ready` | Current published report becomes accessible | Once per report version; existing customer report-access function must allow it |
| `request_reminder` | 48 hours after current prepared request/latest activity | Once per initial request or follow-up round, consent; cancel when marked sent, edited or superseded |
| `insurer_waiting_reminder` | Seven days after customer-reported sending | Once per round, consent, still awaiting a response |
| `insurer_no_response_reminder` | Fourteen days after customer-reported sending | Final reminder for that round; consent and no confirmed response |
| `response_review_ready` | Current insurer-response analysis completes | Once per job; excludes superseded responses and inaccessible source reports |
| `case_closed` | Customer explicitly confirms resolution | Once per case; accepting an offer alone does not close a case |

Optional reminders require `operational_follow_up_allowed` and no suppression.
They contain no promotional offers. Marketing campaigns are not implemented and
would need a separate consent and policy decision. Existing guests receive no new
abandoned-intake campaign without verified ownership. No message is sent to an
insurer on a customer's behalf.

### Delivery guarantees and limits

- Both the server transport and database rollout must permit delivery; the cron
  job starts paused. First activation sets enrollment to that moment, excluding
  all previously created cases. Pause/resume preserves this cohort and history.
- Discovery inserts one unique key per template/case/milestone. It rechecks current
  state, consent and recipient; preparation rechecks them immediately before the
  provider call. A message already accepted by a provider cannot be recalled.
- Optional mail has a recipient-wide one-per-24-hours and three-per-seven-days cap.
  Recent transactional acceptance also defers optional mail. Row locks, recipient
  advisory locks, two-minute leases and lease tokens fence overlapping workers.
- New jobs expire 48 hours after eligibility, preventing a stale catch-up burst.
  Provider requests are frozen before sending, including sender and template.
  Retry uses the same key and bytes with exponential backoff (one minute to one
  hour), at most eight attempts and never beyond 23 hours after the first attempt.
  Resend's idempotency retention is [24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
  Uncertain delivery outside that window is held for review, never blindly resent.
- Auth must return synchronously within Supabase's short hook deadline; it is not
  placed behind the lifecycle queue. Signed hook retries share a provider key.
  Acceptance metadata is best-effort after the response, with no persisted code,
  token hash, rendered Auth body, link or raw hook payload. A telemetry outage can
  leave a gap in Auth activity; consult Resend's authenticated control plane.
- The older preview queue can request a fresh OTP on a retry. Its historical SMTP
  uncertainty is deliberately preserved during migration. The hook deduplicates
  retries of the same signed request; it cannot deduplicate different Auth OTP
  requests. Do not claim global exactly-once delivery.
- Verified Resend events are immutable and deduplicated by event ID. Activity uses
  provider event timestamps and severity, not arrival order. Acceptance means the
  provider accepted a request, not inbox delivery or a read receipt. No open/click
  tracking is added. Bounce/complaint events suppress new lifecycle mail; Auth
  recovery is not silently suppressed. Partner transport retains provider-level
  bounce handling and its existing queue policy.
- Unsubscribe uses a random capability token; GET only displays a form, POST records
  opt-out. Optional emails include one-click unsubscribe headers. Treat capability
  URLs and private delivery payloads as sensitive in infrastructure access logs.

## Design, preview and administration

Use `/admin/communications` with an existing verified database-authorized staff
account. The primary view is a searchable gallery of all 27 emails, grouped by
customer journey, account access, account security and referral partners. Each
thumbnail uses the actual delivery HTML. Open a card for a 640px desktop or 375px
mobile viewport, plain text, sender/reply-to, trigger and attachment information.
The preview frame scales to fit its container without changing its internal
viewport, so it exercises the email's own responsive rules. Sample labels live
outside the email; preview and test-send use identical renderer output with inert
links and codes. The gallery loads in one authorized read, with no sends or writes.

Delivery settings and activity are secondary views. They retain sender identities,
editable automation delays/enabled flags, pause/dry-run/first-activation controls,
aggregate eligible counts and recent activity from all three queues.
Changes are revision-fenced and recorded in an append-only staff audit table.
Activity omits customer addresses, case identifiers, content, tokens and secrets.
Sender and template edits are deployment-managed, reviewed changes; the browser
never becomes an arbitrary email composer or secret editor.

```sh
.venv/bin/python scripts/preview_emails.py --output /tmp/venfour-email-preview --asset-origin http://127.0.0.1:4188
.venv/bin/python -m http.server 4188 --bind 127.0.0.1 --directory /tmp/venfour-email-preview
```

The export includes the logo. Open `http://127.0.0.1:4188` to inspect it without
using a hosted asset or sending email. Regenerate/check the SMTP files separately:

```sh
.venv/bin/python scripts/preview_emails.py --write-smtp
.venv/bin/python scripts/preview_emails.py --check-smtp
```

Change global appearance only in `venfour/email_design.py`; increment its
`LAYOUT_VERSION` for a released change. Do not author per-email HTML or CSS.
Change specific copy only in `venfour/email_templates.py`. Every entry inherits
the logo, palette, typography, spacing, document layout, button, code block, detail rows,
support/footer treatment and mobile rules. Six-digit codes use the same grouped
display in the hook and SMTP; token values and verification remain unchanged.

The master follows `frontend/src/components/app-shell.tsx` and the website theme:
the original 28px symbol, mixed-case 20px Venfour wordmark, Avenir-style local font
fallbacks, navy `#0b1f33`, body `#506277`, and solid `#155eef` action buttons.
Headings are 22px (21px on mobile), body copy is 16px, and buttons are 48px high.
The footer identifies Venfour LLC and uses the configured Reply-To address as the
support contact. SMTP falls back to the website Contact page instruction because
its sender/Reply-To is controlled by Supabase. No unverified mailbox is invented.

`frontend/public/email/venfour-mark-v1.png` is a 112px raster export of the existing
`assets/brand/venfour-mark.svg`, displayed at 28px. Its source digest is recorded
in the master and checked in tests. The original SVG is unchanged. The PNG has a
white backing to retain the black mark when an email client changes surrounding
colors. Live wordmark text remains readable if images are blocked. This avoids
the uneven [SVG email support](https://www.caniemail.com/features/image-svg/);
[PNG support](https://www.caniemail.com/features/image-png/) is broader.
The master uses presentation tables, inline base styles, system font fallbacks,
and a fixed-width conditional table for classic Outlook. Rounded buttons may
render with square corners there. Responsive overrides enhance the fluid base.
There are no remote fonts, decorative images or recipient-specific image URLs.

The one logo URL uses `VENFOUR_PUBLIC_APP_ORIGIN` for application mail and
`{{ .SiteURL }}` for generated SMTP. **Before publishing these templates**, serve
`/email/venfour-mark-v1.png` publicly on the configured website origin (including
staging); mail clients cannot pass a website access gate. Deploy the frontend
asset before activating the new backend or SMTP design. Keep this versioned
asset available for previously sent messages; use a new path for a future mark.
Asset origins must be bare HTTPS origins, except loopback HTTP for local preview.
Normal deployment of the frontend includes the PNG; no provider upload is needed.

To add a future email, add one content entry to `TEMPLATES`, for example:

```python
_template(
    "saved_update",
    "An update to your saved case",
    ["An update is available in your private case workspace."],
    heading="Your case has an update",
    action="View my case",
    trigger="Describe the existing durable event that permits this email",
)
```

The default interaction is a link. Use `code`, `code_and_link` or `notice` only
where the sending contract requires it. `details` accepts escaped text pairs and
`attachment` describes an attachment supplied by the existing delivery workflow.
No styling fields are accepted. The gallery, export and test preview discover the
new entry automatically. Wire its real trigger to the existing durable workflow
separately; adding a design never enables an automation or sends a message.

`supabase/templates/auth-context.gohtml` retains the original exact OTP vs
case-link selectors. Generation writes all 13 SMTP provider slots from the same
catalogue (the signup/magic-link slots select among four contextual designs).
It also synchronizes local subjects/paths in `supabase/config.toml`, preserving
existing notification switches and defaulting newly added ones to disabled.
These HTML files are generated artifacts, never standalone design sources.
`--check-smtp` and the Auth template tests detect design/copy/subject drift.
Generation does not update hosted templates. SMTP cannot provide every
hook capability (including explicit Reply-To and application delivery metadata).
Supabase documents the separate local configuration and hosted publication steps
in its [template guide](https://supabase.com/docs/guides/local-development/customizing-email-templates).
While SMTP remains active, its published template and sender are controlled in
Supabase; the gallery shows the repository's shared design, not a fetched copy of
hosted settings. Apply generated templates deliberately, or complete the hook
cutover below, before treating the gallery as proof of current hosted mail.
Already prepared durable jobs retain their frozen original body and version.
Review real received MIME, Gmail/Outlook/mobile rendering and spam placement during
staging canaries; browser previews alone are not inbox proof.

Test-send is limited to the currently authenticated, verified staff email, which
must also be in `VENFOUR_EMAIL_TEST_RECIPIENTS`. It cannot accept a different
recipient, arbitrary subject or content. Five new previews per hour per staff
recipient; durable reservation and stable request ID prevent duplicate retries.
Test content is fictional and contains no usable auth or customer links. Dry-run
mode sends nothing, including test previews; use allowlist mode for provider tests.

The design/gallery refactor passed 53 focused backend, template and partner tests,
six Communications workspace tests, scoped frontend lint, TypeScript and the
production frontend build. Generated SMTP subjects and HTML match the catalogue.
Browser checks covered all 27 emails at 640px and 375px with no horizontal
overflow, plus gallery filtering, Auth/partner previews and the phone-sized dialog.
These checks used fictional content; they did not send external mail, change
hosted Auth settings, or verify rendering in a real mailbox client.

The subsequent website-aligned master redesign passed 55 focused backend/Auth/
partner tests, all six gallery tests, SMTP generation checks, and the frontend
build (including TypeScript). The built logo matches the source asset. Visual
checks covered completed review, sign-in code, email change, security notice,
insurer reminder and partner invitation at both 640px and 375px, plus the gallery
at phone width. Inspection used the actual frontend header locally: the root
hosted domain did not resolve and staging required an access login. All data was
fictional; no hosted templates, settings or production assets were published.

## Sender configuration

Configure these in the backend environment/secret manager only; never `VITE_*`:

| Variable | Purpose |
| --- | --- |
| `VENFOUR_EMAIL_PROVIDER` | `disabled` (default), `resend`, or loopback-only `mailpit` |
| `VENFOUR_EMAIL_MODE` | `disabled` (default), `dry_run`, `allowlist`, `live` |
| `VENFOUR_PUBLIC_APP_ORIGIN` | Exact trusted customer application origin, shared with existing commerce/recovery |
| `VENFOUR_EMAIL_PUBLIC_API_ORIGIN` | HTTPS API origin used for email preferences |
| `VENFOUR_EMAIL_FROM` | Suggested `Venfour <updates@venfour.com>` |
| `VENFOUR_EMAIL_REPLY_TO` | Suggested monitored `support@venfour.com` |
| `VENFOUR_AUTH_EMAIL_FROM`, `VENFOUR_AUTH_EMAIL_REPLY_TO` | Suggested `Venfour <auth@venfour.com>` / `support@venfour.com`; fall back to customer identity |
| `VENFOUR_PARTNER_EMAIL_FROM`, `VENFOUR_PARTNER_EMAIL_REPLY_TO` | Suggested `Venfour <partners@venfour.com>` / monitored `partners@venfour.com` |
| `RESEND_API_KEY` | Private restricted sending key |
| `VENFOUR_EMAIL_TEST_RECIPIENTS` | Private comma-separated exact permitted test addresses; no rerouting |
| `VENFOUR_EMAIL_DISPATCH_SECRET` | Unique high-entropy 32+ character dispatcher secret |
| `VENFOUR_AUTH_EMAIL_HOOK_ENABLED` | `0` until deliberate cutover, then `1` |
| `VENFOUR_AUTH_EMAIL_HOOK_SECRET` | Supabase-generated signed hook secret; never SMTP password |
| `RESEND_WEBHOOK_SECRET` | Resend/Svix endpoint signing secret; separate from API key |
| `VENFOUR_EMAIL_MAILPIT_ORIGIN` | Local only, default `http://127.0.0.1:54324` |

Legacy partner provider/from/reply-to overrides continue to work. When central
provider configuration exists, the central delivery mode governs partner sending
as well. Do not accidentally leave `VENFOUR_PARTNER_EMAIL_PROVIDER` pointed at a
different environment. Old partner and preview dispatcher secrets are separate.
Local `scripts/dev-local.mjs` routes shared delivery to Mailpit and disables the
Auth hook; local Supabase keeps its SMTP path. Its poller invokes the new dispatcher
but database enrollment remains disabled until explicitly enabled locally.

## Deliberate deployment and Auth cutover

1. Rehearse all migrations and run the checks below. Snapshot hosted SMTP/template
   settings privately for rollback; never export secret-bearing JSON into the repo
   or application logs. Deploy migration `20260911000200`, backend and frontend
   with shared transport disabled, hook disabled and all cron jobs still paused.
   Existing SMTP sign-in/recovery behavior continues.
2. In Resend, verify the sending domain and each intended identity; configure the
   required DKIM/SPF/return-path DNS exactly as Resend supplies. Preserve Google's
   inbound MX. Create and test the actual support/partner inboxes or aliases.
   Existing DNS records alone do not prove domain verification or reply delivery.
   Do not tighten DMARC before SPF/DKIM alignment is verified across all senders.
   Disable provider open/click tracking for authentication links.
3. Use a separate staging Auth/database/provider configuration, new synthetic cases
   and explicit recipient allowlists. Set the shared server settings and secret
   bindings in Cloud Run. Avoid copying secret values into command arguments,
   review artifacts or browser code. The hook endpoint must be externally reachable
   at `/hooks/auth/email`; it authenticates raw-body signatures independently of
   the existing proxy. Keep a warm instance and verify hook latency/cold-start
   behavior against [Supabase's hook deadline](https://supabase.com/docs/guides/auth/auth-hooks).
4. Configure the Resend webhook at `/webhooks/resend` for sent, delivered, delayed,
   bounced, complained, failed and suppressed events. Store its signing secret in
   Cloud Run. Verify replay, unordered events and signature rejection. Use provider
   test addresses for bounces/complaints; do not provoke real customer failures.
5. Prefer **Send Email Hook with the same Resend provider** for the long-term path:
   one renderer, explicit Reply-To, one transport, signed events and application
   telemetry. Supabase still owns tokens, expiration, verification, rate limits and
   secure email changes. Email-change security notices go to the signed old address.
   The hook accepts only the configured application or Auth API `site_url`; callback
   redirects must still use the application origin. Current upstream Auth does not
   expose a separate unlinked-identity recipient in its hook payload, so that notice
   follows `user.email`; test this before enabling the previously disabled toggle
   ([upstream contract](https://github.com/supabase/auth/blob/master/internal/api/mail.go)). See the [official hook contract](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook).
   Configure the endpoint and secret in Supabase only after the deployed backend
   is healthy; enable its backend flag before switching Supabase. Enabling a hook
   replaces SMTP sending: do not assume automatic SMTP failover on hook failure.
6. Before production Auth cutover, resolve the observed **hosted 8-digit OTP versus
   existing 6-digit UI** mismatch deliberately. The renderer supports either, but
   this change does not alter OTP verification or input behavior. Preserve and
   validate the intended six-digit product contract or separately update/test the
   UI. Set the correct Site URL and exact redirect allowlist for sign-in, checkout,
   case claim, preview and preview-ready callbacks on the actual production origin.
   The audited project had staging routes and lacked equivalent production case
   routes. Hook validation rejects other origins/routes instead of leaking tokens.
7. Canary new signup, existing sign-in, same-email guest claim, wrong-email claim
   rejection, checkout verification, case access, preview-ready/recovery, expired
   code, resend and replay. If enabling currently unused Auth security notices or
   email-change flows, also test those before enabling their platform toggles.
   Check real From, Reply-To, HTML/text, links, provider events and authenticated
   return behavior. Keep prior SMTP settings available throughout the cutover.
8. For lifecycle staging, select dry run in Communications first. It starts a new
   enrollment boundary and returns counts without creating jobs. For actual test
   sending use allowlist transport, enable the database rollout, then create new
   synthetic cases and advance the actual workflow. Never rewind real customer
   timestamps to test timing.
9. Store `venfour_email_api_origin` and `venfour_email_dispatch_secret` privately in
   Supabase Vault. The latter must equal the backend dispatcher secret. Activate
   only the `venfour-communications` pg_cron job after verifying these values and
   intended deployment. It runs every minute, dispatching up to three messages per
   request. No Cloud Scheduler resource is required. Check `cron.job_run_details`
   and the private `net._http_response` statuses; do not log authorization headers.
10. For production, deploy with transport in allowlist/disabled and database paused.
    Verify identities and a staff-only preview. Change transport to live, enable
    the scheduler, then choose **Enable for new cases** deliberately. First database
    activation excludes every case already present at that moment. Do not backfill
    or manually lower the enrollment boundary. If a canary already activated the
    same database, review its preserved cohort before changing transport to live.
    Existing partner/preview jobs have independent rollout controls: inspect their
    queues privately before unpausing either, since they predate the new cohort rule.

### Rollback and incident response

Pause lifecycle mail in Communications and pause its cron job; the database gate
stops discovery, new leases and preparation. Preserve delivery records and frozen
requests. Never reset accepted jobs or manufacture a new key to retry uncertain
provider acceptance. Inspect the provider record using its private message ID and
resolve the incident before any explicitly authorized resend.

For an Auth incident, switch Supabase back to its saved SMTP configuration first,
verify sign-in/recovery, then disable the backend hook flag. Pausing lifecycle
settings does not disable Auth. Setting the central transport disabled *does*
disable hook and shared partner delivery, so coordinate that broader kill switch.
Do not remove old Auth templates, claims, recovery secrets or redirect allowlists
as part of the initial rollout. Do not disable SMTP before a successful canary.

### Verification

```sh
.venv/bin/python -m unittest tests.test_local_auth_email_templates tests.test_communications tests.test_partner_delivery tests.test_partner_api
.venv/bin/python scripts/preview_emails.py --check-smtp
.venv/bin/python scripts/run_isolated_database_tests.py --container venfour-migration-rehearsal-email-final --output /tmp/venfour-email-database
```

The last command requires a dedicated network-isolated rehearsal database with all
migrations applied; it never targets the linked hosted project. Frontend checks
run from `frontend/`: `npm run typecheck`, focused Communications/admin tests,
`npm run build` and scoped ESLint. Run the existing complete suites for regression
coverage and distinguish unrelated working-tree failures from this change.

### September 11 implementation validation

- Fresh network-isolated database: all 65 migrations applied successfully.
- All 44 database suites passed; 2,319 assertions across their latest versions,
  including 94 new communications/control/milestone checks. Current response
  completion and correction were exercised through the actual database functions.
- Complete offline backend run: 1,912 tests passed, no unexpected network attempts.
  A final focused run of the updated email/Auth/partner code passed all 66 tests.
- TypeScript, production frontend build, scoped ESLint and 15 Communications/admin
  tests passed. The complete frontend run passed 1,769 tests and failed one existing
  offer-only insurer-response test; that test passed immediately in isolation.
  Full ESLint remains blocked by two pre-existing Fast Refresh errors in
  `frontend/.tmp-valuation-result/main.tsx`; that unrelated preview was not edited.
- All 27 HTML/plain-text templates exported; shared SMTP fallback consistency passed.
  Browser checks covered desktop/mobile layout, Auth code, plain text, automation
  controls and delivery activity using explicitly fictional data.
- A synthetic signed Auth hook delivered into real local Mailpit, with HTML/text,
  From/Reply-To and duplicate-request reuse checked. This is not a hosted Auth or
  real inbox canary. No external email, production migration, DNS or hosted setting
  was changed by this implementation task.
