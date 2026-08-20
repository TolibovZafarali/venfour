<div align="center">
  <img src="assets/brand/venfour-mark.svg" alt="Venfour logo" width="128">
  <h1>Venfour</h1>
  <p><strong>Independent vehicle-valuation guidance for total-loss claims.</strong></p>
</div>

Venfour is a consumer-facing auto-accident assistance platform. Its current
product focus is helping people understand and evaluate total-loss vehicle
valuations.

Venfour acts as a self-service vehicle-valuation advisor: it reviews an
insurer's valuation, independently researches market evidence, identifies
meaningful discrepancies, and organizes clear evidence the vehicle owner can
use when discussing the settlement with an insurance adjuster. The customer
remains responsible for communicating with the insurer.

The broader company direction is to build a consumer-side intelligence and
assistance platform for navigating auto accidents and insurance claims with
less confusion, better organization, stronger evidence, and better-informed
decisions. That direction informs the product's terminology and architecture;
it does not mean those broader capabilities are implemented in this repository.

## Current repository scope

This repository contains the Python backend through Phase 3F and the
customer-facing analysis-results web application. The implemented backend
pipeline covers:

- structured extraction and validation of CCC valuation reports;
- normalized vehicle, valuation, and comparable data;
- current and historical market-evidence retrieval through provider boundaries;
- historical listing lifecycle verification;
- provider-neutral comparable eligibility, scoring, and ranking;
- deterministic valuation-discrepancy analysis;
- immutable analysis-run persistence with replay and integrity validation;
- deterministic presentation projection; and
- an authenticated, case-owned JSON API for durable synchronous analysis
  creation and validated presentation data.

```text
Insurance valuation report
        ↓
structured report understanding
        ↓
canonical vehicle, valuation, and comparable data
        ↓
independent current and historical market evidence
        ↓
provider-neutral comparable scoring and ranking
        ↓
deterministic discrepancy analysis
        ↓
immutable auditable analysis run
        ↓
deterministic presentation model
        ↓
JSON API
```

The customer-facing application includes a unified appraisal intake at
`/start`, with saved Total Loss and Diminished Value workflows. Diminished Value
customers can save intake data and private supporting documents, then submit an
immutable review request. A separate read-only staff surface exposes only
submitted Diminished Value requests to database-authorized staff. The Total
Loss intake accepts either manual vehicle and claim information or a privately
stored insurance valuation PDF. The frontend does not reproduce backend
analysis or ranking logic. The standalone public analysis-upload screen has
been retired; analysis creation now starts from an authenticated saved
appraisal case.

Supabase provides browser authentication, customer profiles, saved appraisal
cases, row-level security, private case-file storage, durable analysis-job
claims, and owned analysis-run artifacts. Case IDs remain separate from Python
analysis-run IDs, with the database job record providing the durable link.

## Evidence and engineering principles

Venfour distinguishes evidence from conclusions. An advertised vehicle price is
market evidence, not a guaranteed transaction price or proof that an insurer
legally owes a specific additional amount. Analysis remains conservative and
explicit about uncertainty; screening results are not legal entitlement, a
guaranteed settlement, an independent appraisal, or proof of insurer wrongdoing.

AI-assisted interpretation is used where document understanding requires it.
Once a report has been converted to strict structured data, established rules
for evidence eligibility, historical verification, comparable ranking,
calculations, and classifications remain deterministic and reproducible.

CCC and MarketCheck are current integrations rather than definitions of the
product. Existing domain boundaries keep core analysis provider-neutral where
the implementation already supports it.

## Frontend direction

The initial responsive web application lives in `frontend/` and uses React,
TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix
primitives. Product pages will be designed and reviewed individually before
implementation. The frontend must consume the backend's structured presentation
JSON rather than reproduce valuation calculations, evidence selection,
comparable ranking, historical verification, or discrepancy classification.

## CCC report extraction

The current extraction path reads structured valuation data directly from
original CCC PDFs. It sends the PDF to GPT-5.6 Sol (`gpt-5.6-sol`) with
high-detail input, requests strict structured output, and then validates the
result against the canonical CCC schema before writing it atomically.

PyMuPDF remains available through `scripts/extract_text.py` for diagnostics and
readable text exports. It is not the primary extractor because flattening a CCC
report to text can lose layout relationships that matter to tables, comparable
columns, field labels, and signed adjustments. Direct PDF extraction lets the
model use those visual relationships while still producing schema-validated
JSON.

## Setup

Create a virtual environment and install the Python dependencies:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

For local backend and frontend development, install the development dependency
set instead. Uvicorn is a runtime dependency and is also the ASGI server used by
the production container:

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
```

### Frontend development

The frontend is a separate npm application so its toolchain and generated files
remain isolated from the Python package. It requires Node.js `^22.13.0` or a
current release starting with Node.js 24.

```sh
cd frontend
npm install
npm run dev
```

Copy the root example environment file and provide the backend-only runtime
configuration before starting the API:

```sh
cp .env.example .env
```

The default authenticated path requires `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Live extraction and
market research additionally require `OPENAI_API_KEY` and
`MARKETCHECK_API_KEY`. The service-role key is a server secret: never expose it
to the browser, a `VITE_*` variable, logs, or an API response.

In a separate terminal, start the local Starlette API from the repository root:

```sh
set -a
source .env
set +a
.venv/bin/python -m uvicorn venfour.api:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

For local provider-failure diagnostics, opt in for that backend process only:

```sh
set -a
source .env
set +a
VENFOUR_PROVIDER_DIAGNOSTICS=1 \
  .venv/bin/python -m uvicorn venfour.api:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

The warning contains only the evidence stream, fixed retrieval stage, provider
error class, endpoint category, HTTP status, and numeric pagination/search
bounds that are available. It never logs credentials, authenticated URLs, VINs,
response bodies, or raw provider parameters. Public API error payloads remain
unchanged.

