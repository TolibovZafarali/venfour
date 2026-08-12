"""Offline integration coverage for Phase 3E presentation projection.

Every report, vehicle, listing, identifier, provider, credential, and price in
this module is fictional test data.  Valid artifacts are produced through the
existing Phase 3D.2 orchestration and repository boundaries; no network or
model call is made.
"""

from __future__ import annotations

import copy
import os
import socket
import unittest
from dataclasses import replace
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tests.test_analysis_runs import (
    CONFLICTING_PRICES,
    CONSISTENT_PRICES,
    MATERIAL_PRICES,
    POTENTIAL_PRICES,
    RUN_ID_1,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    TemporaryRepositoryTestCase,
    make_orchestrator,
    make_report,
    make_run_request,
    write_artifact,
)
from venfour.analysis_runs import (
    InvalidAnalysisRunArtifactError,
    canonical_json_bytes,
)
from venfour.discrepancy import (
    CONFLICTING_EVIDENCE,
    CURRENT_MARKET,
    INSUFFICIENT_EVIDENCE,
    LOSS_DATE_HISTORICAL,
    LOW,
    MATERIAL_UNDERVALUE_SIGNAL,
    MODERATE,
    NO_MATERIAL_DISCREPANCY,
    POTENTIAL_UNDERVALUE,
    STRONG,
    ValuationDiscrepancyAnalyzer,
)
from venfour.historical_market import (
    AMBIGUOUS,
    OUT_OF_PROVIDER_RANGE,
    UNRESOLVED,
    HistoricalEvidenceIssue,
)
from venfour.market import MarketSearchResult
from venfour.presentation import (
    ANALYSIS_PRESENTATION_VERSION,
    AnalysisPresentationContractError,
    AnalysisPresentationProjector,
    AnalysisPresentationService,
    validate_analysis_presentation,
)


EXPECTED_TOP_LEVEL_SECTIONS = {
    "presentationVersion",
    "runId",
    "analysisCreatedAt",
    "assessment",
    "vehicle",
    "cccValuation",
    "cccComparables",
    "primaryExternalEvidence",
    "secondaryExternalEvidence",
    "comparablesUsed",
    "evidenceDiagnostics",
    "findings",
    "limitations",
    "provenance",
}


class RecordingProjector:
    """Projector spy used to prove repository rejection happens first."""

    def __init__(self) -> None:
        self.artifacts: list[Any] = []

    def project(self, artifact: Any) -> Any:
        self.artifacts.append(artifact)
        raise AssertionError("projector must not receive an invalid artifact")


