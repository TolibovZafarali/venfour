# Google Search Ads readiness

Updated September 24, 2026 after removing the dedicated advertising page. Removal baseline: `f780feb`; the original shared readiness implementation is commit `cd13d05`. No advertising account was created or configured, no real advertising identifiers were supplied, and nothing was deployed by this update.

**PASS — ready to create the Google Ads account.** Search Ads will use the existing Venfour website and customer journey. A dedicated advertising page is neither required nor a launch condition. Shared tracking, attribution, consent, purchase/refund measurement, enhanced-conversion preparation, policy improvements, and security controls remain implemented.

This is account-setup readiness, not confirmation that configured purchase conversions are live. Before campaign spend, release/verify the retained infrastructure where needed, supply the real account configuration, and complete conversion diagnostics. Those operational steps do not require a replacement page or homepage redesign.

## 1. Audit and implementation summary

| Area | Existing implementation and action |
| --- | --- |
| Marketing routes | `/`, `/contact`, `/cookies`, `/methodology`, `/privacy`, `/terms`, `/refund-policy`, `/referral-partners`, `/about`, `/resources/understanding-your-report`, `/resources/valuation-review-checklist`. These continue to use the public shell and footer. |
| Homepage | Existing product overview, eligibility entry, service explanation, and public resources. Left intact. |
| Advertising destination | Existing homepage and customer intake. The dedicated `/total-loss-review` route, its former redirect, and page-only assets have been removed. |
| Customer routes | `/start?service=total-loss`, `/app`, `/appraisals`, `/find-review`, `/total-loss/cases/:caseId`, its analysis/report/claim/checkout/return/review subroutes, `/analyses/:runId`, and authentication callbacks. Existing routing remains authoritative. |
| Other identities | Staff `/admin/*` and the separate partner host/router remain separate. The adapter does not load on staff, partner, or authentication routes. |
| Intake/authentication | Existing anonymous Supabase session owns the guest case; secure claim and verified customer identity preserve ownership. Attribution uses the same owner boundary and never becomes an intake requirement. |
| Public-to-app transition | Existing `applicationHref` sends the customer to `https://app.venfour.com/start?service=total-loss`. Consent and acquisition cookies now share the parent domain on HTTPS. No duplicate funnel or authentication system. |
| Payment | Existing server quote and checkout creation, Stripe confirmation/webhook reconciliation, immutable `payment_transactions`, order, entitlement, and delivery gates remain unchanged. A return URL or button click does not establish payment. |
| Existing tracking | No installed GA4/GTM/Google Ads implementation or paid-search attribution store was found. The existing analytics-only consent component was extended; no second analytics library was installed. Existing partner-referral attribution is untouched. |
| Disclosures | Existing Venfour LLC footer, support/contact, Terms, Privacy, Cookies, and Fair-Result Refund Policy were reused. Terms now explicitly name Venfour LLC and the $199 full review. Privacy/Cookies describe future advertising measurement conditionally. |
| Metadata/security | Existing site title/description behavior retained. Page-only canonical/Open Graph handling and dedicated HTML generation removed. The shared public sitemap, robots reference, and optional precise Google CSP controls remain. |
| Availability | The previous audit recorded nationwide activation; see section 10 for that evidence and its limits. This removal changes no jurisdiction, price, refund, evidence, or payment rule. |

## 2. Removal file inventory

The previous diff was inspected before editing to distinguish page-only work from shared infrastructure. All paths below are relative to the repository root.

