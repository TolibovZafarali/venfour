# Database and function scope

- Read the affected migration/function and dependent gateway/schema contract.
  Preserve ownership, RLS, private storage, immutable history, and retry/idempotency.
  Do not edit applied migration history to change a deployed database.
- Database tests are `tests/database/*.test.sql`; concurrency and rehearsal tests
  have separate directories. Select affected assertions first, then broaden for
  shared policies, functions, constraints, or compatibility changes.
- `scripts/run_isolated_database_tests.py` (repository root) accepts explicit SQL
  files and requires a dedicated `venfour-migration-rehearsal*` container with
  network mode `none`. Inspect setup requirements before using it.
- Resets destroy local data: verify the target is a disposable test database.
  Never infer that a linked/default project is local or safe. No hosted migration,
  cleanup, backfill, destructive query, or data change without explicit task scope.
- Production-sensitive work needs a current target/compatibility check, local
  rehearsal, and recovery safeguards. Historical runbooks/counts are not current
  deployment evidence and are not authorization to execute their commands.
- Never expose service-role credentials or put server secrets into browser config.
  Ordinary frontend/backend changes do not require database assertions or checks
  of hosted migration state unless they alter a database boundary.
