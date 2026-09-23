# Venfour existing-service regulatory review packet

Prepared September 22, 2026. Initial review jurisdiction: **Missouri**.
Source baseline: `f8a3f7a3fd90da914e9d9f6692e7972d6a965e21`.

**Evidence only. No legal conclusions, jurisdiction approvals, credential verification,
or permission to operate are supplied by this packet.** Missouri is the requested
review target, not an approved footprint. A ZIP code, an existing customer flow,
a research record, and a successful payment are not operating authority.

## 1. Executive service description and evidence limits

Venfour's current source implements a self-service total-loss vehicle valuation
review. The customer supplies vehicle and claim facts; Venfour obtains and qualifies
advertised vehicle listings, computes deterministic comparisons, reads insurer
valuation documents, and prepares a case-specific review. The current PDF is titled
**“Vehicle Valuation Review.”** It identifies Venfour, shows the insurer vehicle
valuation alongside a selected advertised-price range and median, explains
limitations, and can request reconsideration. It does not calculate an independent
point actual cash value, independently apply dollar adjustments, or purport to
determine the settlement owed. That describes its implementation, not its legal
classification. [S03–S08]

The paid package can also prepare an editable customer reconsideration message,
analyze a customer-uploaded insurer response, provide a recommendation, and prepare
a follow-up grounded in saved evidence. Those are distinct activities for review.
The customer sends messages through their own email account and reports sending
them. No implemented direct insurer negotiation, insurer inbox, formal
appraisal-clause appointment, umpire role, or signed human appraisal fulfillment
was found in the inspected source. Offline staff conduct and actual business
credentials remain **UNKNOWN**. [S10–S13, S18]

The canonical live price is **$199 USD, one time**. There is an automatic no-support
refund process with retained report access and a separate manual final-outcome
refund policy. Referral tracking, contracting, outcome verification and accounting
exist; the supplied $50/$75 agreement is a **held draft**, not evidence that those
rates are active for any real partner. [S09, S14–S16]

This is a review of the checked-in implementation, not an observation of production.
Hosted configuration, deployed commit, active agreements, actual licensed personnel,
and operational staffing were not inspected. Source-defined branches may depend on
configuration and existing case state. Historical artifacts and tests are not proof
of current availability. Public-site intake itself is conditional:
`frontend/src/config/public-site.ts` sets `publicIntakeClosed` when the public-only
build lacks `VITE_PUBLIC_INTAKE_OPEN=true`. The actual hosted setting is UNKNOWN.

**Important current distinction:** starting without an insurer report is implemented
for the free estimate and retained historical contracts. Current **new checkout**
also requires report-backed full-review readiness. The homepage's no-report wording
does not establish a new paid no-report path. See the discrepancy register. [S02, S04, S09]

Companions supplied with this packet:

- [Representative outputs](missouri-existing-service-examples/README.md): two actual
  current-renderer fictional PDFs, extracted text, report JSON, free-result output,
  response/coaching/follow-up output, and the initial-message template.
- [Copy inventory](missouri-existing-service-claims.json): 958 source literal entries,
  with exact text, path/locator and surface classification. The selected inventory
  below is the readable starting point.
- [Search coverage](missouri-existing-service-search-coverage.json): all 1,588 tracked
  files, hashes, search methods and term counts; no archival customer contents.
- [Blank worksheet](missouri-existing-service-review-worksheet.json): ten separate
  capability records, all legal decisions and requirements unanswered. It is not
  an authority artifact and cannot be published as one.

## 2. Current customer journey

For **every stage below**, the product does not itself contact or negotiate with
the insurer, does not appoint an appraiser/umpire, and does not claim a representative
role. The communication stage explicitly hands control to the customer. This is a
source finding, not a conclusion that the activities fall outside regulated work.

| Stage and timing | What happens automatically | Customer action; staff involvement | Output and boundary | Evidence |
| --- | --- | --- | --- | --- |
| First visit; free | Public explanation, example, methodology and resource pages; route to Total Loss when intake is open | Customer chooses to start; no staff required by this step | Public example is fictional; Diminished Value intake is paused and is not the service reviewed here | S01 |
| Vehicle intake; free | VIN lookup can populate vehicle identity; manual year/make/model and configuration paths exist; validation distinguishes missing facts from conflicts | Customer supplies/confirms vehicle, trim/configuration, mileage, ZIP/search area, loss date, insurer and available valuation; can correct details | VIN/NHTSA information is vehicle metadata, not credentials or applicable-law determination | S02 |
| Identity/contact; free to checkout | Isolated anonymous case can precede verified ownership; email verification transfers/claims access; contact acknowledgments are stored | Customer supplies names/email, optional phone, Terms acceptance and Privacy acknowledgment; optional follow-up preference is separate | Saved private case, not anonymous public storage; legacy acknowledgment version labels require review | S02, S15 |
| Preliminary market check; free | Market discovery and historical lookup, evidence qualification, scoring and immutable analysis/presentation | Customer initiates/continues; staff is not the value calculator | Estimate, listing context, or insufficient evidence; asking prices, evidence date and limitations remain explicit | S03 |
| Free result; pre-payment | Displays range when supported; contextual listings alone are not promoted to a reliable estimate; older result contracts can show discrepancy classifications | Customer views result, adds insurer value/report or continues recovery | “Not a loss-date valuation.” can apply to current-market evidence; fair-value wording is a signal, not a verified legal value | S03, C08–C11 |
| Insurer report; before new checkout | Private upload/normalization. Initial intake supports PDFs or ordered supported page images converted to a PDF; the later full-review upload flow requires a complete PDF. CCC adapter or generic structured extraction; normalized facts validated | Customer uploads and resolves permitted fact conflicts; identity mismatch requires correct document. Missing/unclear facts do not silently become matches | Known detection includes CCC, Mitchell and Audatex; named detection is not blanket support for every layout | S02, S04 |
| Full-review readiness; pre-payment | Requires usable report identity, insurer, loss date, vehicle/mileage, positive vehicle value and comparable rows; reconciles explicit conflicts; requalifies retained market observations | Customer confirms corrections; incomplete/unreadable report or insufficient strict evidence blocks payment | Free snapshot remains unchanged; report-backed assessment does not make a new market-provider search merely to improve the result | S04 |
| Eligibility and checkout | Backend checks ownership, workflow/revision, immutable source lineage, readiness, strict evidence and configured gates; validates Stripe price; reserves/reuses logical order and attempts | Customer verifies email and completes embedded Stripe payment; staff approval is separate where required | $199 live price. Browser success is not authoritative payment confirmation; no legal approval is implied | S09 |
| Payment and fulfillment | Signed webhook and server reconciliation record financial facts idempotently; entitlement/package work follows independently | Customer may leave and return; exceptions can require staff recovery | Payment records, receipts/accounting and refund rights survive a delivery hold. Payment alone cannot authorize new release | S09, S17 |
| Paid assessment/report | Freezes source/accepted report binding, computes final deterministic assessment, projects report JSON and renders PDF | No named human appraiser authors/signs this generated PDF | Advertised-price min/median/max and discrepancy; source references and immutable versions; no independent point ACV | S05–S08 |
| Quality review/release | Structured model quality review, reference validation, artifact/lineage checks, deterministic release decision; configuration and fresh provider qualification matter | Staff release review can approve, hold, request new evidence or mark not supportable; membership is not evidence of licensure | Supportable result may release; no-support result may release with refund; uncertainty/severe findings require review. No unrestricted model permission to publish | S08 |
| No-support branch; post-payment | No higher-value request when continuation is unsupported; refund orchestration records pending/succeeded/failure and retained access | Staff may resolve an exception; customer need not send a request or await insurer reply for this refund | Report remains accessible; a no-support finding does not establish insurer correctness | S08, S14 |
| Initial reconsideration; post-payment, supported case | Creates report-linked editable draft using current versioned template and evidence findings; freezes prepared version before handoff | Customer confirms claim/recipient, reviews and edits text, downloads report, opens email app or copies text, attaches report and sends | Customer's request, not a Venfour transmission; template asks reconsideration without an unsupported dollar demand | S10, S11 |
| Sent status and waiting | Opening email records a non-authoritative event; explicit confirmation stores prepared version, communication/round IDs and customer-reported time | Customer confirms sending and attaching report | Venfour cannot verify actual delivery or receipt; round/history is retained | S10 |
| Insurer response; post-payment | Stores original text/document, revised offer and immutable response versions; model extracts grounded analysis, deterministic policy derives recommendation | Customer pastes reply, uploads PDF/JPEG/PNG/HEIC/HEIF and/or records revised offer; corrects information while preserving history | No direct inbound insurer mailbox. Missing/visual/conflicting amounts and new reasoning can prevent a clear recommendation | S12 |
| Follow-up/coaching; post-payment | Uses saved report, response evidence, customer decision and exact lineage to generate deterministic follow-up or recoverable blocked result | Customer chooses continue or accept; reviews/edits/sends follow-up themselves | Does not recalculate published vehicle value or silently strengthen findings; no new market search implied | S12, S13 |
| Final outcome/closure | Records explicit customer resolution and reported amount; preserves reports, sent versions and response history | Customer confirms outcome; acceptance is handled with insurer outside Venfour; manager separately verifies commission evidence | Customer-reported final amount alone is not verified insurer outcome or commission success | S13, S16 |
| Manual refund and historical access | Support route and refund accounting exist; server-private, authorized report downloads remain bound to published versions | Customer emails a qualifying manual request and documents; staff reviews it; private report access continues under retained-access contract | Policy does not mean every customer-entered amount automatically produces a refund. Holds concern new work; historical access and financial reconciliation are distinct | S10, S14, S17 |

