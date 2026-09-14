# Staging Worker boundary

## Production boundary

The separate `production` environment deploys `venfour-frontend-production`.
It uses the same build for `venfour.com`, `www.venfour.com`, and
`app.venfour.com`. The apex serves the public pages; application paths redirect
to the app host with their query intact. `www` redirects to the apex. Existing
`/auth/callback` requests complete on the issuing host before any application
transition. Public HTML is indexable; app pages, callbacks, API responses, and
redirects remain private and are not indexed.

Production requires the public build inputs in `.env.production.example`.
`VENFOUR_PRODUCTION_SUPABASE_ORIGIN` pins the explicitly reviewed project during
build validation. The Worker has a separate `API_PROXY_SECRET`; its value must
match the production backend's proxy secret. The production API origin must
refer to the verified production backend, and that backend must permit the
Worker's proxy request under its deployed ingress and IAM policy.

The production webhook is only `POST https://app.venfour.com/webhooks/stripe`.
Other webhook paths and internal execution paths are never proxied. Regular
API requests keep bearer authentication and the same-origin proxy; a supplied
Origin must equal the receiving origin, and cross-site Fetch Metadata is
rejected. Production deployment does not change the staging environment.

Use `npm run build:production` and `npm run worker:production-dry-run` after
providing reviewed public configuration. Deployment and traffic activation are
separate operations. Logs and traces remain disabled to protect callback URLs.

## Staging configuration

The staging frontend is a Cloudflare Worker with Static Assets at the exact
custom hostname `staging.venfour.com`. It serves the Vite SPA and proxies only
`/api/*`, `/health`, and the exact `POST /webhooks/stripe` route to the current
staging Cloud Run API. Proxied responses are never cached. The Stripe route
streams the request body without parsing or re-encoding it, preserves the
`Stripe-Signature` header, and receives the same Worker-to-Cloud Run proxy
credential as other upstream requests. Static HTML is not stored, fingerprinted
Vite assets are cached immutably, and every response carries staging security
and `noindex` headers.

Persisted Worker invocation logs and traces stay disabled because authentication
callbacks can carry one-time codes or token hashes in the request URL.

Cloudflare Access is the tester-access perimeter. Before exposing the hostname,
create a Zero Trust self-hosted Access application whose application domain is
exactly `staging.venfour.com`, covers all paths, and has an Allow policy limited
to the intended tester identities. Keep the application fail-closed: do not add
a public bypass policy. The Worker deliberately does not implement a second
password or authorization scheme, and it does not trust Access headers as
application identity. Incoming Access headers are forwarded to Cloud Run like
other request headers; Supabase Bearer authorization remains authoritative for
customer API routes.

The Worker and Cloud Run service additionally share one server-only proxy
credential. Store it as the Worker secret `API_PROXY_SECRET` and mount the same
value into Cloud Run as `VENFOUR_STAGING_PROXY_SECRET`. The Worker deletes any
browser-supplied copy of that header and injects the secret only on the upstream
request. Cloud Run rejects direct `/api/*` calls that did not traverse the
Worker. Do not put this value in a `VITE_*` variable or a tracked file.

The staging Vite build requires the public values documented in
`.env.staging.example`. Copy it to the ignored `.env.staging.local` for local
validation, or provide the same variables through the build environment. These
values are embedded in browser assets and must never contain a Supabase
service-role key or an OpenAI, MarketCheck, Cloudflare, or Google Cloud secret.

The tracked Worker route does not change the existing Cloudflare Access policy.
Before Stripe can deliver webhooks, a later deployment must configure the
narrowest possible Access exception for only the `/webhooks/stripe` path; the
Worker itself forwards only `POST` on that exact path and returns `405` for
other methods instead of serving SPA content. Do not create a broad `/api` or
hostname-wide bypass.

Useful local checks:

```sh
npm run test:worker
npm run build:staging
npm run worker:dry-run
```

Before the first deployment, configure the Worker side with:

```sh
npx wrangler secret put API_PROXY_SECRET --env staging
```

`npm run deploy:staging` runs the same validated staging build through
Wrangler. It should only be used after the Cloudflare Access application and
DNS/custom-domain ownership are confirmed. Cloudflare account authorization and
the secret value remain outside repository files.
