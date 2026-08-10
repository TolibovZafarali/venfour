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

The normal regression suite compares local JSON inputs with small, manually
verified benchmark fixtures. It does not call OpenAI and does not require an
`OPENAI_API_KEY`:

```sh
python3 -m unittest discover -s tests -v
```

The current benchmarks cover two real CCC reports:

- 2025 Toyota Camry SE (Auto Club claim report)
- 2024 Hyundai Elantra SEL (State Farm claim report)

Only visually verified fields are benchmarked. Unverified report content is not
treated as ground truth.

## Optional live benchmark

The live benchmark performs a fresh API extraction, validates the complete
result against the schema, and compares the verified fields. It requires
`OPENAI_API_KEY`, consumes API usage, prints usage information and every
mismatch, and exits non-zero on failure.

Run one report or both:

```sh
python3 scripts/run_live_benchmark.py camry
python3 scripts/run_live_benchmark.py elantra
python3 scripts/run_live_benchmark.py all
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
