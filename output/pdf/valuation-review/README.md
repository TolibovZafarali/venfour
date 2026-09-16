# Vehicle Valuation Review — final refinement

Fictional local test data. Template/renderer 3 preserves the advertised-price-only analysis. No point ACV, settlement target or independent dollar adjustment was introduced.

## Samples

- [Expanded search](fictional-expansion-review.pdf) — 2 pages. Original frozen fictional sample: nine vehicles and two 100-mile search areas.
- [Complete case](fictional-complete-review.pdf) — 2 pages. Offline analysis with five market vehicles and three insurer comparables.
- [Missing identification](fictional-missing-identification.pdf) — 2 pages. Presentation stress fixture; missing optional facts and identity limitations are disclosed.
- [Insufficient evidence](fictional-insufficient-evidence.pdf) — 1 page. Presentation stress fixture without eligible comparables; no increase requested.
- [Large comparable set](fictional-large-set.pdf) — 4 pages. Presentation stress fixture: 18 distinct fictional identities, long names and URLs; count and headline price statistics match the rows.
- [No supported discrepancy](fictional-no-discrepancy.pdf) — 2 pages. Offline analysis: lower-priced evidence retained; no increase requested.
- [Weak evidence](fictional-weak-evidence.pdf) — 2 pages. Offline analysis: only two market vehicles; explicitly qualified conclusion.
- [Current-market evidence](fictional-current-market.pdf) — 2 pages. Offline analysis: current observations are separate from loss-date evidence.

[Open all 17 pages in color and grayscale](index.html). PNGs and contact sheets are saved here. Prior template-2 sample bytes remain in `template-2/`.

## Final changes

The compact market description distinguishes recorded search filters from selected vehicle mileages, labels each search area and distance origin, and names providers readably. Case-specific reasons use the recorded count, characteristics and asking prices. Historical/current observations are cross-referenced without combining statistics. Insurer values and adjustments remain clearly attributed. Natural flow and repeated table headers replace fixed page breaks; a minimum space check prevents orphaned source headings.

No frozen analysis changed. The five analysis samples passed source-bound validation with their original financial conclusions, market evidence, insurer data, calculations and limitations unchanged. The three stress variants are presentation tests, not new analyses. Subject inclusion, duplicates within a comparison set, or count/statistic mismatches now trigger the existing human-review validation failure; no rows or statistics are repaired. No such upstream issue was found in the five analysis samples.

## Palette

White `#ffffff`, charcoal `#171717`, muted text `#454545`, gray rules `#d4d4d4`, existing application brand-strong blue `#1d4ed8`, and pale brand tint `#eef4ff`. Accent contrast is 6.70:1 on white and 6.07:1 on tint. Labels, values and underlined links remain understandable without color. Body: 10.5 pt; tables/source notes: 9 pt; footers: 8 pt.

## Validation

124 distinct backend regression tests passed across rendering, evidence, source prices, processing, review and release/evaluation gates. The old long-table stress fixture initially failed the new duplicate check; its synthetic identities/counts were corrected, and its rerun passed. Final focused run: 20 tests passed. Email/preview frontend suites: 71 tests passed. The email required no changes. Templates 1 and 2 still reproduce their golden PDF hashes exactly. All 17 pages across eight samples were visually inspected in both color and grayscale, including the final source-heading placement and insurer-row grouping. `git diff --check` passed.

No live/paid provider calls, deployment, production regeneration, emails, payment-policy changes, commits or pushes occurred.

## Evidence limitations

Listing prices do not establish ACV or settlement owed. Missing source-page citations remain disclosed. Missing subject or comparable VINs limit identity verification. Current observations do not establish loss-date values. No documented correction is invented. Private or credential-bearing URLs remain excluded.

## Exact qualification required before rollout

Run the existing 20-case live reviewer suite with secure configured credentials and the intended approved model:

```sh
.venv/bin/python -m tests.report_review_provider_eval
```

Not run in this task. It must achieve 20/20 labeled outcomes, including release decisions, with template/renderer 3, review prompt 3 and review schema 1. The returned model identifier must match the approved release model. Only the actual measured successful attestation may replace the qualification artifact through the established release process; approved runtime model, prompt, schema and suite settings must match. The old checked-in prompt-1 qualification remains unchanged and fails closed for this build.

- Prompt digest: `2561eac1eff04ad596cc49c18b1a252e04e56836960b829f5ce62cf2b27a0cf1`
- Review-schema digest: `11839c12f40f8212c41cd2e3736baa131f46a963fdd83a25bbca1b41e92280f6`
- Input-contract digest: `dcd0dfe6e0888dd3271e08323dcc1a3221732eb18a1b3eed0eefe804f4b9be30`
- Suite digest: `f06b5fe5460a95d61f9e2f5ff6d36b46e79133c53c5ba137fe4dc2e2d1dc298c`

## Reproduce previews

```sh
PYTHONPATH=. .venv/bin/python scripts/preview_valuation_review.py output/pdf/valuation-review/frozen-expansion.json --name expansion-review
PYTHONPATH=. .venv/bin/python scripts/preview_valuation_review.py output/pdf/valuation-review/frozen-complete.json --name complete-review --edge-cases
```
