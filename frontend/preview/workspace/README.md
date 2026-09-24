# Screen preview dashboard

Run from the repository root:

```sh
npm --prefix frontend run preview:workspace
```

Open [the local launcher](http://127.0.0.1:4186/_local/workspace). Stop the server with Ctrl+C in its terminal. The server binds only to `127.0.0.1:4186` and does not load environment files.


The dashboard provides 100 screen examples using the current application components, including the compact valuation results, restrained accent color, and revised pre-payment wording. It groups the available screens into public website, account and access, intake and free valuation, insurer report, payment and preparation, completed review, insurer response and outcome, admin, businesses, and status examples. Use search and the category selector to find a screen. **All screens** returns to the dashboard from customer, staff, and business previews. Legacy route aliases open their current screen and are not listed as separate pages. Paused diminished-value intake shows its current availability screen; inactive staff routes are not enabled.

Customer and staff/business examples run on the same preview server. Staff and business services use browser-local fictional records. Their edits persist in session storage; use the preview reset controls to restore examples. Incomplete intakes and email history use fictional records. Email history includes delivered, accepted, and failed examples; no email is sent. Retired payment-approval and communications-management routes are no longer listed. Partner earnings and business-specific earnings are available directly from the catalog.

The Response reviewed tile supports interactive fictional choices, follow-up preparation, and acceptance steps. Choices persist across refresh in this tab; use Restart review demo to reset them. Nothing is sent to an insurer. The Prepare your follow-up tile starts before draft creation and supports editing, a sample report attachment, simulated email opening, and sent confirmation. Progress stays on this page until Track your insurer’s reply is selected. Edits survive refresh; Restart follow-up demo resets the example. The Confirm acceptance tile supports reviewing a saved fictional offer, confirming acceptance, and closing the local case. Alternative closure outcomes are available inside the first acceptance substep. The three-step panel stays in place after closure, and View my case record opens the saved outcome. Restart acceptance demo resets this example. The Your case record tile shows a saved fictional closure with expandable messages and reviews, a sample PDF, and no final continuation action. The other response tiles are fixed saved-state examples. Start and recovery pages also support visual inspection; this dashboard does not simulate the complete intake or recovery workflow.

Validate the preview with `cd frontend && npx tsc -p preview/workspace/tsconfig.json` and `npx vitest run preview/workspace`.

By default, the preview uses the production routes and components with fictional, browser-local services. Fetch calls are intercepted, external connections are blocked by a local content-security policy, and payment fields are simulated. No real charge, report extraction, market search, email, or hosted database write occurs.

Choose **Entering the app** to preview the real workspace entry route with delayed local authentication. **Fast** resolves in 120 ms, **Slow** in 2.5 seconds, and **Hold loading** waits for **Continue**. **New visitor** shows the initial intake choices during the same slow setup. **Replay** restarts the selected experience. The glass header stays visible; the small indicator appears only after 300 ms, and saved content appears as soon as it is available.

Start with **Free result** and choose **Upload insurer valuation report**. The button opens the report-upload modal over the saved result. Upload `fixtures/insurer-valuation-preview.pdf` to simulate extraction, mileage confirmation, and automated eligibility checks. Upload, confirmations, and processing stay in the modal. When processing finishes successfully, the modal closes automatically and Free Result shows the saved report and Continue to payment action. Refresh preserves the simulated stage and restores the modal. Each customer launcher tile resets the fictional case and customer sign-in return location to its named state. Saved-report and missing-drive-type tiles preserve the original upload. Incomplete-report, extraction-failure, insufficient-evidence, and interrupted-review tiles show the current recovery states. The completed no-dispute tile shows retained report access after a simulated refund. The account menu offers a second fictional appraisal and simulated sign-out/sign-in.

Saved-intake and insurer-response screens support visual inspection. Their live write and document-delivery services are intentionally not connected. The payment example uses a fictional $199 price.

Choose [**Payment · unverified account**](http://127.0.0.1:4186/_local/workspace?state=payment-unverified) for checkout with a guest account and no payment details entered. Payment stays locked until email verification. **Send verification code** simulates delivery; enter **123-456** to reveal billing and card fields. The **Country** dropdown defaults to **United States**, and the **State** dropdown lets you select any U.S. state or the District of Columbia. The remaining payment fields are empty and read-only. No email is sent and no payment can be submitted. Refresh preserves verification but resets country and state selections; opening the launcher tile again resets verification and payment details.

Choose **Prepare your message · Interactive** in **Completed review** (or `/_local/workspace?state=message`) for the complete fictional message experience. Create a draft, edit its recipient/subject/body, refresh to check saved edits, download or view the labeled sample PDF, and use **Open my email app** to simulate the email handoff. The preview never opens an external mail client or sends an email. **Copy email** copies the fictional text to your clipboard. After checking the attachment acknowledgment, **Mark as sent** records a local simulation; **See what happens next** opens the waiting screen. **Restart message demo** restores the initial example. **Message · Missing details** starts with empty email and claim-number fields; **Review your message · Interactive** starts with a saved draft. State stays in this browser tab and resets when a launcher tile is reopened.

Choose **Waiting for insurer · Interactive** in **Insurer response & outcome** (or `/_local/workspace?state=waiting`) to start directly with a fictional sent message. Expand the report, view or download the sample PDF, revisit the saved message, and use **I received a response** inside the panel to open the response form in place. Paste a fictional reply or enter a revised offer and save it locally. **Response saved** appears in the panel; the progress line stays on waiting until **View response review** is selected. The review contains the saved reply and correction action. Uploads and response analysis are not simulated; the saved response stays pending review. **Restart waiting demo** creates a fresh waiting example. Refresh preserves the current example and unfinished text and offer drafts.

The other completed review tiles are fixed saved-state previews: its reading checkpoints are already complete and its journey remains at the result stage. Navigating between sections demonstrates the real page transitions, but does not advance the progress line. In the application, the line advances when a new checkpoint is saved; revisiting completed sections does not move it backward.

The catalog tests check every customer scenario and reject links to removed application routes. Fixture tests validate customer report and claim responses and current staff resources. Browser checks confirm all catalog entries render locally; this does not establish production readiness.

## Stripe test fields on the existing checkout page

To show real Stripe Address and Payment Elements within the existing checkout page, provide an existing, open $199 USD test-mode Checkout Session created through the backend gateway. Store only its `publishableKey`, `checkoutSessionId`, and `clientSecret` in an ignored local JSON file, then start:

```sh
VENFOUR_WORKSPACE_STRIPE_SESSION_FILE=/absolute/path/to/checkout.json npm --prefix frontend run preview:workspace
```

Open [Payment](http://127.0.0.1:4186/_local/workspace?state=payment), or use **Payment · unverified account** and the demo verification code above. This opt-in mode removes the Stripe mocks and permits Stripe's scripts and frames. The Address Element defaults to United States, supports country selection and autocomplete, and shares the production Checkout Elements provider with the Payment Element. The existing account section and order summary remain on the page. Payment submissions are intercepted before confirmation; account verification forms still work. Only test-mode keys and matching test Session identifiers are accepted, and no secret API key is loaded or served.

The Session expires on Stripe's normal schedule; replace the JSON with a fresh test Session and restart if necessary. Stop with Ctrl+C. Restart without the variable to restore the offline simulated fields.