Once both servers are running, open `http://localhost:5173/`, complete the
Total Loss intake, and submit an original CCC PDF of 50 MiB or smaller. The
browser stores the report privately at the deterministic case object location;
the authenticated API claims and runs the case analysis, then exposes the
owned persisted result.

For live market and orchestration debugging after a report has already been
extracted, use the local canonical-analysis command. It revalidates canonical
CCC JSON and runs the real MarketCheck retrieval, adaptive ranking, discrepancy
analysis, audit validation, and immutable persistence path without reading a PDF
or making another OpenAI request:

```sh
set -a
source .env
set +a
VENFOUR_PROVIDER_DIAGNOSTICS=1 \
  .venv/bin/python scripts/run_live_analysis.py \
  data/extracted/benchmarks/elantra.json \
  --postal-code 63123
```

Only `MARKETCHECK_API_KEY` is required by this command. New artifacts are saved
under `data/analysis-runs/` by default. This is a local development tool and is
separate from the authenticated case-owned HTTP creation path. There is no API
for submitting canonical analysis data.

Vite serves the application at `http://localhost:5173` and proxies `/api` and
`/health` to `http://127.0.0.1:8000`. This avoids a cross-origin request because
the Starlette API does not currently enable CORS.

### Cloud Run staging runtime

The checked-in `Dockerfile` is the production container entry point. It starts
one Uvicorn worker as PID 1, binds to `0.0.0.0`, honors Cloud Run's `PORT`, runs
as a non-root user, and keeps the legacy analysis API disabled by default.
Supabase remains the authoritative backend for authentication, private report
storage, cases, jobs, and immutable analysis runs; Cloud Run supplies only the
Python compute layer.

The current staging compute service is `venfour-api-staging` in Google Cloud
project `venfour-prod`, region `us-east4`:

```text
https://venfour-api-staging-640078527158.us-east4.run.app
```

It is configured with one vCPU, 512 MiB memory, concurrency 1, request-based
CPU, a 900-second request timeout, zero minimum instances, and one maximum
instance. The startup probe uses `/ready`; the liveness probe uses `/health`.
The service has public network reachability because customer authentication is
enforced by the application with Supabase bearer tokens. Customer case and
analysis endpoints remain ownership checked and do not become anonymous.

Backend credentials are mounted from five server-only Secret Manager secrets:

```text
venfour-supabase-url
venfour-supabase-publishable-key
venfour-supabase-service-role-key
venfour-openai-api-key
venfour-marketcheck-api-key
```

Do not place their values in tracked files, container build arguments, frontend
configuration, logs, or documentation. `VENFOUR_ENABLE_LEGACY_ANALYSIS_API`
must remain `0` in deployed environments.

To use a different backend address, copy the example environment file and edit
the local copy:

```sh
cd frontend
cp .env.example .env.local
```

`VENFOUR_API_PROXY_TARGET` controls the development proxy. Keep
`VITE_API_BASE_URL` empty for the same-origin proxy; set it only when the target
deployment intentionally serves the API elsewhere and has an appropriate CORS
policy.

Authentication and appraisal-case persistence require public browser
configuration from a Supabase project:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never place a Supabase service-role key in a `VITE_*` variable. Apply the SQL in
`supabase/migrations/` before using the case data layer. In Supabase Auth URL
Configuration, use `https://venfour.com` as the production Site URL and allow
`https://venfour.com/auth/callback` plus
`http://localhost:5173/auth/callback`. Email magic links require Email Auth and
production SMTP configuration. Google sign-in requires a Google Web OAuth
client whose authorized redirect URI is the Supabase callback
`https://<project-ref>.supabase.co/auth/v1/callback`; configure the client ID and
secret in the Supabase Google provider settings.

### Supabase project configuration

Create or link the Supabase project, then apply the checked-in migration:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

In the Supabase Dashboard:

1. Set Authentication > URL Configuration > Site URL to
   `https://venfour.com`.
2. Add `https://venfour.com/auth/callback` and
   `http://localhost:5173/auth/callback` to the allowed redirect URLs.
3. Keep Email authentication and new-user signups enabled, set the magic-link
   expiry to 3600 seconds, and configure production SMTP. In both the
   **Confirm sign up** and **Magic link or OTP** templates, link the sign-in
   action to
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` so Venfour can
   verify the one-time email token without relying on browser-local PKCE state.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the frontend
   deployment environment. Do not expose a secret or service-role key.

#### Staff access for Diminished Value review

The internal `/admin/diminished-value` route is read-only and uses the same
Supabase browser session as the customer application. Access is authorized by
the database-backed `public.staff_members` table, not by an email domain,
browser state, navigation visibility, or JWT metadata. Staff membership grants
read access only to submitted Diminished Value cases, their submitted intake,
and their exact private document namespace. It does not grant access to drafts,
Total Loss cases, customer profiles, unrelated Storage objects, or any staff
write operation.

There is intentionally no browser-facing staff-management API. After the Auth
user has been created, a trusted administrator can grant access from the
Supabase SQL editor or another privileged administrative connection using the
user's Auth UUID:

```sql
insert into public.staff_members (user_id)
values ('<auth-user-uuid>'::uuid)
on conflict (user_id) do nothing;
```

Revoke access with:

```sql
delete from public.staff_members
where user_id = '<auth-user-uuid>'::uuid;
```

Revocation is checked against the table on each authorized database or Storage
request, so it does not wait for the user's current access token to expire.
Never expose the service-role key to the browser or use it to implement a staff
management control in the frontend.

For Google sign-in, create a Web OAuth client in Google Cloud and configure the
Venfour OAuth consent screen. Add `https://venfour.com` and
`http://localhost:5173` as authorized JavaScript origins. Add only
`https://<project-ref>.supabase.co/auth/v1/callback` as the Google authorized
redirect URI, then enable Google in Supabase and enter that client ID and
secret. Google returns to Supabase first; Supabase then returns the browser to
Venfour's `/auth/callback` route.

