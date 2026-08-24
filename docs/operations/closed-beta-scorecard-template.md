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
- No-report internal canary planned at (UTC):
- Supported-CCC internal canary planned at (UTC):
- Unknown-provider internal canary planned at (UTC):
- Tester-sample target, from 10 to 20:
- Current cohort decision: `PENDING` / `GO` / `NO-GO` / `STOPPED`
- Exactly one sample permitted in flight: `YES` / `NO`

### Five-tester consent and provisioning roster

Keep names and account identifiers in the separate restricted consent system.
Use only tester slots here. Leave this roster unprovisioned until all three
internal mode canaries have recorded `GO`. Provision only Cloudflare Access;
each tester must use the hidden guest session and late verified-email claim
rather than a pre-provisioned application account.

| Tester slot | Named tester on restricted roster | Access provisioned | Guest-first Auth path required | Written-consent version | Consent confirmed at UTC | Withdrawal contact supplied |
| --- | --- | --- | --- | --- | --- | --- |
| T1 |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |

- Consent covers staging, no-report and report intake, provider processing when
  applicable, retention, withdrawal, and product limitations for all five
  testers: `YES` / `NO`
- Anonymous sign-in enabled behind Access and Turnstile: `YES` / `NO`
- Email signup enabled for the late verified claim: `YES` / `NO`
- No tester Auth user pre-provisioned: `YES` / `NO`
- Access has no public bypass: `YES` / `NO`
- Roster gate result: `PASS` / `FAIL`

## Release evidence

- Repository commit SHA:
- Cloud Run image digest:
- Cloud Run revision name:
- Active Worker version identifier:
- One Worker version at 100% traffic: `YES` / `NO`
- Evidence reviewed against approved release: `YES` / `NO`

## Guest-first Auth and Turnstile readiness

Do not record the Turnstile secret, a CAPTCHA response token, an email callback
value, a full Auth configuration response, or a public-key value.

- Managed widget allows exactly `staging.venfour.com`: `YES` / `NO`
- Managed widget excludes `localhost`: `YES` / `NO`
- Deployed site key corresponds to that widget: `YES` / `NO`
- Deployed staging site key is not an official test key: `YES` / `NO`
- Unit tests used the mocked controller and were not treated as live
  Siteverify evidence: `YES` / `NO`
- Any local official-test-key browser check used local/test Supabase Auth with
  the matching test secret, not the shared linked project: `YES` / `NO` /
  `NOT RUN`
- Widget secret exists only in Supabase Auth configuration: `YES` / `NO`
- Supabase CAPTCHA enabled with provider `turnstile`: `YES` / `NO`
- Anonymous sign-in enabled: `YES` / `NO`
- Email Auth and new-user signup enabled: `YES` / `NO`
- Email confirmation required and OTP expiry is 3600 seconds: `YES` / `NO`
- Custom SMTP fields exist: `YES` / `NO`
- Site URL and exact callback allowlist passed: `YES` / `NO`
- Confirmation and magic-link token-hash templates passed: `YES` / `NO`
- Production apex and `www` unpublished, or every published shared-project
  client proven CAPTCHA-compatible: `YES` / `NO`
- Anonymous-sign-in limit is 30 per hour per IP: `YES` / `NO`
- Email-send limit is 30 per hour project-wide with custom SMTP: `YES` / `NO`
- `/auth/v1/otp` limit is 30 requests per hour project-wide, combined across
  users: `YES` / `NO`
- Repeat OTP or magic-link requests for the same user are separated by at least
  60 seconds: `YES` / `NO`
- Verification limit is 30 per five minutes per IP: `YES` / `NO`
- Refresh-token limit is 150 per five minutes per IP: `YES` / `NO`
- SMS-send limit is 30 per hour: `YES` / `NO`
- Web3 limit is 30 per hour per IP: `YES` / `NO`
- Missing-token anonymous Auth failed closed: `YES` / `NO`
- Invalid-token anonymous Auth failed closed: `YES` / `NO`
- Existing Google flow passed: `YES` / `NO`
- Auth and Turnstile readiness result: `PASS` / `FAIL`

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
- Anonymous Auth without a CAPTCHA token failed closed: `YES` / `NO`
- Anonymous Auth with an invalid CAPTCHA token failed closed: `YES` / `NO`
- `/health` returned `200`: `YES` / `NO`
- `/ready` returned `200`: `YES` / `NO`
- `/appraisals` deep link and refresh rendered the SPA: `YES` / `NO`
- `/start?service=total-loss` deep link and refresh rendered the SPA: `YES` / `NO`
- Proxied API `Cache-Control` was `private, no-store, max-age=0`: `YES` / `NO`
- Proxied API `CDN-Cache-Control` was `private, no-store, max-age=0`: `YES` / `NO`
- API response was not an edge cache hit: `YES` / `NO`
- Active processing jobs before intake:
- Smoke result: `PASS` / `FAIL`

