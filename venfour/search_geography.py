"""Offline, price-independent geographic scopes for comparable discovery."""

from __future__ import annotations

import gzip
import json
import math
import re
from collections.abc import Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any


GEOGRAPHY_VERSION = "census-gazetteer-2025"
DATA_DIRECTORY = Path(__file__).resolve().parents[1] / "data" / "geography"
EARTH_RADIUS_MILES = 3958.7613
LEGACY_CENTER_SELECTOR = "legacy-v1"
COVERAGE_CENTER_SELECTOR = "coverage-v2"
# These are application policy, not estimated population or inventory counts.
MINIMUM_NOVEL_CIRCLE_FRACTION = 0.55
MINIMUM_NOVEL_FULL_RADIUS_FRACTION = 0.40
METROPOLITAN_COVERAGE_WEIGHT = 1.20
COVERAGE_INTEGRATION_SLICES = 256


def coordinates(value: Mapping[str, Any] | None) -> tuple[float, float] | None:
    if not isinstance(value, Mapping) or value.get("ambiguous") is True:
        return None
    lat, lon = value.get("latitude"), value.get("longitude")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in (lat, lon)):
        return None
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return float(lat), float(lon)


def distance_miles(first: Mapping[str, Any], second: Mapping[str, Any]) -> float:
    a, b = coordinates(first), coordinates(second)
    if a is None or b is None:
        raise ValueError("Distance requires unambiguous coordinates")
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return round(2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(min(1.0, max(0.0, h)))), 2)


def _project_miles(origin: Mapping[str, Any], point: Mapping[str, Any]) -> tuple[float, float]:
    """Azimuthal equidistant local coordinates for bounded area estimates.

    Radial distances are great-circle distances; off-origin disk intersections
    are a local planar approximation. Request boundaries still use spherical
    customer distances, never this estimated area.
    """

    start, finish = coordinates(origin), coordinates(point)
    if start is None or finish is None:
        raise ValueError("Coverage requires unambiguous coordinates")
    lat1, lon1, lat2, lon2 = map(math.radians, (*start, *finish))
    delta = lon2 - lon1
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta / 2) ** 2
    distance = 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(min(1.0, max(0.0, h))))
    bearing = math.atan2(math.sin(delta) * math.cos(lat2),
                         math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta))
    return distance * math.sin(bearing), distance * math.cos(bearing)


def coverage_metrics(origin: Mapping[str, Any], center: Mapping[str, Any],
                     used_centers: Sequence[Mapping[str, Any]], *, endpoint_radius_miles: int,
                     integration_slices: int = COVERAGE_INTEGRATION_SLICES) -> dict[str, float]:
    """Estimate new disk area after subtracting the union of searched disks.

    Fixed midpoint integration of merged vertical intervals is deterministic
    and counts overlapping prior circles once. The default is fast enough for
    selection; callers can request more slices for an offline coverage audit.
    Values measure territory only, not population, dealer counts, or inventory.
    """

    if not isinstance(integration_slices, int) or isinstance(integration_slices, bool) or integration_slices < 16:
        raise ValueError("Coverage integration requires at least 16 slices")
    radius = float(center.get("radiusMiles", endpoint_radius_miles))
    if radius <= 0 or endpoint_radius_miles <= 0:
        raise ValueError("Coverage requires positive search radii")
    cx, cy = _project_miles(origin, center)
    previous = []
    for prior in used_centers:
        px, py = _project_miles(origin, prior)
        pr = float(prior.get("radiusMiles", endpoint_radius_miles))
        if pr > 0 and math.hypot(px - cx, py - cy) < radius + pr:
            previous.append((px, py, pr))
    if not previous:
        novel = math.pi * radius ** 2
    else:
        width = 2 * radius / integration_slices
        novel = 0.0
        for index in range(integration_slices):
            x = cx - radius + (index + 0.5) * width
            half = math.sqrt(max(0.0, radius ** 2 - (x - cx) ** 2))
            lower, upper = cy - half, cy + half
            intervals = []
            for px, py, pr in previous:
                if abs(x - px) >= pr:
                    continue
                height = math.sqrt(max(0.0, pr ** 2 - (x - px) ** 2))
                start, end = max(lower, py - height), min(upper, py + height)
                if end > start:
                    intervals.append((start, end))
            covered = 0.0
            merged_end = lower
            for start, end in sorted(intervals):
                covered += max(0.0, end - max(start, merged_end))
                merged_end = max(merged_end, end)
            novel += max(0.0, upper - lower - covered) * width
        novel = min(math.pi * radius ** 2, novel)
    area = math.pi * radius ** 2
    return {"areaSquareMiles": round(area, 2), "newAreaSquareMiles": round(novel, 2),
            "novelFraction": round(novel / area, 6),
            "newFullRadiusFraction": round(novel / (math.pi * endpoint_radius_miles ** 2), 6)}


