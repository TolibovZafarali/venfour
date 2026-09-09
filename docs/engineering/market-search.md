# Bounded comparable research

The default case analysis composition uses `EfficientMarketSearch` and saves
analysis-run version 11. Earlier runs replay their original versioned rules.
The deterministic discrepancy calculation and scoring version 2 are unchanged.
This implementation was validated with offline provider fixtures, not live
inventory, hosted migrations, or verified commercial account entitlements.

## Sequence and evidence

1. Search past inventory first, where its documented 90-day coverage permits.
   Start with one nearest-first request around the customer postal area, at
   the smaller of the configured local radius, case boundary, and endpoint cap.
   Default radius is 100 miles and page size is 50. Active and past discovery
   retain year, make, model, used dealer inventory, trim, configuration and
   drivetrain filters supported by the adapter. There is no price floor.
2. Inspect the entire returned page. Retain normalized observations and their
   query, stream, date, source and location provenance. Recompute distance from
   the original customer postal area. Screen configuration and match quality,
   deduplicate identities and rank without using asking price or the offer.
3. Verify historical candidates in batches of three, checking the nine-STRONG
   target between batches. VIN history has at most three pages and three total
   physical attempts per VIN, including retries. Pagination that remains
   incomplete is unresolved. Conflicting dated prices are never resolved by
   choosing the larger value. Discovery mileage, location and price do not
   substitute for the historical record active on the loss date.
4. While evidence remains insufficient, consider another page of a productive
   branch, then a deterministic nearby market center. Default two pages per
   center; duplicate share of 80%, no promising matches or no further inventory
   ends that branch. At most four additional centers are shared across both
   streams. There is no promise of complete geographic coverage. Each search
   circle fits inside the customer boundary and its endpoint radius limit.
5. Sufficient historical evidence permits one active-inventory page for current
   context; it prevents full current-market expansion. Otherwise active evidence
   gets its own bounded search using the same geographic and request allowance.
   Stop for nine strict STRONG matches, exhausted productive branches, geographic
   or observation limits, provider failure, or an exhausted budget. Verified
   results survive a later failure.
6. Freeze baseline inclusion before the optional supporting pass. Reuse verified
   evidence, then cheap-screened pending candidates. A productive known branch
   with remaining inventory may receive a price-descending query. Both active
   and past inventory document that sort. No new center is purchased solely to
   pursue a high price. Supporting discovery is explicitly tagged and never
   enters baseline statistics or eligibility counts.

The broader baseline can contain eligible lower-priced listings. Its canonical
pool is capped at 100 per stream by quality, and the unchanged discrepancy
methodology selects its bounded comparison set. Unknown trim, material body or
powertrain facts, unsuitable mileage, unknown location, or unverified date
context cannot become STRONG evidence. Missing data and known mismatches have
separate reasons. Matching currently uses conservative normalized exact text;
provider/report terminology differences can therefore reduce usable evidence.
Redundant size-category or consistent door/cylinder metadata can remain
uncorroborated under narrow rules, with disclosure; it is not listed as a
verified matching fact. Conflicting values, uncertain door variants, and
unresolved pickup cab/bed configuration remain excluded.
Manual intake or an incomplete report without material facts can remain limited.

Supporting listings additionally require an absolute mileage gap no greater
than 5,000 miles and 10% of the subject mileage, symmetrically for lower or
higher mileage. These engineering bounds use the existing best mileage-score
band and constrain only the shortlist; baseline scoring remains unchanged.
Candidates outside that window are screened out before optional history work.
Every nonzero mileage gap is displayed with a no-dollar-adjustment limitation.
Supporting listings are ranked by genuine comparability first. Price preference
is confined to the same exact score, absolute mileage difference and customer
distance; historical context then takes precedence over current context before
price, and identity breaks remaining ties. A VIN appears at most once. Candidates must exceed the median of
at least five comparable records in the same date/stream context. A symmetric
outlier fence uses the larger of 25% of the reference median and six median
absolute deviations; outliers and conflicts trigger exclusion/reassessment,
never an upward-only baseline correction. Known equipment differences or
certification/warranty premiums that cannot be matched block the listing.
Undisclosed optional accessories or benefits remain unknown with explicit
limitations; absence of disclosure is not proof of absence.

The default shortlist has three entries, configurable to one through nine.
Each includes matching facts, dated advertised price, source, customer distance,
material differences, limitations and provenance. The customer view and PDF use
**Higher-priced comparable listings**, with a disclosure separating examples
from typical prices, completed sales and guaranteed recovery. The published
report carries this section separately. The insurer-response drafting input
uses an existing allowlist and does not implicitly add these examples to a
request or change the requested amount. The report attachment preserves the
separate section. Examples do not change the headline increase, confidence,
qualification or purchase recommendation. A limited search cannot establish an
adequately supported negative review merely because no increase was found.

## Request controls

