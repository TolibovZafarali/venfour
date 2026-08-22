# Staging Worker boundary

The staging frontend is a Cloudflare Worker with Static Assets at the exact
custom hostname `staging.venfour.com`. It serves the Vite SPA and proxies only
`/api/*` and `/health` to the current staging Cloud Run API. API responses are
never cached. Static HTML is not stored, fingerprinted Vite assets are cached
immutably, and every response carries staging security and `noindex` headers.

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
