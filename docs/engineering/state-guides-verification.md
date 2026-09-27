# Nationwide total-loss guide verification

All **51 jurisdictions** have a complete content module, individual metadata,
adjacent citations, and a fixed **September 26, 2026** source-review date. The
modules contain **206 source records**. Each record names the supported claims,
official destination, reviewed section or PDF page, applicability, and review date.

## Implementation

- One shared `StateGuide` preserves Missouri's section order, left alignment with
  Privacy and Terms, 42rem reading column, desktop sidebar, mobile contents,
  accessible checklist, expanded FAQs, sample message, and two calls to action.
- The route loader awaits only the requested content module. Failed imports use
  the existing route error screen. The lightweight metadata catalog contains no
  React or article imports and is shared by browser navigation and Worker output.
- All slugs, canonicals, sitemap entries, and homepage state links remain intact.
  Generated illustration bounds enclose every existing path, including disconnected
  shapes; the fixed frame uses a consistent stroke.
- Shared service copy retains the free preliminary valuation, one-time $199 paid
  review, automatic no-supported-dispute refund, and separate conditional refund
  for an eligible final verified increase under $1,000. Intake URLs and closed-intake
  contact alternatives remain unchanged. No valuation or commerce logic changed.

## Jurisdiction and source completion checklist

“Complete” means the module has been independently researched and integrated;
unsupported assertions are omitted, not characterized as an absence of law.
The linked review notes record material qualifications and research limits.

