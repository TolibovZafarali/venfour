# Closed-beta operations runbook

## Purpose and boundary

This runbook controls Venfour's private staging closed beta at
`https://staging.venfour.com`. It is an operator procedure, not a deployment
authorization. It does not authorize production changes, a public Access
bypass, broader product scope, or concurrent case processing.
For this protected guest-first release, Supabase anonymous sign-in and email
user creation must be enabled behind Cloudflare Access and Turnstile. That
project setting is not authorization to publish a production site or add a
visible sign-up flow.

The closed beta exercises the provider-neutral Total Loss intake through three
required modes: no-report manual intake, a supported CCC report, and a report
whose provider is not identified. Run one participant case at a time. The next
case may not start until the current case is terminal, the post-run checks pass,
and the operator records a go decision.

Use the empty [closed-beta scorecard template](./closed-beta-scorecard-template.md)
for each run. Completed scorecards are private operational records. Never add a
completed scorecard to this repository, a pull request, an issue, chat, email,
or another shared engineering system.

## Privacy rules

The following rules apply before, during, and after every run:

- Never copy a participant PDF, screenshot, extracted report, provider payload,
  result artifact, or supporting document into the repository.
- Never place PII or customer direct identifiers in a scorecard. This includes
  names, email addresses, phone numbers, street addresses, user IDs, case IDs,
  filenames, VINs, claim numbers, policy numbers, Access identities, and full
  Storage object paths. A run's anonymous sample ID, analysis job ID, and
  analysis run ID are explicitly allowed in the private scorecard because they
  are needed to reconcile lifecycle evidence. They must not be published.
- Use only a beta slot number in the scorecard. Keep the private identity-to-case
  mapping in the approved restricted operational system used for consent and
  deletion, separate from the scorecard.
- Record only the fields allowed by the template: anonymous sample ID, job ID,
  run ID, bounded coverage categories, timestamps, counts, durations, outcomes,
  review results, release identifiers, and aggregate provider usage/cost. Do not
  paste request URLs, logs, exception text, document content, or provider
  responses.
- Load credentials through an approved secret manager into the operator process.
  Never put them in command arguments, tracked files, `.env` files, terminal
  transcripts, or scorecards.
- Treat Turnstile response tokens, email callback values, and Access redirect
  parameters as credentials. Do not record, persist, replay, or copy them into a
  log, screenshot, scorecard, issue, or operator command.
- Do not enable persisted Worker request logs or traces. Auth callback URLs can
  contain one-time values. The staging Worker intentionally keeps them disabled.
- Add a repository fixture only when a specific test request requires it and
  limit it to fields needed for that behavior. Fixture fields may be used when
  their reuse is covered by explicit written consent, or when the fields were
  de-identified and then visually verified against the source report. In both
  cases omit PDFs, screenshots, PII, direct identifiers, and unnecessary
  fields. Consent alone never permits a participant PDF in the repository.

If a privacy rule is broken or might have been broken, stop the beta immediately
and follow the stop procedure. Do not continue while investigating.

## Roles and two-person checks

One release operator runs the procedure. A second reviewer independently checks
the following before the first canary and before each deletion:

- release evidence matches the intended staging release;
- the Turnstile widget hostname and public site-key wiring match staging, while
  the widget secret remains only in Supabase Auth configuration;
- the project-wide Auth settings are compatible with every currently published
  frontend that uses the shared Supabase project;
- consent is current and covers the planned use;
- the active-processing count is zero before intake begins;
- the Monitoring policy exists once, is enabled, and reaches a monitored
  notification channel;
- the deletion target was resolved in the restricted operational system; and
- Storage is empty under the exact case prefix before the case row is deleted.

The release operator and reviewer record only their internal operator aliases in
the private scorecard. Do not record personal contact details.

## Consent gate

Do not provision or process a participant until all of these are true:

1. The participant received and accepted the approved consent text.
2. Consent identifies the staging nature of the service, the no-report and
   report paths, provider processing when a report is supplied, expected
   retention, withdrawal route, and product limitations.
3. When a report is supplied, the participant confirmed they are authorized to
   provide it. A no-report sample must not request or upload a placeholder PDF.
4. The participant received the support and withdrawal contact.
5. The consent version and UTC confirmation time are in the approved private
   consent system.
6. The operator rechecks that consent has not been withdrawn immediately before
   intake or report upload.

The repository template records only the tester slot, consent version, UTC
confirmation time, and bounded gate results. It is not the consent record and
must not contain a tester name or account identifier.

## Release evidence

Capture release evidence before every canary window. Record only the following
values in the private scorecard:

- repository commit SHA;
- Cloud Run image digest;
- Cloud Run revision name; and
- active Worker version identifier.

Use these read-only commands from the repository root. Do not copy the complete
command output into a scorecard.

```sh
git rev-parse HEAD

gcloud run services describe venfour-api-staging \
  --project=venfour-prod \
  --region=us-east4 \
  --format='value(status.latestReadyRevisionName)'

gcloud run revisions describe <REVISION_NAME> \
  --project=venfour-prod \
  --region=us-east4 \
  --format='value(status.imageDigest)'

cd frontend
npx wrangler deployments status --env staging --json
```

From the Wrangler result, record only the version receiving 100% of staging
traffic. Return to the repository root after the command.

Stop if the values differ from the approved release, traffic is split, the
revision is not ready, or the Worker result does not have one version at 100%.

## One-time guest-first Auth and Turnstile setup

The staging frontend and Cloud Run currently share one Supabase project. Auth,
CAPTCHA, signup, SMTP, redirect, and rate-limit changes apply to that entire
project, not only to `staging.venfour.com`. The checked-in Worker does not route
`venfour.com` or `www.venfour.com`; verify that remains true before this
staging-only release. If another frontend using the project is published, stop
unless it also supplies Turnstile tokens to every CAPTCHA-protected Auth request
or it has moved to an isolated project.

The approved guest-first Auth contract is:

- Cloudflare Access remains the outer allowlist and has no public bypass.
- A Cloudflare managed Turnstile widget allows exactly
  `staging.venfour.com`. It uses explicit execution and
  `appearance: "interaction-only"`, so it appears only when Cloudflare requires
  interaction.
- `VITE_TURNSTILE_SITE_KEY` contains the public widget site key. The staging
  build rejects Cloudflare test keys. Unit tests use a mocked controller. Local
  development uses Cloudflare's official invisible always-pass test site key
  only with local/test Supabase Auth configured with the corresponding test
  secret. It does not validate against the linked project after that project is
  configured with the real staging widget secret. Never add `localhost` to the
  staging widget hostname allowlist.
- The widget secret exists only in Supabase Auth's CAPTCHA configuration. Never
  put it in a frontend, Worker, Cloud Run variable, local environment file,
  operator argument, transcript, scorecard, screenshot, or document.
- Anonymous sign-in and Email Auth new-user signup are enabled. There is no
  visible application sign-up page: Total Loss creates a hidden anonymous Auth
  session, and the late email flow creates the permanent user needed for a
  verified exact-email case claim.
