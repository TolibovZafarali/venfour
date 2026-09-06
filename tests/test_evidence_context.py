"""Evidence-aware run and presentation semantics for report/manual intake."""

from __future__ import annotations

import json
import unittest

from tests.test_analysis_creation import AnalysisCreationTestCase, RecordingExtractor
from tests.test_analysis_runs import RUN_ID_1, make_report
from venfour.presentation import AnalysisPresentationService
from venfour.report_ingestion import normalize_ccc_report


def confirmed_snapshot(*, mode: str, offer: int | None) -> dict:
    return {
        "intake_mode": mode,
        "vin": "SYNTHETICLOSS0001",
        "vehicle_year": 2024,
        "vehicle_make": "Synthetic",
        "vehicle_model": "Sedan",
        "vehicle_trim": "SEL",
        "mileage_at_loss": 50_000,
        "postal_code": "63026",
        "date_of_loss": "2026-05-19",
        "insurer_name": "Example Insurance",
        "insurer_vehicle_valuation": offer,
        "vehicle_condition": "Good",
        "vehicle_options_packages": ["Synthetic Safety Package"],
        "report_provider_name": "Acme Valuations" if mode == "report" else None,
    }


def customer_copy(value: object) -> list[str]:
    results: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {
                "summary",
                "label",
                "description",
                "explanation",
                "methodologyDisclosure",
            } and isinstance(child, str):
                results.append(child)
            results.extend(customer_copy(child))
    elif isinstance(value, list):
        for child in value:
            results.extend(customer_copy(child))
    return results


