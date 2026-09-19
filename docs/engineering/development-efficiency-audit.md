# Development efficiency audit — 2026-09-19

Scope: repository instructions, discoverability, and verification guidance only.
No application source, runtime/test configuration, infrastructure, hosted data,
Stripe settings, provider calls, secrets, or model/reasoning settings changed.
The initial working tree was clean. Measurements below are this checkout, not
credit accounting or a benchmark of future task duration.

## Findings ranked by likely avoidable work

1. **Unbounded discovery and missing entry-point map.** Before the change,
   default `rg --files` returned 1,480 files, including 467 under `output/`.
   Git tracked 468 output files (about 41.8 MB), 42 `.tmp-*` preview files,
   12 older showcase files, 12 browser artifacts, and a worker cache file.
   Hidden artifacts were already absent from ordinary `rg`, but appeared in
   hidden searches. Generated dependencies/builds/coverage were already ignored.
   Broad searches mixed current implementation with saved visual/test artifacts.
2. **Long, low-density root guidance.** Root `AGENTS.md` was 289 lines / 10,776
   bytes, largely product explanation, future possibilities, pipeline diagrams,
   and repeated scope/determinism principles already in README. It lacked a
   practical change-to-file map and testing policy. It did not mandate full tests,
   cloud checks, migration inspection, or provider calls for every change.
3. **Broad commands without a risk policy.** README listed full lint/typecheck/
   test/build, raw Python discovery, and local database reset/assertions. These
   were available commands rather than universal mandates, but offered little
   help choosing the minimum sufficient checks. `build` already repeats the
   contract/type checks; running all commands blindly duplicates work.
4. **Large mixed-responsibility modules.** `venfour/supabase_gateway.py` has
   4,538 lines, `api.py` 3,560, `commerce.py` 3,125; frontend total-loss intake
   has 3,104 and claim API has 3,168. Reading whole files is expensive.
   Generated database types have 8,145 lines but remain searchable because they
   are useful contract evidence. No source was deleted as supposedly unused.
5. **History and environment ambiguity.** README was 1,412 lines / 68,837 bytes;
   operational docs include dated deployments, migration counts and local QA
   results. For example, the migration backlog runbook specifies a historical
   34-file pending set. These are not auto-loaded instructions or current facts.
   Public/app pages share one package; local, full-service, default synthetic,
   optional Stripe sandbox, and hosted execution need explicit distinction.

## Active instructions before changes

Sizes are UTF-8 bytes. Approximate tokens use bytes / 4 for orientation only,
not measured model tokens or billing.

| Source | Bytes / approximate tokens | Scope and duplication |
| --- | --- | --- |
| `~/.codex/AGENTS.md` | 598 / 150 | Global Git naming/attribution rules; unique, retained unchanged |
| Repository `AGENTS.md` | 10,776 / 2,700 | Entire repository; substantial conceptual duplication with README and within itself |
| `~/.codex/config.toml` | 6,050 file bytes; not all injected prose | Global configuration; model `gpt-6-astra`, reasoning `high`; desktop Conventional Commit instruction. No project-doc fallback, size, root-marker, custom instruction-file or profile override found |
| Task/runtime-provided instructions | Variable, not a repository file | Desktop/tool behavior, memory guidance/summary, skill/plugin catalog, and user task constraints are visible in the session. These are separate from AGENTS discovery and were not rewritten |
| `README.md`, `docs/` | On-demand only | Not configured fallbacks, not recursively required by the original root instructions. Product content duplicates root; operational snapshots are historical |

Only two first-party AGENTS sources existed before this change. No global/root/
nested `AGENTS.override.md`, project `.codex/config.toml`, configured fallback
filenames, ancestor AGENTS files, or repository CLAUDE/Cursor/Copilot instruction
files were found. `CODEX_HOME` was unset, so the default home applied. No
`/etc/codex/{config,managed_config,requirements}.toml` existed. Six AGENTS files
inside installed Supabase dependency packages (849–996 bytes each) govern those
vendor paths only; they are not active instructions for editing Venfour source.

The documented precedence is global guidance, then repository root to working
directory; at each directory a nonempty override wins over AGENTS, then configured
fallback names. More specific project guidance wins within its scope, subject to
higher-priority runtime/user instructions. The default combined project-doc cap
is 32 KiB. Root-started tasks explicitly read only relevant nested instructions;
a shell `cd` is not assumed to reload the running conversation.