- Supabase CAPTCHA uses provider `turnstile`. The browser obtains a fresh token
  immediately before `signInAnonymously()` and a separate fresh token
  immediately before `signInWithOtp()`. A token is never logged, persisted, or
  reused.
- Email confirmation remains required, custom SMTP is configured, magic-link
  expiry remains 3600 seconds, and both email templates preserve the approved
  `RedirectTo` plus `TokenHash` callback format.
- The Auth Site URL remains `https://venfour.com`; the exact production,
  staging, and localhost callback URLs remain allowlisted. Google continues to
  return to the Supabase provider callback first.

Keep these reviewed project-level Auth rate boundaries:

| Boundary               | Staging value               |
| ---------------------- | --------------------------- |
| Anonymous sign-ins     | 30 per hour per IP          |
| Email sends            | 30 per hour project-wide with custom SMTP |
| OTP/magic-link requests to `/auth/v1/otp` | 30 per hour project-wide, combined across users |
| Repeat OTP/magic-link request for the same user | At least 60 seconds after the prior request |
| Verification requests  | 30 per five minutes per IP  |
| Refresh-token requests | 150 per five minutes per IP |
| SMS sends              | 30 per hour                 |
| Web3 requests          | 30 per hour per IP          |

An Auth `429` is a stop signal for the current attempt, not permission for an
automatic retry loop. The client may explain the cooldown and offer a bounded
user-initiated retry. Client-side throttling is not an abuse control. The locked
guest-draft resolver, upload-token fences, and per-case analysis leases continue
to bound work after Auth succeeds.

Use this activation order:

1. Capture a sanitized Auth baseline: booleans, provider name, rate values,
   Site URL, callback list, template structure, and whether SMTP fields exist.
   Never print the CAPTCHA, SMTP, OAuth, service-role, or provider secret.
2. Create the exact-hostname managed widget and configure the real public site
   key in the staging build. Keep Supabase CAPTCHA disabled.
3. Deploy the CAPTCHA-aware frontend and confirm its anonymous and magic-link
   calls both carry separately minted tokens. Preserve the single-flight guest
   request behavior. Mocked unit tests do not satisfy this live boundary. Local
   browser tests using the official invisible test key must target local/test
   Auth with the matching test secret, never the shared linked project.
4. Through narrowly targeted Dashboard controls or a targeted Auth Management
   API update, store the secret, select `turnstile`, and enable CAPTCHA,
   anonymous sign-in, and new-user signup. Do not run `supabase config push`:
   local Auth development settings are not the live staging source of truth and
   a broad push can overwrite unrelated project-wide configuration.
5. Read back only sanitized fields. Prove tokenless or invalid-token anonymous
   sign-in fails, valid anonymous sign-in succeeds once, a fresh token can send
   the late magic link, the verified user claims the case, and existing Google
   and email callbacks still work.

Enter the Turnstile secret through the Dashboard credential control. If the
Management API is used for non-secret fields, send a `PATCH` to
`/v1/projects/{ref}/config/auth` with only
`external_anonymous_users_enabled: true`, `disable_signup: false`,
`security_captcha_provider: "turnstile"`, and
`security_captcha_enabled: true`, staged in the activation order above. Do not
reuse a full configuration response as the request body, and never put
`security_captcha_secret` in a command argument or transcript. Read back only
those four sanitized fields.

For an Auth or Turnstile rollback, stop new intake and restrict Access to the
operator first. Disable anonymous sign-in and new-user signup before disabling
CAPTCHA, preventing an unprotected account-creation window. Read back the
sanitized baseline, then route staging to a prior CAPTCHA-unaware Worker only
after CAPTCHA is disabled; otherwise its `/signup` and `/otp` requests fail
closed. The equivalent targeted patches set
`external_anonymous_users_enabled: false` and `disable_signup: true` first, then
set `security_captcha_enabled: false` separately. Wait for active analysis
leases to settle before cleanup. Do not copy
the widget secret into an emergency command merely to remove it; leaving an
inert secret stored while CAPTCHA is disabled is safer, and later rotation or
removal is a separate controlled action.

## One-time staging observability setup

The repository has no established infrastructure-as-code or deployment-config
directory. Keep the following as operator-managed staging configuration until a
reviewed infrastructure pattern is introduced. Do not add generated policy
files or environment exports to the repository.

### Enable allowlisted provider diagnostics in staging

`VENFOUR_PROVIDER_DIAGNOSTICS=1` enables only the bounded provider-failure event
implemented in `venfour/orchestration.py`. It does not log credentials,
authenticated URLs, VINs, response bodies, or raw provider parameters. The flag
is non-secret, but changing it creates a new Cloud Run revision.

The operator must run this change separately from repository work. First save
the current revision name in the private rollout record:

```sh
staging_project=venfour-prod
staging_region=us-east4
staging_service=venfour-api-staging
previous_revision="$(gcloud run services describe "$staging_service" \
  --project="$staging_project" \
  --region="$staging_region" \
  --format='value(status.traffic[percent=100].revisionName)')"
revision_suffix="beta-diag-$(date -u +%Y%m%d%H%M)"
candidate_revision="${staging_service}-${revision_suffix}"

gcloud run services update "$staging_service" \
  --project="$staging_project" \
  --region="$staging_region" \
  --update-env-vars=VENFOUR_PROVIDER_DIAGNOSTICS=1 \
  --revision-suffix="$revision_suffix" \
  --tag=beta-diagnostics \
  --no-traffic
```

Verify only the new flag, then use the tagged URL printed by the update command
to check liveness and structural readiness. Do not print the revision's complete
environment or secret bindings.

```sh
gcloud run revisions describe "$candidate_revision" \
  --project="$staging_project" \
  --region="$staging_region" \
  --flatten='spec.containers[0].env' \
  --filter='spec.containers[0].env.name=VENFOUR_PROVIDER_DIAGNOSTICS' \
  --format='value(spec.containers[0].env.value)'

curl --fail --silent --show-error <TAGGED_REVISION_URL>/health
curl --fail --silent --show-error <TAGGED_REVISION_URL>/ready
```

Both responses must be successful and the filtered environment output must be
exactly `1`. Then route staging traffic to the candidate:

```sh
gcloud run services update-traffic "$staging_service" \
  --project="$staging_project" \
  --region="$staging_region" \
  --to-revisions="$candidate_revision=100"
```

If any verification fails, do not shift traffic. If a post-shift check fails,
roll back immediately:

```sh
gcloud run services update-traffic "$staging_service" \
  --project="$staging_project" \
  --region="$staging_region" \
  --to-revisions="$previous_revision=100"
```

At beta close, remove the flag with `--remove-env-vars` through the same
no-traffic, tagged-revision, health-check, and traffic-shift sequence. Never use
`--set-env-vars`; it can remove the service's other environment configuration.

### Create the lifecycle counter and single Cloud Monitoring policy