Every physical GET reserves an attempt atomically before transport, including
pagination, retries, failed requests and enrichment. Case usage is durable and
cumulative across retries, revisions and workers. The original account and
policy are pinned to that case; a new run ID cannot reset them. Existing job
claims prevent concurrent case work, and checkpoint writes require the current
processing token. Each provider reservation also checks the current job token,
lease expiry and input lineage, even with checkpoint retention disabled.
Account row locks coordinate the monthly and rate windows
across workers.

| Setting | Environment variable | Default |
| --- | --- | ---: |
| Case lifetime attempt ceiling | `MARKETCHECK_BUDGET_TOTAL_ATTEMPTS` | 60 |
| Supporting attempts, inside ceiling | `MARKETCHECK_BUDGET_SUPPORTING_ATTEMPTS` | 5 |
| Supporting discovery subset | `MARKETCHECK_BUDGET_SUPPORTING_DISCOVERY_ATTEMPTS` | 2 |
| Active discovery attempts | `MARKETCHECK_BUDGET_ACTIVE_DISCOVERY_ATTEMPTS` | 8 |
| Past discovery attempts | `MARKETCHECK_BUDGET_HISTORICAL_DISCOVERY_ATTEMPTS` | 8 |
| VIN history attempts | `MARKETCHECK_BUDGET_HISTORY_ATTEMPTS` | 40 |
| Enrichment attempts | `MARKETCHECK_BUDGET_ENRICHMENT_ATTEMPTS` | 9 |
| Taxonomy attempts when used in case research | `MARKETCHECK_BUDGET_VEHICLE_TERMS_ATTEMPTS` | 2 |
| Total history attempts per VIN | `MARKETCHECK_BUDGET_PER_VIN_HISTORY_ATTEMPTS` | 3 |
| Routine monthly reserve | `MARKETCHECK_MONTHLY_RESERVE_FRACTION` | 0.20 |
| Optimization target, not a spending floor | `MARKETCHECK_OPTIMIZATION_TARGET_MIN` / `MAX` | 20 / 30 |

The strongest applicable constraint always wins; sub-budgets are not additional
allowances. Supporting execution also has strategy ceilings of five attempts
and two discovery attempts. The 20–30 target records the optimization goal; it
never causes unnecessary calls or an otherwise premature stop. The monthly
reserve conservatively protects all routine reservations, including resumed
work. Configured monthly usage and the shared ledger enforce that limit. The
adapter treats 429 responses as temporary throttling; provider-specific
monthly-exhaustion payload classification is not wired or confirmed. The ledger
supports an explicit exhaustion flag, but the adapter does not currently set it.
Short Retry-After or configured rate-window
delays are respected; delays over 60 seconds stop the operation with a recorded
limitation for a subsequent permitted resume.

## Required account and retention configuration

Apply the new request-ledger, checkpoint, and published-delivery migrations
before enabling the runtime. No migration was applied to production by this
change. A stable, non-secret `MARKETCHECK_ACCOUNT_IDENTIFIER` must identify the
same subscription in every instance, including after API-key rotation. Actual
account limits must be confirmed and configured:

- `MARKETCHECK_RATE_LIMIT_REQUESTS` and `MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS`.
- `MARKETCHECK_MONTHLY_REQUEST_ALLOWANCE`, `MARKETCHECK_QUOTA_PERIOD_START`,
  `MARKETCHECK_QUOTA_PERIOD_END`, and `MARKETCHECK_MONTHLY_USAGE_BEFORE_TRACKING`.
  Period timestamps are timezone-aware; use the provider's actual billing period.
  Reconcile untracked prior usage upward, including usage by other applications.
- `MARKETCHECK_ACCOUNT_METERED` describes billing only; it never bypasses the
  required monthly request ceiling, billing period, prior usage, or rate limits.
- `MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES` must reflect confirmed access. Discovery
  still caps local requests at 100 miles and past inventory at 100 miles. Missing
  radius permission fails closed; 100 miles is not an assumed entitlement.

A billable allowance, monetary credits, rate limit and request quota are
separate concepts. The ledger currently models one shared physical-attempt
monthly bucket and one shared rate window. Do not mislabel endpoint-specific
allowances, dollar credits, free calls, or response-based pricing as that bucket.
Accounts with separate endpoint quotas require explicit corresponding accounting
before those entitlements can safely be enabled. External callers sharing the
subscription must participate in this accounting or their usage must be
reconciled; this application cannot observe their requests automatically.

The built-in HTTP transport refuses unbudgeted requests, including when it is
explicitly injected. The old `search_marketcheck.py` and
`search_marketcheck_historical.py` diagnostics therefore cannot initiate live
searches; use the owned case workflow. Explicit offline recording transports
remain available to fixtures, and out-of-coverage results require no HTTP.