## Mandatory release canaries

Run this section once per release after the three internal mode canaries and
before provisioning the tester cohort. Every field must be completed and every
result must be `PASS`; a missing, inconclusive, or failed check requires
`NO-GO`. Keep identities, case IDs, object paths, callback values, and file
details in the restricted operational system, not this scorecard.

### Cleared-guest limitation

- Disposable guest had no report, claim, analysis job, or submitted intake:
  `YES` / `NO`
- Closing and reopening with site data intact resumed the same guest and draft:
  `YES` / `NO`
- Clearing site data made the old anonymous session unrecoverable: `YES` / `NO`
- The replacement guest was denied the old case and Storage namespace: `YES` /
  `NO`
- Disposable guest data retired through the approved staging procedure: `YES` /
  `NO`
- Cleared-guest limitation result: `PASS` / `FAIL`

### Existing-account collision

- Fresh guest used an email already owned by a controlled permanent account:
  `YES` / `NO`
- Authenticating the real account claimed only the intended guest case: `YES` /
  `NO`
- Duplicate permanent identity created: `NO` required
- Unauthorized merge or unrelated case/Storage access occurred: `NO` required
- Existing-account collision result: `PASS` / `FAIL`

### Cross-user authorization negatives

- Other user's case ID remained inaccessible: `YES` / `NO`
- Other user's private Storage path remained inaccessible: `YES` / `NO`
- Invalid callback or claim material could not transfer ownership: `YES` / `NO`
- Expired callback or claim material could not transfer ownership: `YES` / `NO`
- Signed-in user could not claim the other user's case: `YES` / `NO`
- Valid owner access still worked after every denial: `YES` / `NO`
- Cross-user authorization result: `PASS` / `FAIL`

### Upload and analysis fences

- Corrupt or invalid upload failed without extraction or analysis work: `YES` /
  `NO`
- Synthetic upload larger than 50 MiB failed without extraction or analysis
  work: `YES` / `NO`
- Repeated or concurrent submission remained idempotent and lease/token-fenced:
  `YES` / `NO`
- Durable job count for the valid case: `1` required
- Immutable artifact count for the valid case: `1` if completed, otherwise `0`;
  never more than `1`
- Upload and analysis-fence result: `PASS` / `FAIL`

### Responsive customer UX

| Required check | `1440x1000` | `390x844` |
| --- | --- | --- |
| Critical beginning-to-results path completed | `PASS` / `FAIL` | `PASS` / `FAIL` |
| No internal-release copy, CCC-only copy, visible guest-auth oddity, or early contact gate | `PASS` / `FAIL` | `PASS` / `FAIL` |
| Turnstile displayed without clipping or overflow when interaction was required | `PASS` / `FAIL` | `PASS` / `FAIL` |
| Trim remained available and no horizontal overflow occurred | `PASS` / `FAIL` | `PASS` / `FAIL` |
| Upload, extraction correction, and review remained usable | `PASS` / `FAIL` | `PASS` / `FAIL` |
| Errors, loading, processing, and result evidence scope remained clear and truthful | `PASS` / `FAIL` | `PASS` / `FAIL` |

- Desktop UX result: `PASS` / `FAIL`
- Mobile UX result: `PASS` / `FAIL`
- Mandatory release canaries result: `PASS` / `FAIL`

## Per-sample record

Duplicate this section inside the private scorecard for each of the three
internal mode canaries and each of the 10 to 20 tester samples.

### Sample identity and coverage

