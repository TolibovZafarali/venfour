# Persistent customer workspace

Local visual redesign for review. Nothing has been deployed.

## Free Result and upload modal

The Free Result now gives the range the strongest emphasis, followed by one short next-step explanation and one upload button. Current-market versus loss-date context remains visible. Listing context stays distinct from an estimate. Dates, listing examples, and detailed limitations remain available in an expandable evidence section; its label calls out the number of limitations.

The upload button opens an accessible modal over the same mounted result. The `?upload=report` URL restores the modal after refresh and works with browser Back/Forward. Escape and Close restore focus to the upload button. The modal traps focus, locks background scrolling, and keeps upload, extraction, fact confirmations, strict review, and payment readiness inside the same dialog. It leaves the report flow only after the customer explicitly chooses to continue to checkout. Invalid PDFs and incomplete reports remain recoverable in the modal. A choice made during confirmation survives closing and reopening the modal in the same workspace, and is discarded if the report revision or issue changes. Refresh restores the persisted stage; an unsubmitted choice is not saved across a full browser reload.

[Free Result](http://127.0.0.1:4186/_local/workspace?state=free) · [Upload modal](http://127.0.0.1:4186/_local/workspace?state=upload)

[Desktop result](desktop-free-result.png) · [Desktop modal](desktop-report-upload-modal.png) · [390px result](mobile390-free.png) · [390px modal](mobile390-report-upload-modal.png) · [320px modal](mobile320-report-upload-modal.png)

## Architecture

`AppShell` keeps the header, legal footer, background, account menu, and `CustomerWorkspace` mounted across case routes. `CustomerWorkspace` owns the shared width, vehicle context, section selector, and central content position. The existing route outlet renders the current stage inside it.

Vehicle context reuses the existing case-list query and checks ownership before displaying a label. A missing label does not hide vehicle information already supplied by the result. Processing uses the same provider handoff as before; the active form remains mounted but hidden and inert while the inline processing view is shown. This preserves authored state and leaves the account menu usable.

The normal workspace is 880px wide, including its responsive gutters. At 1440px, the stage starts at x312.5 / y176 and its main title at y208. Free result, upload, extraction, confirmation, strict review, checkout, paid processing, and waiting share this stage position. The Free Result heading, value range, supporting copy, and actions are centered within the stage. The completed result uses its existing small h1 label followed by the main conclusion at the title position. A reserved scrollbar gutter prevents short-to-tall horizontal shifts.

## Routes unified

| Existing route | Shared presentation |
| --- | --- |
| `/total-loss/cases/:caseId/analysis` | Loading, recovery, free estimate, listing context, and insufficient evidence |
| `/total-loss/cases/:caseId/review-report` | Opens the report modal over the saved Free Result, including extraction, confirmation, strict review, and payment readiness |
| `/total-loss/cases/:caseId/claim/*` | Checkout, payment return, paid processing, completed review, evidence, request preparation, waiting, insurer response, follow-up, and case record |
| `/start?service=total-loss&caseId=…` | Existing-case intake and correction, using the original form |
| `/analyses/:runId` | Saved analysis and status views |

New-appraisal entry remains the intake experience. Account-menu switching remains the way to choose another appraisal. No dashboard or admin/staff/partner redesign was added.

## Local launcher

[All preview states](http://127.0.0.1:4186/_local/workspace)

| State | Interactive fixture | Screenshot |
| --- | --- | --- |
| Free result | [Open](http://127.0.0.1:4186/_local/workspace?state=free) | [Desktop](desktop-free-result.png) |
| Report upload modal | [Open](http://127.0.0.1:4186/_local/workspace?state=upload) | [Desktop](desktop-report-upload-modal.png), [390px](mobile390-report-upload-modal.png), [320px](mobile320-report-upload-modal.png) |
| Fact confirmation | [Open](http://127.0.0.1:4186/_local/workspace?state=confirmation) | [Desktop modal](desktop-confirmation-modal.png), [320px modal](mobile320-confirmation-modal.png) |
| Payment ready | [Open](http://127.0.0.1:4186/_local/workspace?state=ready) | [Desktop modal](desktop-automatic-payment.png), [390px modal](mobile390-automatic-payment.png) |
| Checkout | [Open](http://127.0.0.1:4186/_local/workspace?state=payment) | [Desktop](desktop-payment.png) |
| Paid processing | [Open](http://127.0.0.1:4186/_local/workspace?state=paid) | [Desktop](desktop-paid-processing.png) |
| Completed review | [Open](http://127.0.0.1:4186/_local/workspace?state=completed) | [Desktop](desktop-completed-result.png), [390px](mobile390-completed.png) |
| Waiting | [Open](http://127.0.0.1:4186/_local/workspace?state=waiting) | [Desktop](desktop-waiting.png), [320px](mobile320-waiting.png) |
| Saved intake | [Open](http://127.0.0.1:4186/_local/workspace?state=intake) | [Desktop](desktop-saved-intake.png) |
| Zero cases | [Open](http://127.0.0.1:4186/_local/workspace?state=zero) | [Desktop](desktop-zero-case.png) |

All shown cases, valuations, reports, login sessions, and payment fields are fictional. These fixtures verify presentation and route behavior, not live provider processing or hosted persistence. Screenshots show the viewport; long screens continue below it.

## Earlier workspace verification

Browser checks covered free result to upload, upload refresh, back/forward, PDF selection through the native file picker, extraction to confirmation, confirmation to strict review and final check, readiness to checkout, direct links, completed sections, waiting, saved intake, zero-case entry, and simulated logout/login resume. Appraisal switching worked on desktop and 320px. Case history opened and closed with Escape. Upload help worked with the keyboard. The original response-draft protection remained active, and authored text was restored after leaving and reopening the editor.

Desktop 1440px, tablet 768px, mobile 390px, and mobile 320px were inspected. The main stage matrix had no horizontal overflow. Reduced-motion behavior was checked with automated preference tests and the loaded CSS rules; the browser tool does not expose native media-preference emulation. New entrance motion is a 240ms fade, with no blur or sideways movement, and is disabled for reduced motion.

[Layout observations](layout-observations.json) retain measurements from development and the final desktop pass. Entries prefixed `final-desktop-` and suffixed `-final` are the corrected measurements.

## Preserved boundaries

The workspace redesign preserves the backend, API contracts, valuation, evidence, persistence, authentication, claim routing, report downloads, and payment services. The later payment-policy follow-up adds one configuration migration to disable manual payment approval; it does not replace any eligibility, checkout, or report-release function. The report mutation function, query/polling policy, API calls, and exact checkout version/digest payload were compared to the starting revision and matched. The shared report view now lives in `frontend/src/features/full-review/report-review.tsx`. The existing report route opens that view in the same modal over a read-only saved result. Loading and confirmation no longer navigate away from the modal. Presentation callbacks track pending actions and preserve an unsubmitted confirmation choice while the dialog is closed. Existing form keys, submission gates, recovery, and ownership fences remain in place. See [the source comparison](source-boundary-audit.json).

The final automated results are recorded in [validation.json](validation.json).

Free Result alignment follow-up: centered blocks and text were verified at 1440px, 768px, 390px, and 320px with no horizontal overflow. The corresponding Free Result screenshots were refreshed. This follow-up changes only workspace CSS; no workflow code changed.

Final modal checks: 2,072 tests passed and 3 skipped across 123 files (122 passed, 1 skipped). Build, TypeScript, contracts, lint, and diff checks passed. Browser checks covered all four widths, focus trapping/restoration, background scroll lock, modal refresh and history, and a fictional PDF upload through confirmation, strict review, and final approval. No deployment occurred.

Report-workflow follow-up: all five persisted report stages were inspected inside the modal at 1440px, 768px, 390px, and 320px. All 20 views fit the viewport without horizontal overflow and kept Close accessible. The same dialog remained mounted through the fictional PDF upload, extraction, confirmation, strict review, and approval transitions. Saved report URLs and refresh restored the modal. Opening a saved report did not submit an unfinished free valuation. The existing Continue to payment action was verified separately.

## Automatic payment eligibility

The customer no longer waits for manual payment approval. Migration `20260915000300_automatic_payment_eligibility.sql` sets the existing supervision setting and its default to false. Strict report/evidence eligibility, customer confirmation, ownership, current input/report versions, checkout configuration, and payment processing remain authoritative. Existing approval history is retained. Independent report quality review still runs before final report release.

The modal now moves from confirmation through automated checks to **Ready for your full review** and **Continue to payment**. The visual preview's former approval state and saved approval previews resolve to readiness. Customers choose when to enter checkout.

The migration was rehearsed in a new network-isolated database with all repository migrations. The shared local database has unrelated pending migrations and was not changed. No hosted database, provider service, or deployment was changed. See [automatic payment verification](automatic-payment-validation.json) for this follow-up's results.

Automatic-payment verification passed: 77 backend tests, 55 affected frontend tests, and 2,729 database assertions across 53 suites. Build, TypeScript, contracts, lint, and diff checks passed. Browser checks confirmed confirmation → automated review → readiness in one modal, refresh recovery, and explicit continuation to checkout. Desktop and 390px views were inspected. No live provider calls or deployment occurred.