`MARKETCHECK_CONFIRMED_TARIFF_USD_PER_ATTEMPT` is an optional JSON mapping of
`active_inventory`, `historical_inventory`, `vin_history`, and `vehicle_terms`
to exact decimal dollar strings. Supply a value only where the confirmed tariff
charges every physical attempt. Unpriced attempts remain explicitly unpriced;
tracked estimates are not invoices. No tariff or monthly entitlement was
confirmed by these fixtures, and no dollar-spending cap is inferred.

Same-case normalized checkpoints are disabled until
`MARKETCHECK_CASE_EVIDENCE_RETENTION_DAYS` is explicitly configured from confirmed
retention permission (1–30 days). They contain bounded canonical observations,
not raw provider bodies. Expiry never extends on a save; lowering the configured
period shortens reuse eligibility. Expired work is not reused. Active job fencing
and exact input digests prevent cross-case or different-input reuse. Successful
operations replay without provider calls; a failed operation can retry within
its existing cumulative case allowance, retaining completed VIN verification.
An observed-date change, including an overnight retry, starts a fresh input
digest to avoid labeling newly fetched active inventory with an old date.
Historical work is not reused across that boundary in this version.
With retention disabled, a failed process may redo discovery on a later run,
but cannot reset its request allowance. Completed analyses, paid reports and
insurer-response reviews continue to reuse the frozen analysis package.
No unrestricted cross-customer provider-response cache was added.

## Geographic and depth configuration

`MARKETCHECK_SEARCH_LOCAL_RADIUS_MILES=100`,
`MARKETCHECK_SEARCH_OUTER_BOUNDARY_MILES=250`,
`MARKETCHECK_SEARCH_ADDITIONAL_CENTERS=4`,
`MARKETCHECK_SEARCH_PAGE_SIZE=50`,
`MARKETCHECK_SEARCH_PAGES_PER_CENTER=2`,
`MARKETCHECK_SEARCH_VERIFICATION_BATCH_SIZE=3`,
`MARKETCHECK_SEARCH_MAX_OBSERVATIONS=500`,
`MARKETCHECK_SUPPORTING_MAXIMUM_LISTINGS=3`, and
`MARKETCHECK_SEARCH_CURRENT_CONTEXT_PAGES=1` are the defaults.
A server-owned `case_maximum_distance_miles` argument can further restrict the
outer boundary; no jurisdictional requirement is inferred automatically.
The nine-STRONG target remains fixed in strategy version 1.

Bundled Census 2025 postal-area internal points and nearby metro/micro areas
provide deterministic coordinates and center candidates without geocoding
requests. They are geographic approximations, not precise customer addresses
or a guarantee that a metro contains suitable inventory. Missing/ambiguous
coordinates are conservative exclusions. Inputs, the nearby-market snapshot,
observations, decisions and request usage are frozen in the transcript; replay
uses that snapshot and makes no provider or geocoding request. See
`data/geography/sources.json` for provenance and checksums.

## Offline evidence

`tests/test_efficient_search.py` compares the old and new loops using the same
fictional transport. The dense fixture falls from 53 to 16 physical attempts:
9 historical baseline listings, 50 active context listings, and 3 separate
supporting examples. The existing valuation still uses its bounded best-ranked
comparison set. Additional fixtures cover sparse markets, shared centers,
duplicate branches, pagination, partial failures, resume, price invariance,
original-customer distance, and an exhausted attempt allowance.
`tests/test_efficient_analysis.py` proves saved-run replay, offer invariance and
a broad no-material-discrepancy finding despite expensive supporting examples.
The same-fixture request comparisons are:

| Fixture | Previous attempts | New attempts | New usable baseline |
| --- | ---: | ---: | --- |
| Dense, 50 candidates per stream | 53 | 16 | 9 historical + 50 current context; 3 supporting examples |
| Duplicate-heavy, 50 rows / 5 VINs | 10 | 7 | 5 historical + 5 current; limited, no optional pass |
| Empty, four nearby centers available | 4 | 10 | None; limited after deliberate broader reach |
| Historical, 20 candidates, ceiling set to 5 | 21 | 5 | 4 historical retained; budget exhausted |

Counts include all mocked physical attempts. The sparse increase buys bounded
additional locations; it is not a claim that every case becomes cheaper.
Request-ledger tests include real local PostgreSQL races, not only Python mocks.
These are engineering fixtures, not conversion or live-inventory performance
measurements. Keep the initial limits until real permitted usage provides a
reason to revise them; do not increase the target merely to consume 20 calls.

Provider documentation checked for this implementation:
[active inventory](https://docs.marketcheck.com/docs/api/cars/inventory/inventory-search),
[past inventory](https://docs.marketcheck.com/docs/api/cars/inventory/past-inventory-search),
[VIN history](https://docs.marketcheck.com/docs/api/cars/vehicle-history/history-by-vin).
API capabilities do not establish the subscription's quotas, pricing, or
retention permission.
