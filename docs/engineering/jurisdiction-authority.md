# Reviewed authority publication and attestations

This is a non-activating foundation following [jurisdiction scope](jurisdiction-foundation.md)
and [paid-delivery recovery](paid-delivery-holds.md). Research still covers 51
jurisdictions and grants **zero operating approvals**. The packaged rules,
reviewers, writers, publishers, database publications, credentials, document
catalog and exact acceptances are empty. No Missouri or other service is enabled.
Only synthetic isolated tests provision authority.

## Inspected paths and preserved boundaries

| Concern | Actual implementation |
| --- | --- |
| Research | `venfour/data/jurisdiction_research_seed.json`, unchanged; 51 jurisdictions, 67 source records, no approvals |
| Phase 1 registry/reviewers | `venfour/data/jurisdiction_registry.json` remains empty; `jurisdiction_reviewers.json` now declares empty version 2 trust configuration |
| Decisions | `venfour/jurisdiction.py` keeps deterministic fact/scope matching; `jurisdiction_adapter.py` keeps off/shadow capability observations; `jurisdiction_authority.py` adds reviewed compilation and attestation matching |
| Epoch and hold | `jurisdiction_delivery_authority`, `jurisdiction_delivery_cases`, `jurisdiction_delivery_events` from `20260922000100_paid_delivery_holds.sql`; new publications use their existing advisory lock and epoch invalidation |
| Checkout/payment | `venfour/commerce.py`, API checkout quote/session routes, `reserve_total_loss_checkout`, signed webhook reconciliation and fulfillment RPCs; unchanged |
| Processing/release | `package_processing.py`, `report_processing.py`, `customer_delivery.py`, `insurer_response_processing.py`, `staff_release.py`; existing claim, storage, draft and report release fences call the strengthened database decision |
| Recovery | `venfour/paid_delivery.py`, `paid_delivery_api.py`, `SupabaseHttpGateway.get_paid_delivery_review_context/resolve_paid_delivery`; no new rule-authoring HTTP route |
| Existing customer acknowledgment | `frontend/src/features/total-loss/identity-service.ts` and `confirm_total_loss_case_contact` record Terms and Privacy version labels with server timestamps; profile confirmation and case claim retain their existing behavior |
| Checkout presentation and policy | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx`, `venfour/commerce.py`, commerce order `terms_version/refund_policy_version`; no new consent, price or policy copy |
| Staff access | `staff_members`, `staff_admin_require_access`, separate `jurisdiction_delivery_operators`; none confers review/publication/attestation authority |
| Application database access | `venfour/supabase_gateway.py`: server-only service key for internal RPCs and authenticated user token for owner/staff RPCs; no signing or publisher credential added |
| Release/configuration | `Dockerfile` copies backend/scripts/schemas; `.env.example` separates server secrets and commerce versions; `supabase/operations/release_partner_agreement.sql` is an existing explicit release-operation precedent, not reviewer authority. `frontend/package.json` contains explicit build/deploy commands. No repository `.github` workflow was present. No release/deployment command was run. |

The old contact/profile acknowledgments do not retain exact document content
hashes in an immutable acceptance ledger. Frozen commerce policy labels are
purchase history, not proof of explicit acceptance of every future disclosure.
They are not backfilled, rewritten, or inferred to satisfy the new contract.
Privacy notice acknowledgment remains distinct from an explicitly required
future Privacy acceptance. Partner agreement signatures have a separate purpose
and cannot satisfy customer or provider credential requirements.

## Artifact and compilation

`schemas/jurisdiction/reviewed-authority-v1.schema.json` is separate from the
research schema and Phase 1 registry. Each full authority revision binds:

- revision, previous epoch/digest, request UUID, publisher login identity, release
  reference, prepared time, restricted reviewer configuration revision/digest;
- two distinct reviewers, approval times and retained review evidence, both for
  the complete artifact and every rule;
- rule identity/version, explicit candidate jurisdiction set, exact capability,
  first/third-party claim, personal/commercial policy use, provider role, required
  facts, typed `field equals value` conditions;
- permitted, limited, prohibited, not-applicable or unresolved determination;
  explicit credential/document requirements or reviewed-not-required policy;
- named effective-date anchor, inclusive start/exclusive end, review deadline,
  optional reviewed revocation identity/time/reference;
- primary-source URL, precise locator, retained source digest and evidence.

No location priority or ZIP inference is introduced. Unsupported professional
capabilities and unimplemented conditions are rejected. Free-text limitations
cannot compile; implemented restrictions belong in typed facts, credentials and
exact document requirements. Not-applicable never allows a capability.

`compile_authority` validates the schemas, independent reviewers, dates,
requirements and overlap. Different date anchors/conditions do not establish
precedence; overlapping scope is rejected. A future service effective date must
precede the review deadline. JSON uses sorted keys, UTF-8 strings and compact
separators; SHA-256 covers those exact UTF-8 bytes. Compilation emits an immutable
artifact and human-readable summary. It performs no network, database, provider
or email operation. Compile success is not signed publication.

The lower-level Phase 1 `Registry` remains useful for deterministic synthetic
scope tests. Its packaged loader explicitly rejects any nonempty packaged rules
or interpretations. Editing the repository registry cannot install permission.

## Restricted authority and publication

The migration `20260922000200_jurisdiction_trusted_authority.sql` adds empty,
append-only history under RLS. `jurisdiction_authority_config` records immutable
reviewer/writer/publisher configuration revisions and their author/time/digest.
Its initial revision 0 has no identities. The repository manifest has the same
empty configuration. Removed identities remain in prior configurations and
signed artifacts.

Two separate reviewer keys authenticate the exact canonical artifact using
HMAC-SHA-256 with the `venfour-authority-v1` domain prefix. Each reviewer holds
only their own private key. The release operator collects signatures; they do
not need either reviewer secret. Key digests and metadata are public review
configuration, while verification secrets live in `jurisdiction_private.review_keys`.
Application roles, publication roles and attestation roles have no access to the
key table or ability to change authority configuration. Key bytes/digests must be
unique across identities. Keys are never placed in browser config, service-role
environment variables, repository files or command arguments.

This design trusts the database owner and separate key-provisioning custodian as
security administrators. A database superuser can replace functions/read secrets;
SQL cannot protect against its own administrator. Before production use, owner
access controls, independent key custody, backups and reviewer qualification must
be established. No application identities, signing keys, release logins or operating
credentials are supplied by this patch. An ordinary database edit, staff membership, Git commit, source
reference or service-role request cannot substitute for two authenticators.

The dedicated `jurisdiction_publisher` role is NOLOGIN with no application members. A future
owner-provisioned login must both hold this role and match the current configuration's
publisher identity. `session_user`, not a request-supplied staff ID, identifies the
publisher. `publish_jurisdiction_authority` is its sole publication operation.
There is no generic application editing route.

### Dormant release role boundary

PostgreSQL 17 automatically grants a non-superuser role creator administrative
membership: `postgres` receives `ADMIN TRUE, INHERIT FALSE, SET FALSE` on both
restricted roles, granted by the bootstrap superuser `supabase_admin`. These
memberships are infrastructure administration, not publisher enrollment. Removing
them requires the grantor's authority and is not a production prerequisite.
See the official [role-creation semantics](https://www.postgresql.org/docs/17/role-attributes.html)
and [membership semantics](https://www.postgresql.org/docs/17/role-membership.html).

`jurisdiction_private.release_role_violations()` is an owner-only, invoker-rights
release audit. The migration fails if it finds any unexpected membership anywhere
in the reverse graph rooted at the restricted roles, database owner, platform
superuser, or administrative CLI role. It examines all membership edges even when
SET and INHERIT are false, so an ADMIN-only grant or an intermediate role cannot
escape the check. No role is trusted merely because its name contains `admin`.

The only accepted edges are the two exact creator grants above and, if present,
`postgres <- cli_login_postgres`, granted by `supabase_admin` with `ADMIN FALSE,
INHERIT FALSE, SET TRUE`. The latter is Supabase's [temporary administrative CLI
login](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae).
Its credential expiration must be finite and no more than one hour ahead; it must
have no superuser, role-creation, database-creation, replication or RLS-bypass
attributes. All incoming memberships are checked. `postgres` must retain the
observed non-superuser owner/administrator attributes and own `appraisal_cases`;
the bootstrap superuser must be `supabase_admin` at its PostgreSQL bootstrap OID.
Any additional superuser or changed restricted-role attributes fail the audit.

Venfour uses PostgREST with customer JWTs or `service_role`, not administrative
SQL credentials. `anon`, `authenticated`, `authenticator`, `service_role`, ordinary
staff/logins, and managed Auth/Storage/Realtime roles have no direct or transitive
publication/attestation administration. Table ACLs, private-schema grants, RLS,
function ownership, internal execution grants and empty SECURITY DEFINER search
paths are independently checked. Supabase's infrastructure read-all/replication
principals remain inside the database-platform trust boundary: RLS-bypassing
read-all administrators can read database-held keys. There are no keys installed.
Future key custody must explicitly account for that platform access.

This audit describes the empty, dormant release. Future publisher or attestor
enrollment needs a separately reviewed identity policy and corresponding audit
update; it is not silently accepted by this release check. SQL does not defend
against the database owner, platform superuser, or a compromised administrative
credential capable of replacing the audit itself.

One transaction locks the existing delivery authority lock and checks:

1. current configuration revision/digest, current reviewer authorization and both
   authenticators over the complete artifact;
2. identical embedded JSON schema, rule dates/requirements/overlap and current
   review validity;
3. expected previous epoch/digest, next registry revision and retained rule
   identities with increasing versions for changed content;
4. exact request replay versus a conflicting request.

It appends `jurisdiction_authority_publications` and a matching delivery epoch,
then the existing epoch trigger holds released cases. The publication stores
signed content, signatures, publisher/time, request, source release identity,
previous lineage and result. The epoch foreign key is deferred until commit.
Bare new authority rows are rejected without the matching signed publication.
Competing publications cannot both advance the same predecessor. An exact
successful retry returns the original result without another epoch. Failed
transactions leave no partial epoch; operators retain their failed command log.

Revocation is a new full reviewed artifact with operation `revoke`, a higher
rule version and revocation identity/time/evidence. It retains every current rule
identity and all original artifacts. A separately reviewed later version may
restore permission, but old delivery snapshots never revive. Revocation holds
new fulfillment; it does not cancel orders, generate refunds or delete reports.

## Credentials, document versions and acceptance

`schemas/jurisdiction/authority-attestation-v1.schema.json` distinguishes verified
credentials from document releases. `jurisdiction_attestations` retains every
revision, canonical signed content, writer, evidence, request and server time.
`jurisdiction_attestor` is another NOLOGIN role without application members; configured attestation
writers authenticate their writes with a separate key and domain prefix.
Application users, partners, ordinary staff and service-role code cannot write
verified attestations. Configuration changes require renewed attestations.

Credential records bind type, jurisdiction, holder/entity, provider, permitted
capabilities, identifier reference, issuing authority, validity interval,
verification time/evidence and verified/revoked/suspended status. This first
contract requires a bounded verification expiry, including where an issuer's
credential has no printed expiry. A reviewed credential requirement must match
all these scope fields; the case's explicit assigned-credential reference must
also match. Missing, conflicting, expired, future, revoked and wrong-scope
records hold. No regulator is scraped and no license is asserted valid here.
Actual provider assignment/provenance still needs an owner-approved collection
workflow before activation; a customer fact alone is not credential verification.

Document releases bind Terms, Privacy, refund, scope or jurisdiction-disclosure
identity to an exact version and SHA-256 digest plus retained evidence. The same
document version cannot be published with different bytes. Status is current or
withdrawn; new revisions retain older releases. No production documents or
state-specific copy are inserted by this migration.

`accept_jurisdiction_document` is an authenticated **acceptance** seam, not a rule
or catalog-writing API. It requires a verified, non-anonymous identity, exact
case/order ownership, a current document sequence/digest and request UUID. It
records server time, customer/case/order, exact immutable document reference,
authentication role and session ID. Service-role-only calls cannot manufacture
acceptance. Retries preserve the original record. No frontend is wired to this
seam yet; the current empty catalog cannot accept a document. Old contact/privacy
acknowledgments and order policy versions are preserved without backfill.

## Runtime and transaction integration

Recovery reads one context containing facts, authority, current configuration,
latest credential/document revisions and exact acceptances. `attested_snapshot`
revalidates and evaluates it using the existing deterministic scope matcher.
The snapshot binds authority epoch/digest, configuration revision, attestation
revision and case acceptance revision alongside existing facts/context. Empty,
expired or invalid authority produces a held proposal.

The database independently recomputes all four paid capabilities before release
and at existing new-work fences. An application snapshot is insufficient. The
same transaction lock serializes publication, configuration, credentials,
documents, acceptances, fact changes and delivery transitions. Volatile database
reads occur after the lock; deadline checks use current server time. Credential
or review expiry is checked even without an intervening write. Recovery also
materializes stale released state before considering another release response.

Existing evidence eligibility, no-support decisions, staff approval, ownership,
immutable source lineage and private storage checks still run. There is no gate
around signed payment reconciliation, refund accounting or historical downloads.
The server-start rehearsal marker and sandbox-order-only enrollment restriction
are preserved. There is **no new production enrollment path**.

## Future operator commands (not run against a real environment)

Paths below are placeholders for separately reviewed, protected release inputs.
The default repository manifest is empty and cannot compile or publish an
operating rule. Supplying an invented populated manifest cannot bypass the
current empty database trust roots.

```sh
.venv/bin/python scripts/jurisdiction_authority.py dry-run \
  --source /secure/reviewed-authority.json \
  --manifest /secure/reviewer-authority.json \
  --output /secure/authority.canonical.json

