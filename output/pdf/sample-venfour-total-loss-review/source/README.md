# Sample Venfour Total-Loss Review

Editable source for the final six-page attorney sample:
`Venfour-Sample-Total-Loss-Review.pdf`.

This edition supersedes the earlier eight-page sample. It is a realistic,
wholly hypothetical case packet, combining the review with customer request
and follow-up examples. It is not an exact application export.

## Source files

- `sample-review.json`: editable case facts, tables, correspondence and copy.
- `build_review.py`: page layout, vector comparison chart and PDF generation.
- `venfour-mark.svg`: unchanged repository brand artwork.
- `CAPABILITY-VERIFICATION.md`: current-code references and follow-up constraints.
- `requirements.txt`: minimal build dependency.

## Rebuild

Run from this directory using Python 3.10 or later:

```sh
python3 -m pip install -r requirements.txt
python3 build_review.py --output ../Venfour-Sample-Total-Loss-Review.pdf
```

The default fonts are macOS Helvetica Neue and Avenir Next Demi Bold, reflecting
the repository's sans-serif and wordmark stacks. Fonts are embedded in the PDF
but are not redistributed with the editable source. On another system, provide
appropriately licensed `regular.ttf`, `bold.ttf`, `italic.ttf` and `wordmark.ttf`:

```sh
python3 build_review.py --fonts-dir /absolute/path/to/fonts
```

Edit the JSON for content and the Python file for layout. Fixed headings,
summary labels and certain repeated amounts also appear in the Python file.
If changing case values, update those displays, prose and arithmetic assertions
together. The assertions reject partially updated numbers. The generator also
rejects paragraph overflow and saves text extents and chart geometry in `qa/`.
Render and visually review every page after editing.

## Six-page structure

1. Client benefit, five-step workflow, hypothetical case and key figures.
2. Insurer comparables, adjustment arithmetic, findings and focused strategy.
3. Five market records, a scaled dollar comparison and evidence qualifications.
4. Prominent initial customer reconsideration request and next actions.
5. Revised insurer report extract, response analysis and prepared follow-up.
6. Attorney handoff, pricing, both refund protections and customer-start link.

Body text remains 10.5-11 pt; correspondence is 11 pt. Supporting captions and
qualifications use 10 pt, with smaller table/chart labels and running furniture.
The original mark, mixed-case wordmark, palette and letter-page format remain.

## What was verified

- All six pages rendered and visually inspected, with selectable text,
  embedded fonts and six PDF navigation bookmarks.
- The three insurer rows reconcile to $20,500 with equal weighting.
- Five hypothetical asking prices yield $22,400 / $22,900 / $23,400 low/median/high.
- The median gap is $2,400 (11.7%); the low-price gap is $1,900. Neither is a
  proven error, settlement target or recoverable amount. No double-counting.
- Revising each condition deduction from $1,100 to $300 yields insurer-adjusted
  values of $21,300, $21,700 and $20,900, averaging $21,300.
- Chart coordinates are calculated on one linear $20,000-$24,000 axis;
  the range spans precisely $22,400-$23,400 and the median marker is $22,900.
- Current code and focused offline checks support a customer-selected,
  evidence-grounded follow-up even when there is no clear recommendation
  to accept or reject the revised offer. Details are in the verification note.
- The public customer-start page and complete refund policy were visibly opened
  and checked on September 25, 2026. The same exact URLs are PDF link targets.

No application or production behavior was changed. No customer records, live
market searches, paid provider calls, payments or sent communications were used.
The local checks verify the exercised code paths, not a hosted customer journey.
