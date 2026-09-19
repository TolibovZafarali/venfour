# Frontend scope

Use `src/app/router.tsx` for route ownership and the relevant row in
[repository-map.md](../docs/engineering/repository-map.md) for implementation paths.
For edge/deployment configuration (including `wrangler.jsonc`), also read
`worker/AGENTS.md`. Public and application pages share this package: `venfour.com` is public,
`app.venfour.com` is the customer application. `src/app/site-boundary.ts` and
`src/app/visual-system.ts` determine audience; local/staging can render both.

- Keep public styling separate from app styling. App surfaces use restrained
  white/black/grayscale; preserve functional blue selection/focus, keyboard,
  touch, and reduced-motion support. Scope app changes to app tokens/components
  and the affected feature CSS, including portaled content.
- Use existing React, Router, Query, and accessible component conventions.
  Display backend classifications and values; do not recalculate valuation,
  eligibility, ranking, discrepancy thresholds, or payment authority in the UI.
- Checkout copy/spacing changes are localized unless they change quoted prices,
  terms, readiness, ownership, payment submission, or recovery behavior. Preserve
  server quotes, strict eligibility, and saved checkout recovery. Exercise these
  boundaries with mocks when changed; do not open a live checkout to validate CSS.
- Opening a real saved analysis can submit work automatically. For visual work,
  use synthetic preview or controlled test fixtures; do not trigger real analysis
  or provider work accidentally.
- Tests are colocated. From the repository root, run
  `npm --prefix frontend test -- src/path/to/affected.test.tsx` using an existing
  test path. For lint, from `frontend/`, use
  `./node_modules/.bin/eslint src/path/to/changed.tsx`.
- `npm --prefix frontend run typecheck` covers the package and contract freshness;
  use for meaningful type/shared-contract changes, not automatically for CSS or
  copy. Builds and complete suites are for relevant cross-cutting changes.
- `src/lib/supabase/database.types.ts` and
  `src/features/analyses/analysis-presentation.generated.ts` are generated contracts;
  inspect them when relevant, but change their authoritative source and regenerate.
- Visual preview: `npm --prefix frontend run preview:workspace`; read
  `preview/AGENTS.md`. For actual local service integration, consult only the
  needed section of `docs/operations/local-full-flow.md` at repository root.
