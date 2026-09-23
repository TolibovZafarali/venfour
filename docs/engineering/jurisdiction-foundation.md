# Jurisdiction foundation — Phase 1

The subsequent [trusted publication and attestation foundation](jurisdiction-authority.md)
adds independently authenticated publication and current credential/document checks.
Its empty configuration grants no operating approvals.

This is a non-activating foundation. The supplied September 22, 2026 research
inventory has 51 jurisdictions, 67 sources, and **zero operating approvals**.
Neither the existing footprint nor any new jurisdiction is approved by this patch.
Unresolved scope is not a finding that a service is prohibited.

The subsequent non-activating [paid-delivery hold and operator recovery contract](paid-delivery-holds.md) implements the next code step described below. The Phase 1 inventory and approval boundaries remain unchanged.

## Current implementation inspected

The working tree, including pre-existing public-page edits, was inspected locally.
Hosted configuration, customer records, licenses, provider accounts and legal
authority were not verified. The supplied technical handoff used historical
snapshots; the following paths describe the current implementation.

| Boundary | Current authority and Phase 1 seam |
| --- | --- |
| Intake and free preview | `frontend/src/features/total-loss/service.ts` saves `total_loss_case_details`, including explicit `date_of_loss` and a market-search ZIP. `venfour/case_analyses.py:CaseAnalysisService._execute_claim` observes before constructing/executing analysis. Completed-result reads remain unchanged. |
| Strict report preparation | `venfour/full_review_processing.py:FullReviewWorkProcessor.execute` observes after a fenced claim and before extraction/calculation. Existing saved evidence and readiness remain authoritative. |
| Checkout | `venfour/commerce.py:TotalLossCommerceService.quote/create_checkout` observe after ownership, workflow and strict readiness checks, before price/provider operations. `venfour/api.py` exposes `/api/v1/appraisal-cases/{case_id}/checkout-quote` and `/checkout-sessions`. |
| Paid package queue | `venfour/package_processing.py:TotalLossPackageProcessor.execute` observes after current source lineage is checked and before snapshot/assessment creation. |
| Report generation and review | `venfour/report_processing.py:TotalLossReportProcessor` observes before report construction and review, and again in `_resolve_release` before the existing release RPC. `TotalLossWorkItemProcessor` routes database work and `/internal/v1/work-items/{work_item_id}/execute` to these processors. |
| Staff release | `venfour/staff_release.py:StaffReleaseReviewService.decide` observes before release-producing decisions. In shadow mode, an authorized staff review packet must be readable before scope context is read. Staff release membership is not jurisdiction approval authority. |
| Initial draft | `venfour/customer_delivery.py:CustomerDeliveryService.prepare` observes before `prepare_total_loss_customer_message`, which generates/version-binds the initial request in SQL. |
| Follow-up draft | `CustomerDeliveryService.generate_follow_up/prepare_follow_up` observe generation and preparation separately. Owner identity is passed into the scope-context lookup. Existing draft/history reads and sent confirmations are unchanged. |
| Insurer-response coaching | `venfour/insurer_response_processing.py:TotalLossInsurerResponseProcessor.execute` observes before analysis and completion/publication, covering direct processor and queued coordinator calls. Explicit recommendation backfill publication also observes. |
| Financial reconciliation | `TotalLossCommerceService.handle_webhook/reconcile_checkout/refund` have no jurisdiction gate. Signed event claiming, financial reconciliation, entitlement history, duplicate handling and durable enqueue remain authoritative. |
| Historical access | `CustomerDeliveryService.reports/download`, original-response access and saved communication/history reads do not require a new scope decision. Private storage and existing ownership/entitlement checks remain in place. |
| Referrals | `venfour/partner_service.py`, `partner_earnings.py` and `partner_commissions.py` retain their existing attribution, approval, outcome and accounting behavior. Referral marketing and compensation are separate decision capabilities; this patch does not activate or intercept either program. |