| Action | Files |
| --- | --- |
| Removed | `frontend/src/pages/total-loss-review-page.tsx`, `frontend/src/pages/total-loss-review-page.css`, `frontend/src/pages/total-loss-review-page.test.tsx`, `frontend/src/config/search-landing.ts`, `frontend/scripts/search-landing-html.ts` |
| Route, metadata, build cleanup | `frontend/src/app/router.tsx`, `frontend/src/app/site-boundary.ts`, `frontend/src/app/document-metadata.ts`, `frontend/vite.config.ts` |
| Worker route and shared boundary tests | `frontend/worker/index.ts`, `frontend/worker/index.test.ts` |
| Remove obsolete redirect test | `frontend/src/app/app.test.tsx` |
| Existing-site measurement adaptation | `frontend/src/features/measurement/attribution.ts`, `frontend/src/features/measurement/google.ts`, `frontend/src/features/measurement/lifecycle.tsx`, `frontend/src/features/measurement/measurement.test.ts` |
| Existing-site acquisition fixture | `supabase/tests/database/059_search_measurement.test.sql` |
| Readiness assessment | `docs/marketing/google-ads-readiness.md` |

The dedicated headline, body copy, CTA components, CSS, route imports, static HTML emitter, metadata configuration, public routing/sitemap entry, asset rewrite, and page-only tests are removed. The unused canonical/Open Graph extension had no other consumers and was removed; existing title/description metadata remains. No replacement page or redirect was added.

The shared measurement modules, flow hooks, consent components, Google configuration, enhanced-conversion support, privacy/cookie/Terms improvements, sitemap machinery, CSP protections, and database measurement migration remain. `purchase_completed` and `refund_issued` still derive from the immutable financial ledger. The homepage implementation and its design are unchanged.

## 3. Existing destination and customer journey

Use **https://venfour.com/** with its existing product explanation, public disclosures, navigation, and entry into **https://app.venfour.com/start?service=total-loss**. Search Ads should follow this established journey unless a different destination is explicitly chosen later.

The removed route is not advertised, served as a special page, or redirected into a new funnel. Its absence is intentional and is not a readiness blocker. No new advertising page, homepage layout, headline, or CTA was introduced.

The shared `landing_view` event and consented Google tag initialization operate on the existing homepage. The adapter's sanitized public `page_location` now uses `https://venfour.com/`; it preserves validated click identifiers and never exposes a private customer URL. Existing public indexing, app/partner restrictions, and public sitemap behavior remain.

## 4. Exact funnel and payment authority

1. An ad click reaches the existing Venfour homepage with allowed campaign/click parameters. Parameters remain in memory until advertising consent permits persistence.
2. The visitor chooses optional measurement preferences and uses the existing site entry into Total Loss intake. The existing HTTPS app destination receives the shared consent/acquisition cookies.
3. Existing guest intake reserves/loads an owned case. The optional owner-authenticated RPC associates validated acquisition data with that case. Report upload and the existing contact/acknowledgment/verified-claim flow continue normally.
4. Existing report/evidence checks determine whether a checkout quote is available. The server quote remains the price authority; current advertised price is $199.
5. Existing checkout creation returns the actual Stripe checkout. Successful Stripe webhook/reconciliation writes the existing immutable financial record. Checkout starts, navigation, query flags, and incomplete payments cannot create a purchase measurement record.
6. A read-only financial view exposes one purchase per recorded payment, with its actual amount in USD and stable order UUID. Existing receipt/workspace loading reads a minimal owner-authorized measurement receipt.
7. With actual configuration, advertising permission, and a live payment, the browser adapter sends the Google Ads conversion. Existing entitlement, processing, report delivery, and insurer-response work proceed independently.

The financial record exists even if the browser never returns. Google browser delivery still requires a returning browser, permission, network access, and an unblocked tag; this implementation does not claim server-to-server conversion delivery or guaranteed capture. Later authorized receipt reads retry delivery using the same transaction ID. Browser storage suppresses repeat sends after the tag callback; Google deduplicates the stable transaction ID for the same conversion action. A tag callback is not proof that Google accepted or attributed a conversion.

## 5. Business event model

One typed abstraction dispatches `venfour:business-event` with an allowlisted payload. Common fields: event name, timestamp, event UUID, optional session UUID, optional internal case/order UUID, optional acquisition data, and USD/value for financial events. Product responses are never spread into measurement payloads.