class EvidenceContextPresentationTests(AnalysisCreationTestCase):
    def test_confirmed_vehicle_configuration_reaches_both_market_streams(
        self,
    ) -> None:
        service, current, historical, _ = self.make_service(
            RecordingExtractor(make_report())
        )
        input_snapshot = confirmed_snapshot(mode="manual", offer=None)
        input_snapshot["vehicle_trim"] = "SEL"
        input_snapshot["vehicle_configuration"] = {
            "source": "marketcheck",
            "field": "version",
            "values": [
                "Elantra SEL IVT FWD",
                "SEL IVT Front Wheel Drive",
            ],
        }

        result = service.create_from_confirmed_input(input_snapshot)

        self.assertTrue(current.requests)
        self.assertTrue(historical.requests)
        for request in (*current.requests, *historical.requests):
            self.assertEqual(request.trim, "SEL")
            self.assertEqual(request.drivetrain, "FWD")
            self.assertIsNotNone(request.configuration)
            assert request.configuration is not None
            self.assertEqual(request.configuration.source, "marketcheck")
            self.assertEqual(request.configuration.field, "version")
            self.assertEqual(
                request.configuration.values,
                (
                    "Elantra SEL IVT FWD",
                    "SEL IVT Front Wheel Drive",
                ),
            )

        artifact = result.artifact.to_dict()
        self.assertEqual(artifact["analysisRunSchemaVersion"], "8")
        self.assertEqual(artifact["analysisVersion"], "8")
        for field in ("currentSearchRequest", "historicalSearchRequest"):
            self.assertEqual(
                artifact["request"][field]["configuration"],
                input_snapshot["vehicle_configuration"],
            )

    def test_manual_without_offer_keeps_market_evidence_without_report_claims(self) -> None:
        service, _, _, _ = self.make_service(RecordingExtractor(make_report()))

        result = service.create_from_confirmed_input(
            confirmed_snapshot(mode="manual", offer=None)
        )
        presentation = AnalysisPresentationService(self.repository).get(
            result.run_id
        ).to_dict()

        self.assertEqual(result.artifact.to_dict()["analysisRunSchemaVersion"], "8")
        self.assertEqual(result.artifact.to_dict()["analysisVersion"], "8")
        self.assertEqual(
            result.artifact.to_dict()["evidenceContext"]["inputMode"], "MANUAL"
        )
        self.assertEqual(presentation["presentationVersion"], "4")
        self.assertEqual(presentation["analysisScope"]["inputMode"], "MANUAL")
        self.assertTrue(presentation["analysisScope"]["marketEvidenceAvailable"])
        self.assertFalse(presentation["analysisScope"]["reportReviewPerformed"])
        self.assertFalse(presentation["analysisScope"]["offerComparisonPerformed"])
        self.assertIsNone(presentation["reportReview"])
        self.assertEqual(presentation["cccComparables"]["rows"], [])
        self.assertIn(
            "No insurer valuation or stated offer was supplied",
            presentation["assessment"]["summary"],
        )
        self.assertTrue(presentation["primaryExternalEvidence"])
        self.assertNotIn("CCC", "\n".join(customer_copy(presentation)))
        self.assertIn(
            "does not apply invented dollar adjustments",
            presentation["analysisScope"]["methodologyDisclosure"],
        )

    def test_manual_offer_enables_only_offer_comparison(self) -> None:
        service, _, _, _ = self.make_service(RecordingExtractor(make_report()))

        result = service.create_from_confirmed_input(
            confirmed_snapshot(mode="manual", offer=20_000)
        )
        presentation = AnalysisPresentationService(self.repository).get(
            result.run_id
        ).to_dict()

        scope = presentation["analysisScope"]
        self.assertTrue(scope["offerComparisonPerformed"])
        self.assertTrue(scope["insurerValuationComparisonPerformed"])
        self.assertFalse(scope["reportReviewPerformed"])
        self.assertEqual(
            presentation["insurerValuation"]["source"], "CUSTOMER_ENTERED"
        )
        self.assertIsNotNone(
            presentation["insurerValuation"]["comparisonToPrimaryEvidence"]
        )

    def test_generic_partial_report_has_explicit_bounded_report_review(self) -> None:
        service, _, _, _ = self.make_service(RecordingExtractor(make_report()))
        normalized = normalize_ccc_report(make_report())
        normalized["report"]["provider"] = "Acme Valuations"
        normalized["report"]["providerId"] = "OTHER"

        result = service.create_from_confirmed_input(
            confirmed_snapshot(mode="report", offer=None),
            normalized_report=normalized,
            report_adapter="GENERIC",
            partial_extraction=True,
        )
        artifact = result.artifact.to_dict()
        presentation = AnalysisPresentationService(self.repository).get(
            RUN_ID_1
        ).to_dict()

        self.assertEqual(artifact["evidenceContext"]["reportAdapter"], "GENERIC")
        self.assertTrue(artifact["evidenceContext"]["partialExtraction"])
        self.assertTrue(presentation["analysisScope"]["reportReviewPerformed"])
        self.assertEqual(
            presentation["reportReview"],
            {
                "provider": "Acme Valuations",
                "adapter": "GENERIC",
                "partial": True,
                "comparablesAvailable": True,
                "adjustmentsAvailable": True,
            },
        )
        self.assertNotIn("storage", json.dumps(presentation).casefold())

    def test_report_without_extraction_uses_confirmed_facts_without_claiming_review(self) -> None:
        service, _, _, _ = self.make_service(RecordingExtractor(make_report()))

        result = service.create_from_confirmed_input(
            confirmed_snapshot(mode="report", offer=None),
            report_extraction_available=False,
        )
        artifact = result.artifact.to_dict()
        presentation = AnalysisPresentationService(self.repository).get(
            result.run_id
        ).to_dict()

        self.assertTrue(artifact["evidenceContext"]["reportAvailable"])
        self.assertFalse(
            artifact["evidenceContext"]["reportExtractionAvailable"]
        )
        scope = presentation["analysisScope"]
        self.assertEqual(scope["inputMode"], "REPORT")
        self.assertTrue(scope["reportAvailable"])
        self.assertFalse(scope["reportExtractionAvailable"])
        self.assertFalse(scope["reportReviewPerformed"])
        self.assertIsNone(presentation["reportReview"])
        self.assertEqual(presentation["cccComparables"]["rows"], [])
        self.assertTrue(presentation["primaryExternalEvidence"])


if __name__ == "__main__":
    unittest.main()
