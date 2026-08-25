"""Deterministic tests for the provider-neutral market discovery boundary."""

from __future__ import annotations

import copy
import json
import math
import os
import socket
import tempfile
import unittest
from collections import UserList
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import patch

from jsonschema import Draft202012Validator

from venfour.fixture_market import FixtureMarketProvider
from venfour.market import (
    LISTING_SCHEMA_PATH,
    SEARCH_REQUEST_SCHEMA_PATH,
    SEARCH_RESULT_SCHEMA_PATH,
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProvider,
    MarketProviderError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketSearchRequest,
    MarketSearchResult,
    VehicleConfigurationIdentity,
    discover_market_listings,
    validate_market_listing,
    validate_market_search_request,
    validate_market_search_result,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "market" / "listings.json"


def make_request(**overrides: Any) -> MarketSearchRequest:
    values: dict[str, Any] = {
        "year": 2025,
        "make": "Toyota",
        "model": "Camry",
        "trim": "SE",
        "loss_vehicle_mileage": 7192,
        "postal_code": "63123",
        "radius_miles": 50,
        "result_limit": 25,
    }
    values.update(overrides)
    return MarketSearchRequest(**values)


def make_listing(**overrides: Any) -> MarketListing:
    values: dict[str, Any] = {
        "source": "test-provider",
        "source_listing_id": "listing-001",
        "listing_url": "https://fixtures.example/listing-001",
        "year": 2025,
        "make": "Toyota",
        "model": "Camry",
        "trim": "SE",
        "vin": None,
        "mileage": 8500,
        "price": 32995,
        "dealer": MarketDealer(
            name="Example Dealer",
            city="St. Louis",
            state="MO",
            postal_code="63123",
        ),
        "distance_miles": 14,
    }
    values.update(overrides)
    return MarketListing(**values)


class StaticMarketProvider:
    """Small provider test double that records the normalized request."""

    def __init__(
        self,
        result_factory: Callable[[MarketSearchRequest], Any],
        *,
        name: str = "test-provider",
    ) -> None:
        self.name = name
        self.result_factory = result_factory
        self.requests: list[MarketSearchRequest] = []

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        self.requests.append(request)
        return self.result_factory(request)


class RaisingNameProvider:
    @property
    def name(self) -> str:
        raise RuntimeError("provider-specific name failure")

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        raise AssertionError("search should not be called")


class MarketSchemaContractTests(unittest.TestCase):
    def test_configuration_identity_serializes_separately_from_trim(self) -> None:
        configuration = VehicleConfigurationIdentity(
            source="marketcheck",
            field="version",
            values=("Long Range", "Long Range Battery"),
        )
        request = make_request(
            trim="Long Range",
            configuration=configuration,
        )

        self.assertEqual(
            request.to_dict()["configuration"],
            {
                "source": "marketcheck",
                "field": "version",
                "values": ["Long Range", "Long Range Battery"],
            },
        )
        validate_market_search_request(request)

    def test_configuration_identity_rejects_unsafe_or_ambiguous_values(
        self,
    ) -> None:
        invalid_values = (
            (),
            ("Long Range", "long range"),
            ("Long,Range",),
            ("Long\nRange",),
            ("Long\u202eRange",),
            tuple(f"Alias {index}" for index in range(21)),
        )
        for values in invalid_values:
            with self.subTest(values=values), self.assertRaises(
                (TypeError, ValueError)
            ):
                VehicleConfigurationIdentity(
                    source="marketcheck",
                    field="version",
                    values=values,
                )

        with self.assertRaises((TypeError, ValueError)):
            VehicleConfigurationIdentity(
                source="marketcheck",
                field=None,  # type: ignore[arg-type]
                values=("Long Range",),
            )

    def test_configuration_requires_a_canonical_trim(self) -> None:
        configuration = VehicleConfigurationIdentity(
            source="marketcheck",
            field="version",
            values=("Long Range Battery",),
        )

        with self.assertRaises(ValueError):
            make_request(trim=None, configuration=configuration)

        payload = make_request().to_dict()
        payload["trim"] = None
        payload["configuration"] = configuration.to_dict()
        with self.assertRaises(MarketContractError):
            validate_market_search_request(payload)

    def test_all_market_schemas_are_valid_draft_2020_12(self) -> None:
        for path in (
            SEARCH_REQUEST_SCHEMA_PATH,
            LISTING_SCHEMA_PATH,
            SEARCH_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                Draft202012Validator.check_schema(schema)

    def test_result_schema_definitions_match_standalone_contracts(self) -> None:
        result_schema = json.loads(
            SEARCH_RESULT_SCHEMA_PATH.read_text(encoding="utf-8")
        )

        for name, path in (
            ("searchRequest", SEARCH_REQUEST_SCHEMA_PATH),
            ("listing", LISTING_SCHEMA_PATH),
        ):
            with self.subTest(contract=name):
                standalone = json.loads(path.read_text(encoding="utf-8"))
                standalone.pop("$schema")
                standalone.pop("title")
                definitions = standalone.pop("$defs", {})
                if definitions:
                    self.assertEqual(
                        result_schema["$defs"]["vehicleConfiguration"],
                        definitions["vehicleConfiguration"],
                    )
                self.assertEqual(result_schema["$defs"][name], standalone)

    def test_valid_search_request(self) -> None:
        validate_market_search_request(make_request())
        validate_market_search_request(
            {"year": 2024, "make": "Hyundai", "model": "Elantra"}
        )

    def test_invalid_search_request_missing_required_field(self) -> None:
        with self.assertRaises(MarketContractError) as raised:
            validate_market_search_request({"year": 2025, "make": "Toyota"})
        self.assertTrue(any("model" in detail for detail in raised.exception.details))

    def test_invalid_search_request_rejects_unexpected_property(self) -> None:
        request = make_request().to_dict()
        request["providerQuery"] = "provider-specific"

        with self.assertRaises(MarketContractError):
            validate_market_search_request(request)

    def test_search_request_numeric_bounds_are_enforced(self) -> None:
        for field, value in (
            ("year", -1),
            ("lossVehicleMileage", -1),
            ("radiusMiles", -1),
            ("resultLimit", 0),
        ):
            request = make_request().to_dict()
            request[field] = value
            with self.subTest(field=field), self.assertRaises(MarketContractError):
                validate_market_search_request(request)

    def test_search_request_rejects_whitespace_only_optional_text(self) -> None:
        for field in ("trim", "postalCode"):
            request = make_request().to_dict()
            request[field] = "   "
            with self.subTest(field=field), self.assertRaises(MarketContractError):
                validate_market_search_request(request)

    def test_valid_minimal_listing(self) -> None:
        validate_market_listing(
            {
                "source": "example-provider",
                "year": 2025,
                "make": "Toyota",
                "model": "Camry",
                "price": 32995,
            }
        )

    def test_listing_missing_required_field_is_rejected(self) -> None:
        listing = make_listing().to_dict()
        del listing["price"]

        with self.assertRaises(MarketContractError) as raised:
            validate_market_listing(listing)
        self.assertTrue(any("price" in detail for detail in raised.exception.details))

    def test_listing_accepts_all_optional_fields_as_null(self) -> None:
        listing = make_listing(
            source_listing_id=None,
            listing_url=None,
            trim=None,
            vin=None,
            mileage=None,
            dealer=None,
            distance_miles=None,
        )

        validate_market_listing(listing)
        self.assertIsNone(listing.to_dict()["mileage"])
        self.assertIsNone(listing.to_dict()["dealer"])

    def test_listing_rejects_unexpected_property(self) -> None:
        listing = make_listing().to_dict()
        listing["providerPayload"] = {"stockCode": "private"}

        with self.assertRaises(MarketContractError):
            validate_market_listing(listing)

    def test_dealer_rejects_unexpected_property(self) -> None:
        listing = make_listing().to_dict()
        listing["dealer"]["salesperson"] = "Synthetic Person"

        with self.assertRaises(MarketContractError):
            validate_market_listing(listing)

    def test_listing_rejects_whitespace_only_optional_text(self) -> None:
        for field in ("sourceListingId", "listingUrl", "trim", "vin"):
            listing = make_listing().to_dict()
            listing[field] = "   "
            with self.subTest(field=field), self.assertRaises(MarketContractError):
                validate_market_listing(listing)

        for field in ("name", "city", "state", "postalCode"):
            listing = make_listing().to_dict()
            listing["dealer"][field] = "   "
            with self.subTest(dealer_field=field), self.assertRaises(
                MarketContractError
            ):
                validate_market_listing(listing)

    def test_negative_price_is_rejected(self) -> None:
        with self.assertRaises(MarketContractError):
            validate_market_listing(make_listing(price=-0.01))

    def test_negative_mileage_is_rejected(self) -> None:
        with self.assertRaises(MarketContractError):
            validate_market_listing(make_listing(mileage=-1))

    def test_negative_distance_is_rejected(self) -> None:
        with self.assertRaises(MarketContractError):
            validate_market_listing(make_listing(distance_miles=-1))

    def test_non_finite_numbers_are_rejected(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(MarketContractError):
                validate_market_listing(make_listing(price=value))

    def test_non_json_numeric_type_is_rejected(self) -> None:
        with self.assertRaises(MarketContractError) as raised:
            validate_market_listing(make_listing(price=Decimal("32995")))
        self.assertTrue(any("Decimal" in detail for detail in raised.exception.details))

    def test_empty_search_result_is_valid(self) -> None:
        validate_market_search_result(
            {
                "provider": "fixture",
                "request": {
                    "year": 2025,
                    "make": "Toyota",
                    "model": "Camry",
                },
                "listings": [],
                "listingCount": 0,
            }
        )

    def test_result_count_must_match_listings(self) -> None:
        with self.assertRaises(MarketContractError) as raised:
            validate_market_search_result(
                {
                    "provider": "fixture",
                    "request": {
                        "year": 2025,
                        "make": "Toyota",
                        "model": "Camry",
                    },
                    "listings": [],
                    "listingCount": 1,
                }
            )
        self.assertTrue(
            any("listingCount" in detail for detail in raised.exception.details)
        )


class FixtureMarketProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = FixtureMarketProvider.from_file(FIXTURE_PATH)

    def test_fixture_is_explicitly_synthetic(self) -> None:
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        self.assertIs(fixture["syntheticData"], True)
        self.assertIn("not verified", fixture["notice"].lower())

    def test_fixture_provider_implements_protocol(self) -> None:
        self.assertIsInstance(self.provider, MarketProvider)

    def test_fixture_provider_requires_no_key_or_network(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("network access attempted"),
            ),
        ):
            result = discover_market_listings(make_request(), self.provider)

        self.assertEqual(result.listing_count, 2)

    def test_fixture_provider_returns_canonical_camry_listings(self) -> None:
        result = discover_market_listings(make_request(), self.provider)

        self.assertEqual(result.provider, "fixture")
        self.assertEqual(result.listing_count, 2)
        self.assertEqual(
            [(item.year, item.make, item.model) for item in result.listings],
            [(2025, "Toyota", "Camry"), (2025, "Toyota", "Camry")],
        )
        self.assertIsNone(result.listings[1].source_listing_id)
        self.assertIsNone(result.listings[1].mileage)
        for listing in result.listings:
            validate_market_listing(listing)

    def test_fixture_trim_and_mileage_are_not_forced_exact_matches(self) -> None:
        request = make_request(
            year=2024,
            make="Hyundai",
            model="Elantra",
            trim="SEL",
        )

        result = discover_market_listings(request, self.provider)

        self.assertEqual(result.listing_count, 2)
        self.assertEqual(
            [listing.trim for listing in result.listings],
            ["SEL", "SEL Convenience"],
        )
        self.assertEqual(
            [listing.mileage for listing in result.listings], [12400, 18750]
        )

    def test_fixture_provider_does_not_leak_provider_specific_fields(self) -> None:
        canonical_json = json.dumps(
            discover_market_listings(make_request(), self.provider).to_dict()
        )

        self.assertNotIn("providerDebug", canonical_json)
        self.assertNotIn("internalStockCode", canonical_json)
        self.assertNotIn("fixtureListingId", canonical_json)
        self.assertNotIn("askingPrice", canonical_json)

    def test_fixture_provider_returns_empty_result_normally(self) -> None:
        request = make_request(year=1999, make="Missing", model="Vehicle")

        result = discover_market_listings(request, self.provider)

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(result.listings, ())

    def test_fixture_provider_applies_result_limit(self) -> None:
        result = discover_market_listings(
            make_request(result_limit=1), self.provider
        )

        self.assertEqual(result.listing_count, 1)

    def test_fixture_provider_is_deterministic(self) -> None:
        request = make_request()

        first = discover_market_listings(request, self.provider)
        second = discover_market_listings(request, self.provider)

        self.assertEqual(first, second)
        self.assertEqual(first.to_dict(), second.to_dict())

    def test_fixture_provider_rejects_unmarked_fixture_document(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "fixture.json"
            path.write_text(json.dumps({"records": []}), encoding="utf-8")

            with self.assertRaises(MarketProviderResponseError) as raised:
                FixtureMarketProvider.from_file(path)
        self.assertTrue(
            any("syntheticData" in detail for detail in raised.exception.details)
        )

    def test_fixture_normalization_failure_uses_neutral_error(self) -> None:
        provider = FixtureMarketProvider(
            [
                {
                    "vehicle": {
                        "modelYear": 2025,
                        "manufacturer": "Toyota",
                        "modelName": "Camry",
                    },
                    "askingPrice": -1,
                }
            ]
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("price" in detail for detail in raised.exception.details))

    def test_call_for_price_is_rejected_instead_of_becoming_zero(self) -> None:
        provider = FixtureMarketProvider(
            [
                {
                    "vehicle": {
                        "modelYear": 2025,
                        "manufacturer": "Toyota",
                        "modelName": "Camry",
                    },
                    "askingPrice": "Call for price",
                }
            ]
        )

        with self.assertRaises(MarketProviderResponseError):
            discover_market_listings(make_request(), provider)


class DiscoveryServiceTests(unittest.TestCase):
    def test_result_snapshots_any_mutable_listing_sequence(self) -> None:
        source_listings = UserList([make_listing()])
        result = MarketSearchResult(
            provider="test-provider",
            request=make_request(),
            listings=source_listings,
        )

        source_listings.clear()

        self.assertIsInstance(result.listings, tuple)
        self.assertEqual(result.listing_count, 1)

    def test_valid_request_reaches_provider_and_returns_multiple_results(self) -> None:
        listings = (
            make_listing(source_listing_id="listing-001"),
            make_listing(source_listing_id="listing-002", price=31000),
        )
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider", request=request, listings=listings
            )
        )
        request = make_request()

        result = discover_market_listings(request, provider)

        self.assertEqual(provider.requests, [request])
        self.assertIsNot(provider.requests[0], request)
        self.assertEqual(result.listing_count, 2)
        self.assertEqual(result.listings, listings)

    def test_invalid_request_is_rejected_before_provider_call(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider", request=request, listings=()
            )
        )

        with self.assertRaises(MarketContractError):
            discover_market_listings(make_request(result_limit=0), provider)
        self.assertEqual(provider.requests, [])

    def test_input_is_not_mutated(self) -> None:
        request = make_request()
        before = copy.deepcopy(request.to_dict())
        provider = StaticMarketProvider(
            lambda normalized: MarketSearchResult(
                provider="test-provider", request=normalized, listings=()
            )
        )

        discover_market_listings(request, provider)

        self.assertEqual(request.to_dict(), before)

    def test_empty_provider_result_is_returned(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider", request=request, listings=()
            )
        )

        result = discover_market_listings(make_request(), provider)

        self.assertEqual(result.to_dict()["listingCount"], 0)
        self.assertEqual(result.to_dict()["listings"], [])

    def test_invalid_provider_return_type_is_rejected(self) -> None:
        provider = StaticMarketProvider(lambda request: {"listings": []})

        with self.assertRaises(MarketProviderResponseError):
            discover_market_listings(make_request(), provider)

    def test_invalid_normalized_listing_is_rejected(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider",
                request=request,
                listings=(make_listing(price=-1),),
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("price" in detail for detail in raised.exception.details))

    def test_provider_neutral_failure_is_preserved(self) -> None:
        error = MarketProviderRateLimitError("try again later")

        def fail(request: MarketSearchRequest) -> MarketSearchResult:
            raise error

        provider = StaticMarketProvider(fail)

        with self.assertRaises(MarketProviderRateLimitError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertIs(raised.exception, error)

    def test_unclassified_provider_failure_is_wrapped(self) -> None:
        def fail(request: MarketSearchRequest) -> MarketSearchResult:
            raise RuntimeError("provider-specific internal failure")

        provider = StaticMarketProvider(fail)

        with self.assertRaises(MarketProviderError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertIsInstance(raised.exception.__cause__, RuntimeError)

    def test_provider_name_failure_is_wrapped(self) -> None:
        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), RaisingNameProvider())
        self.assertIsInstance(raised.exception.__cause__, RuntimeError)

    def test_provider_contract_failure_preserves_validation_details(self) -> None:
        error = MarketContractError(
            "adapter normalization failed", ("$.price: required",)
        )

        def fail(request: MarketSearchRequest) -> MarketSearchResult:
            raise error

        provider = StaticMarketProvider(fail)

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertEqual(raised.exception.details, error.details)
        self.assertIs(raised.exception.__cause__, error)

    def test_provider_name_must_match_result(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="different-provider", request=request, listings=()
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("provider" in detail for detail in raised.exception.details))

    def test_result_must_echo_normalized_request(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider",
                request=make_request(year=2024),
                listings=(),
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("request" in detail for detail in raised.exception.details))

    def test_listing_source_must_match_provider(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider",
                request=request,
                listings=(make_listing(source="other-provider"),),
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("source" in detail for detail in raised.exception.details))