### What the calculations mean

`venfour/comparables.py::rank_market_comparables` scores eligible listings by vehicle
year, trim, mileage and distance with deterministic ordering. Qualification additionally
checks identity, material configuration, duplicate/conflicting records, geography,
dates and prices. Price is not a baseline rank component. Historical observations must
be supported as active on the loss date; later asking prices remain separately labeled.
Provider costs, budgets/cache and source transcripts are separate controls. [S03]

`ValuationDiscrepancyPolicy` currently specifies at most nine selected comparisons,
at least three independent vehicles, five for strong historical evidence, 5% potential
gap and 10% material gap thresholds, and a 20% high-dispersion parameter. Strength,
dispersion and range position affect classification; these are **software policy
parameters, not assertions about Missouri requirements**. Values are computed at a
minor-unit money boundary. The baseline comparison is selected median asking price
minus reviewed insurer vehicle value; it is not an independently adjusted settlement
target. [S03, S05]

The more permissive free-result contract is separate from strict paid eligibility.
It can show a range with three qualifying distinct vehicle identities, one/two
listings as context, or no supported result. Context does not mint paid eligibility.
Customer ZIP is search geography, not universal applicable law. Supplemental
deliberately higher-priced listings, when present, are labeled separately and do not
alter baseline statistics. [S03, S07]

## 3. Ten-capability matrix

“Implemented” here means source exists; it does not mean legally permitted or hosted
enabled. Money columns describe the current package, not a separate per-capability price.

| Runtime capability | Implementation and exact paths | Customer wording / representative output | Actor, payment timing, scope |
| --- | --- | --- | --- |
| `case_specific_preview` | Implemented. `venfour/preliminary_result.py`; `venfour/presentation.py`; `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx` | “Asking prices aren’t guaranteed sale prices or settlement amounts.” Free fixture $20,000–$20,400 | Automatic with customer facts; free/pre-payment. Not strict paid approval or a point ACV |
| `market_evidence_report` | Implemented. `venfour/valuation_evidence_report.py`; `venfour/valuation_review.py`; `venfour/report_processing.py`; `frontend/src/features/total-loss-claim/components/completed-analysis.tsx` | “Vehicle Valuation Review”; attached supported/no-support PDFs | Generated automatically; staff exception/release path. Included in $199, released post-payment through gates; no inspection or independent appraisal |
| `personalized_valuation` | Implemented as case-specific comparison/range/conclusion, **not an independently adjusted point value**. `venfour/discrepancy.py`; `venfour/package_assessment.py`; result/report paths above | “Your insurer’s value may be low”; selected median minus insurer value; `pointAcvDetermined=false` | Deterministic, displayed in free/paid contexts with different qualifications. Paid report included in $199. Legal classification of these personalized conclusions is unanswered |
| `customer_reconsideration_draft` | Implemented. `templates/total-loss-reconsideration-email.json`; `supabase/migrations/20260916000200_total_loss_reconsideration_generation.sql`; `venfour/customer_delivery.py`; `frontend/src/features/total-loss-claim/components/message-preparation.tsx` | “A personalized reconsideration request for you to review and send when the evidence supports it.” Initial template below | Automatic template, customer edits/sends; post-payment supported continuation, included in $199; not delivery by Venfour |
| `insurer_response_coaching` | Implemented. `venfour/insurer_response_analysis.py`; `venfour/insurer_response_processing.py`; `venfour/insurer_response_recommendation.py`; `venfour/insurer_response_followup.py`; `frontend/src/features/total-loss-claim/components/insurer-response.tsx` | “Venfour has no clear recommendation yet.” / “Venfour recommends continuing to challenge this offer.” Fixture below | Model response explanation plus deterministic recommendation/follow-up; customer decision/send. Post-payment package; no new valuation in this step |
| `insurer_contact_negotiation` | **Not implemented** as a Venfour direct-contact/negotiation service. `venfour/jurisdiction.py::OUT_OF_SCOPE`; `frontend/src/features/total-loss-claim/browser-actions.ts` shows customer handoff | “Venfour does not negotiate directly with your insurer.” | No chargeable implemented direct service. Customer's communication is distinct; internal `negotiationRoundId` is history, not representative authority |
| `formal_appraisal_clause` | **Not implemented**. `venfour/jurisdiction.py::OUT_OF_SCOPE`; no appointment/award flow found in API/router/report fulfillment | “This comparison is not an independent vehicle appraisal.” | No separate fee, appointment, human signature, appraisal award or appraisal-clause election found |
| `umpire_expert_role` | **Not implemented**. `venfour/jurisdiction.py::OUT_OF_SCOPE`; modeled role strings alone are not a workflow | No current customer deliverable found for this role | No fee or timing. No umpire selection, expert engagement or testimony fulfillment found |
| `referral_marketing` | Implemented invite/sign/activate/link/attribution flow. `frontend/src/pages/referral-partners-page.tsx`; `frontend/src/features/referral-partners/pages.tsx`; `venfour/partner_service.py`; migrations in S16 | “An invitation-only referral program … beginning in Missouri.” | Partner introduces; manager invites/countersigns/activates; pre-purchase attribution. Customer price unchanged. No regulatory approval inferred |
| `referral_compensation` | Implemented calculation, verification and ledger; supplied new agreement **held, not active by default**. `venfour/partner_commissions.py`; `venfour/partner_outcomes.py`; `venfour/partner_earnings.py`; `frontend/src/features/referral-partners/earnings.tsx` | Draft: “Exactly $1,000 does not qualify.” $50 for successful cases 1–9, $75 for 10+ | Manager verifies evidence; system tiers/accounts; manual payout record, no bank transfer in ledger. Post-purchase and accepted verified outcome; active published countersigned qualifying agreement required |

## 4. Representative outputs, using existing fixtures only

