# Referral partner onboarding

This release provides invitation-only business onboarding, website signatures,
manager countersigning, retained agreement PDFs, and transactional copies. It
does not provide referral links, purchase attribution, earnings, or payments.

## Access and agreement preparation

A partner manager must have both an existing `public.staff_members` row and a
separate partner-management grant. Check the exact existing Auth UUID before
granting access through trusted database administration. No permission is
automatically granted by this release, and there is no browser permission editor.
Removing either permission stops future manager operations without changing
previous signatures. Email domains and account metadata do not confer access.

The grant table is `public.referral_partner_managers(user_id)`. From a trusted
administrative connection, grant only a verified UUID already in `staff_members`:

```sql
insert into public.referral_partner_managers(user_id)
select user_id from public.staff_members
where user_id = '<existing-staff-uuid>'::uuid
on conflict (user_id) do nothing;
```

Verify that the intended UUID was selected; a missing staff row grants nothing.

Start by saving reviewed agreement wording in the admin template editor, then
publish it. Production starts with no published wording. Published templates are
immutable; changing wording produces a new version. The manager supplies the
positive fixed USD commission when creating a business. The interface does not
determine legal eligibility in any state, commission eligibility, refund rules,
or a payment schedule; the reviewed agreement must address the applicable terms.

Each business has one invited contact. Invitation links expire after seven days.
Replacing or revoking an outstanding invitation invalidates the earlier link.
The link is a locator, not authentication: the contact must sign in with the
current verified invited email, then explicitly accept the invitation.

The partner completes business details and reviews the frozen agreement before
confirming electronic signing, receipt of the PDF by email, and signing authority.
The signature records typed name/title, account identity, verified email,
acknowledgements, and server time. A manager reviews the same agreement and
countersigns to activate the partnership in one transaction. Changes before
activation require a new agreement and new signatures. Active amendments and
termination are outside this release.

## Retained copies and delivery

Signed text remains readable immediately. Document preparation and email status
are independent of the partner's status; a failed document or email operation
never removes a signature or reverses activation.

The document worker uses only frozen agreement and signature records. It creates
one deterministic PDF in the private `partner-agreements` bucket at
`partners/{partner_id}/agreements/{agreement_id}/signed.pdf`, using create-only
storage. The sealed SHA-256 digest is checked on download and email attachment.
The partner dashboard, manager dashboard, and completed-agreement email use the
same bytes. A layout or contractual change must never overwrite a retained PDF.

Document jobs and email deliveries are durable database records. Processing uses
expiring leases and fenced completion. Automatic email attempts reuse one
provider idempotency key and the same prepared message. Ambiguous delivery is
held for review before the provider's 24-hour deduplication window expires.
Explicitly sending another copy creates a new delivery record referencing the
same retained artifact. Review an uncertain send before requesting another copy;
the first email might already have been accepted. “Sent” means provider
acceptance and does not claim delivery to the recipient's inbox.

## Sender and scheduler configuration

Authentication codes remain with Supabase Auth. Referral invitations and PDF
copies use an independent server-only sender:

- `VENFOUR_PARTNER_EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`: sending-only provider credential
- `VENFOUR_PARTNER_EMAIL_FROM`: verified sender address
- `VENFOUR_PARTNER_EMAIL_REPLY_TO`: monitored reply address
- `VENFOUR_PUBLIC_APP_ORIGIN`: exact trusted HTTPS website origin
- `VENFOUR_PARTNER_EMAIL_DISPATCH_SECRET`: random private dispatcher secret

Missing or invalid sender configuration disables invitation sending visibly.
The PDF worker can still prepare retained copies. Keep these values out of
frontend environment variables, logs, screenshots, and browser responses.

Configure the matching private Vault entries `venfour_referral_partner_api_origin`
and `venfour_referral_partner_dispatch_secret`. The latter must match the API's
32–512 character ASCII dispatcher secret without spaces or control characters.
The minute-based job remains inert until
configured. The API endpoint is
`POST /internal/v1/referral-partners/dispatch`, with `Authorization: Bearer`
containing the private dispatcher secret and an empty body or `{}`. Configure a
direct trusted API origin that can reach this protected route. The immediate
attempt following an interactive action is an optimization; scheduled processing
must operate independently of browser activity or request-billed background work.

## Local verification

Use the existing launcher: `node scripts/dev-local.mjs --full-flow`. It sets the
partner sender to Mailpit at `http://127.0.0.1:54324` and uses a local-only sender.
This URL is Mailpit's HTTP service, not its SMTP listener. The launcher does not
change hosted Supabase Auth or a real transactional sender.

For onboarding-only verification without analysis or payment providers, use
`VENFOUR_LOCAL_POST_CONTINUE=1 node scripts/dev-local.mjs`. This uses the same
partner API, local database, Auth, and Mailpit. The launcher calls the protected
partner dispatcher every 15 seconds, including after backend reloads.

Apply migrations to the isolated local database without resetting existing data.
Create uniquely named fixture accounts and grant only the fixture manager both
permissions. Use explicit synthetic wording and business details. Verify a new
contact through the real local Auth email code, then complete profile, signature,
manager countersign, both dashboard downloads, and the Mailpit PDF attachment.
Compare all three copies by SHA-256. Repeat account-isolation checks with an
existing unrelated user; retain customer-case ownership throughout.

Exercise expired/revoked links, stale review pages, exact request replay,
permission removal, worker restarts, storage and sender failures, and explicit
resend. Inspect short and multipage rendered PDFs, desktop/mobile layouts, and
keyboard operation. Use the protected dispatcher locally to recover durable work
without relying on an open browser. Record local verification separately from
hosted provider readiness.

Hosted permission grants, reviewed production wording, domain/sender setup, live
invitations, commits, and deployment are separate release operations.

The database suite runs with
`frontend/node_modules/.bin/supabase test db supabase/tests/database --local`.
The existing response-retry concurrency harness requires its documented local
administrator runtime:

```sh
docker exec -i supabase_db_venfour \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/concurrency/response_retry_lock_order.sql
```
