"""Offline tests for MarketCheck's two-stage historical market provider."""

from __future__ import annotations

import copy
import io
import json
import traceback
import unittest
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError

from venfour.adaptive_search import (
    AdaptiveSearchPolicy,
    SearchStage,
    adaptive_discover_historical_market_evidence,
)
from venfour.comparables import (
    comparable_target_from_search_request,
    rank_market_comparables,
)
from venfour.historical_market import (
    AMBIGUOUS,
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    UNRESOLVED,
    HistoricalMarketSearchRequest,
    discover_historical_market_evidence,
    historical_evidence_to_market_search_result,
)
from venfour.market import (
    MarketContractError,
    MarketProviderAuthenticationError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketProviderUnavailableError,
)
from venfour.marketcheck import (
    MARKETCHECK_HISTORICAL_MAX_PAGES,
    MARKETCHECK_PAST_INVENTORY_URL,
    MARKETCHECK_PAST_MAX_RADIUS_MILES,
    MARKETCHECK_VIN_HISTORY_MAX_PAGES,
    MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS,
    MARKETCHECK_VIN_HISTORY_PAGE_SIZE,
    MARKETCHECK_VIN_HISTORY_URL,
    MarketCheckHistoricalProvider,
    marketcheck_historical_coverage,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = (
    REPO_ROOT
    / "tests"
    / "fixtures"
    / "market"
    / "marketcheck-historical-response.json"
)
SYNTHETIC_KEY = "synthetic-secret-key-for-historical-tests"
EVIDENCE_DATE = "2026-05-19"
AS_OF_DATE = "2026-08-10"


def make_request(**overrides: Any) -> HistoricalMarketSearchRequest:
    values: dict[str, Any] = {
        "evidence_date": EVIDENCE_DATE,
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "loss_vehicle_mileage": 46926,
        "postal_code": "63026",
        "radius_miles": 50,
        "result_limit": 25,
    }
    values.update(overrides)
    return HistoricalMarketSearchRequest(**values)


def make_candidate(index: int = 0, **overrides: Any) -> dict[str, Any]:
    """Return one attributed `/recents` candidate row."""

    record: dict[str, Any] = {
        "id": f"synthetic-candidate-{index:03d}",
        "vin": f"SYNTHETIC-CANDIDATE-VIN-{index:03d}",
        "price": 31000 + index,
        "miles": 47000 + index,
        "vdp_url": f"https://candidates.invalid/vehicles/{index}",
        "source": "candidate-source.invalid",
        "dealer": {
            "name": f"Candidate Dealer {index}",
            "city": "Fenton",
            "state": "MO",
            "zip": "63026",
        },
        "build": {
            "year": 2024,
            "make": "Hyundai",
            "model": "Elantra",
            "trim": "SEL",
        },
        "dist": index + 0.25,
    }
    record.update(overrides)
    return record


def make_history(index: int = 0, **overrides: Any) -> dict[str, Any]:
    """Return one flat VIN History row (VIN History has no nested build)."""

    record: dict[str, Any] = {
        "id": f"synthetic-history-{index:03d}",
        "vin": f"SYNTHETIC-CANDIDATE-VIN-{index:03d}",
        "price": 24000 + index,
        "miles": 41000 + index,
        "vdp_url": f"https://history.invalid/vehicles/{index}",
        "source": "candidate-source.invalid",
        "seller_name": f"Candidate Dealer {index}",
        "city": "Fenton",
        "state": "MO",
        "zip": "63026",
        "inventory_type": "used",
        "seller_type": "dealer",
        "first_seen_at_date": "2026-05-18T18:00:00Z",
        "last_seen_at_date": "2026-05-20T06:00:00Z",
    }
    record.update(overrides)
    return record


def make_history_for_candidate(
    record_index: int,
    *,
    candidate_index: int = 0,
    **overrides: Any,
) -> dict[str, Any]:
    """Vary lifecycle identity while preserving one candidate's seller context."""

    values: dict[str, Any] = {
        "vin": f"SYNTHETIC-CANDIDATE-VIN-{candidate_index:03d}",
        "seller_name": f"Candidate Dealer {candidate_index}",
    }
    values.update(overrides)
    return make_history(record_index, **values)


def make_unverifiable_history_contexts(
    *, candidate_index: int,
) -> list[tuple[str, dict[str, Any]]]:
    """Return active rows whose candidate qualification cannot be established."""

    cases: list[tuple[str, dict[str, Any]]] = []
    invalid_type_values: tuple[tuple[str, Any], ...] = (
        ("missing", None),
        ("non_string", {"unexpected": "value"}),
        ("blank", "   "),
    )
    record_index = 100
    for field in ("inventory_type", "seller_type"):
        for label, invalid_value in invalid_type_values:
            record = make_history_for_candidate(
                record_index,
                candidate_index=candidate_index,
            )
            record_index += 1
            if label == "missing":
                record.pop(field)
            else:
                record[field] = invalid_value
            cases.append((f"{field}_{label}", record))

    insufficient = make_history_for_candidate(
        record_index,
        candidate_index=candidate_index,
    )
    record_index += 1
    for field in ("seller_name", "city", "state", "zip"):
        insufficient.pop(field)
    cases.append(("insufficient_seller_context", insufficient))

    malformed = make_history_for_candidate(
        record_index,
        candidate_index=candidate_index,
        seller_name={"unexpected": "object"},
        city=["unexpected", "array"],
    )
    malformed.pop("state")
    malformed.pop("zip")
    cases.append(("malformed_seller_context", malformed))
    return cases


def make_candidate_page(
    records: list[Any], total: int | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {"listings": records}
    if total is not None:
        payload["num_found"] = total
    return payload


def make_http_error(status: int, endpoint: str) -> HTTPError:
    authenticated_url = f"{endpoint}?api_key={SYNTHETIC_KEY}"
    body = io.BytesIO(json.dumps({"message": SYNTHETIC_KEY}).encode("utf-8"))
    return HTTPError(
        authenticated_url,
        status,
        "synthetic provider failure",
        {},
        body,
    )


class RecordingTransport:
    """Queue-backed HTTP boundary that never performs network access."""

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
            raise AssertionError("Unexpected MarketCheck historical transport call")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        if isinstance(outcome, bytes):
            return outcome
        return json.dumps(outcome, allow_nan=True).encode("utf-8")


def search_with(
    outcomes: list[Any],
    request: HistoricalMarketSearchRequest | None = None,
    *,
    api_key: str | None = SYNTHETIC_KEY,
    as_of_date: str = AS_OF_DATE,
) -> tuple[Any, RecordingTransport]:
    transport = RecordingTransport(outcomes)
    provider = MarketCheckHistoricalProvider(
        api_key,
        as_of_date=as_of_date,
        transport=transport,
    )
    result = discover_historical_market_evidence(request or make_request(), provider)
    return result, transport


def candidate_calls(transport: RecordingTransport) -> list[dict[str, Any]]:
    return [
        call
        for call in transport.calls
        if call["endpoint"] == MARKETCHECK_PAST_INVENTORY_URL
    ]


def history_calls(transport: RecordingTransport) -> list[dict[str, Any]]:
    prefix = f"{MARKETCHECK_VIN_HISTORY_URL}/"
    return [call for call in transport.calls if call["endpoint"].startswith(prefix)]


class MarketCheckHistoricalCoverageTests(unittest.TestCase):
    def test_adapter_declares_the_recents_geographic_ceiling(self) -> None:
        self.assertEqual(
            MarketCheckHistoricalProvider.maximum_search_radius_miles,
            MARKETCHECK_PAST_MAX_RADIUS_MILES,
        )
        self.assertEqual(MARKETCHECK_PAST_MAX_RADIUS_MILES, 100)

    def test_today_thirty_days_and_exactly_ninety_days_are_supported(self) -> None:
        for evidence_date in ("2026-08-10", "2026-07-11", "2026-05-12"):
            with self.subTest(evidence_date=evidence_date):
                coverage = marketcheck_historical_coverage(
                    evidence_date, as_of_date=AS_OF_DATE
                )
                self.assertEqual(coverage.status, SUPPORTED)
                self.assertEqual(coverage.history_window_days, 90)

    def test_elantra_loss_date_is_supported_on_august_eleven(self) -> None:
        coverage = marketcheck_historical_coverage(
            "2026-05-19", as_of_date="2026-08-11"
        )

        self.assertEqual(coverage.status, SUPPORTED)
        self.assertEqual(coverage.history_window_days, 90)

    def test_date_older_than_ninety_days_is_out_of_provider_range(self) -> None:
        coverage = marketcheck_historical_coverage(
            "2026-05-11", as_of_date=AS_OF_DATE
        )

        self.assertEqual(coverage.status, OUT_OF_PROVIDER_RANGE)
        self.assertEqual(coverage.history_window_days, 90)

    def test_future_date_is_rejected(self) -> None:
        with self.assertRaises(MarketContractError) as raised:
            marketcheck_historical_coverage("2026-08-11", as_of_date=AS_OF_DATE)

        self.assertIn("future", str(raised.exception).lower())

    def test_injected_as_of_date_is_echoed_in_supported_result(self) -> None:
        result, transport = search_with(
            [make_candidate_page([], 0)],
            make_request(evidence_date="2026-01-01"),
            as_of_date="2026-01-31",
        )

        self.assertEqual(result.as_of_date, "2026-01-31")
        self.assertEqual(result.coverage.status, SUPPORTED)
        self.assertEqual(len(transport.calls), 1)

    def test_out_of_range_result_requires_no_key_and_makes_zero_calls(self) -> None:
        transport = RecordingTransport([])
        provider = MarketCheckHistoricalProvider(
            None,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )

        result = discover_historical_market_evidence(
            make_request(evidence_date="2025-08-14"), provider
        )

        self.assertEqual(result.coverage.status, OUT_OF_PROVIDER_RANGE)
        self.assertEqual(result.as_of_date, AS_OF_DATE)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues, ())
        self.assertEqual(result.listing_count, 0)
        self.assertEqual(transport.calls, [])

    def test_future_request_fails_before_key_or_transport_is_needed(self) -> None:
        transport = RecordingTransport([])
        provider = MarketCheckHistoricalProvider(
            None,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )

        with self.assertRaises(MarketContractError):
            provider.search_historical(make_request(evidence_date="2026-08-11"))

        self.assertEqual(transport.calls, [])


class MarketCheckHistoricalRequestMappingTests(unittest.TestCase):
    def test_full_request_maps_exactly_to_deduplicated_recents_search(self) -> None:
        result, transport = search_with(
            [make_candidate_page([], 0)],
            make_request(result_limit=7),
        )

        self.assertEqual(result.listing_count, 0)
        self.assertEqual(len(transport.calls), 1)
        call = transport.calls[0]
        self.assertEqual(call["endpoint"], MARKETCHECK_PAST_INVENTORY_URL)
        self.assertEqual(call["headers"], {"Accept": "application/json"})
        self.assertEqual(call["timeout"], 15.0)
        self.assertEqual(
            call["params"],
            {
                "api_key": SYNTHETIC_KEY,
                "append_api_key": "false",
                "car_type": "used",
                "has_price": "true",
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "zip": "63026",
                "radius": 50,
                "active_inventory_date_range": "20260519-20260519",
                "start": 0,
                "rows": 10,
                "trim": "SEL",
            },
        )

    def test_recents_request_has_no_duplicate_expansion_or_value_filters(self) -> None:
        _, transport = search_with(
            [make_candidate_page([], 0)],
            make_request(loss_vehicle_mileage=98765),
        )

        params = transport.calls[0]["params"]
        forbidden = {
            "nodedup",
            "sold",
            "miles",
            "mileage",
            "miles_range",
            "price",
            "price_min",
            "price_max",
            "min_price",
            "max_price",
        }
        self.assertTrue(forbidden.isdisjoint(params))
        self.assertEqual(params["has_price"], "true")
        self.assertEqual(params["append_api_key"], "false")

    def test_missing_trim_is_omitted_without_broadening_retry(self) -> None:
        _, transport = search_with(
            [make_candidate_page([], 0)],
            make_request(trim=None),
        )

        self.assertNotIn("trim", transport.calls[0]["params"])
        self.assertEqual(len(transport.calls), 1)

    def test_vin_history_uses_bare_array_page_and_descending_sort(self) -> None:
        candidate = make_candidate(1, vin="VIN/WITH SPACE")
        history = make_history(1)
        history.pop("vin")

        result, transport = search_with(
            [make_candidate_page([candidate], 1), [history]]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(len(transport.calls), 2)
        call = transport.calls[1]
        self.assertEqual(
            call["endpoint"], f"{MARKETCHECK_VIN_HISTORY_URL}/VIN%2FWITH%20SPACE"
        )
        self.assertEqual(
            call["params"],
            {
                "api_key": SYNTHETIC_KEY,
                "page": 1,
                "sort_order": "desc",
            },
        )
        self.assertEqual(call["headers"], {"Accept": "application/json"})
        self.assertEqual(call["timeout"], 15.0)

    def test_history_flat_row_uses_candidate_build_and_history_listing_values(
        self,
    ) -> None:
        candidate = make_candidate(
            1,
            price=1,
            miles=99999,
            dist=7.5,
            dealer={
                "name": "Verified History Dealer",
                "city": "Fenton",
                "state": "MO",
                "zip": "63026",
            },
        )
        history = make_history(
            1,
            price=25123,
            miles=46926,
            seller_name="Verified History Dealer",
            build={
                "year": 1900,
                "make": "Wrong",
                "model": "Wrong",
                "trim": "Wrong",
            },
        )

        result, _ = search_with([make_candidate_page([candidate], 1), [history]])

        listing = result.evidence[0].listing
        self.assertEqual(listing.source_listing_id, history["id"])
        self.assertEqual(listing.listing_url, history["vdp_url"])
        self.assertEqual(
            (listing.year, listing.make, listing.model, listing.trim),
            (2024, "Hyundai", "Elantra", "SEL"),
        )
        self.assertEqual((listing.price, listing.mileage), (25123, 46926))
        self.assertEqual(listing.dealer.name, "Verified History Dealer")
        self.assertEqual(listing.distance_miles, 7.5)

    def test_history_record_price_replaces_non_authoritative_candidate_price(
        self,
    ) -> None:
        candidate = make_candidate(1, price=123)
        history = make_history(1, price=28765)

        result, _ = search_with([make_candidate_page([candidate], 1), [history]])

        self.assertEqual(result.evidence[0].listing.price, 28765)

    def test_result_limit_is_applied_after_every_candidate_history_is_checked(
        self,
    ) -> None:
        poor = make_candidate(1, price=1, dist=49)
        strong = make_candidate(2, price=999999, dist=1)
        poor_history = make_history(1, price=1, miles=120000)
        strong_history = make_history(2, price=999999, miles=46926)

        result, transport = search_with(
            [
                make_candidate_page([poor, strong], 2),
                [poor_history],
                [strong_history],
            ],
            make_request(result_limit=1),
        )

        self.assertEqual(len(history_calls(transport)), 2)
        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.vin, strong["vin"])


class MarketCheckHistoricalFixtureTests(unittest.TestCase):
    @staticmethod
    def fixture_outcomes(payload: Mapping[str, Any]) -> list[Any]:
        return [
            copy.deepcopy(payload["candidateResponse"]),
            *copy.deepcopy(payload["vinHistoryResponses"]),
        ]

    def test_fixture_models_complete_candidates_and_vin_scoped_resolution(
        self,
    ) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, transport = search_with(self.fixture_outcomes(payload))

        self.assertEqual(len(candidate_calls(transport)), 1)
        self.assertEqual(len(history_calls(transport)), 6)
        self.assertEqual(result.provider, "marketcheck")
        self.assertEqual(result.coverage.status, SUPPORTED)
        self.assertEqual(result.listing_count, 2)
        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            ["SYNTHETIC-FIXTURE-EXACT", "SYNTHETIC-FIXTURE-SEQUENTIAL"],
        )
        self.assertEqual(
            [(issue.status, issue.reason, issue.vin) for issue in result.issues],
            [
                (
                    UNRESOLVED,
                    "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE",
                    "SYNTHETIC-FIXTURE-BEFORE",
                ),
                (
                    UNRESOLVED,
                    "RECORD_INTERVAL_AFTER_EVIDENCE_DATE",
                    "SYNTHETIC-FIXTURE-AFTER",
                ),
                (
                    AMBIGUOUS,
                    "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                    "SYNTHETIC-FIXTURE-AMBIGUOUS",
                ),
                (
                    UNRESOLVED,
                    "MALFORMED_RECORD_TIMESTAMPS",
                    "SYNTHETIC-FIXTURE-MALFORMED",
                ),
            ],
        )
        self.assertEqual(result.unresolved_count, 3)
        self.assertEqual(result.ambiguous_count, 1)

    def test_fixture_normalizes_history_price_and_temporal_provenance(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, _ = search_with(self.fixture_outcomes(payload))

        exact = result.evidence[0]
        self.assertEqual(exact.listing.source, "marketcheck")
        self.assertEqual(exact.listing.source_listing_id, "fixture-history-exact")
        self.assertEqual(exact.listing.price, 24501)
        self.assertEqual(exact.listing.mileage, 46901)
        self.assertEqual(exact.listing.dealer.name, "Fixture History Dealer")
        self.assertEqual(exact.listing.distance_miles, 5.1)
        self.assertEqual(
            exact.temporal_evidence.to_dict(),
            {
                "status": "RESOLVED",
                "basis": "LISTING_RECORD_ACTIVE_ON_DATE",
                "evidenceDate": EVIDENCE_DATE,
                "recordFirstSeenAt": "2026-05-19T00:00:00Z",
                "recordLastSeenAt": "2026-05-19T23:59:59Z",
                "sourceFirstSeenAt": "2026-05-01T00:00:00Z",
                "sourceLastSeenAt": "2026-05-25T00:00:00Z",
            },
        )

    def test_fixture_provider_metadata_does_not_leak_into_result(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, _ = search_with(self.fixture_outcomes(payload))
        rendered = json.dumps(result.to_dict(), sort_keys=True)

        self.assertNotIn("fixtureNotice", rendered)
        self.assertNotIn("providerOnlyMetadata", rendered)
        self.assertNotIn("candidate-source.invalid", rendered)

    def test_repeated_fixture_search_is_stable_and_does_not_mutate_input(
        self,
    ) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        original = copy.deepcopy(payload)

        first, _ = search_with(self.fixture_outcomes(payload))
        second, _ = search_with(self.fixture_outcomes(payload))

        self.assertEqual(first.to_dict(), second.to_dict())
        self.assertEqual(payload, original)

    def test_supported_empty_candidate_result_is_structured_and_canonical(
        self,
    ) -> None:
        result, _ = search_with([make_candidate_page([], 0)])

        self.assertEqual(result.coverage.status, SUPPORTED)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues, ())
        self.assertEqual(result.listing_count, 0)


class MarketCheckHistoricalCandidateDiscoveryTests(unittest.TestCase):
    def test_multiple_unique_candidates_each_receive_one_history_request(self) -> None:
        candidates = [make_candidate(index) for index in range(1, 4)]
        histories = [[make_history(index)] for index in range(1, 4)]

        result, transport = search_with(
            [make_candidate_page(candidates, 3), *histories]
        )

        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            [candidate["vin"] for candidate in candidates],
        )
        self.assertEqual(len(history_calls(transport)), 3)

    def test_candidate_vins_are_deduplicated_case_insensitively(self) -> None:
        first = make_candidate(1, vin="SYNTHETIC-DUPLICATE-VIN")
        duplicate = make_candidate(2, vin="synthetic-duplicate-vin")
        history = make_history(1, vin="SYNTHETIC-DUPLICATE-VIN")

        result, transport = search_with(
            [make_candidate_page([first, duplicate], 2), [history]]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.vin, first["vin"])
        self.assertEqual(len(history_calls(transport)), 1)

    def test_candidate_without_vin_is_unresolved_and_other_vin_survives(self) -> None:
        missing = make_candidate(1, vin=None)
        valid = make_candidate(2)

        result, transport = search_with(
            [make_candidate_page([missing, valid], 2), [make_history(2)]]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.vin, valid["vin"])
        self.assertEqual(len(history_calls(transport)), 1)
        self.assertEqual(result.issues[0].status, UNRESOLVED)
        self.assertEqual(result.issues[0].reason, "MISSING_LISTING_IDENTITY")
        self.assertIsNone(result.issues[0].vin)

    def test_candidate_listing_id_does_not_substitute_for_required_vin(self) -> None:
        candidate = make_candidate(1, vin=None, id="candidate-id-only")

        result, transport = search_with([make_candidate_page([candidate], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(len(history_calls(transport)), 0)
        self.assertEqual(result.issues[0].reason, "MISSING_LISTING_IDENTITY")

    def test_candidate_pagination_exhausts_all_pages_before_history_calls(self) -> None:
        first = make_candidate(1)
        second = make_candidate(2)
        third = make_candidate(3)
        first_page = [copy.deepcopy(first) for _ in range(5)] + [
            copy.deepcopy(second) for _ in range(5)
        ]

        result, transport = search_with(
            [
                make_candidate_page(first_page, 11),
                make_candidate_page([third], 11),
                [make_history(1)],
                [make_history(2)],
                [make_history(3)],
            ],
            make_request(result_limit=2),
        )

        self.assertEqual(result.listing_count, 2)
        self.assertEqual(
            [(call["params"]["start"], call["params"]["rows"]) for call in candidate_calls(transport)],
            [(0, 10), (10, 1)],
        )
        self.assertTrue(
            all(
                call["endpoint"] == MARKETCHECK_PAST_INVENTORY_URL
                for call in transport.calls[:2]
            )
        )
        self.assertEqual(len(history_calls(transport)), 3)

    def test_candidate_pagination_without_num_found_ends_on_short_page(self) -> None:
        first = make_candidate(1)
        second = make_candidate(2)
        full_page = [copy.deepcopy(first) for _ in range(10)]

        result, transport = search_with(
            [
                make_candidate_page(full_page),
                make_candidate_page([second]),
                [make_history(1)],
                [make_history(2)],
            ],
            make_request(result_limit=2),
        )

        self.assertEqual(result.listing_count, 2)
        self.assertEqual(len(candidate_calls(transport)), 2)
        self.assertEqual(len(history_calls(transport)), 2)

    def test_candidate_num_found_drift_is_globally_incomplete(self) -> None:
        first = make_candidate(1)
        second = make_candidate(2)
        first_page = [copy.deepcopy(first) for _ in range(10)]
        cases = (
            ("decrease", make_candidate_page([], 10)),
            ("increase", make_candidate_page([second], 12)),
        )
        for direction, changed_page in cases:
            with self.subTest(direction=direction):
                result, transport = search_with(
                    [
                        make_candidate_page(copy.deepcopy(first_page), 11),
                        changed_page,
                    ],
                    make_request(result_limit=2),
                )

                self.assertEqual(len(candidate_calls(transport)), 2)
                self.assertEqual(len(history_calls(transport)), 0)
                self.assertEqual(result.evidence, ())
                self.assertEqual(len(result.issues), 1)
                issue = result.issues[0]
                self.assertEqual(issue.status, UNRESOLVED)
                self.assertEqual(issue.reason, "INCOMPLETE_PROVIDER_PAGINATION")
                self.assertIsNone(issue.vin)
                self.assertIsNone(issue.source_listing_id)

    def test_candidate_safety_cap_is_global_and_withholds_all_evidence(self) -> None:
        duplicate = make_candidate(1)
        pages = [
            make_candidate_page(
                [copy.deepcopy(duplicate) for _ in range(10)], 101
            )
            for _ in range(MARKETCHECK_HISTORICAL_MAX_PAGES)
        ]

        result, transport = search_with(pages, make_request(result_limit=2))

        self.assertEqual(
            len(candidate_calls(transport)), MARKETCHECK_HISTORICAL_MAX_PAGES
        )
        self.assertEqual(len(history_calls(transport)), 0)
        self.assertEqual(result.evidence, ())
        self.assertEqual(len(result.issues), 1)
        issue = result.issues[0]
        self.assertEqual(issue.status, UNRESOLVED)
        self.assertEqual(issue.reason, "PAGINATION_SAFETY_LIMIT_REACHED")
        self.assertIsNone(issue.vin)

    def test_premature_empty_candidate_page_is_globally_incomplete(self) -> None:
        first_page = [make_candidate(index) for index in range(1, 11)]

        result, transport = search_with(
            [
                make_candidate_page(first_page, 11),
                make_candidate_page([], 11),
            ],
            make_request(result_limit=1),
        )

        self.assertEqual(len(candidate_calls(transport)), 2)
        self.assertEqual(len(history_calls(transport)), 0)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[-1].reason, "INCOMPLETE_PROVIDER_PAGINATION")
        self.assertIsNone(result.issues[-1].vin)


class MarketCheckHistoricalVerificationBudgetTests(unittest.TestCase):
    def test_adaptive_search_resets_budget_between_analysis_sessions(self) -> None:
        first_candidate = make_candidate(1)
        second_candidate = make_candidate(2)
        transport = RecordingTransport(
            [
                make_candidate_page([first_candidate], 1),
                [make_history(1)],
                make_candidate_page([second_candidate], 1),
                [make_history(2)],
            ]
        )
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
            max_vin_verifications=1,
        )
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 1),),
            minimum_strong_matches=1,
            max_unique_candidates=1,
        )

        first = adaptive_discover_historical_market_evidence(
            make_request(result_limit=1), provider, policy
        )
        second = adaptive_discover_historical_market_evidence(
            make_request(result_limit=1), provider, policy
        )

        self.assertEqual(first.result.listing_count, 1)
        self.assertEqual(second.result.listing_count, 1)
        self.assertEqual(len(history_calls(transport)), 2)
        self.assertEqual(transport.outcomes, [])

    def test_cross_scope_cache_is_case_insensitive_and_price_independent(
        self,
    ) -> None:
        first_candidate = make_candidate(
            1,
            vin="SYNTHETIC-SHARED-VIN",
            price=1,
        )
        cached_candidate = make_candidate(
            1,
            vin="synthetic-shared-vin",
            price=999_999,
        )
        uncached_candidate = make_candidate(2, price=24_567)
        history = make_history(
            1,
            vin="Synthetic-Shared-Vin",
            price=25_123,
        )
        transport = RecordingTransport(
            [
                make_candidate_page([first_candidate], 1),
                [history],
                make_candidate_page([uncached_candidate, cached_candidate], 2),
            ]
        )
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
            max_vin_verifications=1,
        )

        first_result = discover_historical_market_evidence(
            make_request(radius_miles=50, result_limit=1),
            provider,
        )
        expanded_result = discover_historical_market_evidence(
            make_request(radius_miles=200, result_limit=2),
            provider,
        )

        self.assertEqual(first_result.listing_count, 1)
        self.assertEqual(expanded_result.listing_count, 1)
        self.assertEqual(len(candidate_calls(transport)), 2)
        self.assertEqual(len(history_calls(transport)), 1)
        self.assertEqual(transport.outcomes, [])
        self.assertEqual(
            expanded_result.evidence[0].listing.vin,
            cached_candidate["vin"],
        )
        self.assertEqual(expanded_result.evidence[0].listing.price, history["price"])
        self.assertEqual(len(expanded_result.issues), 1)
        issue = expanded_result.issues[0]
        self.assertEqual(issue.status, UNRESOLVED)
        self.assertEqual(issue.reason, "CANDIDATE_VERIFICATION_LIMIT_REACHED")
        self.assertIsNone(issue.vin)
        self.assertIsNone(issue.source_listing_id)

        projected = historical_evidence_to_market_search_result(expanded_result)
        ranking = rank_market_comparables(
            comparable_target_from_search_request(projected.request),
            projected,
        )
        self.assertEqual(projected.listing_count, 1)
        self.assertEqual(ranking.total_listing_count, 1)
        self.assertEqual(ranking.eligible_count, 1)

    def test_default_budget_stops_after_one_hundred_unique_vins(self) -> None:
        self.assertEqual(MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS, 100)
        candidates = [
            make_candidate(index)
            for index in range(1, MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 2)
        ]
        candidate_pages = [
            make_candidate_page(
                candidates[:50],
                MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 1,
            ),
            make_candidate_page(
                candidates[50:100],
                MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 1,
            ),
            make_candidate_page(
                candidates[100:],
                MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 1,
            ),
        ]
        histories = [
            [make_history(index)]
            for index in range(1, MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 1)
        ]

        result, transport = search_with(
            [*candidate_pages, *histories],
            make_request(
                result_limit=MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS + 1
            ),
        )

        self.assertEqual(
            len(history_calls(transport)),
            MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS,
        )
        self.assertEqual(
            result.listing_count,
            MARKETCHECK_VIN_HISTORY_MAX_VERIFICATIONS,
        )
        self.assertEqual(transport.outcomes, [])
        self.assertEqual(len(result.issues), 1)
        issue = result.issues[0]
        self.assertEqual(issue.status, UNRESOLVED)
        self.assertEqual(issue.reason, "CANDIDATE_VERIFICATION_LIMIT_REACHED")
        self.assertIsNone(issue.vin)
        self.assertIsNone(issue.source_listing_id)


