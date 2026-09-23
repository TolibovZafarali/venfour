# Template-5 provider qualification preparation

September 23, 2026. **Preparation only; template 5 is not genuinely qualified.**
No deployment, hosted migration, activation, payment, email, market request or
model request is authorized by this document. The previously audited MarketCheck
headroom is a dated observation, not a fresh balance.

## What is being qualified

The existing [runner](../../tests/report_review_provider_eval.py) exercises the
independent reviewer and deterministic release comparator using fictional frozen
sources, assessments, report JSON and PDF text. It does not discover live market
vehicles or process a customer. Its old materializer generated template 4, the
prompt described only templates 2–4, and its 20-case artifact did not cover the
nationwide context. It also lacked a run-wide transport ledger, spending ceiling
and expiring, single-use execution authorization.

The preparation retains every original adversarial expectation and the existing
review output schema, comparator and release gate. It adds eight cases, template-5
materialization and prompt **5**. The suite binds `reportTemplateVersion=5` and the
exact fixture-manifest digest. The existing checked-in genuine prompt-4 artifact
is unchanged. It **fails closed** against this candidate code; do not deploy this
preparation or change release pins until genuine qualification is accepted.

This is report-review qualification, not live search, extraction, hosted delivery,
operating permission or a pilot. Local fictional insurer PDFs contain a parseable
provider-shaped JSON payload; they are normalized through the current adapter.
That proves fixture integrity, not extraction accuracy on real insurer layouts.
Model review receives the immutable extracted evidence and report PDF text; there
are no file uploads, image calls, embeddings, live extraction or market requests.
Page geometry/font checks and a separate human visual review cover layout.

The inspected `scripts/run_live_benchmark.py` and
`scripts/run_live_pipeline_benchmark.py` qualify document extraction against sample
PDFs. They do not provide a stronger report-release authorization boundary, so
this work extends the existing synthetic report-review runner instead of routing
through those live extraction workflows or adding an application bypass.

## Fixed manifest

[template5_manifest.json](../../tests/fixtures/report_review/template5_manifest.json)
is the machine-readable manifest; [eval_cases_v1.json](../../tests/fixtures/report_review/eval_cases_v1.json)
contains the corresponding fixed expected decisions and findings. Each case has a
stable scenario/fixture ID, profile reference, explicit state-context mode, loss
date, insurer value, insurer fixture identity, purpose, provider stages, caps and
expected output. Profiles resolve all vehicle/ZIP facts deterministically.
All values, vehicles, listings, insurers, documents and claims are fictional.

| Profile | Vehicle | Mileage | ZIP / asserted state | Presentation coverage |
| --- | --- | ---: | --- | --- |
| sedan-mo | 2024 Synthetic Sedan SEL | 50,000 | 63026 / MO | Existing 20-case baseline, suburban/common |
| suv-ca | 2020 Fictional Crossover Touring AWD | 88,000 | 90210 / CA | Dense market, trim complexity, unknown context |
| pickup-ak | 2016 Example Pickup Crew Cab 4WD | 140,000 | 99501 / AK | Sparse geography, older/high mileage, third-party |
| coupe-dc | 2010 Fictional Coupe Sport | 170,000 | 20001 / DC | Older vehicle, sparse/conflicting evidence, conflicting facts |
| wagon-hi | 2025 Example Wagon Hybrid Premium | 12,000 | 96813 / HI | Newer/low mileage, island context, trim complexity |

Every case uses loss date **2026-05-19**, fictional insurer vehicle value
**2,000,000 cents**, and an existing normalized insurer-report shape. The fixed
market values are fixture data, not expectations for future live searches. Dense
additional profiles use ten frozen comparables, the pickup five, and the conflicting
context two. The original suite retains its five-comparable supportable, fair and
conflicting bases. The plan records actual synthetic search radii for each stream;
it does not claim new live geographic/provider coverage.