class AnalysisPresentationIntegrationTests(TemporaryRepositoryTestCase):
    def presentation_from_saved_run(
        self, **options: Any
    ) -> tuple[Any, Any, Any, Any, dict[str, Any]]:
        repository, current, historical, artifact = self.run_saved(**options)
        presentation = AnalysisPresentationService(repository).get(artifact.run_id)
        return repository, current, historical, artifact, presentation.to_dict()

    def artifact_path(self, repository: Any, run_id: str = RUN_ID_1) -> Path:
        return repository.root / f"{run_id}.json"

    def test_service_loads_by_run_id_and_returns_the_complete_section_contract(
        self,
    ) -> None:
        repository, _, _, artifact = self.run_saved(
            historical_prices=CONSISTENT_PRICES,
            current_prices=MATERIAL_PRICES,
        )

        data = AnalysisPresentationService(repository).get(artifact.run_id).to_dict()

        self.assertEqual(set(data), EXPECTED_TOP_LEVEL_SECTIONS)
        self.assertEqual(data["presentationVersion"], ANALYSIS_PRESENTATION_VERSION)
        self.assertEqual(data["runId"], artifact.run_id)
        self.assertEqual(data["analysisCreatedAt"], artifact.created_at)
        self.assertEqual(
            data["assessment"]["classification"], NO_MATERIAL_DISCREPANCY
        )
        self.assertEqual(
            data["vehicle"],
            {
                "year": 2024,
                "make": "Synthetic",
                "model": "Sedan",
                "trim": "SEL",
                "mileage": 50_000,
                "lossDate": "2026-05-19",
                "postalCode": "63026",
            },
        )
        self.assertEqual(
            data["primaryExternalEvidence"]["evidenceBasis"],
            LOSS_DATE_HISTORICAL,
        )
        self.assertEqual(
            data["secondaryExternalEvidence"]["evidenceBasis"], CURRENT_MARKET
        )
        self.assertEqual(len(data["comparablesUsed"]["primary"]), 5)
        self.assertEqual(len(data["comparablesUsed"]["secondary"]), 5)

    def test_every_classification_is_presented_without_suppressing_limitations(
        self,
    ) -> None:
        cases = (
            ("insufficient", (), INSUFFICIENT_EVIDENCE, False),
            ("no-material", CONSISTENT_PRICES, NO_MATERIAL_DISCREPANCY, True),
            ("potential", POTENTIAL_PRICES, POTENTIAL_UNDERVALUE, True),
            ("material", MATERIAL_PRICES, MATERIAL_UNDERVALUE_SIGNAL, True),
            ("conflicting", CONFLICTING_PRICES, CONFLICTING_EVIDENCE, True),
        )
        for index, (label, prices, expected, historical) in enumerate(cases, start=60):
            run_id = f"00000000-0000-4000-8000-{index:012d}"
            with self.subTest(classification=expected):
                repository, _, _, artifact = self.run_saved(
                    child=label,
                    run_id=run_id,
                    current=False,
                    historical=historical,
                    historical_prices=prices,
                )
                data = AnalysisPresentationService(repository).get(run_id).to_dict()
                result = artifact.result["discrepancyResult"]
                expected_limitation_codes = [
                    item["code"] for item in result["limitations"]
                ]

                self.assertEqual(data["assessment"]["classification"], expected)
                self.assertEqual(
                    [item["code"] for item in data["limitations"]],
                    expected_limitation_codes,
                )
                self.assertTrue(data["limitations"])
                self.assertIn(
                    "NOT_AN_INDEPENDENT_APPRAISAL", expected_limitation_codes
                )
                self.assertIn(
                    "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT",
                    expected_limitation_codes,
                )

    def test_low_moderate_and_strong_evidence_strengths_are_copied(self) -> None:
        cases = (
            (
                "low",
                {"current": False, "historical": False},
                LOW,
            ),
            (
                "moderate",
                {
                    "current": True,
                    "historical": False,
                    "current_prices": MATERIAL_PRICES,
                },
                MODERATE,
            ),
            (
                "strong",
                {
                    "current": False,
                    "historical": True,
                    "historical_prices": MATERIAL_PRICES,
                },
                STRONG,
            ),
        )
        for index, (label, options, expected) in enumerate(cases, start=70):
            with self.subTest(strength=expected):
                _, _, _, _, data = self.presentation_from_saved_run(
                    child=label,
                    run_id=f"00000000-0000-4000-8000-{index:012d}",
                    **options,
                )
                self.assertEqual(data["assessment"]["evidenceStrength"], expected)

    def test_historical_primary_and_current_secondary_remain_separate(self) -> None:
        _, _, _, artifact, data = self.presentation_from_saved_run(
            historical_prices=CONSISTENT_PRICES,
            current_prices=MATERIAL_PRICES,
        )
        result = artifact.result["discrepancyResult"]

        self.assertEqual(data["assessment"]["evidenceBasis"], LOSS_DATE_HISTORICAL)
        self.assertEqual(data["primaryExternalEvidence"]["role"], "PRIMARY")
        self.assertEqual(
            data["primaryExternalEvidence"]["prices"]["medianPrice"]["cents"],
            result["historicalExternalSummary"]["prices"]["medianPriceCents"],
        )
        self.assertEqual(data["secondaryExternalEvidence"]["role"], "SECONDARY")
        self.assertEqual(
            data["secondaryExternalEvidence"]["prices"]["medianPrice"]["cents"],
            result["currentExternalSummary"]["prices"]["medianPriceCents"],
        )
        self.assertNotIn("combined", data["primaryExternalEvidence"])
        self.assertNotIn("combined", data["secondaryExternalEvidence"])

    def test_stored_statistics_and_comparisons_are_copied_without_reanalysis(
        self,
    ) -> None:
        _, _, _, artifact, data = self.presentation_from_saved_run(
            historical_prices=MATERIAL_PRICES,
            current_prices=CONSISTENT_PRICES,
        )
        result = artifact.result["discrepancyResult"]
        stored_prices = result["historicalExternalSummary"]["prices"]
        shown_prices = data["primaryExternalEvidence"]["prices"]

        self.assertEqual(shown_prices["count"], stored_prices["count"])
        for shown_name, stored_name in (
            ("minimumPrice", "minimumPriceCents"),
            ("maximumPrice", "maximumPriceCents"),
            ("medianPrice", "medianPriceCents"),
            ("range", "rangeCents"),
            ("medianAbsoluteDeviation", "medianAbsoluteDeviationCents"),
            ("centralHalfRange", "centralHalfRangeCents"),
        ):
            self.assertEqual(
                shown_prices[shown_name]["cents"], stored_prices[stored_name]
            )
        self.assertEqual(
            shown_prices["dispersion"]["basisPoints"],
            stored_prices["dispersionBasisPoints"],
        )

        stored_primary = result["primaryComparison"]
        shown_primary = data["cccValuation"]["comparisonToPrimaryEvidence"]
        self.assertEqual(
            shown_primary["firstValue"]["cents"],
            stored_primary["externalMedianPriceCents"],
        )
        self.assertEqual(
            shown_primary["secondValue"]["cents"],
            stored_primary["cccVehicleValuationCents"],
        )
        self.assertEqual(
            shown_primary["difference"]["cents"],
            stored_primary["differenceCents"],
        )
        self.assertEqual(
            shown_primary["differencePercent"]["basisPoints"],
            stored_primary["differenceBasisPoints"],
        )
        self.assertEqual(
            shown_primary["cccPositionInExternalRange"],
            stored_primary["cccPositionInExternalRange"],
        )

        for key, stored_comparison in result["secondaryComparisons"].items():
            shown_comparison = data["cccValuation"]["supportingComparisons"][key]
            if stored_comparison is None:
                self.assertIsNone(shown_comparison)
                continue
            self.assertEqual(
                shown_comparison["firstValue"]["cents"],
                stored_comparison["firstValueCents"],
            )
            self.assertEqual(
                shown_comparison["secondValue"]["cents"],
                stored_comparison["secondValueCents"],
            )
            self.assertEqual(
                shown_comparison["difference"]["cents"],
                stored_comparison["differenceCents"],
            )
            self.assertEqual(
                shown_comparison["differencePercent"]["basisPoints"],
                stored_comparison["differenceBasisPoints"],
            )

    def test_current_only_evidence_is_primary_and_never_labeled_historical(self) -> None:
        _, _, _, _, data = self.presentation_from_saved_run(
            current=True,
            historical=False,
            current_prices=MATERIAL_PRICES,
        )

        primary = data["primaryExternalEvidence"]
        self.assertEqual(data["assessment"]["evidenceBasis"], CURRENT_MARKET)
        self.assertEqual(primary["evidenceBasis"], CURRENT_MARKET)
        self.assertEqual(primary["role"], "PRIMARY")
        self.assertIsNone(data["secondaryExternalEvidence"])
        self.assertEqual(data["comparablesUsed"]["secondary"], [])
        for row in data["comparablesUsed"]["primary"]:
            self.assertEqual(row["temporalBasis"], CURRENT_MARKET)
            self.assertEqual(row["evidenceDate"], "2026-08-10")
            self.assertIsNone(row["lifecycleEvidence"])

    def test_out_of_range_history_is_diagnostic_while_current_is_primary(self) -> None:
        _, _, _, artifact, data = self.presentation_from_saved_run(
            coverage_status=OUT_OF_PROVIDER_RANGE,
            historical_prices=(),
            current_prices=MATERIAL_PRICES,
        )

        self.assertEqual(data["assessment"]["evidenceBasis"], CURRENT_MARKET)
        self.assertEqual(
            data["primaryExternalEvidence"]["evidenceBasis"], CURRENT_MARKET
        )
        self.assertIsNone(data["secondaryExternalEvidence"])
        self.assertEqual(
            data["evidenceDiagnostics"]["historicalCoverage"]["status"],
            OUT_OF_PROVIDER_RANGE,
        )
        self.assertIn(
            "does not mean no market existed",
            data["evidenceDiagnostics"]["historicalCoverage"]["description"],
        )
        self.assertEqual(
            artifact.result["discrepancyResult"]["historicalExternalSummary"][
                "selectedCount"
            ],
            0,
        )

    def test_ccc_rows_preserve_advertised_adjusted_net_values_and_report_order(
        self,
    ) -> None:
        _, _, _, _, data = self.presentation_from_saved_run(
            current=False,
            historical_prices=CONSISTENT_PRICES,
        )
        rows = data["cccComparables"]["rows"]

        self.assertEqual([row["index"] for row in rows], [0, 1, 2])
        self.assertEqual([row["comparableNumber"] for row in rows], [1, 2, 3])
        self.assertEqual(
            [row["advertisedPrice"]["cents"] for row in rows],
            [1_980_000, 2_010_000, 2_040_000],
        )
        self.assertEqual(
            [row["cccAdjustedComparableValue"]["cents"] for row in rows],
            [2_000_000, 2_000_000, 2_000_000],
        )
        self.assertEqual(
            [row["netAdjustment"]["cents"] for row in rows],
            [20_000, -10_000, -40_000],
        )
        self.assertEqual(
            data["cccValuation"]["adjustedVehicleValue"],
            {"cents": 2_000_000, "display": "$20,000.00"},
        )
        self.assertNotEqual(rows[0]["advertisedPrice"], rows[0]["netAdjustment"])

    def test_ccc_missing_values_remain_null_instead_of_becoming_zero(self) -> None:
        report = make_report()
        report["comparables"][0]["listPrice"] = None
        report["comparables"][0]["adjustments"] = {
            "package": None,
            "options": None,
            "mileage": None,
            "condition": None,
        }
        report["comparables"][1]["adjustedValue"] = None
        request = replace(
            make_run_request(current=False, historical=True), ccc_report=report
        )
        repository = self.repository("ccc-nulls")
        historical = RecordingHistoricalProvider(CONSISTENT_PRICES)
        artifact = make_orchestrator(
            repository,
            current_provider=None,
            historical_provider=historical,
            run_id="00000000-0000-4000-8000-000000000080",
        ).run(request).artifact

        rows = AnalysisPresentationService(repository).get(artifact.run_id).to_dict()[
            "cccComparables"
        ]["rows"]

        missing_money = {"cents": None, "display": None}
        self.assertEqual(rows[0]["advertisedPrice"], missing_money)
        self.assertEqual(rows[0]["netAdjustment"], missing_money)
        self.assertTrue(
            all(value == missing_money for value in rows[0]["adjustments"].values())
        )
        self.assertEqual(rows[1]["cccAdjustedComparableValue"], missing_money)
        self.assertEqual(rows[1]["netAdjustment"], missing_money)
        self.assertEqual([row["comparableNumber"] for row in rows], [1, 2, 3])

    def test_selected_comparables_keep_rank_dealer_lifecycle_and_stored_order(
        self,
    ) -> None:
        _, _, _, artifact, data = self.presentation_from_saved_run(
            historical_prices=CONSISTENT_PRICES,
            current_prices=MATERIAL_PRICES,
        )
        selected = artifact.result["discrepancyResult"][
            "historicalExternalSummary"
        ]["selectedEvidence"]
        rows = data["comparablesUsed"]["primary"]

        self.assertEqual(
            [row["rank"] for row in rows], [item["rank"] for item in selected]
        )
        self.assertEqual(
            [row["advertisedPrice"]["cents"] for row in rows],
            [item["priceCents"] for item in selected],
        )
        self.assertEqual(rows[0]["dealer"]["name"], "Synthetic Dealer 1")
        self.assertEqual(rows[0]["dealer"]["city"], "Test City")
        self.assertEqual(rows[0]["dealer"]["state"], "MO")
        self.assertEqual(
            rows[0]["temporalBasis"], "LISTING_RECORD_ACTIVE_ON_DATE"
        )
        lifecycle = rows[0]["lifecycleEvidence"]
        self.assertEqual(lifecycle["status"], "RESOLVED")
        self.assertEqual(lifecycle["basis"], "LISTING_RECORD_ACTIVE_ON_DATE")
        self.assertTrue(lifecycle["basisLabel"])
        self.assertEqual(lifecycle["evidenceDate"], "2026-05-19")
        self.assertEqual(lifecycle["recordFirstSeenAt"], "2026-05-18T12:00:00Z")
        self.assertEqual(lifecycle["recordLastSeenAt"], "2026-05-20T12:00:00Z")
        self.assertEqual(lifecycle["sourceFirstSeenAt"], "2026-05-01T00:00:00Z")
        self.assertEqual(lifecycle["sourceLastSeenAt"], "2026-05-31T23:59:59Z")
        self.assertNotIn("listingUrl", rows[0])

    def test_ambiguous_and_unresolved_records_are_diagnostics_without_prices(
        self,
    ) -> None:
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
        _, _, _, _, data = self.presentation_from_saved_run(
            current=False,
            historical_prices=MATERIAL_PRICES,
            issues=issues,
        )
        diagnostics = data["evidenceDiagnostics"]

        self.assertEqual(
            [item["code"] for item in diagnostics["exclusions"][:2]],
            [
                "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED",
                "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED",
            ],
        )
        self.assertEqual(
            [item["status"] for item in diagnostics["historicalIssues"]],
            [UNRESOLVED, AMBIGUOUS],
        )
        self.assertTrue(
            all(
                item["pricesContributed"] is False
                for item in diagnostics["historicalIssues"]
                + diagnostics["exclusions"]
            )
        )
        rendered = canonical_json_bytes(diagnostics)
        self.assertNotIn(b"priceCents", rendered)
        self.assertNotIn(b"advertisedPrice", rendered)

        changed = copy.deepcopy(data)
        changed["evidenceDiagnostics"]["historicalIssues"][0]["status"] = AMBIGUOUS
        changed["evidenceDiagnostics"]["historicalIssues"][0][
            "statusLabel"
        ] = "Ambiguous"
        with self.assertRaises(AnalysisPresentationContractError):
            validate_analysis_presentation(changed)

    def test_identity_duplicate_ineligible_and_bounded_records_are_diagnostic(
        self,
    ) -> None:
        class DiagnosticCurrentProvider(RecordingCurrentProvider):
            def search(self, request: Any) -> MarketSearchResult:
                result = super().search(request)
                listings = list(result.listings)
                listings[0] = replace(
                    listings[0], vin=None, source_listing_id=None
                )
                listings[1] = replace(listings[1], vin="SYNTHETIC-DUPLICATE-VIN")
                listings[2] = replace(listings[2], vin="SYNTHETIC-DUPLICATE-VIN")
                listings[-1] = replace(listings[-1], model="Different Model")
                return MarketSearchResult(
                    provider=result.provider,
                    request=result.request,
                    listings=tuple(listings),
                )

        prices = tuple(1_900_000 + index * 10_000 for index in range(14))
        repository = self.repository("selection-diagnostics")
        current = DiagnosticCurrentProvider(prices)
        artifact = make_orchestrator(
            repository,
            current_provider=current,
            historical_provider=None,
            run_id="00000000-0000-4000-8000-000000000081",
        ).run(make_run_request(current=True, historical=False)).artifact

        data = AnalysisPresentationService(repository).get(artifact.run_id).to_dict()
        exclusions = data["evidenceDiagnostics"]["exclusions"]

        self.assertEqual(
            [(item["code"], item["count"]) for item in exclusions],
            [
                ("INELIGIBLE_EXTERNAL_RECORDS_EXCLUDED", 1),
                ("IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED", 1),
                ("EXTERNAL_COMPARISON_SET_BOUNDED", 2),
            ],
        )
        self.assertTrue(all(item["pricesContributed"] is False for item in exclusions))
        self.assertEqual(len(data["comparablesUsed"]["primary"]), 9)
        for item in exclusions:
            self.assertNotIn("priceCents", item)
            self.assertNotIn("advertisedPrice", item)

    def test_finding_and_limitation_order_matches_the_authoritative_result(self) -> None:
        issues = (
            HistoricalEvidenceIssue(
                status=UNRESOLVED,
                reason="NO_RECORD_ACTIVE_ON_EVIDENCE_DATE",
                vin="SYNTHETIC-UNRESOLVED-ORDER",
            ),
        )
        _, _, _, artifact, data = self.presentation_from_saved_run(
            historical_prices=MATERIAL_PRICES,
            current_prices=CONSISTENT_PRICES,
            issues=issues,
        )
        result = artifact.result["discrepancyResult"]

        self.assertEqual(
            [item["code"] for item in data["findings"]],
            [item["code"] for item in result["findings"]],
        )
        self.assertEqual(
            [item["code"] for item in data["limitations"]],
            [item["code"] for item in result["limitations"]],
        )

    def test_provenance_preserves_versions_digest_and_integrity_wording(self) -> None:
        _, _, _, artifact, data = self.presentation_from_saved_run()
        provenance = data["provenance"]

        self.assertEqual(provenance["runId"], artifact.run_id)
        self.assertEqual(provenance["presentationVersion"], "1")
        self.assertEqual(provenance["createdAt"], artifact.created_at)
        self.assertEqual(
            provenance["analysisRunSchemaVersion"],
            artifact.analysis_run_schema_version,
        )
        self.assertEqual(
            provenance["orchestrationAnalysisVersion"], artifact.analysis_version
        )
        self.assertEqual(
            provenance["discrepancyAnalysisVersion"],
            artifact.discrepancy_analysis_version,
        )
        self.assertEqual(
            provenance["comparableScoringVersion"],
            artifact.comparable_scoring_version,
        )
        digest = provenance["requestDigest"]
        self.assertEqual(digest["value"], artifact.request_digest)
        self.assertEqual(digest["algorithm"], "SHA-256")
        self.assertIn("integrity", digest["label"].casefold())
        self.assertIn("not a digital signature", digest["description"])
        self.assertEqual(
            set(provenance["providers"]),
            {"historical", "current"},
        )
        self.assertEqual(
            list(provenance["providers"]), ["historical", "current"]
        )
        self.assertEqual(
            provenance["providers"]["historical"]["name"],
            "synthetic-historical",
        )
        self.assertEqual(
            provenance["providers"]["current"]["name"], "synthetic-current"
        )

    def test_repeated_projection_is_byte_deterministic_and_creates_no_metadata(
        self,
    ) -> None:
        repository, _, _, artifact = self.run_saved()
        service = AnalysisPresentationService(repository)

        first = service.get(artifact.run_id).to_dict()
        second = service.get(artifact.run_id).to_dict()

        self.assertEqual(canonical_json_bytes(first), canonical_json_bytes(second))
        self.assertEqual(first["analysisCreatedAt"], artifact.created_at)
        self.assertEqual(first["runId"], artifact.run_id)
        self.assertNotIn("presentationCreatedAt", first)
        self.assertNotIn("presentationId", first)

    def test_projection_omits_provider_internals_credentials_and_listing_urls(
        self,
    ) -> None:
        provider_secret = "synthetic-provider-internal-secret"
        model_secret = "synthetic-model-environment-secret"
        repository = self.repository("security")
        current = RecordingCurrentProvider(secret=provider_secret)
        historical = RecordingHistoricalProvider(secret=provider_secret)

        with (
            patch.dict(
                os.environ,
                {
                    "MARKETCHECK_API_KEY": provider_secret,
                    "OPENAI_API_KEY": model_secret,
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
            provider_call_counts = (len(current.requests), len(historical.requests))
            serialized = canonical_json_bytes(
                AnalysisPresentationService(repository).get(artifact.run_id).to_dict()
            )

        self.assertEqual(
            (len(current.requests), len(historical.requests)), provider_call_counts
        )
        for forbidden in (
            provider_secret.encode(),
            model_secret.encode(),
            b"authorization_header",
            b"api_key",
            b"listingUrl",
            b"https://listings.invalid",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_direct_projector_does_not_call_analyzer_ranker_or_providers(self) -> None:
        repository, current, historical, saved = self.run_saved()
        artifact = repository.get(saved.run_id)
        current_calls = len(current.requests)
        historical_calls = len(historical.requests)

        with (
            patch.object(
                ValuationDiscrepancyAnalyzer,
                "analyze",
                side_effect=AssertionError("Phase 3D analyzer called"),
            ),
            patch(
                "venfour.comparables.rank_market_comparables",
                side_effect=AssertionError("Phase 3C ranker called"),
            ),
            patch.object(
                current,
                "search",
                side_effect=AssertionError("current provider called"),
            ),
            patch.object(
                historical,
                "search_historical",
                side_effect=AssertionError("historical provider called"),
            ),
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("network access attempted"),
            ),
        ):
            presentation = AnalysisPresentationProjector().project(artifact)

        self.assertEqual(
            presentation.assessment["classification"], NO_MATERIAL_DISCREPANCY
        )
        self.assertEqual(len(current.requests), current_calls)
        self.assertEqual(len(historical.requests), historical_calls)

    def test_repository_tampering_is_rejected_before_projection(self) -> None:
        def malformed(path: Path, _data: dict[str, Any]) -> None:
            path.write_text('{"broken":', encoding="utf-8")

        def digest(path: Path, data: dict[str, Any]) -> None:
            data["requestDigest"] = "0" * 64
            write_artifact(path, data)

        def result(path: Path, data: dict[str, Any]) -> None:
            data["result"]["discrepancyResult"]["classification"] = (
                POTENTIAL_UNDERVALUE
            )
            write_artifact(path, data)

        def ranking(path: Path, data: dict[str, Any]) -> None:
            data["result"]["currentRanking"]["candidates"][0]["listing"][
                "price"
            ] += 1
            write_artifact(path, data)

        def unknown(path: Path, data: dict[str, Any]) -> None:
            data["result"]["currentMarketResult"]["request"][
                "futureSearchField"
            ] = True
            write_artifact(path, data)

        mutations = {
            "malformed JSON": malformed,
            "digest": digest,
            "result": result,
            "ranking": ranking,
            "unknown field": unknown,
        }
        for index, (label, mutate) in enumerate(mutations.items(), start=90):
            with self.subTest(tampering=label):
                repository, _, _, artifact = self.run_saved(
                    child=f"tamper-{index}",
                    run_id=f"00000000-0000-4000-8000-{index:012d}",
                )
                path = self.artifact_path(repository, artifact.run_id)
                data = artifact.to_dict()
                mutate(path, data)
                projector = RecordingProjector()
                service = AnalysisPresentationService(
                    repository, projector=projector  # type: ignore[arg-type]
                )

                with self.assertRaises(InvalidAnalysisRunArtifactError):
                    service.get(artifact.run_id)
                self.assertEqual(projector.artifacts, [])

    def test_public_validation_rejects_unknown_fields_drift_and_mislabeling(
        self,
    ) -> None:
        _, _, _, _, original = self.presentation_from_saved_run()

        def unknown(data: dict[str, Any]) -> None:
            data["vehicle"]["futureVehicleField"] = True

        def money_display_drift(data: dict[str, Any]) -> None:
            data["cccValuation"]["adjustedVehicleValue"]["display"] = "$0.00"

        def percentage_display_drift(data: dict[str, Any]) -> None:
            data["cccValuation"]["comparisonToPrimaryEvidence"][
                "differencePercent"
            ]["display"] = "99.99%"

        def historical_mislabeled_current(data: dict[str, Any]) -> None:
            data["primaryExternalEvidence"]["evidenceBasis"] = CURRENT_MARKET

        def recommendation_prose(data: dict[str, Any]) -> None:
            data["limitations"][0]["description"] = (
                "Challenge the insurer immediately."
            )

        def section_date_drift(data: dict[str, Any]) -> None:
            data["primaryExternalEvidence"]["evidenceDate"] = "2026-05-18"

        def reversed_lifecycle(data: dict[str, Any]) -> None:
            lifecycle = data["comparablesUsed"]["primary"][0][
                "lifecycleEvidence"
            ]
            lifecycle["recordFirstSeenAt"] = "2026-05-21T12:00:00Z"

        def lifecycle_outside_evidence_date(data: dict[str, Any]) -> None:
            lifecycle = data["comparablesUsed"]["primary"][0][
                "lifecycleEvidence"
            ]
            lifecycle["recordFirstSeenAt"] = "2026-05-02T12:00:00Z"
            lifecycle["recordLastSeenAt"] = "2026-05-03T12:00:00Z"

        def selected_count_drift(data: dict[str, Any]) -> None:
            data["primaryExternalEvidence"]["selectedCount"] -= 1

        def ccc_count_drift(data: dict[str, Any]) -> None:
            data["cccComparables"]["summary"]["totalCount"] += 1

        def provider_drift(data: dict[str, Any]) -> None:
            data["primaryExternalEvidence"]["provider"]["name"] = (
                "different-provider"
            )

        mutations = {
            "unknown nested field": unknown,
            "money raw/display mismatch": money_display_drift,
            "percentage raw/display mismatch": percentage_display_drift,
            "historical/current mislabeling": historical_mislabeled_current,
            "recommendation prose": recommendation_prose,
            "section date drift": section_date_drift,
            "reversed lifecycle": reversed_lifecycle,
            "lifecycle outside evidence date": lifecycle_outside_evidence_date,
            "selected count drift": selected_count_drift,
            "CCC count drift": ccc_count_drift,
            "provider drift": provider_drift,
        }
        for label, mutate in mutations.items():
            with self.subTest(mutation=label):
                changed = copy.deepcopy(original)
                mutate(changed)
                with self.assertRaises(AnalysisPresentationContractError):
                    validate_analysis_presentation(changed)


if __name__ == "__main__":
    unittest.main()