Use a separate Supabase project for staging or preview deployments. Set that
project's Site URL to the staging origin, allow only the staging
`/auth/callback` URL plus intentional local-development callbacks, and add the
staging origin to the Google Web OAuth client's authorized JavaScript origins.
Google's authorized redirect URI remains the staging Supabase project's
`https://<project-ref>.supabase.co/auth/v1/callback`. Keep anonymous sign-ins
disabled, email signups enabled, JWT and email-link expiry at 3600 seconds, and
configure non-production SMTP plus the same token-hash email templates used in
production. The staging backend must receive its own server-only Supabase
credential and provider credentials; never expose them through `VITE_*`. Keep
`VENFOUR_ENABLE_LEGACY_ANALYSIS_API` unset in staging and production.

When the Supabase CLI and Docker are available, validate the local database
from the repository root with:

```sh
supabase start
supabase db reset
supabase db lint --local --fail-on error
supabase test db
```

For isolated filesystem-repository diagnostics, create the deterministic
representative material-undervalue analysis used by the frontend tests:

```sh
.venv/bin/python scripts/seed_representative_analysis.py
```

Start only a local compatibility API with the legacy route explicitly enabled,
then inspect its presentation response:

```sh
VENFOUR_ENABLE_LEGACY_ANALYSIS_API=1 \
  .venv/bin/python -m uvicorn venfour.api:create_app --factory --port 8000
curl http://127.0.0.1:8000/api/v1/analyses/00000000-0000-4000-8000-000000000001
```

The seed command uses the existing offline orchestration fixtures to write a
real validated analysis-run artifact under the ignored `data/analysis-runs/`
directory. It does not create a Supabase-owned case or run and therefore is not
available through the default authenticated customer path.

Available frontend checks are:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`AnalysisPresentation` TypeScript types are generated from the authoritative
backend JSON Schema. Regenerate and verify them with:

```sh
npm run generate:contracts
npm run check:contracts
```

## Phase 3F: owned analysis creation and presentation API

The Starlette application now bridges authenticated appraisal cases to the
existing deterministic Python pipeline. Supabase owns authentication, case
ownership, job claiming, idempotency, private report storage, and durable
artifact persistence; the established Python contracts remain authoritative
for extraction, market evidence, analysis, audit validation, and presentation.

```text
Supabase browser access token
        ↓
Supabase Auth /user
        ↓
owned case + durable fenced job claim
        ↓
case-files/{userId}/{caseId}/valuation-report.pdf
        ↓
existing deterministic analysis pipeline
        ↓
owned validated AnalysisRunArtifact in Supabase
        ↓
deterministic AnalysisPresentation
```

The default routes are:

- `POST /api/v1/appraisal-cases/{caseId}/analysis` — authenticate and claim or
  resume the case's analysis. The request has no body; owner IDs, storage paths,
  report bytes, ZIP codes, and run IDs are never accepted from the client.
- `GET /api/v1/appraisal-cases/{caseId}/analysis` — read the owned durable job
  state without starting work.
- `GET /api/v1/analyses/{runId}` — load an owned artifact through strict replay
  and integrity validation, then return the deterministic presentation JSON.

All three routes require `Authorization: Bearer <supabase-access-token>`. A
non-owned case or run is returned as not found. Case submission derives the
private object path exclusively from the authenticated user and path case ID,
streams at most 50 MiB to server-generated temporary storage, validates the PDF
bytes, and removes the temporary file when processing ends. Analysis executes
synchronously after a durable claim; the database processing token fences
completion and failure writes, and repeated submissions return the existing
durable state instead of creating duplicate runs.

The case status contract is discriminated by `status`:

```json
{"status":"not_submitted"}
{"status":"processing","attemptCount":1,"processingExpiresAt":"..."}
{"status":"completed","attemptCount":1,"runId":"..."}
{"status":"failed","attemptCount":1,"error":{"code":"...","message":"..."},"retryable":true}
```

The public legacy multipart `POST /api/v1/analyses` and public run lookup are
disabled by default. They remain available only for isolated local compatibility
and existing offline tests when explicitly enabled with
`VENFOUR_ENABLE_LEGACY_ANALYSIS_API=1` or injected legacy dependencies. They are
not the production customer path and must not be enabled in production.

Case and run IDs must be canonical lowercase UUIDv4 strings. API errors are
neutral JSON and do not include exception details, storage paths, raw artifacts,
configuration, credentials, or provider response data. `GET /health` is the
process-liveness endpoint: it returns only `{"status":"ok"}` and does not
authenticate, access storage, execute an analysis, or call a provider.
`GET /ready` is the bounded application-readiness endpoint. It returns
`{"status":"ready"}` only after application startup when required Supabase,
OpenAI, and MarketCheck configuration is structurally valid and the legacy API
is disabled; otherwise it returns a secret-free 503 response. Readiness does
not make provider or database requests. No CORS policy is enabled by default.
OpenAPI generation remains deferred; repository JSON Schemas and the checked
service contracts are the authoritative domain boundaries.

## Phase 3E: deterministic analysis presentation projection

Phase 3E is the provider-neutral presentation boundary over completed analysis
runs. It turns the validated audit record into structured content that a later
renderer can consume without requiring that renderer to understand Phase 3D
internals:

```text
AnalysisRunRepository.get(runId)
        ↓
validated AnalysisRunArtifact
        ↓
Phase 3E AnalysisPresentationService + deterministic projector
        ↓
strict, presentation-ready AnalysisPresentation model
        ↓
future web UI / PDF / deterministic explanation layer
```