class MarketCheckHistoricalLifecycleTests(unittest.TestCase):
    def run_one_history(
        self,
        records: list[Any],
        *,
        candidate: dict[str, Any] | None = None,
    ) -> Any:
        candidate = candidate or make_candidate()
        result, _ = search_with([make_candidate_page([candidate], 1), records])
        return result

    def test_one_record_covering_evidence_day_resolves(self) -> None:
        result = self.run_one_history([make_history()])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(
            result.evidence[0].temporal_evidence.record_first_seen_at,
            "2026-05-18T18:00:00Z",
        )
        self.assertEqual(
            result.evidence[0].temporal_evidence.record_last_seen_at,
            "2026-05-20T06:00:00Z",
        )

    def test_history_entirely_before_evidence_day_is_unresolved(self) -> None:
        history = make_history(
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T23:59:59Z",
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(
            result.issues[0].reason, "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE"
        )

    def test_history_entirely_after_evidence_day_is_unresolved(self) -> None:
        history = make_history(
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-25T00:00:00Z",
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(
            result.issues[0].reason, "RECORD_INTERVAL_AFTER_EVIDENCE_DATE"
        )

    def test_sequential_lifecycles_select_only_record_active_on_date(self) -> None:
        before = make_history_for_candidate(
            1,
            price=19000,
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T23:59:59Z",
        )
        active = make_history_for_candidate(
            2,
            price=26000,
            first_seen_at_date="2026-05-19T00:00:00Z",
            last_seen_at_date="2026-05-19T23:59:59Z",
        )
        after = make_history_for_candidate(
            3,
            price=21000,
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-25T00:00:00Z",
        )

        result = self.run_one_history([after, active, before])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.source_listing_id, active["id"])
        self.assertEqual(result.evidence[0].listing.price, 26000)

    def test_gap_with_records_before_and_after_has_no_active_record(self) -> None:
        before = make_history_for_candidate(
            1,
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T20:00:00Z",
        )
        after = make_history_for_candidate(
            2,
            first_seen_at_date="2026-05-20T07:00:00Z",
            last_seen_at_date="2026-05-29T20:00:00Z",
        )

        result = self.run_one_history([after, before])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE")

    def test_distinct_same_day_overlaps_are_ambiguous_regardless_of_price(self) -> None:
        low = make_history_for_candidate(1, price=1)
        high = make_history_for_candidate(2, price=999999)

        result = self.run_one_history([high, low])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.ambiguous_count, 1)
        self.assertEqual(result.issues[0].status, AMBIGUOUS)
        self.assertEqual(
            result.issues[0].reason,
            "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
        )
        self.assertEqual(result.issues[0].vin, make_candidate()["vin"])

    def test_identical_duplicate_history_rows_collapse(self) -> None:
        history = make_history()

        result = self.run_one_history([history, copy.deepcopy(history)])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_price_only_conflict_is_ambiguous_not_directionally_selected(self) -> None:
        low = make_history(price=1)
        high = copy.deepcopy(low)
        high["price"] = 999999

        result = self.run_one_history([high, low])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.ambiguous_count, 1)
        self.assertEqual(
            result.issues[0].reason,
            "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
        )

    def test_malformed_timestamp_sibling_invalidates_vin_conservatively(self) -> None:
        valid = make_history()
        malformed = make_history_for_candidate(
            2,
            first_seen_at_date="not-a-timestamp",
        )

        result = self.run_one_history([valid, malformed])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MALFORMED_RECORD_TIMESTAMPS")

    def test_malformed_irrelevant_inventory_rows_are_ignored_before_lifecycle(
        self,
    ) -> None:
        valid = make_history()
        new_inventory = make_history_for_candidate(
            2,
            inventory_type="new",
            first_seen_at_date="malformed",
        )
        private_seller = make_history_for_candidate(
            3,
            seller_type="private",
            last_seen_at_date="malformed",
        )

        result = self.run_one_history([new_inventory, private_seller, valid])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_malformed_listing_fields_on_proven_pre_day_record_are_irrelevant(
        self,
    ) -> None:
        malformed_before = make_history_for_candidate(
            1,
            id=None,
            price="not-a-price",
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T00:00:00Z",
        )
        valid = make_history()

        result = self.run_one_history([valid, malformed_before])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_missing_first_timestamp_is_safe_when_valid_last_proves_pre_day(
        self,
    ) -> None:
        incomplete_before = make_history_for_candidate(
            1,
            first_seen_at_date=None,
            last_seen_at_date="2026-05-18T00:00:00Z",
        )
        valid = make_history()

        result = self.run_one_history([valid, incomplete_before])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_selected_history_record_without_id_is_unresolved(self) -> None:
        result = self.run_one_history([make_history(id=None)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MISSING_LISTING_IDENTITY")
        self.assertEqual(result.issues[0].vin, make_candidate()["vin"])

    def test_history_row_may_omit_vin_because_endpoint_supplies_identity(self) -> None:
        history = make_history()
        history.pop("vin")

        result = self.run_one_history([history])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.vin, make_candidate()["vin"])

    def test_history_row_with_mismatched_vin_is_rejected(self) -> None:
        with self.assertRaises(MarketProviderResponseError):
            self.run_one_history([make_history(vin="A-DIFFERENT-VIN")])

    def test_iso_timestamps_are_normalized_to_utc(self) -> None:
        history = make_history(
            first_seen_at_date="2026-05-18T19:00:00-05:00",
            last_seen_at_date="2026-05-19T19:00:00-05:00",
        )

        result = self.run_one_history([history])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.record_first_seen_at, "2026-05-19T00:00:00Z")
        self.assertEqual(temporal.record_last_seen_at, "2026-05-20T00:00:00Z")

    def test_epoch_timestamps_are_accepted_without_iso_fields(self) -> None:
        history = make_history()
        history.pop("first_seen_at_date")
        history.pop("last_seen_at_date")
        history["first_seen_at"] = int(
            datetime(2026, 5, 19, tzinfo=timezone.utc).timestamp()
        )
        history["last_seen_at"] = int(
            datetime(2026, 5, 20, tzinfo=timezone.utc).timestamp()
        )

        result = self.run_one_history([history])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.record_first_seen_at, "2026-05-19T00:00:00Z")
        self.assertEqual(temporal.record_last_seen_at, "2026-05-20T00:00:00Z")

    def test_consistent_iso_and_epoch_twins_are_accepted(self) -> None:
        first = int(datetime(2026, 5, 19, 1, tzinfo=timezone.utc).timestamp())
        last = int(datetime(2026, 5, 19, 2, tzinfo=timezone.utc).timestamp())
        history = make_history(
            first_seen_at_date="2026-05-19T01:00:00Z",
            first_seen_at=first,
            last_seen_at_date="2026-05-19T02:00:00Z",
            last_seen_at=last,
        )

        result = self.run_one_history([history])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_inconsistent_iso_and_epoch_twins_are_unresolved(self) -> None:
        history = make_history(
            first_seen_at=int(
                datetime(2026, 5, 19, 1, tzinfo=timezone.utc).timestamp()
            ),
            last_seen_at=int(
                datetime(2026, 5, 20, 6, tzinfo=timezone.utc).timestamp()
            ),
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "INCONSISTENT_RECORD_TIMESTAMPS")

    def test_malformed_iso_is_not_hidden_by_valid_epoch_twin(self) -> None:
        history = make_history(
            first_seen_at_date="not-a-timestamp",
            first_seen_at=int(
                datetime(2026, 5, 19, tzinfo=timezone.utc).timestamp()
            ),
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MALFORMED_RECORD_TIMESTAMPS")

    def test_exact_calendar_day_boundaries_are_conservative(self) -> None:
        first_candidate = make_candidate(1)
        second_candidate = make_candidate(2)
        ends_at_start = make_history(
            1,
            first_seen_at_date="2026-05-18T00:00:00Z",
            last_seen_at_date="2026-05-19T00:00:00Z",
        )
        begins_next_day = make_history(
            2,
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-21T00:00:00Z",
        )

        result, _ = search_with(
            [
                make_candidate_page([first_candidate, second_candidate], 2),
                [ends_at_start],
                [begins_next_day],
            ]
        )

        self.assertEqual(
            [item.listing.vin for item in result.evidence], [first_candidate["vin"]]
        )
        self.assertEqual(
            result.issues[0].reason, "RECORD_INTERVAL_AFTER_EVIDENCE_DATE"
        )

    def test_inverted_record_interval_is_unresolved(self) -> None:
        history = make_history(
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-18T00:00:00Z",
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "INVALID_RECORD_INTERVAL")

    def test_source_tenure_never_substitutes_for_record_timestamps(self) -> None:
        history = make_history(
            first_seen_at_source_date="2026-05-01T00:00:00Z",
            last_seen_at_source_date="2026-05-30T00:00:00Z",
        )
        history.pop("first_seen_at_date")
        history.pop("last_seen_at_date")

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MISSING_RECORD_TIMESTAMPS")

    def test_valid_source_tenure_is_retained_as_provenance(self) -> None:
        history = make_history(
            first_seen_at_source_date="2026-05-01T19:00:00-05:00",
            last_seen_at_source_date="2026-05-25T19:00:00-05:00",
        )

        result = self.run_one_history([history])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.source_first_seen_at, "2026-05-02T00:00:00Z")
        self.assertEqual(temporal.source_last_seen_at, "2026-05-26T00:00:00Z")

    def test_record_outside_available_source_interval_is_unresolved(self) -> None:
        history = make_history(
            first_seen_at_source_date="2026-05-19T00:00:00Z",
            last_seen_at_source_date="2026-05-19T23:59:59Z",
        )

        result = self.run_one_history([history])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "RECORD_OUTSIDE_SOURCE_INTERVAL")

    def test_matching_candidate_context_resolves_and_retains_distance(self) -> None:
        candidate = make_candidate(1, dist=8.5)
        history = make_history(1)

        result = self.run_one_history([history], candidate=candidate)

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(result.evidence[0].listing.distance_miles, 8.5)

    def test_unrelated_source_seller_and_geography_cannot_resolve(self) -> None:
        candidate = make_candidate(1, dist=8.5)
        unrelated = make_history(
            1,
            source="unrelated-source.invalid",
            seller_name="Unrelated Dealer",
            city="Elsewhere",
            state="IL",
            zip="60601",
        )

        result = self.run_one_history([unrelated], candidate=candidate)

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(result.issues[0].vin, candidate["vin"])
        self.assertEqual(result.issues[0].reason, "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE")

    def test_same_source_without_seller_or_location_cannot_resolve(self) -> None:
        candidate = make_candidate(1)
        history = make_history(1)
        for field in ("seller_name", "city", "state", "zip"):
            history.pop(field)

        result = self.run_one_history([history], candidate=candidate)

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(result.issues[0].reason, "UNVERIFIABLE_RECORD_CONTEXT")

    def test_same_source_contradictory_seller_and_geography_are_irrelevant(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        history = make_history(
            2,
            vin=candidate["vin"],
            seller_name="Contradictory Dealer",
            city="Chicago",
            state="IL",
            zip="60601",
        )

        result = self.run_one_history([history, valid], candidate=candidate)

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(result.evidence[0].listing.source_listing_id, valid["id"])

    def test_active_exact_candidate_id_with_conflicting_geography_is_unverifiable(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        history = make_history(
            2,
            vin=candidate["vin"],
            id=candidate["id"],
            seller_name="Contradictory Dealer",
            city="Chicago",
            state="IL",
            zip="60601",
        )

        result = self.run_one_history([history, valid], candidate=candidate)

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(result.issues[0].vin, candidate["vin"])
        self.assertEqual(result.issues[0].reason, "UNVERIFIABLE_RECORD_CONTEXT")

    def test_pre_or_post_day_exact_id_context_conflict_is_safely_ignored(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        relations = {
            "before": (
                "2026-05-01T00:00:00Z",
                "2026-05-18T23:59:59Z",
            ),
            "after": (
                "2026-05-20T00:00:00Z",
                "2026-05-25T00:00:00Z",
            ),
        }
        for relation, (first_seen, last_seen) in relations.items():
            with self.subTest(relation=relation):
                conflicting = make_history(
                    2,
                    vin=candidate["vin"],
                    id=candidate["id"],
                    seller_name="Contradictory Dealer",
                    city="Chicago",
                    state="IL",
                    zip="60601",
                    first_seen_at_date=first_seen,
                    last_seen_at_date=last_seen,
                )

                result = self.run_one_history(
                    [conflicting, valid],
                    candidate=candidate,
                )

                self.assertEqual(result.listing_count, 1)
                self.assertEqual(result.issues, ())
                self.assertEqual(
                    result.evidence[0].listing.source_listing_id,
                    valid["id"],
                )

    def test_active_exact_candidate_id_with_type_contradiction_is_unverifiable(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        cases = (
            ("non_used", {"inventory_type": "new"}),
            ("non_dealer", {"seller_type": "private"}),
        )
        for label, overrides in cases:
            with self.subTest(case=label):
                contradictory = make_history_for_candidate(
                    2,
                    candidate_index=1,
                    id=candidate["id"],
                    **overrides,
                )

                result = self.run_one_history(
                    [valid, contradictory],
                    candidate=candidate,
                )

                self.assertEqual(result.evidence, ())
                self.assertEqual(result.unresolved_count, 1)
                self.assertEqual(result.issues[0].vin, candidate["vin"])
                self.assertEqual(
                    result.issues[0].reason,
                    "UNVERIFIABLE_RECORD_CONTEXT",
                )

    def test_pre_or_post_day_exact_id_type_contradiction_is_safely_ignored(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        type_cases = (
            ("non_used", {"inventory_type": "new"}),
            ("non_dealer", {"seller_type": "private"}),
        )
        relations = {
            "before": (
                "2026-05-01T00:00:00Z",
                "2026-05-18T23:59:59Z",
            ),
            "after": (
                "2026-05-20T00:00:00Z",
                "2026-05-25T00:00:00Z",
            ),
        }
        for type_label, overrides in type_cases:
            for relation, (first_seen, last_seen) in relations.items():
                with self.subTest(case=type_label, relation=relation):
                    contradictory = make_history_for_candidate(
                        2,
                        candidate_index=1,
                        id=candidate["id"],
                        first_seen_at_date=first_seen,
                        last_seen_at_date=last_seen,
                        **overrides,
                    )

                    result = self.run_one_history(
                        [contradictory, valid],
                        candidate=candidate,
                    )

                    self.assertEqual(result.listing_count, 1)
                    self.assertEqual(result.issues, ())
                    self.assertEqual(
                        result.evidence[0].listing.source_listing_id,
                        valid["id"],
                    )

    def test_exact_candidate_listing_id_allows_absent_optional_context(self) -> None:
        candidate = make_candidate(1)
        history = make_history(1, id=candidate["id"])
        for field in ("source", "seller_name", "city", "state", "zip"):
            history.pop(field)

        result = self.run_one_history([history], candidate=candidate)

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(
            result.evidence[0].listing.source_listing_id,
            candidate["id"],
        )

    def test_active_unverifiable_sibling_withholds_otherwise_valid_evidence(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        for label, unverifiable in make_unverifiable_history_contexts(
            candidate_index=1
        ):
            with self.subTest(case=label):
                result = self.run_one_history(
                    [valid, unverifiable],
                    candidate=candidate,
                )

                self.assertEqual(result.evidence, ())
                self.assertEqual(result.unresolved_count, 1)
                self.assertEqual(
                    result.issues[0].reason,
                    "UNVERIFIABLE_RECORD_CONTEXT",
                )
                self.assertEqual(result.issues[0].vin, candidate["vin"])
                self.assertEqual(
                    result.to_dict()["issues"][0]["reason"],
                    "UNVERIFIABLE_RECORD_CONTEXT",
                )

    def test_pre_or_post_day_unverifiable_sibling_is_safely_ignored(self) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        relations = {
            "before": (
                "2026-05-01T00:00:00Z",
                "2026-05-18T23:59:59Z",
            ),
            "after": (
                "2026-05-20T00:00:00Z",
                "2026-05-25T00:00:00Z",
            ),
        }
        for label, template in make_unverifiable_history_contexts(
            candidate_index=1
        ):
            for relation, (first_seen, last_seen) in relations.items():
                with self.subTest(case=label, relation=relation):
                    unverifiable = copy.deepcopy(template)
                    unverifiable["first_seen_at_date"] = first_seen
                    unverifiable["last_seen_at_date"] = last_seen

                    result = self.run_one_history(
                        [unverifiable, valid],
                        candidate=candidate,
                    )

                    self.assertEqual(result.listing_count, 1)
                    self.assertEqual(result.issues, ())
                    self.assertEqual(
                        result.evidence[0].listing.source_listing_id,
                        valid["id"],
                    )

    def test_explicit_non_used_or_non_dealer_siblings_remain_irrelevant(
        self,
    ) -> None:
        candidate = make_candidate(1)
        valid = make_history(1)
        cases = (
            ("non_used", {"inventory_type": "new"}),
            ("non_dealer", {"seller_type": "private"}),
        )
        for label, overrides in cases:
            with self.subTest(case=label):
                irrelevant = make_history_for_candidate(
                    2,
                    candidate_index=1,
                    **overrides,
                )

                result = self.run_one_history(
                    [irrelevant, valid],
                    candidate=candidate,
                )

                self.assertEqual(result.listing_count, 1)
                self.assertEqual(result.issues, ())
                self.assertEqual(
                    result.evidence[0].listing.source_listing_id,
                    valid["id"],
                )

    def test_two_matching_seller_geography_fields_support_changed_history_id(
        self,
    ) -> None:
        candidate = make_candidate(1)
        history = make_history(
            2,
            vin=candidate["vin"],
            source="changed-source.invalid",
            seller_name="Candidate Dealer 1",
            zip="63026",
        )
        history.pop("city")
        history.pop("state")

        result = self.run_one_history([history], candidate=candidate)

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(result.evidence[0].listing.source_listing_id, history["id"])

    def test_unrelated_same_day_row_does_not_make_matching_row_ambiguous(
        self,
    ) -> None:
        candidate = make_candidate(1)
        matching = make_history(1)
        unrelated = make_history(
            2,
            vin=candidate["vin"],
            source="unrelated-source.invalid",
            seller_name="Unrelated Dealer",
            city="Elsewhere",
            state="IL",
            zip="60601",
            price=999999,
        )

        result = self.run_one_history(
            [unrelated, matching],
            candidate=candidate,
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.ambiguous_count, 0)
        self.assertEqual(result.issues, ())
        self.assertEqual(
            result.evidence[0].listing.source_listing_id,
            matching["id"],
        )


class MarketCheckHistoricalHistoryPaginationTests(unittest.TestCase):
    def test_full_page_last_seen_tail_cannot_hide_later_status_ordered_overlap(
        self,
    ) -> None:
        candidate = make_candidate()
        before = make_history_for_candidate(
            1,
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T00:00:00Z",
            status_date=1800000000,
        )
        first_page = [copy.deepcopy(before) for _ in range(50)]
        overlap = make_history(status_date=1700000000)

        result, transport = search_with(
            [
                make_candidate_page([candidate], 1),
                first_page,
                [overlap],
            ]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.source_listing_id, overlap["id"])
        self.assertEqual(
            [call["params"]["page"] for call in history_calls(transport)],
            [1, 2],
        )

    def test_history_paginates_to_final_short_page(self) -> None:
        candidate = make_candidate()
        after = make_history_for_candidate(
            1,
            first_seen_at_date="2026-05-21T00:00:00Z",
            last_seen_at_date="2026-05-22T00:00:00Z",
        )
        first_page = [copy.deepcopy(after) for _ in range(50)]
        overlap = make_history()

        result, transport = search_with(
            [make_candidate_page([candidate], 1), first_page, [overlap]]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(
            [call["params"]["page"] for call in history_calls(transport)], [1, 2]
        )
        self.assertTrue(
            all(
                call["params"]["sort_order"] == "desc"
                for call in history_calls(transport)
            )
        )

    def test_documented_422_after_first_history_page_terminates_pagination(
        self,
    ) -> None:
        candidate = make_candidate()
        after = make_history_for_candidate(
            1,
            first_seen_at_date="2026-05-21T00:00:00Z",
            last_seen_at_date="2026-05-22T00:00:00Z",
        )
        overlap = make_history()
        first_page = [*[copy.deepcopy(after) for _ in range(49)], overlap]
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}"

        result, transport = search_with(
            [
                make_candidate_page([candidate], 1),
                first_page,
                make_http_error(422, endpoint),
            ]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(len(history_calls(transport)), 2)

    def test_history_safety_cap_is_vin_scoped_and_another_vin_survives(self) -> None:
        capped_candidate = make_candidate(1)
        surviving_candidate = make_candidate(2)
        after = make_history(
            1,
            first_seen_at_date="2026-05-21T00:00:00Z",
            last_seen_at_date="2026-05-22T00:00:00Z",
        )
        full_page = [copy.deepcopy(after) for _ in range(50)]
        outcomes: list[Any] = [
            make_candidate_page([capped_candidate, surviving_candidate], 2),
            *[
                copy.deepcopy(full_page)
                for _ in range(MARKETCHECK_VIN_HISTORY_MAX_PAGES)
            ],
            [make_history(2)],
        ]

        result, transport = search_with(outcomes)

        self.assertEqual(
            len(history_calls(transport)), MARKETCHECK_VIN_HISTORY_MAX_PAGES + 1
        )
        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.vin, surviving_candidate["vin"])
        self.assertEqual(len(result.issues), 1)
        issue = result.issues[0]
        self.assertEqual(issue.status, UNRESOLVED)
        self.assertEqual(issue.reason, "PAGINATION_SAFETY_LIMIT_REACHED")
        self.assertEqual(issue.vin, capped_candidate["vin"])

    def test_empty_first_history_page_is_complete_but_unresolved(self) -> None:
        result, transport = search_with(
            [make_candidate_page([make_candidate()], 1), []]
        )

        self.assertEqual(len(history_calls(transport)), 1)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE")

    def test_first_page_422_is_not_treated_as_normal_history_exhaustion(self) -> None:
        candidate = make_candidate()
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}"

        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [
                    make_candidate_page([candidate], 1),
                    make_http_error(422, endpoint),
                ]
            )

    def test_arbitrary_4xx_on_later_history_page_is_fatal(self) -> None:
        candidate = make_candidate()
        after = make_history(
            first_seen_at_date="2026-05-21T00:00:00Z",
            last_seen_at_date="2026-05-22T00:00:00Z",
        )
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}"

        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [
                    make_candidate_page([candidate], 1),
                    [copy.deepcopy(after) for _ in range(50)],
                    make_http_error(400, endpoint),
                ]
            )


class MarketCheckHistoricalErrorAndSecurityTests(unittest.TestCase):
    def test_supported_search_without_api_key_fails_before_transport(self) -> None:
        transport = RecordingTransport([])
        provider = MarketCheckHistoricalProvider(
            None,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )

        with self.assertRaises(MarketProviderAuthenticationError):
            discover_historical_market_evidence(make_request(), provider)

        self.assertEqual(transport.calls, [])

    def test_candidate_http_statuses_reuse_provider_neutral_error_mapping(
        self,
    ) -> None:
        cases = {
            401: MarketProviderAuthenticationError,
            403: MarketProviderAuthenticationError,
            429: MarketProviderRateLimitError,
            408: MarketProviderUnavailableError,
            500: MarketProviderUnavailableError,
            503: MarketProviderUnavailableError,
            400: MarketProviderResponseError,
            422: MarketProviderResponseError,
        }
        for status, expected in cases.items():
            with self.subTest(status=status), self.assertRaises(expected):
                search_with([make_http_error(status, MARKETCHECK_PAST_INVENTORY_URL)])

    def test_history_http_statuses_reuse_provider_neutral_error_mapping(self) -> None:
        cases = {
            401: MarketProviderAuthenticationError,
            403: MarketProviderAuthenticationError,
            429: MarketProviderRateLimitError,
            408: MarketProviderUnavailableError,
            500: MarketProviderUnavailableError,
            503: MarketProviderUnavailableError,
            400: MarketProviderResponseError,
            422: MarketProviderResponseError,
        }
        candidate = make_candidate()
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}"
        for status, expected in cases.items():
            with self.subTest(status=status), self.assertRaises(expected):
                search_with(
                    [
                        make_candidate_page([candidate], 1),
                        make_http_error(status, endpoint),
                    ]
                )

    def test_candidate_failure_has_allowlisted_recents_context(self) -> None:
        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([make_http_error(422, MARKETCHECK_PAST_INVENTORY_URL)])

        self.assertEqual(
            raised.exception.diagnostic.to_dict(),
            {
                "endpointCategory": "recents",
                "httpStatus": 422,
                "radius": 50,
                "start": 0,
                "rows": 25,
            },
        )

    def test_history_failure_context_never_retains_vin_or_endpoint(self) -> None:
        candidate = make_candidate()
        endpoint = f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}"
        with self.assertRaises(MarketProviderRateLimitError) as raised:
            search_with(
                [
                    make_candidate_page([candidate], 1),
                    make_http_error(429, endpoint),
                ]
            )

        self.assertEqual(
            raised.exception.diagnostic.to_dict(),
            {
                "endpointCategory": "history",
                "httpStatus": 429,
                "page": 1,
            },
        )
        rendered = json.dumps(raised.exception.diagnostic.to_dict())
        self.assertNotIn(candidate["vin"], rendered)
        self.assertNotIn(endpoint, rendered)
        self.assertNotIn(SYNTHETIC_KEY, rendered)

    def test_network_failure_is_sanitized_and_not_retried(self) -> None:
        authenticated_url = (
            f"{MARKETCHECK_PAST_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        transport = RecordingTransport([URLError(f"could not open {authenticated_url}")])
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )

        with self.assertRaises(MarketProviderUnavailableError) as raised:
            discover_historical_market_evidence(make_request(), provider)

        self.assertEqual(len(transport.calls), 1)
        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(authenticated_url, rendered)

    def test_candidate_malformed_json_and_response_shapes_are_rejected(self) -> None:
        outcomes = (
            b"{not-json",
            b"\xff\xfe",
            {"num_found": 0, "listings": {}},
            {"num_found": -1, "listings": []},
            {"num_found": 1, "listings": ["not-an-object"]},
            {"num_found": 1, "listings": [make_candidate()], "extra": float("nan")},
        )
        for outcome in outcomes:
            with self.subTest(outcome=outcome), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([outcome])

    def test_vin_history_requires_bare_array_of_at_most_fifty_objects(self) -> None:
        candidate = make_candidate()
        malformed_histories: tuple[Any, ...] = (
            b"{not-json",
            {"history": []},
            ["not-an-object"],
            [make_history() for _ in range(MARKETCHECK_VIN_HISTORY_PAGE_SIZE + 1)],
        )
        for outcome in malformed_histories:
            with self.subTest(outcome_type=type(outcome).__name__), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([make_candidate_page([candidate], 1), outcome])

    def test_selected_malformed_history_listing_is_rejected(self) -> None:
        with self.assertRaises(MarketProviderResponseError):
            search_with(
                [
                    make_candidate_page([make_candidate()], 1),
                    [make_history(price="not-a-price")],
                ]
            )

    def test_non_bytes_transport_response_is_rejected(self) -> None:
        class InvalidTransport:
            def get(self, *args: Any, **kwargs: Any) -> str:
                return '{"num_found": 0, "listings": []}'

        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=InvalidTransport(),
        )

        with self.assertRaises(MarketProviderResponseError):
            discover_historical_market_evidence(make_request(), provider)

    def test_key_is_absent_from_repr_result_and_canonical_json(self) -> None:
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=RecordingTransport([]),
        )
        result, transport = search_with(
            [make_candidate_page([make_candidate()], 1), [make_history()]]
        )

        self.assertNotIn(SYNTHETIC_KEY, repr(provider))
        self.assertNotIn(SYNTHETIC_KEY, str(provider))
        self.assertNotIn(SYNTHETIC_KEY, repr(result))
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(result.to_dict()))
        self.assertEqual(
            candidate_calls(transport)[0]["params"]["append_api_key"], "false"
        )
        self.assertNotIn("append_api_key", history_calls(transport)[0]["params"])

    def test_secret_bearing_candidate_url_is_rejected_without_leak(self) -> None:
        candidate = make_candidate(
            vdp_url=f"https://candidates.invalid/vehicle?api_key={SYNTHETIC_KEY}"
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([make_candidate_page([candidate], 1)])

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(candidate["vdp_url"], rendered)

    def test_secret_bearing_history_url_is_rejected_without_leak(self) -> None:
        history = make_history(
            vdp_url=f"https://history.invalid/vehicle?api_key={SYNTHETIC_KEY}"
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with(
                [make_candidate_page([make_candidate()], 1), [history]]
            )

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(history["vdp_url"], rendered)

    def test_secret_in_candidate_identity_is_rejected_without_leak(self) -> None:
        candidate = make_candidate(vin=f"VIN-{SYNTHETIC_KEY}")

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([make_candidate_page([candidate], 1)])

        self.assertNotIn(
            SYNTHETIC_KEY, "".join(traceback.format_exception(raised.exception))
        )

    def test_secret_in_malformed_history_is_redacted_from_error_details(self) -> None:
        history = make_history(price=SYNTHETIC_KEY)

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with(
                [make_candidate_page([make_candidate()], 1), [history]]
            )

        rendered = "".join(traceback.format_exception(raised.exception))
        details = "\n".join(raised.exception.details)
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(SYNTHETIC_KEY, details)

    def test_http_error_authenticated_url_and_body_are_not_exposed(self) -> None:
        failure = make_http_error(401, MARKETCHECK_PAST_INVENTORY_URL)

        with self.assertRaises(MarketProviderAuthenticationError) as raised:
            search_with([failure])

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)
        self.assertTrue(failure.fp.closed)


if __name__ == "__main__":
    unittest.main()