These examples are fictional, local artifacts. They do not prove hosted delivery,
live extraction quality, live provider coverage, payment success, legal authority,
or a real customer outcome. No customer database was queried. Fixture contact names
were replaced with **Fictional Customer/Fictional Adjuster**, email uses
`example.invalid`, and real-looking free-fixture VIN identities were redacted in
the exported copy. Report fixtures already use Synthetic vehicle/dealer/claim names.

### Free estimate

Current `build_preliminary_result` output from the existing
`test_strong_and_good_existing_evidence_can_support_range_without_offer` scenario:

| Field | Output |
| --- | --- |
| Vehicle context | Fictional 2022 Synthetic Sedan Touring, 50,000 miles, ZIP 63123 |
| Result | `ESTIMATE`, three distinct fixture vehicles |
| Estimated advertised-price range | $20,000–$20,400 |
| Evidence | Current-market observations; no insurer offer supplied |
| Insurer comparison | `null` |

Current UI includes: “Not a loss-date valuation.” and “Asking prices aren’t
guaranteed sale prices or settlement amounts.” This is the actual calculation
output plus exact source copy, not a screenshot of a hosted case.
[Full output](missouri-existing-service-examples/free-result.json). [S03]

### Paid report, market section and personalized conclusion

Open the actual two-page [supported review PDF](missouri-existing-service-examples/supported-review.pdf).
It uses the current template 4 renderer and existing
`tests/test_valuation_evidence_report.py::ValuationEvidenceReportTests._report`.
The fixture uses an existing compatible frozen report-source contract; it does
**not** simulate today's full-review upload, payment, model quality review or release.

| Report field | Actual rendered fixture output |
| --- | --- |
| Report title / author | Vehicle Valuation Review / Venfour |
| Subject | 2024 Synthetic Sedan SEL, 50,000 miles; loss May 19, 2026 |
| Reviewed insurer valuation | $20,000 |
| Five primary advertised prices | $21,800; $22,000; $22,200; $22,400; $22,600 |
| Range / median | $21,800–$22,600 / $22,200 |
| Comparison | $2,200 (11.00%) above insurer valuation; “not a settlement determination” |
| Geography | Recorded historical search: 100 miles around ZIP 63026; current-market search: 250 miles around ZIP 63026 |
| Listing attributes | 50,000–52,000 miles, approximate distances 6–10 miles, distinct synthetic VINs, fictional dealer/location and listing URLs |
| Source separation | Five primary historical vehicles; later observations of the same vehicles separately disclosed; three insurer comparables/adjustments reproduced |
| Classification | `MATERIAL_UNDERVALUE_SIGNAL`, `SUPPORTS_CONTINUATION`, `pointAcvDetermined=false` in JSON |

Exact rendered request:

> Please reconsider the vehicle valuation in light of the documented comparable listings. If a different valuation is maintained, please explain the material differences or adjustments supporting it.

Exact scope statement:

> No independent dollar adjustments have been made for mileage, condition, equipment, location, certification or warranty. No physical inspection was performed. This is an evidence review, not an independent appraisal or a determination of the settlement owed.

The PDF also states that source page-specific citations were not retained in this
fixture. It does not invent them. [Report JSON](missouri-existing-service-examples/supported-review.json),
[extracted PDF text](missouri-existing-service-examples/supported-review.txt). [S05–S08]

### Initial customer request

The current source is `initial-reconsideration-v3`, retained verbatim in
[initial-request-template.json](missouri-existing-service-examples/initial-request-template.json).
The production initial-message generator is a database function; it was not invoked.
The following is its exact template text with explicit substitution placeholders,
not a claim that a saved communication was created:

> Subject: Vehicle valuation review — Claim %s
>
> Hi %s,
>
> Thank you for your help with my claim.
>
> After reviewing the %s valuation for my %s, I’m respectfully requesting that the vehicle value be reconsidered based on the attached valuation review and supporting market evidence.
>
> Could you please take another look and let me know whether the valuation can be revised? If the valuation changes, please send me the updated valuation report. If you arrive at a different value, I’d appreciate a brief explanation of the difference.
>
> Thank you for your time and consideration.
>
> Best,

The generator substitutes confirmed claim/name, reviewed minor-unit amount and
verified vehicle display; applicable findings are inserted before the review request.
One exact conditional finding is: “The current valuation is below the median advertised
price of the comparable vehicles identified in the attached review.” Missing facts
use the template's explicit fallback forms. The customer can edit the message. [S11]

### Insurer-response analysis, recommendation and follow-up

[Response and follow-up JSON](missouri-existing-service-examples/response-and-follow-up.json)
contains the existing response-analysis **test double**, followed by the current
deterministic recommendation and follow-up builders. It does not claim a live model
produced the analysis. The fixture exposes summary, revised-offer, response/case
evidence references and uncertainty fields for inspection. A response can receive
`NO_CLEAR_RECOMMENDATION`; a new offer is not automatically endorsed merely because
it falls within advertised prices. The fixture recommendation is “Venfour has no clear recommendation yet,” with
reason “The response analysis leaves uncertainty or incomplete response material
that prevents a reliable recommendation.” Its canned analysis summary includes
“The response changes part of the offer but leaves the comparable issue unresolved”;
that is test-double text, not an independent finding about the simulated response.
The customer has explicitly chosen to continue in the follow-up fixture.
The contract includes `ACCEPT_OFFER`, but the
current policy does not infer an acceptance target from that range. [S12]

Actual current follow-up builder output, after fixture contact replacement:

> Hello Fictional Adjuster,
>
> Thank you for reviewing my request for claim CLAIM-782.
>
> You noted: “We are maintaining the comparable selection.” I have recorded $20,000.00 as the vehicle valuation amount. Could you please confirm that amount?
>
> The report includes a 2024 Synthetic Sedan listing advertised at $21,800.00. I understand this is an asking price. Could you please explain how this listing was considered, including any relevant differences from my vehicle?
>
> I've attached the report again for convenience. Could you please reconsider the valuation in light of this evidence and reply with any updated valuation? If it remains unchanged, a brief explanation would help me understand.
>
> Thank you for your time and help,
> Fictional Customer

The sentence saying the report is attached is drafted text: the customer must actually
attach it. `mailto:` does not attach the PDF. [S10, S13]

### No-support result and refund copy

The two-page [no-support review PDF](missouri-existing-service-examples/no-support-review.pdf)
uses the existing `CONSISTENT_PRICES` fixture: $19,500–$20,500 range, $20,000 median
and $20,000 insurer vehicle value. The deterministic classification is
`NO_MATERIAL_DISCREPANCY`, continuation is `DOES_NOT_SUPPORT_CONTINUATION`, and
`pointAcvDetermined=false`. It renders:

> No specific increase is supported by this review. Additional verified evidence may be needed before requesting a revised value.

The completed app result says: “The similar vehicles we found do not give us a clear
reason to ask your insurance company for a higher value.” The older/free discrepancy
presentation also contains “Your insurer’s valuation appears fair.” These are distinct
wording strengths to review, not proof of correct settlement. [S03, S07]

Actual customer refund-status copy:

> Your refund is in progress. Your completed report remains available while it is processed.
>
> Your payment was refunded. Your completed report remains available.

No refund was performed to create these examples. [S14]

## 5. Customer-facing claims inventory and search coverage

All 1,588 files tracked at the baseline were enumerated, including tracked files
hidden by routine search exclusions. Searches covered all 1,316 UTF-8 text files;
20 PDFs were text-extracted; two gzip geography files were decompressed; other
binary files were searched for printable strings. This includes source, tests,
schemas, migrations, documentation, historical outputs and preview artifacts.
All requested terms are recorded individually in the coverage companion, including
zero-result terms. Matches include identifiers and do not establish customer exposure.