`AnalysisPresentationService` loads by run ID through the existing
`AnalysisRunRepository`; it does not open audit JSON directly. Repository reads
therefore retain the Phase 3D.2 schema, semantic, digest, and replay checks, so a
malformed or tampered request, ranking, or result is rejected before projection.
The service passes the validated artifact to the side-effect-free projector and
returns a separately schema- and semantically validated presentation model.

Phase 3D remains authoritative. The projector does not recalculate medians,
ranges, dispersion, differences, thresholds, evidence strength, evidence
selection, ranking, findings, limitations, or classification, and it never
overrides a stored conclusion. It only organizes whitelisted stored facts and
formats existing integer-cent and basis-point values for display. The original
machine-readable classification, evidence-strength, evidence-basis, finding,
and limitation codes remain alongside reviewed labels and concise descriptions.
All presentation wording comes from deterministic templates; no language model
or dynamically generated prose is used.

Projection makes no current-market, historical-market, VIN-history, CCC,
dealer-site, or other provider request. Historical loss-date evidence and
current-market evidence remain explicitly labeled and separate. When Phase 3D
uses historical evidence as primary and current evidence as secondary, Phase 3E
preserves those roles and never averages them or creates a combined market
median. Excluded, ambiguous, and unresolved records remain diagnostic rather
than becoming priced comparables.

Every stored limitation remains visible regardless of classification or
evidence strength. Phase 3E provides no recommendations, negotiation strategy,
settlement demand, insurer communication, or action guidance. Future web, PDF,
and explanation renderers should consume `AnalysisPresentation` instead of raw
analysis internals whenever possible, while the full `AnalysisRunArtifact`
remains the authoritative audit record.

The presentation can expose only facts retained in that artifact. Phase 3D.2
stores the bounded target fields used by analysis and the CCC adjusted vehicle
value that Phase 3D actually compared, but it does not retain the complete CCC
report or independently expose its base value, report total, taxes, deductible,
or settlement arithmetic. Phase 3E does not reconstruct, infer, or relabel those
unavailable fields.

## Phase 3D.2: analysis orchestration and audit persistence

Phase 3D.2 adds the provider-neutral application workflow that coordinates the
existing stages and saves the complete structured evidence trail for later use:

```text
CCC extraction
    ↓
normalized valuation data
    ↓
current and/or loss-date market retrieval
    ↓
Phase 3C deterministic eligibility, scoring, and ranking
    ↓
Phase 3D deterministic discrepancy analysis
    ↓
Phase 3D.2 analysis-run orchestration
    ↓
validated, immutable AnalysisRunArtifact
    ↓
Phase 3E deterministic presentation projection
```

`AnalysisOrchestrator` decides when the existing stages run; it does not
recalculate CCC facts, normalize provider payloads, rank comparables, resolve
historical lifecycles, or classify discrepancies. Current and historical
providers implement the existing `MarketProvider` and `HistoricalMarketProvider`
boundaries and are supplied by dependency injection together with an
`AnalysisRunRepository`. Tests can therefore use fully offline fake providers
without changing orchestration behavior.

When historical retrieval is configured, it runs first for the normalized loss
date. Supported resolved evidence is projected into the unchanged Phase 3C
ranker, while `OUT_OF_PROVIDER_RANGE`, ambiguous, and unresolved provenance is
preserved exactly. Current inventory is retrieved only when explicitly
configured and remains a separate temporal evidence stream. The orchestrator
uses explicit server-owned policies for each stream and constrains them by the
selected provider adapter's declared geographic capability. Current-market
search attempts `(50 miles, 25 results)`, `(100, 50)`, `(200, 75)`, and
`(250, 100)` in order when the selected provider supports them. This deployment's
MarketCheck current-inventory capability limits its effective sequence to
`(50, 25)` and `(100, 50)`; if evidence is still sparse there, the successful
result is retained with `CURRENT_SEARCH_CEILING_REACHED` instead of attempting
an unsupported wider radius. MarketCheck loss-date search likewise attempts
`(50, 25)` and `(100, 50)`, then ends normally at its independently declared
100-mile capability ceiling. After each response, adaptive search merges
first-seen vehicles by VIN and then provider listing identity, reruns the
unchanged Phase 3C ranker, and stops when it has nine independently identified
`STRONG` matches, reaches 100 unique candidate outcomes, or completes the
effective stream policy. The provider-neutral policy contract itself still caps
configuration at four stages, 250 miles, 100 results per attempt, and 100 unique
candidates.

Adaptive search broadens only geography and candidate depth. It does not relax
year, make, model, trim, loss date, eligibility, or scoring, and price amount is
not read by merge, ranking, or stop logic. Historical stages repeat candidate
discovery at the exact loss date. If otherwise identical active historical
records carry conflicting prices, the provider adapter treats the source
evidence as ambiguous instead of choosing either price; it never favors the
higher or lower record. The MarketCheck adapter caches raw VIN-history outcomes
across those stages and permits at most 100 unique VIN-history fetches per
adaptive analysis, so overlapping radii do not repeat that expensive work.
Out-of-range coverage, incomplete pagination, and the VIN-verification limit are
explicit terminal outcomes. Reaching the configured historical ceiling is
persisted as `HISTORICAL_SEARCH_CEILING_REACHED` and retains all valid evidence
gathered at 50 and 100 miles. Phase 3D alone applies the established
historical/current precedence and classification rules.

Completed runs are stored as strict, immutable JSON under
`data/analysis-runs/<run-id>.json` by the default file repository. Each artifact
retains the normalized CCC analysis inputs, explicit configured and effective
search policies, every attempted scope and canonical provider result, cumulative
returned, resolved, unresolved, ambiguous, duplicate, eligible, and strong-match
counts, the stop reason, final Phase 3C rankings, and the Phase 3D policy,
request, and result. Version 4 binds both configured and effective policies into
the search-diagnostics digest, so replay derives a capability-ceiling stop from
the persisted policy difference rather than trusting the stored reason alone.
Files are validated before an atomic create-only save and are parsed,
schema-validated, and semantically validated again on read. Versions 1 through
3 remain readable. Corrupt, unknown, or internally inconsistent artifacts are
rejected rather than repaired or silently migrated.