- Anonymous sample ID:
- Stage: `INTERNAL-CANARY` / `TESTER-COHORT`
- Intake coverage mode: `NO-REPORT` / `SUPPORTED-CCC` / `UNKNOWN-PROVIDER`
- Tester slot: `INTERNAL` / `T1` / `T2` / `T3` / `T4` / `T5`
- Report-provider outcome: `NOT APPLICABLE` / `CCC` / `NOT IDENTIFIED`
- Carrier/template category or `NOT APPLICABLE`:
- Vehicle category:
- Source-quality category:
- No-report mode created no upload lease, object, filename, or report-review
  claim: `YES` / `NO` / `NOT APPLICABLE`
- Supported-CCC mode recognized the provider and showed extracted facts for
  review: `YES` / `NO` / `NOT APPLICABLE`
- Unknown-provider mode did not treat the report as CCC and allowed bounded
  manual completion: `YES` / `NO` / `NOT APPLICABLE`
- Consent rechecked immediately before intake or report upload: `YES` / `NO`
- Analysis job ID:
- Analysis run ID:

### Guest identity and verified claim

- Total Loss opened without visible application sign-in: `YES` / `NO`
- Fresh `anonymous-auth` Turnstile challenge completed: `YES` / `NO`
- Exactly one anonymous Auth session created: `YES` / `NO`
- Exactly one owned guest draft resolved: `YES` / `NO`
- Duplicate-click guest or draft count: `0` required
- Name, email, and legal acknowledgements collected near intake end: `YES` / `NO`
- Fresh `magic-link` Turnstile challenge completed: `YES` / `NO`
- Anonymous-auth token was not reused for magic-link send: `YES` / `NO`
- Access email sent: `YES` / `NO`
- Result viewed in guest session before claim: `YES` / `NO`
- Application closed and reopened before claim with browser site data intact:
  `YES` / `NO`
- Same guest, case, and result resumed without a duplicate: `YES` / `NO`
- Email verified permanent, non-anonymous user: `YES` / `NO`
- Exact-email case claim completed atomically: `YES` / `NO`
- Guest lost case access and, when applicable, report Storage access after
  transfer: `YES` / `NO`
- Permanent user retained case access and, when applicable, report access:
  `YES` / `NO`
- Admin view changed from guest/unclaimed to claimed: `YES` / `NO`
- CAPTCHA/Auth token or callback value retained or logged: `NO` required
- Guest identity and claim result: `PASS` / `FAIL`

### Serialized execution and lifecycle

- Report upload started at (UTC), or `NOT APPLICABLE`:
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

### Claimed recovery after local-state removal

- Browser site data and local state removed: `YES` / `NO`
- Tester signed in again: `YES` / `NO`
- Saved result found through `/appraisals`: `YES` / `NO`
- Analysis deep link refreshed successfully: `YES` / `NO`
- Same job ID and run ID recovered: `YES` / `NO`
- No additional job or artifact created: `YES` / `NO`
- Recovery result: `PASS` / `FAIL`

### Material-field verification

Compare against the applicable source evidence on the tester's device. For a
report mode, use the report; for no-report, use the facts the tester confirmed
manually. Do not copy the source or field values into the scorecard.

- Confirmed manual facts: `PASS` / `FAIL` / `NOT APPLICABLE`
- Loss vehicle identity/configuration: `PASS` / `FAIL` / `NOT APPLICABLE`
- Insurer valuation and totals: `PASS` / `FAIL` / `NOT APPLICABLE`
- Insurer comparables: `PASS` / `FAIL` / `NOT APPLICABLE`
- Mileage adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- Condition/options adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- Other material adjustments: `PASS` / `FAIL` / `NOT APPLICABLE`
- No-report result made no report-review or report-only evidence claim: `PASS` /
  `FAIL` / `NOT APPLICABLE`
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
- Unexpected Auth `429` count:
- CAPTCHA validation or challenge failure count:
- Highest Cloud Run request latency (seconds):
- Provider usage by approved aggregate unit:
- Provider cost for sample:
- Authorization or ownership failure count:
- Privacy or unauthorized-exposure event count:
- Data-loss event count:
- Unexpected PII or direct identifier in logs/alerts: `YES` / `NO`
- Secret, request URL, PDF, filename, VIN, or provider payload in logs/alerts:
  `YES` / `NO`
- CAPTCHA token, email callback value, or Access redirect parameter in
  logs/alerts: `YES` / `NO`
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

| Tester slot | Result reviewed | Insurer value understood | Main observation understood | Limitations understood | Recovery path understood | Overall result |
| --- | --- | --- | --- | --- | --- | --- |
| T1 |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |

