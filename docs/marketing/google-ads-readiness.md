# Google Search Ads readiness

Updated September 24, 2026 after the Google configuration release of source **`de7f929b53371aa44303b63cdd596bfb97b1c1c6`**. The [complete product release](../engineering/production-release-2026-09-24-complete.md) remains the unchanged product/backend baseline.

**PASS — the Google tag and purchase conversion infrastructure are live and configured.** The owner reports that the Google Ads account is created, the temporary onboarding Performance Max campaign is paused, and account-level Enhanced Conversions is enabled. This release did not access or change campaign settings.

The existing homepage and customer journey remain the destination. Final Google Ads purchase delivery, value, deduplication, attribution, and enhanced matching diagnostics still require an explicitly authorized purchase test before meaningful Search campaign spend. No real financial transaction is required for this infrastructure PASS, and none was performed.

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
| Availability | Fresh production checks confirm the existing nationwide product with enforcement off; see section 10. This release changes no jurisdiction, price, refund, evidence, or payment rule. |

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
| `landing_view` | Existing public homepage entry, after optional permission | Browser abstraction only; deduplicated for that navigation. No unauthenticated public analytics collector or application-emitted Google page-view event is installed. Google-owned tag beacons are described in section 14. |
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

No GA4 or GTM container or separate tag ID is required. The direct Ads ID is also the Google tag ID. Example defaults remain inert; the protected production/public build inputs now contain the values below.

| Configuration | Where/how to set after account creation |
| --- | --- |
| `VITE_GOOGLE_ADS_CONVERSION_ID` | `AW-18473000475` in both production and public-site builds. |
| `VITE_GOOGLE_ADS_PURCHASE_LABEL` | `SbutCPivmYQdEJu8zuhE` in both builds. |
| `VITE_GOOGLE_ENHANCED_CONVERSIONS` | `true` in both builds; account enablement reported by the owner. Email is requested only with advertising consent and used only for an authoritative live purchase. |
| `GOOGLE_ADS_MEASUREMENT` | `true` in both `production` and `public-site` Worker environments; verified in deployed settings. |

Vite variables are build-time configuration: changing them requires a normal build/release, not product-code changes. Missing/invalid ID or label makes the adapter inert. Local, staging, partner, staff, and authentication surfaces cannot activate it. The script loads asynchronously only after advertising permission. Blocked/loading-failed scripts resolve without interrupting product work.

The purchase payload contains destination, order UUID, actual purchase value, USD, and a sanitized fixed public page location/title/referrer. It does not use the insurer valuation or proposed settlement as revenue. The adapter sets `send_page_view=false`, disables personalized advertising and Google signals, and emits no application page-view event. Live inspection nevertheless observed Google-owned consented page-view/linker beacons; see section 14 for the exact distinction.

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

## 10. Verified production jurisdictions

The [complete release record](../engineering/production-release-2026-09-24-complete.md) covers the full repository delta and all production components. Fresh Cloud Run inspection confirms **`venfour-api-production-release-0924-3b10a43`**, 100% traffic, **`VENFOUR_NATIONWIDE_PRODUCT=true`**, and **`VENFOUR_JURISDICTION_MODE=off`**. The backend was not redeployed because all 182 uploaded source files match the current source and its configuration is unchanged. The new customer/partner build has nationwide support enabled.

All **51 owner-authenticated production jurisdiction checks** passed on one explicitly synthetic unpaid draft. Each used the shared generic product, with no state-specific override prerequisite, no applied overrides, the same report label, and appraisal labels disabled. The normal UI also saved Missouri facts. The database has no active paid-delivery hold, and `manual_approval_required=false` remains unchanged.

| Customer action | Current supported scope and boundary |
| --- | --- |
| Start | Generic product path for all 50 U.S. states and D.C.; normal guest intake and case facts still apply. Foreign countries/territories are outside the 51-record product inventory. |
| Purchase | No live jurisdiction enforcement or state-specific override prerequisite. Cases in the same 51-record scope can reach checkout when existing report/evidence/ownership/payment gates pass. A state selection alone does not make a case eligible. |
| Complete paid product | The shared report and customer-prepared reconsideration/response workflow remain technically enabled across that scope, subject to existing qualification, payment, processing, and delivery gates. This is not 51 completed paid customer journeys. |
| Restricted activities | Direct insurer negotiation/representation, formal appraisal-clause/umpire services, assignment services, and appraisal labels remain disabled. State-specific settlement components remain unresolved/excluded. |

