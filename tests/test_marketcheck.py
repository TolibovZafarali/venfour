"""Offline tests for the live MarketCheck provider adapter."""

from __future__ import annotations

import copy
import io
import json
import os
import traceback
import unittest
from collections.abc import Mapping
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from scripts import search_marketcheck
from venfour.adaptive_search import (
    CURRENT_SEARCH_CEILING_REACHED,
    MAX_SCOPE_REACHED,
    adaptive_discover_market_listings,
)
from venfour.market import (
    MarketContractError,
    MarketProvider,
    MarketProviderAuthenticationError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    VehicleConfigurationIdentity,
    discover_market_listings,
)
from venfour.marketcheck import (
    MARKETCHECK_ACTIVE_INVENTORY_URL,
    MARKETCHECK_ACTIVE_MAX_RADIUS_MILES,
    MARKETCHECK_CAR_TERMS_URL,
    MarketCheckProvider,
)
from venfour.vehicle_catalog import VehicleTrimCatalogRequest


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = (
    REPO_ROOT / "tests" / "fixtures" / "market" / "marketcheck-response.json"
)
SYNTHETIC_KEY = "synthetic-secret-key-for-tests"


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


def make_raw_listing(index: int = 0, **overrides: Any) -> dict[str, Any]:
    listing: dict[str, Any] = {
        "id": f"synthetic-listing-{index:03d}",
        "vin": f"SYNTHETIC-VIN-{index:03d}",
        "price": 30000 + index,
        "miles": 10000 + index,
        "vdp_url": f"https://dealer.invalid/vehicles/{index}",
        "source": "raw-dealer-domain.invalid",
        "dealer": {
            "name": f"Synthetic Dealer {index}",
            "city": "St. Louis",
            "state": "MO",
            "zip": "63123",
        },
        "build": {
            "year": 2025,
            "make": "Toyota",
            "model": "Camry",
            "trim": "SE",
        },
        "dist": index + 0.5,
    }
    listing.update(overrides)
    return listing


def make_page(start: int, count: int, total: int | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "listings": [make_raw_listing(index) for index in range(start, start + count)]
    }
    if total is not None:
        payload["num_found"] = total
    return payload


class RecordingTransport:
    """Queue-backed transport that never performs network access."""

    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []

    def get(
        self,
        endpoint: str,
        params: Mapping[str, str | int],
        headers: Mapping[str, str],
        timeout: float,
    ) -> bytes:
        self.calls.append(
            {
                "endpoint": endpoint,
                "params": dict(params),
                "headers": dict(headers),
                "timeout": timeout,
            }
        )
        if not self.outcomes:
            raise AssertionError("Unexpected MarketCheck transport call")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        if isinstance(outcome, bytes):
            return outcome
        return json.dumps(outcome, allow_nan=True).encode("utf-8")


def search_with(
    outcomes: list[Any],
    request: MarketSearchRequest | None = None,
    *,
    api_key: str = SYNTHETIC_KEY,
) -> tuple[Any, RecordingTransport]:
    transport = RecordingTransport(outcomes)
    provider = MarketCheckProvider(api_key, transport=transport)
    result = discover_market_listings(request or make_request(), provider)
    return result, transport


class MarketCheckConstructionTests(unittest.TestCase):
    def test_provider_satisfies_market_provider_protocol(self) -> None:
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport([{"num_found": 0, "listings": []}]),
        )

        self.assertIsInstance(provider, MarketProvider)
        self.assertEqual(provider.name, "marketcheck")
        self.assertEqual(
            provider.maximum_search_radius_miles,
            MARKETCHECK_ACTIVE_MAX_RADIUS_MILES,
        )

    def test_missing_or_blank_api_key_is_rejected(self) -> None:
        for value in (None, "", "   ", 123):
            with self.subTest(value=value), self.assertRaises(
                MarketProviderAuthenticationError
            ):
                MarketCheckProvider(value)  # type: ignore[arg-type]

    def test_provider_repr_does_not_expose_api_key(self) -> None:
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport([]),
        )

        self.assertNotIn(SYNTHETIC_KEY, repr(provider))
        self.assertNotIn(SYNTHETIC_KEY, str(provider))

    def test_invalid_timeout_is_rejected(self) -> None:
        for value in (0, -1, float("nan"), float("inf"), True, "15"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                MarketCheckProvider(
                    SYNTHETIC_KEY, timeout=value  # type: ignore[arg-type]
                )

    def test_invalid_declared_maximum_radius_is_rejected(self) -> None:
        for value in (-1, True, 100.0, "100"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                MarketCheckProvider(
                    SYNTHETIC_KEY,
                    maximum_search_radius_miles=value,  # type: ignore[arg-type]
                )

    def test_effective_subscription_ceiling_never_attempts_200(self) -> None:
        transport = RecordingTransport(
            [
                {"num_found": 0, "listings": []},
                {"num_found": 0, "listings": []},
            ]
        )
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)

        adaptive = adaptive_discover_market_listings(make_request(), provider)

        self.assertEqual(
            [call["params"]["radius"] for call in transport.calls],
            [50, 100],
        )
        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            CURRENT_SEARCH_CEILING_REACHED,
        )

    def test_higher_capability_configuration_can_use_200_and_250(self) -> None:
        transport = RecordingTransport(
            [{"num_found": 0, "listings": []} for _ in range(4)]
        )
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=transport,
            maximum_search_radius_miles=250,
        )

        adaptive = adaptive_discover_market_listings(make_request(), provider)

        self.assertEqual(
            [call["params"]["radius"] for call in transport.calls],
            [50, 100, 200, 250],
        )
        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)

    def test_falsy_injected_transport_is_still_used(self) -> None:
        class FalsyTransport(RecordingTransport):
            def __bool__(self) -> bool:
                return False

        transport = FalsyTransport([{"num_found": 0, "listings": []}])
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)

        result = discover_market_listings(make_request(), provider)

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(len(transport.calls), 1)


