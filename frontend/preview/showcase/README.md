# Local customer application

From the repository root:

```sh
node scripts/dev-showcase.mjs
```

Open **http://127.0.0.1:4187/_local/showcase**. Stop with `Ctrl+C`.

The launcher uses the current `appRoutes`, `AppProvider`, intake forms, version-8 free valuation, checkout, completed review, request editor, insurer-response form, acceptance steps and case record. There are no showcase pages or copied customer components. A small fictional-data notice and **Reset walkthrough** are the only extra interface.

Choose **I have my valuation report** to show the real upload screen with the sample already attached, or **I don’t have the report** to show the prefilled vehicle and claim forms. Continue through the real contact form and its explicit acknowledgements. Both paths retain the sample for full review. The real purchase button records a local paid entitlement; external billing/card elements are omitted and no Stripe session exists.

Continue through result → insurer review → market evidence → comparison → message preparation. The adjuster email and claim number are prefilled. Create and edit the normal request; **Open my email app** simulates that external action without opening a mail client. Confirm the report attachment and mark the message sent. Continue to waiting, select **I received a response**, and submit the prefilled reply and revised offer. The optional real file chooser also accepts `frontend/preview/showcase/generated/Synthetic_Insurer_Response.pdf`; other evidence has no precomputed review. Choose **Accept this offer**, follow the actual acceptance steps, explicitly confirm closure, then open **View my case record**.

**Reset walkthrough** restores the initial choice, populated forms, attachment, and unpaid state. It clears this fixture’s request versions, response drafts and outcome without database cleanup. Refresh preserves saved progress.

## Data and decisions

Everything is fictional: Jordan Example, Example Insurance, a 2024 Hyundai Elantra SEL, a $20,000 original vehicle valuation, selected asking prices of $24,000–$24,800, and a $24,500 revised offer. The sample insurer PDF is clearly labeled synthetic. The Venfour PDF is created by the current validated report builder and renderer with its fictional marker.

`scripts/prepare_local_showcase.py` uses the current offline analysis transport and real strict-review calculation, payment-readiness checker, final-assessment builder and response recommendation policy. It fails if the evidence does not qualify or the completed review does not support continuation. The free result uses the current presentation contract, version 8. The initial request uses the current shared reconsideration template.

The current response policy returns **No clear recommendation** for the revised amount; advertised prices alone do not establish a settlement recommendation. The customer explicitly chooses acceptance and confirms the outcome through the real UI. The fixture does not change that rule. This demonstration follows the acceptance branch; it does not provide new provider analysis for edited evidence or a separate follow-up round.

`state.ts` supplies local auth/services and API responses. `records.ts` persists the wire records consumed by the normal customer state machine, including workflow revisions, immutable prepared versions, response lineage and closure. The current frontend API parsers validate these responses in the focused test. Unrecognized requests and evidence fail closed.

## Isolation and verification

Vite permits loopback development only and rejects builds and backend requests. It does not load environment files. CSP denies external network connections, scripts and frames. Fetch is allowlisted to local fixture responses and generated assets; email and payment integrations are replaced only at their external boundaries. The generator denies socket connections and uses mocked transports, with no production or staging database, auth, storage, provider or payment connection.

Requires the repository `.venv` and installed frontend dependencies. No credentials are required.

```sh
frontend/node_modules/.bin/tsc -p frontend/preview/showcase/tsconfig.json --noEmit
npm --prefix frontend test -- --run preview/showcase/state.test.ts
```

The focused checks cover prefill, real contract parsing through the complete acceptance journey, positive eligibility, request editing/versioning, response lineage, saved outcome, reset, premature-payment rejection, another-case rejection, signed-out access and blocked external requests. The same journey is also walked in the local browser.
