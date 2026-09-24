# Google Search Ads readiness

Reviewed September 24, 2026. Source baseline: `3b10a43`. The implementation below is repository work based on that baseline and has not been deployed. No advertising account was created or configured; no real advertising identifiers were supplied, and no advertising tag is active.

**BLOCKED for production paid-search launch.** The code and configuration boundary are implemented and locally verified, but this landing page and its database migration have not been released. The live destination still returns 404. Creating an account is administratively possible; the requested production-readiness gate is not yet satisfied. Account setup does not require a further landing-page or checkout redesign.

## 1. Audit and implementation summary

| Area | Existing implementation and action |
| --- | --- |
| Marketing routes | `/`, `/contact`, `/cookies`, `/methodology`, `/privacy`, `/terms`, `/refund-policy`, `/referral-partners`, `/about`, `/resources/understanding-your-report`, `/resources/valuation-review-checklist`. These continue to use the public shell and footer. |
| Homepage | Existing product overview, eligibility entry, service explanation, and public resources. Left intact. |
| Total-loss marketing | `/total-loss-review` previously redirected to intake in the combined router and was excluded by the public Worker. Replaced with a dedicated landing page; added to the public host allowlist. |
| Customer routes | `/start?service=total-loss`, `/app`, `/appraisals`, `/find-review`, `/total-loss/cases/:caseId`, its analysis/report/claim/checkout/return/review subroutes, `/analyses/:runId`, and authentication callbacks. Existing routing remains authoritative. |
| Other identities | Staff `/admin/*` and the separate partner host/router remain separate. The adapter does not load on staff, partner, or authentication routes. |
| Intake/authentication | Existing anonymous Supabase session owns the guest case; secure claim and verified customer identity preserve ownership. Attribution uses the same owner boundary and never becomes an intake requirement. |
| Public-to-app transition | Existing `applicationHref` sends the customer to `https://app.venfour.com/start?service=total-loss`. Consent and acquisition cookies now share the parent domain on HTTPS. No duplicate funnel or authentication system. |
| Payment | Existing server quote and checkout creation, Stripe confirmation/webhook reconciliation, immutable `payment_transactions`, order, entitlement, and delivery gates remain unchanged. A return URL or button click does not establish payment. |
| Existing tracking | No installed GA4/GTM/Google Ads implementation or paid-search attribution store was found. The existing analytics-only consent component was extended; no second analytics library was installed. Existing partner-referral attribution is untouched. |
| Disclosures | Existing Venfour LLC footer, support/contact, Terms, Privacy, Cookies, and Fair-Result Refund Policy were reused. Terms now explicitly name Venfour LLC and the $199 full review. Privacy/Cookies describe future advertising measurement conditionally. |
| Metadata/security | Existing title/description hook extended with canonical/Open Graph metadata. Build emits a dedicated HTML shell for direct landing requests. Public sitemap and robots sitemap reference added. Optional precise Google CSP destinations are disabled by default. |
| Availability | Current production flags were rechecked after a separate nationwide release completed during this task; see section 10. No jurisdiction, price, refund, evidence, or payment rule changed here. |

## 2. Files changed

All paths are relative to the repository root. Generated diagnostic builds, screenshots, and test logs under `output/search-readiness/` and `output/playwright/search-readiness/` are local evidence, not release source. Unrelated concurrent release files are excluded from this list.

