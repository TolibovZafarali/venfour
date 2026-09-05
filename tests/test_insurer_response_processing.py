from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pymupdf

from tests import test_report_evidence as report_evidence_fixtures
from tests import test_valuation_evidence_report as report_fixtures
from venfour.insurer_response_analysis import (
    INSURER_RESPONSE_ANALYSIS_INPUT_SCHEMA_VERSION,
    INSURER_RESPONSE_ANALYSIS_PROMPT_VERSION,
    INSURER_RESPONSE_ANALYSIS_PROVIDER_IDENTIFIER,
    INSURER_RESPONSE_ANALYSIS_SCHEMA_VERSION,
    CompletedInsurerResponseAnalysis,
    InsurerResponseAnalysisConfiguration,
    InsurerResponseAnalysisTimeoutError,
    InsurerResponseAnalysisV1,
)
from venfour.insurer_response_processing import (
    INSURER_RESPONSE_CONTEXT_VERSION,
    TotalLossInsurerResponseProcessor,
    _allowlisted_context,
)
from venfour.customer_delivery import validate_insurer_response_projection
from venfour.package_processing import DeterministicPackageAssessmentBuilder
from venfour.supabase_gateway import SupabaseContractError


CASE_ID = "10000000-0000-4000-8000-000000000001"
JOB_ID = "20000000-0000-4000-8000-000000000002"
RUN_ID = "30000000-0000-4000-8000-000000000003"
TOKEN_ID = "40000000-0000-4000-8000-000000000004"
DOCUMENT_ID = "50000000-0000-4000-8000-000000000005"
CLIENT_REQUEST_ID = "60000000-0000-4000-8000-000000000006"
OWNER_ID = "70000000-0000-4000-8000-000000000007"
MODEL = "gpt-response-analysis-test"


def _analysis_context(
    *, response_text: str | None = "We revised the offer to $20,100.00.",
    document: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "contextVersion": INSURER_RESPONSE_CONTEXT_VERSION,
        "vehicle": {
            "vin": "1ABCDEFGH23456789",
            "year": 2021,
            "make": "Honda",
            "model": "Accord",
            "trim": "EX-L",
            "mileageAtLoss": 42_000,
        },
        "insurer": {
            "name": "Example Mutual",
            "originalOffer": {
                "minorUnits": 1_904_600,
                "currency": "USD",
                "display": "$19,046.00",
            },
        },
        "venfourAssessment": {
            "conclusionCode": "MATERIAL_UNDERVALUE_SIGNAL",
            "supportedRange": {
                "lowMinorUnits": 2_100_000,
                "medianMinorUnits": 2_175_000,
                "highMinorUnits": 2_250_000,
                "currency": "USD",
            },
            "findings": [
                {
                    "code": "MARKET_EVIDENCE",
                    "description": "Selected market evidence remains above the original offer.",
                }
            ],
            "limitations": [
                "Advertised prices are evidence, not guaranteed transactions."
            ],
            "reasonCodes": ["UNCHANGED_EVIDENCE"],
            "insurerComparableReview": {
                "comparables": [
                    {
                        "vehicle": "2021 Honda Accord EX-L",
                        "adjustedValue": "$19,200",
                    }
                ]
            },
            "independentMarketEvidence": {
                "comparables": [
                    {
                        "vehicle": "2021 Honda Accord EX-L",
                        "advertisedPrice": "$21,900",
                    }
                ]
            },
        },
        "customerRequest": {
            "subject": "Request to review total-loss valuation",
            "body": "Please review the valuation and comparable evidence.",
            "customerReportedSentAt": "2026-08-31T18:00:00Z",
        },
        "insurerResponse": {
            "text": response_text,
            "receivedAt": "2026-09-01T14:00:00Z",
            "document": document,
            "customerRecordedRevisedOffer": {
                "amountMinorUnits": 2_010_000,
                "currency": "USD",
            },
        },
        "journey": {
            "phase": "negotiation",
            "currentTask": "insurer_response_received",
            "negotiationRoundNumber": 1,
        },
    }