Use one policy named exactly `Venfour staging analysis health`, with combiner
`OR` and three conditions:

1. at least one `case_analysis_failed` lifecycle event in five minutes;
2. at least one Cloud Run `5xx` response in five minutes; or
3. Cloud Run p95 request latency greater than 600 seconds for five minutes.

A log-match condition cannot be combined with metric-threshold conditions in
one policy. First create one project log-based counter metric for the structured
failure lifecycle event, then use that metric in the three-condition policy.
Cloud Run parses the compact JSON lifecycle lines as `jsonPayload`; the metric
filter must match `jsonPayload.event="case_analysis_failed"`. Counter metrics
and `request_count` both use `ALIGN_SUM`, not a delta aligner. The latency metric
is reported in milliseconds, so the threshold is `600000`.

Before creation, select and independently test an existing private notification
channel in Cloud Monitoring. Put its full resource name in
`MONITORING_CHANNEL`. The value is configuration, not a participant identifier,
but it still must not be committed.

Create the counter only when there is no exact name match. Any duplicate or
unexpected match is a stop condition:

```sh
staging_project=venfour-prod
metric_name=venfour_staging_case_analysis_failed
metric_matches="$(gcloud logging metrics list \
  --project="$staging_project" \
  --format='value(name)' | awk -v name="$metric_name" '$0 == name { count++ } END { print count + 0 }')"

case "$metric_matches" in
  0)
    gcloud logging metrics create "$metric_name" \
      --project="$staging_project" \
      --description='Count staging case-analysis failure lifecycle events.' \
      --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="venfour-api-staging" AND resource.labels.location="us-east4" AND jsonPayload.event="case_analysis_failed"'
    ;;
  1)
    echo 'Exact counter already exists; review it before continuing.' >&2
    ;;
  *)
    echo 'Unexpected duplicate counter names; stop.' >&2
    exit 1
    ;;
esac

gcloud logging metrics describe "$metric_name" \
  --project="$staging_project" \
  --format='yaml(name,filter,metricDescriptor.metricKind,metricDescriptor.valueType)'
```

The reviewed output must show the exact filter above, metric kind `DELTA`, and
value type `INT64`. If the counter already existed with a different definition,
stop; do not replace it during a beta window.

Check that the policy does not already exist:

```sh
alert_name='Venfour staging analysis health'

gcloud monitoring policies list \
  --project="$staging_project" \
  --filter="display_name=\"$alert_name\"" \
  --format='table(name,displayName,enabled)'
```

If any matching policy exists, stop and review it; do not create a duplicate.
After the counter exists and the notification channel has been tested, create
the one OR policy from a temporary file outside the repository:

```sh
: "${MONITORING_CHANNEL:?Set the full tested notification-channel resource name}"
policy_file="$(mktemp)"
trap 'rm -f "$policy_file"' EXIT

jq -n --arg channel "$MONITORING_CHANNEL" '
{
  displayName: "Venfour staging analysis health",
  combiner: "OR",
  enabled: true,
  notificationChannels: [$channel],
  userLabels: {environment: "staging", service: "venfour-api-staging"},
  documentation: {
    mimeType: "text/markdown",
    content: "Stop closed-beta intake and apply the closed-beta runbook before resuming."
  },
  conditions: [
    {
      displayName: "At least one staging analysis failure in five minutes",
      conditionThreshold: {
        filter: "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"venfour-api-staging\" AND resource.label.\"location\"=\"us-east4\" AND metric.type=\"logging.googleapis.com/user/venfour_staging_case_analysis_failed\"",
        aggregations: [{
          alignmentPeriod: "300s",
          perSeriesAligner: "ALIGN_SUM",
          crossSeriesReducer: "REDUCE_SUM",
          groupByFields: ["resource.label.\"service_name\""]
        }],
        comparison: "COMPARISON_GT",
        thresholdValue: 0,
        duration: "0s",
        trigger: {count: 1}
      }
    },
    {
      displayName: "At least one staging Cloud Run 5xx in five minutes",
      conditionThreshold: {
        filter: "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"venfour-api-staging\" AND resource.label.\"location\"=\"us-east4\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.\"response_code_class\"=\"5xx\"",
        aggregations: [{
          alignmentPeriod: "300s",
          perSeriesAligner: "ALIGN_SUM",
          crossSeriesReducer: "REDUCE_SUM",
          groupByFields: ["resource.label.\"service_name\""]
        }],
        comparison: "COMPARISON_GT",
        thresholdValue: 0,
        duration: "0s",
        trigger: {count: 1}
      }
    },
    {
      displayName: "Staging p95 request latency above 600 seconds for five minutes",
      conditionThreshold: {
        filter: "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"venfour-api-staging\" AND resource.label.\"location\"=\"us-east4\" AND metric.type=\"run.googleapis.com/request_latencies\"",
        aggregations: [{
          alignmentPeriod: "300s",
          perSeriesAligner: "ALIGN_PERCENTILE_95",
          crossSeriesReducer: "REDUCE_MAX",
          groupByFields: ["resource.label.\"service_name\""]
        }],
        comparison: "COMPARISON_GT",
        thresholdValue: 600000,
        duration: "300s",
        trigger: {count: 1}
      }
    }
  ]
}' >"$policy_file"

gcloud monitoring policies create \
  --project="$staging_project" \
  --policy-from-file="$policy_file"

rm -f "$policy_file"
trap - EXIT
```

List and describe the policy again. The strict setup gate is exactly one enabled
match with combiner `OR`, exactly three conditions, and the tested channel
attached. The first two conditions must show `ALIGN_SUM`; the latency condition
must show `ALIGN_PERCENTILE_95`, threshold `600000`, and duration `300s`.

## Canary preflight

Complete all checks in order. A missing result is a failure.

1. Confirm the approved release evidence.
2. Confirm `Venfour staging analysis health` exists exactly once, is enabled,
   has three conditions with combiner `OR`, and its notification channel was
   tested.
3. Confirm Cloudflare Access has no public bypass and contains only the approved
   internal-canary operator at this stage. Do not provision cohort testers yet.
4. Confirm the managed Turnstile widget allows only `staging.venfour.com`, the
   deployed public site key corresponds to that widget, and no official test key
   is present in the staging build. Do not display or retrieve the widget secret.
5. Confirm Supabase CAPTCHA is enabled with provider `turnstile`, anonymous
   sign-in and Email Auth signup are enabled, email confirmation is required,
   and OTP expiry is 3600 seconds. The internal-canary operator must not have a
   pre-provisioned application user.
6. Confirm custom SMTP fields exist, the Site URL and three exact callback URLs
   remain correct, and both email templates contain the approved token-hash
   callback structure. Do not send or screenshot secret-bearing configuration.
7. Confirm every Auth rate boundary matches the reviewed table above. Do not
   exhaust a limit as a test.
8. Confirm the production apex and `www` are still unpublished for this
   staging-only release. If either now serves a client that uses the shared
   Supabase project, stop until its CAPTCHA compatibility is proven.