Run metadata is separate from the deterministic calculation: `runId` is a
UUIDv4, `createdAt` is a UTC timestamp, and explicit run-schema, orchestration,
Phase 3C scoring, and Phase 3D discrepancy versions identify the rules used. A
run also records whether its effective loss date came from the CCC report or an
explicit override, preserving that orchestration decision without retaining the
entire raw report. The SHA-256 `requestDigest` covers the canonical normalized
Phase 3D request. Version 2 runs carry a `searchDiagnosticsDigest` over their
canonical shared adaptive policy and complete attempt stream. Version 3 binds
the stream-specific effective policies and complete attempt streams in the same
way. Read validation verifies both digests, replays the adaptive merge and
stopping decisions, and then replays Phase 3C and Phase 3D to bind the stored
rankings and result to their stored inputs. Version 1 and version 2 artifacts
remain readable under their original schemas and semantics. The digests detect
accidental or isolated alteration; they are not digital signatures.

Artifacts contain only canonical domain data and sanitized provider identity
metadata. Provider objects, transports, raw responses, authorization headers,
environment dumps, API keys, and credential-bearing URLs are forbidden. Runtime
files under `data/analysis-runs/` are ignored by Git; synthetic test data remains
tracked separately.

Weak evidence, `INSUFFICIENT_EVIDENCE`, `NO_MATERIAL_DISCREPANCY`,
`POTENTIAL_UNDERVALUE`, `MATERIAL_UNDERVALUE_SIGNAL`, and
`CONFLICTING_EVIDENCE` are all valid completed outcomes and are persisted
normally. Provider retrieval failures, deterministic execution failures,
persistence failures, missing runs, and invalid persisted artifacts remain
distinct errors. In particular, a persistence failure never reports the run as
successfully saved.

Phase 3D.2 adds no product CLI, language-model (LLM) call, prose generation,
report renderer, settlement calculation, or negotiation output. Its
classifications are structured screening results, not legal advice or a legally
owed settlement amount. Phase 3E consumes the saved structured artifact without
recalculating or changing its evidence selection or classification.

## Phase 3D: conservative valuation-discrepancy analysis

Phase 3D is a provider-neutral, deterministic evidence-comparison layer. It
asks whether CCC's vehicle valuation appears materially inconsistent with the
strongest available independent market evidence; it does not create a separate
vehicle-value formula.

```text
CCC report
    ↓
normalized CCC adjusted vehicle valuation + CCC-selected comparables

independent external evidence
    ↓
existing Phase 3C eligibility and non-price ranking

both evidence streams
    ↓
Phase 3D deterministic discrepancy analysis
    ↓
structured classification, evidence strength, findings, and limitations
```

The CCC amount compared with vehicle-market evidence is
`valuation.adjustedVehicleValue`. It is the report's vehicle amount after the
reported loss-vehicle condition adjustment. `valuation.total` remains
informational because the existing CCC contract does not establish that it is
only a vehicle-market amount or that it must equal `adjustedVehicleValue`.
Missing adjusted vehicle value is not silently replaced with the report total.

CCC-selected comparables retain two different observations: `listPrice`, the
reported advertised price, and `adjustedValue`, CCC's stated adjusted comparable
value. Phase 3D summarizes their counts, ranges, and medians separately. Where
both values exist, it also reports the factual net effect
`adjustedValue - listPrice` and preserves the disclosed `package`, `options`,
`mileage`, and `condition` adjustment amounts. Missing adjustment components
remain unavailable rather than becoming zero, and Phase 3D does not independently
declare CCC's adjustment formula correct or incorrect.

External evidence selection is fixed before any price is read. Phase 3D walks
eligible candidates in the existing Phase 3C rank order, removes repeated
vehicle identities without consulting price, and takes at most the first nine
independent candidates. VIN is the preferred identity; a stable provider listing
identity is the fallback when VIN is unavailable. Candidates without a usable
identity do not strengthen the independent-evidence count. The selected set is
never searched or rearranged to maximize or minimize disagreement with CCC.

Historical and current evidence remain separate. Sufficient resolved historical
listings independently shown active on the evidence date are the primary basis.
Current inventory is summarized separately and may provide secondary context; it
does not override sufficient historical evidence or become loss-date evidence.
When historical evidence is insufficient, supported current evidence may become
the primary basis, with an explicit current-market limitation. An
`OUT_OF_PROVIDER_RANGE` historical result means the provider could not cover the
date; it does not mean that no historical comparable vehicles existed.

For each finalized external comparison set, Phase 3D reports count, minimum,
maximum, median, median absolute deviation (MAD), and a central half-range. For
sets of at least three prices, the central half-range is one half of the span
from the second-lowest to the second-highest price. It therefore ignores at most
one extreme price on each side while still detecting a broad or bimodal central
set. The primary comparisons are:

```text
external median - CCC adjusted vehicle value

(external median - CCC adjusted vehicle value) * 10,000
---------------------------------------------------------
              CCC adjusted vehicle value
```

The second expression is the signed discrepancy in basis points. The result
also states whether the CCC vehicle valuation is below, within, or above the
observed external range; compares the CCC adjusted-comparable median with the
CCC vehicle valuation; compares advertised and adjusted medians among CCC rows
that contain both values; and, where both exist, compares the external median
with the CCC
adjusted-comparable median. Each quantity remains separately labeled rather than
being collapsed into a proprietary value estimate.

