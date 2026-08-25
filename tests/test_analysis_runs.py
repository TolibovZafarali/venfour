"""Offline end-to-end tests for Phase 3D.2 orchestration and audit storage.

Every report, vehicle, VIN, listing, provider, credential, and price in this
module is fictional test data.  The tests use canonical in-memory providers and
temporary filesystem repositories; they make no network or model calls.
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timezone, tzinfo
from pathlib import Path
from typing import Any
from unittest.mock import patch

from jsonschema import Draft202012Validator

from venfour.adaptive_search import (
    CURRENT_SEARCH_CEILING_REACHED,
    DEFAULT_ADAPTIVE_SEARCH_POLICY,
    DEFAULT_SEARCH_STAGES,
    HISTORICAL_SEARCH_STAGES,
    HISTORICAL_SEARCH_CEILING_REACHED,
    AdaptiveSearchPolicies,
)
from venfour.analysis_runs import (
    ANALYSIS_RUN_SCHEMA_PATH,
    AnalysisRunAlreadyExistsError,
    AnalysisRunArtifact,
    AnalysisRunContractError,
    AnalysisRunNotFoundError,
    AnalysisRunRepositoryError,
    AnalysisRunWriteError,
    FileAnalysisRunRepository,
    InvalidAnalysisRunArtifactError,
    canonical_json_bytes,
    discrepancy_request_digest,
    validate_analysis_run_artifact,
)
from venfour.discrepancy import (
    CONFLICTING_EVIDENCE,
    CURRENT_MARKET,
    INSUFFICIENT_EVIDENCE,
    LOSS_DATE_HISTORICAL,
    MATERIAL_UNDERVALUE_SIGNAL,
    NO_MATERIAL_DISCREPANCY,
    POTENTIAL_UNDERVALUE,
)
from venfour.historical_market import (
    AMBIGUOUS,
    LISTING_RECORD_ACTIVE_ON_DATE,
    OUT_OF_PROVIDER_RANGE,
    RESOLVED,
    SUPPORTED,
    UNRESOLVED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
)
from venfour.market import (
    MarketDealer,
    MarketListing,
    MarketProviderDiagnostic,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketSearchRequest,
    MarketSearchResult,
)
from venfour.orchestration import (
    AnalysisExecutionError,
    AnalysisOrchestrator,
    AnalysisPersistenceError,
    AnalysisRetrievalError,
    AnalysisRunRequest,
    CurrentMarketSearchConfiguration,
    HistoricalMarketSearchConfiguration,
)


LOSS_DATE = "2026-05-19"
CURRENT_OBSERVED_DATE = "2026-08-10"
SUPPORTED_AS_OF_DATE = "2026-08-10"
OUT_OF_RANGE_AS_OF_DATE = "2026-08-20"
POSTAL_CODE = "63026"
CURRENT_PROVIDER = "synthetic-current"
HISTORICAL_PROVIDER = "synthetic-historical"
FIXED_CREATED_AT = datetime(2026, 8, 21, 12, 34, 56, 789000, tzinfo=timezone.utc)

RUN_ID_1 = "00000000-0000-4000-8000-000000000001"
RUN_ID_2 = "00000000-0000-4000-8000-000000000002"
RUN_ID_3 = "00000000-0000-4000-8000-000000000003"

CONSISTENT_PRICES = (1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000)
POTENTIAL_PRICES = (2_080_000, 2_100_000, 2_120_000, 2_130_000, 2_140_000)
MATERIAL_PRICES = (2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000)
CONFLICTING_PRICES = (1_200_000, 1_600_000, 2_000_000, 2_400_000, 2_800_000)


def dollars(cents: int) -> int | float:
    """Represent exact integer cents using the public dollar JSON contract."""

    return cents // 100 if cents % 100 == 0 else cents / 100


def make_ccc_comparable(
    number: int,
    *,
    list_price_cents: int,
    adjustment_cents: tuple[int, int, int, int],
) -> dict[str, Any]:
    package, options, mileage, condition = adjustment_cents
    adjusted_value_cents = list_price_cents + sum(adjustment_cents)
    return {
        "number": number,
        "year": 2024,
        "make": "Synthetic",
        "model": "Sedan",
        "trim": "SEL",
        "vin": f"SYNTHETICCCCVIN{number:02d}",
        "dealer": f"Synthetic CCC Dealer {number}",
        "location": "Test City, MO 63026",
        "distanceMiles": 10 + number,
        "mileage": 49_000 + number * 500,
        "listPrice": dollars(list_price_cents),
        "adjustments": {
            "package": dollars(package),
            "options": dollars(options),
            "mileage": dollars(mileage),
            "condition": dollars(condition),
        },
        "adjustedValue": dollars(adjusted_value_cents),
        "contributionPercent": (34, 33, 33)[number - 1],
    }


def make_report() -> dict[str, Any]:
    """Return a fully populated report satisfying the API-strict CCC shape."""

    return {
        "report": {
            "provider": "CCC",
            "reportReferenceNumber": "SYNTHETIC-REPORT-001",
            "claimReferenceNumber": "SYNTHETIC-CLAIM-001",
            "lossDate": "05/19/2026",
            "reportDate": "05/21/2026",
        },
        "vehicle": {
            "year": 2024,
            "make": "Synthetic",
            "model": "Sedan",
            "trim": "SEL",
            "vin": "SYNTHETICLOSS0001",
            "mileage": 50_000,
            "location": "Test City, MO 63026",
            "bodyStyle": "Sedan",
            "engine": "Synthetic 2.0L",
            "transmission": "Automatic",
            "fuelType": "Gasoline",
            "equipment": ["Synthetic Safety Package", "Synthetic Audio"],
        },
        "valuation": {
            "baseVehicleValue": 20_100,
            "conditionAdjustment": -100,
            "adjustedVehicleValue": 20_000,
            "total": 20_000,
        },
        "condition": {
            "totalAdjustment": -100,
            "items": [
                {
                    "category": "Exterior",
                    "component": "Synthetic panel",
                    "rating": "Synthetic rating",
                    "notes": "Fictional test condition only.",
                    "valueImpact": -100,
                }
            ],
        },
        "comparables": [
            make_ccc_comparable(
                1,
                list_price_cents=1_980_000,
                adjustment_cents=(10_000, 5_000, 2_500, 2_500),
            ),
            make_ccc_comparable(
                2,
                list_price_cents=2_010_000,
                adjustment_cents=(-5_000, -2_500, -2_500, 0),
            ),
            make_ccc_comparable(
                3,
                list_price_cents=2_040_000,
                adjustment_cents=(-10_000, -10_000, -10_000, -10_000),
            ),
        ],
        "valuationNotes": ["Fictional CCC note used only for testing."],
        "supplementalInformation": {
            "historyChecks": ["Synthetic history check"],
            "historyEvents": ["Synthetic history event"],
            "recalls": ["Synthetic recall entry"],
        },
    }


def make_listing(provider: str, index: int, price_cents: int) -> MarketListing:
    return MarketListing(
        source=provider,
        source_listing_id=f"{provider}-listing-{index:03d}",
        listing_url=f"https://listings.invalid/{provider}/{index}",
        year=2024,
        make="Synthetic",
        model="Sedan",
        trim="SEL",
        vin=f"SYNTHETICVIN{index:05d}",
        mileage=50_000 + (index - 1) * 500,
        price=dollars(price_cents),
        dealer=MarketDealer(
            name=f"Synthetic Dealer {index}",
            city="Test City",
            state="MO",
            postal_code=POSTAL_CODE,
        ),
        distance_miles=5 + index,
    )


class RecordingCurrentProvider:
    """Canonical current provider whose response and call count are deterministic."""

    name = CURRENT_PROVIDER

    def __init__(
        self,
        prices: tuple[int, ...] = CONSISTENT_PRICES,
        *,
        failure: Exception | None = None,
        failure_at_radius: int | None = None,
        secret: str = "synthetic-unused-provider-secret",
    ) -> None:
        self.prices = prices
        self.failure = failure
        self.failure_at_radius = failure_at_radius
        self.requests: list[MarketSearchRequest] = []
        # Deliberately unsafe adapter internals must never be serialized.
        self.api_key = secret
        self.authorization_header = f"Bearer {secret}"
        self.endpoint = f"https://provider.invalid/search?api_key={secret}"

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        self.requests.append(request)
        if self.failure is not None and (
            self.failure_at_radius is None
            or request.radius_miles == self.failure_at_radius
        ):
            raise self.failure
        return MarketSearchResult(
            provider=self.name,
            request=request,
            listings=tuple(
                make_listing(self.name, index, price)
                for index, price in enumerate(self.prices, start=1)
            ),
        )


class RecordingHistoricalProvider:
    """Canonical historical provider with resolved evidence and diagnostics."""

    name = HISTORICAL_PROVIDER

    def __init__(
        self,
        prices: tuple[int, ...] = CONSISTENT_PRICES,
        *,
        coverage_status: str = SUPPORTED,
        issues: tuple[HistoricalEvidenceIssue, ...] = (),
        failure: Exception | None = None,
        secret: str = "synthetic-unused-historical-secret",
    ) -> None:
        self.prices = prices
        self.coverage_status = coverage_status
        self.issues = issues
        self.failure = failure
        self.requests: list[HistoricalMarketSearchRequest] = []
        self.api_key = secret
        self.endpoint = f"https://history.invalid/search?token={secret}"

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        as_of_date = (
            SUPPORTED_AS_OF_DATE
            if self.coverage_status == SUPPORTED
            else OUT_OF_RANGE_AS_OF_DATE
        )
        evidence = ()
        if self.coverage_status == SUPPORTED:
            evidence = tuple(
                HistoricalEvidenceItem(
                    listing=make_listing(self.name, index, price),
                    temporal_evidence=TemporalEvidence(
                        evidence_date=request.evidence_date,
                        record_first_seen_at="2026-05-18T12:00:00Z",
                        record_last_seen_at="2026-05-20T12:00:00Z",
                        source_first_seen_at="2026-05-01T00:00:00Z",
                        source_last_seen_at="2026-05-31T23:59:59Z",
                        status=RESOLVED,
                        basis=LISTING_RECORD_ACTIVE_ON_DATE,
                    ),
                )
                for index, price in enumerate(self.prices, start=1)
            )
        return HistoricalMarketSearchResult(
            provider=self.name,
            evidence_date=request.evidence_date,
            as_of_date=as_of_date,
            coverage=HistoricalCoverage(
                status=self.coverage_status,
                history_window_days=90,
            ),
            request=request,
            evidence=evidence,
            issues=self.issues if self.coverage_status == SUPPORTED else (),
        )


class CredentialUrlCurrentProvider(RecordingCurrentProvider):
    def __init__(self, listing_url: str) -> None:
        super().__init__()
        self.listing_url = listing_url

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        result = super().search(request)
        listings = list(result.listings)
        listings[0] = replace(listings[0], listing_url=self.listing_url)
        return MarketSearchResult(result.provider, result.request, tuple(listings))


class FailingRepository:
    """Structural repository double that fails only at durable persistence."""

    def __init__(self) -> None:
        self.save_calls: list[AnalysisRunArtifact] = []

    def save(self, artifact: AnalysisRunArtifact) -> None:
        self.save_calls.append(artifact)
        raise AnalysisRunWriteError("synthetic persistence failure")

    def get(self, run_id: str) -> AnalysisRunArtifact:
        raise AnalysisRunNotFoundError(run_id)


class IndeterminateTimezone(tzinfo):
    def utcoffset(self, value: datetime | None) -> None:
        return None

    def dst(self, value: datetime | None) -> None:
        return None

    def tzname(self, value: datetime | None) -> str:
        return "indeterminate"


def make_run_request(
    *,
    current: bool = True,
    historical: bool = True,
) -> AnalysisRunRequest:
    return AnalysisRunRequest(
        ccc_report=make_report(),
        postal_code=POSTAL_CODE,
        current_search=(
            CurrentMarketSearchConfiguration(
                observed_date=CURRENT_OBSERVED_DATE,
            )
            if current
            else None
        ),
        historical_search=(
            HistoricalMarketSearchConfiguration()
            if historical
            else None
        ),
    )


def make_orchestrator(
    repository: Any,
    *,
    current_provider: RecordingCurrentProvider | None,
    historical_provider: RecordingHistoricalProvider | None,
    run_id: str = RUN_ID_1,
    created_at: datetime = FIXED_CREATED_AT,
) -> AnalysisOrchestrator:
    return AnalysisOrchestrator(
        repository,
        current_provider=current_provider,
        historical_provider=historical_provider,
        current_provider_version="fixture-current-1" if current_provider else None,
        historical_provider_version=(
            "fixture-historical-1" if historical_provider else None
        ),
        run_id_factory=lambda: run_id,
        clock=lambda: created_at,
    )


def write_artifact(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


class TemporaryRepositoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def repository(self, child: str = "runs") -> FileAnalysisRunRepository:
        return FileAnalysisRunRepository(self.root / child)

    def run_saved(
        self,
        *,
        child: str = "runs",
        run_id: str = RUN_ID_1,
        historical_prices: tuple[int, ...] = CONSISTENT_PRICES,
        current_prices: tuple[int, ...] = CONSISTENT_PRICES,
        current: bool = True,
        historical: bool = True,
        coverage_status: str = SUPPORTED,
        issues: tuple[HistoricalEvidenceIssue, ...] = (),
        created_at: datetime = FIXED_CREATED_AT,
    ) -> tuple[
        FileAnalysisRunRepository,
        RecordingCurrentProvider | None,
        RecordingHistoricalProvider | None,
        AnalysisRunArtifact,
    ]:
        repository = self.repository(child)
        current_provider = (
            RecordingCurrentProvider(current_prices) if current else None
        )
        historical_provider = (
            RecordingHistoricalProvider(
                historical_prices,
                coverage_status=coverage_status,
                issues=issues,
            )
            if historical
            else None
        )
        result = make_orchestrator(
            repository,
            current_provider=current_provider,
            historical_provider=historical_provider,
            run_id=run_id,
            created_at=created_at,
        ).run(make_run_request(current=current, historical=historical))
        return repository, current_provider, historical_provider, result.artifact


class AnalysisOrchestrationScenarioTests(TemporaryRepositoryTestCase):
    def test_successful_historical_primary_round_trip_with_current_secondary(self) -> None:
        report_before = make_report()
        request = AnalysisRunRequest(
            ccc_report=report_before,
            postal_code=POSTAL_CODE,
            current_search=CurrentMarketSearchConfiguration(CURRENT_OBSERVED_DATE),
            historical_search=HistoricalMarketSearchConfiguration(),
        )
        current_provider = RecordingCurrentProvider(MATERIAL_PRICES)
        historical_provider = RecordingHistoricalProvider(CONSISTENT_PRICES)
        repository = self.repository()

        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("network access attempted"),
            ),
        ):
            result = make_orchestrator(
                repository,
                current_provider=current_provider,
                historical_provider=historical_provider,
            ).run(request)

        loaded = repository.get(result.run_id)
        self.assertEqual(loaded.to_dict(), result.artifact.to_dict())
        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)
        self.assertEqual(
            loaded.result["discrepancyResult"]["evidenceBasis"],
            LOSS_DATE_HISTORICAL,
        )
        self.assertIsNotNone(loaded.result["currentMarketResult"])
        self.assertIsNotNone(loaded.result["historicalMarketResult"])
        self.assertEqual(
            loaded.providers,
            {
                "current": {
                    "name": CURRENT_PROVIDER,
                    "version": "fixture-current-1",
                },
                "historical": {
                    "name": HISTORICAL_PROVIDER,
                    "version": "fixture-historical-1",
                },
            },
        )
        self.assertEqual(report_before, make_report())
        expected_current_stages = [
            (stage.radius_miles, stage.result_limit)
            for stage in DEFAULT_SEARCH_STAGES
        ]
        expected_historical_stages = [
            (stage.radius_miles, stage.result_limit)
            for stage in HISTORICAL_SEARCH_STAGES
        ]
        self.assertEqual(
            [
                (provider_request.radius_miles, provider_request.result_limit)
                for provider_request in current_provider.requests
            ],
            expected_current_stages,
        )
        self.assertEqual(
            [
                (provider_request.radius_miles, provider_request.result_limit)
                for provider_request in historical_provider.requests
            ],
            expected_historical_stages,
        )
        self.assertEqual(
            current_provider.requests[0].to_dict(),
            {
                "year": 2024,
                "make": "Synthetic",
                "model": "Sedan",
                "trim": "SEL",
                "lossVehicleMileage": 50_000,
                "postalCode": POSTAL_CODE,
                "radiusMiles": 50,
                "resultLimit": 25,
            },
        )
        self.assertEqual(
            historical_provider.requests[0].to_dict(),
            {
                "evidenceDate": LOSS_DATE,
                "year": 2024,
                "make": "Synthetic",
                "model": "Sedan",
                "trim": "SEL",
                "lossVehicleMileage": 50_000,
                "postalCode": POSTAL_CODE,
                "radiusMiles": 50,
                "resultLimit": 25,
            },
        )
        artifact_data = loaded.to_dict()
        self.assertEqual(artifact_data["analysisRunSchemaVersion"], "6")
        self.assertEqual(artifact_data["analysisVersion"], "5")
        self.assertEqual(artifact_data["evidenceContext"]["inputMode"], "REPORT")
        self.assertEqual(len(artifact_data["searchDiagnosticsDigest"]), 64)
        expected_diagnostics = {
            "current": ("MAX_SCOPE_REACHED", 4),
            "historical": (HISTORICAL_SEARCH_CEILING_REACHED, 2),
        }
        for stream, (stop_reason, attempt_count) in expected_diagnostics.items():
            diagnostics = artifact_data["result"]["searchDiagnostics"][stream]
            self.assertEqual(diagnostics["stopReason"], stop_reason)
            self.assertEqual(len(diagnostics["attempts"]), attempt_count)
            self.assertEqual(
                [attempt["strongMatchCount"] for attempt in diagnostics["attempts"]],
                [5] * attempt_count,
            )
            self.assertEqual(
                [attempt["newUniqueCount"] for attempt in diagnostics["attempts"]],
                [5] + [0] * (attempt_count - 1),
            )
        self.assertEqual(list(repository.root.glob(".*.tmp")), [])

    def test_historical_out_of_range_is_preserved_and_current_becomes_primary(self) -> None:
        repository, current, historical, artifact = self.run_saved(
            coverage_status=OUT_OF_PROVIDER_RANGE,
            historical_prices=(),
            current_prices=MATERIAL_PRICES,
        )

        loaded = repository.get(artifact.run_id)
        self.assertEqual(len(current.requests), len(DEFAULT_SEARCH_STAGES))
        self.assertEqual(len(historical.requests), 1)
        self.assertEqual(
            loaded.result["historicalMarketResult"]["coverage"]["status"],
            OUT_OF_PROVIDER_RANGE,
        )
        self.assertIsNone(loaded.result["historicalRanking"])
        self.assertIsNone(
            loaded.result["discrepancyRequest"]["historicalEvidence"]["ranking"]
        )
        self.assertEqual(
            loaded.result["discrepancyResult"]["evidenceBasis"], CURRENT_MARKET
        )
        self.assertEqual(
            loaded.result["discrepancyResult"]["classification"],
            POTENTIAL_UNDERVALUE,
        )

    def test_loss_date_override_provenance_is_preserved(self) -> None:
        report = make_report()
        report["report"]["lossDate"] = "05/18/2026"
        request = AnalysisRunRequest(
            ccc_report=report,
            postal_code=POSTAL_CODE,
            loss_date_override=LOSS_DATE,
            historical_search=HistoricalMarketSearchConfiguration(),
        )
        repository = self.repository()
        historical = RecordingHistoricalProvider()

        artifact = make_orchestrator(
            repository,
            current_provider=None,
            historical_provider=historical,
        ).run(request).artifact

        loaded = repository.get(artifact.run_id)
        self.assertEqual(loaded.request["lossDateSource"], "OVERRIDE")
        self.assertEqual(loaded.request["lossDateOverride"], LOSS_DATE)
        self.assertEqual(
            loaded.request["baseDiscrepancyRequest"]["lossDate"], LOSS_DATE
        )
        self.assertEqual(historical.requests[0].evidence_date, LOSS_DATE)

    def test_returned_artifact_cannot_diverge_from_persisted_snapshot(self) -> None:
        repository, _, _, artifact = self.run_saved()
        persisted = repository.get(artifact.run_id).to_dict()

        with self.assertRaises(TypeError):
            artifact.result["discrepancyResult"]["classification"] = "MUTATED"

        self.assertEqual(artifact.to_dict(), persisted)

    def test_empty_supported_evidence_is_a_persisted_insufficient_result(self) -> None:
        repository, _, historical, artifact = self.run_saved(
            current=False,
            historical_prices=(),
        )

        loaded = repository.get(artifact.run_id)
        self.assertEqual(len(historical.requests), len(HISTORICAL_SEARCH_STAGES))
        self.assertEqual(
            loaded.result["discrepancyResult"]["classification"],
            INSUFFICIENT_EVIDENCE,
        )
        self.assertEqual(
            loaded.result["historicalMarketResult"]["listingCount"], 0
        )
        self.assertIsNone(loaded.result["historicalRanking"])
        self.assertEqual(
            loaded.result["searchDiagnostics"]["historical"]["stopReason"],
            HISTORICAL_SEARCH_CEILING_REACHED,
        )

    def test_sparse_historical_evidence_at_ceiling_is_preserved(self) -> None:
        repository, current, historical, artifact = self.run_saved(
            current=False,
            historical_prices=MATERIAL_PRICES,
        )

        loaded = repository.get(artifact.run_id)
        self.assertIsNone(current)
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in historical.requests
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            loaded.result["searchDiagnostics"]["historical"]["stopReason"],
            HISTORICAL_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(
            loaded.result["historicalMarketResult"]["listingCount"], 5
        )
        self.assertEqual(loaded.result["historicalRanking"]["eligibleCount"], 5)

    def test_declared_provider_radius_caps_effective_persisted_policy(self) -> None:
        repository = self.repository()
        historical = RecordingHistoricalProvider(MATERIAL_PRICES)
        historical.maximum_search_radius_miles = 100
        request = replace(
            make_run_request(current=False),
            search_policies=AdaptiveSearchPolicies(
                current=DEFAULT_ADAPTIVE_SEARCH_POLICY,
                historical=DEFAULT_ADAPTIVE_SEARCH_POLICY,
            ),
        )

        artifact = make_orchestrator(
            repository,
            current_provider=None,
            historical_provider=historical,
        ).run(request).artifact.to_dict()

        self.assertEqual(
            [request.radius_miles for request in historical.requests], [50, 100]
        )
        self.assertEqual(
            [
                stage["radiusMiles"]
                for stage in artifact["request"]["searchPolicies"]["historical"][
                    "stages"
                ]
            ],
            [50, 100],
        )
        self.assertEqual(
            artifact["result"]["searchDiagnostics"]["historical"]["stopReason"],
            HISTORICAL_SEARCH_CEILING_REACHED,
        )

    def test_current_provider_ceiling_is_persisted_with_sparse_evidence(self) -> None:
        repository = self.repository()
        current = RecordingCurrentProvider(MATERIAL_PRICES)
        current.maximum_search_radius_miles = 100

        result = make_orchestrator(
            repository,
            current_provider=current,
            historical_provider=None,
        ).run(make_run_request(historical=False))
        artifact = repository.get(result.run_id).to_dict()

        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in current.requests
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            [
                stage["radiusMiles"]
                for stage in artifact["request"]["configuredSearchPolicies"][
                    "current"
                ]["stages"]
            ],
            [50, 100, 200, 250],
        )
        self.assertEqual(
            [
                stage["radiusMiles"]
                for stage in artifact["request"]["searchPolicies"]["current"][
                    "stages"
                ]
            ],
            [50, 100],
        )
        self.assertEqual(
            artifact["result"]["searchDiagnostics"]["current"]["stopReason"],
            CURRENT_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(
            artifact["result"]["currentMarketResult"]["listingCount"], 5
        )
        self.assertEqual(artifact["result"]["currentRanking"]["eligibleCount"], 5)

    def test_ambiguous_and_unresolved_diagnostics_are_preserved_but_not_priced(self) -> None:
        issues = (
            HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason="NO_RECORD_ACTIVE_ON_EVIDENCE_DATE",
                vin="SYNTHETIC-UNRESOLVED-001",
                source_listing_id="synthetic-unresolved-record",
            ),
            HistoricalEvidenceIssue(
                status=AMBIGUOUS,
                reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                vin="SYNTHETIC-AMBIGUOUS-001",
                source_listing_id="synthetic-ambiguous-record",
            ),
        )
        repository, _, _, artifact = self.run_saved(
            current=False,
            historical_prices=MATERIAL_PRICES,
            issues=issues,
        )

        loaded = repository.get(artifact.run_id)
        historical = loaded.result["historicalMarketResult"]
        summary = loaded.result["discrepancyResult"]["historicalExternalSummary"]
        self.assertEqual(historical["unresolvedCount"], 1)
        self.assertEqual(historical["ambiguousCount"], 1)
        self.assertEqual(len(historical["issues"]), 2)
        self.assertEqual(summary["resolvedCount"], 5)
        self.assertEqual(summary["unresolvedCount"], 1)
        self.assertEqual(summary["ambiguousCount"], 1)
        self.assertEqual(summary["selectedCount"], 5)
        for issue in historical["issues"]:
            self.assertNotIn("price", issue)

    def test_historical_provider_failure_aborts_without_current_fallback_or_save(self) -> None:
        repository = self.repository()
        current_provider = RecordingCurrentProvider(MATERIAL_PRICES)
        historical_provider = RecordingHistoricalProvider(
            failure=MarketProviderRateLimitError("synthetic quota exhausted")
        )
        orchestrator = make_orchestrator(
            repository,
            current_provider=current_provider,
            historical_provider=historical_provider,
        )

        with self.assertRaises(AnalysisRetrievalError) as raised:
            orchestrator.run(make_run_request())

        self.assertEqual(raised.exception.stage, "historical")
        self.assertEqual(
            raised.exception.provider_error_type, "MarketProviderRateLimitError"
        )
        self.assertEqual(len(historical_provider.requests), 1)
        self.assertEqual(current_provider.requests, [])
        self.assertEqual(list(repository.root.glob("*.json")), [])

    def test_local_provider_diagnostics_log_only_allowlisted_fields(self) -> None:
        repository = self.repository()
        secret = "synthetic-diagnostic-secret"
        authenticated_url = (
            f"https://provider.invalid/recents?api_key={secret}"
        )
        failure = MarketProviderResponseError(
            f"provider body {secret} {authenticated_url}",
            diagnostic=MarketProviderDiagnostic(
                endpoint_category="recents",
                http_status=422,
                radius=100,
                start=0,
                rows=50,
            ),
        )
        historical_provider = RecordingHistoricalProvider(failure=failure)
        orchestrator = make_orchestrator(
            repository,
            current_provider=None,
            historical_provider=historical_provider,
        )

        with (
            patch.dict(
                os.environ, {"VENFOUR_PROVIDER_DIAGNOSTICS": "1"}, clear=False
            ),
            self.assertLogs(
                "venfour.provider_diagnostics", level="WARNING"
            ) as logs,
            self.assertRaises(AnalysisRetrievalError),
        ):
            orchestrator.run(make_run_request(current=False))

        payload = json.loads(logs.records[0].getMessage())
        self.assertEqual(
            payload,
            {
                "endpointCategory": "recents",
                "event": "market_provider_failure",
                "httpStatus": 422,
                "providerErrorClass": "MarketProviderResponseError",
                "radius": 100,
                "rows": 50,
                "stage": "historical_candidate_discovery",
                "start": 0,
                "stream": "historical",
            },
        )
        rendered = logs.records[0].getMessage()
        self.assertNotIn(secret, rendered)
        self.assertNotIn(authenticated_url, rendered)

    def test_local_provider_diagnostics_are_disabled_by_default(self) -> None:
        repository = self.repository()
        historical_provider = RecordingHistoricalProvider(
            failure=MarketProviderRateLimitError("synthetic failure")
        )
        orchestrator = make_orchestrator(
            repository,
            current_provider=None,
            historical_provider=historical_provider,
        )

        with (
            patch.dict(
                os.environ, {"VENFOUR_PROVIDER_DIAGNOSTICS": "0"}, clear=False
            ),
            self.assertNoLogs("venfour.provider_diagnostics", level="WARNING"),
            self.assertRaises(AnalysisRetrievalError),
        ):
            orchestrator.run(make_run_request(current=False))

    def test_later_current_expansion_failure_aborts_without_partial_save(self) -> None:
        repository = self.repository()
        current_provider = RecordingCurrentProvider(
            failure=MarketProviderRateLimitError("synthetic later-stage failure"),
            failure_at_radius=100,
        )
        orchestrator = make_orchestrator(
            repository,
            current_provider=current_provider,
            historical_provider=None,
        )

        with self.assertRaises(AnalysisRetrievalError) as raised:
            orchestrator.run(make_run_request(historical=False))

        self.assertEqual(raised.exception.stage, "current")
        self.assertEqual(
            [request.radius_miles for request in current_provider.requests],
            [50, 100],
        )
        self.assertEqual(list(repository.root.glob("*.json")), [])

    def test_each_phase_3d_classification_is_persisted_and_loadable(self) -> None:
        cases = (
            ("no-material", CONSISTENT_PRICES, NO_MATERIAL_DISCREPANCY),
            ("potential", POTENTIAL_PRICES, POTENTIAL_UNDERVALUE),
            ("material", MATERIAL_PRICES, MATERIAL_UNDERVALUE_SIGNAL),
            ("conflicting", CONFLICTING_PRICES, CONFLICTING_EVIDENCE),
        )
        for index, (label, prices, expected) in enumerate(cases, start=10):
            run_id = f"00000000-0000-4000-8000-{index:012d}"
            with self.subTest(case=label):
                repository, _, _, artifact = self.run_saved(
                    child=label,
                    run_id=run_id,
                    current=False,
                    historical_prices=prices,
                )
                self.assertEqual(
                    repository.get(artifact.run_id).result["discrepancyResult"][
                        "classification"
                    ],
                    expected,
                )

    def test_persistence_failure_is_distinct_after_analysis_completes(self) -> None:
        repository = FailingRepository()
        current_provider = RecordingCurrentProvider()
        historical_provider = RecordingHistoricalProvider()

        with self.assertRaises(AnalysisPersistenceError) as raised:
            make_orchestrator(
                repository,
                current_provider=current_provider,
                historical_provider=historical_provider,
            ).run(make_run_request())

        self.assertEqual(raised.exception.run_id, RUN_ID_1)
        self.assertIsInstance(raised.exception.__cause__, AnalysisRunWriteError)
        self.assertEqual(len(repository.save_calls), 1)
        self.assertEqual(len(current_provider.requests), len(DEFAULT_SEARCH_STAGES))
        self.assertEqual(
            len(historical_provider.requests), len(HISTORICAL_SEARCH_STAGES)
        )

    def test_invalid_metadata_factories_surface_as_execution_failures(self) -> None:
        def failing_run_id() -> str:
            raise RuntimeError("synthetic run ID failure")

        cases = (
            (
                "run-id-factory",
                failing_run_id,
                lambda: FIXED_CREATED_AT,
            ),
            (
                "indeterminate-timezone",
                lambda: RUN_ID_1,
                lambda: datetime(2026, 8, 21, 12, tzinfo=IndeterminateTimezone()),
            ),
        )
        for label, run_id_factory, clock in cases:
            with self.subTest(case=label):
                repository = self.repository(label)
                orchestrator = AnalysisOrchestrator(
                    repository,
                    run_id_factory=run_id_factory,
                    clock=clock,
                )
                with self.assertRaises(AnalysisExecutionError):
                    orchestrator.run(make_run_request(current=False, historical=False))
                self.assertEqual(list(repository.root.glob("*.json")), [])


class AnalysisRunRepositoryIntegrityTests(TemporaryRepositoryTestCase):
    def artifact_path(
        self, repository: FileAnalysisRunRepository, run_id: str = RUN_ID_1
    ) -> Path:
        return repository.root / f"{run_id}.json"

    def test_corrupt_json_is_rejected(self) -> None:
        repository, _, _, artifact = self.run_saved()
        self.artifact_path(repository).write_text('{"broken":', encoding="utf-8")

        with self.assertRaises(InvalidAnalysisRunArtifactError):
            repository.get(artifact.run_id)

    def test_excessively_nested_json_is_rejected_as_a_corrupt_artifact(self) -> None:
        repository = self.repository()
        path = self.artifact_path(repository)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            '{"nested":' + "[" * 20_000 + "0" + "]" * 20_000 + "}",
            encoding="utf-8",
        )

        with self.assertRaises(InvalidAnalysisRunArtifactError):
            repository.get(RUN_ID_1)

    def test_schema_invalid_artifact_is_rejected_without_migration(self) -> None:
        repository, _, _, artifact = self.run_saved()
        path = self.artifact_path(repository)
        data = artifact.to_dict()
        data["analysisRunSchemaVersion"] = "999"
        write_artifact(path, data)

        with self.assertRaises(InvalidAnalysisRunArtifactError):
            repository.get(artifact.run_id)

    def test_missing_validation_schema_is_a_repository_setup_failure(self) -> None:
        repository, _, _, artifact = self.run_saved()
        missing_schema = self.root / "missing-analysis-run.schema.json"

        with (
            patch(
                "venfour.analysis_runs.ANALYSIS_RUN_SCHEMA_PATH",
                missing_schema,
            ),
            self.assertRaises(AnalysisRunRepositoryError) as raised,
        ):
            repository.get(artifact.run_id)

        self.assertNotIsInstance(
            raised.exception, InvalidAnalysisRunArtifactError
        )

    def test_unknown_nested_property_is_rejected(self) -> None:
        repository, _, _, artifact = self.run_saved()
        path = self.artifact_path(repository)
        data = artifact.to_dict()
        data["result"]["currentMarketResult"]["request"]["futureSearchField"] = True
        write_artifact(path, data)

        with self.assertRaises(InvalidAnalysisRunArtifactError) as raised:
            repository.get(artifact.run_id)
        self.assertTrue(
            any("futureSearchField" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_semantically_tampered_ranking_is_rejected(self) -> None:
        repository, _, _, artifact = self.run_saved()
        path = self.artifact_path(repository)
        data = artifact.to_dict()
        data["result"]["currentRanking"]["candidates"][0]["listing"]["price"] += 1
        write_artifact(path, data)

        with self.assertRaises(InvalidAnalysisRunArtifactError) as raised:
            repository.get(artifact.run_id)
        self.assertTrue(
            any("currentRanking" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_noncanonical_raw_provider_snapshot_is_rejected(self) -> None:
        repository, _, _, artifact = self.run_saved()
        path = self.artifact_path(repository)
        data = artifact.to_dict()
        data["result"]["currentMarketResult"]["listings"][0]["make"] = (
            " Synthetic "
        )
        write_artifact(path, data)

        with self.assertRaises(InvalidAnalysisRunArtifactError) as raised:
            repository.get(artifact.run_id)
        self.assertTrue(
            any("exact canonical" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_valid_result_from_a_different_request_is_rejected(self) -> None:
        first_repository, _, _, first = self.run_saved(
            child="first",
            run_id=RUN_ID_1,
            current=False,
            historical_prices=CONSISTENT_PRICES,
        )
        second_repository, _, _, second = self.run_saved(
            child="second",
            run_id=RUN_ID_2,
            current=False,
            historical_prices=MATERIAL_PRICES,
        )
        self.assertEqual(
            second_repository.get(second.run_id).result["discrepancyResult"],
            second.result["discrepancyResult"],
        )
        path = self.artifact_path(first_repository)
        data = first.to_dict()
        data["result"]["discrepancyResult"] = second.to_dict()["result"][
            "discrepancyResult"
        ]
        write_artifact(path, data)

        with self.assertRaises(InvalidAnalysisRunArtifactError) as raised:
            first_repository.get(first.run_id)
        self.assertTrue(
            any("does not correspond" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_duplicate_run_id_is_immutable(self) -> None:
        repository, _, _, artifact = self.run_saved()
        path = self.artifact_path(repository)
        original = path.read_bytes()

        with self.assertRaises(AnalysisRunAlreadyExistsError):
            repository.save(artifact)

        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(repository.root.glob(".*.tmp")), [])

    def test_publication_failure_leaves_no_destination_or_temporary_file(self) -> None:
        repository, _, _, artifact = self.run_saved()
        unpublished = replace(artifact, run_id=RUN_ID_2)
        destination = self.artifact_path(repository, RUN_ID_2)

        with patch(
            "venfour.analysis_runs.os.link",
            side_effect=OSError("synthetic publication failure"),
        ):
            with self.assertRaises(AnalysisRunWriteError):
                repository.save(unpublished)

        self.assertFalse(destination.exists())
        self.assertEqual(list(repository.root.glob(".*.tmp")), [])

    def test_post_commit_close_failure_does_not_report_a_failed_save(self) -> None:
        repository, _, _, artifact = self.run_saved()
        committed = replace(artifact, run_id=RUN_ID_2)

        with patch(
            "venfour.analysis_runs.os.close",
            side_effect=OSError("synthetic close failure"),
        ):
            repository.save(committed)

        self.assertEqual(repository.get(RUN_ID_2).run_id, RUN_ID_2)

    def test_file_name_and_embedded_run_identity_must_agree(self) -> None:
        repository, _, _, artifact = self.run_saved()
        copied_path = self.artifact_path(repository, RUN_ID_2)
        copied_path.write_bytes(self.artifact_path(repository).read_bytes())

        with self.assertRaises(InvalidAnalysisRunArtifactError) as raised:
            repository.get(RUN_ID_2)
        self.assertTrue(
            any("requested run ID" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_invalid_and_missing_run_ids_never_escape_the_repository_root(self) -> None:
        repository = self.repository()
        outside = self.root / "outside.json"
        outside.write_text("sentinel", encoding="utf-8")

        for run_id in ("../../outside", RUN_ID_1.upper(), "not-a-uuid"):
            with self.subTest(run_id=run_id), self.assertRaises(
                AnalysisRunRepositoryError
            ):
                repository.get(run_id)
        with self.assertRaises(AnalysisRunNotFoundError):
            repository.get(RUN_ID_1)
        self.assertEqual(outside.read_text(encoding="utf-8"), "sentinel")


class AnalysisRunSecurityAndDeterminismTests(TemporaryRepositoryTestCase):
    def test_orchestration_rejects_credential_urls_before_persistence(self) -> None:
        configured_secret = "embedded/credential"
        cases = (
            (
                "prefixed-credential-name",
                "https://listings.invalid/vehicle?x-api-key=unrelated",
            ),
            (
                "lowercase-percent-encoding",
                "https://listings.invalid/vehicle?ref=embedded%2fcredential",
            ),
            (
                "relative-credential-url",
                "/vehicle?x-api-key=embedded",
            ),
            (
                "malformed-credential-url",
                "http://[broken?api_key=embedded",
            ),
        )
        for index, (label, listing_url) in enumerate(cases, start=30):
            with self.subTest(case=label):
                repository = self.repository(label)
                provider = CredentialUrlCurrentProvider(listing_url)
                run_id = f"00000000-0000-4000-8000-{index:012d}"
                orchestrator = make_orchestrator(
                    repository,
                    current_provider=provider,
                    historical_provider=None,
                    run_id=run_id,
                )
                with (
                    patch.dict(
                        os.environ,
                        {"MARKETCHECK_API_KEY": configured_secret},
                        clear=True,
                    ),
                    self.assertRaises(AnalysisExecutionError),
                ):
                    orchestrator.run(make_run_request(historical=False))
                self.assertEqual(list(repository.root.glob("*.json")), [])

    def test_environment_and_provider_secrets_are_not_serialized(self) -> None:
        market_key = "synthetic-marketcheck-configured-secret"
        model_key = "synthetic-openai-configured-secret"
        repository = self.repository()
        current = RecordingCurrentProvider(secret=market_key)
        historical = RecordingHistoricalProvider(secret=market_key)

        with (
            patch.dict(
                os.environ,
                {
                    "MARKETCHECK_API_KEY": market_key,
                    "OPENAI_API_KEY": model_key,
                },
                clear=True,
            ),
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("network access attempted"),
            ),
        ):
            artifact = make_orchestrator(
                repository,
                current_provider=current,
                historical_provider=historical,
            ).run(make_run_request()).artifact

        serialized = canonical_json_bytes(artifact.to_dict())
        on_disk = (repository.root / f"{artifact.run_id}.json").read_bytes()
        for secret in (market_key, model_key):
            self.assertNotIn(secret.encode(), serialized)
            self.assertNotIn(secret.encode(), on_disk)
        self.assertNotIn(b"authorization_header", serialized)
        self.assertNotIn(b"api_key", serialized)

    def test_read_validation_does_not_depend_on_later_ambient_credentials(self) -> None:
        future_key = "future-runtime-key-that-is-legitimate-metadata"
        repository = self.repository()
        current = RecordingCurrentProvider()
        historical = RecordingHistoricalProvider()
        with patch.dict(os.environ, {}, clear=True):
            artifact = AnalysisOrchestrator(
                repository,
                current_provider=current,
                historical_provider=historical,
                current_provider_version=future_key,
                historical_provider_version="fixture-historical-1",
                run_id_factory=lambda: RUN_ID_1,
                clock=lambda: FIXED_CREATED_AT,
            ).run(make_run_request()).artifact

        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": future_key},
            clear=True,
        ):
            loaded = repository.get(artifact.run_id)

        self.assertEqual(loaded.providers["current"]["version"], future_key)

    def test_save_uses_one_secret_snapshot_across_atomic_validation(self) -> None:
        future_key = "credential-rotated-during-save"
        source_repository, _, _, artifact = self.run_saved(child="source")
        data = source_repository.get(artifact.run_id).to_dict()
        data["providers"]["current"]["version"] = future_key
        with patch.dict(os.environ, {}, clear=True):
            updated = AnalysisRunArtifact.from_dict(data)
            destination = self.repository("destination")

            def rotate_credential(_file_descriptor: int) -> None:
                os.environ["OPENAI_API_KEY"] = future_key

            with patch(
                "venfour.analysis_runs.os.fsync",
                side_effect=rotate_credential,
            ):
                destination.save(updated)

            self.assertEqual(
                destination.get(updated.run_id).providers["current"]["version"],
                future_key,
            )

    def test_injected_secret_string_and_credential_url_are_rejected(self) -> None:
        _, _, _, artifact = self.run_saved()
        forbidden = "synthetic-explicit-forbidden-secret"

        secret_data = artifact.to_dict()
        secret_data["providers"]["current"]["version"] = forbidden
        with self.assertRaises(AnalysisRunContractError) as secret_raised:
            validate_analysis_run_artifact(
                secret_data, forbidden_secret_values=(forbidden,)
            )
        self.assertIn("secret", str(secret_raised.exception).casefold())

        for parameter_name in (
            "api_key",
            "access-token",
            "client.secret",
            "secret_key",
            "x-auth",
        ):
            with self.subTest(parameter_name=parameter_name):
                url_data = artifact.to_dict()
                url_data["providers"]["current"]["version"] = (
                    f"https://metadata.invalid/provider?{parameter_name}=synthetic"
                )
                with self.assertRaises(AnalysisRunContractError) as url_raised:
                    validate_analysis_run_artifact(url_data)
                self.assertTrue(
                    any(
                        "credential-bearing URL" in detail
                        for detail in url_raised.exception.details
                    ),
                    url_raised.exception.details,
                )

        secret_key_data = artifact.to_dict()
        secret_key_data[forbidden] = object()
        with self.assertRaises(AnalysisRunContractError) as key_raised:
            validate_analysis_run_artifact(
                secret_key_data, forbidden_secret_values=(forbidden,)
            )
        self.assertNotIn(forbidden, str(key_raised.exception.details))

    def test_equivalent_runs_differ_only_in_run_metadata(self) -> None:
        first_repository, _, _, first = self.run_saved(
            child="first",
            run_id=RUN_ID_1,
            created_at=FIXED_CREATED_AT,
        )
        second_time = datetime(2026, 8, 22, 1, 2, 3, tzinfo=timezone.utc)
        second_repository, _, _, second = self.run_saved(
            child="second",
            run_id=RUN_ID_2,
            created_at=second_time,
        )
        first_data = first_repository.get(first.run_id).to_dict()
        second_data = second_repository.get(second.run_id).to_dict()
        self.assertNotEqual(first_data["runId"], second_data["runId"])
        self.assertNotEqual(first_data["createdAt"], second_data["createdAt"])
        for data in (first_data, second_data):
            data.pop("runId")
            data.pop("createdAt")
        self.assertEqual(first_data, second_data)

    def test_digest_uses_canonical_key_order_and_changes_with_content(self) -> None:
        first = {"z": 3, "nested": {"b": 2, "a": 1}}
        reordered = {"nested": {"a": 1, "b": 2}, "z": 3}
        changed = {"nested": {"a": 1, "b": 9}, "z": 3}

        self.assertEqual(
            canonical_json_bytes(first),
            b'{"nested":{"a":1,"b":2},"z":3}',
        )
        self.assertEqual(
            discrepancy_request_digest(first),
            discrepancy_request_digest(reordered),
        )
        self.assertNotEqual(
            discrepancy_request_digest(first),
            discrepancy_request_digest(changed),
        )

    def test_analysis_run_schema_meta_validates_as_draft_2020_12(self) -> None:
        schema = json.loads(ANALYSIS_RUN_SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            schema["$schema"], "https://json-schema.org/draft/2020-12/schema"
        )
        Draft202012Validator.check_schema(schema)


if __name__ == "__main__":
    unittest.main()