9. Confirm direct protected API access still fails without the server-only
   staging proxy credential.
10. Confirm `/health` and `/ready` succeed. Remember that `/ready` validates
    configuration structure; it does not call Supabase or a provider.
11. Confirm the participant's consent is current.
12. Confirm the active-processing count is exactly zero with the private SQL
    console:

```sql
select count(*) as active_processing_jobs
from public.total_loss_analysis_jobs
where status = 'processing'
  and processing_expires_at > statement_timestamp();
```

Do not begin if the count is not zero. An expired processing row is not an
active request, but it must be understood before the same case is resumed.

Read-only network checks may use:

```sh
curl --head --max-time 20 https://staging.venfour.com/
curl --fail --silent --show-error --max-time 20 \
  https://venfour-api-staging-640078527158.us-east4.run.app/health
curl --fail --silent --show-error --max-time 20 \
  https://venfour-api-staging-640078527158.us-east4.run.app/ready
curl --silent --show-error --max-time 20 \
  https://venfour-api-staging-640078527158.us-east4.run.app/api/v1/appraisal-cases/00000000-0000-4000-8000-000000000001/analysis
```

The staging root should redirect an unauthenticated client to Access. Health
and readiness should return `200`. The direct protected API check should return
`403` with `STAGING_PROXY_REQUIRED`. Do not follow or save Access redirect URLs.

### Staging smoke gates

Complete every smoke gate before the internal canary matrix. Record only
statuses and counts:

1. **Access redirect:** a signed-out request to `https://staging.venfour.com/`
   redirects to Cloudflare Access. Do not follow or record the redirect URL.
2. **Direct API denial:** the direct protected API request above returns `403`
   with `STAGING_PROXY_REQUIRED`.
3. **Proxied unauthenticated denial:** through an Access-approved browser that
   is signed out of the application, request the same synthetic protected path
   on `staging.venfour.com`; it returns `401` with
   `AUTHENTICATION_REQUIRED`. Do not put Access tokens in a shell command.
4. **CAPTCHA fails closed:** a direct anonymous Auth request without a CAPTCHA
   token and one with an invalid token both fail without creating a user. Record
   only pass/fail and bounded status/error codes; never copy the response body,
   public key, request URL, or a real token to the scorecard.
5. **Deep links:** through an Access-approved browser, directly open and refresh
   `/start?service=total-loss`. It renders the intended SPA route, not an edge 404. After the first internal mode canary claims its case, repeat this for
   `/appraisals` and the analysis deep link.
6. **No API caching:** inspect the proxied API response and confirm both
   `Cache-Control` and `CDN-Cache-Control` are
   `private, no-store, max-age=0`; no API response may be served as a cache hit.
7. **Health policy delivery:** after creating the policy, inject one structured,
   non-customer test event to validate the lifecycle counter and notification
   path. Use the active revision recorded in release evidence:

```sh
active_revision=<APPROVED_ACTIVE_REVISION>

gcloud logging write venfour-closed-beta-alert-test \
  '{"event":"case_analysis_failed","alertTest":true}' \
  --project=venfour-prod \
  --payload-type=json \
  --severity=ERROR \
  --monitored-resource-type=cloud_run_revision \
  --monitored-resource-labels="project_id=venfour-prod,location=us-east4,service_name=venfour-api-staging,revision_name=$active_revision,configuration_name=venfour-api-staging"
```

The exact counter must increment, the `Venfour staging analysis health` incident
must open, and the tested channel must receive it. Record that this was a
synthetic setup event, wait for the incident to close, and confirm there is no
open incident before the canary. Do not trigger an application or provider
failure to test delivery.

## Serialized canary and cohort sequence

The beta has two stages:

1. three serialized internal mode canaries: one no-report manual intake, one
   supported CCC report, and one report whose provider is not identified; then
2. five named testers, each provisioned in Cloudflare Access with written
   consent, processing 10 to 20 Total Loss samples in total. Do not
   pre-provision application Auth users; the protected guest-first email flow
   creates and verifies each permanent account near the end of intake.

Keep tester names, account identities, case IDs, and the mapping to anonymous
sample IDs in the approved restricted operational system. The scorecard uses
anonymous sample IDs such as `TL-001`; job IDs and run IDs are allowed there for
lifecycle reconciliation. Select the cohort deliberately across different
intake modes, report-provider outcomes, carrier/template categories when
applicable, vehicle categories, and source-quality categories. Do not claim
coverage that the 10 to 20 samples did not actually provide.

### Internal canary matrix

Repeat this sequence in strict serial order for each required canary mode:
`NO-REPORT`, `SUPPORTED-CCC`, and `UNKNOWN-PROVIDER`. Use a different authorized
sample for each mode. A mode passes only when its own lifecycle, recovery,
claim, privacy, and evidence checks pass. Do not provision cohort testers until
all three modes record `GO`.

1. Allocate an anonymous sample ID and open the private scorecard.
2. Recheck written consent and the zero-active-processing gate.
3. Sign in through Access only, open Total Loss, and confirm that the app asks
   for no application sign-in. The interaction-only Turnstile challenge must
   complete before exactly one hidden anonymous session and one owned draft are
   created. Duplicate clicks must not create another guest or draft.
4. Exercise only the assigned mode:
   - `NO-REPORT`: choose the no-report path, complete the required manual facts,
     and prove that no report upload lease, object, filename, or report-review
     claim is created.
   - `SUPPORTED-CCC`: upload one authorized CCC PDF from the tester's own
     device, confirm the report provider is recognized, and review the extracted
     facts before confirmation.
   - `UNKNOWN-PROVIDER`: upload one authorized valuation report whose provider
     is not identified, confirm the UI presents that bounded state without
     treating it as CCC, and complete any required facts manually while the
     report remains case-owned evidence.
     For either report mode, the operator must not receive or retain a copy.
     Complete intake and enter the tester's name, email, and legal
     acknowledgements near the end.
5. Confirm sending the access email executes a new `magic-link` Turnstile
   challenge, not the earlier anonymous-auth challenge. The email may be sent
   before analysis, but for this canary do not redeem it until the guest result
   is visible. If sending fails, confirm intake stays saved and stop before the
   next sample.
6. Start analysis once. Confirm the active-processing count becomes exactly one,
   wait for a durable terminal state, and view the result in the guest session.
7. Reconcile one `case_analysis_started` event and one terminal lifecycle event
   to the scorecard's allowed job ID and run ID. A successful canary must have
   exactly one job and one immutable analysis artifact.
8. Before redeeming the email link, close and reopen the application without
   clearing `staging.venfour.com` site data. Confirm the same anonymous session,
   draft, and result resume and that no second guest, case, job, or artifact is
   created.