class MarketIdentityTests(unittest.TestCase):
    def test_vin_may_be_absent(self) -> None:
        listing = make_listing(vin=None)

        validate_market_listing(listing)
        self.assertIsNone(listing.vin)

    def test_source_listing_id_may_be_absent(self) -> None:
        listing = make_listing(source_listing_id=None)

        validate_market_listing(listing)
        self.assertIsNone(listing.source_listing_id)

    def test_duplicate_same_provider_listing_id_is_rejected(self) -> None:
        provider = StaticMarketProvider(
            lambda request: MarketSearchResult(
                provider="test-provider",
                request=request,
                listings=(make_listing(), make_listing(price=31000)),
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_market_listings(make_request(), provider)
        self.assertTrue(any("duplicate" in detail for detail in raised.exception.details))

    def test_same_vin_from_different_providers_is_not_deduplicated(self) -> None:
        shared_vin = "SYNTHETIC-SHARED-VIN"

        def provider_named(name: str) -> StaticMarketProvider:
            return StaticMarketProvider(
                lambda request: MarketSearchResult(
                    provider=name,
                    request=request,
                    listings=(
                        make_listing(
                            source=name,
                            source_listing_id=f"{name}-001",
                            vin=shared_vin,
                        ),
                    ),
                ),
                name=name,
            )

        first = discover_market_listings(
            make_request(), provider_named("provider-one")
        )
        second = discover_market_listings(
            make_request(), provider_named("provider-two")
        )

        self.assertEqual(first.listing_count, 1)
        self.assertEqual(second.listing_count, 1)
        self.assertEqual(first.listings[0].vin, second.listings[0].vin)


class MarketNormalizationTests(unittest.TestCase):
    def test_configuration_field_keeps_existing_positional_arguments_stable(
        self,
    ) -> None:
        request = MarketSearchRequest(
            2025,
            "Toyota",
            "Camry",
            "SE",
            7_192,
            "63123",
            75,
            12,
        )

        self.assertEqual(request.loss_vehicle_mileage, 7_192)
        self.assertEqual(request.postal_code, "63123")
        self.assertEqual(request.radius_miles, 75)
        self.assertEqual(request.result_limit, 12)
        self.assertIsNone(request.configuration)

    def test_surrounding_whitespace_and_safe_state_are_normalized(self) -> None:
        request = MarketSearchRequest(2025, " Toyota ", " Camry ", " SE ")
        listing = make_listing(
            make=" Toyota ",
            model=" Camry ",
            trim=" SE ",
            dealer=MarketDealer(
                name=" Dealer ",
                city=" St. Louis ",
                state=" mo ",
                postal_code=" 63123 ",
            ),
        )

        self.assertEqual((request.make, request.model, request.trim), ("Toyota", "Camry", "SE"))
        self.assertEqual((listing.make, listing.model, listing.trim), ("Toyota", "Camry", "SE"))
        self.assertEqual(listing.dealer.state, "MO")
        self.assertEqual(listing.dealer.postal_code, "63123")

    def test_null_remains_null_and_blank_optional_text_becomes_null(self) -> None:
        listing = make_listing(
            source_listing_id="   ",
            listing_url=None,
            trim=" ",
            vin=None,
            mileage=None,
            dealer=None,
            distance_miles=None,
        )

        self.assertIsNone(listing.source_listing_id)
        self.assertIsNone(listing.trim)
        self.assertIsNone(listing.mileage)
        self.assertIsNone(listing.distance_miles)

    def test_price_and_mileage_remain_exact_numeric_values(self) -> None:
        listing = make_listing(price=31450.75, mileage=12345)

        self.assertEqual(listing.price, 31450.75)
        self.assertIsInstance(listing.price, float)
        self.assertEqual(listing.mileage, 12345)
        self.assertIsInstance(listing.mileage, int)

    def test_missing_values_are_not_guessed(self) -> None:
        listing = make_listing(
            trim=None,
            vin=None,
            mileage=None,
            dealer=None,
            distance_miles=None,
        )

        canonical = listing.to_dict()
        for field in ("trim", "vin", "mileage", "dealer", "distanceMiles"):
            self.assertIsNone(canonical[field])


if __name__ == "__main__":
    unittest.main()
