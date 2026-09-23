# Paid-delivery hold and operator recovery contract

The subsequent [trusted publication and attestation foundation](jurisdiction-authority.md)
adds independently authenticated publication and current credential/document checks.
Its empty configuration grants no operating approvals.

This follows [the jurisdiction foundation](jurisdiction-foundation.md). It does
not approve a jurisdiction, activate enforcement, change the existing footprint,
or turn a research observation into operating permission. The registry and
reviewer manifest still contain zero approvals. This document describes local
code and synthetic verification, not hosted readiness.

## Activation boundary

`VENFOUR_JURISDICTION_MODE` still defaults to `off` and accepts only `off` and
`shadow`. All other values fail startup validation. There is no enforcement or
rehearsal environment mode. Shadow observations never enroll a case in a hold.

The migration creates **empty** delivery enrollment, authority, and operator
relations. No application role, including `service_role`, can insert enrollment,
install registry authority, or grant recovery membership. Enrollment additionally
requires the PostgreSQL server-start setting
`cluster_name=venfour-delivery-rehearsal` and a matching sandbox Stripe order.
There is no enrollment endpoint. The rehearsal runner independently verifies a
reserved disposable container name, network `none`, the server marker, and an
empty application database. Renaming a production server is not an activation
procedure; removing these restrictions requires a separately reviewed change.

Paid service entry points now query the database fence. An unenrolled case
continues through its original checks. This RPC does not load research or infer a
location. Install the additive migration before compatible application code in
any later authorized rollout; missing database support fails closed. No hosted
installation or rollout was performed for this patch.

## Actual boundaries

| Boundary | Existing authority and new fence |
| --- | --- |
| Checkout readiness | Existing strict assessment, immutable lineage, ownership, optional staff review, and $199 configuration in `commerce.py` remain authoritative. No new checkout availability rule is installed. |
| Stripe event claiming and finalization | `TotalLossCommerceService.handle_webhook`, reconciliation and `fulfill_total_loss_checkout_payment` remain ungated. Financial facts, receipts, entitlements, duplicate event behavior and durable package enqueue are retained. |
| Paid queue dispatch | `reserve_due_workflow_work_items` excludes effectively held/cancelled cases before reserving delivery. It retains original work identity, state, generation, lease, backoff and attempt limits. |
| Package claim | `claim_total_loss_package_work_item` takes the delivery lock and checks current permission before the original claim. `TotalLossPackageProcessor.execute` checks before claim and source work. |
| Report generation and review | Both report claim RPCs and `TotalLossReportProcessor` entry points are fenced. Admission is checked again before generation/model review and release. New report content and publication also have database triggers. |
| Durable report enqueue | The existing report enqueue RPC still appends a durable work item. It creates no report content. This preserves recovery if a hold commits between package completion and report enqueue; the queued report worker remains held. |
| Draft generation | Customer authentication and exact-owner scope checks precede new draft admission. Initial/follow-up preparation and follow-up storage RPCs independently fence mutation. New draft/version/source inserts are guarded. Existing draft reads and customer history remain accessible. |
| Response coaching | The response due-job selector suppresses held cases. The processor checks before claiming, extracting/analyzing, and publishing. Claims, new runs/results/recommendations, and recommendation publication are independently fenced in SQL. |
| Staff release | Report publication triggers apply equally to staff release. Ordinary staff cannot override the hold. The staff service preserves the dedicated hold response. |
| Refunds and historical downloads | Canonical refund reservation/result reconciliation and customer download authorization are ungated. A completed report-review job whose package is already `refund_pending` can resume financial recovery without authorizing new report work. |

`venfour/paid_delivery.py` owns service admission and recovery;
`paid_delivery_api.py` supplies the internal staff HTTP interface;
`supabase_gateway.py` carries the validated RPC contract and maps SQLSTATE
`PJD01` to the explicit hold exception. Missing gateway support cannot bypass
admission. No provider-budget/cache/accounting mechanism is replaced.

## Durable lifecycle and transaction fences

`20260922000100_paid_delivery_holds.sql` adds:

- `jurisdiction_delivery_cases`: case/order identity, `held | released | cancelled`,
  capability bundle, snapshot/authority references, reasons, validity deadline,
  stable refund request key, and creation/update times.
- `jurisdiction_delivery_events`: append-only hold, release, refusal, and
  cancellation events with request identity, resolver, snapshot, result and time.
- `jurisdiction_delivery_authority`: append-only registry digest/revision epochs.
  A new epoch invalidates existing releases, even when a later epoch restores
  the same digest.
- `jurisdiction_delivery_operators`: separately assigned recovery membership.