def _claim(outcome: str = "claimed") -> dict[str, Any]:
    if outcome == "not_found":
        return {
            "outcome": "not_found",
            "job_id": None,
            "run_id": None,
            "attempt_count": None,
            "status": None,
            "processing_expires_at": None,
        }
    status = {
        "claimed": "processing",
        "processing": "processing",
        "retry_scheduled": "retryable_failed",
        "completed": "completed",
        "terminal_failed": "terminal_failed",
        "unsupported": "unsupported",
        "superseded": "superseded",
    }[outcome]
    return {
        "outcome": outcome,
        "job_id": JOB_ID,
        "run_id": RUN_ID if outcome != "superseded" else None,
        "attempt_count": 1 if outcome != "superseded" else 0,
        "status": status,
        "processing_expires_at": (
            "2026-09-01T14:30:00Z" if status == "processing" else None
        ),
    }


class _Database:
    def __init__(
        self,
        *,
        claim: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        document_bytes: bytes | None = None,
        document_media_type: str = "application/pdf",
    ) -> None:
        self.claim = claim or _claim()
        self.context = context or _analysis_context()
        self.document_bytes = document_bytes
        self.document_media_type = document_media_type
        self.calls: list[tuple[str, Any]] = []
        self.completed: tuple[Any, ...] | None = None
        self.failed: tuple[Any, ...] | None = None

    def claim_current_total_loss_insurer_response_analysis(self, *args):
        self.calls.append(("claim", args))
        return self.claim

    def resolve_total_loss_insurer_response_analysis_context(self, *args):
        self.calls.append(("context", args))
        content = self.document_bytes
        if content is None:
            document_values = (None, None, None, None, None, None)
        else:
            extension = {
                "application/pdf": "pdf",
                "image/heic": "heic",
                "image/png": "png",
            }[self.document_media_type]
            document_values = (
                DOCUMENT_ID,
                "case-files",
                (
                    f"{OWNER_ID}/{CASE_ID}/insurer-responses/"
                    f"{DOCUMENT_ID}.{extension}"
                ),
                self.document_media_type,
                len(content),
                hashlib.sha256(content).hexdigest(),
            )
        return {
            "job_id": JOB_ID,
            "run_id": RUN_ID,
            "case_id": CASE_ID,
            "analysis_context": self.context,
            "response_document_id": document_values[0],
            "response_document_bucket": document_values[1],
            "response_document_object_name": document_values[2],
            "response_document_media_type": document_values[3],
            "response_document_byte_size": document_values[4],
            "response_document_content_digest": document_values[5],
            "existing_extraction_version": None,
            "existing_extraction": None,
            "existing_extraction_digest": None,
            "final_assessment": None,
            "assessment_digest": "a" * 64,
            "customer_offer": (
                {
                    "offerId": "90000000-0000-4000-8000-000000000009",
                    "sourceCommunicationId": "80000000-0000-4000-8000-000000000008",
                    **self.context["insurerResponse"]["customerRecordedRevisedOffer"],
                }
                if self.context["insurerResponse"]["customerRecordedRevisedOffer"] is not None
                else None
            ),
        }

    def complete_total_loss_insurer_response_analysis(self, *args):
        self.completed = args
        return {
            "outcome": "completed",
            "status": "completed",
            "workflow_revision": 12,
        }

    def fail_total_loss_insurer_response_analysis(self, *args):
        self.failed = args
        kind = args[4]
        status = {
            "retryable": "retryable_failed",
            "terminal": "terminal_failed",
            "unsupported": "unsupported",
        }[kind]
        return {
            "outcome": status,
            "status": status,
            "workflow_revision": 12,
        }

    def retry_total_loss_insurer_response_analysis(self, *args):
        self.calls.append(("retry", args))
        return {
            "state": "insurer_response_reviewing",
            "processingState": "pending",
            "workflowRevision": 13,
        }

    @contextmanager
    def materialize_total_loss_insurer_response_document(self, *args):
        self.calls.append(("materialize", args))
        assert self.document_bytes is not None
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "response"
            path.write_bytes(self.document_bytes)
            yield path


