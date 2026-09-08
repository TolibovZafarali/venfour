# Referral partners

This release provides invitation-only business onboarding, website signatures,
manager countersigning, retained agreement PDFs, transactional copies, stable
referral links, and purchase attribution. Commission ledgers, earnings balances,
payout records, and payment transfers remain separate milestones.

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

## Referral links and attribution

Each active partner receives one stable website link at `/r/:code`. It opens the
existing total-loss intake at `/start?service=total-loss`; customers do not need
to enter a referral code or take an additional onboarding step. A designated
manager can pause or resume the link. Its code stays the same and has no expiry.
Pausing a link stops new attribution while preserving prior referral history.
Unknown, invalid, or paused codes continue to ordinary intake without attribution.
An operational failure offers a retry instead of silently discarding attribution.

Attribution attaches only when a new case is created. The first valid referral
attached to that case keeps the credit without an attribution expiry. New
customers and returning customers starting a new case are eligible for this
technical attribution path. Opening a referral link never creates another case
when the customer resumes an existing draft, adds attribution retrospectively to
a draft, or replaces a referral already attached to a case. Customer ownership
and existing case recovery remain unchanged.

A submitted referral appears only after the existing contact-information save
succeeds. A page visit or an unfinished intake does not count as a submitted
lead. Purchase attribution is recorded atomically with the existing server-side
payment fulfillment operation, not a checkout return page. Replayed webhooks
and fulfillment retries cannot create another conversion for the same logical
order. The attribution and conversion retain the executed agreement reference
and frozen fixed USD commission in integer cents; this is evidence for a later
commission workflow and does not create an earnings balance or payout.

The dashboard reports submitted referrals, historical purchases, refunds, and
payments under review separately. Refunded or disputed payments retain the
historical purchase and display their current status from authoritative payment
records. The referral list exposes only an opaque referral reference, submission
date, purchase date when applicable, and one of **Review submitted**, **Purchased**,
**Refunded**, or **Payment under review**. It does not expose customer names,
emails, contact details, vehicle or report information, internal case/order
identifiers, or provider payment identifiers.

Both dashboards use the authenticated partner operations API. `referral_summary`
accepts `partner_id`; `referral_list` also accepts `page` and `page_size`
(defaults 1 and 50, maximum page size 100). Manager-only `link_state` accepts
`partner_id`, the link's `expected_revision`, `enabled`, and a stable `request_id`.
Manager reads map internally to `staff_referral_summary` and
`staff_referral_list`, so the database checks both current manager permissions
in the same operation. Partner reads require an explicit association with that
business even when the caller also happens to be a manager. The API rejects
unexpected projection fields and uses private, non-cacheable responses. Public
referral resolution remains part of the existing intake database boundary;
there is no public Python endpoint exposing partner records or referral lists.

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

For an interactive walkthrough with fictional businesses and captured email:

1. Open `http://127.0.0.1:5173/admin/referral-partners` and sign in with the
   designated local partner-manager account. Its sign-in code arrives in Mailpit.
2. Create a fictional business with an `example.test` contact address and send
   its invitation. Keep a published, explicitly non-binding local agreement
   template available for this walkthrough.
3. Open `http://127.0.0.1:54324`, find the business invitation, and follow its
   onboarding link in a separate browser profile or private window. This keeps
   the manager and business sessions separate.
4. The business uses the same **Sign in to Venfour** modal as other users. Choose
   **Continue with Email** and use the current code delivered to the invited
   address in Mailpit. Successful sign-in returns to the exact invitation.
5. Accept the invitation, save company information, review the agreement, and
   sign with the required acknowledgements. Return to the manager's record to
   review and countersign; this activates the partnership.
6. Refresh the business workspace to see its referral link and referral activity.
   The completed agreement is available in its history, and Mailpit receives the
   same retained PDF as an attachment. A new business starts with zero referrals.

This walkthrough uses local Auth, database records, private document storage, and
Mailpit delivery. The standalone preview on port 4179 remains a browser-only
fixture and does not send email.