class MarketCheckRequestMappingTests(unittest.TestCase):
    def test_full_request_maps_exactly_to_marketcheck_parameters(self) -> None:
        _, transport = search_with([{"num_found": 0, "listings": []}])

        self.assertEqual(len(transport.calls), 1)
        call = transport.calls[0]
        self.assertEqual(call["endpoint"], MARKETCHECK_ACTIVE_INVENTORY_URL)
        self.assertEqual(call["headers"], {"Accept": "application/json"})
        self.assertEqual(call["timeout"], 15.0)
        self.assertEqual(
            call["params"],
            {
                "api_key": SYNTHETIC_KEY,
                "append_api_key": "false",
                "car_type": "used",
                "year": 2025,
                "make": "Toyota",
                "model": "Camry",
                "has_price": "true",
                "start": 0,
                "rows": 25,
                "trim": "SE",
                "zip": "63123",
                "radius": 50,
            },
        )
        self.assertNotIn("miles", call["params"])
        self.assertNotIn("mileage", call["params"])
        self.assertNotIn("miles_range", call["params"])

    def test_optional_trim_is_omitted(self) -> None:
        _, transport = search_with(
            [{"num_found": 0, "listings": []}],
            make_request(trim=None),
        )

        self.assertNotIn("trim", transport.calls[0]["params"])

    def test_zip_and_radius_are_omitted_without_location(self) -> None:
        _, transport = search_with(
            [{"num_found": 0, "listings": []}],
            make_request(postal_code=None, radius_miles=500),
        )

        params = transport.calls[0]["params"]
        self.assertNotIn("zip", params)
        self.assertNotIn("radius", params)

    def test_exact_trim_zero_results_does_not_broaden_search(self) -> None:
        result, transport = search_with([{"num_found": 0, "listings": []}])

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(transport.calls[0]["params"]["trim"], "SE")

    def test_default_transport_encodes_key_and_uses_https_get(self) -> None:
        injected_key = "synthetic&append_api_key=true value"

        class FakeResponse:
            def __enter__(self) -> FakeResponse:
                return self

            def __exit__(self, *args: Any) -> None:
                return None

            def read(self) -> bytes:
                return b'{"num_found": 0, "listings": []}'

        class FakeOpener:
            def __init__(self) -> None:
                self.requests: list[Any] = []
                self.timeouts: list[float] = []

            def open(self, request: Any, *, timeout: float) -> FakeResponse:
                self.requests.append(request)
                self.timeouts.append(timeout)
                return FakeResponse()

        opener = FakeOpener()
        with patch("venfour.marketcheck.build_opener", return_value=opener):
            provider = MarketCheckProvider(injected_key, timeout=7.5)
            result = discover_market_listings(make_request(), provider)

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(len(opener.requests), 1)
        request = opener.requests[0]
        parsed = urlsplit(request.full_url)
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(opener.timeouts, [7.5])
        self.assertEqual(query["api_key"], [injected_key])
        self.assertEqual(query["append_api_key"], ["false"])


