# Consolidated production release — September 24, 2026

A [subsequent complete release](production-release-2026-09-24-complete.md) deployed the later source, measurement migration, consent, and policy work. That report supersedes the deferred-work status below; this record remains the history of the earlier frozen release.

Completed: the current Total-Loss Valuation Report is available through the generic product path in all 50 U.S. states and the District of Columbia. Backend, customer/partner application, and public site serve the validated source below. No state-specific product redesign was introduced.

The owner explicitly authorized nationwide activation, jurisdiction mode off, and the consolidated release. After unrelated cookie-consent and measurement work appeared in the shared checkout, the owner instructed: “Still being edited—ship the validated candidate.” Deployment therefore used an isolated archive of the frozen commit. Later work, including the uncommitted search-measurement migration, is excluded from this release.

## Source and deployed versions

Runtime source: **`3b10a43d37e9fe85b7132343eed5f83ca5b1b43c`**, committed and pushed to `main`. This completion report is documentation only; it does not change the deployed runtime source.

| Component | Deployed identity |
| --- | --- |
| Backend | `venfour-api-production-release-0924-3b10a43`, 100% traffic |
| Project / region | `venfour-prod` / `us-east4` |
| Image | `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:be418a75d6e437440e303da4cc130a920258ccc1a561446dc20b3cadac3279ed` |
| Cloud Build | `6e5373b6-cc84-455c-abb8-bd65fcb42f7a`, SUCCESS |
| Source archive | `gs://venfour-prod_cloudbuild/source/1790264120.184017-093f3b6a537d4ffc9da79fc10da3dca5.tgz`, generation `1790264121155144` |
| Archive SHA-256 | `0b22f9ac450362b8a99e3e9a2d81019318e5737ef5e8c7b35438f04d2e55a744` |
| Customer and partner Worker | `venfour-frontend-production`, version `7ad93a89-fcef-45bc-aa97-0d6bd6cacb96`, 100% |
| Public Worker | `venfour-public-site`, version `4786ab2b-bef4-4bb0-bb02-f0c3c74a5e7b`, 100% |

All 182 uploaded backend files match the frozen commit byte for byte. Downloaded Worker code matches the validated bundle on both deployments. Served assets match retained production builds: customer 7/7, partner 7/7, public 6/6 allowed assets. Public-host exclusion of the email-logo path remains intentional. Both Worker deployment annotations name the full runtime commit.

The backend was first deployed with no traffic, checked at its tagged URL, then promoted. Its only environment change is the nationwide flag. Secret version references, service account, resources, queue target, and prior revision tags remain intact. Frontend builds used explicit, separate production and public environment files; the public build contains no customer application configuration.

## Migrations and security

**No migration was pending in the validated candidate, so none was applied today.** Production already had all 88 migrations through `20260923000000`. The restricted-role deployment blocker described in the request had been corrected and deployed on September 23. Fresh inspection confirmed the corrected authorization-path invariant; no elevated platform credential or broader IAM permission was obtained.

Post-release audit: zero role violations, zero unauthorized direct/transitive paths, zero unexpected private-table ACLs or publication/attestation execution grants, and no application tables without RLS. Restricted publisher/attestor roles retain no login, superuser, role-creation, or RLS-bypass attribute. Authority configuration remains empty: no signing keys, publishers, approved reviewers, publications, attestations, or enrolled cases. Audit/history and authority infrastructure remain installed.

The later `20260924000000_search_measurement.sql` file belongs to the owner-deferred work; it was neither part of the frozen source nor applied.

## Availability and product boundaries

| Setting | Final value |
| --- | --- |
| `VENFOUR_NATIONWIDE_PRODUCT` | `true` |
| `VITE_NATIONWIDE_PRODUCT` | `true` in the customer/partner build |
| `VENFOUR_JURISDICTION_MODE` | `off` |
| Public intake | Open; public-only build routes customers to the application |
| Product version | `2026-09-22.1` |
| Product label | Total-Loss Valuation Report |
| Method | `generic_product_method`, existing deterministic adjustments |
| State-specific method overrides | None required or applied |
| Appraisal label permission | False in every checked jurisdiction |

The previous exposure blockers were the disabled frontend/backend nationwide flags. Activation required no legal-rule publication or enforcement mode. Unresolved sales tax, title, registration-transfer, and replacement-credit components remain explicitly unresolved and excluded from vehicle value; they do not reject the generic product path. This release does not claim every state's law or operating permissions have been reviewed.

The current product, methodology, report format, workflow, checkout, and customer experience remain the same nationwide. Customers send their own insurer communications. Direct insurer sending, negotiation, representation, formal appraisal-clause services, umpire services, claim-right assignment, and proceeds assignment remain unavailable. No independent/licensed/certified appraisal terminology was activated.

