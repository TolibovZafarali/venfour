"""Deterministic synthetic market provider used for Phase 3 development tests."""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from venfour.market import (
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProviderResponseError,
    MarketSearchRequest,
    MarketSearchResult,
    validate_market_listing,
)


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MarketProviderResponseError(
            "Synthetic fixture record is malformed",
            (f"{path}: expected an object",),
        )
    return value


class FixtureMarketProvider:
    """Normalize committed provider-shaped synthetic records.

    The fixture adapter matches year, make, and model case-insensitively and
    applies the request's result limit. It intentionally does not treat trim or
    mileage as mandatory matching thresholds. Fixture values are software test
    data and are not evidence of current market prices.
    """

    name = "fixture"

    def __init__(self, records: Sequence[Mapping[str, Any]]) -> None:
        if isinstance(records, (str, bytes)) or not isinstance(records, Sequence):
            raise MarketProviderResponseError(
                "Synthetic fixture records must be an array"
            )
        copied_records: list[Mapping[str, Any]] = []
        for index, record in enumerate(records):
            copied_records.append(_mapping(copy.deepcopy(record), f"$.records[{index}]"))
        self._records = tuple(copied_records)

    @classmethod
    def from_file(cls, path: Path | str) -> FixtureMarketProvider:
        """Load an explicitly marked synthetic fixture JSON document."""

        fixture_path = Path(path)
        try:
            data = json.loads(fixture_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise MarketProviderResponseError(
                f"Synthetic fixture could not be read: {fixture_path}"
            ) from exc
        except json.JSONDecodeError as exc:
            raise MarketProviderResponseError(
                f"Synthetic fixture is not valid JSON: {fixture_path}"
            ) from exc

        document = _mapping(data, "$")
        if document.get("syntheticData") is not True:
            raise MarketProviderResponseError(
                "Fixture document must be explicitly marked as synthetic",
                ("$.syntheticData: expected true",),
            )
        records = document.get("records")
        if not isinstance(records, list):
            raise MarketProviderResponseError(
                "Synthetic fixture records must be an array",
                ("$.records: expected an array",),
            )
        return cls(records)

    def _normalize_record(
        self, record: Mapping[str, Any], index: int
    ) -> MarketListing:
        record_path = f"$.records[{index}]"
        vehicle = _mapping(record.get("vehicle"), f"{record_path}.vehicle")
        seller_value = record.get("seller")
        dealer: MarketDealer | None
        if seller_value is None:
            dealer = None
        else:
            seller = _mapping(seller_value, f"{record_path}.seller")
            dealer = MarketDealer(
                name=seller.get("displayName"),
                city=seller.get("locality"),
                state=seller.get("regionCode"),
                postal_code=seller.get("postal"),
            )

        listing = MarketListing(
            source=self.name,
            source_listing_id=record.get("fixtureListingId"),
            listing_url=record.get("detailsUrl"),
            year=vehicle.get("modelYear"),
            make=vehicle.get("manufacturer"),
            model=vehicle.get("modelName"),
            trim=vehicle.get("grade"),
            vin=vehicle.get("vehicleIdentificationNumber"),
            mileage=record.get("odometerMiles"),
            price=record.get("askingPrice"),
            dealer=dealer,
            distance_miles=record.get("milesFromSearch"),
        )
        try:
            validate_market_listing(listing)
        except MarketContractError as exc:
            details = tuple(f"{record_path}{detail[1:]}" for detail in exc.details)
            raise MarketProviderResponseError(
                "Synthetic fixture could not be normalized to MarketListing",
                details,
            ) from exc
        return listing

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        """Return deterministic canonical listings without external requests."""

        normalized = [
            self._normalize_record(record, index)
            for index, record in enumerate(self._records)
        ]
        matches = [
            listing
            for listing in normalized
            if listing.year == request.year
            and listing.make.casefold() == request.make.casefold()
            and listing.model.casefold() == request.model.casefold()
        ]
        return MarketSearchResult(
            provider=self.name,
            request=request,
            listings=tuple(matches[: request.result_limit]),
        )


__all__ = ["FixtureMarketProvider"]