class MarketCheckTrimCatalogTests(unittest.TestCase):
    def test_maps_exact_vehicle_to_cached_version_configuration_options(
        self,
    ) -> None:
        transport = RecordingTransport(
            [
                {
                    "trim": [
                        "Long Range",
                        "Long Range Battery",
                        "Performance",
                    ],
                    "version": [
                        "Long Range Battery",
                        "Long Range",
                        "Long Range AWD Dual Motor",
                        "Dual Motor All-Wheel Drive Long Range",
                        "Performance AWD Dual Motor",
                    ],
                    "fuel_type": ["Electric"],
                }
            ]
        )
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)

        first = provider.list_trims(
            VehicleTrimCatalogRequest(2019, "Tesla", "Model 3")
        )
        second = provider.list_trims(
            VehicleTrimCatalogRequest(2019, "tesla", "model 3")
        )

        self.assertEqual(
            [option.label for option in first],
            [
                "Long Range",
                "Long Range Dual Motor AWD",
                "Performance (configuration not specified)",
                "Performance Dual Motor AWD",
            ],
        )
        self.assertEqual(
            first[0].query_values,
            ("Long Range", "Long Range Battery"),
        )
        self.assertEqual(first[0].source, "marketcheck")
        self.assertEqual(first[0].query_field, "version")
        self.assertEqual(first[1].query_field, "version")
        self.assertEqual(first[2].query_field, "trim")
        self.assertEqual(first[3].query_field, "version")
        self.assertIs(second, first)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(transport.calls[0]["endpoint"], MARKETCHECK_CAR_TERMS_URL)
        self.assertEqual(
            transport.calls[0]["params"],
            {
                "api_key": SYNTHETIC_KEY,
                "append_api_key": "false",
                "field": "trim|0|1000,version|0|1000,fuel_type|0|1000",
                "year": 2019,
                "make": "Tesla",
                "model": "Model 3",
            },
        )

    def test_falls_back_conservatively_when_optional_versions_are_malformed(
        self,
    ) -> None:
        malformed_versions = (
            None,
            "XLE AWD",
            ["XLE AWD", 10],
            [" "],
            ["XLE, AWD"],
            [SYNTHETIC_KEY],
        )
        for versions in malformed_versions:
            with self.subTest(versions=versions):
                payload: dict[str, Any] = {
                    "trim": [
                        " XLE ",
                        "xle",
                        "XLE All Wheel Drive",
                        "XLE AWD",
                    ]
                }
                if versions is not None:
                    payload["version"] = versions
                transport = RecordingTransport([payload])
                provider = MarketCheckProvider(
                    SYNTHETIC_KEY,
                    transport=transport,
                )

                options = provider.list_trims(
                    VehicleTrimCatalogRequest(2020, "Toyota", "Camry")
                )

                self.assertEqual(
                    [option.label for option in options],
                    ["XLE", "XLE AWD"],
                )
                self.assertTrue(
                    all(option.query_field == "trim" for option in options)
                )
                self.assertEqual(len(transport.calls), 1)

    def test_retains_trims_not_covered_by_a_partial_version_facet(self) -> None:
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport(
                [
                    {
                        "trim": ["LE", "XLE"],
                        "version": ["LE FWD"],
                    }
                ]
            ),
        )

        options = provider.list_trims(
            VehicleTrimCatalogRequest(2024, "Toyota", "Camry")
        )

        self.assertEqual(
            [(option.label, option.query_field) for option in options],
            [
                ("LE (configuration not specified)", "trim"),
                ("LE FWD", "version"),
                ("XLE", "trim"),
            ],
        )

    def test_does_not_treat_battery_as_redundant_for_a_mixed_powertrain(
        self,
    ) -> None:
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport(
                [
                    {
                        "trim": ["Long Range", "Long Range Battery"],
                        "version": ["Long Range", "Long Range Battery"],
                        "fuel_type": ["Electric / Unleaded"],
                    }
                ]
            ),
        )

        options = provider.list_trims(
            VehicleTrimCatalogRequest(2024, "Example", "PHEV")
        )

        self.assertEqual(
            [option.label for option in options],
            ["Long Range", "Long Range Battery"],
        )
        self.assertTrue(
            all(option.query_field == "version" for option in options)
        )

    def test_rejects_malformed_or_secret_bearing_required_trims(self) -> None:
        for payload in (
            {},
            {"terms": "XLE"},
            {"trim": "XLE", "version": ["XLE AWD"]},
            {"trim": ["XLE", 10], "version": ["XLE AWD"]},
            {"trim": [" "], "version": ["XLE AWD"]},
            {"trim": ["XLE, AWD"], "version": ["XLE AWD"]},
            {"trim": [SYNTHETIC_KEY], "version": ["XLE AWD"]},
        ):
            with self.subTest(payload=payload):
                provider = MarketCheckProvider(
                    SYNTHETIC_KEY,
                    transport=RecordingTransport([payload]),
                )
                with self.assertRaises(MarketProviderResponseError) as raised:
                    provider.list_trims(
                        VehicleTrimCatalogRequest(2020, "Toyota", "Camry")
                    )
                self.assertNotIn(SYNTHETIC_KEY, str(raised.exception))

    def test_rejects_a_configuration_with_too_many_raw_version_aliases(
        self,
    ) -> None:
        separators = (
            "-",
            "/",
            ".",
            ":",
            ";",
            "|",
            "~",
            "!",
            "?",
            "@",
            "#",
            "$",
            "%",
            "^",
            "&",
            "*",
            "_",
            "'",
            '"',
            "(",
            "[",
        )
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport(
                [
                    {
                        "trim": ["Long Range"],
                        "version": [
                            f"Long{separator}Range Dual Motor AWD"
                            for separator in separators
                        ],
                    }
                ]
            ),
        )

        with self.assertRaises(MarketProviderResponseError):
            provider.list_trims(
                VehicleTrimCatalogRequest(2019, "Tesla", "Model 3")
            )


