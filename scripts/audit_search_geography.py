"""Compare legacy and current discovery territory using bundled geography only."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venfour.search_geography import (  # noqa: E402
    COVERAGE_CENTER_SELECTOR,
    LEGACY_CENTER_SELECTOR,
    SearchGeography,
    coverage_metrics,
    distance_miles,
)


def _intersection(radius_a: float, radius_b: float, distance: float) -> float:
    if distance >= radius_a + radius_b:
        return 0.0
    if distance <= abs(radius_a - radius_b):
        return math.pi * min(radius_a, radius_b) ** 2
    cosine_a = (distance ** 2 + radius_a ** 2 - radius_b ** 2) / (2 * distance * radius_a)
    cosine_b = (distance ** 2 + radius_b ** 2 - radius_a ** 2) / (2 * distance * radius_b)
    segment = (-distance + radius_a + radius_b) * (distance + radius_a - radius_b)
    segment *= (distance - radius_a + radius_b) * (distance + radius_a + radius_b)
    return (radius_a ** 2 * math.acos(max(-1.0, min(1.0, cosine_a)))
            + radius_b ** 2 * math.acos(max(-1.0, min(1.0, cosine_b)))
            - 0.5 * math.sqrt(max(0.0, segment)))


def audit(postal_code: str, *, radius_miles: int = 100, outer_boundary_miles: int = 250,
          additional_centers: int = 4) -> dict:
    geography = SearchGeography()
    origin = geography.origin(postal_code)
    if origin is None:
        raise ValueError("Postal code is absent from the bundled geography")
    origin = {**origin, "radiusMiles": min(radius_miles, outer_boundary_miles)}
    report = {
        "postalCode": postal_code,
        "method": "Local azimuthal-equidistant disks; incremental area uses 16,384 deterministic midpoint slices",
        "limitations": ["Territory estimates are a planar approximation, not population or inventory coverage",
                        "Metro/Micro labels are a coarse market-type proxy; no population or dealer counts are bundled",
                        "Actual expansion may stop sooner because candidate productivity or budgets take precedence"],
        "localCircleAreaSquareMiles": round(math.pi * origin["radiusMiles"] ** 2, 2),
        "outerBoundaryMiles": outer_boundary_miles,
        "selectors": {},
    }
    for selector in (LEGACY_CENTER_SELECTOR, COVERAGE_CENTER_SELECTOR):
        used = [origin]
        sequence = []
        union = math.pi * origin["radiusMiles"] ** 2
        for _ in range(additional_centers):
            center = geography.next_center(origin, used, endpoint_radius_miles=radius_miles,
                outer_boundary_miles=outer_boundary_miles, selector_version=selector)
            if center is None:
                break
            coverage = coverage_metrics(origin, center, used, endpoint_radius_miles=radius_miles,
                                        integration_slices=16384)
            union += coverage["newAreaSquareMiles"]
            sequence.append({"center": center, "coverage": coverage, "unionAreaSquareMiles": round(union, 2)})
            used.append(center)
        pairwise = []
        for index, left in enumerate(used[:3]):
            for right in used[index + 1:3]:
                distance = distance_miles(left, right)
                overlap = _intersection(left["radiusMiles"], right["radiusMiles"], distance)
                pairwise.append({"first": left["label"], "second": right["label"],
                                 "separationMiles": distance, "overlapSquareMiles": round(overlap, 2),
                                 "fractionOfFirstCircle": round(overlap / (math.pi * left["radiusMiles"] ** 2), 6),
                                 "fractionOfSecondCircle": round(overlap / (math.pi * right["radiusMiles"] ** 2), 6)})
        report["selectors"][selector] = {"additionalCenters": sequence, "firstThreeCirclesPairwise": pairwise}
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("postal_code")
    parser.add_argument("--radius", type=int, default=100)
    parser.add_argument("--boundary", type=int, default=250)
    parser.add_argument("--additional-centers", type=int, default=4)
    args = parser.parse_args()
    print(json.dumps(audit(args.postal_code, radius_miles=args.radius, outer_boundary_miles=args.boundary,
                           additional_centers=args.additional_centers), indent=2))


if __name__ == "__main__":
    main()