The adapter is in the domain services, not just browser routing. It observes
proposals only. It does **not** yet provide transactional enforcement for direct
database RPC calls, legacy stateless analysis or concurrent fact/rule changes.
`VENFOUR_ENABLE_LEGACY_ANALYSIS_API=1` can expose `/api/v1/analyses` without an
owned case. That opt-in path is an explicit activation blocker until reviewed and
covered or separately retired. Its current behavior is unchanged.

## Facts, registry and decisions

- `venfour/jurisdiction.py` owns frozen typed facts, source/research records,
  reviewed applicability, operational-rule versions and capability decisions.
- `schemas/jurisdiction/case-facts-v1.schema.json` is the optional facts contract.
  It carries assertions with field, nullable value, provenance, opaque reference
  and supplied observation time. Missing assertions are unknown; different values
  for the same field are conflicting. Location values use `US-MO`, `US-DC`, etc.
  Territories, non-US locations and invalid/unknown codes remain explicit review
  reasons. No ZIP/IP lookup or geographic priority is used.
- The facts cover residence, garaging at loss, registration, policy issue/delivery,
  policy period, loss location/date, first/third-party, personal/commercial,
  provider location/role and an assigned-credential reference. Settlement date is
  optional solely to represent a future explicitly reviewed date anchor.
- `venfour/data/jurisdiction_research_seed.json` is an unchanged copy of the
  supplied JSON. Sources and observations do not create permissions. All 51
  records and ten pending capability reviews per record are validated.
- `venfour/data/jurisdiction_registry.json` contains no interpretations or rules.
  `jurisdiction_reviewers.json` contains no authorized reviewers. Research edits,
  user facts, uploaded documents and model output cannot write these manifests
  through an application API or database permission.
- Applicability matches an explicitly reviewed **set** of candidate jurisdictions,
  one capability, claim type, policy use and provider role. Required facts must
  be known. This is a matching contract, not a choice-of-law rule. Even a
  single candidate does not establish applicable law.
- Rule versions use inclusive start/exclusive end dates and an explicit reviewed
  anchor. Source access time is never used as an effective date. Approval time,
  review deadline and revocation time are separately checked against evaluation
  time. Overlap, unresolved anchors, missing approvals, unknowns and conflicting
  facts cannot allow. Unimplemented free-text assumptions/limitations also hold.
- A rule may be unresolved, not applicable, permitted, limited or prohibited.
  “Not applicable” to a reviewed provision is not overall service permission.
  Professional negotiation, formal appraisal and umpire/expert roles remain out
  of expansion scope even in synthetic permitted-rule fixtures.
- `venfour/jurisdiction_adapter.py` combines existing eligibility with each
  capability decision, explicit requirements, trusted credential references and
  term readiness. Runtime credential/term sets are empty in Phase 1. A partner's
  credential assertion is never treated as verified provider authority.
  `existing_eligible` records the prior checks at the observation boundary, not a
  promise that remaining evidence/release checks will succeed.
- Each shadow snapshot freezes facts/provenance, fact revision/digest, candidates,
  missing/conflicting facts, rule versions, registry/research/reviewer-authority
  digest, timestamp, boundary and proposed decisions. Serialized snapshots are
  immutable; later decisions append new identities.

## Persistence and authorization

`supabase/migrations/20260922000000_jurisdiction_foundation.sql` only adds:

1. `case_jurisdiction_fact_versions`, owner-readable under RLS. The authenticated
   `append_case_jurisdiction_facts(case, expected_revision, facts)` RPC locks the
   parent case, checks exact ownership and total-loss service, validates facts,
   limits a customer submission to 64 assertions, and appends with optimistic
   revision fencing. Identical retries return the existing revision. Customer
   provenance can be customer/document, never staff. This is a collection seam;
   no new intake fields or mandatory UI requests were added.
2. `jurisdiction_decision_snapshots`, service-readable only, written through a
   service-role-only append RPC. Duplicate identity/content is idempotent;
   conflicting content is rejected. No customer can write a scope decision.
3. Validated context/reference RPCs, with optional exact-owner restriction at
   customer-facing service boundaries. `venfour/supabase_gateway.py` supplies
   the server adapter.

