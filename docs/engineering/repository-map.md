# Repository map

Use the row matching the request, then inspect direct imports and nearby tests.
Paths below are relative to repository root. Do not read every row's implementation.

| Request | Canonical entry points |
| --- | --- |
| Checkout copy/layout | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx` and adjacent CSS; embedded billing/payment fields in `embedded-payment.tsx` |
| Checkout routing/recovery | `frontend/src/pages/total-loss-claim-workflow-page.tsx`; matching `.test.tsx`; `frontend/src/features/total-loss-claim/queries.ts`, `workflow-route.ts` |
| Customer workspace shell | `frontend/src/components/customer-workspace.tsx`, adjacent CSS/test; `frontend/src/components/app-shell.tsx` |
| Saved case navigation/state | `frontend/src/features/total-loss-claim/components/case-workspace-navigation.tsx`; `frontend/src/features/total-loss-claim/case-workspace.ts` |
| Free estimate intake | `frontend/src/pages/total-loss-start-page.tsx`; `frontend/src/features/total-loss/` |
| Free estimate processing/results | `frontend/src/pages/total-loss-analysis-page.tsx`; `frontend/src/features/analyses/components/total-loss-analysis-experience.tsx`, `free-valuation-processing.tsx` |
| Completed customer review | `frontend/src/features/total-loss-claim/components/completed-analysis.tsx`; workflow page above |
| Partner dashboard | `frontend/src/features/referral-partners/pages.tsx`, `service.ts`, `urls.ts`; public acquisition page is `frontend/src/pages/referral-partners-page.tsx` |
| Homepage | `frontend/src/pages/home-page.tsx`, adjacent CSS/test |
| Routes / public-app split | `frontend/src/app/router.tsx`, `site-boundary.ts`, `visual-system.ts`; `frontend/src/styles/` for app/public tokens and components |
| Backend endpoint | Route table and handlers in `venfour/api.py`; follow imported service; tests in `tests/test_*api*.py` and service-specific modules |
| Payment authority | `venfour/commerce.py`, `package_assessment.py`, `report_release_gate.py`, `staff_release.py`; matching `tests/test_*.py` |
| Persistence | `venfour/supabase_gateway.py`; `supabase/migrations/`, `supabase/tests/database/`; generated frontend types in `frontend/src/lib/supabase/database.types.ts` |
| Market discovery / evidence | `venfour/efficient_search.py`, `market_request_budget.py`, `marketcheck.py`, `historical_market.py`, `comparables.py`, `discrepancy.py` |
| Presentation contract | `venfour/presentation.py`, `schemas/analysis/analysis-presentation.schema.json`; `frontend/scripts/analysis-contract.mjs` generates/checks frontend types |
| Synthetic screen selector | `frontend/preview/workspace/catalog.ts`, `launcher.tsx`, `main.tsx`; read `frontend/preview/AGENTS.md` |
| Edge / deployment | `frontend/worker/index.ts`, `frontend/wrangler.jsonc`, `Dockerfile`; operational procedures in `docs/operations/` only as needed |

## Environments and evidence

- `venfour.com`: public marketing; `app.venfour.com`: customer product. Partner
  host behavior is defined in `frontend/src/features/referral-partners/urls.ts`.
  Public and app code share the frontend package; scope styling by audience.
- Local/staging builds can serve multiple audiences; hostname, route, and build
  configuration matter. A public-site build is not a separate source tree.
- Default `preview:workspace` is fictional/browser-local with external requests
  blocked. Its optional Stripe sandbox mode is an explicit integration mode.
- Actual local service flow is launched by `scripts/dev-local.mjs`; it has more
  dependencies and possible side effects than the synthetic selector. Read
  `docs/operations/local-full-flow.md` only when that integration is needed.
- Staging and production are hosted targets, not synonyms for local preview.
  Verify their state only for tasks that require it; dated reports are historical.

## Search and documentation

`.rgignore` removes saved `output/` artifacts, browser/worker caches, `.tmp-*`
previews and the older showcase from routine ripgrep results. No files were
removed. Search an excluded directory deliberately with
`rg --no-ignore -n 'pattern' output/named-area`; add `--hidden` only if needed.
Avoid unrestricted searches across dependencies or secret environment files.
Source, tests, schemas, migrations, and generated type contracts stay visible.

The README retains product context and detailed setup/history. Read its relevant
heading, not all of it. `docs/operations/` contains dated rollout evidence and
runbooks, not standing instructions to inspect production on every task.
