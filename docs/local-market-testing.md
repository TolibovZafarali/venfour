# Local valuation testing with MarketCheck fixtures

Run from the project root:

```sh
colima start
node scripts/dev-local.mjs --mock-market
```

The launcher applies pending migrations with `migration up --local`, prepares
fictional PDFs, and starts the backend on 127.0.0.1:8000 and frontend on
localhost:5173. It does not deploy or contact a linked database. Existing local
cases are retained. Ctrl+C stops the application processes; Supabase remains up.

Open <http://localhost:5173/api/local/market-fixtures> for the reports and
<http://localhost:5173/start?service=total-loss> for the actual intake.

1. Use your own CCC PDF, or download `expansion.pdf` for a completely fictional test.
2. Start a Total Loss review and choose **I have my valuation report**.
3. Enter your ZIP and upload your CCC PDF. For the optional sample PDF, use **63026**.
4. Enter fictional contact details, for example Local Tester and
   `market-test@venfour.test`. A signed-in test account uses its existing email.
5. Select the required local test acknowledgements and **Review & analyze**.
   The real upload, local private storage, extraction contract, search adapters,
   deterministic valuation, and immutable result persistence execute.
6. Inspect the valuation preview. **Continue my review** opens the claim.
7. Verify the saved email using the six-digit code from
   <http://localhost:54324>. The preview email can trigger the existing 60-second
   email cooldown; wait for the resend control and use the newest verification
   code. A preview access link alone does not secure permanent claim ownership.
8. To test the completed package, copy the case UUID from the URL and run:

   ```sh
   .venv/bin/python -m scripts.local_market_flow fulfill CASE_ID
   ```

   This simulates a local payment and executes the real package, PDF generation,
   review-contract, and publication workflow. The report reviewer is also a
   deterministic fixture. No card, Stripe, or model provider is contacted by
   this helper. Checkout may show payment temporarily unavailable before it runs.
9. Refresh the case. Continue through **Your result**, **Insurer review**,
   **Market evidence**, **What it means**, and **Request preparation**.
   Expand **See selected market listings** and inspect **Higher-priced comparable
   listings**. Use **View report** or **Download report** in request preparation.
10. Reload or return using the saved case URL to verify persistence. Reopening
    a completed case should not add fixture requests.

Your own report uses the existing document-extraction provider and requires its
credential in the ignored root `.env`. Uploading it sends the PDF to that reader
and can incur document-extraction usage. MarketCheck remains mocked and its
credentials are removed from the backend. The listings copy extracted vehicle
details and use your ZIP, with fixed fictional prices starting at $20,000;
prices do not depend on the insurer offer. Unknown powertrain details stay unknown.
The default scenario expands beyond the customer location when possible.
The optional sample PDFs also mock extraction and need no external provider.

All market listings, prices, dealers, and history are fictional. Source URLs
use `.invalid`. The application displays a local-test notice. These results do
not establish a real vehicle's value. Generated
files and local request logs are under `output/local-market/`, which is ignored.

| Fixture | Expected behavior |
| --- | --- |
| `dense.pdf` | Enough local evidence; no extra geographic center is needed. |
| `expansion.pdf` | Two local matches, followed by a productive additional center; separate supporting listings. |
| `limited.pdf` | One match; bounded geographic expansion; insufficient evidence. |
| `failure.pdf` | Simulated provider timeouts and retries; no reliable valuation range. |
| `budget.pdf` | A five-attempt case cap; partial evidence and uncertainty; no supporting pass. |
| `resume.pdf` | Intentional interruption after a durable checkpoint; **Retry value check** completes without recharging completed work. |

The normal fixture case policy uses the production defaults, including 60 total
attempts and at most five supporting attempts. The `budget` fixture deliberately
lowers the total to five. The shared monthly allowance (100,000), rate window
(10,000 per second), and seven-day fixture checkpoint retention are local test
settings, not verified MarketCheck plan terms. No tariff is configured. Fixture
reservations test accounting; they are not billable provider requests.

Inspect <http://localhost:5173/api/local/market-fixtures/status> to compare the
case-scoped database ledger with the fixture transport log. The native
MarketCheck HTTP transport is disabled. An additional process-level guard denies
nonloopback DNS and socket connections, including direct IP connections, except
the document reader's official host and its resolved TLS addresses during an
extraction call. Proxy overrides are removed. MarketCheck remains blocked during
document extraction too. Three
startup self-checks deliberately exercise these blocks. Their counters are
reported separately from fixture attempts; no probe reaches a provider.

The frontend uses the local backend proxy and local Supabase. Its development
content security policy also excludes MarketCheck. Browser and local auth may
load Cloudflare's test challenge; this does not involve MarketCheck. The backend
uses a fixture verifier for the official test token.

This verifies local application behavior, not live MarketCheck coverage,
provider billing, extraction accuracy for your report, payment processing, or a hosted
deployment. Leave `--mock-market` enabled throughout this test.
