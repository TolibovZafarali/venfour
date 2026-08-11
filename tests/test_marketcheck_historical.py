"""Offline tests for MarketCheck date-specific historical market evidence."""

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

from venfour.historical_market import (
    AMBIGUOUS,
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    UNRESOLVED,
    HistoricalMarketSearchRequest,
    discover_historical_market_evidence,
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


def make_record(index: int = 0, **overrides: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": f"synthetic-history-{index:03d}",
        "vin": f"SYNTHETIC-HISTORY-VIN-{index:03d}",
        "price": 24000 + index,
        "miles": 41000 + index,
        "vdp_url": f"https://historical.invalid/vehicles/{index}",
        "source": "raw-historical-source.invalid",
        "first_seen_at_date": "2026-05-18T18:00:00Z",
        "last_seen_at_date": "2026-05-20T06:00:00Z",
        "dealer": {
            "name": f"Synthetic Historical Dealer {index}",
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


def make_page(records: list[Any], total: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"listings": records}
    if total is not None:
        payload["num_found"] = total
    return payload


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
    result = discover_historical_market_evidence(
        request or make_request(), provider
    )
    return result, transport


class MarketCheckHistoricalCoverageTests(unittest.TestCase):
    def test_today_thirty_days_and_exactly_ninety_days_are_supported(self) -> None:
        for evidence_date in ("2026-08-10", "2026-07-11", "2026-05-12"):
            with self.subTest(evidence_date=evidence_date):
                coverage = marketcheck_historical_coverage(
                    evidence_date, as_of_date=AS_OF_DATE
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
            marketcheck_historical_coverage(
                "2026-08-11", as_of_date=AS_OF_DATE
            )

        self.assertIn("future", str(raised.exception).lower())

    def test_injected_as_of_date_is_echoed_in_supported_result(self) -> None:
        result, transport = search_with(
            [{"num_found": 0, "listings": []}],
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
    def test_full_request_maps_exactly_to_recents_search(self) -> None:
        result, transport = search_with(
            [{"num_found": 0, "listings": []}],
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
                "nodedup": "true",
                "start": 0,
                "rows": 10,
                "trim": "SEL",
            },
        )

    def test_request_has_no_sold_mileage_or_price_filter(self) -> None:
        _, transport = search_with(
            [{"num_found": 0, "listings": []}],
            make_request(loss_vehicle_mileage=98765),
        )

        params = transport.calls[0]["params"]
        forbidden = {
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
        self.assertEqual(params["nodedup"], "true")
        self.assertEqual(params["append_api_key"], "false")

    def test_missing_trim_is_omitted_without_broadening_retry(self) -> None:
        _, transport = search_with(
            [{"num_found": 0, "listings": []}],
            make_request(trim=None),
        )

        self.assertNotIn("trim", transport.calls[0]["params"])
        self.assertEqual(len(transport.calls), 1)


class MarketCheckHistoricalFixtureTests(unittest.TestCase):
    def test_fixture_resolves_only_date_applicable_unique_records(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, transport = search_with([payload])

        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(result.provider, "marketcheck")
        self.assertEqual(result.coverage.status, SUPPORTED)
        self.assertEqual(result.listing_count, 3)
        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            [
                "SYNTHETIC-EXACT-DATE",
                "SYNTHETIC-SPANNING-DATE",
                "SYNTHETIC-IDENTICAL-DUPLICATE",
            ],
        )
        self.assertEqual(
            [(issue.status, issue.reason) for issue in result.issues],
            [
                (UNRESOLVED, "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE"),
                (UNRESOLVED, "RECORD_INTERVAL_AFTER_EVIDENCE_DATE"),
                (UNRESOLVED, "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE"),
                (AMBIGUOUS, "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE"),
                (UNRESOLVED, "MISSING_RECORD_TIMESTAMPS"),
            ],
        )
        self.assertEqual(result.unresolved_count, 4)
        self.assertEqual(result.ambiguous_count, 1)

    def test_fixture_normalizes_listing_and_wraps_temporal_provenance(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        result, _ = search_with([payload])

        first = result.evidence[0].to_dict()
        self.assertEqual(
            first["listing"],
            {
                "source": "marketcheck",
                "sourceListingId": "synthetic-exact-date",
                "listingUrl": "https://historical.invalid/exact-date",
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "trim": "SEL",
                "vin": "SYNTHETIC-EXACT-DATE",
                "mileage": 41001,
                "price": 24001,
                "dealer": {
                    "name": "Synthetic Dealer",
                    "city": "Fenton",
                    "state": "MO",
                    "postalCode": "63026",
                },
                "distanceMiles": 5.1,
            },
        )
        self.assertEqual(
            first["temporalEvidence"],
            {
                "status": "RESOLVED",
                "basis": "LISTING_RECORD_ACTIVE_ON_DATE",
                "evidenceDate": EVIDENCE_DATE,
                "recordFirstSeenAt": "2026-05-19T00:00:00Z",
                "recordLastSeenAt": "2026-05-19T23:59:59Z",
                "sourceFirstSeenAt": None,
                "sourceLastSeenAt": None,
            },
        )

    def test_raw_provider_metadata_does_not_leak_into_result(self) -> None:
        record = make_record(
            media={
                "photo_links": [
                    "https://images.invalid/provider-cached-image.jpg"
                ]
            },
            seller_type="dealer",
            first_seen_at_source_date="2026-05-01T00:00:00Z",
            last_seen_at_source_date="2026-05-30T00:00:00Z",
        )

        result, _ = search_with([make_page([record], 1)])

        serialized = json.dumps(result.to_dict(), sort_keys=True)
        for raw_field in (
            "first_seen_at_date",
            "last_seen_at_date",
            "first_seen_at_source_date",
            "last_seen_at_source_date",
            "seller_type",
            "photo_links",
            "provider-cached-image.jpg",
            "num_found",
        ):
            self.assertNotIn(raw_field, serialized)
        self.assertEqual(result.evidence[0].listing.source, "marketcheck")

    def test_supported_empty_result_is_structured_and_canonical(self) -> None:
        result, _ = search_with([{"num_found": 0, "listings": []}])

        self.assertEqual(result.coverage.status, SUPPORTED)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues, ())
        self.assertEqual(result.listing_count, 0)
        self.assertEqual(result.unresolved_count, 0)
        self.assertEqual(result.ambiguous_count, 0)

    def test_repeated_fixture_search_is_stable_and_does_not_mutate_input(self) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        before_payload = copy.deepcopy(payload)
        request = make_request()
        before_request = copy.deepcopy(request.to_dict())
        transport = RecordingTransport([payload, copy.deepcopy(payload)])
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )

        first = discover_historical_market_evidence(request, provider)
        second = discover_historical_market_evidence(request, provider)

        self.assertEqual(first, second)
        self.assertEqual(payload, before_payload)
        self.assertEqual(request.to_dict(), before_request)


class MarketCheckHistoricalTimestampTests(unittest.TestCase):
    def test_iso_timestamps_are_converted_to_canonical_utc(self) -> None:
        record = make_record(
            first_seen_at_date="2026-05-18T19:00:00-05:00",
            last_seen_at_date="2026-05-19T18:59:59-05:00",
        )

        result, _ = search_with([make_page([record], 1)])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.record_first_seen_at, "2026-05-19T00:00:00Z")
        self.assertEqual(temporal.record_last_seen_at, "2026-05-19T23:59:59Z")

    def test_epoch_timestamps_are_accepted_without_iso_fields(self) -> None:
        record = make_record()
        record.pop("first_seen_at_date")
        record.pop("last_seen_at_date")
        record["first_seen_at"] = int(
            datetime(2026, 5, 19, tzinfo=timezone.utc).timestamp()
        )
        record["last_seen_at"] = int(
            datetime(2026, 5, 20, tzinfo=timezone.utc).timestamp()
        )

        result, _ = search_with([make_page([record], 1)])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.record_first_seen_at, "2026-05-19T00:00:00Z")
        self.assertEqual(temporal.record_last_seen_at, "2026-05-20T00:00:00Z")

    def test_consistent_iso_and_epoch_representations_are_accepted(self) -> None:
        first = int(datetime(2026, 5, 19, 1, tzinfo=timezone.utc).timestamp())
        last = int(datetime(2026, 5, 19, 2, tzinfo=timezone.utc).timestamp())
        record = make_record(
            first_seen_at_date="2026-05-19T01:00:00Z",
            first_seen_at=first,
            last_seen_at_date="2026-05-19T02:00:00Z",
            last_seen_at=last,
        )

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_inconsistent_iso_and_epoch_representations_are_unresolved(self) -> None:
        record = make_record(
            first_seen_at=int(
                datetime(2026, 5, 19, 1, tzinfo=timezone.utc).timestamp()
            ),
            last_seen_at=int(
                datetime(2026, 5, 20, 6, tzinfo=timezone.utc).timestamp()
            ),
        )

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "INCONSISTENT_RECORD_TIMESTAMPS")

    def test_malformed_iso_is_not_hidden_by_valid_epoch_fallback(self) -> None:
        record = make_record(
            first_seen_at_date="not-a-timestamp",
            first_seen_at=int(
                datetime(2026, 5, 19, tzinfo=timezone.utc).timestamp()
            ),
        )

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MALFORMED_RECORD_TIMESTAMPS")

    def test_exact_day_boundaries_are_applied_inclusively_and_exclusively(self) -> None:
        ends_at_start = make_record(
            1,
            first_seen_at_date="2026-05-18T00:00:00Z",
            last_seen_at_date="2026-05-19T00:00:00Z",
        )
        begins_at_next_day = make_record(
            2,
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-21T00:00:00Z",
        )

        result, _ = search_with(
            [make_page([ends_at_start, begins_at_next_day], 2)]
        )

        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            ["SYNTHETIC-HISTORY-VIN-001"],
        )
        self.assertEqual(
            result.issues[0].reason, "RECORD_INTERVAL_AFTER_EVIDENCE_DATE"
        )

    def test_interval_ending_before_or_starting_after_day_is_unresolved(self) -> None:
        before = make_record(
            1,
            first_seen_at_date="2026-05-17T00:00:00Z",
            last_seen_at_date="2026-05-18T23:59:59Z",
        )
        after = make_record(
            2,
            first_seen_at_date="2026-05-20T00:00:01Z",
            last_seen_at_date="2026-05-21T00:00:00Z",
        )

        result, _ = search_with([make_page([before, after], 2)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(
            [issue.reason for issue in result.issues],
            [
                "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE",
                "RECORD_INTERVAL_AFTER_EVIDENCE_DATE",
            ],
        )

    def test_inverted_interval_is_unresolved(self) -> None:
        record = make_record(
            first_seen_at_date="2026-05-20T00:00:00Z",
            last_seen_at_date="2026-05-18T00:00:00Z",
        )

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "INVALID_RECORD_INTERVAL")

    def test_source_tenure_timestamps_are_never_record_timestamp_fallbacks(self) -> None:
        record = make_record(
            first_seen_at_source_date="2026-05-01T00:00:00Z",
            last_seen_at_source_date="2026-05-30T00:00:00Z",
            first_seen_at_source=int(
                datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp()
            ),
            last_seen_at_source=int(
                datetime(2026, 5, 30, tzinfo=timezone.utc).timestamp()
            ),
        )
        record.pop("first_seen_at_date")
        record.pop("last_seen_at_date")

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "MISSING_RECORD_TIMESTAMPS")

    def test_available_source_tenure_is_normalized_as_corroborating_provenance(
        self,
    ) -> None:
        record = make_record(
            first_seen_at_source_date="2026-05-01T19:00:00-05:00",
            last_seen_at_source_date="2026-05-25T19:00:00-05:00",
        )

        result, _ = search_with([make_page([record], 1)])

        temporal = result.evidence[0].temporal_evidence
        self.assertEqual(temporal.source_first_seen_at, "2026-05-02T00:00:00Z")
        self.assertEqual(temporal.source_last_seen_at, "2026-05-26T00:00:00Z")

    def test_record_contradicting_available_source_interval_is_unresolved(
        self,
    ) -> None:
        record = make_record(
            first_seen_at_source_date="2026-05-19T00:00:00Z",
            last_seen_at_source_date="2026-05-19T23:59:59Z",
        )

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues[0].reason, "RECORD_OUTSIDE_SOURCE_INTERVAL")