| Event | Trigger/source | Persistence and Google behavior |
| --- | --- | --- |
| `landing_view` | Existing public homepage entry, after optional permission | Browser abstraction only; deduplicated for that navigation. No unauthenticated public analytics collector or Google page-view event is installed. |
| `review_started` | Existing owned intake case is available | Owner-only first-party event; unique per case/event. |
| `valuation_report_uploaded` | Existing report upload succeeds | Owner-only first-party event; unique per case/event. No filename or document data. |
| `review_eligible` | Server checkout quote is available | Owner-only first-party event; unique per case/event. Describes quote availability, not legal approval. |
| `checkout_started` | Existing server checkout creation succeeds | Owner-only first-party event; unique per case/event. Not a purchase. |
| `purchase_completed` | Immutable Stripe payment transaction joined to its commerce order | Read-only financial event; actual minor-unit amount divided by 100, USD, payment UUID, order UUID. Only this event is mapped to a Google conversion. Sandbox payments are excluded from Google. |
| `refund_issued` | Refund ledger entry linked to a succeeded refund request with no reversal | First-party authoritative financial event. Pending/failed/reversed refunds do not qualify. No invented negative purchase or automatic Google adjustment. |

Optional progress events require analytics or advertising consent. They are observability records, not authoritative evidence of eligibility or entitlement; the database refuses client-submitted purchase/refund event names. A first-party financial view reads the pre-existing business ledger regardless of optional analytics permission. The browser only processes it for measurement with permission.

## 6. Attribution

