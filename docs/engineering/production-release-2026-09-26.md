# Production release — September 26, 2026

The current public site and customer/partner application are deployed at 100%
traffic. Runtime source is `64e8aa5b3eefe7d4dea34bc148d7a6aa0b73649d` on `main`.
Deployment completed September 27 at 01:38 UTC (September 26 in Chicago).

| Component | Previous version | Released version |
| --- | --- | --- |
| Public site | `e729a36f-814d-4003-bbbb-133ab77a28d2` | `a27cb0a7-c90f-42e2-84dd-ee87890f624d` |
| Customer and partner application | `0f232f0d-d3ef-41e5-b27f-591639e77c57` | `b2fd53d6-9d92-4dbe-aa74-a6ca7eb63ece` |

Both versions carry tag `release-0926-64e8aa5` and the complete source commit in
their deployment messages. Cloudflare deployment status confirmed 100% traffic
to each version after publication.

## Scope

The release includes the revised service entry and intake layout, vehicle and
insurer controls, contact submission behavior, homepage state map, 51 state pages,
footer navigation, sitemap entries, and server-rendered state metadata. The
existing generic nationwide flow continues without the removed location
questionnaire. The $199 one-time full-review offer and existing measurement
configuration are preserved.

All 97 paths changed since the previous deployed source `de7f929` were inventoried:
30 production frontend paths, one edge-routing path, one public static asset,
two build/dependency paths, and 63 documentation, test, tooling, or retained
artifact paths. Sample-review PDFs, source bundles, campaign records, and browser
artifacts remain repository artifacts; this release adds no public PDF download.

There is no backend runtime source difference from the previously released
backend baseline, and no migration source difference from `de7f929`. No backend
deployment or database migration was necessary or executed. No provider, payment,
refund, email, or jurisdiction-enforcement configuration was changed.

The only release-preparation edit updates the preview contact test to assert that
the retired questionnaire is absent. The initial selected run passed 723 tests
and failed that stale expectation; all 42 tests in the repaired preview file then
passed. No runtime behavior was changed to satisfy the test.

## Verification

| Check | Result |
| --- | --- |
| Selected frontend, Worker, environment, and preview coverage | 724 tests passing after the preview correction |
| Offline backend compatibility | 24 passed; zero unexpected network attempts |
| Existing state-page browser suite | 25 passed across five viewport/motion profiles |
| Changed-source lint | Passed for 45 files; repaired preview file checked again |
| Production and public builds | Passed environment validation, generated-contract checks, TypeScript, and Vite |
| Worker packaging rehearsal | Both deployment dry runs passed |
| Live HTTP and protection checks | 96 passed, including all 51 state pages and sitemap entries |
| Served asset comparison | 26 byte-for-byte matches across public, customer, and partner hosts |
| Live browser checks | State CTA reaches the current app entry; desktop/mobile render; mobile has no horizontal overflow |
| Asset credential-pattern scan and final whitespace check | Passed |

Live checks confirm backend `/health` and `/ready`, unauthenticated API refusal,
direct-backend API protection, partner endpoint isolation, webhook method
restriction, and the existing Access perimeter for internal/staff routes. The
public host deliberately returns 404 for `/start`; public CTAs target the app
host directly. Protected internal routes reach Access before Worker routing.

Google Cloud credentials require reauthentication, so the Cloud Run control-plane
revision and image identity could not be refreshed. Backend health/readiness were
verified through live HTTP; no fresh control-plane identity claim is made. No
real purchase, paid analysis, or customer email was used for verification.

## Recovery and retained evidence

Rollback targets are the previous Worker versions listed above. Either rollback
can restore its corresponding host group without changing backend or database
history. No destructive recovery step is needed for this release.

The immutable release snapshot, full path classification, build/deployment logs,
test results, smoke assertions, asset hashes, and browser evidence are retained
locally at `/Users/zafaralitolibov/.venfour-releases/2026-09-26/`. The frozen source
was compared byte for byte with all tracked files before deployment. Both prior
production builds were also checked against their live assets before replacement
(20 matches).