| Group | Files |
| --- | --- |
| Landing | `frontend/src/pages/total-loss-review-page.tsx`, `frontend/src/pages/total-loss-review-page.css`, `frontend/src/pages/total-loss-review-page.test.tsx`, `frontend/src/config/search-landing.ts` |
| Route/metadata/build | `frontend/src/app/router.tsx`, `frontend/src/app/site-boundary.ts`, `frontend/src/app/document-metadata.ts`, `frontend/scripts/search-landing-html.ts`, `frontend/vite.config.ts` |
| Measurement | `frontend/src/features/measurement/attribution.ts`, `config.ts`, `events.ts`, `google.ts`, `service.ts`, `lifecycle.tsx`, `use-case-measurement.ts`, `measurement.test.ts`, `google.test.ts` in that same directory |
| Existing flow integration | `frontend/src/components/app-shell.tsx`, `frontend/src/pages/total-loss-start-page.tsx`, `frontend/src/features/total-loss-claim/api.ts` |
| Consent | `frontend/src/features/privacy/consent.ts`, `cookie-consent-context.ts`, `cookie-consent-provider.tsx`, `cookie-consent.tsx`, `cookie-consent.test.tsx` in that same directory |
| Public policies | `frontend/src/pages/privacy-page.tsx`, `frontend/src/pages/cookie-policy-page.tsx`, `frontend/src/pages/terms-page.tsx` |
| Configuration/edge | `frontend/.env.example`, `frontend/.env.production.example`, `frontend/src/vite-env.d.ts`, `frontend/scripts/public-site-environment.mjs`, `frontend/wrangler.jsonc`, `frontend/worker/index.ts`, `frontend/worker/index.test.ts`, `frontend/worker/environment.d.ts` |
| Database | `supabase/migrations/20260924000000_search_measurement.sql`, `supabase/tests/database/059_search_measurement.test.sql` |
| Report | `docs/marketing/google-ads-readiness.md` |

## 3. Landing destination

Intended production URL: **https://venfour.com/total-loss-review**. It is implemented locally and not yet deployed.

The page uses the existing restrained public design. It includes the requested headline, $199 price, complete insurer valuation report requirement, reviewed inputs, report/draft/follow-up deliverables, three-step process, accurate refund conditions, limitations, Venfour LLC identity, support, and policy links. Both “Review My Valuation” links enter the existing workflow. The existing public-intake switch still replaces the CTA with contact when intake is closed.

The dedicated HTML includes title, description, canonical URL, and Open Graph title/description/URL/type before client JavaScript runs. Public access is unauthenticated and indexable; the public sitemap includes the route. Customer, staff, authentication, and partner indexing restrictions remain intact. No geographic availability claim is added to the landing page.

## 4. Exact funnel and payment authority

1. An ad click reaches the public landing page with allowed campaign/click parameters. Parameters remain in memory until advertising consent permits persistence.
2. The visitor chooses optional measurement preferences and selects “Review My Valuation.” The existing HTTPS app destination receives the shared consent/acquisition cookies.
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
| `landing_view` | Public homepage or paid landing entry, after optional permission | Browser abstraction only; deduplicated for that navigation. No unauthenticated public analytics collector or Google page-view event is installed. |
| `review_started` | Existing owned intake case is available | Owner-only first-party event; unique per case/event. |
| `valuation_report_uploaded` | Existing report upload succeeds | Owner-only first-party event; unique per case/event. No filename or document data. |
| `review_eligible` | Server checkout quote is available | Owner-only first-party event; unique per case/event. Describes quote availability, not legal approval. |
| `checkout_started` | Existing server checkout creation succeeds | Owner-only first-party event; unique per case/event. Not a purchase. |
| `purchase_completed` | Immutable Stripe payment transaction joined to its commerce order | Read-only financial event; actual minor-unit amount divided by 100, USD, payment UUID, order UUID. Only this event is mapped to a Google conversion. Sandbox payments are excluded from Google. |
| `refund_issued` | Refund ledger entry linked to a succeeded refund request with no reversal | First-party authoritative financial event. Pending/failed/reversed refunds do not qualify. No invented negative purchase or automatic Google adjustment. |

Optional progress events require analytics or advertising consent. They are observability records, not authoritative evidence of eligibility or entitlement; the database refuses client-submitted purchase/refund event names. A first-party financial view reads the pre-existing business ledger regardless of optional analytics permission. The browser only processes it for measurement with permission.

## 6. Attribution

