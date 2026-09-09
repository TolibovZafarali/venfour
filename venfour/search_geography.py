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