## Exact cohort gates

- No-report internal canary result: `PASS` / `FAIL`
- Supported-CCC internal canary result: `PASS` / `FAIL`
- Unknown-provider internal canary result: `PASS` / `FAIL`
- All three internal modes passed before cohort provisioning: `YES` / `NO`
- Cleared-guest limitation canary result: `PASS` / `FAIL`
- Existing-account collision canary result: `PASS` / `FAIL`
- Cross-user authorization canary result: `PASS` / `FAIL`
- Upload and analysis-fence canary result: `PASS` / `FAIL`
- Desktop `1440x1000` UX canary result: `PASS` / `FAIL`
- Mobile `390x844` UX canary result: `PASS` / `FAIL`
- All mandatory release canaries passed before cohort provisioning: `YES` / `NO`
- Submitted tester samples, between 10 and 20:
- No-report tester sample count:
- Supported-CCC tester sample count:
- Unknown-provider tester sample count:
- Completed on first attempt:
- First-attempt denominator:
- First-attempt success rate:
- First-attempt success rate `>= 90%`: `YES` / `NO`
- First-attempt duration count, equal to submitted-sample count:
- Nearest-rank p95 rank, `ceil(0.95 * count)`:
- Nearest-rank p95 duration (seconds):
- p95 duration `<= 600s`: `YES` / `NO`
- Completed results recoverable after local-state removal:
- Completed-result denominator:
- Recovery rate was 100%: `YES` / `NO`
- Guest-first verified claims completed:
- Guest-first verified-claim denominator:
- Guest-first verified-claim rate was 100%: `YES` / `NO`
- Guest restart/resume passes with site data intact, equal to submitted-sample
  count:
- Tester comprehension passes:
- Tester comprehension was at least 4 of 5: `YES` / `NO`
- Authorization or ownership failures: `0` required
- Unexpected Auth `429`, CAPTCHA, or token-exposure failures: `0` required
- Privacy or unauthorized-exposure events: `0` required
- Data-loss events: `0` required
- Duplicate jobs or artifacts: `0` required
- Stuck jobs: `0` required
- Silent material-field or conclusion errors: `0` required
- Open health-policy incidents at decision time: `0` required
- All earlier incidents resolved and reviewed: `YES` / `NO`
- Aggregate provider usage by approved unit:
- Aggregate provider cost:
- Aggregate usage/cost reconciled to submitted samples: `YES` / `NO`
- Exact cohort gate result: `PASS` / `FAIL`
- Final decision: `GO` / `NO-GO` / `STOPPED`
- Decision time (UTC):

`GO` is permitted only when all three internal mode canaries, every mandatory
release canary, every applicable per-sample gate, and every aggregate cohort
gate above passed. A blank, `NOT RUN`, inconclusive, or failed mandatory value is
`NO-GO`.

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

For an Auth or Turnstile rollback only:

- Access restricted to operator before Auth changes: `YES` / `NO` /
  `NOT APPLICABLE`
- Anonymous sign-in disabled at (UTC):
- New-user signup disabled at (UTC):
- CAPTCHA disabled only after both creation paths were disabled: `YES` / `NO` /
  `NOT APPLICABLE`
- Sanitized Auth baseline verified: `YES` / `NO` / `NOT APPLICABLE`
- Prior CAPTCHA-unaware Worker received traffic only after CAPTCHA was disabled:
  `YES` / `NO` / `NOT APPLICABLE`
- No secret copied into an emergency command or record: `YES` / `NO` /
  `NOT APPLICABLE`

Do not put incident text, participant details, user/case identifiers, URLs, or
payloads in this scorecard. Record only the bounded category and permitted
operational fields.

## Automated abandoned anonymous guest cleanup

This section records count-only schedule evidence. Never record the cleanup
header value, an Edge/Vault secret value, a decrypted Vault query, an Edge URL,
a candidate user ID, a case ID, or a Storage path.

### One-time readiness

- Migration applied in a controlled activation window: `YES` / `NO`
- Migration-created active schedule was not left without its required Edge and
  Vault configuration: `YES` / `NO`
- Required secrets and dry run were completed before the first cadence, or the
  job was immediately unscheduled: `YES` / `NO`
- Cleanup migration has local/linked parity: `YES` / `NO`
- Reviewed `cleanup-abandoned-anonymous-guests` Edge release present: `YES` /
  `NO`