## Nationwide and routing verification

A normal anonymous customer session created one explicitly synthetic draft through the deployed intake. Vehicle facts were fictional (2020 Toyota Corolla; Missouri search ZIP). No insurer document, contact details, consent submission, analysis, checkout, payment, or email was submitted. Trim-provider requests were intercepted in the browser to prevent quota usage; ordinary nonmetered vehicle make/model lookup was used. State/product API calls were real production calls through the owner-authenticated application gateway.

All requested UI selections saved successfully with HTTP 200: **MO, CA, TX, FL, NY, PA, MA, AK, HI, DC**. Each returned `PRODUCT_READY_WITH_GENERIC_RULES` and an available generic method. The normal continue handler saved location facts, then stopped at deliberately empty required contact fields. This proves state intake and generic eligibility, not a completed customer analysis.

A separate sequential authenticated API check covered **all 51** jurisdiction records on the same draft. Every response had the requested state, generic method available, zero applied overrides, unresolved settlement components, the same report label, appraisal labels disabled, and the same six disabled capability identifiers. No state was rejected solely for lacking a state-specific override.

All **21 HTTP smoke checks** passed: public pages/resources, canonical redirect, customer entry/sign-in, partner entry, health/readiness forwarding, unauthenticated checkout/product/partner protections, public and partner host isolation, internal Access protection, webhook method restrictions, and direct-backend API protection. Public homepage, partner homepage, and the restored state-intake form were visually checked after deployment.

## Health, dependencies, support, and recovery

- Backend `/health` returns `ok`; `/ready` returns `ready`, on both the candidate tag and production service. The final sampled new-revision log window contains no error-severity entries.
- Stripe configuration is unchanged: live account charges/payouts enabled; active one-time USD 19,900-minor-unit price `price_1UFeIkCJhANXFiZnfJ3samsb`; enabled webhook `we_1UFeIlCJhANXFiZnfJ3samsb` at `https://app.venfour.com/webhooks/stripe`. No real checkout or payment was made.
- Provider configuration and pinned secrets are unchanged. Declared MarketCheck allowance is 500 requests for September, with a 20% reserve, 4 prior untracked attempts and 73 tracked attempts: **323 routine attempts remaining**. Final tracked attempts remain 73. This is the configured ledger calculation, not an independently purchased balance or a guarantee for an arbitrary case.
- Existing report-review qualification remains accepted for the exact deployed prompt/schema/input/evaluation combination. The September 23 artifact passed 28/28 cases; digest `adf7f327e00f368f0f98b1b013c8a97e7c74892058ac60a26e7082fc2f406c53` is preserved. The current validation gate accepts it; no genuine qualification rerun was needed or performed.
- Queue `venfour-case-processing-production` is RUNNING and empty, retaining one concurrent dispatch and existing retries. Recovery scheduler remains enabled every five minutes. The new revision logged successful scheduled recovery at `2026-09-24T16:05:04.038553Z`: `dispatcherConfigured=true`, reserved/dispatched/failed all zero.
- Support remains `support@venfour.com`. Partner authentication mail remains configured through the existing provider, from `Venfour <auth@venfour.com>` with that support reply-to address. Support/auth/private-storage configuration was preserved; no delivery email was sent during smoke testing.
- The optional protected paid-configuration inspection using service-account impersonation was unavailable to the active operator credential. No IAM was expanded. Public readiness, unchanged pinned configuration, read-only database checks, and actual scheduled recovery provide the reported evidence; an authenticated paid customer journey is not claimed.

## Economics and preservation

**$199, automatic no-support refunds, under-$1,000 behavior, exact-$1,000 behavior, $50/$75 partner commissions, and attribution rules are unchanged.** Commerce, customer-delivery, insurer-response follow-up, paid-delivery, report-release gate, reviewer/evaluation, valuation rendering, nationwide method/configuration, and accepted qualification files were verified byte-identical to the previous deployed source where these contracts reside. Existing regression tests cover these boundaries; no new economic interpretation was introduced.

All **298 pre-existing rows across 104 inventoried tables** retained their exact row counts and aggregate fingerprints after excluding only the explicitly identified synthetic case/owner. Both existing stored objects, totaling **391,637 bytes**, retain their original hashes; private backups remain retained. No production customer data was lost or reset.

