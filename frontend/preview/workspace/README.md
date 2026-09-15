# Customer workspace preview

Run from the repository root:

```sh
npm --prefix frontend run preview:workspace
```

Open [the local launcher](http://127.0.0.1:4186/_local/workspace). Stop the server with Ctrl+C in its terminal. The server binds only to `127.0.0.1:4186` and does not load environment files.

The preview uses the production routes and components with fictional, browser-local services. Fetch calls are intercepted, external connections are blocked by a local content-security policy, and payment fields are simulated. No real charge, report extraction, market search, email, or hosted database write occurs.

Choose **Entering the app** to preview the real workspace entry route with delayed local authentication. **Fast** resolves in 120 ms, **Slow** in 2.5 seconds, and **Hold loading** waits for **Continue**. **New visitor** shows the initial intake choices during the same slow setup. **Replay** restarts the selected experience. The glass header stays visible; the small indicator appears only after 300 ms, and saved content appears as soon as it is available.

Start with **Free result** and choose **Upload insurer valuation report**. The button opens the report-upload modal over the saved result. Upload `fixtures/insurer-valuation-preview.pdf` to simulate extraction, mileage confirmation, and automated eligibility checks. Upload, confirmations, and processing stay in the modal. When processing finishes successfully, the modal closes automatically and Free Result shows the saved report and Continue to payment action. Refresh preserves the simulated stage and restores the modal. Each launcher tile resets the fictional case to its named state. The account menu offers a second fictional appraisal and simulated sign-out/sign-in.

Saved-intake and insurer-response screens support visual inspection. Their live write and document-delivery services are intentionally not connected. The payment example uses a fictional $199 price.

Completed review is a fixed saved-state preview: its reading checkpoints are already complete and its journey remains at the result stage. Navigating between sections demonstrates the real page transitions, but does not advance the progress line. In the application, the line advances when a new checkpoint is saved; revisiting completed sections does not move it backward.

See [the visual review and verification notes](../../../output/persistent-workspace/REVIEW.md).