@lru_cache(maxsize=1)
def _postal_centroids() -> dict[str, list[float]]:
    with gzip.open(DATA_DIRECTORY / "us-zcta-2025.json.gz", "rt") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def _market_centers() -> tuple[dict[str, Any], ...]:
    with gzip.open(DATA_DIRECTORY / "us-cbsa-2025.json.gz", "rt") as handle:
        return tuple(json.load(handle))


class SearchGeography:
    """Use Census internal points; never infer a customer street address.

    ZCTAs approximate postal areas, and CBSA internal points describe nearby
    markets rather than dealer density. Missing ZIPs do not get guessed.
    Injectable data keeps offline fixtures small and deterministic.
    """

    def __init__(self, *, postal_centroids: Mapping[str, Sequence[float]] | None = None,
                 market_centers: Sequence[Mapping[str, Any]] | None = None) -> None:
        self._postals = postal_centroids
        self._markets = market_centers

    def locate(self, value: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if not isinstance(value, Mapping) or value.get("ambiguous") is True:
            return None
        point = coordinates(value)
        if point is not None:
            return {"latitude": point[0], "longitude": point[1],
                    "precision": value.get("precision", "PROVIDER_COORDINATE"),
                    "postalCode": value.get("postalCode"), "source": value.get("source", "PROVIDER")}
        postal = value.get("postalCode")
        if not isinstance(postal, str) or re.fullmatch(r"[0-9]{5}(?:-[0-9]{4})?", postal.strip()) is None:
            return None
        postal = postal.strip()
        data = self._postals if self._postals is not None else _postal_centroids()
        pair = data.get(postal[:5])
        if pair is None:
            return None
        return {"latitude": float(pair[0]), "longitude": float(pair[1]),
                "precision": "POSTAL_AREA_APPROXIMATION", "postalCode": postal[:5], "source": GEOGRAPHY_VERSION}

    def origin(self, postal_code: str | None) -> dict[str, Any] | None:
        point = self.locate({"postalCode": postal_code})
        return None if point is None else {**point, "id": "customer", "label": "Customer postal area"}

    def snapshot(self, origin: Mapping[str, Any] | None, *, outer_boundary_miles: int) -> dict[str, Any]:
        """Freeze nearby market choices without retaining the national ZIP table."""

        markets = self._markets if self._markets is not None else _market_centers()
        nearby = [dict(item) for item in markets if origin is not None
                  and coordinates(item) is not None and distance_miles(origin, item) < outer_boundary_miles]
        return {"version": GEOGRAPHY_VERSION, "origin": dict(origin) if origin else None,
                "marketCenters": sorted(nearby, key=lambda item: str(item["id"]))}

    def next_center(self, origin: Mapping[str, Any], used_centers: Sequence[Mapping[str, Any]], *,
                    endpoint_radius_miles: int, outer_boundary_miles: int,
                    excluded_ids: Sequence[str] = (),
                    selector_version: str = COVERAGE_CENTER_SELECTOR) -> dict[str, Any] | None:
        """Select useful new territory, with a coarse Census market-type proxy.

        Metro/Micro labels are the only bundled market-density signal. A modest
        metropolitan weight favors regional markets without pretending to know
        population, dealer inventory, or prices. Radius shrinkage is charged in
        absolute new area, so distant tiny circles cannot win on novelty alone.
        Legacy selection is kept verbatim for immutable historical replay.
        """

        if selector_version == LEGACY_CENTER_SELECTOR:
            return self._legacy_next_center(origin, used_centers,
                endpoint_radius_miles=endpoint_radius_miles, outer_boundary_miles=outer_boundary_miles,
                excluded_ids=excluded_ids)
        if selector_version != COVERAGE_CENTER_SELECTOR:
            raise ValueError("Unsupported geographic center selector")
        if coordinates(origin) is None:
            return None
        markets = self._markets if self._markets is not None else _market_centers()
        excluded = set(excluded_ids) | {row["id"] for row in used_centers}
        choices = []
        for item in markets:
            if item.get("id") in excluded or coordinates(item) is None:
                continue
            distance = distance_miles(origin, item)
            # Use unrounded distance for the whole provider disk containment test.
            raw_distance = math.hypot(*_project_miles(origin, item))
            radius = min(endpoint_radius_miles, math.floor(outer_boundary_miles - raw_distance))
            if radius < min(25, endpoint_radius_miles):
                continue
            center = {"id": str(item["id"]), "label": str(item["label"]),
                      "latitude": item["latitude"], "longitude": item["longitude"],
                      "radiusMiles": radius, "distanceFromCustomerMiles": distance,
                      "source": GEOGRAPHY_VERSION, "selectionReason": "NEARBY_MARKET_NEW_COVERAGE"}
            coverage = coverage_metrics(origin, center, used_centers, endpoint_radius_miles=endpoint_radius_miles)
            if (coverage["novelFraction"] < MINIMUM_NOVEL_CIRCLE_FRACTION
                    or coverage["newFullRadiusFraction"] < MINIMUM_NOVEL_FULL_RADIUS_FRACTION):
                continue
            metropolitan = str(item["label"]).endswith(" Metro Area")
            score = coverage["newAreaSquareMiles"] * (METROPOLITAN_COVERAGE_WEIGHT if metropolitan else 1)
            key = (-round(score, 2), -coverage["newAreaSquareMiles"], distance, str(item["id"]))
            choices.append((key, center))
        return min(choices, key=lambda x: x[0])[1] if choices else None

    def _legacy_next_center(self, origin: Mapping[str, Any], used_centers: Sequence[Mapping[str, Any]], *,
                            endpoint_radius_miles: int, outer_boundary_miles: int,
                            excluded_ids: Sequence[str] = ()) -> dict[str, Any] | None:
        if coordinates(origin) is None:
            return None
        markets = self._markets if self._markets is not None else _market_centers()
        excluded = set(excluded_ids) | {row["id"] for row in used_centers}
        choices = []
        for item in markets:
            if item.get("id") in excluded or coordinates(item) is None:
                continue
            distance = distance_miles(origin, item)
            radius = min(endpoint_radius_miles, math.floor(outer_boundary_miles - distance))
            if radius < min(25, endpoint_radius_miles) or distance < endpoint_radius_miles * 0.6:
                continue
            separation = min((distance_miles(item, prior) for prior in used_centers), default=distance)
            if separation < radius * 0.6:
                continue
            # Proximity first; novelty breaks ties within a 25-mile distance band.
            key = (int(distance // 25), -min(separation / max(radius, 1), 2), distance, str(item["id"]))
            choices.append((key, {"id": str(item["id"]), "label": str(item["label"]),
                                  "latitude": item["latitude"], "longitude": item["longitude"],
                                  "radiusMiles": radius, "distanceFromCustomerMiles": distance,
                                  "source": GEOGRAPHY_VERSION, "selectionReason": "NEARBY_MARKET_NEW_COVERAGE"}))
        return min(choices, key=lambda x: x[0])[1] if choices else None
