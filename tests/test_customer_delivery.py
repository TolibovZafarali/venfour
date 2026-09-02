"""Offline customer-delivery service and HTTP contract coverage."""

from __future__ import annotations

import json
import os
import unittest
from collections.abc import Mapping
from typing import Any
from unittest.mock import patch

from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.customer_delivery import (
    CustomerDeliveryInputError,
    CustomerDeliveryNotFoundError,
    CustomerDeliveryService,
    validate_insurer_response_projection,
    validate_report_projection,
)
from venfour.supabase_gateway import (
    CUSTOMER_TOTAL_LOSS_REPORT_FILENAME,
    SupabaseContractError,
    SupabaseAuthenticationError,
)


CASE_ID = "20000000-0000-4000-8000-000000000002"
REPORT_ID = "30000000-0000-4000-8000-000000000003"
DRAFT_ID = "40000000-0000-4000-8000-000000000004"
MESSAGE_VERSION_ID = "50000000-0000-4000-8000-000000000005"
SENT_VERSION_ID = "51000000-0000-4000-8000-000000000005"
CLIENT_REQUEST_ID = "60000000-0000-4000-8000-000000000006"
EVENT_ID = "70000000-0000-4000-8000-000000000007"
COMMUNICATION_ID = "80000000-0000-4000-8000-000000000008"
ROUND_ID = "90000000-0000-4000-8000-000000000009"
SUPERSEDED_RESPONSE_ID = "91000000-0000-4000-8000-000000000009"
USER_ID = "10000000-0000-4000-8000-000000000001"
ACCESS_TOKEN = "browser-access-token"
NOW = "2026-08-29T12:00:00Z"
CONTENT_DIGEST = "a" * 64


def money(amount: int) -> dict[str, Any]:
    return {
        "amountMinorUnits": amount,
        "currency": "USD",
        "formatted": f"${amount / 100:,.2f}",
    }


def valid_report() -> dict[str, Any]:
    return {
        "reportId": REPORT_ID,
        "versionNumber": 1,
        "versionLabel": "v1",
        "issueDate": "2026-08-29",
        "suggestedFilename": "Venfour_Valuation_Evidence_CASE_v1.pdf",
        "status": "published",
        "title": "Venfour Total-Loss Valuation Evidence Package",
        "conclusion": {
            "classificationLabel": "Material undervalue signal",
            "continuingSupported": True,
            "insurerValuation": money(1_800_000),
            "supportedRange": {
                "low": money(2_000_000),
                "median": money(2_100_000),
                "high": money(2_200_000),
                "evidenceBasis": "Current advertised-price evidence",
            },
            "indicatedDifference": money(300_000),
            "summary": "The evidence supports a written reconsideration request.",
            "limitations": ["Advertised prices are not transaction prices."],
            "preliminaryComparison": {
                "status": "CONFIRMED",
                "summary": "The completed result confirms the preliminary range.",
            },
        },
        "subjectVehicle": {"description": "2022 Honda Accord EX-L"},
        "insurerEvidence": {
            "insurerName": "Example Insurance",
            "comparableCount": 3,
            "summary": {
                "totalCount": 3,
                "advertisedPriceMissingCount": 0,
                "adjustedValueMissingCount": 0,
                "fullyDisclosedAdjustmentCount": 3,
                "partiallyDisclosedAdjustmentCount": 0,
                "undisclosedAdjustmentCount": 0,
                "unavailableAdjustmentCount": 0,
                "advertisedPrices": {
                    "count": 3,
                    "low": money(1_980_000),
                    "median": money(2_010_000),
                    "high": money(2_040_000),
                },
                "adjustedValues": {
                    "count": 3,
                    "low": money(2_000_000),
                    "median": money(2_000_000),
                    "high": money(2_000_000),
                },
            },
            "comparables": [
                {
                    "vehicle": "2022 Honda Accord EX-L",
                    "mileage": 32_000,
                    "advertisedPrice": "$19,800.00",
                    "adjustedValue": "$20,000.00",
                    "netAdjustment": "$200.00",
                    "adjustments": {
                        "package": "$0.00",
                        "options": "$0.00",
                        "mileage": "$200.00",
                        "condition": "$0.00",
                    },
                    "adjustmentDisclosure": "Fully disclosed",
                    "contributionPercent": 33.33,
                }
            ],
            "methodologyStatement": "Insurer comparables are shown descriptively.",
            "adjustmentContext": (
                "Insurer adjustments are shown as disclosed in the reviewed report; "
                "Venfour does not invent missing adjustment details."
            ),
        },
        "marketEvidence": {
            "primary": {
                "label": "Current market evidence",
                "description": "Selected current advertised listings.",
                "evidenceDate": "2026-08-29",
                "selectedCount": 1,
                "prices": {
                    "count": 1,
                    "low": money(2_100_000),
                    "median": money(2_100_000),
                    "high": money(2_100_000),
                },
            },
            "secondary": None,
            "comparables": [
                {
                    "role": "primary",
                    "vehicle": "2022 Honda Accord EX-L",
                    "mileage": 31_500,
                    "advertisedPrice": "$21,000.00",
                    "dealer": "Example Motors",
                    "location": "Chicago, IL",
                    "distanceMiles": 12.5,
                    "evidenceDate": "2026-08-29",
                    "temporalBasis": "Current listing",
                }
            ],
            "methodologyStatement": "Only frozen deterministic evidence is shown.",
            "evidenceDateContext": {
                "lossDate": "2026-08-20",
                "currentObservedDate": "2026-08-29",
                "historicalEvidenceDate": None,
            },
        },
    }