No new state-specific technical blocker was established. Configuration and accessibility are not legal approval or an operating-permission determination. Enforcement was not activated, and no authority publication or enrollment was invented. A supervised real paid customer journey remains unproven by the nonbillable smoke.

## 11. Complete product release verification (prior baseline)

The complete release validation retains the broader tracking, attribution, consent, purchase/refund, privacy, jurisdiction, ownership, host-boundary, partner, staff, and report-processing coverage. Only tests specific to the retired page/redirect were removed during the earlier cleanup.

| Check | Prior complete product release result |
| --- | --- |
| Complete frontend suite | **2,469 passed, 14 skipped**; 146 passed test files and one skipped file. |
| Separate Worker/environment suite | **144 passed in three files**. |
| Complete offline backend suite | **2,320 run**, zero failures/errors, four skipped, zero unexpected network attempts; three deliberate guard probes blocked. |
| Complete isolated database validation | All **89 migrations** rehearsed; **2,906 assertions passed in 60 files**, including 31 dedicated measurement assertions. |
| Production and public-site builds | Passed environment validation, generated contracts, TypeScript, Vite, and Worker dry runs. Neither output has the dedicated-page HTML/component/styles. |
| Lint and source checks | Production source lint and diff checks passed. Full lint retains four unchanged local showcase errors, explicitly listed in the release report; those files are excluded from production. |
| Hosted release identity | Both Worker bundles match the release build; all **20 served-asset comparisons** passed. Production has all 89 migrations. Backend source/configuration is unchanged and verified. |
| Hosted routes and UI | **33 HTTP checks plus six role/referral boundary checks** passed. Ten informational/policy pages, desktop/mobile homepage and intake, customer sign-in, partner sign-in, and staff Access protection were checked. |
| Hosted acquisition/consent | No optional attribution/event/tag before consent; all eight synthetic parameters persisted after consent, first paid touch survived a later visit, and the actual public-to-app transition saved the same owned acquisition. Withdrawal cleared browser and current-case attribution. Global Privacy Control produced denied optional preferences. |
| Hosted authority/ownership | Owner receipt read succeeded with an empty unpaid receipt; other-owner read/write returned 403; forged purchase/refund events returned 400; repeated progress writes left one record. The unsubmitted draft could not obtain a checkout quote. |

```sh
npm --prefix frontend test
npm --prefix frontend run test:worker
.venv/bin/python scripts/run_offline_tests.py
npm --prefix frontend run lint
# In the frontend package:
./node_modules/.bin/eslint src worker scripts vite.config.ts
# Dedicated network-isolated rehearsal container:
python3 scripts/run_isolated_database_tests.py --container venfour-migration-rehearsal-current-release --output <protected-release-directory>/database-tests
# Frozen source with explicit production/public environment files:
./node_modules/.bin/wrangler deploy --env production --dry-run
./node_modules/.bin/wrangler deploy --env public-site --dry-run
git diff --check
```

No real charge, insurer upload, paid-provider request, production email, manufactured entitlement, or fabricated Google account ID was used. Purchase/refund amounts and deduplication are verified by the deployed ledger/view implementation and isolated payment fixtures, not a new live transaction. No Google request occurred during browser smoke. Existing large-bundle advisories and provider-owned Turnstile/Access console diagnostics are recorded in the full release report.

The dedicated-page removal inventory in section 2 remains the historical cleanup record. The full release report contains all 181 pending paths and exact distinctions between production source, configuration, migration, documentation, tests, and obsolete generated artifacts.

## 12. Deployed infrastructure and campaign activation

**The complete intended product release is live.** Applied `20260924000000_search_measurement.sql` through the normal migration process; no local migration remains pending. Customer/partner Worker version: `b0467bdd-4f60-484e-9b1b-24782f001c1f`. Public Worker version: `15e50143-9c23-49a4-b345-d6ab286bb60d`. Both serve runtime source `e2ae5729bd018eebcf08177ae60c3be7e38e2520`; exact timestamps and the unchanged backend identity are in the release record.