| Status | Content module | Route | Sources | Sources checked | Source review |
| --- | --- | --- | ---: | --- | --- |
| Complete | [Alabama](../../frontend/src/features/states/guides/alabama.ts) | `/states/alabama` | 4 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Alaska](../../frontend/src/features/states/guides/alaska.ts) | `/states/alaska` | 4 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Arizona](../../frontend/src/features/states/guides/arizona.ts) | `/states/arizona` | 3 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Arkansas](../../frontend/src/features/states/guides/arkansas.ts) | `/states/arkansas` | 4 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [California](../../frontend/src/features/states/guides/california.ts) | `/states/california` | 5 | 2026-09-26 | [Review](state-guides-pilot-review.md) |
| Complete | [Colorado](../../frontend/src/features/states/guides/colorado.ts) | `/states/colorado` | 4 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Connecticut](../../frontend/src/features/states/guides/connecticut.ts) | `/states/connecticut` | 3 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Delaware](../../frontend/src/features/states/guides/delaware.ts) | `/states/delaware` | 5 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [District of Columbia](../../frontend/src/features/states/guides/district-of-columbia.ts) | `/states/district-of-columbia` | 5 | 2026-09-26 | [Review](state-guides-pilot-review.md) |
| Complete | [Florida](../../frontend/src/features/states/guides/florida.ts) | `/states/florida` | 4 | 2026-09-26 | [Review](state-guides-batch-1-review.md) |
| Complete | [Georgia](../../frontend/src/features/states/guides/georgia.ts) | `/states/georgia` | 6 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Hawaii](../../frontend/src/features/states/guides/hawaii.ts) | `/states/hawaii` | 5 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Idaho](../../frontend/src/features/states/guides/idaho.ts) | `/states/idaho` | 4 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Illinois](../../frontend/src/features/states/guides/illinois.ts) | `/states/illinois` | 3 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Indiana](../../frontend/src/features/states/guides/indiana.ts) | `/states/indiana` | 5 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Iowa](../../frontend/src/features/states/guides/iowa.ts) | `/states/iowa` | 4 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Kansas](../../frontend/src/features/states/guides/kansas.ts) | `/states/kansas` | 6 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Kentucky](../../frontend/src/features/states/guides/kentucky.ts) | `/states/kentucky` | 5 | 2026-09-26 | [Review](state-guides-batch-2-review.md) |
| Complete | [Louisiana](../../frontend/src/features/states/guides/louisiana.ts) | `/states/louisiana` | 4 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Maine](../../frontend/src/features/states/guides/maine.ts) | `/states/maine` | 3 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Maryland](../../frontend/src/features/states/guides/maryland.ts) | `/states/maryland` | 2 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Massachusetts](../../frontend/src/features/states/guides/massachusetts.ts) | `/states/massachusetts` | 3 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Michigan](../../frontend/src/features/states/guides/michigan.ts) | `/states/michigan` | 4 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Minnesota](../../frontend/src/features/states/guides/minnesota.ts) | `/states/minnesota` | 3 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Mississippi](../../frontend/src/features/states/guides/mississippi.ts) | `/states/mississippi` | 2 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Missouri](../../frontend/src/features/states/guides/missouri.ts) | `/states/missouri` | 6 | 2026-09-26 | [Review](state-guides-missouri-review.md) |
| Complete | [Montana](../../frontend/src/features/states/guides/montana.ts) | `/states/montana` | 4 | 2026-09-26 | [Review](state-guides-batch-3-review.md) |
| Complete | [Nebraska](../../frontend/src/features/states/guides/nebraska.ts) | `/states/nebraska` | 4 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [Nevada](../../frontend/src/features/states/guides/nevada.ts) | `/states/nevada` | 4 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [New Hampshire](../../frontend/src/features/states/guides/new-hampshire.ts) | `/states/new-hampshire` | 3 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [New Jersey](../../frontend/src/features/states/guides/new-jersey.ts) | `/states/new-jersey` | 3 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [New Mexico](../../frontend/src/features/states/guides/new-mexico.ts) | `/states/new-mexico` | 5 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [New York](../../frontend/src/features/states/guides/new-york.ts) | `/states/new-york` | 5 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [North Carolina](../../frontend/src/features/states/guides/north-carolina.ts) | `/states/north-carolina` | 4 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [North Dakota](../../frontend/src/features/states/guides/north-dakota.ts) | `/states/north-dakota` | 3 | 2026-09-26 | [Review](state-guides-batch-4-review.md) |
| Complete | [Ohio](../../frontend/src/features/states/guides/ohio.ts) | `/states/ohio` | 3 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Oklahoma](../../frontend/src/features/states/guides/oklahoma.ts) | `/states/oklahoma` | 5 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Oregon](../../frontend/src/features/states/guides/oregon.ts) | `/states/oregon` | 3 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Pennsylvania](../../frontend/src/features/states/guides/pennsylvania.ts) | `/states/pennsylvania` | 3 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Rhode Island](../../frontend/src/features/states/guides/rhode-island.ts) | `/states/rhode-island` | 4 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [South Carolina](../../frontend/src/features/states/guides/south-carolina.ts) | `/states/south-carolina` | 3 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [South Dakota](../../frontend/src/features/states/guides/south-dakota.ts) | `/states/south-dakota` | 6 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Tennessee](../../frontend/src/features/states/guides/tennessee.ts) | `/states/tennessee` | 4 | 2026-09-26 | [Review](state-guides-batch-5-review.md) |
| Complete | [Texas](../../frontend/src/features/states/guides/texas.ts) | `/states/texas` | 6 | 2026-09-26 | [Review](state-guides-pilot-review.md) |
| Complete | [Utah](../../frontend/src/features/states/guides/utah.ts) | `/states/utah` | 4 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [Vermont](../../frontend/src/features/states/guides/vermont.ts) | `/states/vermont` | 4 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [Virginia](../../frontend/src/features/states/guides/virginia.ts) | `/states/virginia` | 5 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [Washington](../../frontend/src/features/states/guides/washington.ts) | `/states/washington` | 4 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [West Virginia](../../frontend/src/features/states/guides/west-virginia.ts) | `/states/west-virginia` | 4 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [Wisconsin](../../frontend/src/features/states/guides/wisconsin.ts) | `/states/wisconsin` | 4 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |
| Complete | [Wyoming](../../frontend/src/features/states/guides/wyoming.ts) | `/states/wyoming` | 3 | 2026-09-26 | [Review](state-guides-batch-6-review.md) |

## Source verification

The research pass read primary insurance-department, legislative, regulatory,
revenue, and vehicle-title material and checked the sections supporting the
published assertions. Repository research was used only for discovery. PDF page
locators and HTML fragments were inspected where cited. The Missouri tax citation
uses the verified `#q13` target; the unavailable sample appraisal-policy PDF is
absent.

