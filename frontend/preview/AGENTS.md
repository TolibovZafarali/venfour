# Preview scope

`workspace/` is the canonical all-screens selector; start it with
`npm --prefix frontend run preview:workspace` at repository root and open
`http://127.0.0.1:4186/_local/workspace`. It reuses production UI with fixtures.
Keep fictional labeling and external-request blocking in the default mode.

`VENFOUR_WORKSPACE_STRIPE_SESSION_FILE` opts into a separate real Stripe sandbox
integration. Do not enable it for ordinary visual checks or equate it with the
fully mocked default. Payment testing requires the relevant explicit scope.

`showcase/` and `frontend/.tmp-*` are separate older harnesses, not the default
customer implementation. They are retained and excluded from routine ripgrep
searches; inspect them explicitly when a task names them. A preview screenshot
proves local presentation only, not hosted readiness or real case eligibility.
