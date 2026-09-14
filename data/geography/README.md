# Comparable-search geography

These compressed files contain only geographic identifiers, labels, and internal
point coordinates from the U.S. Census Bureau 2025 National Gazetteer. The source
URLs, original archive checksums, transformed-file checksums, and record counts
are recorded in `sources.json`. No provider requests are needed at runtime.

ZCTA internal points approximate customer and dealer postal areas; they are not
street addresses or exact USPS delivery boundaries. Missing or ambiguous postal
locations remain unresolved. CBSA internal points supply deterministic nearby
market candidates, not claims about inventory availability or complete coverage.
The current selector maximizes incremental disk area after subtracting the union
of previously searched circles. A candidate must add at least 55% of its own
circle and 40% of a full provider-radius circle. The bundled Metro/Micro label
supplies only a coarse market-type proxy: Metro areas receive a 1.20 area weight.
These weights and cutoffs are application policy, not measured population,
dealer counts, or inventory forecasts. Distance breaks otherwise equal scores;
asking prices, the insurer's offer, and unverified density fields are ignored.

Request disks remain entirely within the customer-relative outer boundary,
using unrounded great-circle distance to shrink the radius when needed. New
area uses deterministic local planar integration; it estimates territory, not
inventory availability or literal complete boundary coverage. Historical replay
can explicitly select the unchanged `legacy-v1` proximity-band rule; new search
uses `coverage-v2`.

Run `python scripts/audit_search_geography.py <ZIP>` from the repository root to
compare old/new centers and estimated pairwise/incremental overlap without any
provider requests.

Sources: [2025 Gazetteer directory](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/)
and [Census Gazetteer documentation](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html).