The homepage is the intended ad destination. `/total-loss-review` returns 404 on the public host and has no dedicated route, component, replacement page, or redirect. The parent-domain consent/acquisition behavior and owner-restricted measurement RPCs have been checked on the real hosts. Security/RLS, financial/provider counters, private storage, and existing business history remain intact.

The Google configuration release in section 14 supersedes the blank-ID and disabled-tag state of that product release. Current Worker versions are recorded below. A missing dedicated page is not a deployment or campaign-readiness blocker.

## 13. Remaining account-side verification before Search spend

The account, purchase action identifiers, and Enhanced Conversions account switch have been supplied by the owner; the real identifiers and corresponding production integration are now installed. The temporary Performance Max campaign remains paused according to the owner. No account or campaign mutation was performed here.

1. Confirm required business/advertiser verification, billing, destination approval, geographic targeting, and Search campaign settings in the account.
2. Confirm that the supplied purchase conversion action uses actual transaction value, USD, and the code-provided transaction ID. Avoid a second competing purchase tag; use the code-provided enhanced email method rather than automatic collection from claim forms.
3. Explicitly authorize a purchase test, then inspect Google Ads diagnostics for receipt of one purchase with its actual value/order reference, refresh deduplication, attribution, and conditional enhanced email matching. A tag callback alone is not acceptance or attribution proof.
4. Resolve account-side diagnostics before meaningful campaign spend. Campaign activation is a separate action; this release does not authorize or perform it.

Refunds remain authoritative first-party events. If reporting should retract/refund conversions, use the actual account's conversion-adjustment process with the stable order reference; the adapter does not send an invented refund conversion.

## 14. Google production configuration release

### Configuration, source, and deployment

- Runtime source: **`de7f929b53371aa44303b63cdd596bfb97b1c1c6`**. Its only tracked runtime configuration change is the two existing Worker CSP switches. Regression tests were added to `frontend/src/features/measurement/google.test.ts`; no adapter, homepage, intake, checkout, pricing, refund, backend, or database implementation changed.
- Protected normal build configuration: `frontend/.env.production.local` and `frontend/.env.public-site.local`, retained with explicit inputs under `~/.venfour-releases/2026-09-24-google/`. Existing non-Google release inputs were preserved. No secret-bearing environment file is committed.
- Purchase destination: **`AW-18473000475/SbutCPivmYQdEJu8zuhE`**. No separate tag/container is installed.
- Customer/partner Worker `venfour-frontend-production`: **`0f232f0d-d3ef-41e5-b27f-591639e77c57`**, deployed September 24 at **22:30:36 UTC**, 100% traffic.
- Public Worker `venfour-public-site`: **`e729a36f-814d-4003-bbbb-133ab77a28d2`**, deployed at **22:30:07 UTC**, 100% traffic.
- Both deployed Worker bundles match the retained build; all **20 served-asset comparisons** pass. Both build outputs contain the exact real ID/label and enabled enhanced configuration. No Cloud Run deployment or database migration was needed.
- Rollback references: customer `b0467bdd-4f60-484e-9b1b-24782f001c1f`, public `15e50143-9c23-49a4-b345-d6ab286bb60d`. These restore the prior inactive measurement builds without changing financial history.

### CSP and live tag behavior