def _payload(request) -> dict[str, Any]:
    response_ref = next(
        item["evidenceRef"]
        for item in request.response_materials
        if item["sourceType"] != "CUSTOMER_SUPPLIED_OFFER"
    )
    supplied = request.revised_offer_supplied
    assert supplied is not None
    case_ref = request.venfour_assessment["evidenceRef"]
    request_ref = request.customer_request["evidenceRef"]
    return {
        "schemaVersion": "1",
        "analysisSummary": {
            "whatInsurerSaid": "The insurer revised the offer.",
            "whatThisMeans": "The revised offer merits review against the saved evidence.",
            "responseEvidenceRefs": [response_ref],
            "caseEvidenceRefs": [case_ref],
        },
        "insurerPosition": {
            "category": "REVISED_OFFER",
            "summary": "The insurer made a revised offer.",
            "responseEvidenceRefs": [response_ref],
        },
        "revisedOffer": {
            "status": "PRESENT",
            "amountMinorUnits": supplied["amountMinorUnits"],
            "currency": supplied["currency"],
            "source": "CUSTOMER_SUPPLIED",
            "responseEvidenceRefs": [supplied["evidenceRef"]],
            "visualSourceInterpretation": None,
        },
        "requestDisposition": {
            "category": "PARTIALLY_ACCEPTED",
            "summary": "The offer changed while other issues remain unresolved.",
            "responseEvidenceRefs": [response_ref],
            "caseEvidenceRefs": [request_ref],
        },
        "responsePoints": [
            {
                "topic": "Offer",
                "disposition": "ACCEPTED",
                "whatInsurerSaid": "The insurer revised the offer.",
                "whatThisMeans": "The amount changed from the prior position.",
                "responseEvidenceRefs": [response_ref],
                "caseEvidenceRefs": [case_ref],
                "confidence": "HIGH",
            }
        ],
        "insurerArguments": [],
        "importantChanges": [
            {
                "description": "The offer amount changed.",
                "responseEvidenceRefs": [response_ref],
                "caseEvidenceRefs": [case_ref],
            }
        ],
        "unresolvedIssues": [
            {
                "description": "Comparable evidence remains unresolved.",
                "responseEvidenceRefs": [response_ref],
                "caseEvidenceRefs": [case_ref],
            }
        ],
        "recommendedNextStep": {
            "category": "REVIEW_REVISED_OFFER",
            "explanation": "Review the revised offer against the existing case evidence.",
            "responseEvidenceRefs": [response_ref],
            "caseEvidenceRefs": [case_ref],
        },
        "confidence": "HIGH",
        "uncertainties": [],
        "inputCoverage": {
            **dict(request.input_coverage),
            "limitations": list(request.input_coverage["limitations"]),
        },
        "untrustedInstructionDetected": bool(
            request.untrusted_instruction_signals
        ),
        "untrustedInstructionFollowed": False,
    }