Synthetic draft `697b97c7-4d75-4170-89ed-75c0309b3d6e` and its anonymous owner `b819a7f3-61ff-47e8-a1a1-78638b1be4e9` remain recorded, with 62 immutable fact revisions. The extra revision was an initial API smoke attempt whose response-check script was corrected before the complete 51-state run. No history was deleted. Final orders, payments, entitlements, package jobs, report versions, workflow work items, and communication deliveries are all zero. Provider attempts remain at their baseline count.

## Intended changes and validation

The release includes all intended source at the task's initial checkout, plus the release verification/documentation changes in `3b10a43`. Beyond nationwide activation, this ships saved-report intake recovery and labeled vehicle engine facts; valuation review/detail/estimate wording and layout; clearer refund explanation without changing policy; and related customer, staff, and partner consumer coverage. Public, customer, and partner builds all come from the same frozen source. Committed fictional preview additions remain available locally and are excluded from production assets. The inventory appendix classifies all 72 changed paths relative to prior deployed source `0cbf7e7dff8037f9a787ce70fdeea9b7ed7d6a03`.

Validation evidence:

- Offline backend: **2,319 tests, zero failures/errors, four skipped, zero unexpected network attempts**. Three deliberate guard probes were blocked.
- Full frontend baseline run: 2,425 passed, 14 skipped, with three stale heading/timing assertions identified. Those assertions were corrected to current intended UI behavior; the final affected-file run passed **124/124**, including 14 nationwide form tests. No unresolved frontend test failure remains from that run.
- Both production builds passed TypeScript and generated-contract checks. Targeted lint and final source diff checks passed. Existing bundle-size advisories remain; no build error was suppressed.
- Production evidence: all 51 API states, ten requested UI states, 21 HTTP checks, 20 asset comparisons, both Worker-code comparisons, backend archive parity, role/RLS/ACL audit, storage/row preservation, Stripe read checks, and recovery checks passed.

Protected operational evidence and build inputs are retained under the local release archive `~/.venfour-releases/2026-09-24`; secret-bearing configuration and source-session material are not committed with this report.

## First supervised customer and intentionally disabled work

No demonstrated technical migration, deployment, readiness, or nationwide-eligibility blocker remains. Unresolved future state-specific enhancements are not activation blockers. The customer's existing report/evidence/ownership/payment/delivery gates remain authoritative for each case.

A real customer's complete provider-to-payment-to-private-report-and-follow-up journey remains unproven by this release: those operations were intentionally outside this nonbillable smoke. The first real case still needs supervision of its normal intake/evidence checks, actual customer-initiated payment/webhook, durable work, private report delivery, and support/refund checkpoints. No real-customer acceptance or end-to-end success is invented from the component checks.

Existing policy-version follow-up remains: the frozen acknowledgment constants are dated August 23, while the deployed Terms and Privacy pages carry later dates. This was not altered as part of availability activation or silently declared resolved. Existing manual payment approval remains false and was not changed; selecting a supervised case/operator is an operational follow-up, not newly enabled jurisdiction enforcement.

Owner-deferred cookie-consent, measurement, search-landing, related policy edits, and their new migration remain unshipped. Nationwide activation does not enable direct insurer communication/negotiation, representation, formal appraisal-clause services, appraisal labels, or jurisdiction enforcement.

## Recovery reference

Previous serving backend: `venfour-api-production-release-0923-0cbf7e7`, image digest `40039ed1d6bac4f76784494e2875eeaddcf54690d8ae160dbc2937e5891d6782`. Previous app/partner Worker: `af89bc0e-d323-4f7e-85ca-df241682a94b`; previous public Worker: `0c8006e1-ec7d-444f-811c-bea613cabd5a`. Their prior nationwide flags were false. Any future coordinated rollback must retain additive migrations and the new synthetic/customer fact history; no reset, down migration, or data deletion is part of this release.

## Complete source delta classification

