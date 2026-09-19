# Working in Venfour

Venfour is a self-service total-loss vehicle valuation advisor. Customers use its
explanations and evidence when speaking with their insurer; broader company
possibilities are context, not an implementation backlog.

## Start with the affected area

- `frontend/`: React/TypeScript public site and customer/staff/partner application.
- `venfour/`: authoritative Python analysis, API, commerce, and provider services.
- `tests/`: Python tests; frontend tests live beside their implementation.
- `supabase/`: migrations, database tests, and functions; `schemas/`: shared contracts.
- `scripts/`: local tooling and operational commands; `frontend/worker/`: edge proxy.
- [Repository map](docs/engineering/repository-map.md): exact paths for checkout,
  workspace, free estimate, partners, homepage, backend, and environment boundaries.

Read the scoped `AGENTS.md` on the path to files you work on: `frontend/`,
`frontend/preview/`, `frontend/worker/`, `venfour/`, `supabase/`, or `scripts/`.
When starting at repository root, read the relevant scoped file explicitly;
do not preload unrelated scopes or entire documentation directories. Python tests
use `venfour/AGENTS.md`; shared-schema work reads the affected producer/consumer scope.

## Working rules

- Implement the requested scope; preserve existing contracts and unrelated work.
  Inspect the relevant entry point and direct dependencies before changing them.
- Keep evidence eligibility, ranking, historical verification, calculations, and
  classifications deterministic in Python. The frontend consumes presentation
  contracts. Preserve provider-neutral boundaries and immutable audit history.
- Distinguish facts from conclusions: advertised prices are not sale prices,
  legal entitlement, guaranteed settlements, appraisals, or proof of wrongdoing.
- Never expose/commit secrets. Do not deploy, change hosted data/infrastructure or
  Stripe configuration, make real charges, or consume paid/limited provider quota
  unless the task explicitly authorizes that action. Destructive production work
  requires explicit scope, justification, and recovery safeguards.
- Local/offline/synthetic evidence does not prove hosted readiness. Inspect cloud,
  database, deployment, and provider state only when the task depends on that state.
- Use `rg --files <area>` and bounded `rg -n` searches; widen when evidence requires
  it. Read relevant sections of large files. Search exclusions in `.rgignore` are
  discovery defaults, not deletion or evidence of absence; use a named path with
  `rg --no-ignore` when investigating excluded artifacts.

## Verification and completion

Choose by changed behavior and dependency impact, not the page name:
1. Local copy/style/component: relevant test or local visual check; targeted lint
   where useful. Documentation-only: links, paths, diff checks.
2. Shared subsystem behavior: affected subsystem tests and relevant type/lint checks.
3. Auth, payment logic, persistence, schemas, or major routing: broader affected
   consumer/server tests, integration coverage, and build where relevant.
4. Migrations, deployment, secrets, security, or provider execution: stronger
   boundary-specific verification; local rehearsal first, external actions only
   within explicit authorization.

[Verification commands](docs/engineering/verification.md) gives targeted examples.
Do not run all suites/builds or operational checks by default. Broaden for actual
impact, failures, or explicit requirements; report failures rather than hide them.
Finish with a scope/diff review, `git diff --check`, and a concise account of changes,
checks and limits. Stop when relevant checks pass and no material uncertainty remains.

Keep a task for related iterations. Prefer a fresh task when switching unrelated
subsystems or a long history repeatedly requires compaction/reinvestigation; carry
forward only the objective, constraints, files, decisions, and unresolved checks.