9. Open the email link. Confirm Supabase verifies a permanent, non-anonymous
   user whose exact verified email matches the pending claim, then atomically
   transfers the case. The guest session must lose case and Storage access, the
   permanent user must retain case access, and the admin case view must change
   from guest/unclaimed to claimed without exposing another customer's data. In
   either report mode, also confirm the permanent user retains access to the
   immutable report namespace. The no-report mode must still have no report
   object.
10. Close the application, clear all `staging.venfour.com` browser site data and
   local state, sign in again, and enter through `/appraisals`. Open the saved
   result and its deep link. The same result must be recoverable without prior
   browser state, and no second job or artifact may appear.
11. Compare the result to the source evidence on the tester's device. For report
    modes, visually verify every applicable material report field. For the
    no-report mode, verify the confirmed manual facts and ensure the result does
    not claim to have reviewed a report or report-only evidence. Mark
    non-applicable report fields as such rather than treating them as passes.
12. Review the result's conclusions and limitations separately. Facts must match
    the evidence; conclusions must be conservative, explain uncertainty, avoid a
    guaranteed recovery or legal entitlement, and make material evidence limits
    visible.
13. Complete Auth, monitoring, lifecycle, privacy, provider-usage, and cost
    checks. Confirm the active-processing count returned to zero and no CAPTCHA
    token or callback value appeared in logs or retained browser evidence.
14. Apply the strict sample and mode gates. Start the next internal mode only
    after the reviewer records `GO`. After all three required modes record `GO`,
    run the mandatory release canaries below; do not provision testers until all
    five also record `PASS`.

For each internal mode canary, use the restricted SQL console to verify exactly
one job and one artifact. Resolve `<RESTRICTED_CASE_ID>` outside the scorecard
and do not copy it into command output retained with the scorecard:

```sql
select
  analysis_job.id as job_id,
  analysis_job.run_id,
  analysis_job.status,
  analysis_job.attempt_count,
  count(analysis_run.id) as artifact_count
from public.total_loss_analysis_jobs as analysis_job
left join public.analysis_runs as analysis_run
  on analysis_run.job_id = analysis_job.id
 and analysis_run.case_id = analysis_job.case_id
where analysis_job.case_id = '<RESTRICTED_CASE_ID>'::uuid
group by
  analysis_job.id,
  analysis_job.run_id,
  analysis_job.status,
  analysis_job.attempt_count;
```

Each successful canary result is one row, status `completed`, attempt count one,
and `artifact_count = 1`. The returned job ID and run ID may be copied to the
private scorecard; the case ID may not.

### Mandatory release security, recovery, and UX canaries

Run every canary below once per release after the three mode canaries and before
provisioning the tester cohort. They are execution gates, not optional stop
conditions. Use only controlled staging identities and synthetic files, keep all
direct identifiers out of the scorecard, and record `NO-GO` if any canary is not
run, is inconclusive, or fails.

1. **Cleared-guest limitation:** use a separate disposable, unsubmitted guest
   draft with no report, claim, or analysis. Confirm it resumes while browser
   site data remains. Clear the site data, confirm the old anonymous session
   cannot be recovered and the new guest cannot read that case or Storage
   namespace, then retire the disposable data through the approved staging
   procedure. Never clear the active mode canary before it is claimed.
2. **Existing-account collision:** from a fresh guest case, enter an email that
   already belongs to a controlled permanent Venfour user, authenticate as that
   user, and confirm the intended case is claimed without a duplicate permanent
   identity, an unauthorized merge, or access to any unrelated case or object.
3. **Cross-user negatives:** with two controlled identities and cases, prove
   that the other user's case ID and private Storage path remain inaccessible;
   invalid or expired callback/claim material cannot transfer ownership; and a
   signed-in user cannot claim the other user's case. Recheck valid owner access
   after every denial.
4. **Upload and analysis fences:** prove a corrupt or invalid upload and a
   synthetic upload larger than the 50 MiB limit fail without extraction or
   analysis work. Submit the same valid case repeatedly or concurrently and
   confirm idempotency, the processing lease/token fence, exactly one durable
   job, and at most one immutable artifact.
5. **Responsive customer journey:** repeat the critical beginning-to-results
   path at `1440x1000` and `390x844`. At both sizes confirm there is no internal
   release copy, CCC-only wording, visible anonymous-auth oddity, early contact
   gate, CAPTCHA overflow, missing trim, horizontal overflow, unusable upload or
   correction state, unclear review/error/loading state, or misleading result
   scope.

All five canaries must record `PASS` in the scorecard before a cohort decision
can be `GO`.

### Five-tester cohort

Only after all three internal mode canaries record `GO` and all five mandatory
release canaries record `PASS`, provision the five named testers in Cloudflare
Access. Do not pre-provision application Auth users.
Confirm each tester's written consent in the restricted consent system, and
confirm that anonymous sign-in and email signup remain protected by Turnstile.
Stop if the Access policy has a public bypass or any unapproved identity.

For every one of the 10 to 20 samples, repeat the applicable mode-aware canary
sequence in strict serial order. Do not start the next intake until the current
sample is terminal, recovered through `/appraisals` after local-state removal,
reviewed, and given a per-sample go decision.

Record for each sample: anonymous sample ID, allowed job ID and run ID,
intake mode, bounded report-provider outcome, carrier/template category when
applicable, vehicle category, source-quality category, start and end times,
duration, attempt count, outcome or bounded failure code, controlled retry
result if applicable, material-field verification, conclusion/limitations
review, and provider usage/cost. Maintain cohort-wide aggregate provider usage
and cost without participant or document identifiers.

After a tester reviews at least one completed result, ask them to explain in
their own words: the insurer's value, Venfour's main evidence-based observation,
the limits on what the evidence proves, and how they would find the result again.
Mark comprehension `PASS` only when all four are understood without corrective
prompting. The cohort gate requires at least four of five testers to pass.

Do not perform an automatic or unreviewed retry. If a sample reaches a retryable
terminal failure, stop new intake, record the first-attempt failure and alert,
review the bounded failure code, and permit at most one controlled retry after
the stop condition is resolved. Record whether that retry recovered the same
job/result. A retry never converts the first attempt into a first-attempt
success.

The Cloud Run service is currently configured for concurrency one and one
maximum instance, but that infrastructure setting is not the serialization
control. The operator gate is authoritative for the beta.

## Monitoring checks

Use Cloud Run request metadata without outputting request URLs. The following
query shows only method, status, latency, and revision for the last hour:

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="venfour-api-staging" AND logName:"run.googleapis.com%2Frequests"' \
  --project=venfour-prod \
  --freshness=1h \
  --limit=100 \
  --format='table(timestamp,httpRequest.requestMethod,httpRequest.status,httpRequest.latency,resource.labels.revision_name)'
```

Count allowlisted provider-failure events without printing their payloads:

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="venfour-api-staging" AND textPayload:"\"event\":\"market_provider_failure\""' \
  --project=venfour-prod \
  --freshness=1h \
  --limit=1000 \
  --format='value(timestamp)' | wc -l
```