All four tables have RLS enabled and no direct application-role grants. Existing
RLS, storage policies, payment tables and source snapshots are unchanged. Holds
start explicitly unassessed (`MISSING_CURRENT_APPROVAL`); the snapshot reference
may be absent until a decision is recorded. Refused review attempts retain their
new snapshot identity without rewriting earlier snapshots or audit events.

For enrolled cases, an advisory transaction lock serializes hold checks,
authority publication, facts invalidation and resolution. Resolution also locks
the control row. An append to jurisdiction facts or a loss-date change invalidates
release. Each paid claim acquires the fence before its original row locks;
artifact/processing triggers cover direct database writes. Exact saved context
(including fact revision and legacy intake date), current authority epoch/digest,
capability decisions and validity are checked again at mutation. SQL refusal
rolls back that mutation; it does not finalize work as successful.

A recovery release requires a newly evaluated snapshot (at most 30 seconds old),
recorded after the current hold, for all four purchased capabilities: market
report, personalized conclusion, customer draft, and response coaching. Each is
evaluated independently by the foundation. The snapshot binds the observed
authority epoch and complete current context. The SQL transition rejects changes
between observation and mutation. Releases last at most five minutes and end
sooner at the next UTC date boundary or applicable review/revocation deadline.
These are conservative internal rehearsal bounds, not customer promises.
Expiration suppresses dispatch immediately; the next check or operator inspection
materializes a durable expired-approval hold event.

Concurrent releases and repeated request IDs converge on one transition. A
reused request ID cannot change case, actor or action. Restoring eligibility
resumes the existing queue identity. Original processing leases/backoff and
attempt limits still apply; recovery does not reset budgets, mint a new paid
entitlement, or override evidence, no-support or staff-release decisions.

Database admission is the ordering point for starting a work stage. A hold
committed before admission prevents the claim and new work. No database
transaction can retract an external request already admitted/in flight.
Subsequent stages and publication recheck the fence. A production activation
would require an explicit reviewed policy for in-flight requests, bounded leases
and provider admission; this patch must not be described as an external-call
cancellation guarantee.

## Operator interface and recovery

Authenticated, non-anonymous staff must also be present in
`jurisdiction_delivery_operators`. General staff membership is insufficient.
The application cannot populate that table or the reviewer/authority manifests.
Recovery grants delivery only from current reviewed rules; it cannot approve a
jurisdiction or substitute staff membership for credentials or terms. Runtime
credential/terms attestations remain empty, so requirements for them cannot be
satisfied by this patch.

- `GET /api/v1/staff/paid-delivery-holds`: private paginated packets (`items`,
  `nextAfter`); pass the cursor as `?after=<case-id>`.
- `GET /api/v1/staff/paid-delivery-holds/{case_id}`: inspect one case.
- `POST /api/v1/staff/paid-delivery-holds/{case_id}/resolve`: a bounded JSON request
  containing only `action` (`release` or `cancel_refund`) and UUID `requestId`.

Packets include order/payment/refund state, work identities and statuses,
capabilities, reason codes, snapshot references, dates, immutable resolution
history, and available actions. This patch adds no customer or staff screen.

`release` authenticates/authorizes first, reloads current facts and authority,
runs the current packaged reviewed registry, appends a new snapshot, and asks SQL
to commit the fenced transition. An unresolved decision returns a hold; no old
snapshot is accepted as a new approval. A release does not itself publish any
report: the existing worker and release gates still have to succeed.

`cancel_refund` atomically cancels new fulfillment and reserves the existing
canonical full-refund operation using a stable request key, reason
`JURISDICTION_NONFULFILLMENT`, and access policy `retain`. The service then calls
`TotalLossCommerceService.refund`, retaining its existing provider idempotency and
reconciliation behavior. A crash or unavailable provider leaves the cancellation
and reservation durable. Retrying the same operator action uses the same refund
key. No automatic refund timer, email workflow, compensation or new refund right
is created. A terminal refund failure still requires the existing support path;
a new refund attempt is not invented automatically.

Multiple payments or another existing material refund yield
`refund_status=support_required`, with fulfillment still cancelled. The operator
uses the existing support/refund tooling to reconcile that ambiguity; this action
does not arbitrarily select a charge or create a second refund. Cancelled cases
cannot be reopened by release, changed facts, new rules, queue replay, restart or
refund failure. There is no reopening mechanism in this patch.

Internal queue endpoints acknowledge holds with HTTP 200 and
`state=jurisdiction_held`. This stops task retries without claiming fulfillment
completed. Customer/staff mutation endpoints return a private 409 hold response.
Due selectors omit held work until explicit recovery; inspection still lists it.
Infrastructure failures remain failures, not permission or completed delivery.

## Rollback and remaining blockers