No existing tables, grants, RLS policies, storage buckets or RPC definitions are
replaced. New history rejects updates, and application roles have no direct
delete/write privileges. Authorized parent-case deletion still cascades under
existing case retention/cleanup rules; this patch does not invent a new retention
obligation or override a customer's existing deletion behavior. The database's
recorded actor/time are authoritative audit metadata; customer-supplied provenance
and observation timestamps remain assertions, not proof.

The source schema is available for future consumers. No frontend consumer or
generated frontend database contract was changed in this phase.

## Review and operational approval contract

There is deliberately **no runtime rule-writing endpoint**. Initial rule changes
use the existing restricted repository/release process. A research update alone
must never modify reviewer authority or approved rules. The owner must separately
designate qualified review identities in the reviewer manifest; general staff
membership, customer upload access and document authorship are not sufficient.

A reviewed change must append an immutable rule/applicability version, reference
precise sources and retained review/approval evidence, identify both reviewers,
define the capability/claim/provider/fact scope, date anchor, effective interval,
review deadline and concrete credential/terms requirements, and receive an
explicit operational release decision. Preserve older versions and Git history.
If a version needs revocation, retain the old released artifact and evidence of
the revocation in the reviewed change. Do not erase prior decision snapshots.
Changing files is not a deployment or an expansion approval. Repository branch
protection/reviewer administration must be confirmed by the owner before using
this mechanism for actual approvals; no reviewer is authorized by this patch.

## Flags, shadow operation and rollback

`VENFOUR_JURISDICTION_MODE` defaults to **`off`**. Off performs no registry,
context or snapshot I/O. `shadow` computes proposals and records private snapshots
and bounded structured logs without changing checkout, processing or release.
`enforce` and other values are rejected at API startup; there is no environment
value that can activate nationwide service in Phase 1.

Shadow failures emit `jurisdiction_shadow_unavailable` or
`jurisdiction_shadow_reference_unavailable`, without facts, exception text or
credentials. They preserve existing behavior and must be investigated; a missing
snapshot is never an approval. Successful shadow logs include case/snapshot IDs,
boundary, digest, reasons and `owner_review_required` for existing behavior whose
proposed scope is held. Existing eligible behavior remains **unreviewed**, not
grandfathered or newly approved.

For a later separately authorized shadow rollout: rehearse/apply the additive
migration, deploy compatible code with the flag off, then enable shadow on the
selected environment and review recorded proposals/errors. None of those hosted
steps was performed here. Roll back shadow by setting the flag to `off` and
restarting the affected processes. Retain new tables and history; no down
migration or data deletion is needed. Older application code does not use them.

## Payment, held delivery and refund boundary

Phase 1 records **proposed** holds, not actual jurisdiction delivery holds. A
signed paid event still claims/reconciles/finalizes idempotently and enqueues
durable work. Payment itself adds no operating permission. Tests combine a held
proposal with real local signature verification and duplicate event replay.

Before enforcement, the next implementation must persist a distinct new-work
hold at checkout/job/release transaction boundaries and expose it to an operator.
A paid held case must retain the event, transaction, order, entitlement, receipt,
prior report access, evidence and refund rights. The hold must not reject financial
events, disappear from the queue, consume provider calls, or create an endless
automatic retry loop. Resolve it through a documented scope decision or existing
refund/support process. No automatic new refund entitlement is invented here.

Do not place a jurisdiction rejection around `handle_webhook`, reconciliation,
refund execution or historical downloads. The existing no-support report release
and automatic retained-access refund share a workflow; enforcement must explicitly
separate a hold on **new delivery** from execution of an already-owed refund.
Shadow tests preserve that complete path. Historical access does not authorize new
reports, new drafts, coaching, revisions or services.

## Owner review findings and activation blockers

- The inspected intake/search/checkout paths have no current reviewed jurisdiction
  registry. A US ZIP is a search location, not evidence of authority to serve that
  customer. Actual hosted footprint/credentials remain unverified. This patch
  neither widens nor disables the existing footprint.
- Current report output includes a personalized value conclusion and supported
  reconsideration content; it is broader than a market-evidence-only product.
  Customer message preparation and later insurer-response coaching are separate
  regulated-scope questions. Pricing a preview at zero and customer self-submission
  do not resolve those questions.
