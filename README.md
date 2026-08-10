# Venfour CCC report extraction

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
