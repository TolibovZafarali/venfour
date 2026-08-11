<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/venfour-logo-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/venfour-logo-black.svg">
    <img src="assets/brand/venfour-logo-black.svg" alt="Venfour logo" width="128">
  </picture>
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

This repository contains the Python backend through Phase 3F. Its implemented
pipeline covers:

- structured extraction and validation of CCC valuation reports;
- normalized vehicle, valuation, and comparable data;
- current and historical market-evidence retrieval through provider boundaries;
- historical listing lifecycle verification;
- provider-neutral comparable eligibility, scoring, and ranking;
- deterministic valuation-discrepancy analysis;
- immutable analysis-run persistence with replay and integrity validation;
- deterministic presentation projection; and
- a read-only JSON API for validated presentation data.

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
read-only JSON API
```

The repository does not currently contain the planned customer-facing web
application. Phase 3F also does not provide authentication, user ownership,
report-upload endpoints, analysis-creation endpoints, or production deployment
configuration.

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

Venfour is planned as a responsive web product using React, TypeScript, Vite,
React Router, TanStack Query, and Tailwind CSS. Product pages will be designed
and reviewed individually before implementation. A future frontend should
consume the backend's structured presentation JSON rather than reproduce
valuation calculations, evidence selection, comparable ranking, historical
verification, or discrepancy classification.

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

Install the Python dependencies:

```sh
python3 -m pip install -r requirements.txt
```

## Phase 3F: read-only analysis presentation API

Phase 3F exposes the Phase 3E presentation contract through one lightweight,
production-capable Starlette ASGI application. The repository previously had no
HTTP framework; Starlette supplies the small routing, JSON-response, error, and
application-factory boundary this phase needs without adding a second framework
or a response-model layer. Selection and operation of a production ASGI server
remain deployment work.

```text
AnalysisRunArtifact
      ↓
Phase 3E AnalysisPresentationService
      ↓
Phase 3F read-only HTTP API
      ↓
future Venfour dashboard
```

`GET /api/v1/analyses/{runId}` returns the validated
`AnalysisPresentation` JSON object directly, without an API envelope. The API
calls `AnalysisPresentationService.get(run_id)` only. It does not read analysis
files or raw provider data, call MarketCheck or another provider, rerun an
analysis stage, or recalculate presentation values.

Run IDs must be canonical lowercase UUIDv4 strings and are rejected before a
service or repository lookup when malformed. API errors are deterministic JSON:
`INVALID_RUN_ID` uses 400, `ANALYSIS_NOT_FOUND` uses 404, and unavailable,
corrupt, or internally invalid stored analyses use the neutral
`ANALYSIS_UNAVAILABLE` code with 500. Error responses do not include exception
details, storage paths, raw JSON, configuration, credentials, or other internal
state.

The `/api/v1` prefix versions the HTTP contract only; it is independent of the
analysis-run, discrepancy-analysis, comparable-scoring, and presentation schema
versions carried in the presentation provenance. `GET /health` returns only
`{"status":"ok"}` and does not access storage, enumerate files, execute
analysis, or call a provider.

No CORS policy is enabled by default, and Phase 3F adds no authentication or
user-ownership model. It exposes no analysis creation, upload, or other mutation
endpoint. OpenAPI generation is deferred because it is not native to the chosen
minimal framework; the strict repository JSON Schemas remain the authoritative
domain contracts.

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
does not broaden trim, year, model, radius, or dates; retry with weaker
eligibility; or search by price. Phase 3D alone applies the established
historical/current precedence and classification rules.

Completed runs are stored as strict, immutable JSON under
`data/analysis-runs/<run-id>.json` by the default file repository. Each artifact
retains the normalized CCC analysis inputs, exact search requests and normalized
provider results, historical diagnostics, Phase 3C rankings, Phase 3D policy,
request, and result. Files are validated before an atomic create-only save and
are parsed, schema-validated, and semantically validated again on read. Corrupt,
unknown, or internally inconsistent artifacts are rejected rather than repaired
or silently migrated.

Run metadata is separate from the deterministic calculation: `runId` is a
UUIDv4, `createdAt` is a UTC timestamp, and explicit run-schema, orchestration,
Phase 3C scoring, and Phase 3D discrepancy versions identify the rules used. A
run also records whether its effective loss date came from the CCC report or an
explicit override, preserving that orchestration decision without retaining the
entire raw report. The SHA-256 `requestDigest` covers the canonical normalized
Phase 3D request. Read
validation verifies the digest and replays Phase 3C and Phase 3D to bind the
stored rankings and result to their stored inputs. The digest detects accidental
or isolated alteration; it is not a digital signature.

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
vehicle identities without consulting price, and takes at most the first five
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
| `maxComparisonSet` | 5 | Analyze at most the five strongest independently identified candidates |
| `minimumIndependentCount` | 3 | Require three independent candidates for a directional classification |
| `strongHistoricalMinimum` | 5 | Require five coherent historical candidates for strong evidence |
| `potentialGapBasisPoints` | 500 | A median difference of 5% begins the potential-undervalue band |
| `materialGapBasisPoints` | 1000 | A median difference of 10% can support the material-signal band |
| `highDispersionBasisPoints` | 2000 | Robust dispersion divided by median at 20% or more is high dispersion |

These are Venfour analysis-policy thresholds, not legal or industry standards.
Every boundary is inclusive at its named threshold and is covered by deterministic
boundary tests.

Five is an odd, bounded set large enough for the median to resist one extreme
price; three is the first count where one listing cannot determine that median by
itself. The three count policy fields have a non-configurable floor of three, so
no caller can create a strong or material signal from one or two listings. Strong
evidence requires the full default set. The 5% and 10% bands are conservative
screening cutoffs, with the stronger band additionally requiring strong loss-date
evidence. The 20% robust-dispersion boundary uses the larger of relative MAD and
the one-outlier-resistant central half-range, preventing either ordinary spread
or a broad bimodal set from being presented with false precision. Callers may
supply a different validated policy above the evidence floor, and every result
records the policy it used.

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
