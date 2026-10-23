# Production release — October 22, 2026

Production now matches source `33a01fcc280eec2b809bd8a1aa46c59cb06aa0a0`.
The public and customer/partner Workers serve the new versions at 100% traffic.
The verified `zafar@venfour.com` account has database-enforced staff access.

| Component | Previous version | Current version |
| --- | --- | --- |
| Customer and partner application | `f2063921-b8c5-4ad3-a815-f68610cc8c0c` | `8eeb8eee-8fcf-4fb0-8385-29d8a6fd744b` |
| Public website | `6a7fb231-760e-418a-b2e4-21685c34662b` | `19587fc8-e0cc-492f-a2a5-d413483fdc1b` |

## Scope and inventory

The release commits the shared wordmark, email branding, and designated-owner
staff bootstrap, and deploys the latest complete frontend source. Comparison
against the retained deployed trees found that the application lacked only the
footer layout update; the public build also lacked the recent intake updates.
The already deployed wordmark remains included in both builds.

Backend revision `venfour-api-production-wordmark-20261021` already serves 100%
of traffic with image
`us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:e605e90251efeb4555c635692dd2f84ecac60d775f95672821609267a8096fb2`.
All 180 runtime files match the retained image source. All 13 hosted Auth email
templates also match the checkout. Neither needed another deployment. The
October quota window remains October 1 through November 1 UTC.

Migration `20261022000000_designated_owner_staff.sql` was the only pending
migration. It is now applied, bringing production to 90 migrations. Its backfill
granted the existing verified owner account ordinary UUID-bound staff membership;
future qualifying account creation or verification receives the same grant.
Unverified, anonymous, deleted, and actively banned identities do not qualify.
Existing membership remains tied to the account UUID after an email change.
The production authorization function returns true under the owner's account
context. The existing Cloudflare staff policy already allows this email.

## Verification

- 521 isolated database assertions passed, including 46 owner-bootstrap checks.
- 85 authentication/admin consumer tests, 240 affected frontend tests, and 352
  Worker/environment tests passed. Changed-source lint passed.
- 58 offline email and partner-delivery tests passed with no unexpected network
  attempts. Hosted email-template hashes match all 13 local templates.
- Both production builds passed environment validation, contract freshness,
  TypeScript, and packaging dry runs. The existing large-chunk advisory remains.
- Frozen source matches the committed tree; built assets passed the credential
  pattern scan.
- All 61 live HTTP assertions and 257 asset comparisons passed. These cover
  public pages, app/partner entry points, health/readiness, unauthorized-request
  refusal, host isolation, framing, Access redirects, and exact served bytes.
- Worker runtime settings, bindings, and secrets were preserved. Hosted catalog
  checks confirm the trigger is enabled, its search path is empty, and ordinary
  clients cannot execute its function or read/insert staff memberships directly.
- The migration added exactly one staff membership. The existing six Auth
  accounts were preserved at the post-migration check.
- Public footer and intake entry were visually inspected. Further automated
  intake progression encountered Turnstile error `300030` in the shared browser;
  the challenge timed out into the security-check retry message. A fresh
  authenticated customer journey was not established by this check.

The first asset verification run encountered a transport failure (`curl` exit
56). A rerun with bounded retries and lower concurrency passed every assertion.
No real purchase, provider analysis, customer email, or report upload was used
for verification. Readiness and access checks do not establish a paid journey.

## Recovery and evidence

The previous Worker versions in the table are independent rollback targets.
Keep the additive migration and its history intact during frontend rollback.
Any database access correction should use a reviewed forward migration; removing
staff membership can affect assignments and immutable review history.

Source, deployment metadata, configuration comparisons, migration evidence,
test results, browser artifacts, HTTP checks, and asset hashes are retained at
`/Users/zafaralitolibov/.venfour-releases/2026-10-22-complete/`.