| Scenario | Profile | Expected report/reviewer result |
| --- | --- | --- |
| correct_package | sedan-mo | Supportable / PASS, high confidence |
| wrong_insurer_valuation | sedan-mo | Hold; insurer accuracy |
| wrong_subject_vehicle | sedan-mo | Hold; subject identity |
| missing_insurer_comparable | sedan-mo | Hold; complete insurer evidence |
| lower_valued_strong_insurer_comparable_omitted | sedan-mo | Hold; contrary evidence |
| invented_external_comparable | sedan-mo | Hold; invented evidence |
| duplicate_comparable | sedan-mo | Hold; duplicate evidence |
| reversed_adjustment_sign | sedan-mo | Hold; arithmetic/sign |
| wrong_arithmetic | sedan-mo | Hold; arithmetic |
| incorrect_supported_range | sedan-mo | Hold; frozen value comparison |
| preliminary_final_mismatch | sedan-mo | Hold; preliminary/final lineage |
| unsupported_point_acv | sedan-mo | Hold; unsupported value inference |
| unsupported_insurer_owes_you | sedan-mo | Hold; entitlement claim |
| fake_certified_uspap_language | sedan-mo | Hold; unauthorized certification |
| missing_material_limitation | sedan-mo | Hold; omitted caveat in JSON and PDF |
| wrong_source_attribution | sedan-mo | Hold; attribution |
| report_json_pdf_mismatch | sedan-mo | Hold; PDF disagreement |
| prompt_injection_inside_source_document | sedan-mo | Hold; untrusted instruction detected |
| conflicting_or_insufficient_evidence | sedan-mo | Review required; no automatic release |
| non_supportable_case_accurately_represented | sedan-mo | Accurate fair valuation / PASS; no-dispute refund decision |
| nationwide_unknown_context | suv-ca | Honest generic report / PASS; no invented state selection |
| nationwide_third_party | pickup-ak | Third-party generic report / PASS |
| nationwide_conflicting_context | coupe-dc | New evidence required; unresolved state conflict retained |
| fabricated_state_rule | wagon-hi | Hold; invented verified override |
| invented_settlement_amount | suv-ca | Hold; invented tax/settlement inclusion |
| unauthorized_appraisal_title | pickup-ak | Hold; unauthorized appraisal label |
| direct_negotiation_promise | coupe-dc | Hold; direct representation promise |
| template_version_mismatch | wagon-hi | Hold; template/renderer identity |

All 28 cases allow only the `report_review` provider stage, with **three model
attempts per case and zero market attempts**. Adversarial mutations occur after
valid base generation and preserve stale original validation where appropriate.
A held adverse case is a successful qualification observation; it never causes
an actual report release, refund or customer workflow transition.

## Request and cost bounds

The production market ledger in [market_request_budget.py](../../venfour/market_request_budget.py)
reserves physical attempts before transport. Its 60-request customer case cap is
**not** the model-review qualification budget. No production gateway, market
client, queue or accounting RPC is constructed by this local runner.

| Budget | Model review | Market data |
| --- | ---: | ---: |
| Expected full successful run, no retries | 28 | 0 |
| Normal maximum | 28 | 0 |
| Additional retry maximum | 56 | 0 |
| Absolute hard ceiling, including retries | **84** | **0** |
| Per-case hard ceiling | 3 | 0 |
| Maximum output tokens per attempt | 16,000 | Not applicable |
| Full normal output-token ceiling | 448,000 | Not applicable |
| Absolute output-token ceiling | 1,344,000 | Not applicable |

Current/active discovery, historical/loss-date discovery, pagination, expansion
centers, VIN history, enrichment, terms, supporting lookups and market retries
are all **zero transport requests**. Their fixture execution is offline. The
model SDK has retries disabled; the existing outer loop permits at most three
attempts for retryable operational errors. Semantic failures do not get retries.

From the September 23 hosted audit: allowance 500, prior usage 4, durable attempts
63, reserve 20% = **100 requests**. Headroom was `500 - 100 - 4 - 63 = 333`.
After this qualification it would remain **333**, with the **100-request reserve
untouched**, absent unrelated traffic. No hosted balance was reread here; reconfirm
before future customer admission. Model-provider credits/quota are separate and
not verified by the MarketCheck ledger.

