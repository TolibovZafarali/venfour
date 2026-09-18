# Admin and partner release — September 17, 2026

Released the public sign-in link and grouped footer, partner landing page and
sign-in routing, customer/intake separation, retained source-PDF access, and
metadata-only email history. Communications and payment-approval navigation are
removed. Clicking the brand on `/start` returns to the public homepage.

## Production state

- Database: 84 migrations, through `20260917000100_staff_email_history.sql`.
  This release applied only the two September 17 migrations.
- Backend: `venfour-api-production-admin-release-20260917`, serving 100%.
  Image digest: `sha256:c97acb85fbbbcf58949aaa565d3517f7e0c5fef9cc4045d5ee583fda96c84b80`.
- Application and partners Worker: `66b01f33-3bdb-41dd-aae1-b26751f584f6`.
- Public website Worker: `a71a8f0c-a92a-4584-8fff-f17c4fc23916`.
- Thirteen hosted authentication email templates and subjects match the
  repository. Images were removed; partner callbacks select sign-in code copy.
  The existing SMTP delivery configuration and disabled email hook are preserved.
- Manual payment approval remains disabled. Strict payment eligibility and
  existing report qualification remain authoritative.

## Verification

- All 55 isolated database suites passed: 2,767 assertions, including customer
  filtering, incomplete intake visibility, source-file RLS, revocation, retention,
  and email-history authorization/content exclusion.
- The complete offline backend suite passed: 2,167 tests, four skipped, zero
  failures/errors and zero unexpected network attempts.
- Forty focused backend email tests passed. Frontend authentication/boundary
  regression tests passed (164), as did the admin/partner regressions (82).
- The full frontend run passed 2,244 tests with 14 skipped. Its one remaining
  failure asserted the former absence of public sign-in; the updated public
  boundary suite passed all 15 tests on rerun.
- Both production frontend builds and deployment checks passed.
- The serving backend returned `200` for `/health` and `/ready`; direct staff
  requests without the required proxy authorization were denied.
- Live browser checks confirmed the public sign-in link and footer, the partner
  homepage and sign-in screen, admin routing, Referral partners navigation,
  email history, and the retained PDF opening from Incomplete intakes.
- Stored case/file counts remained five and one. There are no completed intakes;
  the customer directory and main case list therefore show zero. The existing
  uploaded PDF remains available under Incomplete intakes.

No database reset, real payment, test email, or market-provider request was made
for this release. Production market-request accounting remained at 63 records.
Direct SMTP authentication emails are not comprehensively recorded in email
history; the page discloses that coverage limit. End-to-end inbox delivery and a
new paid customer transaction were not exercised.

## Rollback references

The previous backend revision is
`venfour-api-production-partner-resend-20260916`; the previous application Worker
is `5d2245c4-ee02-4e7a-9a71-9b28dc7a30e7`, and the previous public Worker is
`9d73a925-855f-4e61-b87b-7395561aa52b`. Restore only the affected application
component if needed. Do not delete customer data or automatically reverse the
database migrations. Auth configuration and service snapshots are retained in
the ignored, private `supabase/.temp/release-20260917-private/` directory.

For a public-site rebuild, use an explicit public-only environment file with
the public origin, support address, and intake flag. Clear the Supabase client
variables so the application `.env` cannot enter the public bundle.