Apply migrations to the isolated local database without resetting existing data.
Create uniquely named fixture accounts and grant only the fixture manager both
permissions. Use explicit synthetic wording and business details. Verify a new
contact through the real local Auth email code, then complete profile, signature,
manager countersign, both dashboard downloads, and the Mailpit PDF attachment.
Compare all three copies by SHA-256. Repeat account-isolation checks with an
existing unrelated user; retain customer-case ownership throughout.

For referral verification, copy the activated fixture business's real local link
and open it in a separate customer session. Complete the ordinary contact save,
then use the existing local Stripe checkout and webhook listener to fulfill the
purchase. Verify the partner list progresses from **Review submitted** to
**Purchased** only after server-side fulfillment. Repeat fulfillment and the
webhook without increasing the historical purchase count. Exercise test refund
and dispute states and verify their separate counts and current labels while
retaining the original purchase date and historical purchase count.

Repeat with a returning customer starting a new case, an existing unattributed
draft, an already attributed draft, a competing referral link, and a direct
unreferred customer. Verify there is no extra case, retrospective attribution,
or change to existing case ownership. Pause and resume a fixture link, confirm
its code is stable, and check invalid/paused links follow ordinary intake.
Exercise an operational failure during referral resolution and confirm the
customer can retry. Remove either fixture manager permission and confirm both
manager reads and link mutations stop; unrelated partner contacts must never
see the fixture business's referral data.

Exercise expired/revoked invitation links, stale review pages, exact request replay,
permission removal, worker restarts, storage and sender failures, and explicit
resend. Inspect short and multipage rendered PDFs, desktop/mobile layouts, and
keyboard operation. Use the protected dispatcher locally to recover durable work
without relying on an open browser. Record local verification separately from
hosted provider readiness.

Hosted permission grants, reviewed production wording, domain/sender setup, live
invitations, commits, and deployment are separate release operations.

## Local attribution verification — 2026-09-08

The real local partner link was followed through guest draft creation, ordinary
intake contact submission, Supabase email-code verification, and Stripe's hosted
test Payment Element. Case `de34e71a-f0a4-4c0f-b15b-e810a2d40db5` retained its
referral across verification. The local valuation providers were disabled, so a
synthetic analysis result was prepared on this same case to reach checkout.
This is payment-provider proof with synthetic valuation evidence.

An insufficient-funds test card left the purchase conversion count at zero. A
successful test-card retry produced a signed `checkout.session.completed`
webhook, HTTP 200, and a processed test-mode event. The case has exactly one case
attribution, one order attribution, one purchase conversion, one payment, and
one entitlement. Both real dashboards displayed the same opaque reference and
purchase date. The link was paused before payment; its existing attribution
still received the purchase. Resuming retained the original code.

Desktop (1280 px) and mobile (390 px) checks covered the real partner dashboard
and synthetic manager preview, with no page-wide horizontal overflow. Copying
and pagination worked with the keyboard. The synthetic preview separately
displayed submitted, purchased, refunded, and payment-under-review examples.
It does not provide payment-provider evidence.

Validation passed: 1,725 backend tests, 1,733 frontend tests, 2,081 database
assertions, both local concurrency harnesses, lint, typecheck, production build,
and whitespace checks. Refund/reversal/dispute and duplicate-payment behavior
were exercised in database/offline tests; only decline and successful purchase
were exercised through Stripe for this browser case. Report preparation remains
queued in the local checkout composition. No hosted configuration, production
agreement, live referral, commit, or deployment was changed.

The database suite runs with
`frontend/node_modules/.bin/supabase test db supabase/tests/database --local`.
The existing response-retry concurrency harness requires its documented local
administrator runtime:

```sh
docker exec -i supabase_db_venfour \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/concurrency/response_retry_lock_order.sql
```

The focused referral concurrency harness uses the local Python test runtime
(including `psycopg`) and connects only to the `supabase_db_venfour` container's
loopback port:

```sh
.venv/bin/python supabase/tests/concurrency/referral_attribution_races.py
```

It observes actual PostgreSQL lock waits between independent connections for
competing referral links, direct/referred draft creation, and duplicate payment
fulfillment. It creates random disposable database fixtures, uses an unpublished
fixture template, and removes only those exact identities in a final cleanup
transaction. It sends no email and does not call Stripe; the local browser and
Stripe journey above remains a separate verification step.
