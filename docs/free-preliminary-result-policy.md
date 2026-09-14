# Free preliminary result policy, version 1

New completed adaptive manual/VIN free analyses save analysis-run version 12
and presentation version 8. `preliminaryResult.version` is `1`. Older saved
analyses retain their original versions, calculations and presentation. Reopen
loads the saved artifact and validates its deterministic replay without provider
transport. No existing cases or saved analyses are rewritten.

The free result is separate from the unchanged discrepancy, qualification,
scoring, strict full-review eligibility and payment-readiness contracts. Uploading
a report must still pass the existing full-review checks. Contextual evidence
never enters those strict results. Search boundaries, budgets, reservations,
stopping rules and provider retention settings are unchanged by this policy.

## Evidence suitable for listing context

Only normalized baseline observations already retained by the completed search
are considered. Supporting discoveries are excluded. Each record must have:

- A VIN or existing provider/listing identity, different from the subject
  vehicle, and no conflicting observations. A provider/listing ID identifies
  an observation, not necessarily an independent vehicle. Missing or invalid
  VINs are disclosed, and contextual sample counts are labeled as listings.
- Canonically matching year, make, model and trim. Every confirmed material
  configuration conflict remains disqualifying. Missing information and generic
  descriptions remain unresolved, never receive confirmed-match credit, and do
  not cause a customer technical-confirmation task.
- A verified positive asking price, known mileage, and a verified location
  within 250 miles of the customer. Mileage difference must be at most 25,000
  miles, the existing scorer's moderate-relevance boundary.
- An explicit verified evidence date: current active-inventory observations at
  the recorded observation date, or VIN-history observations verified at the
  loss date. Unverified historical discovery observations are excluded.

Certification or warranty differences may be disclosed in listing context.
They do not receive an invented deduction, zero premium, or upper-bound label.
Known mileage differences are shown without dollar adjustments. Optional
equipment or powertrain uncertainty is disclosed once in the result summary.

Each stream is deduplicated independently. Inconsistent prices for the same
identity in the same stream exclude that identity. Context uses current evidence
when available; otherwise it uses verified loss-date evidence. Streams never
share one sample or price span. Selection is bounded by the existing comparison
set maximum of 9, ordered by specification completeness, mileage difference,
customer distance and identity. Neither price nor insurer offer enters ordering.
The UI may show the first three examples; the span describes the saved bounded
sample, not all regional inventory.

## Evidence sufficient for a preliminary estimate

An estimate reuses an entire existing price-independent, rank-selected baseline
discrepancy sample; it does not choose a favorable replacement subset. It requires:

- At least the existing minimum of 3 independent vehicles. Both existing STRONG
  and GOOD evidence may qualify; the score threshold of 70 is unchanged.
  Each selected vehicle must have a distinct structurally valid 17-character
  VIN (letters I, O and Q excluded). Separate listing IDs or malformed VINs
  cannot establish independent vehicle count and support only listing context.
- Every selected vehicle also passes the context checks and existing baseline
  eligibility, with no unresolved certification/warranty premium.
- Each mileage difference is at most 10,000 miles, the existing scorer's close
  category. This is an uncertainty boundary, not a mileage-price adjustment.
- No confirmed material conflict among the selected vehicle configurations,
  including when the subject specification is unknown. An unresolved subject
  variant cannot support a range by combining incompatible listing variants.
  The existing two-independent-vehicles-per-variant ambiguity check also applies
  to the complete usable stream, preventing rank selection from hiding an
  unresolved fuel/body/cab/bed variant outside the selected sample.
- The existing robust dispersion calculation is below its existing 20% policy
  threshold: max(median absolute deviation, central half-range) / median.
  The complete displayed price span divided by the median must also be below
  that same threshold. A lone extreme endpoint cannot become a subject-value
  bound just because the robust median tolerates the outlier. Wider evidence
  remains context; no outlier is silently discarded to manufacture an estimate.

Missing technical details alone do not add a second score penalty or require
customer correction; compatible partial evidence remains explicitly qualified
by its uncertainty. Verified loss-date evidence is preferred when sufficient;
otherwise a sufficient current sample may support a clearly labeled current
estimate. The range reuses that sample's unchanged minimum and maximum asking
prices. There are no inferred dollar adjustments, percentage widening, confidence
percentages, MSRP floors, offer-based floors or highest-price averaging.

Only a loss-date `ESTIMATE` may provide an insurer-value position relative to the
range. Current estimates and all listing context suppress insurer comparisons.
Even a supported position is not a recoverable amount or entitlement.

## Frozen outcomes and interruptions

- `ESTIMATE`: `estimatedRange` contains the qualified sample's bounds;
  `listingPriceSpan` is null. The range is preliminary, not an appraisal or a
  guaranteed settlement.
- `LISTING_CONTEXT`: `listingPriceSpan` contains the observed asking-price bounds;
  `estimatedRange` and `insurerComparison` are null. One or two relevant vehicles,
  larger mileage gaps, unresolved premiums or high dispersion can lead here.
- `INSUFFICIENT`: no usable priced sample; both ranges and the insurer comparison
  are null. The case remains available for insurer-report upload.

Provider failure, quota/budget interruption or observation-limit interruption
instead saves `preliminaryResult: null` and uses the separate `SEARCH_INTERRUPTED`
status. It is not a fourth valuation outcome or evidence that no comparable
vehicles exist. All three evidence outcomes offer the existing insurer-report
continuation without establishing payment eligibility.

The captured sparse Kona evidence replays as current listing context: two
independent asking prices, $23,077 and $25,333. Certification uncertainty and
11,817/15,904-mile gaps prevent a subject estimate. The separate unverified
historical observation is excluded. No comparison with the $25,704 insurer value
is supported, and the strict result remains insufficient. Repository regressions
use fictional identities with these numerical relationships.