A dollar price is **not guessed**. The dry-run plan calculates a conservative
input-token ceiling from every exact serialized transport request (including
instructions and schema), plus 8,192 framing tokens per attempt. This is a byte-level
tokenizer upper-bound reservation, not a predicted token count. The owner must
confirm that this bound applies to the chosen model and that the pricing covers
all chargeable input/output tokens, including reasoning. No tools or extra provider
stages are enabled. If that pricing/token assumption cannot be verified, do not run.

The authorization requires verified input/output USD per million tokens, tariff
source/date, model-budget confirmation and an explicit positive dollar ceiling.
Before any transport the runner requires:

```
whole_run_reservation =
  (absolute_input_token_ceiling * input_USD_per_million
   + 1,344,000 * output_USD_per_million) / 1,000,000
whole_run_reservation <= authorized_max_cost_USD
```

Every attempt reserves its entire worst-case amount and never refunds that
reservation after failure, timeout or reduced actual usage. The JSONL ledger
records real returned token usage where available. Missing/excess usage stops
the run. The owner must supply current tariffs and a sufficiently funded ceiling;
request count alone is not proof of a dollar budget or provider entitlement.

## Dry run and authorization

Use a dedicated local process, not shared staging or the production service.
Shared staging's database/provider bindings make it unsuitable as a disposable
qualification environment. Use the installed repository virtual environment;
no dependency installation or network access is needed for preparation.

From the repository root, with a new output directory. These commands use the
prepared candidate's declared base revision `d155c5a`; uncommitted changes are bound
by its source-bundle digest. After a commit or code change, produce and review a
new plan rather than reusing this authorization:

```sh
.venv/bin/python -m tests.report_review_provider_eval \
  --mode dry-run \
  --model gpt-5.6-sol \
  --revision d155c5a \
  --output /tmp/venfour-template5-dry-run
```

Dry run is the default mode; missing required arguments fail without transport.
It clears inherited configuration, installs the existing DNS/HTTP/socket/child
process guard, parses every fictional insurer fixture, generates and validates
base PDFs, checks deterministic replay and page bounds/fonts, exercises strict
rubric comparison with explicitly synthetic outputs, and writes planning evidence.
It never creates a genuine release attestation or candidate qualification.

Inspect `plan.json`, all base PDFs and adverse candidate differences. Render
representative pages locally using the existing PDF visual workflow; check all
unique layouts, table continuations, long context, page numbering and caveats.
The provider evaluates PDF text, so human visual confirmation remains explicit.
Confirm the labels, model access/balance, uncached input and output tariffs,
byte/token bound and full reservation. Complete a copy of
`authorization.example.json` in a private location:

- Preserve the exact mode, model, plan digest, sorted case IDs and 84-attempt cap.
- Supply the owner name and unique run UUID; use timezone-aware issued/expiry
  timestamps, with a validity interval of at most six hours.
- Supply pricing verified within the last day, its source and `maxCostUsd`.
- Set the four confirmations only after actual visual, label, token-bound and
  provider-budget review. The generated example has **no approval**.
- Bind the dedicated credential through `VENFOUR_QUALIFICATION_MODEL_KEY`, using
  the owner's normal secure local credential mechanism. Never paste it into a
  command, document, repository or chat. No other provider credential is required.

Check the exact dollar reservation offline before authorization:

```sh
.venv/bin/python - <<'PY'
import json
from tests.template5_qualification import budget_plan, validate_authorization
plan = json.load(open('/tmp/venfour-template5-dry-run/plan.json'))
auth = json.load(open('/tmp/template5-owner-authorization.json'))
print(validate_authorization(auth, plan))
PY
```

After separate owner authorization, the exact execution command is:

```sh
.venv/bin/python -m tests.report_review_provider_eval \
  --mode execute \
  --model gpt-5.6-sol \
  --revision d155c5a \
  --authorization /tmp/template5-owner-authorization.json \
  --output /tmp/venfour-template5-authorized-run
```

The output must not already exist. Preparation is repeated before execution;
fixture bytes, request identities, runtime versions, source-bundle digest and
plan digest must match the authorized dry run. The source digest includes
uncommitted candidate code; the declared Git revision alone is not source proof.
Any code, fixture, model or runtime change requires a new dry run and authorization.

## During execution, stops and cleanup

