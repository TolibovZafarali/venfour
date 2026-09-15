# Free valuation result redesign

## Design

- Lead with the saved preliminary range, its evidence basis, and a concise explanation of its meaning.
- Pair the result with an independent examination of the insurer's valuation and one clear upload action.
- Explain the three inspection areas: vehicle details, comparable vehicles, and valuation adjustments.
- Show the later $199 price beside the action and explain the full review's deliverables below.
- Preserve the distinction between estimates, listing context, and insufficient evidence, with expandable evidence details.
- Use white surfaces, grayscale typography, restrained dividers, and a single-column mobile layout.

## Local preview

Open http://127.0.0.1:4186/_local/workspace?state=free.

This preview uses fictional data and browser-local services. Uploads, report checks, and payment are simulated.

Start from the repository root with `npm --prefix frontend run preview:workspace`. Stop with Ctrl+C in that server's terminal. Reload the browser to load edits; reopening the link resets the fictional free-result state.

## Verification

- Production build and TypeScript/contracts check passed. The build retains the existing large-chunk advisory.
- ESLint passed for both changed TSX files. `git diff --check` passed.
- All 40 result-component tests and all 18 report-upload-dialog tests passed.
- 20 of 22 page tests passed. Two existing expectations for a `Legal` navigation footer conflict with the pre-existing workspace shell change that removes that footer. The failures occur during the processing screen, before this result component renders. The page suite also reports an unhandled mocked profile request.
- 30 responsive checks passed: estimate, listing context, and insufficient evidence at 320, 390, 768, 1024, and 1440 pixels, with normal and reduced motion. No horizontal overflow; evidence expands by keyboard; one primary upload action; white result surfaces.
- The simulated mobile flow passed: open and dismiss the modal, restore keyboard focus, upload the fixture PDF, confirm mileage, complete report checks, retain the original range, reload the saved completion, and explicitly continue to checkout. No checkout request preceded continuation.
- Browser checks recorded no uncaught page errors. Initial preview console messages included its missing favicon and the existing cookie-consent dismissal focus warning.

Detailed observations are in `responsive-checks.json`, `upload-flow.json`, and `tests.json`. Screenshots show the free result, alternate outcomes, upload, and ready states.

## Scope

Changes are confined to result presentation, its styles, and presentation markers on the existing report action. Valuation data, eligibility, upload handling, navigation, and backend contracts are preserved.
