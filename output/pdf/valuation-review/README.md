# Vehicle Valuation Review — local samples

All samples are fictional test data. They are local design and regression evidence, not customer reports or production-release proof.

The supplied sample keeps its exact frozen evidence and assessment. The original PDF remains unchanged at `output/local-market/completed-expansion-report.pdf` (10 pages). The redesigned version has 3 pages.

## Files

- [Original fictional sample, redesigned](fictional-expansion-review.pdf) — 3 page(s). Same frozen source and assessment as the original ten-page report; nine primary vehicles and two later observations.
  [Page 1](fictional-expansion-review-page-1.png) · [Page 2](fictional-expansion-review-page-2.png) · [Page 3](fictional-expansion-review-page-3.png)
- [Complete case](fictional-complete-review.pdf) — 3 page(s). Offline fixture analysis with five primary vehicles and three insurer comparables.
  [Page 1](fictional-complete-review-page-1.png) · [Page 2](fictional-complete-review-page-2.png) · [Page 3](fictional-complete-review-page-3.png)
- [Missing optional identification](fictional-missing-identification.pdf) — 3 page(s). Presentation stress fixture; VIN, insurer and claim omitted, unverified trim disclosed.
  [Page 1](fictional-missing-identification-page-1.png) · [Page 2](fictional-missing-identification-page-2.png) · [Page 3](fictional-missing-identification-page-3.png)
- [Insufficient evidence](fictional-insufficient-evidence.pdf) — 1 page(s). Presentation stress fixture without eligible market or insurer comparable rows; no forced reconsideration request.
  [Page 1](fictional-insufficient-evidence-page-1.png)
- [Large comparable set](fictional-large-set.pdf) — 5 page(s). Presentation stress fixture with 18 long comparable rows and long source URLs. Headline statistics are retained from the base fixture solely for layout testing.
  [Page 1](fictional-large-set-page-1.png) · [Page 2](fictional-large-set-page-2.png) · [Page 3](fictional-large-set-page-3.png) · [Page 4](fictional-large-set-page-4.png) · [Page 5](fictional-large-set-page-5.png)
- [No supported discrepancy](fictional-no-discrepancy.pdf) — 3 page(s). Offline fixture analysis with no material discrepancy; no increase requested.
  [Page 1](fictional-no-discrepancy-page-1.png) · [Page 2](fictional-no-discrepancy-page-2.png) · [Page 3](fictional-no-discrepancy-page-3.png)
- [Weak evidence](fictional-weak-evidence.pdf) — 3 page(s). Offline fixture analysis with only two primary vehicles; the limitation is stated prominently.
  [Page 1](fictional-weak-evidence-page-1.png) · [Page 2](fictional-weak-evidence-page-2.png) · [Page 3](fictional-weak-evidence-page-3.png)
- [Current-market evidence](fictional-current-market.pdf) — 3 page(s). Offline fixture analysis using current observations without verified loss-date evidence.
  [Page 1](fictional-current-market-page-1.png) · [Page 2](fictional-current-market-page-2.png) · [Page 3](fictional-current-market-page-3.png)

All 24 pages were rendered and visually inspected. Six `inspection-*.jpg` contact sheets show the full set. [Open the page gallery](index.html).

## Evidence and release boundary

The analysis remains an advertised-price comparison, not a point ACV or settlement determination. No valuation calculation, comparable eligibility or selection policy changed. The new template projects the accepted frozen claim reference and available source links. It creates no corrections or source-page citations where none exist.

Template and renderer version 2 retain the exact-byte legacy renderer. The review prompt is version 2. The prior checked-in provider qualification is unchanged and does not qualify this release. A fresh provider-backed evaluation through the established release process is required before rollout. No paid-provider requests, deployment, production regeneration, customer emails, commits or pushes were performed.

## Reproduce

```sh
PYTHONPATH=. .venv/bin/python scripts/preview_valuation_review.py output/pdf/valuation-review/frozen-expansion.json --name expansion-review
PYTHONPATH=. .venv/bin/python scripts/preview_valuation_review.py output/pdf/valuation-review/frozen-complete.json --name complete-review --edge-cases
```

The three stress variants are explicitly presentation-only; the complete, current-market, weak-evidence and no-discrepancy cases come from offline fixture analysis. Frozen source/assessment envelopes, report JSON and sample digests are saved alongside the PDFs.


## Validation

128 distinct backend tests passed across report rendering, provenance, source-price projection, processing, full review, release gates and evaluation qualification. The final render/provenance run contained 49 tests (including one repeated release-qualification check); processing/full-review contained 38; release/review/evaluation contained 42. Logs are included here. The existing email/preview frontend suites passed 71 tests.

The five frozen analysis samples were checked against their original financial conclusions, market evidence, insurer comparables, calculations and limitations; those sections are unchanged. Source-bound validation and PDF validation passed. Every page of all eight sample PDFs was visually inspected. The legacy renderer reproduces the captured original PDF SHA-256 exactly.