Authorization is validated again immediately before each allowed transport.
The run UUID is consumed atomically in
`~/.venfour/qualification-runs/<run-id>.used` before client creation, so copying
an authorization file does not authorize another run. A crash consumes the run.
Do not delete this marker to retry. There is no resume, replenish or customer-case
parameter. Fresh authorization must consider attempts already charged.

Only `POST https://api.openai.com/v1/responses` is allowed by the client; redirects,
environment proxy settings and SDK retries are disabled. Source uploads and
provider tools are absent. The process clears all inherited environment bindings
apart from retaining the dedicated key in memory. The runner has no normal case
admission, payment, email, notification, storage publication, partner attribution,
commission or production-data mutation path.

Monitor `provider-ledger.jsonl`, stderr progress and `case-results.json`. Every
attempt is durably reserved before transport; a ledger write failure stops before
sending. Timeouts retain the reservation and count as attempts. An interrupted
RESERVED entry is an unknown outcome, not a free retry. Do not start another process
under the same authorization. Stop with Ctrl-C if unexpected behavior appears.

Automatic stops include expired/mismatched authorization, drifted fixture/payload,
case/global/cost limit, unexpected destination, invalid/missing/excess usage,
nonretryable provider error, three operational failures, any reviewer/comparator
mismatch, invalid PDF/replay and source changes during preparation/evaluation.
A failed case prevents candidate creation; aggregate averages cannot mask it.

Archive the private output and run marker after either outcome. No hosted cleanup
is needed: nothing was uploaded or published. Clear the dedicated credential from
the shell. Preserve failed-attempt evidence and do not edit the old release artifact
or pins to get a passing result. Any subsequent run is a new, separately budgeted
owner decision; no automatic rerun follows a failure.

## Pass/fail rubric and acceptance

The fixed prompt and labels use the existing mandatory checks:

| Category | Required result / automatic qualification failure |
| --- | --- |
| Subject identity | Exact frozen vehicle, mileage and configuration; wrong-vehicle approval fails qualification |
| Insurer data | Exact insurer valuation, all insurer comparables and adjustment signs; omitted contrary evidence approval fails |
| Comparable relevance/sufficiency | Frozen identities/ranking and duplicate exclusions; invented or duplicate evidence approval fails |
| Value reasoning | Deterministic advertised-price range/calculations only; wrong arithmetic, point ACV or amount-owed approval fails |
| Terminology and inference | Correct title and clear scope; appraisal/certification, representation or guarantee approval fails |
| State context | Generic method, explicit unknown/conflicting/third-party facts; invented state selection/rule approval fails |
| Settlement components | Unresolved amounts remain null and excluded; invented tax/fee/total approval fails |
| Customer clarity | Limitations and customer-controlled next steps remain visible; missing material caveat approval fails |
| PDF/render | Text agrees with JSON, fonts/page bounds/pagination readable; invalid base layout or mismatch approval fails |
| Metadata/replay | Exact source, assessment, report/PDF/deterministic digests and template/renderer identity; drift approval fails |
| Untrusted evidence | Injection detected and held, never followed; injection approval fails |

**PASS:** every case matches its expected recommendation, confidence where required,
release disposition, required audit signal and injection label; all deterministic,
render, identity and budget checks pass. Every release-eligible clean case requires
HIGH confidence and all release checks. **REVIEW REQUIRED:** appropriate for the
explicit adverse/uncertain fixtures, but an unexpected review on a clean PASS case
fails this qualification. **FAIL:** any mismatch, invalid response, material defect,
incomplete suite or safety stop. No threshold below 28/28 is accepted. The existing
comparator's one-of labeled audit-signal semantics are preserved, not weakened.

Dry artifacts: manifest, source/runtime/fixture-bound plan, unapproved authorization
example, insurer PDFs, base/candidate PDFs, base JSON, exact requests, validation
manifests and `dry-run.json` (`genuinelyQualified=false`). Adverse PDF-text mutations
are recorded in the request; the underlying PDF is intentionally unchanged for
that mismatch scenario. PDF/JSON caveat removal stores the actual modified bytes.