class MarketCheckNormalizationTests(unittest.TestCase):
    def test_configuration_queries_raw_versions_and_keeps_canonical_trim(
        self,
    ) -> None:
        request = make_request(
            trim="Long Range Dual Motor AWD",
            configuration=VehicleConfigurationIdentity(
                source="marketcheck",
                field="version",
                values=(
                    "Dual Motor All-Whel Drive Long Range",
                    "Long Range AWD Dual Motor",
                ),
            ),
            result_limit=1,
        )
        result, transport = search_with(
            [
                {
                    "num_found": 1,
                    "listings": [
                        make_raw_listing(
                            build={
                                "year": 2025,
                                "make": "Toyota",
                                "model": "Camry",
                                "trim": "Long Range Battery",
                                "version": "Dual Motor All-Whel Drive Long Range",
                            }
                        )
                    ],
                }
            ],
            request,
        )

        self.assertEqual(
            transport.calls[0]["params"]["version"],
            "Dual Motor All-Whel Drive Long Range,Long Range AWD Dual Motor",
        )
        self.assertNotIn("trim", transport.calls[0]["params"])
        self.assertEqual(
            result.listings[0].trim,
            "Long Range Dual Motor AWD",
        )
        self.assertEqual(result.request.configuration, request.configuration)

    def test_configuration_does_not_relabel_an_unmatched_provider_result(
        self,
    ) -> None:
        request = make_request(
            trim="Long Range Dual Motor AWD",
            configuration=VehicleConfigurationIdentity(
                source="marketcheck",
                field="version",
                values=("Long Range AWD Dual Motor",),
            ),
            result_limit=1,
        )
        result, _ = search_with(
            [
                {
                    "num_found": 1,
                    "listings": [
                        make_raw_listing(
                            build={
                                "year": 2025,
                                "make": "Toyota",
                                "model": "Camry",
                                "trim": "Long Range Battery",
                                "version": "Long Range RWD",
                            }
                        )
                    ],
                }
            ],
            request,
        )

        self.assertEqual(result.listings[0].trim, "Long Range Battery")

    def test_rejects_configuration_from_another_provider(self) -> None:
        request = make_request(
            configuration=VehicleConfigurationIdentity(
                source="other-provider",
                field="version",
                values=("SE FWD",),
            )
        )
        transport = RecordingTransport([])
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)

        with self.assertRaises(MarketContractError):
            provider.search(request)

        self.assertEqual(transport.calls, [])

    def test_sanitized_fixture_normalizes_all_canonical_fields(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, _ = search_with(
            [payload],
            make_request(trim=None, result_limit=3),
        )

        self.assertEqual(result.provider, "marketcheck")
        self.assertEqual(result.listing_count, 3)
        self.assertEqual(
            result.listings[0].to_dict(),
            {
                "source": "marketcheck",
                "sourceListingId": "synthetic-mc-camry-se-001",
                "listingUrl": "https://dealer-one.invalid/vehicles/camry-se-001",
                "year": 2025,
                "make": "Toyota",
                "model": "Camry",
                "trim": "SE",
                "vin": "SYNTHETIC-CAMRY-SE-001",
                "mileage": 36536,
                "price": 30564,
                "dealer": {
                    "name": "Synthetic Toyota One",
                    "city": "St. Louis",
                    "state": "MO",
                    "postalCode": "63128",
                },
                "distanceMiles": 2.45,
            },
        )
        self.assertEqual(
            [listing.source_listing_id for listing in result.listings],
            [
                "synthetic-mc-camry-se-001",
                "synthetic-mc-camry-le-002",
                None,
            ],
        )

    def test_raw_source_domain_never_becomes_canonical_source(self) -> None:
        raw = make_raw_listing(source="provider-dealer-domain.invalid")

        result, _ = search_with(
            [{"num_found": 1, "listings": [raw]}],
            make_request(result_limit=1),
        )

        self.assertEqual(result.provider, "marketcheck")
        self.assertEqual(result.listings[0].source, "marketcheck")

    def test_missing_optional_fields_become_canonical_nulls(self) -> None:
        raw = {
            "price": 27995,
            "build": {"year": 2025, "make": "Toyota", "model": "Camry"},
        }

        result, _ = search_with(
            [{"num_found": 1, "listings": [raw]}],
            make_request(result_limit=1),
        )

        listing = result.listings[0].to_dict()
        for field in (
            "sourceListingId",
            "listingUrl",
            "trim",
            "vin",
            "mileage",
            "dealer",
            "distanceMiles",
        ):
            self.assertIsNone(listing[field])

    def test_partial_dealer_preserves_only_supplied_fields(self) -> None:
        raw = make_raw_listing(dealer={"name": "Only A Name"})

        result, _ = search_with(
            [{"num_found": 1, "listings": [raw]}],
            make_request(result_limit=1),
        )

        self.assertEqual(
            result.listings[0].dealer.to_dict(),
            {
                "name": "Only A Name",
                "city": None,
                "state": None,
                "postalCode": None,
            },
        )

    def test_noncanonical_and_secret_bearing_fields_are_ignored(self) -> None:
        raw = make_raw_listing(
            source=f"raw-{SYNTHETIC_KEY}.invalid",
            heading=f"ignored {SYNTHETIC_KEY}",
            media={
                "photo_links_cached": [
                    f"https://images.invalid/photo?credential={SYNTHETIC_KEY}"
                ]
            },
            finance={"token": SYNTHETIC_KEY},
            carfax_1_owner=True,
        )
        raw["dealer"]["id"] = SYNTHETIC_KEY
        raw["build"]["version"] = SYNTHETIC_KEY

        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result, _ = search_with(
                [{"num_found": 1, "listings": [raw]}],
                make_request(result_limit=1),
            )

        serialized = json.dumps(result.to_dict(), sort_keys=True)
        self.assertNotIn(SYNTHETIC_KEY, serialized)
        self.assertNotIn("media", serialized)
        self.assertNotIn("finance", serialized)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")

    def test_secret_in_retained_field_rejects_response(self) -> None:
        raw = make_raw_listing(
            vdp_url=f"https://dealer.invalid/?credential={SYNTHETIC_KEY}"
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with(
                [{"num_found": 1, "listings": [raw]}],
                make_request(result_limit=1),
            )

        self.assertNotIn(SYNTHETIC_KEY, str(raised.exception))
        self.assertEqual(raised.exception.details, ())

    def test_any_api_key_parameter_in_retained_url_is_rejected(self) -> None:
        unsafe_urls = (
            "https://dealer.invalid/?api_key=old-revoked-key",
            "https://dealer.invalid/?API_KEY=other-key",
            "https://dealer.invalid/?api%5fkey=abc%2fDEF",
        )
        for url in unsafe_urls:
            with self.subTest(url=url), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with(
                    [
                        {
                            "num_found": 1,
                            "listings": [make_raw_listing(vdp_url=url)],
                        }
                    ],
                    make_request(result_limit=1),
                )

    def test_required_fields_are_never_backfilled_from_request(self) -> None:
        cases: dict[str, dict[str, Any]] = {}
        missing_build = make_raw_listing()
        missing_build.pop("build")
        cases["build"] = missing_build
        for field in ("year", "make", "model"):
            raw = make_raw_listing()
            raw["build"] = dict(raw["build"])
            raw["build"].pop(field)
            cases[field] = raw
        missing_price = make_raw_listing()
        missing_price.pop("price")
        cases["price"] = missing_price

        for name, raw in cases.items():
            with self.subTest(field=name), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with(
                    [{"num_found": 1, "listings": [raw]}],
                    make_request(result_limit=1),
                )

    def test_malformed_prices_are_rejected_without_coercion(self) -> None:
        for price in (None, "Call for price", -1, True, float("nan"), float("inf")):
            with self.subTest(price=price), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with(
                    [
                        {
                            "num_found": 1,
                            "listings": [make_raw_listing(price=price)],
                        }
                    ],
                    make_request(result_limit=1),
                )

    def test_present_but_malformed_optional_fields_are_rejected(self) -> None:
        malformed_values = (
            {"miles": "10000"},
            {"miles": -1},
            {"dist": -1},
            {"dealer": "not-an-object"},
            {"id": 123},
            {"vdp_url": 123},
        )
        for override in malformed_values:
            with self.subTest(override=override), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with(
                    [
                        {
                            "num_found": 1,
                            "listings": [make_raw_listing(**override)],
                        }
                    ],
                    make_request(result_limit=1),
                )

    def test_one_malformed_listing_invalidates_whole_response(self) -> None:
        malformed = make_raw_listing(1)
        malformed.pop("price")

        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [
                    {
                        "num_found": 2,
                        "listings": [make_raw_listing(0), malformed],
                    }
                ],
                make_request(result_limit=2),
            )

    def test_validation_details_and_traceback_redact_api_key(self) -> None:
        raw = make_raw_listing(price=SYNTHETIC_KEY)

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with(
                [{"num_found": 1, "listings": [raw]}],
                make_request(result_limit=1),
            )

        error = raised.exception
        rendered = "".join(traceback.format_exception(error))
        values = [str(error), repr(error), *error.details, rendered]
        self.assertTrue(error.details)
        self.assertTrue(all(SYNTHETIC_KEY not in value for value in values))
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)


