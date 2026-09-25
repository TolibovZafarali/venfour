# Venfour Search campaign audit — September 25, 2026

**Launch update:** The user subsequently authorized removing the pause. Campaign **24294985882 is now ENABLED**, verified after reload on September 25 at approximately 12:26 p.m. Central. Google reports **Eligible (Limited)**. Live purchase verification is deferred until a genuine customer purchase. See `2026-09-25-search-campaign-launch.md` for the current state. The audit below preserves the original prelaunch observations.

The production campaign is built and **PAUSED**. Final Google Ads overview: **0 clicks, 0 impressions, $0.00 cost**. No ad spend, real test purchase, paid-provider call, deployment, source edit, or billing change was made by this task.

**One required QA item remains unverified:** a Google-observed purchase firing and deduplication test (item 30). The existing implementation and 35 focused tests pass, but those tests stub Google's tag. They do not establish that Google received a real purchase. The conversion action currently says **Awaiting conversions**. This report does not certify the full paid customer journey.

[Open the paused campaign](https://ads.google.com/aw/overview?campaignId=24294985882&ocid=8561799569&workspaceId=0&euid=6632295970&__u=3230128530&uscid=8561799569&__c=2614379081&authuser=1).

## Configuration actually saved

| Item | Result |
|---|---|
| Google Ads account | Venfour — **994-857-1115**, signed in as zafar@venfour.com |
| Campaign | **Venfour \| Total Loss Dispute \| Search \| US** |
| Production campaign ID | **24294985882** |
| Status and type | **PAUSED**, Search |
| Budget | **$20.00/day average** |
| Bidding | **Maximize Clicks**, **$6.00 maximum CPC bid limit** |
| Targeting | United States; **Presence: People in or regularly in your targeted locations** |
| Networks | Google Search on; Search Partners off; Display off |
| Language | English |
| Devices | Computers, mobile phones, tablets; no exclusions or bid adjustments |
| Schedule | All day, all days; start September 25, 2026; no end date |
| Expansion/automation | AI Max off; broad-match campaign setting off; automatically created assets off; text customization and final URL expansion off |
| Ad group | **Low Offer & Dispute** — **202057631162**, one launch ad group |
| RSA | **826088058923**, one responsive search ad; enabled inside the paused campaign |
| RSA status | Not eligible to serve while campaign is paused; Ad Strength Average; initial review was observed; no rejection observed |
| Asset counts | 15 headlines, 4 descriptions, 4 campaign sitelinks, 6 campaign callouts, 1 campaign business name, 1 campaign business logo |
| Final URL | https://app.venfour.com/start?service=total-loss |
| Display paths | `total-loss` / `dispute` |
| Purchase bidding goal | Purchases, account-default; the single purchase action is Primary |

The United States target and presence setting restrict the geographic audience to the supported country. No separate worldwide country-exclusion list was added. Country targeting is not a guarantee of every visitor's physical location.

## Positive keywords

Exactly **14** positives were verified in the published campaign: **12 exact**, **2 phrase**, **0 broad**.

| Keyword | Match type |
|---|---|
| total loss settlement negotiation service | Exact |
| help with total loss settlement | Exact |
| dispute total loss valuation | Exact |
| negotiate total loss settlement | Exact |
| insurance offer too low for totaled car | Exact |
| insurance undervalued my car | Exact |
| totaled car value too low | Exact |
| car actual cash value too low | Exact |
| total loss settlement counter offer | Exact |
| total loss valuation report review | Exact |
| ccc valuation dispute | Exact |
| mitchell total loss valuation dispute | Exact |
| total loss offer too low | Phrase |
| insurance lowball total loss | Phrase |

Google showed low search volume on these eight exact keywords during the audit: total loss settlement negotiation service; help with total loss settlement; insurance offer too low for totaled car; totaled car value too low; car actual cash value too low; total loss settlement counter offer; total loss valuation report review; mitchell total loss valuation dispute. The terms were retained as specified. Review statuses can change after this snapshot.

## Campaign negatives

**63 campaign-level negatives** saved and compared against the intended set: **39 phrase + 24 exact**, with no missing or extra terms. This includes all 55 required negatives plus the 8 vehicle-type exclusions: motorcycle, motorcycles, boat, boats, RV, RVs, motorhome, motorhomes (phrase match).

The supported vehicle lookup uses car, truck and multipurpose vehicle categories; motorcycle, boat and RV services were not supported by the inspected product flow. No blanket negatives for free, report, appraisal, CCC, Mitchell, comparables, for sale or how to were added. The exact negatives expressly requested for free estimates and appraisals were retained.

The complete list is saved alongside this report in `campaign-negative-keywords.txt`.

## Responsive search ad

Published ad editor inspection confirmed the requested text, without substituted or suggested copy. Every headline is within 30 characters and every description within 90. The first two headlines are both pinned as alternatives to headline position 1. All other headlines and all descriptions are unpinned.

1. Total Loss Offer Too Low? — H1
2. Dispute Your Total Loss Offer — H1
3. Was Your Car Undervalued?
4. Free Total Loss Estimate
5. Check Before You Accept
6. Guided Dispute Help for $199
7. Evidence to Back Your Dispute
8. Compare Similar Vehicles
9. Review Your Valuation Report
10. Prepare Your Counteroffer
11. Know What to Say Next
12. Review Your Insurer's Reply
13. Support Beyond the First Offer
14. Venfour Total Loss Help
15. Start With a Free Value Check

Descriptions:

1. Total loss offer too low? Get evidence-backed help challenging your insurer's valuation.
2. We review your insurer's report, comparable vehicles, mileage, trim and value adjustments.
3. Start with a free total loss estimate. See whether your offer deserves a closer look.
4. For $199, build your dispute and get guidance on what to say when your insurer replies.

## Sitelinks, callouts and business information

All four sitelinks were saved at campaign level and their production pages rendered successfully. All four show **Eligible** at the final asset audit.

| Sitelink | Descriptions | URL |
|---|---|---|
| Free Total Loss Estimate | Start with your vehicle details / Get a free initial value estimate | https://app.venfour.com/start?service=total-loss&view=intake |
| How Venfour Works | See the steps before you start / From your details to the evidence | https://venfour.com/#how-it-works |
| How We Review Evidence | How we assess vehicle comparisons / Understand findings and limits | https://venfour.com/methodology |
| Fair-Result Refund Policy | See when a refund applies / Read eligibility and requirements | https://venfour.com/refund-policy |

Six matching existing callout assets were reused and attached to this campaign; all show **Eligible**:

- Free Initial Estimate
- Evidence-Based Review
- Market Comparisons
- Guided Dispute Process
- Insurer Response Analysis
- $199 One-Time Purchase

The user completed advertiser verification using Google's legal-name/address route without a D-U-N-S number. On refresh, the account-verification pause banner disappeared, the disclosure became **Ads funded by Venfour LLC**, and business-asset creation unlocked.

Business name **Venfour** is saved at campaign level. The real existing **Venfour LinkedIn Logo (1).png**, asset ID **424667340471**, is attached as the business logo. It is a 4096 × 4096 square mark, visually checked against `assets/brand/venfour-mark.svg` and the repository's email mark. No logo was generated. Both new business-asset associations show **Pending / Under review**. Google warns that business assets may not serve even after approval; see [Google's business-information guidance](https://support.google.com/google-ads/answer/12497613?hl=en).

No image, structured-snippet, price, promotion, lead-form, call, location or app assets were added. There are exactly 12 campaign asset associations. Earlier authentication/save retries left unattached sitelink copies in the asset library; the campaign itself has exactly the intended four sitelink associations.

## Purchase conversion and technical evidence

The existing website conversion was reused and renamed from Purchase to **Venfour Purchase**. There is exactly one conversion action in the account; no duplicate purchase measurement was created.

| Conversion setting | Saved value |
|---|---|
| Action ID | **7793432568** |
| Source | Website / direct Google tag, not an imported GA4 event |
| Google destination | **AW-18473000475/SbutCPivmYQdEJu8zuhE** |
| Optimization / count | **Primary / Every purchase** |
| Goal | Purchases, included in account-level goals |
| Value | Different values for each conversion; actual receipt value, USD |
| Existing default fallback | $1; application rejects absent/invalid receipt values rather than using this fallback |
| Windows | Click 30 days; engaged-view 3 days; view-through 1 day |
| Attribution | Data-driven, Google paid channels |
| Final Google tracking status | **Awaiting conversions**; zero recorded conversions |

The Google Ads event snippet was opened and its exact ID/label matched against the deployed application bundle and source configuration.

The existing flow reads owner-authorized financial receipts through `get_case_measurement`. Its database view derives purchases from immutable `payment_transactions` joined to `commerce_orders`. A payment transaction becomes `purchase_completed`; the order UUID supplies `transaction_id`, `amount_minor_units / 100` supplies the actual charged value, and the order supplies `provider_livemode`.

`sendGooglePurchase` requires a live receipt, advertising consent, a valid transaction UUID, a positive finite value and USD. Checkout loads, purchase-button clicks and unconfirmed return URLs do not supply a purchase. Refund events are not sent as purchases. Denied consent and Global Privacy Control suppress advertising measurement. The tag loads only when an eligible purchase is sent, so an ordinary landing-page scan may not detect it.

Duplicate prevention uses an in-flight set, a persistent localStorage key set by the tag callback, and the stable transaction ID sent to Google. The source tests cover repeat calls and reload behavior; remote deduplication has not been observed with a real transaction during this task.

**Existing Enhanced Conversions was already enabled in Ads and deployed source before this task.** It was not enabled, changed or exercised here. No customer data was uploaded or hashed by this task. The existing code can pass receipt email to Google's tag after consent when that existing setting is enabled. This pre-existing behavior is disclosed rather than represented as newly authorized work.

No completed-free-estimate secondary conversion was created: the inspected event registry did not contain a trustworthy completed-free-valuation event that could be reused without additional implementation. No free estimate is a Primary bidding goal.

No source files changed for measurement. Inspected existing files include:

- `frontend/src/features/measurement/google.ts`
- `frontend/src/features/measurement/service.ts`
- `frontend/src/features/measurement/use-case-measurement.ts`
- `frontend/src/features/measurement/attribution.ts`
- `frontend/src/features/measurement/config.ts`
- `frontend/src/features/measurement/events.ts`
- `supabase/migrations/20260924000000_search_measurement.sql`

Verification run:

```text
npm --prefix frontend test -- src/features/measurement/google.test.ts src/features/measurement/measurement.test.ts
35 tests passed in 2 files
git diff --check
passed
```

Tests include an actual-value fixture of $149.50 rather than only $199, invalid receipts, denied consent/GPC, non-live payment suppression, refund exclusion, no purchase on page load, concurrency and repeat/reload deduplication. Google's transport is stubbed; this is implementation evidence, not a Google-recorded sale.

Google's current **Awaiting conversions** popover only offered conversion details, not a troubleshooting launch. Google's [Tag Assistant instructions](https://support.google.com/google-ads/answer/10989978?hl=en) require triggering the conversion on the website. A legitimate live receipt is required by this application; test-mode transactions intentionally do not reach the live advertising destination. No receipt was fabricated, no fake conversion was sent, and no real paid test order was created. **QA item 30 therefore remains open.**

## URL attribution

Saved campaign Final URL Suffix:

```text
utm_source=google&utm_medium=cpc&utm_campaign=venfour_total_loss_search&utm_term={keyword}&utm_content={creative}&campaign_id={campaignid}&adgroup_id={adgroupid}&device={device}&matchtype={matchtype}
```

Tracking template is blank. The ad and sitelinks retain their original routing/query parameters. A production browser visit with the real campaign, ad group and ad IDs and representative resolved keyword/device/match-type values preserved `service=total-loss` and rendered Total Loss, free entry and the $199 price. No simulated click ID was added.

No customer identifiers, email, case data, VIN or other sensitive personal data were placed in tracking URLs. Google's purchase payload uses a sanitized public `page_location`, validated click identifiers when present, blank referrer, and the stable transaction UUID rather than a customer-facing case URL.

## Product and production checks

Live public/app pages and the current repository support the advertised $199 one-time service, free initial estimate, insurer-report/evidence review, and guidance following an insurer response. Customers communicate with their insurer themselves. No promised increase, legal representation or independent appraisal claim was added.

The deployed refund policy states that a review not supporting a dispute receives a full refund and retains the report. For a supported dispute, the Fair-Result policy depends on documented final ACV improvement below $1,000 and a request within 30 days; exactly $1,000 does not qualify under that condition. No material mismatch with the supplied sitelink positioning was found.

The live frontend bundle has the nationwide generic product enabled. The repository's recorded September 24 production release verified all 50 states plus D.C. The current public health and backend readiness endpoints were healthy, and the live intake rendered. A fresh Cloud Run flag query was unavailable because the CLI authorization session had expired; this task did not repeat a paid customer journey in every state. These are technical availability checks, not a legal operating-authority determination.

No material public-price, service-positioning or destination discrepancy was found. Pre-existing Enhanced Conversions and the incomplete Google-observed purchase test are the measurement qualifications described above.

## Remaining warnings and preserved scope

- Campaign paused; ads cannot serve. This is intentional.
- Google warns **Missing enough relevant keywords** and **New bid strategy is learning**. No suggested keywords, expansion or budget increase was applied.
- Eight requested long exact keywords showed low search volume; the requested list was retained.
- RSA Ad Strength Average. No filler assets or copy changes were made to increase that score.
- Business name and logo are under review. No asset or ad rejection was observed.
- Purchase goal showed Needs attention, and the action showed Awaiting conversions. Google-observed purchase verification remains open.
- The account page still offers an account-wide EU-political-ad declaration; this unrelated declaration was not answered on the user's behalf. The account-verification pause banner was cleared after the user's submission.
- Earlier sitelink recommendations were not used to create additional campaign associations; the final table verifies all four requested sitelinks and six callouts.

The existing paused Performance Max campaign and two pre-existing Search drafts were left unchanged. This task created one published Search campaign, one ad group and one RSA. The conversion name is shared account-wide because the existing action was reused. Table display columns/page size were adjusted for inspection. No payment method, budget on another campaign, payments profile, credits or unrelated campaign settings were changed by this task. The user personally submitted the verification details that Google said would affect the payments profile.

Concurrent user repository edits were left untouched. No task commit, push or deployment was performed.

## Required QA checklist

| # | Check | Result |
|---|---|---|
| 1–8 | Account; Search; paused; $20; partners off; Display off; AI Max off; broad setting off | Verified |
| 9–13 | US availability/target; presence; English; Maximize Clicks; $6 cap | Verified within production-evidence limits above |
| 14–17 | Purchase Primary; no free Primary; 14 exact/phrase positives; no broad | Verified |
| 18–23 | All negatives; one group; RSA text; working final URL; paths; pinning | Verified |
| 24–27 | Four working sitelinks; six callouts; business assets documented; automatic text off | Verified |
| 28–29 | No accidental campaigns/ads; unrelated settings preserved | Verified, with unused library copies and shared conversion rename disclosed above |
| **30** | **Google-observed confirmed purchase fires once** | **Not fully verified; implementation tests pass, platform evidence pending** |
| 31–32 | Attribution preserves routing; no sensitive tracking URLs | Verified |

**The campaign remains PAUSED.** After the user reviews the audit and resolves or accepts the outstanding measurement limitation, the single campaign action to launch is: open this campaign and change **Status: Paused → Enabled**. That action was not taken. Any remaining Google asset/ad review can still affect serving.