Captured fields: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`. Only these keys, a bounded public-entry value, and a timestamp enter the acquisition contract.

- UTM values: maximum 120 characters; conservative ASCII letters/digits, spaces, underscore, period, comma, plus, tilde, hyphen.
- Click IDs: maximum 256 characters; letters/digits/underscore/hyphen.
- Duplicate parameters, malformed values, arbitrary query fields, URLs, and out-of-contract fields are rejected or omitted. The database independently validates types, keys, size, lengths, characters, landing page, and timestamp.
- New browser attribution uses `/` for the public website and `/start` for direct intake. The unchanged database migration retains its historical page-value allowlist; an older cookie using the retired page value is read and normalized to `/` without dropping its click identifiers. This is data compatibility only, not a route or offer.
- The first paid touch is preserved for 30 days. A paid touch can replace an earlier non-paid touch; later paid touches cannot replace the first paid touch. Existing attribution cannot be replaced after payment. Withdrawal can still clear it.
- `venfour.acquisition` uses `Domain=venfour.com; Path=/; SameSite=Lax; Secure` on the public/app HTTPS hosts. Guest case association follows existing ownership; claiming the case does not change its acquisition reference.
- The case-to-order financial view connects purchase to acquisition. Validated click IDs can be restored from the owner receipt when returning later. Google also uses its own consented conversion-linker cookies once configured.
- Without advertising permission, persistent advertising attribution is intentionally unavailable. A page closed before consent loses the memory-only candidate. Storage/RPC failure cannot block intake, checkout, or delivery.

Campaign labels must contain campaign taxonomy, never customer information. UTM fields remain first-party; the Google conversion adapter sends only validated click IDs in a fixed public page-location URL, not raw source query strings or customer route URLs. Partner referrals use their existing independent logic.

## 7. Google configuration and enhanced conversions

No GA4 or GTM container is required for this direct Ads adapter. All live identifier defaults are blank.

| Configuration | Where/how to set after account creation |
| --- | --- |
| `VITE_GOOGLE_ADS_CONVERSION_ID` | Actual Ads destination ID, in the customer production and public-site build environments. Documented in both frontend environment examples. |
| `VITE_GOOGLE_ADS_PURCHASE_LABEL` | Actual purchase conversion label in those same build environments. |
| `VITE_GOOGLE_ENHANCED_CONVERSIONS` | Defaults `false`; set `true` only when the corresponding Google feature and intended consented email measurement are enabled. |
| `GOOGLE_ADS_MEASUREMENT` | Worker variable in both `production` and `public-site` environments in `frontend/wrangler.jsonc`; defaults `false`. Set `true` with tag activation to allow the narrowly listed Google CSP destinations. |

Vite variables are build-time configuration: changing them requires a normal build/release, not product-code changes. Missing/invalid ID or label makes the adapter inert. Local, staging, partner, staff, and authentication surfaces cannot activate it. The script loads asynchronously only after advertising permission. Blocked/loading-failed scripts resolve without interrupting product work.

The purchase payload contains destination, order UUID, actual purchase value, USD, and a sanitized fixed public page location/title/referrer. It does not use the insurer valuation or proposed settlement as revenue. Automatic page views, personalized advertising, and Google signals are disabled.

Enhanced conversions use **`commerce_orders.purchaser_email`**, available on the authoritative paid order. The owner-only receipt returns it only on explicit request, with saved advertising permission and matching purchaser identity. It stays separate from generic business events. The adapter passes only this email to Google's documented `user_data` input when explicitly enabled, then clears the tag's user-data setting. Google's tag performs normalization and SHA-256 hashing; no custom hashing or automatic DOM/form scraping was added. Disable it by setting the enhanced-conversions variable to `false` and rebuilding, or by withdrawing advertising permission.

Data deliberately excluded from Google: case UUID, insurer identity, VIN, claim number/narrative, vehicle details, valuation or settlement amount, PDFs/documents/filenames/contents, extracted report data, generated analysis, comparable vehicles, adjustments, authentication tokens, arbitrary URLs/query strings, names, postal addresses, and phone numbers. Email is the sole optional enhanced-conversion identity field. The stable order UUID is the opaque deduplication reference.

References: [Google consent implementation](https://developers.google.com/tag-platform/security/guides/consent), [tag CSP guidance](https://developers.google.com/tag-platform/security/guides/csp), [enhanced conversions using the Google tag](https://support.google.com/google-ads/answer/13258081?hl=en), [transaction-ID deduplication](https://support.google.com/google-ads/answer/6386790?hl=en).

## 8. Privacy and consent

The existing small public banner/preferences dialog now offers distinct analytics and advertising choices. Optional purposes default off; an old analytics-only choice never becomes advertising permission. Global Privacy Control denies both. The app retains a cookie-preferences entry without adding an intake-blocking banner. Banner dismissal moves focus to main content before the exit animation; the existing preference controls retain visible keyboard focus.

Consent version 2 uses a 180-day essential shared cookie plus existing local storage. Focus/storage refresh keeps choices current across visits/tabs. Consent Mode defaults deny analytics storage, ad storage, ad user data, and personalization before configuration. Only consented purposes are granted; personalization remains denied. This uses basic consent behavior: no Google tag is loaded before advertising permission, so no deliberate denied-consent pings are introduced.

Withdrawal clears browser acquisition data, updates a loaded tag to denied, and clears the current owned case's optional attribution when its RPC is available. It does not delete required payment/audit records or retroactively erase data already delivered to Google. Other case/device records and broader deletion requests use the disclosed support path. First-party case attribution is retained with the case until withdrawal/deletion under existing retention practices; its browser cookie lasts 30 days.

Privacy/Cookies wording is conditional and does not claim Google advertising is already active. Existing service/checkout acknowledgment records and refund rules are not rewritten. The separate release report records a pre-existing mismatch between older service acknowledgment constants and later policy publication dates; version-2 advertising consent is independent and does not infer permission from those acknowledgments.

## 9. Trust and policy review

The original audit reviewed the homepage, About, Methodology, report/checklist resources, contact/support, referral-partner marketing, Terms, Privacy, Cookies, and Refund Policy. Those existing pages and the general policy improvements are retained. No new outcome guarantee, fabricated statistic, countdown, insurer/government endorsement, or legal-representation claim was introduced. Legitimate explanations of valuation reports, comparables, adjustments, and supporting evidence remain specific.

The existing site explains the evidence-based review and its limits. Venfour LLC identity, support and policy links remain. Terms disclose $199 and existing checkout presents the server-authoritative price before payment. Removing the page does not alter these shared disclosures or add any outcome promise.

Refund wording follows the existing two protections: automatic full refund if the completed review does not support a dispute, with retained report access; a requested full refund for a supported dispute with final verified vehicle-value increase below $1,000, following the supported process and documentation requirements, requested within 30 days of the final written response. Exactly $1,000 does not qualify. No refund or pricing implementation was changed.

No verified publishable business address was found in current public/company configuration, so none was invented. Use the owner's verified company details for any required advertiser verification/disclosure. This review does not guarantee Google policy approval or decide legal classification.

## 10. Last recorded production jurisdictions

During the original readiness task, a separate authorized release completed. Its [release record](../engineering/production-release-2026-09-24.md) excluded the then-unreleased Search Ads changes. That task's read-only Cloud Run inspection confirmed the final serving revision **`venfour-api-production-release-0924-3b10a43`**, receiving 100% traffic, with **`VENFOUR_NATIONWIDE_PRODUCT=true`** and **`VENFOUR_JURISDICTION_MODE=off`**. Earlier observations of the September 23 revision/disabled nationwide flag are superseded.

The release record reports frontend nationwide support enabled, all 51 authenticated production state API checks successful, and ten state UI checks successful. Those checks belong to that release, not this task's browser run. The original task also read `manual_approval_required=false` without modifying it; the final release record confirms that value remains unchanged.

| Customer action | Current supported scope and boundary |
| --- | --- |
| Start | Generic product path for all 50 U.S. states and D.C.; normal guest intake and case facts still apply. Foreign countries/territories are outside the 51-record product inventory. |
| Purchase | No live jurisdiction enforcement or state-specific override prerequisite. Cases in the same 51-record scope can reach checkout when existing report/evidence/ownership/payment gates pass. A state selection alone does not make a case eligible. |
| Complete paid product | Shared generic report, customer-prepared reconsideration materials, and response guidance are technically enabled across that scope, subject to existing evidence, qualification, payment, processing, and delivery gates. This is not 51 independently completed paid customer journeys. |
| Restricted activities | Direct insurer negotiation/representation, formal appraisal-clause/umpire service, assignment services, and appraisal labels remain disabled. State-specific settlement components remain unresolved/excluded as documented. |

There is no newly established state-specific technical blocker, and missing state overrides are not treated as automatic prohibitions. This task makes no legal approval or operating-permission determination. The existing nationwide release was owner-authorized; no additional nationwide activation is requested here. This removal makes no new geographic claims. Production was not re-inspected during this local-only update; recheck the recorded configuration before a future release. A supervised real paid customer journey remains unproven by the nonbillable checks; it must not be represented as already tested.

## 11. Verification after removal

The retained tracking, attribution, consent, purchase/refund, privacy, jurisdiction, host-boundary, and existing-site tests are rerun for this update. Tests that exercised only the dedicated page or its obsolete redirect were deleted. Shared Worker CSP and sitemap checks now use the existing homepage/public pages; shared attribution fixtures use the homepage. No financial, consent, or jurisdiction assertion was removed.

These are fresh results from the removal update. Earlier screenshots and timing observations of the deleted page are not used as current destination evidence.

| Check | Result |
| --- | --- |
| Frontend/edge/environment tests | **601 tests passed, 16 files**, including existing homepage/intake, business events, attribution, consent/privacy, claim API/checkout, nationwide UI, Worker, and environment boundaries. |
| Offline backend commerce and jurisdiction | **172 tests passed**, zero failures/errors/skips and zero unexpected network attempts; three deliberate guard probes blocked. |
| Isolated database measurement/commerce/jurisdiction | All **89 migrations** applied to a new disposable network-isolated database; **261 assertions passed in 5 files**: measurement 31, commerce 152, jurisdiction foundation 35, jurisdiction authority 23, nationwide product 20. |
| Production and public build | **Passed** production environment validation, generated contracts, TypeScript, and Vite; isolated public-only environment validation/build also passed. Both outputs contain no dedicated page HTML, headline, or styles. |
| Changed-source lint and diff | **11 modified source/test files passed lint**; `git diff --check` passed. Protected-file comparison confirms the homepage, consent, payment/event service, policies, configuration, database migrations, and backend were not reverted. |

```sh
npm --prefix frontend test -- src/features/measurement src/features/privacy/cookie-consent.test.tsx src/app/app.test.tsx src/app/site-boundary.test.ts src/app/public-site.test.tsx src/pages/home-page.test.tsx src/pages/total-loss-start-page.test.tsx src/pages/total-loss-claim-workflow-page.test.tsx src/features/total-loss-claim/queries.test.ts src/features/total-loss-claim/api.test.ts src/features/nationwide/product-panel.test.tsx worker/index.test.ts scripts/production-environment.test.mjs scripts/public-site-environment.test.mjs scripts/staging-environment.test.mjs
.venv/bin/python scripts/run_offline_tests.py test_commerce test_nationwide_product test_jurisdiction test_jurisdiction_integration
python3 scripts/run_isolated_database_tests.py --container venfour-migration-rehearsal-search-removal --output /tmp/venfour-search-page-removal/database-tests supabase/tests/database/059_search_measurement.test.sql supabase/tests/database/015_total_loss_stripe_commerce.test.sql supabase/tests/database/056_jurisdiction_foundation.test.sql supabase/tests/database/057_jurisdiction_authority.test.sql supabase/tests/database/058_nationwide_product.test.sql
npm --prefix frontend run build:production
git diff --check
```

The existing large-bundle build advisory and jsdom canvas/scroll limitations remain non-failing diagnostics. Test logs and isolated build/rehearsal evidence are under `/tmp/venfour-search-page-removal/`; the disposable database was removed after validation.

Shared tests exercise first paid attribution, all eight tracking parameters, malformed-input handling, legacy consent and Global Privacy Control, owner/guest isolation, forged-purchase rejection, actual purchase amount/USD, stable IDs, refresh/concurrent deduplication, absent configuration, blocked script handling, enhanced-email gating, and private-data exclusion. The database payment fixture deliberately uses an amount different from the advertised price to verify ledger-derived measurement.

## 12. Deployment and campaign activation

**No deployment by this update.** No hosted data, infrastructure, payment settings, or advertising account was changed. The prior readiness audit recorded the shared measurement migration/adapter/consent work as unreleased. This local removal does not establish a new hosted deployment status.

Before campaign spend, inspect the actual deployment inventory, release the retained shared infrastructure and additive measurement migration where still pending, configure actual account values, and verify consent, cross-host attribution, ownership, and the authoritative receipt boundary on the real hosts. Retain all existing financial/audit history. A missing optional RPC must not interrupt intake or delivery, but complete measurement rollout is still needed before relying on conversion reporting.

There is no dedicated-page deployment requirement or replacement-page task. The existing website is the intended destination. Production rollout, actual conversion diagnostics, and supervised first paid delivery remain operational checks separate from readiness to create the account.

## 13. Items requiring the real Google Ads account

1. Create the account and complete actual business/advertiser verification if requested, billing, campaign settings, and chosen geographic targeting.
2. Create the purchase conversion action, obtain its actual Ads ID and conversion label, and place them in the configuration locations in section 7. Use actual value, USD, and the supplied stable transaction ID; avoid creating a second competing purchase tag.
3. Decide whether to enable enhanced conversions; if enabled, select the code-provided email method and corresponding feature/configuration. Do not enable automatic collection from claim forms.
4. Release the configured builds and exact CSP toggle, then verify tag/consent behavior on both actual hosts with Google's diagnostics: denied/accepted/withdrawn consent, cross-host attribution, one confirmed purchase, correct value/order ID, refresh deduplication, and conditional enhanced email. Use an explicitly authorized transaction; never infer conversion success from a tag callback alone.
5. Verify destination review/approval and conversion diagnostics before enabling campaign spend. Google acceptance, attribution and enhanced-conversion matching cannot be proven without the real account.

Refunds are available as authoritative first-party events. If campaign reporting should retract/refund conversions, use the actual account's conversion-adjustment process with the stable order reference; this implementation does not send an invented refund conversion.
