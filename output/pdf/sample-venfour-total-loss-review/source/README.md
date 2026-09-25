# Sample Venfour Total-Loss Review

Editable source for an eight-page, US Letter sample customer packet. All case
facts, insurer records, listings and correspondence are hypothetical. The packet
combines a valuation review with customer guidance that appears across the real
workflow; it is not represented as an exact application export.

## Files

- `sample-review.json`: editable narrative, case facts, insurer comparables and
  market records.
- `build_review.py`: page layouts, embedded typography, arithmetic checks,
  navigation bookmarks and PDF generation.
- `venfour-mark.svg`: unchanged copy of the repository's brand mark.
- `CAPABILITY-VERIFICATION.md`: current-source references supporting product
  statements, together with the sample's deliberate limits.
- `requirements.txt`: minimal build dependency.

## Rebuild

Run from this directory using Python 3.10 or later:

```sh
python3 -m pip install -r requirements.txt
python3 build_review.py --output ../Sample-Venfour-Total-Loss-Review.pdf
```

The default font configuration uses macOS Helvetica Neue for body text and
Avenir Next Demi Bold for the wordmark, reflecting the repository's sans-serif
and wordmark stacks. The PDF embeds the fonts it uses. Font files are not
redistributed in this bundle.

On a system without those fonts, supply a folder containing appropriately
licensed `regular.ttf`, `bold.ttf`, `italic.ttf` and `wordmark.ttf` files:

```sh
python3 build_review.py --fonts-dir /absolute/path/to/fonts
```

Edit the narrative in `sample-review.json`. Typography, spacing and table
formatting live in `build_review.py`. Repeated summary labels and the insurer
arithmetic display also live in the builder. If changing case amounts, update
the related prose, displays and expected arithmetic assertions together. The
assertions deliberately prevent a partially updated sample from building.

The builder writes a text-boundary record under `qa/`. Render all final pages
and inspect them after any content or layout change; longer text can require
spacing changes. The builder rejects paragraph overflow rather than silently
clipping it. It makes no network calls and does not import or invoke the
application's analysis, payment or provider services.

## Design

White background; #171717 text; #525252 supporting copy; restrained #d4d4d4
rules and #f5f5f5 callouts. Blue is reserved for service links. The original
Venfour mark remains vector artwork, with mixed-case Venfour branding.
Repeated sample labels, a fictional case reference and an explicit disclosure
prevent the packet from being mistaken for customer evidence.

## Final verification

- Eight pages rendered and visually reviewed.
- All three insurer adjustment rows reconcile; their mean is $20,500.
- Five hypothetical prices produce $22,400 / $22,900 / $23,400 low/median/high.
- The median comparison is $2,400, or 11.7% of $20,500; the low comparison is
  $1,900. Neither figure is a promised recovery or an appraised value.
- The hypothetical revised condition deductions reconcile to $21,300.
- The revised-offer example returns no clear recommendation, consistent with
  the saved-assessment boundary in the current implementation.
- Sample labels appear on every page; the PDF contains selectable text,
  embedded fonts, eight navigation bookmarks and service hyperlinks.
- No application code or production state was changed. No customer data,
  live listings, paid provider calls or insurer communications were used.

Product statements were checked against the local repository on September 25,
2026. This is source-based verification, not a hosted operational test.
