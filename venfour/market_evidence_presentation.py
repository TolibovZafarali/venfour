"""Display-only projections for bounded search scope and supporting examples."""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker


SUPPORTING_TITLE = "Higher-priced comparable listings"
SUPPORTING_DISCLOSURE = (
    "These deliberately selected higher asking prices are supporting examples, not typical market prices or verified sale prices. "
    "They do not change the broader market valuation or establish a guaranteed increase."
)
LIMITED_SEARCH_SUMMARY = (
    "The search found limited comparable evidence. An incomplete search does not establish that the insurer's value is fair."
)
LIMITED_NO_INCREASE_SUMMARY = "No increase is supported by the evidence found; the comparable search was limited."
_STOP_COPY = {
    "SUFFICIENT_STRONG_EVIDENCE": "Enough strong matches were verified for the search target.",
    "NOT_CONFIGURED": "This evidence source was not included in the search.",
    "OUT_OF_PROVIDER_RANGE": "The loss date was outside the provider's available history window.",
    "HISTORICAL_BASELINE_SUFFICIENT_CURRENT_CONTEXT_ONLY": "Current listings were checked as context after sufficient loss-date evidence was found.",
    "HISTORICAL_BASELINE_SUFFICIENT": "Sufficient loss-date evidence was found.",
    "BUDGET_OR_QUOTA_LIMITED": "The search stopped at its available request allowance.",
    "PROVIDER_FAILURE": "A market-data request could not complete; previously verified evidence was retained.",
    "OBSERVATION_LIMIT": "The search reached its candidate limit.",
    "GEOGRAPHIC_SCOPE_LIMITED": "The available search locations were exhausted within the geographic boundary.",
    "CUSTOMER_LOCATION_UNAVAILABLE": "The customer's location could not be verified for a local comparison.",
}
_LIMITATION_COPY = {
    "ADVERTISED_PRICE_NOT_COMPLETED_SALE": "The asking price is not a verified completed-sale price.",
    "NOT_A_TYPICAL_MARKET_PRICE": "This selected higher price is not presented as a typical market price.",
    "NO_GUARANTEED_RECOVERY": "This example does not establish entitlement to or guarantee a higher settlement.",
    "NO_INDEPENDENT_DOLLAR_ADJUSTMENTS": "No independent dollar adjustments were made for differences between vehicles.",
}
_FACT_LABELS = {
    "bodyType": "Body", "bodySubtype": "Body configuration", "cabType": "Cab", "bedLength": "Bed length",
    "powertrain": "Powertrain", "engine": "Engine", "fuelType": "Fuel", "transmission": "Transmission",
    "cylinders": "Cylinders", "doors": "Doors", "equipment": "Equipment", "certified": "Certified", "warranty": "Warranty",
}


@lru_cache(maxsize=1)
def _schemas() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "schemas" / "analysis" / "market-evidence-display.schema.json"
    return json.loads(path.read_text())


def validate_market_evidence_display(value: Mapping[str, Any], kind: str) -> None:
    schema = _schemas()["$defs"][kind]
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)
    if kind == "higherPricedComparableListings":
        if value["title"] != SUPPORTING_TITLE or value["disclosure"] != SUPPORTING_DISCLOSURE:
            raise ValueError("Supporting evidence must preserve its nonrepresentative disclosure")
        for listing in value["listings"]:
            if listing["askingPriceDisplay"] != f"${Decimal(listing['askingPriceCents']) / 100:,.2f}":
                raise ValueError("Supporting asking-price display does not match source cents")
            if (listing["priceSource"] == "history") != (listing["temporalBasis"] == "Loss-date historical listing"):
                raise ValueError("Supporting price source does not match its temporal basis")
            url = listing.get("listingUrl")
            if url is not None:
                parsed = urlsplit(url)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
                    raise ValueError("Supporting listing URL is invalid")


def project_market_search_context(search: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(search, Mapping):
        return None
    status = search["baselineStatus"]
    if status not in {"SUFFICIENT", "LIMITED"}:
        raise ValueError("Unknown market-search status")
    reasons = search.get("stopReasons", {})
    result = {
        "baselineStatus": status,
        "summary": LIMITED_SEARCH_SUMMARY if status == "LIMITED" else "The search reached its target of strong comparable evidence.",
        "stopReasons": [
            {"stream": stream, "code": str(code), "description": _STOP_COPY.get(str(code), "This search branch stopped before further evidence could be verified.")}
            for stream, code in sorted(reasons.items())
        ],
    }
    validate_market_evidence_display(result, "marketSearchContext")
    return result


def project_supporting_evidence(search: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(search, Mapping) or not isinstance(search.get("supportingEvidence"), Mapping):
        return None
    evidence = search["supportingEvidence"]
    result: dict[str, Any] = {
        "title": SUPPORTING_TITLE, "disclosure": SUPPORTING_DISCLOSURE,
        "affectsBaselineValuation": False, "searchStatus": evidence.get("searchStatus"), "listings": [],
    }
    for item in evidence.get("listings", []):
        listing = item["listing"]
        price_cents = int((Decimal(str(item["verifiedAskingPrice"])) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        facts = []
        for key, label in _FACT_LABELS.items():
            value = item.get("matchingFacts", {}).get(key)
            if value is None:
                continue
            if isinstance(value, bool):
                display = "Yes" if value else "No"
            elif isinstance(value, list):
                display = ", ".join(str(entry) for entry in value) or "No additional packages recorded"
            else:
                display = str(value)
            facts.append({"label": label, "value": display})
        result["listings"].append({
            "identity": item["identity"],
            "vehicle": " ".join(str(listing[key]) for key in ("year", "make", "model", "trim") if listing.get(key) is not None),
            "mileage": listing.get("mileage"), "askingPriceCents": price_cents,
            "askingPriceDisplay": f"${Decimal(price_cents) / 100:,.2f}",
            "distanceMiles": item["distanceMiles"], "relevantDate": item["relevantDate"],
            "temporalBasis": "Loss-date historical listing" if item["stream"] == "historical" else "Current-market listing",
            "source": listing["source"], "priceSource": item["priceSource"],
            "listingUrl": listing.get("listingUrl"), "matchingFacts": facts,
            "materialDifferences": [f"{entry['field']}: subject {entry.get('subject')}; listing {entry.get('listing')}" for entry in item.get("materialDifferences", [])],
            "limitations": [_LIMITATION_COPY.get(text, text) for text in item.get("limitations", [])],
            "reasonCodes": copy.deepcopy(item.get("reasonCodes", [])),
        })
    validate_market_evidence_display(result, "higherPricedComparableListings")
    return result