Both supported jurisdiction modes remain non-activating. Setting the flag to
`off` stops shadow observations; it must not release an already held case. For an
application rollback, retain the additive tables, audit history and SQL fences.
Do not delete enrollment/holds to unblock work. Older workers may not acknowledge
`PJD01`, so drain rehearsal tasks before rolling back application code. Production
has no enrollment path in this patch. No down migration is required.

Production enforcement, database authority publication synchronized with reviewed
repository releases, real credential/terms attestations, in-flight admission
policy, and actual jurisdiction approval remain blockers. The existing footprint
remains unreviewed. No state pages, marketing claims, negotiation, formal
appraisal-clause role or nationwide checkout were added.

The $199 price, refund guarantee and partner commission calculations are unchanged.
The existing **below $1,000** refund threshold versus **above $1,000** commission
threshold remains intentionally out of scope, including exactly $1,000.

## Verification

The focused offline suite is `tests/test_paid_delivery.py`. Existing affected
backend suites cover commerce/refunds, package/report processing, customer and
follow-up delivery, response processing/dispatch/decisions, staff release,
jurisdiction, gateways, full review and provider budgets/partner accounting.
Existing in-memory test gateways explicitly declare unenrolled delivery rather
than relying on a missing admission implementation.

`supabase/tests/concurrency/paid_delivery_holds.py` requires a fresh isolated
rehearsal database with all migrations. It uses the existing customer-delivery
fixture and the real foundation evaluator with explicitly synthetic approvals.
It also runs the entire 152-assertion commerce suite with sandbox orders held
before payment. Independent database connections exercise concurrent release,
fact/authority changes, expiry, cancellation, duplicate refunds and retained
historical downloads. The synthetic $199 order and original financial history
are checked. No live payment/provider or email call is used.

Run the existing database suites with `scripts/run_isolated_database_tests.py`
after resetting only the dedicated rehearsal target, never a linked/hosted
project. Final counts and evidence locations are recorded in the delivery report
for this patch. Stop after this hold/recovery step; activating it is separate work.

### Verified results for this patch

| Check | Result |
| --- | --- |
| Consolidated offline backend command (17 affected suites, including the new 17-test hold suite) | 429 passed; zero failures, skips or unexpected network attempts |
| Final hold/API/communication check | 72 passed; overlaps the hold suite above; zero unexpected network attempts |
| Existing database suites `015`, `016`, `017`, `018`, `023`, `025`, `026`, `036`, `038`, `050`, `051`, `056` | 757 assertions passed across 12 suites |
| Hold/recovery/concurrency rehearsal | 47 named checks passed; includes all 152 commerce assertions with sandbox orders held before payment |
| Fresh migration installation | All 86 migrations applied to an empty isolated database |
| Scope review and `git diff --check` | Passed |

Evidence: `/tmp/venfour-delivery-final-offline.log`,
`/tmp/venfour-delivery-final-api.log`,
`/tmp/venfour-delivery-acceptance-sql/`,
`/tmp/venfour-delivery-acceptance-holds/`, and
`/tmp/venfour-delivery-acceptance-database/`. Rehearsal containers are removed after
verification. No hosted migration, deployment, live charge, paid provider call or
email occurred. The checks establish local contract behavior, not production
readiness.

### Files changed

| Files | Purpose |
| --- | --- |
| `venfour/paid_delivery.py`, `venfour/paid_delivery_api.py` | Admission contract and private operator recovery API |
| `venfour/api.py` | Service wiring and explicit hold responses |
| `venfour/package_processing.py`, `venfour/report_processing.py`, `venfour/insurer_response_processing.py` | Worker, generation, model-work and publication admission |
| `venfour/customer_delivery.py`, `venfour/staff_release.py` | Authenticated draft boundaries and staff hold propagation |
| `venfour/supabase_gateway.py` | Validated server/user RPC adapters and database hold signal |
| `supabase/migrations/20260922000100_paid_delivery_holds.sql` | Additive state/audit tables, private permissions, transaction fences and queue suppression |
| `supabase/tests/concurrency/paid_delivery_holds.py`, `tests/test_paid_delivery.py` | Durable/concurrent SQL scenarios and offline service/API tests |
| `tests/test_package_processing.py`, `tests/test_report_processing.py`, `tests/test_insurer_response_processing.py`, `tests/test_insurer_response_decision.py`, `tests/test_customer_delivery.py` | Existing fixtures explicitly declare unenrolled delivery |
| `docs/engineering/jurisdiction-foundation.md`, this document | Link from Phase 1 and hold/recovery operating contract |

Pre-existing frontend/browser changes were left untouched. No frontend, price,
commission, refund promise, deterministic valuation or provider accounting logic
was changed by this patch.
