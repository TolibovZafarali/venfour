# Verification by impact

Select checks from changed behavior and its consumers. A payment-page margin
change is local; a change to payment authority, ownership, persistence, or retry
semantics is not. Honor explicit task-required checks. Failures remain failures;
report them and expand only when they reveal relevant uncertainty.

| Level | Change | Checks |
| --- | --- | --- |
| 1 | Copy, CSS, isolated component, developer docs | Relevant test or local visual check; changed-file lint when useful. Docs: links/paths/diff. No automatic backend, typecheck, build, database, or cloud checks. |
| 2 | Shared frontend/backend behavior | Affected subsystem tests, relevant type/lint checks and integration coverage. |
| 3 | Auth, payment logic, persistence, shared schemas, routing | Broader affected consumers/server tests, negative authorization/recovery cases, integration coverage, build when packaging matters. |
| 4 | Migrations, production infrastructure, secrets, security, paid-provider execution | Boundary-specific verification and isolated rehearsal; current hosted evidence only when necessary and authorized. Destructive work needs explicit scope and recovery safeguards. |

## Targeted commands

From repository root unless stated otherwise. Use existing paths/names matching
the change; examples are selectors, not a checklist to execute together.

```sh
# Checkout UI test file; use -t only after checking the actual test names.
npm --prefix frontend test -- src/pages/total-loss-claim-workflow-page.test.tsx
# Offline backend module, class, or individual test can be selected.
.venv/bin/python scripts/run_offline_tests.py test_commerce
# Edge proxy/environment boundary only.
npm --prefix frontend run test:worker
```

For changed-file lint, run from `frontend/`:

```sh
./node_modules/.bin/eslint src/features/total-loss-claim/components/checkout-experience.tsx
```

For meaningful shared type changes, `npm --prefix frontend run typecheck` checks
the package plus generated contract freshness. It is not a single-file check.
For presentation schema changes, use `generate:contracts` then `check:contracts`
and affected Python/frontend contract tests. Do not hand-edit generated types.

Database changes can use `scripts/run_isolated_database_tests.py --container
<dedicated-container> --output <local-output-directory> <affected-sql-file>`.
Inspect the script/setup first: it requires a dedicated rehearsal container with
network mode `none`. Broaden SQL suites for shared policies/functions or migrations.
Never reset a valuable local database or substitute a linked hosted target.

## Commands that are broad or operational

- `npm --prefix frontend test` runs all discovered Vitest tests.
- `npm --prefix frontend run lint` uses `eslint .`, including tooling/preview code.
- `typecheck` runs the contract check plus referenced TypeScript projects.
- `build` repeats contract/type checks before Vite; avoid redundant separate
  invocations if the required build already passed those checks.
- `scripts/run_offline_tests.py` without selectors discovers the complete Python
  suite. Prefer it to raw discovery because it clears credentials and rejects
  unmocked network/child-process work; failures under the guard must be addressed.
- Full database assertions, resets, concurrency rehearsals, hosted migration,
  Cloud Run/Cloudflare health, Stripe, and provider checks belong only to tasks
  affecting those boundaries. A command described in a runbook is not permission.
- Native tooling tests can use `node --test <affected.test.mjs>` where applicable.
  Cleanup/concurrency/integration scripts have setup and side effects to inspect.

Local/offline/synthetic results prove only the exercised environment. Do not turn
an unavailable integration into a fabricated pass or weaken gates to pass tests.
Once relevant checks pass, review the diff, run `git diff --check`, and stop unless
new evidence requires more work. No application suite is needed for docs alone.
