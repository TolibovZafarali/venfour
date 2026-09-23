# Nationwide product verification

Repository-local checks, September 22, 2026. No hosted readiness is asserted.

## Backend

Commands use `.venv/bin/python scripts/run_offline_tests.py` followed by these
selectors. Credentials were cleared and the guard rejected its DNS/HTTP/socket
probes before network activity. Every final run reported zero failures/errors,
zero skipped tests and zero unexpected network attempts. Counts below are per
run; overlapping selectors are not additional independent tests.

| Selectors | Passed |
| --- | ---: |
| `test_valuation_review test_report_processing` | 45 |
| `test_nationwide_product test_paid_delivery test_jurisdiction test_efficient_search test_search_geography test_market_request_budget test_full_review test_full_review_processing test_customer_delivery test_commerce` | 273 |
| `test_nationwide_product test_report_processing.ReportProcessingTests.test_nationwide_generation_captures_facts_without_changing_assessment test_report_release_gate test_insurer_response_followup` | 45 |
| `test_partner_commissions test_partner_earnings test_partner_outcomes` | 28 |
| `test_nationwide_product test_nationwide_report.NationwideReportTests` | 16 |

The new report worker test also verifies template/renderer 5 completion metadata,
captured fact revision and unchanged assessment values. The product suite was
rerun after final override validation changes: 13 passed.

## Frontend

`npm --prefix frontend test --`:

- `src/features/nationwide/product-panel.test.tsx`
- `src/pages/total-loss-start-page.test.tsx`
- `src/pages/total-loss-claim-workflow-page.test.tsx`
- `src/pages/home-page.test.tsx`
- `src/pages/public-resources.test.tsx`

**191 passed across five files.** The panel/intake subset was rerun after the
final confirmation guard change: 102 passed. Typecheck (including generated presentation
contract freshness), production build, and targeted lint passed. The build
reported the existing large-chunk warning; test DOM output reports unsupported
`window.scrollTo`. Neither caused a failed check. A preexisting intake-test mock
was missing the current diminished-value availability export; the fixture now
includes the existing `false` value. Application availability was not changed.

## Database

Applied all repository migrations, including the one new additive migration, to
fresh disposable container `venfour-migration-rehearsal-product-0922` using the
cached PostgreSQL image. Network mode `none`, no published ports, schedulers off;
only schema-only Auth/Storage definitions were read from the existing local
Supabase database. No application/customer records were copied. No hosted project
was accessed. Test fixtures roll back. The disposable container was stopped
after verification; its schema and local logs were retained.

Used `scripts/run_isolated_database_tests.py --container
venfour-migration-rehearsal-product-0922 --output /tmp/venfour-product-db-tests`
with the following explicit `supabase/tests/database/` files:

| SQL suite | Passed assertions |
| --- | ---: |
| `058_nationwide_product.test.sql` | 20 |
| `017_total_loss_report_release.test.sql` | 73 |
| `056_jurisdiction_foundation.test.sql` | 35 |
| `057_jurisdiction_authority.test.sql` | 23 |
| `051_full_review_payment_gate.test.sql` | 50 |
| `015_total_loss_stripe_commerce.test.sql` | 152 |
| `018_total_loss_customer_delivery.test.sql` | 56 |
| `054_referral_partner_proposal.test.sql` | 15 |
| `038_referral_partner_attribution.test.sql` | 65 |
| `053_customer_workspace_navigation.test.sql` | 19 |
| `036_staff_admin_workspace.test.sql` | 87 |
| `050_paid_work_delivery_recovery.test.sql` | 27 |
| **Total** | **622** |

`VENFOUR_EARNINGS_TEST_CONTAINER=venfour-migration-rehearsal-product-0922
.venv/bin/python -m unittest tests.test_partner_earnings_database` passed three
integration tests: 94, 86 and 92 assertions (**272 additional assertions**). This
harness independently verifies the container name/network isolation before Docker
execution. All payments and commissions in these tests are synthetic database
fixtures, not provider transactions.

The first authority check detected PostgreSQL 17's automatic admin-only creator
memberships for `postgres` on newly created no-login roles. Those memberships
were removed only from the disposable target, then the unchanged authority suite
passed. No reviewer, authority key, attestor identity, publisher identity, or
operating authority was provisioned. The report test's owner-only immutability
assertions now explicitly restore the owner role instead of granting workers
direct table access.

## Coverage of requested boundaries

| Boundary | Evidence |
| --- | --- |
| 51 records, both claim types, default label, disabled capabilities, zero invented state rules | Nationwide product matrix loops over every jurisdiction for first/third party |
| Unknown, foreign, territorial, conflicting, multiple-state and commercial facts | Product projection/API tests; existing jurisdiction tests |
| ZIP market role versus jurisdiction | Product tests use MO/CA/AK/HI/DC ZIP origins and prove ZIP/IP inputs create no state candidate |
| Override state/scope/effective/verification dates | Synthetic scoped rules, conflicting loss dates, exclusive expiry, bounded runtime-policy adapter |
| Settlement separation, no fabricated tax/fees | Null amounts/totals across all 51; separate synthetic verified note; report monetary output equals legacy assessment |
| Adaptive expansion, ranking, replay, provider budgets | Existing efficient search, geography and request-budget suites |
| Evidence eligibility, strict report requirement and no-support | Full review/payment gate, report release, report processing, customer delivery |
| $199, refunds, event idempotency and historical access | Commerce and SQL commerce/delivery/recovery; no changes to price/refund source or policy |
| Under-$1,000 / exactly-$1,000 | Public refund policy left unchanged (manual branch); commission strict-cent threshold tests reject exactly 100,000 cents |
| Partner tiers, attribution, refunds/reversals, payout history | Commission/outcome/earnings unit tests and isolated SQL integration |
| Holds, missing approval, revocation, release races | Existing paid-delivery and jurisdiction tests, release-gate tests, empty-authority SQL checks; no authority publication performed |
| Customer-controlled submission and follow-up | Customer delivery, insurer-response follow-up and workflow regressions; no insurer transport added |
| Fact writes and backend bypasses | Owner/guest/staff isolation, forbidden provenance/permission payloads, optimistic revision conflict, private capture table and immutable trigger |
| Frozen reports and historical compatibility | Templates 1–4 replay tests, new template 5 projection/PDF tests, immutable capture and mismatched-fact rejection |

