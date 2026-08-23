# Closed-beta scorecard template

> **Private-record rule:** This repository contains only the empty template.
> Complete a copy only in the approved restricted operational system. Never
> commit, attach, paste, or send a completed scorecard through the repository,
> a pull request, an issue, chat, email, or another shared engineering system.

Do not enter a participant name, email, phone number, address, user ID, case ID,
filename, VIN, claim or policy number, Access identity, Storage path, request
URL, PDF, screenshot, report text, provider payload, PII, or another customer
direct identifier. An anonymous sample ID, analysis job ID, and analysis run ID
are explicitly allowed in this private scorecard for lifecycle reconciliation.
Do not publish them. Use UTC timestamps, bounded categories, and aggregate
counts or costs.

## Cohort control

- Scorecard opened at (UTC):
- Release operator alias:
- Reviewer alias:
- Internal canary planned at (UTC):
- Tester-report target, from 10 to 20:
- Current cohort decision: `PENDING` / `GO` / `NO-GO` / `STOPPED`
- Exactly one sample permitted in flight: `YES` / `NO`

### Five-tester consent and provisioning roster

Keep names and account identifiers in the separate restricted consent system.
Use only tester slots here. Leave this roster unprovisioned until the internal
canary has recorded `GO`.

| Tester slot | Named tester on restricted roster | Access provisioned | Auth provisioned | Written-consent version | Consent confirmed at UTC | Withdrawal contact supplied |
| --- | --- | --- | --- | --- | --- | --- |
| T1 |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |

- Consent covers staging, original CCC reports, provider processing, retention,
  withdrawal, and product limitations for all five testers: `YES` / `NO`
- Public signup disabled: `YES` / `NO`
- Access has no public bypass: `YES` / `NO`
- Roster gate result: `PASS` / `FAIL`

## Release evidence

- Repository commit SHA:
- Cloud Run image digest:
- Cloud Run revision name:
- Active Worker version identifier:
- One Worker version at 100% traffic: `YES` / `NO`
- Evidence reviewed against approved release: `YES` / `NO`

## Observability setup

- Log-based metric exact name: `venfour_staging_case_analysis_failed`
- Metric exact-filter review passed: `YES` / `NO`
- Metric kind/value type: `DELTA` / `INT64`
- Policy exact name: `Venfour staging analysis health`
- Exact policy match count:
- Policy enabled: `YES` / `NO`
- Policy combiner: `OR`
- Condition count: `3`
- Analysis-failure condition is `>= 1 / 5m` with `ALIGN_SUM`: `YES` / `NO`
- Cloud Run 5xx condition is `>= 1 / 5m` with `ALIGN_SUM`: `YES` / `NO`
- Request-latency condition is p95 `> 600s` for `5m`: `YES` / `NO`
- Notification channel independently tested: `YES` / `NO`
- Synthetic lifecycle counter incremented: `YES` / `NO`
- Synthetic health-policy incident delivered: `YES` / `NO`
- Synthetic incident closed before canary: `YES` / `NO`

## Staging smoke gates

- Signed-out staging root redirected to Access: `YES` / `NO`
- Direct protected API returned `403 STAGING_PROXY_REQUIRED`: `YES` / `NO`
- Proxied Access-approved, application-signed-out request returned
  `401 AUTHENTICATION_REQUIRED`: `YES` / `NO`
- `/health` returned `200`: `YES` / `NO`
- `/ready` returned `200`: `YES` / `NO`
- `/appraisals` deep link and refresh rendered the SPA: `YES` / `NO`
- `/start?service=total-loss` deep link and refresh rendered the SPA: `YES` / `NO`
- Proxied API `Cache-Control` was `private, no-store, max-age=0`: `YES` / `NO`
- Proxied API `CDN-Cache-Control` was `private, no-store, max-age=0`: `YES` / `NO`
- API response was not an edge cache hit: `YES` / `NO`
- Active processing jobs before intake:
- Smoke result: `PASS` / `FAIL`

## Per-sample record

Duplicate this section inside the private scorecard for the internal canary and
each of the 10 to 20 tester reports.