Captured fields: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`. Only these keys, a three-value landing-page enum, and a timestamp enter the acquisition contract.

- UTM values: maximum 120 characters; conservative ASCII letters/digits, spaces, underscore, period, comma, plus, tilde, hyphen.
- Click IDs: maximum 256 characters; letters/digits/underscore/hyphen.
- Duplicate parameters, malformed values, arbitrary query fields, URLs, and out-of-contract fields are rejected or omitted. The database independently validates types, keys, size, lengths, characters, landing page, and timestamp.
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

The existing small public banner/preferences dialog now offers distinct analytics and advertising choices. Optional purposes default off; an old analytics-only choice never becomes advertising permission. Global Privacy Control denies both. The app retains a cookie-preferences entry without adding an intake-blocking banner. Banner dismissal moves focus to main content before the exit animation; landing and preference controls have visible keyboard focus.

Consent version 2 uses a 180-day essential shared cookie plus existing local storage. Focus/storage refresh keeps choices current across visits/tabs. Consent Mode defaults deny analytics storage, ad storage, ad user data, and personalization before configuration. Only consented purposes are granted; personalization remains denied. This uses basic consent behavior: no Google tag is loaded before advertising permission, so no deliberate denied-consent pings are introduced.

Withdrawal clears browser acquisition data, updates a loaded tag to denied, and clears the current owned case's optional attribution when its RPC is available. It does not delete required payment/audit records or retroactively erase data already delivered to Google. Other case/device records and broader deletion requests use the disclosed support path. First-party case attribution is retained with the case until withdrawal/deletion under existing retention practices; its browser cookie lasts 30 days.

Privacy/Cookies wording is conditional and does not claim Google advertising is already active. Existing service/checkout acknowledgment records and refund rules are not rewritten. The separate release report records a pre-existing mismatch between older service acknowledgment constants and later policy publication dates; version-2 advertising consent is independent and does not infer permission from those acknowledgments.

## 9. Trust and policy review

Reviewed the homepage, new landing, About, Methodology, report/checklist resources, contact/support, referral-partner marketing, Terms, Privacy, Cookies, and Refund Policy. No new outcome guarantee, fabricated statistic, countdown, insurer/government endorsement, or legal-representation claim was introduced. Legitimate explanations of valuation reports, comparables, adjustments, and supporting evidence remain specific.

The landing accurately distinguishes advertised market prices from completed sales. It disclaims a guaranteed increase/insurer acceptance and explains that customers send their own communications. It identifies Venfour LLC and links support and policies. $199 is visible before intake and checkout.

Refund wording follows the existing two protections: automatic full refund if the completed review does not support a dispute, with retained report access; a requested full refund for a supported dispute with final verified vehicle-value increase below $1,000, following the supported process and documentation requirements, requested within 30 days of the final written response. Exactly $1,000 does not qualify. No refund or pricing implementation was changed.

No verified publishable business address was found in current public/company configuration, so none was invented. Use the owner's verified company details for any required advertiser verification/disclosure. This review does not guarantee Google policy approval or decide legal classification.

## 10. Current production jurisdictions

A separate authorized release completed during this task. Its [release record](../engineering/production-release-2026-09-24.md) explicitly excludes these Search Ads changes. Fresh read-only Cloud Run inspection confirmed the final serving revision **`venfour-api-production-release-0924-3b10a43`**, receiving 100% traffic, with **`VENFOUR_NATIONWIDE_PRODUCT=true`** and **`VENFOUR_JURISDICTION_MODE=off`**. Earlier observations of the September 23 revision/disabled nationwide flag are superseded.

The release record reports frontend nationwide support enabled, all 51 authenticated production state API checks successful, and ten state UI checks successful. Those checks belong to that release, not this task's browser run. This task also read `manual_approval_required=false` without modifying it; the final release record confirms that value remains unchanged.

| Customer action | Current supported scope and boundary |
| --- | --- |
| Start | Generic product path for all 50 U.S. states and D.C.; normal guest intake and case facts still apply. Foreign countries/territories are outside the 51-record product inventory. |
| Purchase | No live jurisdiction enforcement or state-specific override prerequisite. Cases in the same 51-record scope can reach checkout when existing report/evidence/ownership/payment gates pass. A state selection alone does not make a case eligible. |
| Complete paid product | Shared generic report, customer-prepared reconsideration materials, and response guidance are technically enabled across that scope, subject to existing evidence, qualification, payment, processing, and delivery gates. This is not 51 independently completed paid customer journeys. |
| Restricted activities | Direct insurer negotiation/representation, formal appraisal-clause/umpire service, assignment services, and appraisal labels remain disabled. State-specific settlement components remain unresolved/excluded as documented. |

There is no newly established state-specific technical blocker, and missing state overrides are not treated as automatic prohibitions. This task makes no legal approval or operating-permission determination. The existing nationwide release was owner-authorized; no additional nationwide activation is requested here. The new landing avoids broader geographic claims. A supervised real paid customer journey remains unproven by the nonbillable checks; it must not be represented as already tested.

## 11. Verification

| Check | Result |
| --- | --- |
| Frontend/edge/environment selection | **555 tests passed, 16 files**; measurement, landing, consent, host boundary, public site/home, intake, checkout/workflow, claim API/queries, nationwide UI, Worker, and production/public/staging environment tests. |
| Final focused follow-up | **42 tests passed, 4 files** after focus correction and financial-event refresh coverage: measurement, Google adapter, landing, consent. |
| Offline Python | **172 passed**, zero failures/errors/skips and zero unexpected network attempts; commerce, nationwide product, jurisdiction, jurisdiction integration. Three deliberate network-guard probes were blocked as expected. |
| Database rehearsal | All **89 migrations** applied in a disposable, network-isolated container with no application data. No hosted migration or valuable local reset. |
| Database regression | **261 assertions passed, 5 files**: new measurement 31; Stripe commerce 152; jurisdiction foundation 35; jurisdiction authority 23; nationwide product 20. |
| Build/types/contracts | Production build passed environment validation, generated-contract check, TypeScript, and Vite. Public-only configuration validated and built with customer configuration absent. Dedicated landing HTML emitted in both. |
| Lint/diff | Changed TypeScript/JavaScript source lint and `git diff --check` passed. |
| Desktop/mobile | Real Chromium, 1440px desktop and 390px mobile: landing renders, one H1, no horizontal overflow/broken images, $199/report requirement/CTA visible. |
| Navigation/accessibility | Real CTA enters existing `/start?service=total-loss`; back and refund-policy navigation work. Preferences keyboard entry/escape tested. Cookie dismissal focus corrected; landing CTA has visible 2px focus outline. |
| Local Worker destination | `/total-loss-review` returns 200 with static canonical/Open Graph, no authentication/noindex restriction, zero Google scripts and no JS/CSP errors with missing configuration. Sitemap/robots covered by Worker tests. |
| Cross-domain | Intercepted local HTML under public/app HTTPS hostnames proved shared consent/acquisition cookies reach app entry. No production form submission, payment, or provider call was made by this task. |
| Performance | Local sampled layout shift 0; first-contentful paint about 196ms. These are local observations, not mobile-network or field Core Web Vitals. Main public JS growth is about 5.2KB gzip against the sampled production asset, under 1%; the existing large-bundle warning remains. |
| Production read-only | Existing public destinations/robots respond; the new landing and sitemap still return 404. Cloud Run final flags/revision rechecked. Earlier `/health` and `/ready` returned 200; these are component evidence. |

Commands used:

```sh
npm --prefix frontend test -- src/features/measurement src/pages/total-loss-review-page.test.tsx src/features/privacy/cookie-consent.test.tsx src/app/site-boundary.test.ts src/app/public-site.test.tsx src/pages/home-page.test.tsx src/pages/total-loss-start-page.test.tsx src/pages/total-loss-claim-workflow-page.test.tsx src/features/total-loss-claim/queries.test.ts src/features/total-loss-claim/api.test.ts src/features/nationwide/product-panel.test.tsx worker/index.test.ts scripts/production-environment.test.mjs scripts/public-site-environment.test.mjs scripts/staging-environment.test.mjs
.venv/bin/python scripts/run_offline_tests.py test_commerce test_nationwide_product test_jurisdiction test_jurisdiction_integration
python3 scripts/run_isolated_database_tests.py --container venfour-migration-rehearsal-search --output output/search-readiness/database-tests-final supabase/tests/database/059_search_measurement.test.sql supabase/tests/database/015_total_loss_stripe_commerce.test.sql supabase/tests/database/056_jurisdiction_foundation.test.sql supabase/tests/database/057_jurisdiction_authority.test.sql supabase/tests/database/058_nationwide_product.test.sql
npm --prefix frontend run build:production
git diff --check
```

Tests cover attribution capture/persistence/malformed values/first paid touch, legacy consent and Global Privacy Control, owner and guest isolation, rejected forged purchases, actual purchase amount/currency, refresh/concurrent deduplication, missing configuration, blocked script handling, email gating, and payload exclusion. The SQL payment fixture intentionally differs from $199 to prove measurement reads the actual ledger amount. Test-only tag inputs run under mocked script loading and are never deployment credentials.

Known test-environment advisories: jsdom lacks canvas/scroll methods used by existing UI; assertions passed. An initial backend selector referenced a nonexistent module, then the corrected module selection passed. The initial SQL timestamp-length check rejected the test's valid database timestamp representation; the validation cap was corrected and all database suites rerun successfully. No unresolved test failure is hidden by these results.

## 12. Production deployment status and release conditions

**Not deployed by this task.** The separate nationwide release shipped its frozen validated source and excluded these edits. Production does not yet have the search landing, measurement migration, consent changes, or optional adapter. No hosted data/infrastructure, payment settings, or advertising account was changed here.

Before paid traffic: authorize/review the final source release, apply the additive `20260924000000_search_measurement.sql` migration after a fresh deployment inventory, release compatible public/customer Workers, and verify the destination, consent, ownership and receipt boundary on the actual hosts. Retain all existing financial/audit history. The optional adapter remains disabled until actual account configuration is intentionally supplied. Missing migration/RPC availability fails measurement quietly and never authorizes payment or blocks delivery, but it is not an acceptable completed rollout.

Production URL/migration release and supervision of the first real paid delivery are operational follow-ups, not Google-account setup tasks. No geography or regulatory permission is invented to bypass them.

## 13. Items requiring the real Google Ads account

1. Create the account and complete actual business/advertiser verification if requested, billing, campaign settings, and chosen geographic targeting.
2. Create the purchase conversion action, obtain its actual Ads ID and conversion label, and place them in the configuration locations in section 7. Use actual value, USD, and the supplied stable transaction ID; avoid creating a second competing purchase tag.
3. Decide whether to enable enhanced conversions; if enabled, select the code-provided email method and corresponding feature/configuration. Do not enable automatic collection from claim forms.
4. Release the configured builds and exact CSP toggle, then verify tag/consent behavior on both actual hosts with Google's diagnostics: denied/accepted/withdrawn consent, cross-host attribution, one confirmed purchase, correct value/order ID, refresh deduplication, and conditional enhanced email. Use an explicitly authorized transaction; never infer conversion success from a tag callback alone.
5. Verify destination review/approval and conversion diagnostics before enabling campaign spend. Google acceptance, attribution and enhanced-conversion matching cannot be proven without the real account.

Refunds are available as authoritative first-party events. If campaign reporting should retract/refund conversions, use the actual account's conversion-adjustment process with the stable order reference; this implementation does not send an invented refund conversion.