- `valuation_evidence_report.py` describes a self-service evidence package and
  requires the “not an independent appraisal” scope statement. The refund page
  says Venfour does not negotiate with insurers. The customer flow opens a
  `mailto:` through `browser-actions.ts` and separately records “sent.” Internal
  negotiation-round naming is not evidence that Venfour itself contacts insurers.
  No new negotiation, appointment or insurer-send feature was introduced. Actual
  support practices, authorship, entity/provider locations and credentials still
  need review against real samples.
- The referral page says the invitation program begins in Missouri. That is not
  statewide approval of all services or compensation. Preserve attribution even
  when separately holding compensation. Existing regulated-partner approval and
  program enablement checks remain unchanged.
- The canonical live configuration guard in `commerce.py` is $199 USD. Terms and
  refund policy preserve automatic refunds for no supported dispute and a separate
  documented manual path for a final increase **below** $1,000. Commissions require
  an increase **above** $1,000. Exactly $1,000 meets neither numerical threshold;
  this asymmetry is flagged for owner confirmation, not silently “fixed.” No
  contradictory current price or refund statement was found in the inspected
  canonical surfaces. Historical policy version labels and applicability to
  earlier purchases require review; no retroactive promise is inferred.
- Insurer settlement taxes/fees, tax on Venfour's service and entity qualification
  remain separate unresolved workstreams. No numeric state valuation, tax,
  geographic radius, comparable-count or deadline rule was implemented.
- Enforcement requires exact capability approvals, current case-bound provider
  credentials, reviewed terms/disclosures, a facts sufficiency contract, held-paid
  operations, and transaction-level database checks for direct RPC and queued paths.
  Concurrency/revocation between proposal and mutation remains an activation blocker.

## Verification and next step

The new tests are `tests/test_jurisdiction.py`,
`tests/test_jurisdiction_integration.py`, and
`supabase/tests/database/056_jurisdiction_foundation.test.sql`. They cover the full
seed, geography/claim conflicts, approval authority/dates, capability separation,
backend and queue observation, signature/duplicate payment handling, no-support
refunds, historical downloads, owner/staff isolation and append-only history.
Existing affected backend and database suites were also run under offline/local
guards:

| Check | Result |
| --- | --- |
| Offline existing suites: `test_commerce`, `test_customer_delivery`, `test_follow_up_delivery`, `test_package_processing`, `test_report_processing`, `test_staff_release`, `test_insurer_response_processing`, `test_case_analyses`, `test_full_review_processing` | 303 passed, no failures/errors/skips, zero unexpected network attempts |
| Offline new suites: `test_jurisdiction`, `test_jurisdiction_integration` | 38 passed, no failures/errors/skips, zero unexpected network attempts |
| Targeted owner/staff/gateway follow-up run | 41 passed (overlaps the suites above) |
| Fresh isolated migration rehearsal | All 85 repository migrations applied; network `none`, no published ports, scheduler disabled; no existing application/customer records copied |
| Database suites `056`, `015`, `017`, `018`, `038`, `051` | 424 assertions passed across six suites |
| Supplied seed byte comparison | Exact match; SHA-256 `6336ebe0eea19a72e4cba640b09859f9c9d5eb58dbc18300818083c34a044894` |
| Scope review and `git diff --check` | Passed |

The database suites cover the new foundation, commerce, report release, customer
delivery, referral attribution and strict payment readiness. Evidence logs are
local under `/tmp/venfour-jurisdiction-*.log` and
`/tmp/venfour-jurisdiction-database-final/`. Disposable rehearsal containers are
removed after verification. No frontend build/visual check was needed because no
frontend implementation was changed by this patch. No hosted, live provider,
live payment, email, production migration or deployment check was performed.

The next scope step is an owner/qualified-review packet for the exact existing
Missouri capabilities using current sample outputs and terms. The next smallest
code patch is a transaction-fenced paid-delivery hold and operator recovery
contract, still disabled, after the owner agrees on the resolution/refund handling.
Do not enable enforcement, checkout expansion or public availability until the
listed operating and transactional requirements are met. Phase 1 stops here.