- Function accepts `POST` only: `YES` / `NO`
- `verify_jwt` is disabled only for the reviewed schedule interface: `YES` /
  `NO`
- Missing custom cleanup header failed before a run: `YES` / `NO`
- Wrong custom cleanup header failed before a run: `YES` / `NO`
- `GET` failed before a run: `YES` / `NO`
- Edge secret name `VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET` exists: `YES` /
  `NO`
- Vault name `venfour_cleanup_edge_function_url` exists: `YES` / `NO`
- Vault name `venfour_cleanup_schedule_secret` exists: `YES` / `NO`
- Secret values were neither read nor recorded: `YES` / `NO`
- Exact active cron job count for
  `venfour-abandoned-anonymous-guest-cleanup-daily`: `1` required
- Cron cadence is `17 3 * * *` UTC: `YES` / `NO`
- Cron command calls only the reviewed dispatcher: `YES` / `NO`
- Duplicate cleanup schedule count: `0` required

### Required dry run

- Cleanup run ID:
- Run completed at (UTC):
- Requested dry run: `YES` required
- Requested batch size: `25`
- Response contained only approved count fields: `YES` / `NO`
- Status:
- Eligible count:
- Marked count: `0` required
- Cancelled count: `0` required
- Claimed count: `0` required
- Completed count: `0` required
- Retry count: `0` required
- Blocked count: `0` required
- Matching dry-run audit row/event present: `YES` / `NO`
- Candidate rows unchanged: `YES` / `NO`
- Storage objects unchanged: `YES` / `NO`
- Auth users unchanged: `YES` / `NO`
- Dry-run readiness result: `PASS` / `FAIL`

### Daily run record

Repeat after every scheduled invocation.

- Cleanup run ID:
- Started at (UTC):
- Completed at (UTC):
- Terminal status:
- Dry run: `NO` required
- Eligible count:
- Marked count:
- Cancelled count:
- Claimed count:
- Completed count:
- Retry count:
- Blocked count:
- New candidates received a fresh 24-hour grace: `YES` / `NO` /
  `NOT APPLICABLE`
- Completed intakes and unexpired report-upload leases remained excluded:
  `YES` / `NO`
- Storage API deletion and empty-prefix verification preceded each Auth delete:
  `YES` / `NO` / `NOT APPLICABLE`
- Candidate state counts reconciled to the run: `YES` / `NO`
- Every retry or blocked count reviewed: `YES` / `NO` / `NOT APPLICABLE`
- Candidate user-root scan found no unexpected sibling folder, object, or path:
  `YES` / `NO` / `NOT APPLICABLE`
- No unexpected path was approved for deletion: `YES` / `NO`
- Daily cleanup result: `PASS` / `FAIL`

### Cleanup schedule stop, if applicable

- Named cron job unscheduled before further rollback: `YES` / `NO` /
  `NOT APPLICABLE`
- Named cron job count after unschedule: `0` required / `NOT APPLICABLE`
- No active cleanup request or lease remained: `YES` / `NO` /
  `NOT APPLICABLE`
- `executing`, `storage_retry`, `storage_deleted`, and partially processed
  `blocked` candidates reconciled: `YES` / `NO` / `NOT APPLICABLE`
- No cleanup-frozen guest remained before schema rollback: `YES` / `NO` /
  `NOT APPLICABLE`
- Edge interface, schedule secret, and migration objects retained until partial
  work cleared: `YES` / `NO` / `NOT APPLICABLE`
- Manual schema rollback separately reviewed: `YES` / `NO` /
  `NOT APPLICABLE`

## Retention and deletion

Repeat these fields for each anonymous sample.

- Anonymous sample ID:
- Beta case closed at (UTC):
- Scheduled deletion deadline, no later than 30 calendar days (UTC):
- Withdrawal received at (UTC), if applicable:
- Deletion mode: `30-DAY` / `WITHDRAWAL` / `FULL-ACCOUNT-REQUEST`
- Access revoked before deletion: `YES` / `NO`
- No trusted backend request could still write: `YES` / `NO`
- Current case owner and immutable report Storage owner independently resolved:
  `YES` / `NO`
- Case owner and Storage owner relationship: `SAME` / `DIFFERENT`
- `report_storage_owner_id` matched the exact prefix before mutation: `YES` /
  `NO`
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
