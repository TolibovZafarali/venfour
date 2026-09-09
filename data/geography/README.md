# Comparable-search geography

These compressed files contain only geographic identifiers, labels, and internal
point coordinates from the U.S. Census Bureau 2025 National Gazetteer. The source
URLs, original archive checksums, transformed-file checksums, and record counts
are recorded in `sources.json`. No provider requests are needed at runtime.

ZCTA internal points approximate customer and dealer postal areas; they are not
street addresses or exact USPS delivery boundaries. Missing or ambiguous postal
locations remain unresolved. CBSA internal points supply deterministic nearby
market candidates, not claims about inventory availability or complete coverage.
The selector uses proximity and likely new geographic coverage, never income,
asking prices, or the insurer's offer.

Sources: [2025 Gazetteer directory](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/)
and [Census Gazetteer documentation](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html).