All new Phase 3D monetary calculations use integer cents. If an even-sized
median, MAD, or central half-range falls between cents, the emitted monetary
statistic uses round-half-up. Exact rational centers are retained while computing
MAD and dispersion; emitted cents are not fed back into those calculations.
`dispersionBasisPoints` is the larger of exact MAD and exact central half-range,
divided by the exact median, rounded half-up and capped at 10,000 basis points.
The selected price rows make both inputs reconstructible. Classification
thresholds use exact cross-multiplication, so a rounded displayed statistic
cannot move a case across a policy boundary.

The default `ValuationDiscrepancyPolicy` is deliberately small and explicit:

| Policy field | Default | Meaning |
| --- | ---: | --- |
| `maxComparisonSet` | 9 | Analyze at most the nine strongest independently identified candidates |
| `minimumIndependentCount` | 3 | Require three independent candidates for a directional classification |
| `strongHistoricalMinimum` | 5 | Require five coherent historical candidates for strong evidence |
| `potentialGapBasisPoints` | 500 | A median difference of 5% begins the potential-undervalue band |
| `materialGapBasisPoints` | 1000 | A median difference of 10% can support the material-signal band |
| `highDispersionBasisPoints` | 2000 | Robust dispersion divided by median at 20% or more is high dispersion |

These are Venfour analysis-policy thresholds, not legal or industry standards.
Every boundary is inclusive at its named threshold and is covered by deterministic
boundary tests.

Nine is an odd, bounded set that can represent a broader strong-comparable pool
while retaining a deterministic factual-similarity cutoff; three is the first
count where one listing cannot determine the median by itself. The three count
policy fields have a non-configurable floor of three, so no caller can create a
strong or material signal from one or two listings. The 5% and 10% bands are
conservative screening cutoffs, with the stronger band additionally requiring
strong loss-date evidence. The 20% robust-dispersion boundary uses the larger of
relative MAD and the one-outlier-resistant central half-range, preventing either
ordinary spread or a broad bimodal set from being presented with false precision.
Callers may supply a different validated policy above the evidence floor, and
every result records the policy it used.

Classification proceeds conservatively. Unusable valuation inputs, a zero
comparison denominator, or fewer than three independent selected comparables
produce `INSUFFICIENT_EVIDENCE`. Highly dispersed primary evidence produces
`CONFLICTING_EVIDENCE` only when its observed range strictly spans both below
and above the CCC valuation. When CCC is below the entire observed range and the
median clears the potential threshold, high dispersion instead produces
`POTENTIAL_UNDERVALUE`; when the whole range is below CCC, it produces no
undervalue classification. A median at least 10% above the CCC vehicle valuation
produces `MATERIAL_UNDERVALUE_SIGNAL` only when the evidence strength is `STRONG`
and dispersion is below the high-dispersion threshold; otherwise a difference of
at least 5% can produce `POTENTIAL_UNDERVALUE`. Remaining coherent cases produce
`NO_MATERIAL_DISCREPANCY`, meaning that the policy found no material undervalue
signal; a separate consistency finding appears only when the absolute median gap
is below the potential threshold. A single low listing does not erase an
otherwise coherent median signal, and a single high listing does not manufacture
one.

Evidence strength is separate from discrepancy direction. `LOW` represents
insufficient or highly dispersed evidence. `MODERATE` represents sufficient
current-only evidence or historical evidence that does not meet the stronger
count and Phase 3C quality conditions. `STRONG` requires five coherent historical
comparables and no selected `WEAK` Phase 3C candidate. Current-only evidence is
never labeled `STRONG`.

Structured findings identify objective conditions such as the external median
being above CCC, CCC's position within the external range, high dispersion,
current-only evidence, historical provider range limits, CCC adjustments reducing
or increasing comparable values, and ambiguous or unresolved historical records
being excluded. Structured limitations remain present even when the observed
discrepancy is large.

Phase 3D has the following intentional limitations:

1. It is not an independent appraisal.
2. It does not calculate a legally owed settlement amount.
3. Advertised asking prices are market evidence, not completed transaction
   prices.
4. It invents no mileage, condition, options, equipment, geography, or other
   dollar adjustments.
5. Resolved loss-date historical evidence is temporally stronger than current
   inventory.
6. Current inventory is not treated as historical evidence.
7. Ambiguous and unresolved listings are excluded from every price statistic.
8. Its thresholds are Venfour analysis-policy thresholds, not legal standards.
9. Its calculations and classifications are deterministic and use no language
   model.
10. Negotiation letters, insurer communications, legal arguments, and
    report-generation prose remain a later phase.

## Phase 3C: deterministic comparable matching

Phase 3C ranks already-discovered canonical `MarketListing` objects by factual
similarity to the loss vehicle:

```text
ComparableTarget + MarketSearchResult -> ComparableRankingResult
```

The scorer in `venfour/comparables.py` is provider-neutral and makes no network
requests. `MarketCheck` is only one possible source of canonical listings;
future providers use the same scoring rules after normalization. Every input
listing remains in the result. Normalized make and model mismatches are marked
`INELIGIBLE` with structured reasons instead of being silently discarded.

Comparable scoring version 1 uses a 0–100 scale. Make and model are eligibility
gates, not points. Eligible candidates receive:

| Factor | Maximum | Version 1 rule |
| --- | ---: | --- |
| Year | 20 | Same year: 20; one year apart: 12; two years: 4; three or more: 0 |
| Trim | 20 | Exact normalized trim: 20; unavailable on either side: 10; different: 0 |
| Mileage | 50 | Linear interpolation through 0 mi: 50, 5,000: 45, 10,000: 35, 25,000: 15, and 50,000+: 0 |
| Distance | 10 | Full through 10 mi, then linear interpolation through 25 mi: 9, 50: 7, 100: 4, and 200+: 0 |