A separate URL audit covered all 206 published destinations: **194 returned HTTP
200**, while **12 returned HTTP 403 to that automated client**. Those 12 are in
Arizona, Alaska, Colorado, Louisiana, and Massachusetts; their substantive content
was independently retrieved through the browser or web retrieval and is discussed
in the relevant review notes. There were no unresolved HTML-fragment mismatches.
HTTP status alone was not accepted as source verification. Other unsuccessful
research leads are documented and are not cited as support in the public guides.

The final content review also checked every module for uncited declarative legal
rules, accidental jurisdiction leakage, and missing applicability or deadline
qualifications. It tightened Hawaii's owner-retention notice to specify the
settlement-date trigger and written notice, with a regression assertion.

Washington's official WAC pages already publish adopted changes effective
**October 18, 2026**. Its guide cites the version in force on the review date;
review that content again at the effective-date change. No future rule was
presented as current law.

## Local verification

| Check | Result |
| --- | --- |
| State-page tests | 113 passed: all jurisdictions, both intake states, source links, shared commercial terms, fixed dates, unique targets, import failure, invalid slugs, and metadata cleanup. |
| Content contract and qualification tests | 57 passed: all modules, citation records, catalog agreement, and consequential state-specific qualifications. |
| State catalog and geometry tests | 59 passed: 51 routes and complete padded outlines, including unsupported-path handling. |
| Worker state-route tests | 111 passed: direct-response title, description, canonical and social metadata, route availability, host redirects, and sitemap coverage. |
| Frontend build | Passed contract freshness, TypeScript, and Vite. All 51 articles emitted as separate chunks. |
| Changed-file ESLint | Passed on 66 changed TypeScript, TSX, and JavaScript module files. |
| States browser suite | 165 passed in 3.6 minutes; 130 intentional project skips avoid repeating the 42 secondary guides outside their required phone/desktop coverage. All 51 were checked at both required widths. |
| Whitespace and final scope review | `git diff --check` passed. Changes are confined to public state guides, their loader/catalog/geometry, tests, and source-review documentation. |

Reproduce the automated checks from the repository root:

```sh
npm --prefix frontend test -- src/pages/state-page.test.tsx src/features/states/states.test.ts src/features/states/guide-content.test.ts worker/state-pages.test.ts
npm --prefix frontend run test:states-browser
npm --prefix frontend run build
git diff --check
```

The unit suite totals **340 passing tests**. Its JSDOM environment reports the
existing unimplemented `window.scrollTo` method during navigation checks; browser
checks exercise real scrolling and focus. Vite emits a non-failing large-chunk
warning for the main application bundle (about 2.33 MB minified); the individual
guide chunks are approximately 3.6–7.1 kB before gzip.

The browser matrix checks every guide at 320px and 1440px. Missouri, California,
Texas, D.C., Alaska, Hawaii, Michigan, Rhode Island, and Massachusetts additionally
run at 390px, 768px, and desktop reduced motion. Coverage includes legal-page left
alignment, readable tables, no horizontal overflow, complete outlines, keyboard
navigation, cold section links, state transitions, both CTA placements, and the
existing intake destination. A request audit checks that the homepage downloads
no guide articles and state navigation downloads only visited guides.

## Preview and scope

Local preview: [Missouri](http://127.0.0.1:4186/states/missouri),
[California](http://127.0.0.1:4186/states/california), and
[all states](http://127.0.0.1:4186/#states).

The preview uses the existing fictional workspace fixture for service interactions;
its small fixed preview badge is not part of the public guide layout. Screenshots are written under `output/playwright/states/` by the existing browser
suite. Visual review covered desktop Alaska, Hawaii, D.C., and Michigan, plus
320px Massachusetts, D.C., and the Missouri comparison table. Long names wrap
without horizontal overflow; Alaska/Hawaii islands and Michigan’s disconnected
shape remain complete. The layout retains its legal-page left alignment and
consistent contents navigation.

This delivery is local. There was no deployment, hosted mutation, live valuation-provider execution,
new dependency, public API, database change, jurisdiction activation, payment,
checkout change, or refund-policy change. No commit or push was made.
