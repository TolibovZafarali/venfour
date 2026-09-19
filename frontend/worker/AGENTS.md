# Edge proxy scope

Inspect `index.ts`, its tests, and the relevant deployment configuration. Preserve
host routing, proxy authentication, secret isolation, and public/application
boundaries. Worker changes need affected worker/environment tests; ordinary
page styling does not.

From repository root: `npm --prefix frontend run test:worker`.
Build or dry-run only when packaging/configuration changed. A dry-run is not
hosted proof. Deployments and hosted configuration changes require explicit task
authorization; code changes alone do not authorize them. Never print secrets.