### Sample identity and coverage

- Anonymous sample ID:
- Stage: `INTERNAL-CANARY` / `TESTER-COHORT`
- Tester slot: `INTERNAL` / `T1` / `T2` / `T3` / `T4` / `T5`
- Carrier/template category:
- Vehicle category:
- Source-quality category:
- Original CCC report: `YES` / `NO`
- Consent rechecked immediately before upload: `YES` / `NO`
- Analysis job ID:
- Analysis run ID:

### Serialized execution and lifecycle

- Upload started at (UTC):
- First attempt started at (UTC):
- First attempt ended at (UTC):
- First-attempt lifecycle duration (seconds):
- Final terminal state reached at (UTC):
- Total sample elapsed duration (seconds):
- Peak active processing jobs:
- Attempt count:
- First-attempt outcome: `COMPLETED` / `FAILED` / `STOPPED`
- Final outcome: `COMPLETED` / `FAILED` / `EXPIRED` / `STOPPED`
- Bounded failure code, if any:
- Failure marked retryable: `YES` / `NO` / `NOT APPLICABLE`
- Controlled retry approved: `YES` / `NO` / `NOT APPLICABLE`
- Controlled retry result: `RECOVERED SAME JOB/RESULT` / `FAILED` /
  `NOT ATTEMPTED`
- Matching lifecycle-start event count:
- Matching lifecycle-terminal event count:
- Lifecycle IDs and attempt count reconciled: `YES` / `NO`
- Active processing jobs after terminal state:
- Database job count for case:
- Immutable artifact count for case:
- Unexpected duplicate job or artifact: `YES` / `NO`
- Stuck beyond lease or 900 seconds: `YES` / `NO`

### Recovery after local-state removal

- Browser site data and local state removed: `YES` / `NO`
- Tester signed in again: `YES` / `NO`
- Saved result found through `/appraisals`: `YES` / `NO`
- Analysis deep link refreshed successfully: `YES` / `NO`
- Same job ID and run ID recovered: `YES` / `NO`
- No additional job or artifact created: `YES` / `NO`
- Recovery result: `PASS` / `FAIL`

### Material-field verification

Visually compare against the source report on the tester's device. Do not copy
the source or field values into the scorecard.

- Loss vehicle identity/configuration: `PASS` / `FAIL` / `NOT APPLICABLE`
- Insurer valuation and totals: `PASS` / `FAIL` / `NOT APPLICABLE`
- Insurer comparables: `PASS` / `FAIL` / `NOT APPLICABLE`
- Mileage adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- Condition/options adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- Other material adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- Silent material-field error count:
- Material-field verification result: `PASS` / `FAIL`

### Conclusion and limitations review

- Conclusions match the displayed evidence: `YES` / `NO`
- Facts and conclusions are clearly distinguished: `YES` / `NO`
- Evidence uncertainty and material limitations are visible: `YES` / `NO`
- No guaranteed recovery, legal entitlement, or unsupported wrongdoing claim:
  `YES` / `NO`
- Silent conclusion error count:
- Conclusion/limitations review result: `PASS` / `FAIL`

### Monitoring and provider aggregate

- Matching `case_analysis_failed` event count:
- Cloud Run 5xx count for window:
- Health-policy incident opened: `YES` / `NO`
- Provider-failure event count:
- Highest Cloud Run request latency (seconds):
- Provider usage by approved aggregate unit:
- Provider cost for sample:
- Authorization or ownership failure count:
- Privacy or unauthorized-exposure event count:
- Data-loss event count:
- Unexpected PII or direct identifier in logs/alerts: `YES` / `NO`
- Secret, request URL, PDF, filename, VIN, or provider payload in logs/alerts:
  `YES` / `NO`
- Monitoring result: `PASS` / `FAIL`

### Sample decision

- All applicable sample checks passed: `YES` / `NO`
- Reviewer approved continuation: `YES` / `NO`
- Decision: `GO` / `NO-GO` / `STOPPED`
- Decision time (UTC):
- Bounded, identifier-free rationale:

Any failed, missing, or unexplained value requires `NO-GO` or `STOPPED`. Do not
start the next sample until the stop condition is resolved and a fresh canary is
approved.

## Tester comprehension

Mark `PASS` only when the tester can explain without corrective prompting the
insurer value, the main evidence-based observation, what the evidence does not
prove, and how to recover the result through `/appraisals`.

| Tester slot | Report reviewed | Insurer value understood | Main observation understood | Limitations understood | Recovery path understood | Overall result |
| --- | --- | --- | --- | --- | --- | --- |
| T1 |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |

## Exact cohort gates

- Submitted original CCC tester reports, between 10 and 20:
- Completed on first attempt:
- First-attempt denominator:
- First-attempt success rate:
- First-attempt success rate `>= 90%`: `YES` / `NO`
- First-attempt duration count, equal to submitted-report count:
- Nearest-rank p95 rank, `ceil(0.95 * count)`:
- Nearest-rank p95 duration (seconds):
- p95 duration `<= 600s`: `YES` / `NO`
- Completed results recoverable after local-state removal:
- Completed-result denominator:
- Recovery rate was 100%: `YES` / `NO`
- Tester comprehension passes:
- Tester comprehension was at least 4 of 5: `YES` / `NO`
- Authorization or ownership failures: `0` required
- Privacy or unauthorized-exposure events: `0` required
- Data-loss events: `0` required
- Duplicate jobs or artifacts: `0` required
- Stuck jobs: `0` required
- Silent material-field or conclusion errors: `0` required
- Open health-policy incidents at decision time: `0` required
- All earlier incidents resolved and reviewed: `YES` / `NO`
- Aggregate provider usage by approved unit:
- Aggregate provider cost:
- Aggregate usage/cost reconciled to submitted reports: `YES` / `NO`
- Exact cohort gate result: `PASS` / `FAIL`
- Final decision: `GO` / `NO-GO` / `STOPPED`
- Decision time (UTC):

## Stop and revocation, if applicable

- Stop criterion category:
- New intake stopped at (UTC):
- Affected tester slot:
- Participant Access revoked at (UTC):
- Application sign-in disabled at (UTC):
- In-flight request settled or lease expired at (UTC):
- Active processing jobs after stop:
- Private incident record opened: `YES` / `NO`
- Resumption approved: `YES` / `NO` / `NOT APPLICABLE`

Do not put incident text, participant details, user/case identifiers, URLs, or
payloads in this scorecard. Record only the bounded category and permitted
operational fields.

## Retention and deletion

Repeat these fields for each anonymous sample.

- Anonymous sample ID:
- Beta case closed at (UTC):
- Scheduled deletion deadline, no later than 30 calendar days (UTC):
- Withdrawal received at (UTC), if applicable:
- Deletion mode: `30-DAY` / `WITHDRAWAL` / `FULL-ACCOUNT-REQUEST`
- Access revoked before deletion: `YES` / `NO`
- No trusted backend request could still write: `YES` / `NO`
- Object count before Storage API deletion:
- Object count after Storage API deletion:
- Exact prefix empty before case deletion: `YES` / `NO`
- Deleted case count:
- Remaining appraisal-case count:
- Remaining Total Loss detail count:
- Remaining Diminished Value detail count:
- Remaining analysis-job count:
- Remaining analysis-run count:
- Final exact-prefix object count:
- Auth user action: `RETAINED` / `DELETED ON REQUEST` / `NOT APPLICABLE`
- Remaining profile count after requested account deletion:
- Remaining staff-membership count after requested account deletion:
- Deletion completed at (UTC):
- Deletion reviewer approved count-only evidence: `YES` / `NO`

Deletion is incomplete unless every applicable object and row count is zero,
the object-prefix check passed before case deletion, and the reviewer approved.

## Close

- Support follow-up completed for all tester slots: `YES` / `NO`
- Scorecard contains no PII or prohibited direct identifier: `YES` / `NO`
- Scorecard contains no PDF, screenshot, report text, filename, request URL, VIN,
  secret, Storage path, or provider payload: `YES` / `NO`
- Stored only in approved restricted operational system: `YES` / `NO`
- Closed at (UTC):