# Each reviewer runs independently, with only their own mode-0600 hex key file.
.venv/bin/python scripts/jurisdiction_authority.py sign \
  --source /secure/authority.canonical.json \
  --manifest /secure/reviewer-authority.json \
  --reviewer REVIEWER_ID --key-file /secure/own-review-key.hex \
  --output /secure/own-signature.json

# signatures.json is the JSON array containing the two returned signature objects.
.venv/bin/python scripts/jurisdiction_authority.py publish \
  --source /secure/authority.canonical.json \
  --manifest /secure/reviewer-authority.json \
  --signatures /secure/signatures.json --service jurisdiction_release

# Recompile and independently sign a new full artifact with operation revoke first.
.venv/bin/python scripts/jurisdiction_authority.py revoke \
  --source /secure/revocation.canonical.json \
  --manifest /secure/reviewer-authority.json \
  --signatures /secure/revocation-signatures.json --service jurisdiction_release

.venv/bin/python scripts/jurisdiction_authority.py sign-attestation \
  --source /secure/attestation.json --manifest /secure/reviewer-authority.json \
  --key-file /secure/own-writer-key.hex --output /secure/attestation-signature.json
.venv/bin/python scripts/jurisdiction_authority.py attest \
  --source /secure/attestation.json --manifest /secure/reviewer-authority.json \
  --signature-file /secure/attestation-signature.json --service jurisdiction_attestation
