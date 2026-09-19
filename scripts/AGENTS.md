# Tooling scope

Read the selected script's arguments and side effects before executing it.
Names such as local, verify, rehearsal, benchmark, or dry-run are not proof that
it avoids external calls or writes. Prefer existing offline/mock modes.

- `run_offline_tests.py` accepts unittest module/class/test names; omit names only
  when full regression is justified.
- Local launchers may start services, listeners, queues, and workers. Use only
  what the task needs; consult the relevant `docs/operations/` runbook for setup.
- Live benchmarks/search consume quota. Migration, backfill, delivery, and Stripe
  tools can change state. Execute only in explicitly authorized scope; verify
  target environment and keep credentials out of output.
- For tooling edits, run directly affected unit tests first. Do not execute a
  production script merely to verify its syntax or documentation.