class _Analyzer:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.requests = []

    def analyze(self, request, *, document=None):
        self.requests.append((request, document))
        if self.error is not None:
            raise self.error
        analysis = InsurerResponseAnalysisV1.from_dict(
            _payload(request), request=request
        )
        output = analysis.to_dict()
        output_digest = hashlib.sha256(
            json.dumps(
                output,
                ensure_ascii=True,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        return CompletedInsurerResponseAnalysis(
            provider_identifier=INSURER_RESPONSE_ANALYSIS_PROVIDER_IDENTIFIER,
            configured_model_identifier=MODEL,
            returned_model_identifier=MODEL,
            prompt_version=INSURER_RESPONSE_ANALYSIS_PROMPT_VERSION,
            schema_version=INSURER_RESPONSE_ANALYSIS_SCHEMA_VERSION,
            input_schema_version=INSURER_RESPONSE_ANALYSIS_INPUT_SCHEMA_VERSION,
            input_digest=request.input_digest,
            output_digest=output_digest,
            analysis=analysis,
            usage_metadata={"inputTokens": 100, "outputTokens": 50},
        )


def _processor(database: _Database, analyzer: _Analyzer):
    return TotalLossInsurerResponseProcessor(
        database,
        InsurerResponseAnalysisConfiguration(MODEL),
        analyzer=analyzer,
        token_factory=lambda: TOKEN_ID,
        retry_delay_seconds=30,
    )


class InsurerResponseProcessorTests(unittest.TestCase):
    def _frozen_subject_vehicle(self, mode: str) -> dict[str, Any]:
        if mode == "REPORT":
            fixture = report_evidence_fixtures.ReportEvidenceTests()
            fixture.setUp()
            self.addCleanup(fixture.doCleanups)
            package_context = fixture.context()
            manual_columns = (
                "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_trim",
                "vin", "mileage_at_loss", "vehicle_configuration",
            )
            package_context["confirmed_facts"].update(
                {field: None for field in manual_columns}
            )
            builder = DeterministicPackageAssessmentBuilder()
            source = builder.build_source_snapshot(
                package_context, fixture.source["sourceDocument"]
            )
            assessment = builder.build_final_assessment(source)
            for field in manual_columns:
                self.assertIsNone(package_context["confirmed_facts"][field])
        else:
            fixture = report_fixtures.ValuationEvidenceReportTests()
            fixture.setUp()
            self.addCleanup(fixture.doCleanups)
            source, assessment = fixture._source(mode="MANUAL")

        frozen_source = source.to_dict()
        self.assertEqual(frozen_source["input"]["intakeMode"], mode)
        vehicle = assessment.to_dict()["subjectVehicle"]
        facts = frozen_source["input"]["confirmedFacts"]
        for field in ("year", "make", "model", "trim", "mileage"):
            self.assertEqual(vehicle[field], facts[field])
        if mode == "REPORT":
            extracted = frozen_source["extraction"]["normalizedReport"]["vehicle"]
            for field in ("year", "make", "model", "trim", "mileage"):
                self.assertEqual(vehicle[field], extracted[field])
            self.assertIn(
                "REPORT_INPUT_FACTS_DERIVED_FROM_IMMUTABLE_ANALYSIS",
                frozen_source["validationManifest"]["limitations"],
            )
        else:
            self.assertIsNone(frozen_source["sourceDocument"])
            self.assertIsNone(frozen_source["extraction"])
        return vehicle

    @staticmethod
    def _context_with_frozen_vehicle(vehicle: dict[str, Any]) -> dict[str, Any]:
        context = _analysis_context()
        context["vehicle"] = {
            "vin": vehicle["vin"],
            "year": vehicle["year"],
            "make": vehicle["make"],
            "model": vehicle["model"],
            "trim": vehicle["trim"],
            "mileageAtLoss": vehicle["mileage"],
        }
        return context

    def test_frozen_report_vehicle_with_empty_manual_fields_reaches_analyzer(self) -> None:
        vehicle = self._frozen_subject_vehicle("REPORT")
        context = self._context_with_frozen_vehicle(vehicle)
        validated = _allowlisted_context(context)
        self.assertEqual(validated.vehicle_year, vehicle["year"])
        self.assertEqual(validated.vehicle_make, vehicle["make"])
        self.assertEqual(validated.vehicle_model, vehicle["model"])
        self.assertEqual(validated.vehicle_trim, vehicle["trim"])
        self.assertEqual(validated.vehicle_mileage, vehicle["mileage"])
        database = _Database(context=context)
        analyzer = _Analyzer()

        result = _processor(database, analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(len(analyzer.requests), 1)
        self.assertEqual(
            dict(analyzer.requests[0][0].vehicle),
            {field: vehicle[field] for field in ("year", "make", "model", "trim", "mileage")},
        )
        self.assertIsNotNone(database.completed)
        self.assertIsNone(database.failed)

    def test_frozen_manual_vehicle_retains_values_and_existing_model_allowlist(self) -> None:
        vehicle = self._frozen_subject_vehicle("MANUAL")
        self.assertIsNotNone(vehicle["vin"])
        self.assertIsNotNone(vehicle["vehicleConfiguration"])
        database = _Database(context=self._context_with_frozen_vehicle(vehicle))
        analyzer = _Analyzer()

        result = _processor(database, analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(len(analyzer.requests), 1)
        self.assertEqual(
            dict(analyzer.requests[0][0].vehicle),
            {field: vehicle[field] for field in ("year", "make", "model", "trim", "mileage")},
        )
        self.assertNotIn(vehicle["vin"], json.dumps(analyzer.requests[0][0].to_dict()))

    def test_missing_required_frozen_vehicle_facts_still_fail_before_analyzer(self) -> None:
        vehicle = self._frozen_subject_vehicle("REPORT")
        for field in ("year", "make", "model"):
            with self.subTest(field=field):
                context = self._context_with_frozen_vehicle(vehicle)
                context["vehicle"][field] = None
                database = _Database(context=context)
                analyzer = _Analyzer()

                result = _processor(database, analyzer).execute(CASE_ID)

                self.assertEqual(result.state, "terminal_failed")
                self.assertEqual(analyzer.requests, [])
                self.assertIsNone(database.completed)
                assert database.failed is not None
                self.assertEqual(database.failed[3:5], (
                    "INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID", "terminal",
                ))

    def test_invalid_frozen_vehicle_mileage_still_fails_before_analyzer(self) -> None:
        for value in (-1, True, "50000"):
            with self.subTest(mileage=value):
                context = _analysis_context()
                context["vehicle"]["mileageAtLoss"] = value
                database = _Database(context=context)
                analyzer = _Analyzer()

                result = _processor(database, analyzer).execute(CASE_ID)

                self.assertEqual(result.state, "terminal_failed")
                self.assertEqual(analyzer.requests, [])
                assert database.failed is not None
                self.assertEqual(database.failed[3], "INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID")

    def test_optional_frozen_vehicle_fields_are_not_invented(self) -> None:
        context = _analysis_context()
        context["vehicle"].update(vin=None, trim=None, mileageAtLoss=None)
        analyzer = _Analyzer()

        result = _processor(_Database(context=context), analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "completed")
        self.assertIsNone(analyzer.requests[0][0].vehicle["trim"])
        self.assertIsNone(analyzer.requests[0][0].vehicle["mileage"])

    def test_response_corrections_and_later_rounds_preserve_frozen_model_vehicle(self) -> None:
        vehicle = self._frozen_subject_vehicle("REPORT")
        digests = set()
        for round_number, response_text in (
            (1, "We revised the offer to $20,100.00."),
            (1, "Correction: the revised offer is $20,100.00 before deductible."),
            (2, "We reviewed your follow-up and maintain the $20,100.00 offer."),
        ):
            with self.subTest(round=round_number, response=response_text):
                context = self._context_with_frozen_vehicle(vehicle)
                context["journey"]["negotiationRoundNumber"] = round_number
                context["insurerResponse"]["text"] = response_text
                analyzer = _Analyzer()

                result = _processor(_Database(context=context), analyzer).execute(CASE_ID)

                self.assertEqual(result.state, "completed")
                request = analyzer.requests[0][0]
                self.assertEqual(
                    dict(request.vehicle),
                    {field: vehicle[field] for field in ("year", "make", "model", "trim", "mileage")},
                )
                digests.add(request.input_digest)
        self.assertEqual(len(digests), 3)

    def test_previous_context_version_cannot_reach_analyzer(self) -> None:
        context = _analysis_context()
        context["contextVersion"] = "1"
        database = _Database(context=context)
        analyzer = _Analyzer()

        result = _processor(database, analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(analyzer.requests, [])
        self.assertIsNone(database.completed)
        assert database.failed is not None
        self.assertEqual(database.failed[3], "INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID")

    def test_success_uses_only_allowlisted_model_context_and_persists_result(self) -> None:
        database = _Database()
        analyzer = _Analyzer()

        result = _processor(database, analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "completed")
        self.assertIsNotNone(database.completed)
        request = analyzer.requests[0][0].to_dict()
        serialized = json.dumps(request, sort_keys=True)
        for excluded in (
            CASE_ID,
            JOB_ID,
            RUN_ID,
            DOCUMENT_ID,
            OWNER_ID,
            "storage_object",
            "customerReportedSentAt",
            "receivedAt",
            "payment",
            "entitlement",
            "1ABCDEFGH23456789",
        ):
            self.assertNotIn(excluded, serialized)
        self.assertEqual(
            set(request),
            {
                "schemaVersion",
                "vehicle",
                "insurer",
                "priorPosition",
                "venfourAssessment",
                "caseEvidence",
                "customerRequest",
                "responseMaterials",
                "revisedOfferSupplied",
                "journeyState",
                "inputCoverage",
                "availableCaseEvidenceRefs",
                "availableResponseEvidenceRefs",
                "untrustedInstructionSignals",
                "inputDigest",
            },
        )
        completion = database.completed
        assert completion is not None
        self.assertEqual(completion[0:3], (JOB_ID, TOKEN_ID, RUN_ID))
        self.assertEqual(completion[5]["schemaVersion"], "1")
        self.assertNotIn("original_bytes", json.dumps(completion[9]))
        self.assertNotIn("providerFileCleanupSucceeded", completion[7])
        evidence_index = completion[12]
        self.assertEqual(
            set(evidence_index), {"responseEvidence", "caseEvidence"}
        )
        self.assertIn(
            request["customerRequest"]["evidenceRef"],
            {
                item["evidenceRef"]
                for item in evidence_index["caseEvidence"]
            },
        )
        self.assertIn(
            request["responseMaterials"][0]["evidenceRef"],
            {
                item["evidenceRef"]
                for item in evidence_index["responseEvidence"]
            },
        )
        self.assertEqual(
            completion[13],
            hashlib.sha256(
                json.dumps(
                    evidence_index,
                    ensure_ascii=False,
                    allow_nan=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest(),
        )
        projection = {
            "responseId": "80000000-0000-4000-8000-000000000008",
            "negotiationRoundId": "90000000-0000-4000-8000-000000000009",
            "outboundCommunicationId": "82000000-0000-4000-8000-000000000008",
            "canCorrect": True,
            "clientRequestId": CLIENT_REQUEST_ID,
            "receivedAt": "2026-09-01T14:00:00Z",
            "sourceType": "pasted_message",
            "text": "We revised the offer to $20,100.00.",
            "document": None,
            "revisedOffer": {
                "amountMinorUnits": 2_010_000,
                "currency": "USD",
            },
            "processingState": "completed",
            "failureReason": None,
            "supersedesResponseId": None,
            "analysis": completion[5],
            "analysisEvidence": evidence_index,
            "recommendation": None,
            "usableOffer": None,
            "decision": None,
        }
        self.assertEqual(
            validate_insurer_response_projection(projection)["analysisEvidence"],
            evidence_index,
        )
        missing_evidence = json.loads(json.dumps(projection))
        missing_evidence["analysisEvidence"]["responseEvidence"] = []
        with self.assertRaisesRegex(
            SupabaseContractError, "references are incomplete"
        ):
            validate_insurer_response_projection(missing_evidence)

    def test_real_assessment_classifications_and_exact_text_limit_are_preserved(
        self,
    ) -> None:
        context = _analysis_context(response_text="x" * 100_000)
        database = _Database(context=context)
        analyzer = _Analyzer()

        result = _processor(database, analyzer).execute(CASE_ID)

        self.assertEqual(result.state, "completed")
        request = analyzer.requests[0][0]
        self.assertEqual(
            request.venfour_assessment["classificationLabel"],
            "MATERIAL_UNDERVALUE_SIGNAL",
        )
        self.assertIs(request.venfour_assessment["continuingSupported"], True)
        self.assertEqual(
            sum(
                len(item["content"])
                for item in request.response_materials
                if item["sourceType"] == "PASTED_TEXT"
            ),
            100_000,
        )

        for conclusion, expected in (
            ("POTENTIAL_UNDERVALUE", True),
            ("NO_MATERIAL_DISCREPANCY", False),
            ("INSUFFICIENT_EVIDENCE", None),
        ):
            with self.subTest(conclusion=conclusion):
                selected = _analysis_context()
                selected["venfourAssessment"]["conclusionCode"] = conclusion
                selected_database = _Database(context=selected)
                selected_analyzer = _Analyzer()
                self.assertEqual(
                    _processor(selected_database, selected_analyzer)
                    .execute(CASE_ID)
                    .state,
                    "completed",
                )
                self.assertIs(
                    selected_analyzer.requests[0][0].venfour_assessment[
                        "continuingSupported"
                    ],
                    expected,
                )

    def test_missing_runtime_analyzer_records_retryable_failure(self) -> None:
        database = _Database()
        processor = TotalLossInsurerResponseProcessor(
            database,
            InsurerResponseAnalysisConfiguration(MODEL),
            analyzer=None,
            token_factory=lambda: TOKEN_ID,
            retry_delay_seconds=30,
        )

        result = processor.execute(CASE_ID)

        self.assertEqual(result.state, "retryable_failed")
        assert database.failed is not None
        self.assertEqual(
            database.failed[3:5],
            ("INSURER_RESPONSE_ANALYSIS_NOT_CONFIGURED", "retryable"),
        )

    def test_pdf_and_unsupported_image_are_derived_without_replacing_original(self) -> None:
        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((72, 72), "We reviewed the request and revised the offer.")
        pdf_bytes = pdf.tobytes()
        pdf.close()
        for media_type, content, expected_coverage in (
            ("application/pdf", pdf_bytes, "AVAILABLE"),
            ("image/heic", b"\x00\x00\x00\x18ftypheic" + b"x" * 32, "UNSUPPORTED"),
        ):
            with self.subTest(media_type=media_type):
                descriptor = {
                    "originalFilename": (
                        "response.pdf"
                        if media_type == "application/pdf"
                        else "response.heic"
                    ),
                    "mediaType": media_type,
                    "byteSize": len(content),
                }
                database = _Database(
                    context=_analysis_context(document=descriptor),
                    document_bytes=content,
                    document_media_type=media_type,
                )
                analyzer = _Analyzer()
                result = _processor(database, analyzer).execute(CASE_ID)
                self.assertEqual(result.state, "completed")
                request, understanding = analyzer.requests[0]
                self.assertEqual(
                    request.input_coverage["document"], expected_coverage
                )
                self.assertEqual(understanding.original_bytes, content)
                completion = database.completed
                assert completion is not None
                extraction = completion[9]
                self.assertEqual(extraction["status"], expected_coverage)
                self.assertNotIn("originalBytes", extraction)

    def test_retryable_failure_is_recorded_and_competing_claims_do_no_provider_work(self) -> None:
        database = _Database()
        analyzer = _Analyzer(InsurerResponseAnalysisTimeoutError())
        result = _processor(database, analyzer).execute(CASE_ID)
        self.assertEqual(result.state, "retryable_failed")
        self.assertIsNotNone(database.failed)
        assert database.failed is not None
        self.assertEqual(database.failed[3:6], (
            "INSURER_RESPONSE_ANALYSIS_TIMEOUT",
            "retryable",
            30,
        ))

        for outcome in (
            "processing",
            "retry_scheduled",
            "completed",
            "not_found",
        ):
            with self.subTest(outcome=outcome):
                no_work_database = _Database(claim=_claim(outcome))
                no_work_analyzer = _Analyzer()
                no_work_result = _processor(
                    no_work_database, no_work_analyzer
                ).execute(CASE_ID)
                self.assertEqual(no_work_result.state, outcome)
                self.assertEqual(no_work_analyzer.requests, [])

    def test_unreadable_document_only_fails_gracefully_and_owner_retry_is_fenced(self) -> None:
        content = b"not a PDF"
        descriptor = {
            "originalFilename": "response.pdf",
            "mediaType": "application/pdf",
            "byteSize": len(content),
        }
        context = _analysis_context(response_text=None, document=descriptor)
        context["insurerResponse"]["customerRecordedRevisedOffer"] = None
        database = _Database(
            context=context,
            document_bytes=content,
            document_media_type="application/pdf",
        )
        analyzer = _Analyzer()
        result = _processor(database, analyzer).execute(CASE_ID)
        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(analyzer.requests, [])
        assert database.failed is not None
        self.assertEqual(database.failed[4], "terminal")

        retry = _processor(database, analyzer).retry(
            CASE_ID, CLIENT_REQUEST_ID, 12, "browser-token"
        )
        self.assertEqual(retry["processingState"], "pending")
        self.assertEqual(
            next(value for name, value in database.calls if name == "retry"),
            (CASE_ID, CLIENT_REQUEST_ID, 12, "browser-token"),
        )


if __name__ == "__main__":
    unittest.main()