A missing mileage receives 15 mileage points and a null `differenceMiles`; a
missing distance receives 5 distance points and a null `distanceMiles`. These
reduced values keep missing data distinct from a real zero-mile difference or
zero-mile distance. Missing VIN is reported but has no score penalty. Text
matching is case-insensitive, collapses whitespace, and does not use fuzzy make,
model, or trim aliases. Mileage uses the absolute difference, so equal positive
and negative gaps score identically. Displayed components are rounded to two
decimal places and sum exactly to the displayed total.

Scores of 85–100 are `STRONG`, 70–84.99 are `GOOD`, and lower eligible scores
are `WEAK`. Those labels describe similarity under Venfour's version 1 rules;
they do not establish legal admissibility, prove valuation error, or determine
whether a listing is economically preferable. Eligible candidates sort by
score descending, then smaller available mileage difference, smaller available
distance, and finally original provider order. Ineligible candidates follow in
their original order. The target and echoed market request must contain the
same postal origin, including the case where both are unavailable. Without an
origin, a provider-supplied distance remains in the listing as information but
receives the neutral missing-distance score; mismatched origins are rejected.

Listing price remains present for later phases, but it does not affect
eligibility, any component, the total score, the tier, or any tie-break. This
phase does not compare listings with CCC values, calculate a Venfour vehicle
value, characterize a listing as over- or underpriced, or conclude that a CCC
valuation is high or low.

## Phase 3C.6: date-of-loss market evidence

Current inventory and date-of-loss evidence are separate concepts. The active
MarketCheck command describes today's market; the historical command asks for
one explicit `evidenceDate` and returns temporal provenance with each resolved
canonical listing. Venfour never substitutes current listings when historical
coverage is unavailable.

MarketCheck's `/v2/search/car/recents` endpoint is limited to expired dealer
inventory in a rolling 90-day provider window. Sold listings are only a subset
of expired listings, and vehicles that remained continuously active and never
entered the recents dataset are absent. Historical search is therefore not a
complete reconstruction of the market on a past date.

Venfour now uses a two-stage historical strategy:

```text
Past Inventory Search (/v2/search/car/recents)
    = exact-date, geography, and vehicle-specification candidate VIN discovery

VIN History (/v2/history/car/{vin})
    = exact listing lifecycle and historical advertised-price verification
```

Candidate discovery keeps
`active_inventory_date_range=YYYYMMDD-YYYYMMDD` fixed to the exact evidence
date. It deliberately uses MarketCheck's default attribution and VIN
deduplication, which returns the searchable listing for each physical vehicle,
rather than expanding syndicated or duplicate source listings. Candidate
pagination remains bounded and must be complete before any candidate set is
treated as complete; if the safety bound is reached, provisional evidence is
withheld.

For every discovered VIN, Venfour retrieves VIN History and determines which
specific listing record was active during the evidence calendar day. The
record's documented `first_seen_at`/`last_seen_at` lifecycle interval, listing
identity, mileage, seller context, and advertised price come from VIN History;
the `/recents` row's price is not treated as date-specific proof. Available
source-tenure timestamps remain corroborating provenance only and are never
fabricated when VIN History cannot supply them. Incomplete VIN History
pagination leaves the affected VIN unresolved rather than guessing.
Likewise, a potentially active history row whose required used-dealer or
seller context cannot be verified is reported as
`UNVERIFIABLE_RECORD_CONTEXT`; it is never silently removed in order to make a
sibling record resolvable.

Repeated identical history rows do not become independent comparables. If more
than one genuinely distinct lifecycle record could have been active at any time
on the evidence date, the VIN remains `AMBIGUOUS`: Venfour knows the calendar
date, not the exact loss time. It never chooses among those records by lowest,
highest, average, earliest, latest, or otherwise preferred price.

Resolved listings can be projected into the existing Phase 3C scorer without
changing its provider-neutral, price-neutral rules. Phase 3D consumes that ranked
evidence only after retrieval and scoring are complete; the historical retrieval
architecture and current-market search remain unchanged.

As of 2026-08-10, the Elantra loss date is inside the rolling coverage window
and requires `MARKETCHECK_API_KEY` for the live query:

```sh
.venv/bin/python scripts/search_marketcheck_historical.py \
  --date 2026-05-19 \
  --year 2024 \
  --make Hyundai \
  --model Elantra \
  --trim SEL \
  --mileage 46926 \
  --postal-code 63026 \
  --radius 50 \
  --limit 10
```

The Camry loss date is outside the window. This command prints a canonical
`OUT_OF_PROVIDER_RANGE` result without reading an API key or making a request:

```sh
.venv/bin/python scripts/search_marketcheck_historical.py \
  --date 2025-08-14 \
  --year 2025 \
  --make Toyota \
  --model Camry \
  --trim SE \
  --mileage 7192 \
  --postal-code 63123 \
  --radius 50 \
  --limit 10
```

## Phase 3B: live MarketCheck inventory

Phase 3A established the provider-neutral boundary for discovering external
vehicle listings:

```text
MarketSearchRequest -> MarketProvider adapter -> canonical MarketSearchResult
```

`MarketCheckProvider` is the first live adapter for that boundary. It searches
MarketCheck's active used dealer inventory only when explicitly constructed or
when `scripts/search_marketcheck.py` is run. The API key is supplied from the
`MARKETCHECK_API_KEY` environment variable by the CLI; it is never placed in a
`MarketSearchRequest` or returned result. Every request explicitly sends
`append_api_key=false` so MarketCheck does not append the credential to response
URLs.

The adapter retains only the fields in Venfour's `MarketListing` contract. Raw
MarketCheck payloads, media, finance data, provider-specific dealer IDs, and
other provider metadata are neither returned nor saved. Missing optional fields
remain null, malformed required fields fail normalization, provider order is
preserved, and searches larger than MarketCheck's 50-row page limit are
paginated only until Venfour's requested limit is satisfied.

