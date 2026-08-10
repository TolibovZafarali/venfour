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

## Phase 3A: provider-neutral market discovery

Phase 3A establishes the offline boundary for discovering external vehicle
listings:

```text
MarketSearchRequest -> MarketProvider adapter -> canonical MarketSearchResult
```

An adapter translates a provider-specific response into Venfour's common
`MarketListing` contract. Discovery validates the request and normalized result
but does not rank listings, compare them with CCC comparables, or calculate a
valuation. A future live source only needs to implement the `MarketProvider`
interface; downstream code remains provider-neutral.

The current `FixtureMarketProvider` uses committed, explicitly synthetic Camry
and Elantra records. It makes no network requests, requires no API key, costs
$0, and must not be treated as verified current market data. No live
vehicle-listing provider is integrated yet. Adapters trim surrounding
whitespace, preserve numeric and null values, and never guess missing trim, VIN,
mileage, price, or distance. Provider/source names use stable lowercase
identifiers, and safe two-letter state abbreviations are uppercased without
rewriting other location text.

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