Reconcile the privacy-safe lifecycle events. Job IDs and run IDs may be shown
only in the restricted operator session and private scorecard:

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="venfour-api-staging" AND (jsonPayload.event="case_analysis_started" OR jsonPayload.event="case_analysis_completed" OR jsonPayload.event="case_analysis_failed")' \
  --project=venfour-prod \
  --freshness=1h \
  --limit=1000 \
  --format='table(timestamp,jsonPayload.event,jsonPayload.jobId,jsonPayload.runId,jsonPayload.attemptCount,jsonPayload.durationMs,jsonPayload.failureCode,jsonPayload.retryable)'
```

Each claimed attempt has one `case_analysis_started` event and one durable
terminal event with the same job ID, run ID, and attempt count. A completed
sample's terminal `durationMs` supplies the scorecard duration. Missing,
duplicate, mismatched, or out-of-order lifecycle evidence is a stop condition.

Also check, without exporting participant data:

- the setup alert-delivery test succeeded and the health policy has no open
  incident at the sample decision time;
- the canary has exactly one terminal job and no live processing lease;
- no unexpected retry or duplicate run was created;
- p95 lifecycle duration and Cloud Run request latency stay at or below 600
  seconds for the aggregate decision;
- per-sample and aggregate provider usage and cost reconcile to the 10 to 20
  submitted samples; and
- no log, alert, or scorecard contains PII, a direct identifier, a PDF, request
  URL, filename, VIN, or provider response.

## Strict go/no-go gate

The per-sample decision is **go** only when consent and release evidence stayed
current, exactly one case was in flight, the lifecycle and database records
reconcile, active processing returned to zero, recovery and review checks pass,
no stop condition remains, and the reviewer approves the result. A failure that
is eligible for a controlled retry still records a first-attempt failure.

All three internal mode canaries must pass every per-sample and mode gate before
tester intake. After 10 to 20 tester samples, the cohort decision is **go** only
when every exact aggregate gate below passes:

- first-attempt success is at least 90%: completed-on-attempt-one samples divided
  by all submitted cohort samples is `>= 0.90`, with no rounding up;
- nearest-rank p95 first-attempt lifecycle duration is at most 600 seconds:
  include every submitted cohort sample, sort durations ascending, and select
  rank `ceil(0.95 * submitted_sample_count)`;
- every completed result is recoverable through `/appraisals` after removal of
  browser local state, with no additional job or artifact;
- at least four of the five testers pass the four-part comprehension check;
- authorization or ownership failures: zero;
- privacy failures or unauthorized exposure of a PDF, direct identifier,
  credential, request URL, or provider payload: zero;
- data-loss events: zero;
- duplicate jobs or artifacts: zero;
- jobs stuck beyond their lease or the 900-second request limit: zero; and
- silent material-field or conclusion errors: zero. A discrepancy discovered by
  visual review is silent when the product neither reported a bounded failure
  nor clearly disclosed the field/evidence limitation before human comparison.

The health policy must have no open incident and every prior incident must be
resolved and reviewed at the final decision. Aggregate provider usage and cost
must reconcile to the cohort, even though they are not used to waive another
gate.

Anything else is **no-go**. Do not average away a zero-tolerance failure, waive a
gate because a result appears plausible, or continue while a failure is being
investigated.

## Stop and revoke

Stop intake immediately when any of these occurs:

- consent is missing, ambiguous, expired, or withdrawn;
- more than one live processing job exists;
- a job is stuck beyond its lease or the Cloud Run request limit;
- any `Venfour staging analysis health` incident opens during a real sample or
  the monitoring channel is unavailable;
- a provider authentication, rate-limit, availability, or contract error is
  unexpected;
- a result is missing after local-state removal, a duplicate job or artifact
  appears, or lifecycle events do not reconcile;
- visual review finds a silent material-field error or a misleading or
  unsupported conclusion;
- Access, proxy-secret, bearer-token, ownership, RLS, or staff isolation fails;
- tokenless Auth succeeds, Turnstile fails open, one token is reused across Auth
  operations, the widget/site-key hostname does not match, an unexpected Auth
  `429` occurs, or an Auth/CAPTCHA token appears in logs or retained evidence;
- verified-email claim transfer fails, the guest keeps access after transfer, or
  the permanent user cannot recover the claimed case;
- a frontend using the shared Supabase project appears on the production apex or
  `www` without proven CAPTCHA compatibility;
- a secret, PDF, PII, direct identifier, request URL, filename, VIN, or provider
  payload appears in an unauthorized location;
- deployed release evidence changes during the window; or
- spend or quota usage exceeds the approved one-case envelope.

On stop:

1. Do not start or retry another case.
2. Restrict the Access Allow policy to the operator only; never add a bypass.
3. Revoke the affected participant's Access eligibility and disable further
   application sign-in through the approved administrative control.
4. Preserve only release identifiers, UTC times, aggregate counts, and bounded
   status codes in the private incident record.
5. If a request is already executing, wait until it returns or its processing
   lease expires before deleting its case. Do not delete a case while a trusted
   backend request can still write to it.
6. Complete the withdrawal/deletion procedure when required.
7. Resume only after the cause is fixed, the release is revalidated, monitoring
   is working, and both the release operator and reviewer approve a fresh
   canary.

If the stop affects shared Auth or Turnstile configuration, also perform the
Auth rollback in its required order: disable anonymous sign-in and new-user
signup, then disable CAPTCHA, then verify the sanitized baseline, and only then
route traffic to a CAPTCHA-unaware prior Worker. Never roll back the client first
while project-wide CAPTCHA remains enabled. Existing in-flight analysis may
settle under its current session; do not delete its data or revoke its session
mid-write.

## Automated abandoned anonymous guest cleanup

This automation retires only abandoned, unclaimed anonymous guests. It is not a
substitute for the participant withdrawal and closed-beta retention procedure
below. Supabase's anonymous-auth documentation says automatic cleanup is not
provided and shows a simple Auth age query. Do not run that query for Venfour:
it neither deletes Storage safely nor observes case, claim, or analysis state.

The implementation boundary is migration
`20260824000000_abandoned_anonymous_guest_cleanup.sql` and Edge Function
`supabase/functions/cleanup-abandoned-anonymous-guests/index.ts`. The Edge
function:

- accepts `POST` only;
- has `verify_jwt = false` because `pg_net` is the caller, but rejects every
  request that lacks a valid `X-Venfour-Cleanup-Secret`;
- compares that header by digest with Edge secret
  `VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET` and never logs either value;
- accepts `{ "dryRun": false, "batchSize": 25 }`, with both fields optional,
  a default batch size of 25, and a clamp of 1 through 100; and
- returns only `runId`, `status`, `dryRun`, `eligibleCount`, `markedCount`,
  `cancelledCount`, `claimedCount`, `completedCount`, `retryCount`, and
  `blockedCount`.

The custom header is a privileged schedule credential. Never put it or the Edge
URL with credentials in a command argument, environment file, log, screenshot,
scorecard, issue, or repository. Generate and inject the value through the
approved secret-management path. Store the same schedule value as the Edge
secret and in Vault, but verify only existence and wiring. The dispatcher reads
only these named Vault entries:

- `venfour_cleanup_edge_function_url`; and
- `venfour_cleanup_schedule_secret`.

Do not query `vault.decrypted_secrets`, echo an environment variable, or record
a configuration response containing a value. Listing just the two expected
Vault names and the Edge secret name is sufficient evidence.

### Eligibility and deletion contract

An eligible Auth user must still have `is_anonymous = true`, have no permanent
identity, and show at least 30 days of inactivity across Auth, profile, owned
case, Total Loss detail, and contact timestamps. The predicate excludes:

- staff and any identity-linked or permanent user;
- every non-draft case, every Diminished Value case, and any recently active
  case, detail, or contact;
- every completed intake and every unexpired report-upload lease;
- a completed claim or an unexpired active identity claim;
- any analysis job or analysis run, including a terminal attempt;
- a case whose report Storage owner does not match the anonymous user; and
- a transferred case whose immutable report namespace still belongs to the
  source guest.

A real invocation first cancels grace candidates that are no longer eligible,
then marks at most one bounded batch with a fresh 24-hour grace period and
claims at most one due batch. Claiming rechecks eligibility and creates a
durable lease. The Edge function permits only the canonical
`valuation-report.pdf` and `valuation-report-backup.pdf` paths recorded for the
candidate; an unexpected object blocks deletion. It deletes through the Storage
API and verifies the exact prefixes are empty before an Auth admin hard delete.
The preflight scans the candidate user's entire Storage root; an unexpected
sibling folder or object outside the snapshotted case prefixes also blocks the
candidate.
Private run/candidate state, durable leases, bounded retries, and an immutable
event journal make interruption recoverable. `storage_retry`, `storage_deleted`,
and a blocked candidate after Storage work require operator attention; operator
evidence remains count-only. Never skip the empty-prefix or Auth-order fence to
make a run green.

A dry run creates a count-only run and event and reports current eligibility. It
does not create or update candidate rows, delete Storage, or mutate Auth. Dry run
is therefore the required first invocation, but it is still privileged and must
use the approved secret-injection path.

### Schedule activation and daily checks

The migration immediately creates one active job named
`venfour-abandoned-anonymous-guest-cleanup-daily` at `17 3 * * *` UTC. That job
calls the database dispatcher, which uses `pg_net` to `POST` the default real-run
body to the Edge function with the Vault-backed header. Apply the migration only
in a controlled window, configure the Edge secret and both Vault entries
immediately, and complete the dry run before the first cadence. The dispatcher
fails closed when required configuration is absent, but do not leave the active
job misconfigured; unschedule it if readiness cannot be completed in the same
window. Before considering the schedule ready, the operator and reviewer must
confirm all of the following:

1. Local and linked migration lists include the cleanup migration with the same
   version, and the Edge function is the reviewed release.
2. `verify_jwt` is disabled only for this function; `GET` and missing, malformed,
   or wrong custom-secret requests fail without a cleanup run.
3. Edge secret `VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET` and both exact Vault
   names exist. Inspect names only, never values.
4. Exactly one active cron row has the exact job name, schedule
   `17 3 * * *`, and dispatcher command. No duplicate cleanup job exists.
5. A privileged `{ "dryRun": true, "batchSize": 25 }` invocation returns only
   the allowed fields, creates one matching dry-run audit, and leaves candidate,
   Storage, and Auth state unchanged.
6. The next real run produces one terminal run row. Reconcile its count-only
   result to the candidate state counts without recording a user ID or Storage
   path.

Use read-only, non-secret checks such as:

```sql
select jobname, schedule, command, active
from cron.job
where jobname = 'venfour-abandoned-anonymous-guest-cleanup-daily';