| Status | Path | Classification |
| --- | --- | --- |
| M | `docs/engineering/nationwide-product.md` | documentation only |
| M | `docs/engineering/production-release-2026-09-23.md` | documentation only |
| M | `frontend/preview/workspace/README.md` | local fictional preview or screenshot; excluded from production bundle |
| A | `frontend/preview/workspace/catalog.test.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/preview/workspace/catalog.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/preview/workspace/claim-fixtures.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/preview/workspace/staff/operations-fixtures.ts` | local fictional preview or screenshot; excluded from production bundle |
| A | `frontend/preview/workspace/staff/screen-services.test.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/preview/workspace/staff/screen-services.ts` | local fictional preview or screenshot; excluded from production bundle |
| A | `frontend/preview/workspace/state.test.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/preview/workspace/state.ts` | local fictional preview or screenshot; excluded from production bundle |
| M | `frontend/src/app/app.test.tsx` | intended source or regression coverage |
| M | `frontend/src/components/customer-workspace.test.tsx` | intended source or regression coverage |
| A | `frontend/src/config/review-price.ts` | intended source or regression coverage |
| M | `frontend/src/features/analyses/components/free-valuation-processing.test.tsx` | intended source or regression coverage |
| M | `frontend/src/features/analyses/components/free-valuation-processing.tsx` | intended source or regression coverage |
| M | `frontend/src/features/analyses/components/preliminary-analysis-result.css` | intended source or regression coverage |
| A | `frontend/src/features/analyses/components/result-review-panel.css` | intended source or regression coverage |
| A | `frontend/src/features/analyses/components/result-viewport.css` | intended source or regression coverage |
| M | `frontend/src/features/analyses/components/total-loss-analysis-experience.test.tsx` | intended source or regression coverage |
| M | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx` | intended source or regression coverage |
| A | `frontend/src/features/analyses/components/vehicle-detail-question.tsx` | intended source or regression coverage |
| M | `frontend/src/features/diminished-value/diminished-value-start-flow.test.tsx` | intended source or regression coverage |
| A | `frontend/src/features/full-review/refund-protection.tsx` | intended source or regression coverage |
| M | `frontend/src/features/full-review/report-review.tsx` | intended source or regression coverage |
| M | `frontend/src/features/full-review/report-upload-dialog.test.tsx` | intended source or regression coverage |
| M | `frontend/src/features/full-review/report-upload-dialog.tsx` | intended source or regression coverage |
| A | `frontend/src/features/full-review/review-offer.css` | intended source or regression coverage |
| M | `frontend/src/features/intake/appraisal-start-layout.tsx` | intended source or regression coverage |
| M | `frontend/src/features/nationwide/product-panel.test.tsx` | intended source or regression coverage |
| M | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx` | intended source or regression coverage |
| A | `frontend/src/features/total-loss/confirm-vehicle-detail.test.ts` | intended source or regression coverage |
| A | `frontend/src/features/total-loss/confirm-vehicle-detail.ts` | intended source or regression coverage |
| M | `frontend/src/pages/appraisal-start-page.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/appraisal-start-page.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/guest-preview-return.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/home-page.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/local-status-experience-page.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/total-loss-analysis-page.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/total-loss-analysis-page.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/total-loss-claim-workflow-page.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/total-loss-full-review-page.test.tsx` | intended source or regression coverage |
| M | `frontend/src/pages/total-loss-start-page.test.tsx` | intended source or regression coverage |
| A | `output/playwright/free-result-mobile.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/premium-estimate-mobile.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/premium-result-desktop.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/premium-result-mobile.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/saved-report-dialog-mobile.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/saved-report-result-desktop.png` | local fictional preview or screenshot; excluded from production bundle |
| A | `output/playwright/saved-report-result-mobile.png` | local fictional preview or screenshot; excluded from production bundle |
| M | `schemas/ccc/effective-report-v2.schema.json` | intended source or regression coverage |
| M | `schemas/ccc/report-v2.schema.json` | intended source or regression coverage |
| M | `schemas/ccc/report.schema.json` | intended source or regression coverage |
| M | `schemas/normalized-valuation-report-v2.schema.json` | intended source or regression coverage |
| M | `schemas/normalized-valuation-report.schema.json` | intended source or regression coverage |
| M | `scripts/extract_report_ai.py` | intended source or regression coverage |
| A | `scripts/reassess_saved_report.py` | intended offline diagnostic; packaged but never invoked during release |
| M | `tests/test_case_analyses.py` | intended source or regression coverage |
| M | `tests/test_full_review.py` | intended source or regression coverage |
| M | `tests/test_full_review_processing.py` | intended source or regression coverage |
| M | `tests/test_market_evidence_presentation.py` | intended source or regression coverage |
| M | `tests/test_nationwide_product.py` | intended source or regression coverage |
| A | `tests/test_report_vehicle_facts.py` | intended source or regression coverage |
| M | `venfour/case_analyses.py` | intended source or regression coverage |
| M | `venfour/creation.py` | intended source or regression coverage |
| M | `venfour/efficient_search.py` | intended source or regression coverage |
| M | `venfour/full_review.py` | intended source or regression coverage |
| M | `venfour/full_review_processing.py` | intended source or regression coverage |
| M | `venfour/market_evidence_presentation.py` | intended source or regression coverage |
| M | `venfour/presentation.py` | intended source or regression coverage |
| M | `venfour/report_ingestion.py` | intended source or regression coverage |
| A | `venfour/report_vehicle_facts.py` | intended source or regression coverage |
