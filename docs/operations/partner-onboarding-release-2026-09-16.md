# Collision-center partner onboarding release

Production agreement version 1 is published. Its title, sixteen sections, and
structured commission policy exactly match the existing reviewed source. The
original held draft remains preserved. The guarded, idempotent release operation
is `supabase/operations/release_partner_agreement.sql`; run it only with the
verified staff partner manager's UUID. No schema migration or reset was needed.

The agreement retains $50 for qualifying successes 1–9 and $75 from success 10
in the verification month, with the existing outcome and refund qualifications.
The accepted version, content digest, authenticated identity, and server timestamp
remain in immutable agreement/signature records. Manager countersignature is
required for activation. Commission review and payment administration remain
manual; no transfer automation was introduced.

## Resend setup

The existing production application reads `RESEND_API_KEY`, bound to
`projects/venfour-prod/secrets/venfour-resend-api-key/versions/2`.
The production runtime service account has access to this secret. Version 1 is
an intentional blank bootstrap value. Version 2 contains the production sending
credential and is the version used by the released service.

The Resend owner account now has a key named
`Venfour production partner invitations`, restricted to **Sending access** for
`venfour.com`. It is saved as Secret Manager version 2. The service was redeployed
to load it. No manual key entry or additional restart remains for this release.

For future rotation, add the replacement as a **new version** in [Google Secret Manager](https://console.cloud.google.com/security/secret-manager/secret/venfour-resend-api-key/versions?project=venfour-prod).
Do not put it in frontend configuration, source control, chat, or command arguments.
Then update the binding to that version and deploy a new revision of
`venfour-api-production` in `us-east4`. No image rebuild or frontend deployment is required.
For example, use a fresh revision suffix and move traffic after readiness passes:

```sh
gcloud run services update venfour-api-production --project=venfour-prod --region=us-east4 --revision-suffix="resend-$(date -u +%Y%m%d%H%M%S)" --update-secrets="RESEND_API_KEY=venfour-resend-api-key:NEW_VERSION_NUMBER" --no-traffic
gcloud run services update-traffic venfour-api-production --project=venfour-prod --region=us-east4 --to-latest
```

`VENFOUR_PARTNER_EMAIL_PROVIDER=resend` uses the existing verified sender
`Venfour <auth@venfour.com>` and project support reply-to `support@venfour.com`.
Supabase Auth SMTP and its disabled optional email hook remain unchanged.
`VENFOUR_PARTNER_EMAIL_DISPATCH_SECRET` references the dedicated
`venfour-partner-email-dispatch-secret` secret. Its matching private Vault value
and trusted API origin are configured, and the existing minute delivery schedule
is enabled. One configuration check was accepted by Resend's documented test
recipient using the existing application transport and configured sender/reply-to.
No real customer or partner invitation was sent during setup.

## First partner

1. Sign in as `zafar@venfour.com` at
   [Referral partners](https://app.venfour.com/admin/referral-partners).
2. Open **Add a referral partner**, enter the collision center's business name,
   invited contact email, state, and **50.00** in the legacy base commission field.
   The published agreement's structured $50/$75 tiers control actual earnings.
3. Create the record and send its invitation. The partner follows the email to
   `partners.venfour.com`, authenticates using that exact invited email, accepts
   the invitation, completes business details, reads the agreement, and explicitly
   signs the unchecked confirmations.
4. Review and countersign the same agreement in the manager workspace to activate
   the partnership. The partner can then copy the referral URL or download its QR
   image. Both point to the same public referral URL.
5. Customers arriving through that URL retain the existing attribution flow;
   their referral is recorded when intake is submitted. A click or purchase alone
   does not establish a qualifying commission.

## Focused verification

- 57 frontend tests: partner pages/authentication, referral controls, QR download,
  paused links, and staff sign-in completion.
- 52 backend tests: partner API authorization, referral endpoints, existing email
  delivery configuration, and agreement source consistency.
- 150 isolated database assertions: onboarding against the released agreement,
  consent/signature/version retention, activation, attribution, and access limits.
  These used the existing local rehearsal database and rolled back all fixtures.
- Production build, changed-file lint, and whitespace checks passed.
- Production agreement published with unchanged terms; service health/readiness
  and authenticated empty dispatch passed. Missing-key dispatch first reported
  disabled; after installing the credential, dispatch reported enabled.
- The deployed partner entry page opened normally in Chrome with email, Google,
  and Apple sign-in. Scripted HTTP probes received 403 and were not used as browser
  sign-in evidence. Provider acceptance was verified with its test recipient;
  delivery to a real collision center's mailbox awaits its actual invitation.

Production frontend version: `5d2245c4-ee02-4e7a-9a71-9b28dc7a30e7`.
Production API revision: `venfour-api-production-partner-resend-20260916`.
The existing backend image was retained. No Stripe or market-provider calls,
production partner fixtures, staging deployment, or showcase changes were made.