For a manual live Camry search, first make `MARKETCHECK_API_KEY` available in the
shell environment, then run:

```sh
.venv/bin/python scripts/search_marketcheck.py \
  --year 2025 \
  --make Toyota \
  --model Camry \
  --trim SE \
  --mileage 7192 \
  --postal-code 63123 \
  --radius 50 \
  --limit 10
```

The command prints only canonical `MarketSearchResult` JSON and does not save
the live response. Inventory, prices, listing identifiers, and counts change
over time and should not be treated as deterministic fixtures.

`FixtureMarketProvider` remains available for deterministic development. Its
committed Camry and Elantra records are explicitly synthetic, make no network
requests, require no API key, cost $0, and are not current market evidence.
Normal tests use injected transports and fixtures, so they remain completely
offline. Discovery itself does not rank listings. Phase 3C ranking is a
separate, deterministic step and still does not compare external listings with
CCC comparables or calculate an alternative valuation.

Run the complete offline test suite with:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

## Phase 2.5: end-to-end report processing

`scripts/process_report.py` turns one source PDF into both validated artifacts:

```text
CCC PDF -> GPT-5.6 Sol extraction -> canonical JSON -> deterministic analysis -> analysis JSON
```

Run it with a source report:

```sh
.venv/bin/python scripts/process_report.py \
  data/raw/ccc/ccc-001-camry-auto-club.pdf
```

By default it writes
`data/extracted/processed/<input-stem>.json` and
`data/analyzed/processed/<input-stem>.analysis.json`. Use
`--extraction-output` and `--analysis-output` to choose explicit paths. The
first step calls the OpenAI API and therefore requires `OPENAI_API_KEY`; it also
prints the existing API usage summary. Analysis remains deterministic and
offline.

Each valid artifact is written atomically. Extraction is committed first, so a
later analysis failure leaves the valid extraction available and does not
replace the analysis destination; any pre-existing analysis remains unchanged.
Consumers should treat the pair as current only after a zero exit code, which
means both outputs were validated and written successfully.

## Phase 2: deterministic valuation analysis

Extraction and analysis are separate stages:

```text
CCC PDF -> canonical report JSON -> deterministic analysis JSON
```

`scripts/analyze_report.py` reads an existing canonical extraction and runs local,
rule-based checks. It does not call an AI model, require an API key, search the
web, or make any external request. Analysis results are validated against
`schemas/analysis/report-analysis.schema.json` and written atomically.

Run the analyzer with an input and output path:

```sh
.venv/bin/python scripts/analyze_report.py \
  data/extracted/ccc/ccc-001-camry-auto-club.json \
  data/analyzed/ccc/ccc-001-camry-auto-club.analysis.json
```

The versioned output contains a valuation summary, comparable and mileage
metrics, adjustment-reconciliation details, contribution availability, and
structured findings with source JSON paths. Finding statuses mean:

- `PASS`: the deterministic check was performed and the available data is
  internally consistent.
- `REVIEW`: data is unavailable, incomplete, different, statistically or
  structurally notable, or otherwise worth human review. It is not proof of an
  error or undervaluation.
- `WARNING`: available values contain a definite arithmetic or structural
  contradiction.

Current checks cover valuation arithmetic; disclosed condition-impact totals;
comparable numbering, repeated non-empty VINs, and missing values; disclosed,
partial, and unavailable comparable adjustment breakdowns; mileage-adjustment
direction; loss-vehicle versus comparable year, make, model, and trim;
adjusted-value and mileage statistics; and displayed contribution percentages. A
report total is retained as information but is not assumed to equal the adjusted
vehicle value.

The analyzer does not search for external market comparables, infer undisclosed
adjustments or weights, reproduce a proprietary mileage formula, apply insurance
law, determine legal entitlement, or definitively label a valuation fair or
unfair. Those limitations are intentional; market search and user-facing
explanation are later phases. Generated files under `data/analyzed/` are ignored,
while deterministic test fixtures remain tracked.

## Deterministic regression tests

The normal regression suite includes the complete orchestration flow using a
deterministic fake only at the live OpenAI boundary. It validates extraction,
runs and validates analysis, and checks the written artifacts using the small,
manually verified benchmark fixtures. It makes no network requests, costs $0,
and does not require an `OPENAI_API_KEY`:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

The current benchmarks cover two real CCC reports:

- 2025 Toyota Camry SE (Auto Club claim report)
- 2024 Hyundai Elantra SEL (State Farm claim report)

Only visually verified fields are benchmarked. Unverified report content is not
treated as ground truth.

## Optional live benchmarks

The end-to-end live benchmark performs fresh API extraction, compares the
verified fields, and only then runs the deterministic pipeline and its stable
analysis checks. It requires `OPENAI_API_KEY`, consumes API usage, prints usage
information and every mismatch, and exits non-zero on failure:

```sh
.venv/bin/python scripts/run_live_pipeline_benchmark.py camry
.venv/bin/python scripts/run_live_pipeline_benchmark.py elantra
.venv/bin/python scripts/run_live_pipeline_benchmark.py all
```

The extraction-only live benchmark remains available when analysis is not
needed:

```sh
.venv/bin/python scripts/run_live_benchmark.py camry
.venv/bin/python scripts/run_live_benchmark.py elantra
.venv/bin/python scripts/run_live_benchmark.py all
```

The source PDFs must exist under `data/raw/ccc/`. Raw reports in `data/raw/` and
generated results in `data/extracted/` are intentionally gitignored because
they are private/source material or reproducible outputs. The limited,
manually written fixtures under `tests/benchmarks/` are intended to be tracked.

Passing both benchmarks is encouraging evidence for these two reports, but it
does not establish reliable extraction across every CCC format, template,
carrier variation, or scan quality. New representative reports should be
visually verified and added as focused benchmarks before broader reliability
claims are made.
