"""Offline contract tests for provider-neutral historical market evidence.

All vehicles, identifiers, URLs, timestamps, and prices in this module are
synthetic.  The tests exercise only canonical contracts and in-memory test
doubles; they require no provider credentials and perform no network access.
"""

from __future__ import annotations

import copy
import dataclasses
import json
import os
import socket
import unittest
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

from jsonschema import Draft202012Validator

from venfour.comparables import (
    comparable_target_from_search_request,
    rank_market_comparables,
)
from venfour.historical_market import (
    AMBIGUOUS,
    HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH,
    HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH,
    HISTORICAL_SEARCH_RESULT_SCHEMA_PATH,
    LISTING_RECORD_ACTIVE_ON_DATE,
    OUT_OF_PROVIDER_RANGE,
    RESOLVED,
    SUPPORTED,
    UNRESOLVED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketProvider,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
    discover_historical_market_evidence,
    historical_evidence_to_market_search_result,
    normalize_historical_market_search_request,
    validate_historical_evidence_item,
    validate_historical_market_search_request,
    validate_historical_market_search_result,
)
from venfour.market import (
    LISTING_SCHEMA_PATH,
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProviderError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketSearchRequest,
    MarketSearchResult,
    validate_market_search_result,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_PROVIDER = "synthetic-provider"
EVIDENCE_DATE = "2026-05-19"
AS_OF_DATE = "2026-08-10"


def make_request(**overrides: Any) -> HistoricalMarketSearchRequest:
    values: dict[str, Any] = {
        "evidence_date": EVIDENCE_DATE,
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "loss_vehicle_mileage": 46_926,
        "postal_code": "63026",
        "radius_miles": 50,
        "result_limit": 25,
    }
    values.update(overrides)
    return HistoricalMarketSearchRequest(**values)


def make_listing(index: int = 1, **overrides: Any) -> MarketListing:
    values: dict[str, Any] = {
        "source": SYNTHETIC_PROVIDER,
        "source_listing_id": f"synthetic-record-{index:03d}",
        "listing_url": f"https://historical.invalid/vehicle/{index}",
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "vin": f"SYNTHETICVIN{index:05d}",
        "mileage": 46_926 + index,
        "price": 20_000 + index,
        "dealer": MarketDealer(
            name="Synthetic Historical Motors",
            city="Test City",
            state="MO",
            postal_code="63026",
        ),
        "distance_miles": 10 + index,
    }
    values.update(overrides)
    return MarketListing(**values)


def make_temporal(**overrides: Any) -> TemporalEvidence:
    values: dict[str, Any] = {
        "evidence_date": EVIDENCE_DATE,
        "record_first_seen_at": "2026-05-18T18:00:00Z",
        "record_last_seen_at": "2026-05-20T06:00:00Z",
        "status": RESOLVED,
        "basis": LISTING_RECORD_ACTIVE_ON_DATE,
    }
    values.update(overrides)
    return TemporalEvidence(**values)


def make_evidence(
    index: int = 1,
    *,
    listing: MarketListing | None = None,
    temporal: TemporalEvidence | None = None,
    **listing_overrides: Any,
) -> HistoricalEvidenceItem:
    return HistoricalEvidenceItem(
        listing=(
            listing
            if listing is not None
            else make_listing(index, **listing_overrides)
        ),
        temporal_evidence=temporal if temporal is not None else make_temporal(),
    )


def make_issue(**overrides: Any) -> HistoricalEvidenceIssue:
    values: dict[str, Any] = {
        "status": UNRESOLVED,
        "reason": "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE",
        "vin": "SYNTHETIC-REJECTED-VIN",
        "source_listing_id": "synthetic-rejected-record",
    }
    values.update(overrides)
    return HistoricalEvidenceIssue(**values)


def make_result(
    *evidence: HistoricalEvidenceItem,
    provider: str = SYNTHETIC_PROVIDER,
    evidence_date: str = EVIDENCE_DATE,
    as_of_date: str = AS_OF_DATE,
    coverage: HistoricalCoverage | None = None,
    request: HistoricalMarketSearchRequest | None = None,
    issues: tuple[HistoricalEvidenceIssue, ...] = (),
) -> HistoricalMarketSearchResult:
    return HistoricalMarketSearchResult(
        provider=provider,
        evidence_date=evidence_date,
        as_of_date=as_of_date,
        coverage=(
            coverage
            if coverage is not None
            else HistoricalCoverage(status=SUPPORTED, history_window_days=90)
        ),
        request=(
            request
            if request is not None
            else make_request(evidence_date=evidence_date)
        ),
        evidence=evidence,
        issues=issues,
    )


class StaticHistoricalProvider:
    """Provider test double that records only historical requests."""

    def __init__(
        self,
        result_factory: Callable[[HistoricalMarketSearchRequest], Any],
        *,
        name: str = SYNTHETIC_PROVIDER,
    ) -> None:
        self.name = name
        self.result_factory = result_factory
        self.requests: list[HistoricalMarketSearchRequest] = []

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        self.requests.append(request)
        return self.result_factory(request)


class RaisingNameProvider:
    @property
    def name(self) -> str:
        raise RuntimeError("synthetic provider name failure")

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        raise AssertionError("historical search should not be called")


class HistoricalSchemaContractTests(unittest.TestCase):
    def test_all_historical_schemas_are_valid_draft_2020_12(self) -> None:
        for path in (
            HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH,
            HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH,
            HISTORICAL_SEARCH_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(
                    schema["$schema"],
                    "https://json-schema.org/draft/2020-12/schema",
                )
                Draft202012Validator.check_schema(schema)

    def test_result_definitions_match_the_standalone_contracts(self) -> None:
        result_schema = json.loads(
            HISTORICAL_SEARCH_RESULT_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        request_schema = json.loads(
            HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        request_schema.pop("$schema")
        request_schema.pop("title")
        self.assertEqual(
            result_schema["$defs"]["historicalSearchRequest"], request_schema
        )

        item_schema = json.loads(
            HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        item_schema.pop("$schema")
        item_schema.pop("title")
        item_schema.pop("$defs")
        self.assertEqual(
            result_schema["$defs"]["historicalEvidenceItem"], item_schema
        )

    def test_historical_schemas_embed_the_unchanged_listing_contract(self) -> None:
        canonical_listing = json.loads(LISTING_SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical_listing.pop("$schema")
        canonical_listing.pop("title")

        for path in (
            HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH,
            HISTORICAL_SEARCH_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(schema["$defs"]["listing"], canonical_listing)

    def test_schema_paths_are_repository_local_files(self) -> None:
        for path in (
            HISTORICAL_SEARCH_REQUEST_SCHEMA_PATH,
            HISTORICAL_EVIDENCE_ITEM_SCHEMA_PATH,
            HISTORICAL_SEARCH_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(path=path):
                self.assertTrue(path.is_file())
                self.assertTrue(path.is_relative_to(REPO_ROOT))


class HistoricalRequestContractTests(unittest.TestCase):
    def test_full_request_normalizes_and_serializes_canonical_fields(self) -> None:
        request = HistoricalMarketSearchRequest(
            evidence_date=" 2026-05-19 ",
            year=2024,
            make=" Hyundai ",
            model=" Elantra ",
            trim=" SEL ",
            loss_vehicle_mileage=46_926,
            postal_code=" 63026 ",
        )

        self.assertEqual(
            request.to_dict(),
            {
                "evidenceDate": EVIDENCE_DATE,
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "trim": "SEL",
                "lossVehicleMileage": 46_926,
                "postalCode": "63026",
                "radiusMiles": 50,
                "resultLimit": 25,
            },
        )
        validate_historical_market_search_request(request)

    def test_blank_optional_trim_normalizes_to_none(self) -> None:
        request = make_request(trim="   ")

        self.assertIsNone(request.trim)
        validate_historical_market_search_request(request)

    def test_normalization_returns_a_new_equal_value_without_mutation(self) -> None:
        request = make_request()
        before = request.to_dict()

        normalized = normalize_historical_market_search_request(request)

        self.assertIsNot(normalized, request)
        self.assertEqual(normalized, request)
        self.assertEqual(request.to_dict(), before)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            request.make = "Changed"  # type: ignore[misc]

    def test_request_projects_to_a_new_unchanged_market_search_request(self) -> None:
        historical = make_request()

        current_contract = historical.to_market_search_request()

        self.assertIsInstance(current_contract, MarketSearchRequest)
        self.assertEqual(
            current_contract.to_dict(),
            {
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "trim": "SEL",
                "lossVehicleMileage": 46_926,
                "postalCode": "63026",
                "radiusMiles": 50,
                "resultLimit": 25,
            },
        )
        self.assertNotIn("evidenceDate", current_contract.to_dict())

    def test_normalization_rejects_non_request_values(self) -> None:
        for value in (None, {}, make_request().to_dict()):
            with self.subTest(value=value), self.assertRaises(MarketContractError):
                normalize_historical_market_search_request(
                    value  # type: ignore[arg-type]
                )

    def test_request_requires_exact_iso_calendar_date_and_location(self) -> None:
        invalid_values = (
            {"evidenceDate": "2026-02-30"},
            {"evidenceDate": "2026-5-19"},
            {"evidenceDate": "2026-05-19T00:00:00Z"},
            {"postalCode": "   "},
        )
        for override in invalid_values:
            data = make_request().to_dict()
            data.update(override)
            with self.subTest(override=override), self.assertRaises(
                MarketContractError
            ):
                validate_historical_market_search_request(data)

    def test_request_numeric_bounds_and_integer_types_are_strict(self) -> None:
        for field, value in (
            ("year", -1),
            ("lossVehicleMileage", -1),
            ("radiusMiles", -1),
            ("resultLimit", 0),
            ("year", True),
            ("resultLimit", 1.5),
        ):
            data = make_request().to_dict()
            data[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(
                MarketContractError
            ):
                validate_historical_market_search_request(data)

    def test_request_rejects_missing_and_unknown_fields(self) -> None:
        missing = make_request().to_dict()
        del missing["evidenceDate"]
        unknown = make_request().to_dict()
        unknown["activeInventoryDateRange"] = "provider-specific"

        for data in (missing, unknown):
            with self.subTest(data=data), self.assertRaises(MarketContractError):
                validate_historical_market_search_request(data)

    def test_mapping_validation_does_not_mutate_the_caller_value(self) -> None:
        data = make_request().to_dict()
        before = copy.deepcopy(data)

        validate_historical_market_search_request(data)

        self.assertEqual(data, before)


class HistoricalEvidenceContractTests(unittest.TestCase):
    def test_resolved_evidence_serializes_temporal_data_only_in_wrapper(self) -> None:
        item = make_evidence()

        validate_historical_evidence_item(item)
        serialized = item.to_dict()
        self.assertEqual(serialized["temporalEvidence"]["status"], RESOLVED)
        self.assertEqual(
            serialized["temporalEvidence"]["basis"],
            LISTING_RECORD_ACTIVE_ON_DATE,
        )
        self.assertNotIn("recordFirstSeenAt", serialized["listing"])
        self.assertNotIn("recordLastSeenAt", serialized["listing"])
        self.assertNotIn("temporalEvidence", serialized["listing"])

    def test_spanning_and_instantaneous_intervals_overlap_the_day(self) -> None:
        intervals = (
            ("2026-05-01T00:00:00Z", "2026-05-31T23:59:59Z"),
            ("2026-05-19T12:00:00Z", "2026-05-19T12:00:00Z"),
            ("2026-05-19T23:59:59.999999Z", "2026-05-20T03:00:00Z"),
            ("2026-05-18T19:00:00-05:00", "2026-05-18T19:00:00-05:00"),
        )
        for first, last in intervals:
            with self.subTest(first=first, last=last):
                validate_historical_evidence_item(
                    make_evidence(
                        temporal=make_temporal(
                            record_first_seen_at=first,
                            record_last_seen_at=last,
                        )
                    )
                )

    def test_interval_end_at_day_start_is_an_inclusive_overlap(self) -> None:
        item = make_evidence(
            temporal=make_temporal(
                record_first_seen_at="2026-05-01T00:00:00Z",
                record_last_seen_at="2026-05-19T00:00:00Z",
            )
        )

        validate_historical_evidence_item(item)

    def test_intervals_strictly_before_or_after_the_day_are_rejected(self) -> None:
        intervals = (
            ("2026-05-01T00:00:00Z", "2026-05-18T23:59:59.999999Z"),
            ("2026-05-20T00:00:00Z", "2026-05-21T00:00:00Z"),
        )
        for first, last in intervals:
            with self.subTest(first=first, last=last), self.assertRaises(
                MarketContractError
            ) as raised:
                validate_historical_evidence_item(
                    make_evidence(
                        temporal=make_temporal(
                            record_first_seen_at=first,
                            record_last_seen_at=last,
                        )
                    )
                )
            self.assertTrue(
                any("does not overlap" in detail for detail in raised.exception.details)
            )

    def test_inverted_record_interval_is_rejected(self) -> None:
        item = make_evidence(
            temporal=make_temporal(
                record_first_seen_at="2026-05-19T18:00:00Z",
                record_last_seen_at="2026-05-19T06:00:00Z",
            )
        )

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_evidence_item(item)

        self.assertTrue(any("inverted" in d for d in raised.exception.details))

    def test_available_source_interval_must_contain_the_record_interval(self) -> None:
        valid = make_evidence(
            temporal=make_temporal(
                source_first_seen_at="2026-05-01T00:00:00Z",
                source_last_seen_at="2026-05-25T00:00:00Z",
            )
        )
        validate_historical_evidence_item(valid)

        invalid = make_evidence(
            temporal=make_temporal(
                source_first_seen_at="2026-05-19T00:00:00Z",
                source_last_seen_at="2026-05-19T23:59:59Z",
            )
        )
        with self.assertRaises(MarketContractError) as raised:
            validate_historical_evidence_item(invalid)
        self.assertTrue(
            any("source interval" in detail for detail in raised.exception.details)
        )

    def test_malformed_or_offsetless_timestamps_are_rejected(self) -> None:
        for value in (
            "not-a-timestamp",
            "2026-02-30T00:00:00Z",
            "2026-05-19T12:00:00",
            "2026-05-19",
        ):
            data = make_evidence().to_dict()
            data["temporalEvidence"]["recordFirstSeenAt"] = value
            with self.subTest(value=value), self.assertRaises(MarketContractError):
                validate_historical_evidence_item(data)

    def test_evidence_status_basis_and_date_format_are_strict(self) -> None:
        for field, value in (
            ("status", UNRESOLVED),
            ("basis", "VIN_ACTIVE_ON_DATE"),
            ("evidenceDate", "05/19/2026"),
        ):
            data = make_evidence().to_dict()
            data["temporalEvidence"][field] = value
            with self.subTest(field=field), self.assertRaises(MarketContractError):
                validate_historical_evidence_item(data)

    def test_unknown_fields_are_rejected_at_every_evidence_level(self) -> None:
        cases: list[dict[str, Any]] = []
        root = make_evidence().to_dict()
        root["providerPayload"] = {}
        cases.append(root)
        listing = make_evidence().to_dict()
        listing["listing"]["first_seen_at_source"] = 1_747_612_800
        cases.append(listing)
        temporal = make_evidence().to_dict()
        temporal["temporalEvidence"]["rawTimestamp"] = 1_747_612_800
        cases.append(temporal)

        for data in cases:
            with self.subTest(data=data), self.assertRaises(MarketContractError):
                validate_historical_evidence_item(data)

    def test_listing_must_still_satisfy_the_canonical_listing_contract(self) -> None:
        data = make_evidence().to_dict()
        data["listing"]["price"] = -1

        with self.assertRaises(MarketContractError):
            validate_historical_evidence_item(data)


class HistoricalResultContractTests(unittest.TestCase):
    def test_supported_result_counts_and_serializes_resolved_and_issue_data(
        self,
    ) -> None:
        result = make_result(
            make_evidence(1),
            make_evidence(2),
            issues=(
                make_issue(),
                make_issue(
                    status=AMBIGUOUS,
                    reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                    vin="SYNTHETIC-AMBIGUOUS-VIN",
                    source_listing_id=None,
                ),
            ),
        )

        validate_historical_market_search_result(result)
        self.assertEqual(result.listing_count, 2)
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(result.ambiguous_count, 1)
        self.assertEqual(
            result.listings, tuple(item.listing for item in result.evidence)
        )
        self.assertEqual(result.to_dict()["listingCount"], 2)
        self.assertEqual(result.to_dict()["unresolvedCount"], 1)
        self.assertEqual(result.to_dict()["ambiguousCount"], 1)

    def test_supported_empty_result_is_valid(self) -> None:
        result = make_result()

        validate_historical_market_search_result(result)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.issues, ())

    def test_supported_coverage_is_inclusive_today_through_day_ninety(self) -> None:
        for evidence_date in ("2026-08-10", "2026-07-11", "2026-05-12"):
            result = make_result(
                evidence_date=evidence_date,
                as_of_date=AS_OF_DATE,
                coverage=HistoricalCoverage(SUPPORTED, 90),
            )
            with self.subTest(evidence_date=evidence_date):
                validate_historical_market_search_result(result)

    def test_day_ninety_one_is_a_valid_empty_out_of_range_result(self) -> None:
        result = make_result(
            evidence_date="2026-05-11",
            coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90),
        )

        validate_historical_market_search_result(result)
        self.assertEqual(result.listing_count, 0)

    def test_future_evidence_date_is_rejected(self) -> None:
        result = make_result(
            evidence_date="2026-08-11",
            coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90),
        )

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("future" in d for d in raised.exception.details))

    def test_coverage_status_must_match_dates_and_window(self) -> None:
        cases = (
            make_result(coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90)),
            make_result(
                evidence_date="2026-05-11",
                coverage=HistoricalCoverage(SUPPORTED, 90),
            ),
        )
        for result in cases:
            with self.subTest(status=result.coverage.status), self.assertRaises(
                MarketContractError
            ) as raised:
                validate_historical_market_search_result(result)
            self.assertTrue(
                any("coverage.status" in d for d in raised.exception.details)
            )

    def test_invalid_coverage_values_are_rejected_by_schema(self) -> None:
        for field, value in (
            ("status", "UNKNOWN"),
            ("historyWindowDays", 0),
            ("historyWindowDays", -1),
            ("historyWindowDays", 90.5),
        ):
            data = make_result().to_dict()
            data["coverage"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(
                MarketContractError
            ):
                validate_historical_market_search_result(data)

    def test_result_request_and_temporal_dates_must_match_evidence_date(self) -> None:
        wrong_request = make_result(request=make_request(evidence_date="2026-05-18"))
        wrong_temporal = make_result(
            make_evidence(
                temporal=make_temporal(evidence_date="2026-05-18")
            )
        )

        for result, expected_path in (
            (wrong_request, "$.request.evidenceDate"),
            (wrong_temporal, "temporalEvidence.evidenceDate"),
        ):
            with self.subTest(path=expected_path), self.assertRaises(
                MarketContractError
            ) as raised:
                validate_historical_market_search_result(result)
            self.assertTrue(
                any(expected_path in d for d in raised.exception.details),
                raised.exception.details,
            )

    def test_malformed_result_dates_are_rejected(self) -> None:
        for field, value in (
            ("evidenceDate", "2026-13-01"),
            ("asOfDate", "2026-08-10T12:00:00Z"),
        ):
            data = make_result().to_dict()
            data[field] = value
            with self.subTest(field=field), self.assertRaises(MarketContractError):
                validate_historical_market_search_result(data)

    def test_result_count_must_match_evidence_and_respect_request_limit(self) -> None:
        wrong_count = make_result(make_evidence()).to_dict()
        wrong_count["listingCount"] = 0
        over_limit = make_result(
            make_evidence(), request=make_request(result_limit=1)
        ).to_dict()
        over_limit["evidence"].append(make_evidence(2).to_dict())
        over_limit["listingCount"] = 2

        for data, expected in (
            (wrong_count, "does not match"),
            (over_limit, "exceeds"),
        ):
            with self.subTest(expected=expected), self.assertRaises(
                MarketContractError
            ) as raised:
                validate_historical_market_search_result(data)
            self.assertTrue(any(expected in d for d in raised.exception.details))

    def test_listing_source_must_match_result_provider(self) -> None:
        result = make_result(make_evidence(source="another-provider"))

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("listing.source" in d for d in raised.exception.details))

    def test_duplicate_vin_is_rejected_case_insensitively(self) -> None:
        result = make_result(
            make_evidence(1, vin="SyntheticVin"),
            make_evidence(2, vin="SYNTHETICVIN"),
        )

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("duplicate" in d for d in raised.exception.details))

    def test_duplicate_fallback_listing_identity_is_rejected_without_vins(self) -> None:
        result = make_result(
            make_evidence(1, vin=None, source_listing_id="same-record"),
            make_evidence(2, vin=None, source_listing_id="same-record"),
        )

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("duplicate" in d for d in raised.exception.details))

    def test_repeated_source_listing_id_is_rejected_for_distinct_vins(
        self,
    ) -> None:
        """Every valid historical result must be projectable to MarketSearchResult."""

        result = make_result(
            make_evidence(1, vin="SYNTHETIC-VIN-A", source_listing_id="same-record"),
            make_evidence(2, vin="SYNTHETIC-VIN-B", source_listing_id="same-record"),
        )

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("duplicate" in d for d in raised.exception.details))

    def test_resolved_evidence_requires_vin_or_provider_listing_identity(self) -> None:
        result = make_result(make_evidence(vin=None, source_listing_id=None))

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(result)

        self.assertTrue(any("required" in d for d in raised.exception.details))

    def test_issue_counts_must_match_issue_statuses(self) -> None:
        data = make_result(issues=(make_issue(),)).to_dict()
        data["unresolvedCount"] = 0
        data["ambiguousCount"] = 1

        with self.assertRaises(MarketContractError) as raised:
            validate_historical_market_search_result(data)

        self.assertTrue(any("unresolvedCount" in d for d in raised.exception.details))
        self.assertTrue(any("ambiguousCount" in d for d in raised.exception.details))

    def test_issue_status_reason_and_identity_invariants_are_enforced(self) -> None:
        invalid_issues = (
            make_issue(status=AMBIGUOUS),
            make_issue(
                status=UNRESOLVED,
                reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
            ),
            make_issue(
                reason="MISSING_LISTING_IDENTITY",
                vin="SHOULD-NOT-BE-PRESENT",
                source_listing_id=None,
            ),
            make_issue(vin=None, source_listing_id=None),
        )
        for issue in invalid_issues:
            with self.subTest(issue=issue), self.assertRaises(MarketContractError):
                validate_historical_market_search_result(make_result(issues=(issue,)))

    def test_unknown_fields_are_rejected_at_result_coverage_and_issue_levels(
        self,
    ) -> None:
        cases: list[dict[str, Any]] = []
        root = make_result().to_dict()
        root["currentListings"] = []
        cases.append(root)
        coverage = make_result().to_dict()
        coverage["coverage"]["providerWindow"] = "rolling"
        cases.append(coverage)
        issue = make_result(issues=(make_issue(),)).to_dict()
        issue["issues"][0]["rawRecord"] = {}
        cases.append(issue)

        for data in cases:
            with self.subTest(data=data), self.assertRaises(MarketContractError):
                validate_historical_market_search_result(data)

    def test_out_of_range_result_cannot_contain_evidence_or_issues(self) -> None:
        out_of_range = HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90)
        results = (
            make_result(
                make_evidence(
                    temporal=make_temporal(evidence_date="2026-05-11")
                ),
                evidence_date="2026-05-11",
                coverage=out_of_range,
            ),
            make_result(
                evidence_date="2026-05-11",
                coverage=out_of_range,
                issues=(make_issue(),),
            ),
        )
        for result in results:
            with self.subTest(result=result), self.assertRaises(MarketContractError):
                validate_historical_market_search_result(result)

    def test_incomplete_pagination_cannot_contain_resolved_evidence(self) -> None:
        pagination_issue = make_issue(
            reason="PAGINATION_SAFETY_LIMIT_REACHED",
            vin=None,
            source_listing_id=None,
        )
        with self.assertRaises(MarketContractError):
            validate_historical_market_search_result(
                make_result(make_evidence(), issues=(pagination_issue,))
            )

    def test_result_defensively_copies_collection_containers_and_order(self) -> None:
        evidence = [make_evidence(2), make_evidence(1)]
        issues = [make_issue()]
        result = HistoricalMarketSearchResult(
            provider=SYNTHETIC_PROVIDER,
            evidence_date=EVIDENCE_DATE,
            as_of_date=AS_OF_DATE,
            coverage=HistoricalCoverage(SUPPORTED, 90),
            request=make_request(),
            evidence=evidence,  # type: ignore[arg-type]
            issues=issues,  # type: ignore[arg-type]
        )
        evidence.clear()
        issues.clear()

        self.assertEqual(
            [item.listing.source_listing_id for item in result.evidence],
            ["synthetic-record-002", "synthetic-record-001"],
        )
        self.assertEqual(len(result.issues), 1)
        self.assertIsInstance(result.evidence, tuple)
        self.assertIsInstance(result.issues, tuple)
        validate_historical_market_search_result(result)

    def test_mapping_validation_does_not_mutate_the_caller_value(self) -> None:
        data = make_result(make_evidence()).to_dict()
        before = copy.deepcopy(data)

        validate_historical_market_search_result(data)

        self.assertEqual(data, before)