```

Only the explicit publish/revoke/attest commands invoke `psql`. They require a
named connection service; there is no default target. Protected libpq service and
password files supply the future restricted login. No service-role JWT or
application API participates. Dry-run/signing are offline. Secrets are never
printed or included in the process command line. Recompile after any configuration
or predecessor change; a failed optimistic comparison is not permission to force
an overwrite.

## Flags, rollback and remaining blockers

`VENFOUR_JURISDICTION_MODE` defaults to `off`; only `off` and `shadow` are accepted.
No enforcement value exists. Publication does not enroll customers, change the
live footprint or enable nationwide checkout. The shadow observer continues to
record the empty packaged-registry proposal; published authority consumption is
limited to the explicit held-delivery recovery seam in this foundation.

Rollback: keep the flag off; suspend publisher/writer role memberships and append
restricted configuration removal if needed. Retain all authority, acceptance,
credential, financial and delivery histories and the database fences. Do not
restore an old epoch or edit old artifacts. A policy rollback requires a newly
reviewed version and new epoch. Use application code compatible with manifest v2;
older recovery clients lacking the bound authority context must remain held.
No down migration or table deletion is an approved rollback.

Production blockers include qualified independent reviewers and key custodians;
restricted release logins/administration; legal review of each actual capability,
entity/provider scope and samples; precise retained primary sources; verified
credentials/assignments; document content/version publication and explicit consent
UI; hosted compatibility and private configuration verification; separately
reviewed live enrollment/enforcement; and remaining transaction/provider seams.
The existing footprint is unreviewed, not grandfathered. Exactly $1,000 still
meets neither the manual refund's below-$1,000 condition nor the commission's
above-$1,000 condition; owner clarification remains pending. No economic term
was changed.

## Future in-flight work policy (documentation only)

If authority, facts, credentials or terms become invalid after an external
request was transactionally admitted, do not claim the request can be retracted.
Allow unavoidable transport to finish, admit no subsequent paid stage, and
recheck before storing or publishing new customer-facing work wherever existing
architecture permits. Quarantine/hold downstream fulfillment and never release a
new report, draft or coaching result under stale authority. Preserve budget and
accounting records for previously admitted provider work. Do not create a new
refund entitlement; use paid-delivery operator recovery.

Remaining gaps: current provider budget reservation and external transport are
not one atomic transaction with the jurisdiction fence; object-storage upload and
application/database mutations are separate operations; prepayment preview/full
review and optional legacy stateless analysis still only observe scope; and a
held provider result has no new general-purpose quarantine store in this patch.
Existing database claim/storage/publication fences were strengthened, not removed.
External cancellation and new quarantine/cancellation workflows were not built.

## Changed files

| Files | Purpose |
| --- | --- |
| `venfour/jurisdiction_authority.py` | Offline compiler, signature format, scoped evaluator, bound recovery snapshot |
| `venfour/jurisdiction.py`, `venfour/data/jurisdiction_reviewers.json` | Empty manifest v2 and rejection of nonempty packaged permission registry |
| `venfour/paid_delivery.py` | Consume current trusted authority/attestations during recovery |
| `schemas/jurisdiction/reviewed-authority-v1.schema.json`, `reviewer-authority-v2.schema.json`, `authority-attestation-v1.schema.json` | Strict versioned contracts; identical schemas embedded in SQL and checked by tests |
| `scripts/jurisdiction_authority.py` | Explicit dry-run, independent signing, restricted publish/revoke/attest commands |
| `supabase/migrations/20260922000200_jurisdiction_trusted_authority.sql` | Restricted roles, immutable publications/configuration/attestations/acceptances, atomic publication and current-state fences |
| `tests/jurisdiction_authority_fixtures.py`, `tests/test_jurisdiction_authority.py` | Synthetic fixtures and focused offline validation/scope tests |
| `supabase/tests/database/057_jurisdiction_authority.test.sql` | Empty defaults, RLS/privileges, non-forgeability and immutable history |
| `supabase/tests/concurrency/jurisdiction_authority.py`, `paid_delivery_holds.py` | Real local publication races, stale state/attestation tests; existing hold scenarios now use signed fixtures |
| This document, `jurisdiction-foundation.md`, `paid-delivery-holds.md` | Operating contract, exact commands, policy, blockers and cross-links |

## Verification

All checks passed. No failures, errors or skips in the Python runs; the offline
network guard recorded zero unexpected network attempts. Counts below overlap
where a focused final follow-up repeats a broader test.

| Check | Result |
| --- | --- |
| Broad backend regressions | 477 passed |
| Final authority/jurisdiction/hold follow-up after final changes | 96 passed, including 54 authority tests |
| API/communication regression | 55 passed |
| Existing checkout/identity frontend mocks | 131 passed in 3 files |
| Isolated database regressions | 997 assertions passed in 16 suites |
| Signed authority/concurrency/attestation scenarios | 58 passed |
| Existing paid-delivery recovery scenarios using signed authority | 47 passed, including all 152 commerce assertions under holds |
| Fresh final migration rehearsal | All 87 migrations applied on both final isolated targets; every source SHA-256 matches its rehearsal record |
| CLI | Synthetic dry-run succeeded; the same input with the packaged empty configuration was rejected before any database command |
| Research and scope | Seed SHA-256 unchanged; tracked and new-file whitespace checks passed |

Exact Python and frontend commands:

```sh
.venv/bin/python scripts/run_offline_tests.py test_jurisdiction_authority test_jurisdiction test_jurisdiction_integration test_paid_delivery test_commerce test_package_processing test_report_processing test_customer_delivery test_follow_up_delivery test_insurer_response_processing test_insurer_response_dispatch test_insurer_response_decision test_staff_release test_supabase_gateway test_full_review_processing test_market_request_budget test_partner_commissions test_partner_earnings
.venv/bin/python scripts/run_offline_tests.py test_jurisdiction_authority test_jurisdiction test_paid_delivery
.venv/bin/python scripts/run_offline_tests.py test_package_processing_api test_insurer_response_analysis_api test_communications
npm --prefix frontend test -- src/features/total-loss/identity-service.test.ts src/features/total-loss-claim/api.test.ts src/features/total-loss-claim/components/embedded-payment.test.tsx
```

The SQL command used `scripts/run_isolated_database_tests.py --container
venfour-migration-rehearsal-authority-regression --output
/tmp/venfour-authority-regression-sql` with these exact files under
`supabase/tests/database/`:

- `009_guest_first_total_loss_identity.test.sql`
- `015_total_loss_stripe_commerce.test.sql`
- `016_total_loss_package_processing.test.sql`
- `017_total_loss_report_release.test.sql`
- `018_total_loss_customer_delivery.test.sql`
- `023_total_loss_insurer_response_analysis.test.sql`
- `025_total_loss_response_recommendation_decision.test.sql`
- `026_total_loss_follow_up_request.test.sql`
- `036_staff_admin_workspace.test.sql`
- `038_referral_partner_attribution.test.sql`
- `048_total_loss_checkout_initialization.test.sql`
- `050_paid_work_delivery_recovery.test.sql`
- `051_full_review_payment_gate.test.sql`
- `052_manual_payment_approval.test.sql`
- `056_jurisdiction_foundation.test.sql`
- `057_jurisdiction_authority.test.sql`

Exact scenario commands:

```sh
.venv/bin/python supabase/tests/concurrency/jurisdiction_authority.py --container venfour-migration-rehearsal-authority-cases --output /tmp/venfour-authority-cases
.venv/bin/python supabase/tests/concurrency/paid_delivery_holds.py --container venfour-migration-rehearsal-authority-regression --output /tmp/venfour-authority-holds
```

Migration rehearsal used the existing `scripts/rehearse_production_migrations.py`
`Rehearsal.bootstrap/apply` helpers with cached images, network `none`, no exposed
ports, schedulers disabled and the existing server-start rehearsal marker. Only
platform schema definitions were read from local Supabase; no application data
or secrets were copied. Synthetic authority identities existed solely inside
disposable targets, which were removed after verification. The existing local
Supabase project was not reset or modified.

Logs remain under `/tmp/venfour-authority-*`, including source hash manifests,
SQL assertion results and scenario JSON. These prove local synthetic contracts
only, not hosted readiness or legal permission. No external network call,
production deployment, hosted migration, live payment, paid provider call or email
was performed. The price remains $199; refund promises/calculations and partner
commissions are unchanged. No jurisdiction was approved or enabled, no enforcement
mode was added, and nationwide checkout remains disabled by this foundation.

The next smallest step is owner designation of qualified independent reviewers
and key custodians, followed by a reviewed packet for the exact existing service
capabilities. This patch does not perform that approval or activate delivery.