select name
from vault.secrets
where name in (
  'venfour_cleanup_edge_function_url',
  'venfour_cleanup_schedule_secret'
)
order by name;

select
  id as run_id,
  status,
  dry_run,
  eligible_count,
  marked_count,
  cancelled_count,
  claimed_count,
  completed_count,
  retry_count,
  blocked_count,
  started_at,
  completed_at
from public.anonymous_guest_cleanup_runs
order by started_at desc
limit 7;

select state, count(*)::integer as candidate_count
from public.anonymous_guest_cleanup_candidates
group by state
order by state;
```

After every daily run, check that it reached a terminal status, compare marked,
claimed, and completed counts with the expected grace behavior, and investigate
every nonzero `retryCount` or `blockedCount`. A skipped overlapping run, a run
left `running`, a missing audit, an unexpected response field, or a cron/Edge
failure stops cleanup operations until reviewed. Record only run ID, UTC time,
status, and counts in the restricted scorecard.

### Cleanup stop and rollback

To stop new invocations without discarding durable state, run exactly:

```sql
select cron.unschedule('venfour-abandoned-anonymous-guest-cleanup-daily');
```

Verify the named job is absent, then let or safely reconcile any `executing`,
`storage_retry`, `storage_deleted`, or partially processed `blocked` candidate.
Do not delete the Edge function, rotate the schedule secret, or remove database
objects while doing so; an interrupted retry still needs the same interface.
Do not drop the migration objects while any cleanup-frozen guest or partial
Storage/Auth deletion remains. Database rollback is manual and separately
reviewed only after those states are clear, no request or lease remains active,
and count-only audit evidence has been retained. Unscheduling alone is the
normal operational rollback.

## Retention, withdrawal, and privileged deletion

Delete beta case data no later than 30 calendar days after the participant's
beta case closes. If consent is withdrawn earlier, revoke access immediately,
allow any already-running request to settle, and complete deletion in that same
controlled operational session. An outage that prevents deletion keeps the beta
stopped until deletion is verified.

Storage must be deleted through the Storage API, never by deleting rows from
`storage.objects`. The bucket is private and case objects live under the exact
prefix `{userId}/{caseId}/`. Total Loss reserves `valuation-report.pdf` and
`valuation-report-backup.pdf`; Diminished Value documents, when present, live
under `{userId}/{caseId}/diminished-value/`.

Guest-first claims intentionally keep the report under the source guest's
immutable `report_storage_owner_id` prefix after `appraisal_cases.user_id`
changes to the verified permanent user. Do not assume those IDs are equal. The
manual procedure below requires both the current case-owner ID and immutable
Storage-owner ID and verifies the relationship before deleting an object.

Run the following privileged Total Loss procedure once per case from
`frontend/`. A Diminished Value deletion requires a separately reviewed
procedure. Supply all five values through a secure operator process environment.
Do not put the values in `.env`, shell history, a scorecard, or the repository.
The script prints counts only. Before mutation, it proves the current case owner
and immutable report Storage owner independently. It then removes every object
through the Storage API, verifies the prefix is empty, deletes the exact
owner/case row, and verifies all current cascade-owned rows are gone.

```sh
node --input-type=module <<'NODE'
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const supabaseUrl = required("VENFOUR_DELETE_SUPABASE_URL");
const serviceRoleKey = required("VENFOUR_DELETE_SERVICE_ROLE_KEY");
const caseOwnerId = required("VENFOUR_DELETE_CASE_OWNER_ID").toLowerCase();
const storageOwnerId = required("VENFOUR_DELETE_STORAGE_OWNER_ID").toLowerCase();
const caseId = required("VENFOUR_DELETE_CASE_ID").toLowerCase();
if (![caseOwnerId, storageOwnerId, caseId].every((value) => UUID.test(value))) {
  throw new Error("Deletion identifiers must be canonical UUIDs.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const bucket = supabase.storage.from("case-files");
const casePrefix = `${storageOwnerId}/${caseId}`;

async function listTree(prefix) {
  const objects = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const child = `${prefix}/${entry.name}`;
      if (entry.id === null) objects.push(...(await listTree(child)));
      else objects.push(child);
    }
    if (entries.length < pageSize) break;
  }
  return objects;
}