class MarketCheckResponseShapeTests(unittest.TestCase):
    def test_empty_results_are_valid(self) -> None:
        result, _ = search_with([{"num_found": 0, "listings": []}])

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(result.to_dict()["listings"], [])

    def test_top_level_response_must_be_object(self) -> None:
        for payload in (None, [], "response", 1):
            with self.subTest(payload=payload), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([payload])

    def test_listings_must_be_a_present_array(self) -> None:
        for payload in (
            {"num_found": 0},
            {"num_found": 0, "listings": None},
            {"num_found": 0, "listings": {}},
            {"num_found": 0, "listings": "none"},
        ):
            with self.subTest(payload=payload), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([payload])

    def test_each_listing_must_be_an_object(self) -> None:
        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with(
                [{"num_found": 1, "listings": ["not-an-object"]}],
                make_request(result_limit=1),
            )

        self.assertTrue(
            any("$.listings[0]" in detail for detail in raised.exception.details)
        )

    def test_num_found_must_be_reasonable_when_present(self) -> None:
        for value in (-1, "1", True, 1.5, None):
            with self.subTest(value=value), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([{"num_found": value, "listings": []}])

    def test_num_found_may_be_absent(self) -> None:
        result, _ = search_with(
            [{"listings": [make_raw_listing()]}],
            make_request(result_limit=1),
        )

        self.assertEqual(result.listing_count, 1)

    def test_num_found_cannot_be_smaller_than_returned_page_range(self) -> None:
        for payload in (
            {"num_found": 0, "listings": [make_raw_listing()]},
            {"num_found": 1, "listings": [make_raw_listing(0), make_raw_listing(1)]},
        ):
            with self.subTest(payload=payload), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([payload], make_request(result_limit=2))

    def test_provider_cannot_return_more_records_than_requested_rows(self) -> None:
        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [
                    {
                        "num_found": 2,
                        "listings": [make_raw_listing(0), make_raw_listing(1)],
                    }
                ],
                make_request(result_limit=1),
            )

    def test_short_page_cannot_claim_additional_unreturned_matches(self) -> None:
        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [{"num_found": 10, "listings": [make_raw_listing()]}],
                make_request(result_limit=5),
            )

    def test_malformed_json_invalid_utf8_and_nonstandard_numbers_are_rejected(self) -> None:
        for body in (
            b"{not-json",
            b"\xff\xfe",
            b'{"num_found": NaN, "listings": []}',
            (b"[" * 2000) + (b"]" * 2000),
        ):
            with self.subTest(body=body), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([body])

    def test_non_bytes_transport_response_is_rejected(self) -> None:
        class InvalidTransport:
            def get(self, *args: Any, **kwargs: Any) -> str:
                return '{"num_found": 0, "listings": []}'

        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=InvalidTransport())
        with self.assertRaises(MarketProviderResponseError):
            discover_market_listings(make_request(), provider)