**Search limit:** 249 image files were not exhaustively OCR-searched. A local Vision
OCR attempt stopped because the Xcode license was not accepted; no license or system
configuration was changed. The database dump was not restored. No archived private
contents were copied into this packet. Accordingly this is a complete tracked-file
search inventory, not a guarantee of exhaustive visual text extraction from every
historical screenshot. Current rendered PDFs were separately inspected page by page.

The JSON inventory preserves source literals (TypeScript/JSX whitespace joined),
path and line/JSON locator. It includes conditional/error strings and legacy report
branches, explicitly labeled; these are not all current rendered customer claims.
The selected table appended below identifies the main review-relevant statements.
No customer copy was rewritten. Exact source spelling and wording are retained.

| ID | Exact wording | Surface | Source |
| --- | --- | --- | --- |
| C01 | Understand your total-loss valuation, see how it compares with the market, and know what to discuss with your adjuster. | public website | `frontend/src/pages/home-page.tsx:96` |
| C02 | No. You can upload your insurer’s valuation report or enter your vehicle and claim details yourself. A report lets us also review its specific comparisons and adjustments. | public website | `frontend/src/pages/home-page.tsx:46` |
| C03 | When an insurer valuation or stated offer is available, Venfour compares it with selected external advertised-price evidence and summarizes the observed range and central value. Without one, the market evidence stands on its own. | public website | `frontend/src/pages/methodology-page.tsx:42` |
| C04 | Venfour is a self-service valuation advisor that helps vehicle owners review the evidence and ask informed questions about their insurance claim. | public website | `frontend/src/pages/public-resources.tsx:38` |
| C05 | You remain in control of what you send and discuss with your insurer. Venfour helps you understand the evidence; it does not negotiate on your behalf, determine what you are legally owed, or guarantee a higher payment. | public website | `frontend/src/pages/public-resources.tsx:54` |
| C06 | Depending on your situation, you may also need an independent appraisal or legal advice. | public website | `frontend/src/pages/public-resources.tsx:55` |
| C07 | Venfour is not an insurer, law firm, or government agency. Current results and review requests are not legal advice, a determination of legal entitlement, or a substitute for a formal appraisal when one is required. | Terms | `frontend/src/pages/terms-page.tsx:42` |
| C08 | Your insurer may be undervaluing your vehicle. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx:61` |
| C09 | Your insurer’s valuation appears fair. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx:79` |
| C10 | Not a loss-date valuation. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx:195` |
| C11 | Asking prices aren’t guaranteed sale prices or settlement amounts. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx:196` |
| C12 | We couldn’t find enough reliable market evidence to assess your insurer’s valuation. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx:98` |
| C13 | This comparison is not an independent vehicle appraisal. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:153` |
| C14 | Your insurer’s value may be low | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:275` |
| C15 | We didn’t find enough market information to support asking for a higher value. This does not mean your insurer’s value is correct. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:284` |
| C16 | These asking prices support a conversation with your insurer. They do not guarantee a higher payment. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:445` |
| C17 | This review does not establish that you are owed a higher payment. Your insurer may have additional information. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:445` |
| C18 | Your payment was refunded. Your completed report remains available. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:374` |
| C19 | Your refund is in progress. Your completed report remains available while it is processed. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:374` |
| C20 | Total-Loss Review Package | checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:76` |
| C21 | A personalized reconsideration request for you to review and send when the evidence supports it. | checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:127` |
| C22 | If our completed review does not support a valuation dispute, your purchase is refunded automatically. | checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:136` |
| C23 | If our review supports a dispute but your insurer’s final verified vehicle valuation increases by less than $1,000 after you follow the recommended process, you may request a full refund. | checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:137` |
| C24 | Payment does not guarantee a higher insurer valuation or settlement. | checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:140` |
| C25 | Save what the insurer sent. Venfour will review it against the request and evidence in this case. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:374` |
| C26 | Choose what you want to do. Saving your choice does not contact the insurer or close your case. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:875` |
| C27 | This explanation uses the insurer response and the valuation evidence already saved in this case. It does not recalculate the vehicle’s value or change the published report. | app source (conditional; not a hosted exposure finding) | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:1170` |
| C28 | We compare the insurer’s final verified vehicle valuation, or actual cash value (ACV), with the insurer valuation associated with your case at the time of purchase. We measure only the vehicle valuation relevant to Venfour’s review, not your final settlement check or Venfour’s initial estimate of a possible increase. | refund policy | `frontend/src/pages/refund-policy-page.tsx:56` |
| C29 | A $0 increase qualifies. An increase of exactly $1,000 does not. Deductibles, loan payoff, injury payments, rental reimbursement, storage charges, unrelated coverage, and other unrelated settlement amounts are excluded from the comparison. | refund policy | `frontend/src/pages/refund-policy-page.tsx:73` |
| C30 | You do not need to submit a reconsideration request, obtain a final insurer response, or request this refund. The requirements and 30-day deadline for manual requests below do not apply to this path. | refund policy | `frontend/src/pages/refund-policy-page.tsx:32` |
| C31 | A higher insurer valuation or settlement is not guaranteed. Venfour does not negotiate directly with your insurer. You remain responsible for reviewing and sending the reconsideration request and evidence and for communicating with your insurer. | refund policy | `frontend/src/pages/refund-policy-page.tsx:138` |
| C32 | A Venfour total-loss result is an evidence review, not a guaranteed settlement amount. An observed difference does not establish that an insurer owes a particular additional amount, acted improperly, or must change its valuation. Any previously submitted diminished-value request is a request for manual review, not a completed valuation result. | Terms | `frontend/src/pages/terms-page.tsx:51` |
| C33 | If you allow optional operational follow-up, Venfour may contact you about your case or service follow-up. That choice is separate from service-critical communication needed to provide something you request, and this notice does not treat it as SMS consent. Venfour does not collect a phone number through the current Total Loss profile flow. | Privacy | `frontend/src/pages/privacy-page.tsx:69` |
| C34 | An invitation-only referral program for businesses that help vehicle owners after a total loss, beginning in Missouri. | partner public page | `frontend/src/pages/referral-partners-page.tsx:16` |
| C35 | Your partner agreement provides the terms for earning a commission when a customer you refer completes a qualifying purchase. It specifies the commission amount, eligibility, and adjustments for refunds. | partner public page | `frontend/src/pages/referral-partners-page.tsx:36` |
| C36 | Your request is prepared in Venfour. Review it, attach the supporting report, and send it from your own email account when you are ready. | email template | `venfour/email_templates.py:210` |
| C37 | If you have already sent it, record that in your case to keep your progress up to date. Venfour has not sent it for you. | email template | `venfour/email_templates.py:211` |
| C38 | Your case is waiting for an insurer response. If you have received one, add it to Venfour so you can review it alongside your existing evidence. | email template | `venfour/email_templates.py:221` |
| C39 | Venfour recommends continuing to challenge this offer. | app response coaching | `venfour/insurer_response_recommendation.py:51` |
| C40 | Venfour has no clear recommendation yet. | app response coaching | `venfour/insurer_response_recommendation.py:52` |
| C41 | No independent dollar adjustments have been made for mileage, condition, equipment, location, certification or warranty. No physical inspection was performed. This is an evidence review, not an independent appraisal or a determination of the settlement owed. | report | `venfour/valuation_review.py:474` |
| C42 | After reviewing the %s valuation for my %s, I’m respectfully requesting that the vehicle value be reconsidered based on the attached valuation review and supporting market evidence. | email/message template | `templates/total-loss-reconsideration-email.json:/request` |
| C43 | Before or when recommending Venfour, Partner must clearly tell the customer: "If your case qualifies, Venfour may pay our business a $50 or $75 referral commission. This does not increase your Venfour fee. You are free to choose whether to use Venfour."<br><br>The disclosure must be easy to notice and understand where the recommendation is made, including in person, online, and in messages. A hidden link or general disclosure elsewhere is not enough. Partner may use only accurate, current marketing material approved by Venfour and must stop using material Venfour reasonably identifies as inaccurate or unlawful.<br><br>Partner must not create fraudulent or self-generated referrals, purchase services for the purpose of earning a commission, impersonate customers, conceal a financial relationship, make unauthorized promises, or influence valuation inputs, evidence selection, or conclusions. Legitimate corrections to inaccurate information remain welcome. No minimum referral volume or exclusive commitment is required. | held draft partner agreement | `venfour/data/referral_partner_agreement_draft.json:/sections/2/body` |
| C44 | You reported sending the message. Venfour cannot verify email delivery or receipt. | app: sent confirmation | `frontend/src/features/total-loss-claim/components/message-preparation.tsx:50` |
| C45 | Earn on qualifying purchases | partner public page | `frontend/src/pages/referral-partners-page.tsx:34` |
| C46 | Negotiation, demand, and action guidance are not included. | internal assessment limitation also carried in saved report contracts | `venfour/presentation.py:344` |