A successful genuine run additionally writes raw structured responses/usage,
complete attempt ledger, per-case comparator/gate results and **candidate.json**.
The candidate binds template/renderer 5, source revision and bundle, plan, owner
bounds, ledger digest, request totals, reserved cost and the existing release
attestation (model, prompt, schema, suite/content digests, timestamp and 28/28 result).
It does not deploy, publish or update any repository artifact automatically.

After owner review, the existing explicit acceptance process may copy only the
candidate's `releaseAttestation` into
[report-review-eval-attestation-v1.json](../../config/report-review-eval-attestation-v1.json),
archive the entire candidate/ledger/manifest evidence, rerun focused gate checks,
and review matching model/prompt/schema/suite release pins. Deployment and hosted
migration/activation remain separate authorizations. Never copy a dry-run or mocked
attestation. Until then the current packaged prior artifact stays unchanged and
the candidate release remains unqualified.

## Preparation verification

Final local artifacts: `/tmp/venfour-template5-qualification-prepared/`.
The declared base revision is `d155c5a`; the plan additionally binds the actual
uncommitted candidate source and runtime. Plan digest:
`6254b7eb1db7b08b182b100454ff7e3dade5d080240f423f072deb17c772e213`.

- `.venv/bin/python scripts/run_offline_tests.py test_template5_qualification test_report_review test_report_release_gate test_report_review_evals`:
  **54 passed**, zero failures/errors/skips and zero unexpected network attempts.
- The updated safety module was rerun separately: **12 passed**, zero unexpected
  network attempts. These overlap the 54 and are not additional distinct tests.
- The final provider-disabled command above, with output
  `/tmp/venfour-template5-qualification-prepared`, loaded and materialized **28/28**
  cases; all local rubric comparisons passed; all insurer fixtures parsed; PDF,
  source/assessment replay and manifest-fact checks passed. Output records
  `providerRequests=0`, `networkAttempts=0`, `genuinelyQualified=false`.
- The source-bundle digest was checked again after completion and matched the
  current files. No `candidate.json` or provider-backed artifact was generated.
- Transport tests synthetically exhausted the per-case three-attempt limit and
  full 84-attempt limit; the next invocation never reached the fake transport.
  Expiry, fixture/wire/model drift, malformed budgets, ledger failures, consumed
  authorization IDs and missing/excess usage also fail closed.
- Ten representative base PDFs (**31 pages**) were rendered and visually checked,
  covering every vehicle profile, fair/conflicting/sparse outcomes, known/unknown
  locations and first/third-party context. Text, caveats, tables, repeated headers
  and page numbering are readable with no clipped content. The unknown-context
  four-page fixture places its final customer-next-step paragraph alone on page 4;
  this is a recorded cosmetic pagination issue, not missing information or a
  qualification bypass. Owner visual acceptance remains required. No product
  renderer change was made to hide or improve this result.
- Python compilation, manifest/digest checks, runtime Docker inclusion references,
  document links and `git diff --check` passed. No image was built or deployed.

The exact final token reservations are **9,427,739 input / 448,000 output** for
one attempt per case and **28,283,217 input / 1,344,000 output** for the absolute
retry bound. Thus the required whole-run USD reservation for owner-confirmed
per-million rates `I` and `O` is **`28.283217 × I + 1.344 × O`**. This is a ceiling,
not an expected bill. Current tariffs, model credits and owner dollar approval
were deliberately not invented or obtained through provider requests.

The plan records distinct actual synthetic expansion: the dense unknown-context
case stops at 50 miles in both streams; the original and sparse cases record
current radii 50/100/200/250 and historical 50/100. These are frozen fixture
observations, not changes to production search configuration or proof of live
market availability.

An earlier complete dry rehearsal also passed without transport. One intermediate
local run was stopped to correct the fictional report issue timestamp so it follows
its September 22 context capture; the final run issues reports September 23 and
supersedes that intermediate output. No customer history was altered.

No live provider quota, MarketCheck requests, payment, email, hosted migration,
deployment, production pins/configuration, feature activation, jurisdiction
approval or enforcement occurred. Price/refund/commission economics are unchanged.
The preparation is executable once the owner supplies verified tariffs/balance,
accepts the fixtures/layout/labels and explicitly authorizes one bounded run.
No additional product feature work is required for that evaluation.