const { data: ownedCases, error: ownedCaseError } = await supabase
  .from("appraisal_cases")
  .select("id, service_type")
  .eq("id", caseId)
  .eq("user_id", caseOwnerId);
if (ownedCaseError) throw ownedCaseError;
if ((ownedCases ?? []).length !== 1 || ownedCases[0].service_type !== "total_loss") {
  throw new Error("The exact owned Total Loss case was not resolved; deletion stopped.");
}

const { data: totalLossDetails, error: detailError } = await supabase
  .from("total_loss_case_details")
  .select("case_id, report_storage_owner_id")
  .eq("case_id", caseId);
if (detailError) throw detailError;
if (
  (totalLossDetails ?? []).length !== 1 ||
  totalLossDetails[0].report_storage_owner_id !== storageOwnerId
) {
  throw new Error("The immutable report Storage owner did not match; deletion stopped.");
}

const objectPaths = await listTree(casePrefix);
if (objectPaths.length > 1000) {
  throw new Error("More than 1000 objects require a separately reviewed batch deletion.");
}
if (objectPaths.length > 0) {
  const { error } = await bucket.remove(objectPaths);
  if (error) throw error;
}
const storageAfterObjectDelete = await listTree(casePrefix);
if (storageAfterObjectDelete.length !== 0) {
  throw new Error("Storage verification failed; the case row was not deleted.");
}

const { data: deletedCases, error: deleteError } = await supabase
  .from("appraisal_cases")
  .delete()
  .eq("id", caseId)
  .eq("user_id", caseOwnerId)
  .select("id");
if (deleteError) throw deleteError;
if ((deletedCases ?? []).length !== 1) {
  throw new Error("The exact owned case was not deleted.");
}

const checks = [
  ["appraisal_cases", "id"],
  ["total_loss_case_details", "case_id"],
  ["diminished_value_case_details", "case_id"],
  ["total_loss_analysis_jobs", "case_id"],
  ["analysis_runs", "case_id"],
];
const remainingRows = {};
for (const [table, column] of checks) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, caseId);
  if (error) throw error;
  remainingRows[table] = count ?? 0;
}
const storageFinal = await listTree(casePrefix);
if (storageFinal.length !== 0 || Object.values(remainingRows).some(Boolean)) {
  throw new Error("Post-deletion verification failed.");
}

console.log(JSON.stringify({
  deletedObjectCount: objectPaths.length,
  deletedCaseCount: deletedCases.length,
  remainingObjectCount: storageFinal.length,
  remainingRows,
}));
NODE
```

Record only the returned counts and completion time in the private scorecard.
Unset the five deletion environment variables immediately after the command.
If the participant requested full account deletion, first repeat the case
procedure for every case the permanent user owns. For a transferred case,
separately reconcile the source guest's immutable Storage prefix and Auth
account; do not treat the permanent user's UUID as that prefix. Verify every
resolved prefix is empty and no `appraisal_cases` remain, then delete only the
Auth user covered by the request through the approved Supabase administrative
control. Verify the cascaded `profiles` and `staff_members` counts are zero. Do
not delete the source guest or permanent Auth user merely because one beta case
reached its retention date.

Deletion is complete only when all of these are true:

- exact case-prefix object count is zero;
- exact appraisal-case count is zero;
- Total Loss detail, Diminished Value detail, analysis-job, and analysis-run
  counts are all zero;
- any requested account deletion is verified separately; and
- the reviewer confirms the count-only evidence.

## Beta close

At close:

1. Stop new intake and wait for the active-processing count to reach zero.
2. Revoke all participant Access eligibility and disable their beta sign-in.
3. Schedule or complete every outstanding deletion.
4. Remove staging-only provider diagnostics through a reviewed new revision.
5. Keep the single `Venfour staging analysis health` policy until all deletion
   work and post-beta verification are complete.
6. Store aggregate outcomes and completed private scorecards only in the
   approved restricted operational system.
7. Confirm the repository contains no completed scorecard, participant document,
   PII, direct identifier, secret, or copied provider data.

## Current implementation references

- Staging runtime and perimeter: `README.md`, sections "Cloud Run staging
  runtime" and "Trusted-tester staging frontend".
- Provider diagnostic allowlist: `venfour/orchestration.py`.
- Staging Worker boundary: `frontend/wrangler.jsonc` and
  `frontend/worker/README.md`.
- Turnstile execution and Auth token handoff:
  `frontend/src/features/auth/turnstile-controller.ts`,
  `frontend/src/features/auth/auth-provider.tsx`, and
  `frontend/src/features/auth/auth-service.ts`.
- Anonymous-user identity and atomic exact-email claim: migration
  `20260823000200_guest_first_total_loss.sql`.
- Private bucket and owner/case prefix: migration
  `20260818000000_auth_and_appraisal_cases.sql`.
- Total Loss reserved report paths and deletion rules: migration
  `20260818000100_total_loss_case_details.sql`.
- Analysis cascade ownership: migration
  `20260819000000_total_loss_analysis_jobs.sql`.
- Conservative abandoned-guest eligibility, durable cleanup state, and daily
  dispatcher: migration
  `20260824000000_abandoned_anonymous_guest_cleanup.sql`.
- Storage-before-Auth cleanup executor:
  `supabase/functions/cleanup-abandoned-anonymous-guests/index.ts`.
- Diminished Value document prefix and mutation rules: migration
  `20260819000200_diminished_value_case_submission.sql` and frontend storage
  service.

External operator references:

- [Cloud Run environment variables](https://cloud.google.com/run/docs/configuring/services/environment-variables)
- [Cloud Run metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z)
- [Cloud Monitoring policy format](https://docs.cloud.google.com/monitoring/alerts/policies-in-json)
- [Supabase Storage object deletion](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase Storage schema safety](https://supabase.com/docs/guides/storage/schema/design)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase Auth Management API update](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Supabase scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