class MarketCheckErrorMappingTests(unittest.TestCase):
    @staticmethod
    def http_error(status: int) -> HTTPError:
        url = f"{MARKETCHECK_ACTIVE_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        body = io.BytesIO(f'{{"message": "{SYNTHETIC_KEY}"}}'.encode())
        return HTTPError(url, status, "provider failure", {}, body)

    def test_authentication_statuses_map_to_neutral_error(self) -> None:
        for status in (401, 403):
            with self.subTest(status=status), self.assertRaises(
                MarketProviderAuthenticationError
            ):
                search_with([self.http_error(status)])

    def test_rate_limit_status_maps_to_neutral_error(self) -> None:
        with self.assertRaises(MarketProviderRateLimitError):
            search_with([self.http_error(429)])

    def test_unavailable_statuses_map_to_neutral_error(self) -> None:
        for status in (408, 500, 502, 503):
            with self.subTest(status=status), self.assertRaises(
                MarketProviderUnavailableError
            ):
                search_with([self.http_error(status)])

    def test_other_http_failures_map_to_response_error(self) -> None:
        for status in (302, 400, 404, 422):
            with self.subTest(status=status), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([self.http_error(status)])

    def test_http_failure_retains_only_allowlisted_active_request_context(self) -> None:
        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([self.http_error(422)])

        self.assertEqual(
            raised.exception.diagnostic.to_dict(),
            {
                "endpointCategory": "active",
                "httpStatus": 422,
                "radius": 50,
                "start": 0,
                "rows": 25,
            },
        )
        rendered = json.dumps(raised.exception.diagnostic.to_dict())
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(MARKETCHECK_ACTIVE_INVENTORY_URL, rendered)

    def test_network_failures_map_without_retry(self) -> None:
        failures = (
            TimeoutError("timed out"),
            ConnectionRefusedError("refused"),
            URLError("DNS failure"),
            RuntimeError("unexpected transport failure"),
        )
        for failure in failures:
            transport = RecordingTransport([failure])
            provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
            with self.subTest(failure=failure), self.assertRaises(
                MarketProviderUnavailableError
            ):
                discover_market_listings(make_request(), provider)
            self.assertEqual(len(transport.calls), 1)

    def test_transport_error_does_not_retain_authenticated_url_or_key(self) -> None:
        authenticated_url = (
            f"{MARKETCHECK_ACTIVE_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        failure = URLError(f"failed to open {authenticated_url}")

        with self.assertRaises(MarketProviderUnavailableError) as raised:
            search_with([failure])

        error = raised.exception
        rendered = "".join(traceback.format_exception(error))
        for value in (str(error), repr(error), rendered):
            self.assertNotIn(SYNTHETIC_KEY, value)
            self.assertNotIn(authenticated_url, value)
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)

    def test_http_error_body_and_url_are_not_exposed(self) -> None:
        http_error = self.http_error(401)
        with self.assertRaises(MarketProviderAuthenticationError) as raised:
            search_with([http_error])

        error = raised.exception
        rendered = "".join(traceback.format_exception(error))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)
        self.assertTrue(http_error.fp.closed)