Internal-only matches include API/domain `appraisal` identifiers, saved assessment
limitations, model review instructions, research/licensing-source records, tests
and historical output. Those matches do not establish a current customer service.
“Certified” also describes listing certification, not Venfour personnel. “Expert,”
“licensed,” “umpire” and formal-appraisal model roles are not evidence of current
credentials or appointments. Historical screenshots/PDFs remain historical.


## 6. Policy and disclosure inventory

| Document/surface | Current source and content | When shown and recorded |
| --- | --- | --- |
| Terms of Use | `frontend/src/pages/terms-page.tsx`; displayed update September 15, 2026. Automated review scope, no entitlement/settlement guarantee, report/no-report distinction, customer communications responsibility, automatic and manual refunds | Public `/terms`, profile/contact links and acknowledgments. Contact/profile store version string + timestamp, not a signature on retained exact current webpage bytes |
| Privacy Policy | `frontend/src/pages/privacy-page.tsx`; displayed update September 7, 2026. Intake/identity, source documents, model extraction, market providers, private storage/retention, staff and partner access | Public `/privacy`; required acknowledgment at contact/profile. Optional operational follow-up choice recorded separately |
| Refund policy | `frontend/src/pages/refund-policy-page.tsx`; effective September 15, 2026. Two refund branches; excludes exactly $1,000 from manual guarantee; 30-day request from final written response | Public `/refund-policy`, checkout link, support/contact flow. No separate refund-policy checkbox found in checkout component |
| Checkout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx`; “Total-Loss Review Package,” price from server quote, one-time/no subscription, two refund summaries, no guarantee | Shown before embedded payment. Order freezes configured `product_version`, `terms_version`, `refund_policy_version`; these config strings do not prove acceptance of a document digest |
| Scope disclosures | `frontend/src/pages/methodology-page.tsx`; `public-resources.tsx`; free/completed result components; report renderer | Public, app and PDF statements distinguish advertised prices, no independent appraisal/inspection and customer self-submission. No distinct existing signed scope-of-service instrument found |
| No direct negotiation | Refund policy says “Venfour does not negotiate directly with your insurer.” About/resource copy says it “does not negotiate on your behalf” | Public disclosures. No current dedicated “not a public adjuster” acknowledgment was identified; these disclaimers are not assumed to decide licensing |
| Partner agreement | `venfour/data/referral_partner_agreement_draft.json`, proposal revision `2026-09-16.1`, status `draft`, `release_hold=true`; mirror in `20260916000300_referral_partner_agreement_proposal.sql` | Supplied proposal not publishable/active while held. Actual active signed versions are database records and UNKNOWN here. Onboarding architecture records authenticated verified account/email, typed signer/title, consent, exact snapshot/digest, server time, countersignature/activation and retained PDF |
| Customer acknowledgment labels | `frontend/src/features/customer-profile/types.ts`: both current constants `2026-08-23`; `identity-service.ts` passes them with contact details; profile service does likewise | Required Terms acceptance + Privacy acknowledgment validated; names/email and optional phone stored with case; profile acknowledgments are current-row records, not proof the September documents were accepted |
| Future exact document attestations | `schemas/jurisdiction/authority-attestation-v1.schema.json`; current authority engineering design | Separate exact type/version/digest attestation/acknowledgment infrastructure. Empty authority defaults and no wiring of this packet; legacy acknowledgment labels cannot satisfy this stronger contract by assertion |

The full Terms, Privacy and refund source paths are exact versioned-content references.
The copy companion extracts their relevant paragraphs, including exclusions and data-use
statements. It also contains the entire held agreement's substantive sections. [S15, S16, S18]

## 7. Price, refunds and referral economics

| Item | Current implementation and important distinctions | Canonical evidence |
| --- | --- | --- |
| Customer price | Live launch price 19,900 minor units, USD; frontend formats authoritative quote. No subscription or separate coaching fee found. Non-live test configuration is not a new price | `venfour/commerce.py::TOTAL_LOSS_LAUNCH_AMOUNT_MINOR_UNITS`, `StripeCommerceConfiguration`, `_validate_price`; checkout component |
| Automatic no-support refund | After final no-continuation result and valid release conditions, publish explanatory report, orchestrate full refund and retain access. Pending/failure/recovery states do not assert refund succeeded. Customer need not send reconsideration or wait for final insurer response | `report_release_gate.py::AUTO_RELEASE_NO_DISPUTE_REFUND`; `report_processing.py::_finish_no_dispute_refund_impl`; `commerce.py::refund`; release SQL |
| Manual final-outcome refund | Supported dispute; customer follows recommended process; final verified vehicle-value increase **less than $1,000**; requests within 30 days of receiving final written response, with supporting documents. Full refund to original method after review | Refund/Terms pages; `contact-page.tsx` topic `fair-result-refund`; backend generic refund/accounting service |
| Measurement | Baseline insurer vehicle valuation at purchase vs final verified vehicle value/ACV, not net check, preliminary estimate, deductible, payoff, injury, rental/storage or unrelated settlement amounts | Refund policy “What counts as an increase”; held agreement section 6 |
| Exactly $1,000 | Published manual refund policy explicitly excludes it. New commission policy also excludes it, requiring **strictly greater**. It falls into neither manual outcome refund nor new commission success. Intent of this gap remains unresolved; no boundary changed | Refund policy; `partner_commissions.py::validate_success`; held agreement section 5 |
| $50 / $75 | Successful cases 1–9 verified in a partner's America/Chicago calendar month: $50 each; case 10 onward $75 each, not retroactive. Fifteen successful cases = $900. Count by verification month, not click/purchase/payout month | `partner_commissions.py::append_success`, `POLICY_ID`; earnings SQL; agreement sections 7–8 |
| Success | Pre-purchase attribution, qualifying paid service/process, reliable baseline/final insurer evidence, customer acceptance, verified consistent vehicle-value components, >$1,000 gain, no unresolved relevant dispute or refund rights; regulated partner approval if applicable | `VerifiedOutcome`, `validate_success`; `partner_outcomes.py`; outcome review SQL |
| Timing | Payment eligibility no earlier than both outcome verification and 30 days after customer payment. Payout target following eligibility month on 15th, moved to next eligible business day; calendar input matters. Ledger supports waiting/ready/held/paid/reversed/recovery-review | `partner_commissions.py`, `partner_earnings.py`; held agreement. Accounting “paid” requires external payment reference; module does not transfer funds |
| Refund/dispute effect | Policy refund/reversal/chargeback or refund rights prevents commission or triggers recovery review after payment; unresolved status holds it. Narrow confirmed goodwill-only exception may preserve already-established success; not initial success from a refunded purchase | `partner_commissions.py::payment_disposition`; SQL payment hold and ledger guards |
| Activation | Qualifying published, unheld exact policy, countersigned current agreement and active partner required. Supplied proposal stays draft/held. Purchases are tracked conversions, not by themselves earned commissions | `referral_earnings_enabled_internal`; immutable referral attribution/conversion migrations |

No deployed active agreement or payout history was queried. The public invitation
page's “qualifying purchase” wording and the held successful-outcome model must not
be silently treated as equivalent. Automatic no-support refund rights are not
conditioned on success, partner compensation or a manual request window. [S14–S16]

## 8. Entity, authorship and personnel

| Question | Source-grounded answer |
| --- | --- |
| Operating legal entity | The held referral agreement names **Venfour LLC**. This is a representation in a draft, not verified incorporation, good standing, ownership, licensure or proof of the actual contracting entity for current customers. Those facts are UNKNOWN |
| Report identity | PDF displays VENFOUR and metadata `author="Venfour"`; current title Vehicle Valuation Review, report reference/version/date |
| Named human appraiser / license number | None found in the current generated report or fulfillment contract. Actual personnel credentials UNKNOWN |
| Human report signature | No human signature block or appraiser signature in current renderer. Partner signatures are contract signatures, not signatures on vehicle reports |
| Who authors conclusions | Deterministic Python computes value comparisons/classification and projects templated report language. Model services extract documents, perform structured quality review and interpret insurer responses; they do not replace the deterministic valuation calculations |
| Staff role | Authorized staff can review/release/hold packages and resolve exceptions; partner managers separately verify outcomes/agreements. Authorization as staff is not proof of insurance/appraiser credentials |
| Third-party licensed fulfillment provider | No active licensed appraiser/adjuster assignment and fulfillment relationship established by inspected source. Data/extraction/payment vendors are not thereby licensed service providers. Actual relationship UNKNOWN |
| Modeled provider assignment | Foundation facts include `provider_role` and `assigned_credential_ref`; authority attestations bind credential holder/provider/jurisdiction/capabilities and documents. These model fields are not evidence of an assigned, verified person in today's case |

No personal credentials or identities have been added to fill those gaps. [S06–S08, S16, S18]

## 9. Customer–insurer communication boundary

1. `CustomerDeliveryService.save_sending_details` stores customer-confirmed claim
   reference and adjuster email. Draft edit/prepare methods validate ownership,
   recipient syntax, revision and saved report identity. They do not invoke email transport.
2. `frontend/src/features/total-loss-claim/use-request-draft.ts` prepares the version,
   then uses `browser-actions.ts::openDefaultEmailApp` (`window.location.assign` with
   a `mailto:` URL) or `copyPreparedEmail` (clipboard). Customer must attach the
   downloaded private report. No programmatic PDF email attachment is sent here.
3. `CustomerDeliveryService.opened` requires `authoritativeSent=false` in the recorded
   open response. Opening a compose window does not mark actual insurer delivery.
4. `CustomerDeliveryService.sent` requires `confirmedReportAttached=true`, exact
   prepared version, idempotency request and workflow revision. Database confirmation
   returns `customerReportedSentAt`, `communicationId`, `negotiationRoundId` and
   `awaiting_insurer_response`. UI: “You reported sending the message. Venfour cannot
   verify email delivery or receipt.” This is an assertion by the customer, not
   transport evidence.
5. Replies enter only through customer paste/upload/revised-offer entry and saved
   response processing. The inspected email webhook handles outbound provider delivery
   telemetry, not an insurer correspondence inbox. Follow-ups repeat customer handoff.
6. `venfour/communications.py` does send other kinds of email when configured:
   account verification/recovery, preview/report-ready notices and opted-in case
   reminders. `partner_delivery.py` sends invitations and completed agreements.
   The staff test-send method targets the authenticated staff email and allowlist;
   it is not an arbitrary-adjuster correspondence composer. No implemented staff
   insurer calling/chat/send action was found. Calls or communications outside this
   software are UNKNOWN and require an owner statement.

“Negotiation round,” “outbound communication” and “sent” are internal workflow
names. They preserve the customer's message history and do not establish that
Venfour sent it or represented the customer. Conversely, customer self-submission
does not answer whether drafting/coaching is a regulated activity; that is a reviewer
question. [S10–S13, S19]

## 10. Data/document flow

| Flow | Processing, external service and retained boundary |
| --- | --- |
| Customer → Venfour | Browser intake, optional VIN decoding through NHTSA, authenticated/anonymous case ownership; facts and acknowledgment versions in Supabase |
| Customer insurer PDF → private case file | Supabase private case-file storage and ownership/RLS; canonical PDF checks and server-owned storage locator; ordered supported intake images may be converted |
| PDF → extraction/model | `report_ingestion.py` / extraction adapter uses OpenAI structured extraction; normalizes document facts for deterministic validation and confirmation. Temporary server copy removed; provider file deletion requested; original private case file retained |
| Vehicle/search facts → market data | MarketCheck active/historical adapters and provider-neutral interfaces; vehicle/configuration/ZIP/radius/date queries; budget/cache/transcripts. No legal authority derived from search geography |
| Extracted facts + retained market evidence → analysis | Python qualification/ranking/history checks and deterministic range/classification; immutable snapshots/digests. Full review requalifies frozen observations, preserving original free result |
| Payment → Stripe → financial records | Stripe embedded checkout/provider calls in actual configured service; signed webhook/reconciliation → Supabase financial/order/entitlement records. Delivery authorization remains separate |
| Frozen evidence → report → quality review | Report JSON/PDF rendered in Python; configured OpenAI quality review receives bounded frozen evidence and documents as applicable; release gate validates results and qualified configuration. Staff exception path |
| Report → customer → insurer | Private authorized download to customer; customer attaches to their own email/client or sends independently. That outbound communication occurs outside Venfour's mail transport |
| Insurer → customer → Venfour | Customer submits response text/document/amount; private response original retained; bounded OpenAI response analysis plus deterministic validation/recommendation |
| Venfour → customer follow-up | Draft grounded in saved report/response/decision; customer edits/attaches/sends; versions and customer-reported send history retained |
| Operational email | Resend configured provider; Mailpit local alternative; disabled/dry-run/allowlist/live modes. Account notices, customer workflow reminders and partner agreement delivery—not insurer negotiation. Actual hosted mode UNKNOWN |

No secrets, API keys, private storage download URLs or real customer documents are
included. A list of vendors is not proof of executed processing in this task, retention
compliance, a processor agreement or credential status. Model/data endpoints and
configured model identifiers should be supplied by the owner for legal review if
needed; no secret environment files were opened. [S02–S04, S08–S10, S12, S19]

## 11. Contradictions and owner questions, left unresolved

| Finding | Why reviewer/owner attention is needed |
| --- | --- |
| New paid review requires a report; broader no-report marketing/Terms remain | Homepage says “No” to needing an insurance report; current `full_review_readiness` and checkout require complete insurer report/strict readiness. Free start and historical no-report contracts must be distinguished from a new paid no-report service |
| Public policy dates vs acknowledgment labels | September 15 Terms/refund and September 7 Privacy coexist with August 23 Terms/Privacy acknowledgment constants. Frozen order config versions are runtime UNKNOWN; no exact-byte acceptance was assumed |
| Purchase referral wording vs success-based held policy | Public “Earn on qualifying purchases” and qualifying-purchase prose can suggest purchase alone earns compensation. New policy requires accepted verified >$1,000 outcome and other conditions; actual signed active terms UNKNOWN |
| Exactly $1,000 gap | Neither manual refund eligibility nor new commission success includes exactly $1,000. It is an explicit code/copy boundary but unresolved business-policy intent; not repaired here |
| “Appears fair” vs narrower no-support report language | A fair-value headline can imply more than absence of sufficient evidence to request a higher amount. Report/completed-result limitations are more specific; reviewer should assess the combined impression |
| Retained analysis limitation vs later package guidance | The saved assessment can carry “Negotiation, demand, and action guidance are not included.” That describes the analysis contract, while later paid drafting/coaching exists. Review the scope and any display of that statement; no direct insurer negotiation is inferred |
| Personalized conclusion vs appraisal disclaimer | Product computes case-specific ranges/gap classifications and includes reconsideration text; “not an appraisal” does not establish regulatory treatment of those activities |
| Privacy phone statement | Privacy says no phone through current Total Loss profile flow; separate current case-contact intake collects optional phone and submits it. Narrow profile wording may be literally scoped yet incomplete for the overall journey |
| Historical/internal appraisal terminology | API `/appraisal-cases`, domain identifiers, fixtures and old artifacts use appraisal names; this is not current formal appointment functionality. Current customer-facing wording must be distinguished from those matches |
| Source packet vs hosted footprint | New jurisdiction defaults are off/shadow and no approved registry entries exist. Existing service exposure is unreviewed; the packet does not approve it or change it. Hosted flag/route state remains UNKNOWN |
| Entity/personnel/credentials | Draft names Venfour LLC, but registration, licenses, any off-platform insurer communications, actual staff qualifications and current licensed provider contracts require owner evidence |
| Policy administration | Manual refund evidence review, timeliness, actual acknowledgment versions, holiday calendars and approved active referral terms require operational confirmation. No live refunds, payouts or case records were examined |
| Screenshot extraction limit | Whole tracked-file metadata/search coverage is supplied, but historical image-only text is not exhaustively OCR-verified. Do not treat no source-text match as proof a screenshot never contained a claim |

Privacy's no-self-service-deletion statement was not treated as contradicted merely
by case closure: current closure preserves history; a closed case is not deleted.
No legal conclusion has been inferred from any disclaimer, research status, source
absence or business-policy threshold.

## 12. Blank reviewer decision worksheet

Use one independent record per capability **and per distinct factual scope**. The
ten blank records in the companion intentionally include the three unimplemented
capabilities so the reviewer can address them without describing them as current.
The runtime publication schema currently allows seven capability values and excludes
direct negotiation, formal appraisal and umpire/expert services. This worksheet
does not alter that exclusion.

Every cell below is unanswered for every record; `null` in the companion means
**unanswered**, never “not required.” No jurisdiction, party type, provider role or
effective date has been preselected as applicable law.

| Reviewer field | Blank entry | Runtime mapping / constraint |
| --- | --- | --- |
| Determination | __________ | `determination`: permitted / limited / prohibited / not_applicable / unresolved; no selection |
| Jurisdiction(s) | __________ | `jurisdictions`; initial review target Missouri is not a scope conclusion |
| Claim type / first or third party | __________ | `claim_type`: first_party / third_party; record each separately where needed |
| Personal/commercial | __________ | `policy_use` |
| Provider role | __________ | `provider_role`: valuation_service / licensed_adjuster / appraiser / umpire / expert / referral_partner |
| Required facts | __________ | `required_facts`; residence, garaging, registration, policy issue/delivery, loss/provider location, relevant dates, claim/policy/provider facts and assigned credential reference |
| Typed limitations | __________ | `conditions`: `{field, equals}`. Runtime free-text `limitations` cannot carry enforcement; no arbitrary legal prose promoted to an executable condition |
| Credential policy/requirements | __________ | `credential_policy`; `credentials`: `{id,type,jurisdiction,holder,provider}`; company/individual license, entity registration or provider relationship |
| Document/disclosure policy | __________ | `terms_policy`; `documents`: `{type,version,digest}` for terms/privacy/refund/scope/jurisdiction disclosure |
| Effective-date anchor | __________ | `date_anchor`: service_date / loss_date / policy_start / policy_end / settlement_date |
| Effective from / until | __________ / __________ | `effective_from`, `effective_until`; runtime interval end is exclusive |
| Review deadline | __________ | `review_due_at`, UTC timestamp |
| Revocation conditions | __________ | Worksheet notes separate from actual `revocation:{at,by,reference}`; no reviewer identity or revocation event created |
| Primary source URL | __________ | `sources[].url`; primary HTTPS source required for a future authority rule |
| Precise locator | __________ | `sources[].locator` |
| Retained evidence reference / digest | __________ / __________ | `sources[].retained_evidence`, `document_digest`; no evidence or legal citations invented |
| Reviewer notes | __________ | Intake notes only, not runtime permission |

The worksheet has separate records for `case_specific_preview`,
`market_evidence_report`, `personalized_valuation`, `customer_reconsideration_draft`,
`insurer_response_coaching`, `insurer_contact_negotiation`, `formal_appraisal_clause`,
`umpire_expert_role`, `referral_marketing`, and `referral_compensation`.
Future authority compilation also requires authorized independent reviews, exact
revision/previous digest and separately controlled publication. None are created here.

## 13. Verification and scope of this delivery

- Source statements were traced through frontend, Python, templates and applicable
  database functions, with source commit and hashes retained in the coverage file.
- Only this documentation bundle and fictional output examples were created.
  No existing tracked product, copy, policy, authority, migration or configuration file changed.
- Both fictional PDFs were generated by the current renderer, passed its PDF
  validation, and all four pages were visually inspected for clipping/readability.
- Generation cleared inherited configuration/credentials and used the repository's
  offline guard: three deliberate probes blocked before network activity; zero
  unexpected networking attempts. Only existing fixture providers and analysis test
  doubles were used. No user/customer records were read or included.
- Registry remains `phase-1-empty`, with empty rules/interpretations. Reviewer
  manifest remains revision 0 with no reviewers, attestation writers or publishers.
  Mode remains default `off`, permitting only `off`/`shadow`; nothing was activated.
- No authority compilation/signing/publication command, signing-key generation,
  hosted access/migration, deployment, live payment, paid provider call or email send
  occurred. Offline report file generation is not customer report publication.
- Local file/hash/link checks and `git diff --check` are recorded in the examples
  README. No whole-product build or deployment readiness claim is made.

Zero jurisdictions approved; zero reviewer identities added; zero keys generated;
zero authority publications; no enforcement, production deployment, hosted migration,
live payment, paid provider call or email; no product behavior, customer copy or
economic terms changed. The next step is external review and owner completion of
missing business/operational evidence, not an automatic jurisdiction enablement.

## Appendix: source references

Paths are relative to this repository at the baseline commit. Stable symbols are
provided where line numbers would be fragile. Supporting research/engineering
documents were read first; current code prevails where descriptions differ.

| ID | Exact source paths and stable symbols |
| --- | --- |
| S01 | `frontend/src/app/router.tsx`; `frontend/src/app/site-boundary.ts`; `frontend/src/config/public-site.ts`; `frontend/src/pages/home-page.tsx::PublicHomePage`; `methodology-page.tsx`; `public-resources.tsx`; `referral-partners-page.tsx` in the same pages directory |
| S02 | `frontend/src/features/total-loss/intake-steps.tsx`, `validation.ts::validateTotalLossContactForm`, `identity-service.ts`, `data-types.ts`; `frontend/src/pages/total-loss-start-page.tsx`; `venfour/subject_readiness.py`; `venfour/report_ingestion.py`; `frontend/src/features/customer-profile/types.ts` |
| S03 | `venfour/efficient_search.py`; `market_request_budget.py`; `marketcheck.py`; `historical_market.py`; `comparable_evidence.py`; `comparables.py::rank_market_comparables`; `discrepancy.py::ValuationDiscrepancyPolicy` and `_expected_result_classification`; `preliminary_result.py::build_preliminary_result`; `presentation.py`; `analysis_runs.py` (all under `venfour/`); `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx` |
| S04 | `venfour/full_review.py::full_review_readiness`; `full_review_payment.py`; `full_review_calculation.py::calculate_report_review`; `full_review_package.py::attach_full_review` and `review_source_view`; `supabase/migrations/20260911000300_total_loss_full_review_readiness.sql` and `supabase/migrations/20260914000500_full_review_payment_gate.sql::total_loss_full_review_ready`; `frontend/src/features/full-review/` |
| S05 | `venfour/package_assessment.py::build_final_valuation_assessment_v1`; `venfour/package_processing.py::DeterministicPackageAssessmentBuilder`; `venfour/discrepancy.py`; `venfour/valuation_evidence_report.py::_project_report_data` |
| S06 | `venfour/valuation_evidence_report.py::build_valuation_evidence_report_v1`, `render_valuation_evidence_report_pdf_v1`, `validate_valuation_evidence_report_pdf_v1`; `venfour/valuation_review.py::build_story`, `reason_points`, `NumberedCanvas`; `tests/test_valuation_evidence_report.py::ValuationEvidenceReportTests._report` |
| S07 | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx`; `venfour/valuation_review.py::build_story`; `venfour/valuation_evidence_report.py::_conclusion_summary` |
| S08 | `venfour/report_processing.py`; `venfour/report_review.py::ReportReviewConfiguration`; `venfour/report_release_gate.py`; `venfour/staff_release.py`; `supabase/migrations/20260826000300_total_loss_report_release.sql` |
| S09 | `venfour/commerce.py::quote`, `create_checkout`, `handle_webhook`, `refund`; `venfour/supabase_gateway.py::full_review_ready`; `frontend/src/features/total-loss-claim/components/checkout-experience.tsx`, `embedded-payment.tsx`; `supabase/migrations/20260826000100_total_loss_stripe_commerce.sql`; report-backed checkout wrapper in S04 |
| S10 | `venfour/customer_delivery.py::CustomerDeliveryService` (`prepare`, `opened`, `sent`, `reports`, `download`, `record_insurer_response`); `frontend/src/features/total-loss-claim/browser-actions.ts::buildTotalLossMailto`, `openDefaultEmailApp`, `copyPreparedEmail`; `use-request-draft.ts`; `components/message-preparation.tsx`; `supabase/migrations/20260829000000_total_loss_customer_delivery.sql` |
| S11 | `templates/total-loss-reconsideration-email.json`; `supabase/migrations/20260916000100_total_loss_reconsideration_template.sql`; `20260916000200_total_loss_reconsideration_generation.sql` in the same directory; `frontend/src/features/total-loss-claim/request-state.ts` |
| S12 | `venfour/insurer_response_analysis.py`; `insurer_response_processing.py`; `insurer_response_recommendation.py::build_insurer_response_recommendation_v1`; `frontend/src/features/total-loss-claim/components/insurer-response.tsx`; `insurer-response-storage-service.ts`; `supabase/migrations/20260902000600_total_loss_repeatable_response_rounds.sql`; `20260903000000_total_loss_superseded_follow_up_history.sql` |
| S13 | `venfour/insurer_response_followup.py::build_insurer_response_followup_v1`; `venfour/customer_delivery.py::generate_follow_up`, `sent`, `confirm_resolution`; `tests/test_insurer_response_followup.py::_inputs`; `frontend/src/features/total-loss-claim/resolution.ts`; `components/insurer-response.tsx` |
| S14 | `frontend/src/pages/refund-policy-page.tsx`; `terms-page.tsx`; `contact-page.tsx`; `frontend/src/config/support.ts`; `venfour/report_processing.py::_finish_no_dispute_refund_impl`, `resume_no_dispute_refund`; `venfour/commerce.py::refund`; `supabase/migrations/20260826000300_total_loss_report_release.sql::complete_total_loss_no_dispute_refund` |
| S15 | `frontend/src/pages/terms-page.tsx`, `privacy-page.tsx`, `refund-policy-page.tsx`; `frontend/src/features/customer-profile/types.ts`, `service.ts`; `frontend/src/features/customer-profile/customer-profile-gate.tsx`; `frontend/src/features/total-loss/identity-service.ts`; `supabase/migrations/20260823000000_customer_case_operations_foundation.sql`; `20260824000400_total_loss_contact_details.sql` |
| S16 | `venfour/data/referral_partner_agreement_draft.json`; `venfour/partner_commissions.py::validate_success`, `append_success`, `payment_disposition`; `venfour/partner_outcomes.py`; `venfour/partner_earnings.py::CommissionLedger`; `supabase/migrations/20260908000000_referral_partner_onboarding.sql`, `20260908000100_referral_partner_attribution.sql`, `20260916000300_referral_partner_agreement_proposal.sql`, `20260916000400_referral_partner_earnings.sql::referral_earnings_enabled_internal`, `20260916000500_referral_outcome_review.sql` |
| S17 | `docs/engineering/paid-delivery-holds.md`; `venfour/paid_delivery.py`; `venfour/commerce.py::handle_webhook`; current paid-delivery migration functions referenced by the engineering document |
| S18 | `venfour/jurisdiction.py::Capability`, `OUT_OF_SCOPE`, `CaseFacts`; `venfour/data/jurisdiction_registry.json`; `jurisdiction_reviewers.json`; `venfour/jurisdiction_authority.py::compile_authority`, `evaluate_attested`; `schemas/jurisdiction/reviewed-authority-v1.schema.json`; `authority-attestation-v1.schema.json`; `docs/engineering/jurisdiction-foundation.md`, `jurisdiction-authority.md` |
| S19 | `venfour/email_delivery.py::EmailConfiguration`, `send_prepared`; `venfour/communications.py::dispatch`, `test_send`, `auth_hook`, `webhook`; `venfour/email_templates.py`; `venfour/partner_delivery.py`; `venfour/api.py` route table |