class MarketCheckHistoricalIdentityTests(unittest.TestCase):
    def test_identical_records_for_same_vin_resolve_once(self) -> None:
        record = make_record()

        result, _ = search_with(
            [make_page([record, copy.deepcopy(record)], 2)]
        )

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.issues, ())

    def test_one_applicable_lifecycle_record_is_selected_without_price_logic(self) -> None:
        old = make_record(
            1,
            vin="SYNTHETIC-PRICE-CHANGE",
            price=21000,
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T23:59:59Z",
        )
        applicable = make_record(
            2,
            vin="SYNTHETIC-PRICE-CHANGE",
            price=25000,
            first_seen_at_date="2026-05-19T00:00:00Z",
            last_seen_at_date="2026-05-25T00:00:00Z",
        )

        result, _ = search_with([make_page([old, applicable], 2)])

        self.assertEqual(result.listing_count, 1)
        self.assertEqual(result.evidence[0].listing.price, 25000)
        self.assertEqual(result.evidence[0].listing.source_listing_id, applicable["id"])
        self.assertEqual(result.issues, ())

    def test_distinct_overlapping_records_for_same_vin_are_ambiguous(self) -> None:
        first = make_record(1, vin="SYNTHETIC-AMBIGUOUS", price=23000)
        second = make_record(2, vin="SYNTHETIC-AMBIGUOUS", price=26000)

        result, _ = search_with([make_page([first, second], 2)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.ambiguous_count, 1)
        self.assertEqual(result.issues[0].status, AMBIGUOUS)
        self.assertEqual(
            result.issues[0].reason,
            "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
        )
        self.assertEqual(result.issues[0].vin, "SYNTHETIC-AMBIGUOUS")

    def test_malformed_sibling_invalidates_same_vin_conservatively(self) -> None:
        applicable = make_record(1, vin="SYNTHETIC-MALFORMED-SIBLING")
        malformed = make_record(
            2,
            vin="SYNTHETIC-MALFORMED-SIBLING",
            first_seen_at_date="malformed",
        )

        result, _ = search_with([make_page([applicable, malformed], 2)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(result.issues[0].reason, "MALFORMED_RECORD_TIMESTAMPS")
        self.assertEqual(result.issues[0].vin, "SYNTHETIC-MALFORMED-SIBLING")

    def test_missing_vin_falls_back_to_exact_provider_listing_id(self) -> None:
        record = make_record(vin=None, id="synthetic-id-only")

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.listing_count, 1)
        self.assertIsNone(result.evidence[0].listing.vin)
        self.assertEqual(
            result.evidence[0].listing.source_listing_id, "synthetic-id-only"
        )

    def test_record_without_vin_or_listing_id_is_unresolved(self) -> None:
        record = make_record(vin=None, id=None)

        result, _ = search_with([make_page([record], 1)])

        self.assertEqual(result.evidence, ())
        self.assertEqual(result.unresolved_count, 1)
        issue = result.issues[0]
        self.assertEqual(issue.reason, "MISSING_LISTING_IDENTITY")
        self.assertIsNone(issue.vin)
        self.assertIsNone(issue.source_listing_id)

    def test_resolved_and_issue_order_follow_first_provider_occurrence(self) -> None:
        second = make_record(2)
        before = make_record(
            9,
            first_seen_at_date="2026-05-01T00:00:00Z",
            last_seen_at_date="2026-05-18T00:00:00Z",
        )
        first = make_record(1)
        missing_identity = make_record(8, vin=None, id=None)

        result, _ = search_with(
            [
                make_page(
                    [
                        second,
                        before,
                        first,
                        copy.deepcopy(second),
                        missing_identity,
                    ],
                    5,
                )
            ]
        )

        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            ["SYNTHETIC-HISTORY-VIN-002", "SYNTHETIC-HISTORY-VIN-001"],
        )
        self.assertEqual(
            [issue.reason for issue in result.issues],
            [
                "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE",
                "MISSING_LISTING_IDENTITY",
            ],
        )


class MarketCheckHistoricalPaginationTests(unittest.TestCase):
    def test_pagination_continues_until_requested_unique_vins_are_resolved(self) -> None:
        duplicate = make_record(1)
        first_page = [copy.deepcopy(duplicate) for _ in range(10)]
        second_page = [make_record(2)]

        result, transport = search_with(
            [
                make_page(first_page, 11),
                make_page(second_page, 11),
            ],
            make_request(result_limit=2),
        )

        self.assertEqual(result.listing_count, 2)
        self.assertEqual(
            [item.listing.vin for item in result.evidence],
            ["SYNTHETIC-HISTORY-VIN-001", "SYNTHETIC-HISTORY-VIN-002"],
        )
        self.assertEqual(
            [
                (call["params"]["start"], call["params"]["rows"])
                for call in transport.calls
            ],
            [(0, 10), (10, 1)],
        )

    def test_pagination_exhausts_candidates_before_finalizing_unique_results(
        self,
    ) -> None:
        first = make_record(1)
        second = make_record(2)
        first_page = [copy.deepcopy(first) for _ in range(5)] + [
            copy.deepcopy(second) for _ in range(5)
        ]
        second_page = [make_record(index) for index in range(3, 13)]

        result, transport = search_with(
            [make_page(first_page, 20), make_page(second_page, 20)],
            make_request(result_limit=2),
        )

        self.assertEqual(result.listing_count, 2)
        self.assertEqual(len(transport.calls), 2)

    def test_later_page_conflict_cannot_leave_first_price_resolved(self) -> None:
        first_version = make_record(1, price=21001)
        fillers = [make_record(index) for index in range(2, 11)]
        conflicting_version = make_record(1, id="history-record-1b", price=22001)

        result, transport = search_with(
            [
                make_page([first_version, *fillers], 11),
                make_page([conflicting_version], 11),
            ],
            make_request(result_limit=1),
        )

        self.assertEqual(len(transport.calls), 2)
        self.assertNotIn(
            "SYNTHETIC-HISTORY-VIN-001",
            [item.listing.vin for item in result.evidence],
        )
        self.assertIn(
            (AMBIGUOUS, "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE"),
            [(issue.status, issue.reason) for issue in result.issues],
        )

    def test_maximum_page_bound_emits_explicit_diagnostic(self) -> None:
        duplicate = make_record(1)
        pages = [
            make_page([copy.deepcopy(duplicate) for _ in range(10)], 101)
            for _ in range(MARKETCHECK_HISTORICAL_MAX_PAGES)
        ]

        result, transport = search_with(
            pages,
            make_request(result_limit=2),
        )

        self.assertEqual(len(transport.calls), MARKETCHECK_HISTORICAL_MAX_PAGES)
        self.assertEqual(
            [call["params"]["start"] for call in transport.calls],
            list(range(0, 100, 10)),
        )
        self.assertEqual(result.listing_count, 0)
        self.assertIn(
            (UNRESOLVED, "PAGINATION_SAFETY_LIMIT_REACHED"),
            [(issue.status, issue.reason) for issue in result.issues],
        )

    def test_premature_empty_page_cannot_finalize_incomplete_evidence(self) -> None:
        first_page = [make_record(index) for index in range(1, 11)]

        result, transport = search_with(
            [make_page(first_page, 11), make_page([], 11)],
            make_request(result_limit=1),
        )

        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(result.listing_count, 0)
        self.assertIn(
            (UNRESOLVED, "INCOMPLETE_PROVIDER_PAGINATION"),
            [(issue.status, issue.reason) for issue in result.issues],
        )


class MarketCheckHistoricalErrorAndSecurityTests(unittest.TestCase):
    @staticmethod
    def http_error(status: int) -> HTTPError:
        authenticated_url = (
            f"{MARKETCHECK_PAST_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        body = io.BytesIO(
            json.dumps({"message": SYNTHETIC_KEY}).encode("utf-8")
        )
        return HTTPError(
            authenticated_url,
            status,
            "synthetic provider failure",
            {},
            body,
        )

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

    def test_http_statuses_reuse_provider_neutral_error_mapping(self) -> None:
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
                search_with([self.http_error(status)])

    def test_network_failure_is_sanitized_and_not_retried(self) -> None:
        authenticated_url = (
            f"{MARKETCHECK_PAST_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        transport = RecordingTransport(
            [URLError(f"could not open {authenticated_url}")]
        )
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

    def test_malformed_json_and_response_shapes_are_rejected(self) -> None:
        outcomes = (
            b"{not-json",
            b"\xff\xfe",
            {"num_found": 0, "listings": {}},
            {"num_found": -1, "listings": []},
            {"num_found": 1, "listings": ["not-an-object"]},
        )
        for outcome in outcomes:
            with self.subTest(outcome=outcome), self.assertRaises(
                MarketProviderResponseError
            ):
                search_with([outcome])

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
        result, transport = search_with([make_page([make_record()], 1)])

        self.assertNotIn(SYNTHETIC_KEY, repr(provider))
        self.assertNotIn(SYNTHETIC_KEY, str(provider))
        self.assertNotIn(SYNTHETIC_KEY, repr(result))
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(result.to_dict()))
        self.assertEqual(
            transport.calls[0]["params"]["append_api_key"], "false"
        )

    def test_secret_bearing_listing_url_is_rejected_without_leak(self) -> None:
        record = make_record(
            vdp_url=(
                "https://historical.invalid/vehicle?"
                f"api_key={SYNTHETIC_KEY}"
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([make_page([record], 1)])

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(record["vdp_url"], rendered)

    def test_secret_in_malformed_record_is_redacted_from_error_details(self) -> None:
        record = make_record(price=SYNTHETIC_KEY)

        with self.assertRaises(MarketProviderResponseError) as raised:
            search_with([make_page([record], 1)])

        rendered = "".join(traceback.format_exception(raised.exception))
        details = "\n".join(raised.exception.details)
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertNotIn(SYNTHETIC_KEY, details)

    def test_http_error_authenticated_url_and_body_are_not_exposed(self) -> None:
        failure = self.http_error(401)

        with self.assertRaises(MarketProviderAuthenticationError) as raised:
            search_with([failure])

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertNotIn(SYNTHETIC_KEY, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)
        self.assertTrue(failure.fp.closed)


if __name__ == "__main__":
    unittest.main()