def education_projection() -> dict[str, Any]:
    empty = {"viewedAt": None, "completedAt": None, "skippedAt": None}
    return {
        "reportVersionId": REPORT_ID,
        "steps": {
            step: dict(empty)
            for step in (
                "result",
                "insurer_review",
                "valuation",
                "report",
                "what_next",
                "send",
            )
        },
    }


def sending_projection() -> dict[str, Any]:
    return {
        "customerName": "Owner Example",
        "insurerName": "Example Insurance",
        "claimReference": "CLM 123",
        "vehicleDescription": "2022 Honda Accord EX-L",
        "adjusterName": "Alex Adjuster",
        "adjusterEmail": "adjuster@example.test",
        "claimReferenceConfirmed": True,
        "adjusterEmailConfirmed": True,
        "revision": 1,
    }


def draft_projection() -> dict[str, Any]:
    return {
        "draftId": DRAFT_ID,
        "reportVersionId": REPORT_ID,
        "purpose": "initial_reconsideration",
        "recipient": "adjuster@example.test",
        "subject": "Request for valuation reconsideration - Claim CLM 123",
        "body": "Please review the attached evidence package.",
        "revision": 1,
        "updatedAt": NOW,
    }


def response_upload_projection() -> dict[str, Any]:
    return {
        "documentId": CLIENT_REQUEST_ID,
        "uploadPath": (
            f"{USER_ID}/{CASE_ID}/insurer-responses/{CLIENT_REQUEST_ID}.jpg"
        ),
        "originalFilename": "adjuster-response.jpeg",
        "mediaType": "image/jpeg",
        "byteSize": 4096,
        "contentDigest": CONTENT_DIGEST,
    }


def insurer_response_projection(
    *,
    text: str | None = "First line\nSecond line",
    document_id: str | None = CLIENT_REQUEST_ID,
    offer: int | None = 2_100_000,
    supersedes_response_id: str | None = None,
) -> dict[str, Any]:
    return {
        "state": "insurer_response_received",
        "response": {
            "responseId": COMMUNICATION_ID,
            "clientRequestId": CLIENT_REQUEST_ID,
            "receivedAt": NOW,
            "sourceType": (
                "uploaded_document" if document_id is not None else "pasted_message"
            ),
            "text": text,
            "document": (
                {
                    "documentId": document_id,
                    "originalFilename": "adjuster-response.jpeg",
                    "mediaType": "image/jpeg",
                    "byteSize": 4096,
                }
                if document_id is not None
                else None
            ),
            "revisedOffer": (
                {"amountMinorUnits": offer, "currency": "USD"}
                if offer is not None
                else None
            ),
            "processingState": "pending",
            "failureReason": None,
            "supersedesResponseId": supersedes_response_id,
        },
        "workflowRevision": 5,
    }


class RecordingGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def authenticate(self, access_token: str) -> str:
        self.calls.append(("authenticate", access_token))
        return USER_ID

    def put_total_loss_education_progress(
        self, case_id: str, step: str, state: str, workflow_revision: int,
        access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(
            (
                "education",
                (case_id, step, state, workflow_revision, access_token),
            )
        )
        return education_projection()

    def get_total_loss_customer_reports(
        self, case_id: str, report_version_id: str | None, access_token: str,
    ) -> list[Mapping[str, Any]]:
        self.calls.append(
            ("reports", (case_id, report_version_id, access_token))
        )
        return [valid_report()]

    def create_total_loss_customer_report_download(
        self, case_id: str, report_version_id: str, user_id: str,
    ) -> Mapping[str, Any] | None:
        self.calls.append(
            ("download", (case_id, report_version_id, user_id))
        )
        return {
            "downloadUrl": "https://storage.example.test/signed-report?token=one",
            "suggestedFilename": CUSTOMER_TOTAL_LOSS_REPORT_FILENAME,
            "expiresAt": NOW,
        }

    def create_total_loss_insurer_response_original_download(
        self, case_id: str, response_id: str, user_id: str,
    ) -> Mapping[str, Any] | None:
        self.calls.append(("response_original", (case_id, response_id, user_id)))
        return {
            "downloadUrl": "https://storage.example.test/original?token=one",
            "suggestedFilename": "Insurer_Response_Original.png",
            "expiresAt": NOW,
        }

    def put_total_loss_sending_details(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(("sending", (case_id, dict(values), access_token)))
        return sending_projection()

    def get_total_loss_customer_message_draft(
        self, case_id: str, access_token: str,
    ) -> Mapping[str, Any] | None:
        self.calls.append(("draft", (case_id, access_token)))
        return draft_projection()

    def patch_total_loss_customer_message_draft(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(("edit", (case_id, dict(values), access_token)))
        return draft_projection()

    def prepare_total_loss_customer_message(
        self, case_id: str, client_request_id: str, workflow_revision: int,
        access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(
            (
                "prepare",
                (case_id, client_request_id, workflow_revision, access_token),
            )
        )
        return {
            "draft": draft_projection(),
            "messageVersion": {
                "messageVersionId": MESSAGE_VERSION_ID,
                "versionNumber": 1,
                "state": "prepared",
                "reportVersionId": REPORT_ID,
                "recipient": "adjuster@example.test",
                "subject": "Request for valuation reconsideration - Claim CLM 123",
                "body": "Please review the attached evidence package.",
                "createdAt": NOW,
            },
            "workflowRevision": 3,
        }

    def record_total_loss_customer_email_opened(
        self, case_id: str, message_version_id: str, client_request_id: str,
        access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(
            (
                "opened",
                (case_id, message_version_id, client_request_id, access_token),
            )
        )
        return {
            "status": "opened",
            "eventId": EVENT_ID,
            "messageVersionId": MESSAGE_VERSION_ID,
            "authoritativeSent": False,
        }

    def confirm_total_loss_customer_message_sent(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(("sent", (case_id, dict(values), access_token)))
        return {
            "state": "awaiting_insurer_response",
            "messageVersionId": SENT_VERSION_ID,
            "communicationId": COMMUNICATION_ID,
            "negotiationRoundId": ROUND_ID,
            "customerReportedSentAt": NOW,
            "workflowRevision": 4,
        }

    def prepare_total_loss_insurer_response_upload(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(
            ("prepare_response_upload", (case_id, dict(values), access_token))
        )
        return response_upload_projection()

    def record_total_loss_insurer_response(
        self, case_id: str, values: Mapping[str, Any], access_token: str,
    ) -> Mapping[str, Any]:
        self.calls.append(
            ("record_insurer_response", (case_id, dict(values), access_token))
        )
        document_id = values.get("documentId") or values.get(
            "retainedDocumentId"
        )
        return insurer_response_projection(
            text=values.get("responseText"),
            document_id=document_id,
            offer=values.get("revisedOfferMinorUnits"),
            supersedes_response_id=values.get("supersedesResponseId"),
        )


class CustomerDeliveryServiceTests(unittest.TestCase):
    def test_sending_details_are_normalized_before_the_database_boundary(self) -> None:
        gateway = RecordingGateway()
        service = CustomerDeliveryService(gateway)

        result = service.save_sending_details(
            CASE_ID,
            {
                "claimReference": "  CLM   123  ",
                "adjusterName": "  Alex   Adjuster ",
                "adjusterEmail": " Adjuster@Example.Test ",
                "claimReferenceConfirmed": True,
                "adjusterEmailConfirmed": True,
                "expectedRevision": 0,
                "expectedWorkflowRevision": 2,
            },
            ACCESS_TOKEN,
        )

        self.assertEqual(result, sending_projection())
        _, (_, values, _) = gateway.calls[-1]
        self.assertEqual(values["claimReference"], "CLM 123")
        self.assertEqual(values["adjusterName"], "Alex Adjuster")
        self.assertEqual(values["adjusterEmail"], "adjuster@example.test")

    def test_invalid_customer_sending_values_fail_before_auth_or_rpc(self) -> None:
        invalid_values = (
            {"adjusterEmail": "not-an-email"},
            {"adjusterEmail": "adjuster @example.test"},
            {"adjusterEmail": "adjuster@example.test\n"},
            {"claimReference": "CLM\u202e123"},
            {"claimReference": None, "claimReferenceConfirmed": True},
            {"adjusterEmail": None, "adjusterEmailConfirmed": True},
        )
        for overrides in invalid_values:
            with self.subTest(overrides=overrides):
                gateway = RecordingGateway()
                service = CustomerDeliveryService(gateway)
                values = {
                    "claimReference": "CLM 123",
                    "adjusterName": "Alex Adjuster",
                    "adjusterEmail": "adjuster@example.test",
                    "claimReferenceConfirmed": True,
                    "adjusterEmailConfirmed": True,
                    "expectedRevision": 0,
                    "expectedWorkflowRevision": 2,
                    **overrides,
                }
                with self.assertRaises(CustomerDeliveryInputError):
                    service.save_sending_details(CASE_ID, values, ACCESS_TOKEN)
                self.assertEqual(gateway.calls, [])

    def test_prepare_open_and_sent_keep_distinct_authority(self) -> None:
        service = CustomerDeliveryService(RecordingGateway())

        prepared = service.prepare(CASE_ID, CLIENT_REQUEST_ID, 2, ACCESS_TOKEN)
        opened = service.opened(
            CASE_ID, MESSAGE_VERSION_ID, CLIENT_REQUEST_ID, ACCESS_TOKEN
        )
        sent = service.sent(
            CASE_ID,
            {
                "messageVersionId": MESSAGE_VERSION_ID,
                "clientRequestId": CLIENT_REQUEST_ID,
                "expectedWorkflowRevision": 3,
                "confirmedReportAttached": True,
            },
            ACCESS_TOKEN,
        )

        self.assertEqual(prepared["messageVersion"]["state"], "prepared")
        self.assertFalse(opened["authoritativeSent"])
        self.assertEqual(sent["state"], "awaiting_insurer_response")
        self.assertEqual(sent["messageVersionId"], SENT_VERSION_ID)

    def test_prepare_response_upload_validates_and_preserves_exact_metadata(
        self,
    ) -> None:
        gateway = RecordingGateway()
        service = CustomerDeliveryService(gateway)
        values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "originalFilename": "adjuster-response.jpeg",
            "mediaType": "image/jpeg",
            "byteSize": 4096,
            "contentDigest": CONTENT_DIGEST,
        }

        result = service.prepare_response_upload(
            CASE_ID, values, ACCESS_TOKEN
        )

        self.assertEqual(result, response_upload_projection())
        self.assertEqual(
            gateway.calls,
            [
                ("authenticate", ACCESS_TOKEN),
                ("prepare_response_upload", (CASE_ID, values, ACCESS_TOKEN)),
            ],
        )

    def test_invalid_response_upload_fails_before_auth_or_rpc(self) -> None:
        valid = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "originalFilename": "adjuster-response.jpeg",
            "mediaType": "image/jpeg",
            "byteSize": 4096,
            "contentDigest": CONTENT_DIGEST,
        }
        invalid_values = (
            {**valid, "mediaType": []},
            {**valid, "mediaType": "image/gif"},
            {**valid, "originalFilename": "adjuster-response.png"},
            {**valid, "originalFilename": " adjuster-response.jpeg"},
            {**valid, "originalFilename": "adjuster  response.jpeg"},
            {**valid, "byteSize": 0},
            {**valid, "byteSize": 10 * 1024 * 1024 + 1},
            {**valid, "contentDigest": CONTENT_DIGEST.upper()},
            {**valid, "unexpected": True},
        )
        for values in invalid_values:
            with self.subTest(values=values):
                gateway = RecordingGateway()
                service = CustomerDeliveryService(gateway)
                with self.assertRaises(CustomerDeliveryInputError):
                    service.prepare_response_upload(
                        CASE_ID, values, ACCESS_TOKEN
                    )
                self.assertEqual(gateway.calls, [])

    def test_response_upload_rejects_noncanonical_storage_path(self) -> None:
        class PrefixedPathGateway(RecordingGateway):
            def prepare_total_loss_insurer_response_upload(
                self, case_id: str, values: Mapping[str, Any], access_token: str,
            ) -> Mapping[str, Any]:
                result = dict(
                    super().prepare_total_loss_insurer_response_upload(
                        case_id, values, access_token
                    )
                )
                result["uploadPath"] = "extra/" + result["uploadPath"]
                return result

        service = CustomerDeliveryService(PrefixedPathGateway())
        with self.assertRaisesRegex(
            SupabaseContractError, "upload path is invalid"
        ):
            service.prepare_response_upload(
                CASE_ID,
                {
                    "clientRequestId": CLIENT_REQUEST_ID,
                    "expectedWorkflowRevision": 4,
                    "originalFilename": "adjuster-response.jpeg",
                    "mediaType": "image/jpeg",
                    "byteSize": 4096,
                    "contentDigest": CONTENT_DIGEST,
                },
                ACCESS_TOKEN,
            )

    def test_record_response_preserves_multiline_text_and_material_identity(
        self,
    ) -> None:
        gateway = RecordingGateway()
        service = CustomerDeliveryService(gateway)
        text = "First line\r\nSecond\tcolumn"
        values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "responseText": text,
            "revisedOfferMinorUnits": 2_100_000,
            "documentId": CLIENT_REQUEST_ID,
            "retainedDocumentId": None,
            "supersedesResponseId": SUPERSEDED_RESPONSE_ID,
        }

        result = service.record_insurer_response(
            CASE_ID, values, ACCESS_TOKEN
        )

        self.assertEqual(result["state"], "insurer_response_received")
        self.assertEqual(result["response"]["clientRequestId"], CLIENT_REQUEST_ID)
        self.assertEqual(result["response"]["text"], text)
        self.assertEqual(
            result["response"]["supersedesResponseId"],
            SUPERSEDED_RESPONSE_ID,
        )
        self.assertEqual(
            gateway.calls,
            [
                ("authenticate", ACCESS_TOKEN),
                ("record_insurer_response", (CASE_ID, values, ACCESS_TOKEN)),
            ],
        )

    def test_invalid_response_material_fails_before_auth_or_rpc(self) -> None:
        valid = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "responseText": "Received response",
            "revisedOfferMinorUnits": None,
            "documentId": None,
            "retainedDocumentId": None,
            "supersedesResponseId": None,
        }
        invalid_values = (
            {**valid, "responseText": " \n\t"},
            {**valid, "responseText": "unsafe\u0000text"},
            {**valid, "responseText": "unsafe\u0085text"},
            {**valid, "responseText": "unsafe\u2066text"},
            {**valid, "responseText": None},
            {**valid, "revisedOfferMinorUnits": 0},
            {**valid, "revisedOfferMinorUnits": 9_007_199_254_740_992},
            {
                **valid,
                "documentId": CLIENT_REQUEST_ID,
                "retainedDocumentId": REPORT_ID,
            },
            {**valid, "documentId": REPORT_ID},
            {
                **valid,
                "responseText": None,
                "retainedDocumentId": REPORT_ID,
            },
            {**valid, "unexpected": True},
        )
        for values in invalid_values:
            with self.subTest(values=values):
                gateway = RecordingGateway()
                service = CustomerDeliveryService(gateway)
                with self.assertRaises(CustomerDeliveryInputError):
                    service.record_insurer_response(
                        CASE_ID, values, ACCESS_TOKEN
                    )
                self.assertEqual(gateway.calls, [])

    def test_insurer_response_projection_is_strict_and_idempotency_visible(
        self,
    ) -> None:
        projection = insurer_response_projection()["response"]
        self.assertEqual(
            validate_insurer_response_projection(projection)["clientRequestId"],
            CLIENT_REQUEST_ID,
        )
        with self.assertRaises(SupabaseContractError):
            validate_insurer_response_projection(
                {**projection, "unexpected": True}
            )
        with self.assertRaises(SupabaseContractError):
            validate_insurer_response_projection(
                {**projection, "sourceType": []}
            )

        for processing_state, failure_reason in (
            ("retryable_failed", "generic"),
            ("terminal_failed", "generic"),
            ("terminal_failed", "unreadable_document"),
            ("unsupported", "unsupported_document"),
        ):
            with self.subTest(
                processing_state=processing_state,
                failure_reason=failure_reason,
            ):
                validated = validate_insurer_response_projection(
                    {
                        **projection,
                        "processingState": processing_state,
                        "failureReason": failure_reason,
                    }
                )
                self.assertEqual(validated["failureReason"], failure_reason)

        for processing_state, failure_reason in (
            ("pending", "generic"),
            ("retryable_failed", None),
            ("unsupported", "generic"),
            ("terminal_failed", "INSURER_RESPONSE_MATERIAL_UNREADABLE"),
        ):
            with self.subTest(
                processing_state=processing_state,
                failure_reason=failure_reason,
            ), self.assertRaisesRegex(
                SupabaseContractError, "failure reason is invalid"
            ):
                validate_insurer_response_projection(
                    {
                        **projection,
                        "processingState": processing_state,
                        "failureReason": failure_reason,
                    }
                )

    def test_response_original_authenticates_and_returns_only_download_details(self) -> None:
        gateway = RecordingGateway()
        result = CustomerDeliveryService(gateway).download_response_original(
            CASE_ID, COMMUNICATION_ID, ACCESS_TOKEN
        )
        self.assertEqual(set(result), {"downloadUrl", "suggestedFilename", "expiresAt"})
        self.assertEqual(result["suggestedFilename"], "Insurer_Response_Original.png")
        self.assertEqual(gateway.calls, [
            ("authenticate", ACCESS_TOKEN),
            ("response_original", (CASE_ID, COMMUNICATION_ID, USER_ID)),
        ])

    def test_response_original_denied_and_invalid_authorizations_fail_closed(self) -> None:
        invalid_results = [
            None,
            {"storage_object_name": "private/path"},
            {"downloadUrl": "javascript:alert(1)", "suggestedFilename": "Insurer_Response_Original.pdf", "expiresAt": NOW},
            {"downloadUrl": "https://user:password@storage.example.test/file", "suggestedFilename": "Insurer_Response_Original.pdf", "expiresAt": NOW},
            {"downloadUrl": "https://storage.example.test/file", "suggestedFilename": "../unsafe.pdf", "expiresAt": NOW},
        ]
        for result in invalid_results:
            with self.subTest(result=result):
                gateway = RecordingGateway()
                with patch.object(gateway, "create_total_loss_insurer_response_original_download", return_value=result):
                    with self.assertRaises(CustomerDeliveryNotFoundError if result is None else SupabaseContractError):
                        CustomerDeliveryService(gateway).download_response_original(CASE_ID, COMMUNICATION_ID, ACCESS_TOKEN)
        gateway = RecordingGateway()
        with patch.object(gateway, "authenticate", side_effect=SupabaseAuthenticationError("expired")):
            with self.assertRaises(SupabaseAuthenticationError):
                CustomerDeliveryService(gateway).download_response_original(CASE_ID, COMMUNICATION_ID, ACCESS_TOKEN)
        self.assertEqual(gateway.calls, [])

    def test_report_download_uses_the_neutral_customer_filename(self) -> None:
        gateway = RecordingGateway()
        service = CustomerDeliveryService(gateway)

        result = service.download(CASE_ID, REPORT_ID, ACCESS_TOKEN)

        self.assertEqual(
            result["suggestedFilename"], CUSTOMER_TOTAL_LOSS_REPORT_FILENAME
        )
        self.assertEqual(
            gateway.calls,
            [
                ("authenticate", ACCESS_TOKEN),
                ("download", (CASE_ID, REPORT_ID, USER_ID)),
            ],
        )

    def test_report_download_rejects_a_legacy_customer_filename(self) -> None:
        class LegacyFilenameGateway(RecordingGateway):
            def create_total_loss_customer_report_download(
                self, case_id: str, report_version_id: str, user_id: str,
            ) -> Mapping[str, Any] | None:
                result = dict(
                    super().create_total_loss_customer_report_download(
                        case_id, report_version_id, user_id
                    )
                )
                result["suggestedFilename"] = valid_report()["suggestedFilename"]
                return result

        gateway = LegacyFilenameGateway()
        service = CustomerDeliveryService(gateway)

        with self.assertRaisesRegex(SupabaseContractError, "Report filename is invalid"):
            service.download(CASE_ID, REPORT_ID, ACCESS_TOKEN)

        self.assertEqual(
            gateway.calls,
            [
                ("authenticate", ACCESS_TOKEN),
                ("download", (CASE_ID, REPORT_ID, USER_ID)),
            ],
        )

    def test_report_contract_rejects_provider_and_listing_identity_leaks(self) -> None:
        for mutation in ("provider", "sourceListingId"):
            with self.subTest(mutation=mutation):
                report = valid_report()
                if mutation == "provider":
                    report["marketEvidence"]["primary"]["provider"] = "provider-name"
                else:
                    report["marketEvidence"]["comparables"][0][mutation] = "listing-1"
                with self.assertRaises(SupabaseContractError):
                    validate_report_projection(report)


class CustomerDeliveryApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.gateway = RecordingGateway()
        service = CustomerDeliveryService(self.gateway)
        with patch.dict(os.environ, {}, clear=True):
            self.client = TestClient(
                create_app(
                    customer_delivery_service=service,
                    enable_legacy_api=False,
                )
            )

    def tearDown(self) -> None:
        self.client.close()

    def test_sending_endpoint_requires_auth_and_returns_bounded_400s(self) -> None:
        path = f"/api/v1/appraisal-cases/{CASE_ID}/sending-details"
        payload = {
            "claimReference": "CLM 123",
            "adjusterName": "Alex Adjuster",
            "adjusterEmail": "adjuster@example.test",
            "claimReferenceConfirmed": True,
            "adjusterEmailConfirmed": True,
            "expectedRevision": 0,
            "expectedWorkflowRevision": 2,
        }

        missing = self.client.put(path, json=payload)
        invalid = self.client.put(
            path,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={**payload, "adjusterEmail": "not-an-email"},
        )
        valid = self.client.put(
            path,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json=payload,
        )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(missing.json()["error"]["code"], "AUTHENTICATION_REQUIRED")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            invalid.json()["error"]["code"],
            "INVALID_CUSTOMER_DELIVERY_REQUEST",
        )
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json(), sending_projection())

    def test_prepare_endpoint_returns_the_exact_versioned_contract(self) -> None:
        response = self.client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/message/prepare",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={
                "clientRequestId": CLIENT_REQUEST_ID,
                "expectedWorkflowRevision": 2,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["draft"], draft_projection())
        self.assertEqual(response.json()["messageVersion"]["state"], "prepared")
        self.assertEqual(response.json()["workflowRevision"], 3)

    def test_prepare_response_upload_endpoint_returns_exact_projection(self) -> None:
        response = self.client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response/upload",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={
                "clientRequestId": CLIENT_REQUEST_ID,
                "expectedWorkflowRevision": 4,
                "originalFilename": "adjuster-response.jpeg",
                "mediaType": "image/jpeg",
                "byteSize": 4096,
                "contentDigest": CONTENT_DIGEST,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), response_upload_projection())

    def test_record_response_endpoint_accepts_maximum_escaped_text(
        self,
    ) -> None:
        response_text = "\\" * 100_000
        response = self.client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={
                "clientRequestId": CLIENT_REQUEST_ID,
                "expectedWorkflowRevision": 4,
                "responseText": response_text,
                "revisedOfferMinorUnits": None,
                "documentId": None,
                "retainedDocumentId": None,
                "supersedesResponseId": None,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "insurer_response_received")
        self.assertEqual(response.json()["response"]["text"], response_text)
        self.assertEqual(
            response.json()["response"]["clientRequestId"], CLIENT_REQUEST_ID
        )

    def test_record_response_endpoint_rejects_text_above_character_limit(self) -> None:
        response = self.client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={
                "clientRequestId": CLIENT_REQUEST_ID,
                "expectedWorkflowRevision": 4,
                "responseText": "x" * 100_001,
                "revisedOfferMinorUnits": None,
                "documentId": None,
                "retainedDocumentId": None,
                "supersedesResponseId": None,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"]["code"],
            "INVALID_CUSTOMER_DELIVERY_REQUEST",
        )

    def test_record_response_endpoint_rejects_body_above_transport_cap(self) -> None:
        payload = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "responseText": "Response received",
            "revisedOfferMinorUnits": None,
            "documentId": None,
            "retainedDocumentId": None,
            "supersedesResponseId": None,
        }
        body = json.dumps(payload).encode("utf-8") + b" " * (2 * 1024 * 1024)

        response = self.client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response",
            headers={
                "Authorization": f"Bearer {ACCESS_TOKEN}",
                "Content-Type": "application/json",
            },
            content=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"]["code"],
            "INVALID_CUSTOMER_DELIVERY_REQUEST",
        )
        self.assertEqual(self.gateway.calls, [])

    def test_response_original_endpoint_requires_auth_and_is_private(self) -> None:
        path = f"/api/v1/appraisal-cases/{CASE_ID}/claim/insurer-responses/{COMMUNICATION_ID}/original/download"
        self.assertEqual(self.client.post(path).status_code, 401)
        self.assertEqual(self.gateway.calls, [])
        response = self.client.post(path, headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(response.json()["suggestedFilename"], "Insurer_Response_Original.png")
        self.assertEqual(set(response.json()), {"downloadUrl", "suggestedFilename", "expiresAt"})
        with patch.object(self.gateway, "create_total_loss_insurer_response_original_download", return_value=None):
            denied = self.client.post(path, headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        self.assertEqual(denied.status_code, 404)
        self.assertIn("no-store", denied.headers["cache-control"])
        invalid = self.client.post(path.replace(COMMUNICATION_ID, "invalid"), headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        self.assertEqual(invalid.status_code, 400)

    def test_report_download_endpoint_returns_the_neutral_customer_filename(self) -> None:
        response = self.client.get(
            f"/api/v1/appraisal-cases/{CASE_ID}/reports/{REPORT_ID}/download",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["suggestedFilename"],
            CUSTOMER_TOTAL_LOSS_REPORT_FILENAME,
        )
        self.assertEqual(
            self.gateway.calls[-2:],
            [
                ("authenticate", ACCESS_TOKEN),
                ("download", (CASE_ID, REPORT_ID, USER_ID)),
            ],
        )


if __name__ == "__main__":
    unittest.main()
