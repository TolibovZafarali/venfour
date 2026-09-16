# Local historical showcase

Start from the repository root:

```sh
node scripts/dev-showcase.mjs
```

Open **http://127.0.0.1:4187/_local/showcase**. The launcher rebuilds the sanitized local assets, then starts a loopback-only server. It requires the repository's existing `.venv` with its current Python dependencies, PyMuPDF and ReportLab, and the installed frontend dependencies. It does not need Supabase, a backend, Stripe, an account, or a market-provider key.

Use **Start the walkthrough** to review the result, insurer evidence, market evidence and conclusion in the existing customer interface. Complete each page using its bottom action. Dismiss the normal cookie notice once if it covers the action. **Reset walkthrough** clears only this browser's showcase reading state and returns to the introduction. **Unlock review sections** makes all four existing review sections available for a shorter demonstration. Refresh preserves progress. `Ctrl+C` stops the server; repeat the command to restart.

## Genuine source and selection

The selected source is the existing local **2024 Hyundai Elantra SEL** CCC report, `data/raw/ccc/ccc-002-elantra-state-farm.pdf`, and immutable local analysis run `37310623-c6da-42fc-a7a6-2b7eea276378` captured August 12, 2026. The existing Python repository validator and presentation service validate and project the saved run before preparation. The original raw report and run are never modified.

This was the strongest genuine saved case found: twelve insurer comparables, nine selected loss-date historical comparables and nine separately retained then-current comparables. The Camry source had no loss-date historical evidence; the earlier Elantra runs had smaller selected historical sets. Synthetic fixtures were excluded from genuine-case selection.

The original outcome is **NO_MATERIAL_DISCREPANCY**. The insurer value is **$19,046**; the selected historical advertised-price median is **$19,608**, a difference of **$562 / 2.95%**. The original outcome and figures remain unchanged. There is no genuine saved material-undervalue case in the inspected local sources. Do not describe this as a customer recovery, insurer error, approved paid report, successful negotiation or promised additional payment.

## What is sanitized or supplemented

- The source excerpt retains original pages 1 and 6–15, with owner identity, claim/reference fields and repeated private headers removed. The source PDF's SHA-256 is pinned before coordinate-based redaction. Pages with subject VIN and other private details are omitted. Pages are permanently rasterized after redaction, with no hidden source text layer, attachments or original metadata. Public dealer details and dealer-comparable VINs remain in the original excerpt.
- JSON and the local summary omit owner details, address, claim/report references and subject VIN. Source hashes and local filenames record provenance. No production customer database, auth user, storage object or backup was used.
- The current customer review components consume a local display adapter of the older saved result. The account, payment/refund status, case identifier and reading progress are simulated only to render the existing workflow. They are not actual commerce or strict-review records. The persistent showcase notice makes this explicit.
- The downloadable summary is newly generated **local historical showcase material**, clearly labeled as such. It is not an original insurer report or a newly approved Venfour customer report. The original insurer excerpt is separately available from the introduction.
- The legacy run searched ZIP **63123**, while the source report lists **63026**. Original distances and results remain unchanged; this limitation is disclosed in the introduction, methodology and summary. No paid rerun or invented correction was performed.
- Six insurer-comparable rows lack itemized adjustments in the saved extraction. The redacted source excerpt is available for inspection; missing details do not establish an error.

## Isolation and verification

Generated assets live only in `frontend/preview/showcase/generated/`, which is ignored by Git. This directory is outside the production Vite entry point and public assets. The preview configuration rejects build commands and non-loopback hosts, loads no `.env` files, blanks service credentials, blocks external browser requests with CSP, and denies raw `data/`, output, environment and key files. Unimplemented API calls, case writes, real payments and communications fail closed. No database is seeded or reset.

The public and customer production applications never import this entry point. Do not deploy this directory, place its generated assets in production public assets, or point the showcase at a hosted backend.

Validation includes the four-stage desktop/mobile walkthrough, expandable evidence, PDF opening/downloading, refresh and reset, TypeScript checking, no external requests, and attempted backend/checkout/raw-file requests being blocked. Preparation makes zero provider requests and zero database writes. Source integrity and redaction must be re-reviewed if the original source PDF changes; preparation refuses a different PDF hash.

For a collision-center visit, start the server before leaving and keep the browser tab open. All case evidence and PDFs are served locally; no valuation job runs during the walkthrough.