class HistoricalDiscoveryTests(unittest.TestCase):
    def test_historical_provider_protocol_is_structural_and_separate(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(request=request)
        )

        self.assertIsInstance(provider, HistoricalMarketProvider)

        class CurrentOnlyProvider:
            name = SYNTHETIC_PROVIDER

            def search(self, request: MarketSearchRequest) -> MarketSearchResult:
                raise AssertionError

        self.assertNotIsInstance(CurrentOnlyProvider(), HistoricalMarketProvider)

    def test_discovery_passes_new_normalized_request_once_and_returns_result(
        self,
    ) -> None:
        returned: list[HistoricalMarketSearchResult] = []

        def factory(
            request: HistoricalMarketSearchRequest,
        ) -> HistoricalMarketSearchResult:
            result = make_result(make_evidence(), request=request)
            returned.append(result)
            return result

        provider = StaticHistoricalProvider(factory)
        original = make_request()
        before = original.to_dict()

        discovered = discover_historical_market_evidence(original, provider)

        self.assertIs(discovered, returned[0])
        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(provider.requests[0], original)
        self.assertIsNot(provider.requests[0], original)
        self.assertEqual(original.to_dict(), before)

    def test_discovery_is_offline_and_requires_no_environment_credentials(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(request=request)
        )
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("network access attempted"),
            ),
        ):
            result = discover_historical_market_evidence(make_request(), provider)

        self.assertEqual(result.listing_count, 0)

    def test_invalid_request_is_rejected_before_provider_invocation(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(request=request)
        )

        with self.assertRaises(MarketContractError):
            discover_historical_market_evidence(
                make_request(result_limit=0), provider
            )

        self.assertEqual(provider.requests, [])

    def test_blank_or_unreadable_provider_name_is_rejected_before_search(self) -> None:
        blank = StaticHistoricalProvider(
            lambda request: make_result(request=request), name=" "
        )
        with self.assertRaises(MarketProviderResponseError):
            discover_historical_market_evidence(make_request(), blank)
        self.assertEqual(blank.requests, [])

        with self.assertRaises(MarketProviderResponseError):
            discover_historical_market_evidence(make_request(), RaisingNameProvider())

    def test_provider_errors_are_preserved_and_generic_failures_are_sanitized(
        self,
    ) -> None:
        rate_limit = MarketProviderRateLimitError("synthetic quota exhausted")
        provider_error = StaticHistoricalProvider(
            lambda request: (_ for _ in ()).throw(rate_limit)
        )
        with self.assertRaises(MarketProviderRateLimitError) as raised:
            discover_historical_market_evidence(make_request(), provider_error)
        self.assertIs(raised.exception, rate_limit)

        raw_secret = "synthetic-secret-bearing-provider-message"
        generic_error = StaticHistoricalProvider(
            lambda request: (_ for _ in ()).throw(RuntimeError(raw_secret))
        )
        with self.assertRaises(MarketProviderError) as generic_raised:
            discover_historical_market_evidence(make_request(), generic_error)
        self.assertNotIn(raw_secret, str(generic_raised.exception))

    def test_provider_contract_error_becomes_response_error_with_details(self) -> None:
        contract_error = MarketContractError(
            "synthetic normalization failure", ("$.listing: synthetic detail",)
        )
        provider = StaticHistoricalProvider(
            lambda request: (_ for _ in ()).throw(contract_error)
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_historical_market_evidence(make_request(), provider)

        self.assertEqual(raised.exception.details, contract_error.details)
        self.assertIs(raised.exception.__cause__, contract_error)

    def test_noncanonical_provider_result_is_rejected(self) -> None:
        for value in (None, {}, MarketSearchResult):
            provider = StaticHistoricalProvider(lambda request, value=value: value)
            with self.subTest(value=value), self.assertRaises(
                MarketProviderResponseError
            ) as raised:
                discover_historical_market_evidence(make_request(), provider)
            self.assertTrue(any("got" in d for d in raised.exception.details))

    def test_invalid_canonical_result_maps_to_provider_response_error(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(
                make_evidence(source="wrong-provider"), request=request
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_historical_market_evidence(make_request(), provider)

        self.assertTrue(any("listing.source" in d for d in raised.exception.details))

    def test_result_provider_must_echo_adapter_name(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(
                provider="different-provider", request=request
            )
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_historical_market_evidence(make_request(), provider)

        self.assertTrue(any("provider" in d for d in raised.exception.details))

    def test_result_must_echo_the_exact_normalized_request(self) -> None:
        provider = StaticHistoricalProvider(
            lambda request: make_result(request=make_request(radius_miles=100))
        )

        with self.assertRaises(MarketProviderResponseError) as raised:
            discover_historical_market_evidence(make_request(), provider)

        self.assertTrue(any("request" in d for d in raised.exception.details))

    def test_historical_discovery_never_falls_back_to_current_search(self) -> None:
        class DualProvider(StaticHistoricalProvider):
            def search(self, request: MarketSearchRequest) -> MarketSearchResult:
                raise AssertionError("current inventory fallback attempted")

        provider = DualProvider(
            lambda request: make_result(
                evidence_date="2026-05-11",
                as_of_date=AS_OF_DATE,
                coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90),
                request=request,
            )
        )
        request = make_request(evidence_date="2026-05-11")

        result = discover_historical_market_evidence(request, provider)

        self.assertEqual(result.coverage.status, OUT_OF_PROVIDER_RANGE)
        self.assertEqual(result.listing_count, 0)
        self.assertEqual(len(provider.requests), 1)


class HistoricalProjectionAndScorerTests(unittest.TestCase):
    def test_projection_returns_the_unchanged_market_result_contract(self) -> None:
        first = make_evidence(1)
        second = make_evidence(2)
        historical = make_result(
            first,
            second,
            issues=(make_issue(),),
        )

        projected = historical_evidence_to_market_search_result(historical)

        self.assertIsInstance(projected, MarketSearchResult)
        self.assertIsInstance(projected.request, MarketSearchRequest)
        self.assertEqual(projected.provider, historical.provider)
        self.assertEqual(projected.listing_count, 2)
        self.assertIs(projected.listings[0], first.listing)
        self.assertIs(projected.listings[1], second.listing)
        self.assertNotIn("evidenceDate", projected.request.to_dict())
        self.assertNotIn("temporalEvidence", projected.listings[0].to_dict())
        validate_market_search_result(projected)

    def test_projection_preserves_resolved_order_and_excludes_issues(self) -> None:
        historical = make_result(
            make_evidence(2),
            make_evidence(1),
            issues=(make_issue(),),
        )

        projected = historical_evidence_to_market_search_result(historical)

        self.assertEqual(
            [listing.source_listing_id for listing in projected.listings],
            ["synthetic-record-002", "synthetic-record-001"],
        )
        self.assertEqual(projected.listing_count, historical.listing_count)

    def test_out_of_range_result_cannot_be_projected_as_market_evidence(self) -> None:
        historical = make_result(
            evidence_date="2026-05-11",
            coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90),
        )

        with self.assertRaises(MarketContractError) as raised:
            historical_evidence_to_market_search_result(historical)

        self.assertTrue(
            any("coverage.status" in detail for detail in raised.exception.details)
        )

    def test_incomplete_pagination_cannot_be_projected_as_market_evidence(
        self,
    ) -> None:
        pagination_issue = make_issue(
            reason="PAGINATION_SAFETY_LIMIT_REACHED",
            vin=None,
            source_listing_id=None,
        )
        historical = make_result(issues=(pagination_issue,))

        with self.assertRaises(MarketContractError):
            historical_evidence_to_market_search_result(historical)

    def test_invalid_historical_result_cannot_be_projected(self) -> None:
        invalid = make_result(make_evidence(source="wrong-provider"))

        with self.assertRaises(MarketContractError):
            historical_evidence_to_market_search_result(invalid)

    def test_resolved_historical_listings_compose_with_phase_3c_scorer(self) -> None:
        historical = make_result(
            make_evidence(
                mileage=46_926,
                distance_miles=10,
                price=12_345,
            )
        )
        projected = historical_evidence_to_market_search_result(historical)
        target = comparable_target_from_search_request(projected.request)

        ranked = rank_market_comparables(target, projected)

        self.assertEqual(ranked.provider, SYNTHETIC_PROVIDER)
        self.assertEqual(ranked.total_listing_count, 1)
        self.assertEqual(ranked.eligible_count, 1)
        self.assertEqual(ranked.candidates[0].score, 100)
        self.assertEqual(ranked.candidates[0].rank, 1)
        self.assertEqual(ranked.candidates[0].listing.price, 12_345)

    def test_historical_projection_keeps_phase_3c_price_neutral(self) -> None:
        base = make_result(
            make_evidence(1, mileage=48_000, price=5_000),
            make_evidence(2, mileage=70_000, price=90_000),
        )
        prices_reversed = make_result(
            make_evidence(1, mileage=48_000, price=900_000),
            make_evidence(2, mileage=70_000, price=500),
        )

        def similarity(result: HistoricalMarketSearchResult) -> dict[str, Any]:
            projected = historical_evidence_to_market_search_result(result)
            target = comparable_target_from_search_request(projected.request)
            ranked = rank_market_comparables(target, projected)
            return {
                candidate.listing.source_listing_id: (
                    candidate.rank,
                    candidate.score,
                    candidate.tier,
                    candidate.components.to_dict(),
                    candidate.reasons,
                )
                for candidate in ranked.candidates
            }

        self.assertEqual(similarity(base), similarity(prices_reversed))


if __name__ == "__main__":
    unittest.main()
