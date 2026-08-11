# Venfour CCC report extraction and analysis

Venfour currently extracts structured valuation data directly from original CCC
PDFs. The primary path sends the PDF to GPT-5.6 Sol (`gpt-5.6-sol`) with
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

## Phase 3C.5: date-of-loss market evidence

Current inventory and date-of-loss evidence are separate concepts. The active
MarketCheck command describes today's market; the historical command asks for
one explicit `evidenceDate` and returns temporal provenance with each resolved
canonical listing. Venfour never substitutes current listings when historical
coverage is unavailable.

MarketCheck's `/v2/search/car/recents` endpoint is limited to expired dealer
inventory in a rolling 90-day provider window. Sold listings are only a subset
of expired listings, and listings that remain active are absent, so the result
is necessarily incomplete and is not a full reconstruction of the market on a
past date. Venfour uses `active_inventory_date_range=YYYYMMDD-YYYYMMDD` to find
candidate VINs for the exact date. Because that VIN-level filter does not prove
that the returned record's price applied on that date, Venfour also verifies
that the specific record's `first_seen_at`/`last_seen_at` interval overlaps the
evidence day, following MarketCheck's documented listing lifecycle fields.
Available source-tenure timestamps are retained and checked as corroborating
provenance, but never replace the record interval or independently establish a
date-specific price.

Historical requests send `nodedup=true` so lifecycle records can be evaluated
locally. Repeated records do not become independent comparables. If multiple
distinct records for one vehicle overlap the date, the vehicle is marked
`AMBIGUOUS` and excluded from resolved evidence rather than selecting a price.
Search pagination exhausts the bounded candidate set before prices are finalized
so a conflicting lifecycle record on a later page cannot be missed. The scan is
limited to 10 pages; if that safety bound leaves more records, provisional
prices are withheld and an explicit unresolved issue reports incomplete
coverage. The same conservative withholding applies if provider pagination ends
prematurely while its reported result count says records remain.

Resolved listings can be projected into the existing Phase 3C scorer without
changing its provider-neutral, price-neutral rules. Historical market evidence
still does not compare against CCC values or establish that a CCC valuation is
erroneous.

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