The three-page fictional template-5 PDF was rendered and every page visually
inspected. Deterministic content, page numbering and text-bound checks passed.
It remains a local artifact at `/tmp/venfour-nationwide-report.pdf`, not a customer
report or hosted delivery proof.

## Changed-file inventory

- [.env.example](../../.env.example)
- [docs/engineering/nationwide-product-coverage.md](../../docs/engineering/nationwide-product-coverage.md)
- [docs/engineering/nationwide-product-verification.md](../../docs/engineering/nationwide-product-verification.md)
- [docs/engineering/nationwide-product.md](../../docs/engineering/nationwide-product.md)
- [frontend/.env.example](../../frontend/.env.example)
- [frontend/src/config/env.ts](../../frontend/src/config/env.ts)
- [frontend/src/features/nationwide/product-api.ts](../../frontend/src/features/nationwide/product-api.ts)
- [frontend/src/features/nationwide/product-panel.test.tsx](../../frontend/src/features/nationwide/product-panel.test.tsx)
- [frontend/src/features/nationwide/product-panel.tsx](../../frontend/src/features/nationwide/product-panel.tsx)
- [frontend/src/features/total-loss-claim/components/checkout-experience.tsx](../../frontend/src/features/total-loss-claim/components/checkout-experience.tsx)
- [frontend/src/features/total-loss/intake-steps.tsx](../../frontend/src/features/total-loss/intake-steps.tsx)
- [frontend/src/pages/admin-total-loss-case-page.tsx](../../frontend/src/pages/admin-total-loss-case-page.tsx)
- [frontend/src/pages/home-page.test.tsx](../../frontend/src/pages/home-page.test.tsx)
- [frontend/src/pages/home-page.tsx](../../frontend/src/pages/home-page.tsx)
- [frontend/src/pages/public-resources.tsx](../../frontend/src/pages/public-resources.tsx)
- [frontend/src/pages/referral-partners-page.tsx](../../frontend/src/pages/referral-partners-page.tsx)
- [frontend/src/pages/total-loss-analysis-page.tsx](../../frontend/src/pages/total-loss-analysis-page.tsx)
- [frontend/src/pages/total-loss-claim-workflow-page.test.tsx](../../frontend/src/pages/total-loss-claim-workflow-page.test.tsx)
- [frontend/src/pages/total-loss-start-page.test.tsx](../../frontend/src/pages/total-loss-start-page.test.tsx)
- [frontend/src/pages/total-loss-start-page.tsx](../../frontend/src/pages/total-loss-start-page.tsx)
- [schemas/report/valuation-evidence-pdf-validation-v1.schema.json](../../schemas/report/valuation-evidence-pdf-validation-v1.schema.json)
- [schemas/report/valuation-evidence-report-v1.schema.json](../../schemas/report/valuation-evidence-report-v1.schema.json)
- [supabase/migrations/20260923000000_nationwide_product_context.sql](../../supabase/migrations/20260923000000_nationwide_product_context.sql)
- [supabase/tests/database/017_total_loss_report_release.test.sql](../../supabase/tests/database/017_total_loss_report_release.test.sql)
- [supabase/tests/database/058_nationwide_product.test.sql](../../supabase/tests/database/058_nationwide_product.test.sql)
- [tests/test_nationwide_product.py](../../tests/test_nationwide_product.py)
- [tests/test_nationwide_report.py](../../tests/test_nationwide_report.py)
- [tests/test_report_processing.py](../../tests/test_report_processing.py)
- [venfour/api.py](../../venfour/api.py)
- [venfour/data/nationwide_product_v1.json](../../venfour/data/nationwide_product_v1.json)
- [venfour/market_search_runtime.py](../../venfour/market_search_runtime.py)
- [venfour/nationwide_product.py](../../venfour/nationwide_product.py)
- [venfour/nationwide_product_api.py](../../venfour/nationwide_product_api.py)
- [venfour/report_processing.py](../../venfour/report_processing.py)
- [venfour/supabase_gateway.py](../../venfour/supabase_gateway.py)
- [venfour/valuation_evidence_report.py](../../venfour/valuation_evidence_report.py)
- [venfour/valuation_review.py](../../venfour/valuation_review.py)

Final scope review and `git diff --check` passed. No changes to the packaged
operating registry, research seed, authority configuration or prior migrations.
No production deployment, hosted migration, live payment, paid provider call or
email occurred. Price/refund/commission economics remain unchanged.