Only `GOOGLE_ADS_MEASUREMENT=false` changed to `true` in the existing two environments. The exact-origin allowlist in `frontend/worker/index.ts` is unchanged and matches [Google's current CSP guidance](https://developers.google.com/tag-platform/security/guides/csp). No wildcard, script `unsafe-inline`, or `unsafe-eval` allowance was added. Partner, staff, and authentication exclusions remain enforced.

On the homepage, advertising permission loads exactly one `https://www.googletagmanager.com/gtag/js?id=AW-18473000475` script and one tag initialization/configuration. The app build uses the same configuration but deliberately defers script loading until an authoritative live purchase is measured; an unpaid `/start` flow has zero Google scripts/requests. There is no second tag implementation.

No Google CSP violation or uncaught page error was observed. The existing third-party Turnstile frame emitted diagnostic console messages, including two errors and four warnings; these did not prevent intake and did not originate from the Google integration. Builds retain the existing non-failing large-chunk advisory.

### Consent and attribution evidence

| Scenario | Live result |
| --- | --- |
| Fresh visitor | Zero Google requests/scripts; no persistent acquisition before consent. |
| Analytics allowed, advertising denied | Zero Google requests/scripts. |
| Advertising allowed | One real tag; default-denied commands precede consent update/configuration; personalization remains denied. |
| Withdrawal | Loaded tag receives all-denied update; acquisition cookie removed; current owned draft receives successful attribution-clear RPC. Subsequent public/app visit has no Google requests. |
| Global Privacy Control | On both public/app hosts, GPC overrides an existing saved opt-in, stores both optional purposes as denied, and sends zero Google requests. |
| Synthetic acquisition | All eight supported fields pass from the actual homepage Start link to the app through the shared cookie. An owned unpaid draft reload returns 204 for its attribution save and 200 with an empty financial receipt. No identity email or purchase is available on that unpaid receipt. |
| First paid touch | A later synthetic paid visit preserves the original first-party acquisition values. |

The new draft was created without report upload, vehicle lookup, analysis, checkout creation, or payment. Case association was verified when the existing owner draft bootstrap ran on reload; this check does not claim immediate association at the instant a new draft is first created. Withdrawal succeeded through that same owner boundary. One synthetic anonymous draft remains as verification evidence with optional attribution withdrawn.

### Payload and purchase boundaries

Observed Google requests during consented homepage testing were the tag script, `www.google.com/ccm/collect`, `www.googleadservices.com/pagead/set_partitioned_cookie`, and `ad.doubleclick.net/ccm/s/collect`. Google-owned beacons included `en=page_view` despite the adapter's `send_page_view=false`; this is not a purchase conversion and no conversion label, order ID, value, or email was transmitted during the unpaid live tests.

Observed fields include the Ads destination, fixed public URL/title, validated synthetic click ID, Google-generated cookie/browser identifier, consent flags, non-personalization flag, tag/version/experiment metadata, and timing/random values. Requests inherently expose the connecting IP and standard browser transport headers to Google. UTM fields remain first-party; `gbraid`/`wbraid` are available in the sanitized configured location, although the observed beacons selected `gclid`. No private route, case UUID, document, claim/vehicle/valuation/comparable data, generated content, authorization token, or profile identity was present in the captured payloads.

The configured purchase payload remains `send_to`, actual ledger-derived amount, USD, stable order UUID, and fixed sanitized page metadata. A nonstandard **149.50 USD** unit fixture verifies that neither 1.0 nor 199 is hardcoded. Enhanced identity is only the authorized purchaser email, passed to Google's documented normalization/SHA-256 behavior and immediately cleared from tag settings. Account-side enhanced matching and actual purchase transmission remain unproven until the separately authorized transaction test.

### Fresh validation results

| Check | Result |
| --- | --- |
| Focused measurement, privacy, application and checkout tests | **173 passed in 5 files**, zero failures. Includes five new real-destination/initialization/consent tests. |
| Worker/environment suite | **144 passed in 3 files**, zero failures. |
| Changed-test lint | Passed. |
| Production and public builds | Both passed environment validation, generated-contract freshness, TypeScript, Vite, and Worker dry runs. |
| Hosted financial/ownership boundary | **7 checks passed**: own receipt 200/empty; other-owner receipt 403; forged purchase/refund writes each 400; repeated progress writes each 204; unqualified draft checkout quote rejected with existing 404 boundary. |
| Deployed bundle/assets/config | Both Worker bundles match; **20/20** assets match; real ID/label present in both builds; both deployed CSP switches verified true. |
| Browser consent/attribution/privacy | Results above, using synthetic values and isolated browser sessions; no purchase conversion emitted. |
| Source/diff | Scope limited to configuration, regression coverage, and this record; `git diff --check` passed. |

The full backend/database suites in section 11 are the prior complete release baseline, not rerun or represented as fresh for this configuration-only release. The deployed financial implementation and schema are unchanged. No real charge, paid provider request, production email, or campaign activation was performed.