Source: [official instruction discovery documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
The observed injected global/root text matches the files. This audit does not
claim access to hidden service-side prompts or billing attribution.

## Changes and resulting hierarchy

- Replaced root `AGENTS.md` with repository map, universal boundaries, four risk
  levels, scoped-reading instructions, completion criteria, and fresh-task guidance.
- Added `frontend/AGENTS.md`, `venfour/AGENTS.md`, `supabase/AGENTS.md`,
  `scripts/AGENTS.md`, `frontend/worker/AGENTS.md`, and `frontend/preview/AGENTS.md`.
  They govern actual directories; no artificial payments/public-site directories
  were created. Payment rules are conditional in frontend/backend guidance.
- Added `repository-map.md` and `verification.md` in this directory. They are
  on-demand references, not mandatory full reads on every task.
- Added `.rgignore` for saved outputs/caches and older preview harnesses only.
  Git tracking, test discovery, builds, and application files are unchanged.
  Explicit `rg --no-ignore` searches retain access to excluded artifacts.
- Updated README with the navigation/policy links, scoped command explanation,
  a disposable-local-database warning, and guarded offline regression commands.
- Added this audit as an on-demand record. No files were removed; product intent
  remains summarized in root and explained in README. No global config edited.

## Measured before / after

| Measure | Before | After |
| --- | --- | --- |
| Root instructions | 289 lines / 10,776 bytes | 63 lines / 3,973 bytes (63.1% smaller) |
| Root + frontend-specific guidance | 10,776 bytes (no scoped guide) | 6,428 bytes (40.3% smaller) |
| Default `rg --files` | 1,480 files | 1,011 files (31.7% fewer, including new docs) |
| Output artifacts in default search | 467 files | 0 files |

The new exclusions remove 478 otherwise-visible artifact/harness files; added
visible guidance accounts for the net difference. Searchable file sizes include
binary screenshots, so byte reduction is not a token/credit savings estimate.
Global instructions remain an additional unchanged 598 bytes. Scoped preview,
worker, backend, database, and script guidance loads only for relevant work.

## Safeguards retained or made explicit

The root retains narrow scope, provider-neutral deterministic Python authority,
immutable evidence/history, conservative claims, and secret protection. Explicit
universal authorization boundaries cover deployment, hosted infrastructure/data,
Stripe configuration, real charges, and paid/limited provider quota. Destructive
production operations need justification and recovery safeguards.

Specialized guidance retains RLS/ownership/private storage, migration integrity,
strict payment identity/lineage/evidence/staff-review gates, recovery/idempotency,
provider budgets/fixtures, accessible UI, and public/app visual separation. It
warns that opening saved analysis can start real work. Local/synthetic evidence
cannot be described as hosted/payment/provider proof. None of these protections
requires unrelated remote probes for a local presentation change.

## Verification cost audit

- Frontend `test` is unfiltered `vitest run`; it accepts file/name selectors.
  Tests use jsdom and the existing setup; test configuration was not narrowed.
- `lint` is `eslint .`; preview/tooling can be included. Changed-file ESLint avoids
  unrelated work without hiding package-level failures.
- `typecheck` checks generated contracts then referenced app/node/worker projects.
  It is package-wide. `build` repeats contracts/types before Vite. Environment
  builds additionally validate their selected environment.
- Python uses unittest; no pyproject/pytest config or root package/Makefile was
  found. Existing `run_offline_tests.py` accepts exact module/class/test names,
  clears credentials, and rejects unmocked network/child processes.
- Database runner already supports SQL-file selection and enforces an isolated
  named container. Concurrency/rehearsal and optional PostgreSQL integration
  require separate setup. They are not ordinary button-change checks.
- Native Node tooling tests and the worker-specific package script provide
  smaller boundaries. Live benchmarks, listener/launcher, cleanup, migration,
  and provider scripts must be inspected before execution.
- No repository `.github` workflow directory was present. No CI policy was
  weakened, bypassed, or removed; externally managed checks were not inspected.

Level 1 stays local; Level 2 covers affected subsystem behavior; Level 3 expands
for cross-boundary/security/payment semantics; Level 4 adds boundary-specific
rehearsal and necessary authorized operational verification. These are impact
levels, not blanket rules triggered by a sensitive word in a file name.

## Checkout example

Before: 10.8 KB of general root context, no direct checkout locator, noisy global
searches, and full-package commands readily visible in README. Broader testing
or infrastructure investigation was possible but not mandated; no claim is made
that every prior task actually did it.

After: read root + frontend scope, open `checkout-experience.tsx` and its CSS,
follow the relevant direct dependency, make the isolated change, run the relevant
workflow test or local visual check and changed-file lint where useful, review
the diff and stop. A change to prices/readiness/ownership/submission/recovery
instead expands to the affected frontend/backend authority and integration tests.
No automatic Cloud Run, Supabase, Stripe, MarketCheck, or full-suite inspection.

## Remaining costs and thread guidance

Long conversations containing unrelated rollout audits and old snapshots are
likely to add material context/compaction work, but this audit did not measure
per-thread credits or attribute historical usage. Keep related iterations in one
task; start fresh when the objective moves to an unrelated subsystem or repeated
compaction forces rediscovery. Carry a short factual handoff, not the whole history.
Edits to instructions do not remove already-injected text from this conversation.

Large API/gateway/intake/commerce modules, the long README, and retained duplicate
preview harnesses are future refactoring/documentation work. Safely decomposing
those modules needs a separate behavior-preserving task. Runtime skill/plugin
catalogs and memory injection also consume context outside repository control;
no memory, plugin, or model configuration was changed to reduce safeguards.

## Validation and verdict

Validation passed: local Markdown links and canonical paths exist; all tracked
source, tests, schemas, migrations, and canonical workspace-preview source remain
visible; excluded artifacts are accessible through explicit bypass; every new
scoped instruction file is discoverable; whitespace and diff checks pass. The
only modified tracked files are AGENTS and README, and all new files are guidance
or ripgrep discovery settings. No executable/test/deployment configuration changed.
No product suite,
build, database reset, paid provider request, or deployment is needed for this diff.

There were meaningful, fixable efficiency problems, chiefly discovery pollution,
missing scope guidance, and oversized root context. The changes reduce those
inputs and should reduce unnecessary work while retaining stronger verification
for consequential changes. Exact credit savings remain unmeasured.