## External reviewer questionnaire — unanswered

Please determine the following for Missouri initially, using the current service
described above, and distinguish any conclusion that depends on facts not established
by this packet. No answer is supplied here.

1. Does the CURRENT market-evidence report require any business or individual license?
2. Does the CURRENT personalized vehicle-value conclusion change that answer?
3. May Venfour describe the paid deliverable as an “appraisal”?
4. Does drafting a customer reconsideration request constitute public adjusting, claim preparation, negotiation, representation or another licensed activity?
5. Does analyzing an insurer response and generating a follow-up create a different licensing issue?
6. Does customer self-submission materially affect the analysis?
7. Does the current report structure create motor-vehicle appraiser licensing requirements?
8. Does any disclaimer currently used materially affect the scope analysis?
9. May Venfour charge $199 for each implemented capability?
10. Do the refund/guarantee terms create any insurance, claims-handling, consumer-protection or other regulatory concern?
11. Are referral payments to collision shops, dealerships, attorneys, towing businesses or other partners permitted as structured?
12. Are any required customer disclosures missing?
13. Are there requirements governing comparable geography, number of comparables, mileage/condition adjustments or other valuation methodology that Venfour must implement?
14. Must taxes, title fees, registration fees or other amounts be incorporated into the report or settlement analysis?
15. Is any specific credential, business registration, bond, appointment, physical office or licensed individual required?
16. Which of the modeled capabilities may be marked permitted, limited, prohibited, not applicable or unresolved?
17. What exact typed limitations/conditions should be encoded for each permitted/limited capability?
18. What primary legal sources support each conclusion?
19. What effective date/review deadline should be attached to the conclusion?
20. What customer Terms/disclosure versions must be required?