class MarketCheckPaginationTests(unittest.TestCase):
    def test_one_page_uses_result_limit_for_rows(self) -> None:
        result, transport = search_with(
            [make_page(0, 3, 3)],
            make_request(result_limit=25),
        )

        self.assertEqual(result.listing_count, 3)
        self.assertEqual(
            (transport.calls[0]["params"]["start"], transport.calls[0]["params"]["rows"]),
            (0, 25),
        )

    def test_exact_fifty_does_not_request_extra_page(self) -> None:
        result, transport = search_with(
            [make_page(0, 50, 100)],
            make_request(result_limit=50),
        )

        self.assertEqual(result.listing_count, 50)
        self.assertEqual(len(transport.calls), 1)

    def test_multiple_pages_cap_rows_and_advance_offsets(self) -> None:
        result, transport = search_with(
            [
                make_page(0, 50, 120),
                make_page(50, 50, 120),
                make_page(100, 20, 120),
            ],
            make_request(result_limit=120),
        )

        self.assertEqual(result.listing_count, 120)
        self.assertEqual(
            [
                (call["params"]["start"], call["params"]["rows"])
                for call in transport.calls
            ],
            [(0, 50), (50, 50), (100, 20)],
        )
        self.assertTrue(
            all(
                call["params"]["append_api_key"] == "false"
                and call["params"]["api_key"] == SYNTHETIC_KEY
                for call in transport.calls
            )
        )

    def test_pagination_stops_at_num_found_without_probe(self) -> None:
        result, transport = search_with(
            [make_page(0, 50, 55), make_page(50, 5, 55)],
            make_request(result_limit=100),
        )

        self.assertEqual(result.listing_count, 55)
        self.assertEqual(
            [
                (call["params"]["start"], call["params"]["rows"])
                for call in transport.calls
            ],
            [(0, 50), (50, 5)],
        )

    def test_empty_page_stops_pagination(self) -> None:
        result, transport = search_with(
            [make_page(0, 50, 100), make_page(50, 0, 100)],
            make_request(result_limit=100),
        )

        self.assertEqual(result.listing_count, 50)
        self.assertEqual(len(transport.calls), 2)

    def test_pagination_without_num_found_stops_at_limit(self) -> None:
        result, transport = search_with(
            [make_page(0, 50, None), make_page(50, 1, None)],
            make_request(result_limit=51),
        )

        self.assertEqual(result.listing_count, 51)
        self.assertEqual(len(transport.calls), 2)

    def test_short_page_without_num_found_does_not_probe_again(self) -> None:
        result, transport = search_with(
            [make_page(0, 1, None)],
            make_request(result_limit=25),
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(len(transport.calls), 1)

    def test_provider_order_is_preserved_across_pages(self) -> None:
        first = make_page(0, 50, 52)
        second = make_page(50, 2, 52)
        second["listings"].reverse()

        result, _ = search_with(
            [first, second],
            make_request(result_limit=52),
        )

        ids = [listing.source_listing_id for listing in result.listings]
        self.assertEqual(ids[-2:], ["synthetic-listing-051", "synthetic-listing-050"])

    def test_later_page_failure_does_not_return_partial_result(self) -> None:
        transport = RecordingTransport(
            [make_page(0, 50, 75), self.http_error(500)]
        )
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)

        with self.assertRaises(MarketProviderUnavailableError):
            discover_market_listings(make_request(result_limit=75), provider)
        self.assertEqual(len(transport.calls), 2)

    @staticmethod
    def http_error(status: int) -> HTTPError:
        return HTTPError(MARKETCHECK_ACTIVE_INVENTORY_URL, status, "error", {}, None)

    def test_repeated_calls_are_deterministic_and_do_not_mutate_request(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        transport = RecordingTransport([payload, copy.deepcopy(payload)])
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
        request = make_request(trim=None, result_limit=3)
        before = copy.deepcopy(request.to_dict())

        first = discover_market_listings(request, provider)
        second = discover_market_listings(request, provider)

        self.assertEqual(first, second)
        self.assertEqual(request.to_dict(), before)
        self.assertEqual(len(transport.calls), 2)


class MarketCheckCliAndFixtureTests(unittest.TestCase):
    CLI_ARGS = [
        "--year",
        "2025",
        "--make",
        "Toyota",
        "--model",
        "Camry",
        "--trim",
        "SE",
        "--mileage",
        "7192",
        "--postal-code",
        "63123",
        "--radius",
        "50",
        "--limit",
        "10",
    ]

    def test_cli_requires_environment_key_without_stdout_output(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stdout(
            stdout
        ), redirect_stderr(stderr):
            status = search_marketcheck.main(self.CLI_ARGS)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("API key is required", stderr.getvalue())

    def test_cli_prints_only_canonical_json_on_success(self) -> None:
        transport = RecordingTransport([{"num_found": 0, "listings": []}])
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.dict(
            os.environ, {"MARKETCHECK_API_KEY": SYNTHETIC_KEY}
        ), patch.object(
            search_marketcheck,
            "MarketCheckProvider",
            return_value=provider,
        ) as provider_class, redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck.main(self.CLI_ARGS)

        document = json.loads(stdout.getvalue())
        self.assertEqual(status, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(document["provider"], "marketcheck")
        self.assertEqual(document["listingCount"], 0)
        self.assertNotIn(SYNTHETIC_KEY, stdout.getvalue())
        provider_class.assert_called_once_with(SYNTHETIC_KEY)

    def test_cli_error_does_not_print_authenticated_url(self) -> None:
        authenticated_url = (
            f"{MARKETCHECK_ACTIVE_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        provider = MarketCheckProvider(
            SYNTHETIC_KEY,
            transport=RecordingTransport(
                [URLError(f"could not open {authenticated_url}")]
            ),
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.dict(
            os.environ, {"MARKETCHECK_API_KEY": SYNTHETIC_KEY}
        ), patch.object(
            search_marketcheck,
            "MarketCheckProvider",
            return_value=provider,
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck.main(self.CLI_ARGS)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(SYNTHETIC_KEY, stderr.getvalue())
        self.assertNotIn(authenticated_url, stderr.getvalue())

    def test_committed_fixture_is_explicitly_synthetic_and_credential_free(self) -> None:
        text = FIXTURE_PATH.read_text(encoding="utf-8")
        document = json.loads(text)

        self.assertIs(document["syntheticData"], True)
        self.assertIn("not live market evidence", document["fixtureNotice"])
        self.assertNotIn("mc_" + "live_", text)
        self.assertNotIn("MARKETCHECK_API_KEY", text)
        self.assertNotIn("api_key=", text)


if __name__ == "__main__":
    unittest.main()
