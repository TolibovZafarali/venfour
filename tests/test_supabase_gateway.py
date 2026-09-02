"""Offline tests for the server-only Supabase HTTP boundary."""

from __future__ import annotations

import base64
import hashlib
import json
import unittest
from unittest.mock import patch

import httpx

from venfour.supabase_gateway import (
    CUSTOMER_TOTAL_LOSS_REPORT_FILENAME,
    MAX_EXTRACTION_CACHE_BYTES,
    SupabaseAuthenticationError,
    SupabaseConfigurationError,
    SupabaseConflictError,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
    SupabaseResponseDocumentInvalidError,
    SupabaseServerConfiguration,
    SupabaseUnavailableError,
)


USER_ID = "10000000-0000-4000-8000-000000000001"
CASE_ID = "20000000-0000-4000-8000-000000000002"
JOB_ID = "30000000-0000-4000-8000-000000000003"
TOKEN_ID = "40000000-0000-4000-8000-000000000004"
RUN_ID = "50000000-0000-4000-8000-000000000005"
REPORT_UPLOAD_ID = "60000000-0000-4000-8000-000000000006"
TRIM_TOKEN_ID = "70000000-0000-4000-8000-000000000007"
CLAIM_ID = "80000000-0000-4000-8000-000000000008"
ENTITLEMENT_ID = "90000000-0000-4000-8000-000000000009"
PACKAGE_JOB_ID = "a0000000-0000-4000-8000-00000000000a"
WORK_ITEM_ID = "b0000000-0000-4000-8000-00000000000b"
SOURCE_SNAPSHOT_ID = "c0000000-0000-4000-8000-00000000000c"
FINAL_ASSESSMENT_ID = "d0000000-0000-4000-8000-00000000000d"
DISPATCH_TOKEN_ID = "e0000000-0000-4000-8000-00000000000e"
REPORT_SERIES_ID = "f0000000-0000-4000-8000-00000000000f"
REPORT_VERSION_ID = "11000000-0000-4000-8000-000000000011"
CLIENT_REQUEST_ID = "12000000-0000-4000-8000-000000000012"
RETAINED_DOCUMENT_ID = "13000000-0000-4000-8000-000000000013"
OUTBOUND_ID = "15000000-0000-4000-8000-000000000015"
SUPERSEDED_RESPONSE_ID = "14000000-0000-4000-8000-000000000014"
PDF_BYTES = b"%PDF-1.7\nsynthetic private report\n%%EOF\n"


def configuration() -> SupabaseServerConfiguration:
    return SupabaseServerConfiguration(
        url="https://project.supabase.co",
        publishable_key="publishable-test-key",
        service_role_key="service-role-test-key",
    )


class SupabaseHttpGatewayTests(unittest.TestCase):
    @staticmethod
    def deliverable_locator() -> dict[str, str]:
        return {
            "storage_bucket_id": "case-deliverables",
            "storage_object_name": (
                f"cases/{CASE_ID}/reports/{REPORT_SERIES_ID}/versions/"
                f"{REPORT_VERSION_ID}/valuation-evidence-package.pdf"
            ),
        }

    def test_deliverable_upload_uses_service_only_immutable_exact_path(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"Key": "created"})

        gateway, _ = self.gateway(handler)
        digest = hashlib.sha256(PDF_BYTES).hexdigest()

        outcome = gateway.upload_total_loss_deliverable_pdf(
            CASE_ID,
            REPORT_SERIES_ID,
            REPORT_VERSION_ID,
            self.deliverable_locator(),
            PDF_BYTES,
            digest,
        )

        self.assertEqual(outcome, "created")
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            request.url.path,
            (
                "/storage/v1/object/case-deliverables/cases/"
                f"{CASE_ID}/reports/{REPORT_SERIES_ID}/versions/"
                f"{REPORT_VERSION_ID}/valuation-evidence-package.pdf"
            ),
        )
        self.assertEqual(request.headers["authorization"], "Bearer service-role-test-key")
        self.assertEqual(request.headers["x-upsert"], "false")
        self.assertEqual(request.headers["content-type"], "application/pdf")
        self.assertEqual(request.content, PDF_BYTES)
        self.assertEqual(
            json.loads(base64.b64decode(request.headers["x-metadata"])),
            {
                "caseId": CASE_ID,
                "contentDigest": digest,
                "reportSeriesId": REPORT_SERIES_ID,
                "reportVersionId": REPORT_VERSION_ID,
                "sha256": digest,
            },
        )

    def test_deliverable_upload_conflict_accepts_only_exact_byte_replay(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "POST":
                return httpx.Response(409, json={"message": "duplicate"})
            return httpx.Response(200, content=PDF_BYTES)

        gateway, _ = self.gateway(handler)
        digest = hashlib.sha256(PDF_BYTES).hexdigest()

        self.assertEqual(
            gateway.upload_total_loss_deliverable_pdf(
                CASE_ID,
                REPORT_SERIES_ID,
                REPORT_VERSION_ID,
                self.deliverable_locator(),
                PDF_BYTES,
                digest,
            ),
            "existing",
        )
        self.assertEqual([request.method for request in requests], ["POST", "GET"])

        with self.assertRaises(SupabaseContractError):
            gateway.upload_total_loss_deliverable_pdf(
                CASE_ID,
                REPORT_SERIES_ID,
                REPORT_VERSION_ID,
                self.deliverable_locator(),
                PDF_BYTES + b"changed",
                hashlib.sha256(PDF_BYTES + b"changed").hexdigest(),
            )

    def test_deliverable_upload_rejects_cross_case_or_legacy_path_before_io(
        self,
    ) -> None:
        requests: list[httpx.Request] = []
        gateway, _ = self.gateway(
            lambda request: requests.append(request) or httpx.Response(500)
        )
        digest = hashlib.sha256(PDF_BYTES).hexdigest()
        invalid_locators = (
            {
                **self.deliverable_locator(),
                "storage_object_name": (
                    f"cases/{USER_ID}/reports/{REPORT_SERIES_ID}/versions/"
                    f"{REPORT_VERSION_ID}/valuation-evidence-package.pdf"
                ),
            },
            {
                **self.deliverable_locator(),
                "storage_object_name": (
                    f"cases/{CASE_ID}/reports/{REPORT_SERIES_ID}/v1/"
                    "Venfour_Valuation_Evidence_case_v1.pdf"
                ),
            },
        )

        for locator in invalid_locators:
            with self.subTest(locator=locator["storage_object_name"]):
                with self.assertRaises(SupabaseContractError):
                    gateway.upload_total_loss_deliverable_pdf(
                        CASE_ID,
                        REPORT_SERIES_ID,
                        REPORT_VERSION_ID,
                        locator,
                        PDF_BYTES,
                        digest,
                    )

        self.assertEqual(requests, [])

    def test_report_locator_and_extraction_cache_use_exact_privilege_boundaries(self) -> None:
        requests: list[httpx.Request] = []
        locator = {
            "case_id": CASE_ID,
            "bucket_id": "case-files",
            "storage_owner_id": USER_ID,
            "canonical_object_path": f"{USER_ID}/{CASE_ID}/valuation-report.pdf",
            "backup_object_path": f"{USER_ID}/{CASE_ID}/valuation-report-backup.pdf",
            "finalized_upload_id": REPORT_UPLOAD_ID,
        }
        cache_row = {
            "case_id": CASE_ID,
            "report_upload_id": REPORT_UPLOAD_ID,
            "analysis_input_revision": 2,
            "provider_name": "Acme Valuations",
            "extraction_status": "needs_confirmation",
            "confidence": 0.65,
            "extraction_schema_version": "1",
            "normalized_report": {"schemaVersion": "1", "safe": True},
        }

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            return httpx.Response(
                200,
                json={
                    "get_owned_total_loss_report_storage_locator": [locator],
                    "get_total_loss_report_extraction": [cache_row],
                    "persist_total_loss_report_extraction": [cache_row],
                }[name],
            )

        gateway, _ = self.gateway(handler)

        self.assertEqual(
            gateway.get_owned_total_loss_report_storage_locator(
                CASE_ID, "browser-access-token"
            ),
            locator,
        )
        self.assertEqual(
            gateway.get_total_loss_report_extraction(
                CASE_ID, REPORT_UPLOAD_ID, 2
            ),
            cache_row,
        )
        self.assertEqual(
            gateway.persist_total_loss_report_extraction(
                CASE_ID,
                REPORT_UPLOAD_ID,
                2,
                "Acme Valuations",
                "needs_confirmation",
                0.65,
                "1",
                {"schemaVersion": "1", "safe": True},
            ),
            cache_row,
        )

        locator_request, get_request, persist_request = requests
        self.assertEqual(
            locator_request.headers["authorization"],
            "Bearer browser-access-token",
        )
        self.assertEqual(locator_request.headers["apikey"], "publishable-test-key")
        for request in (get_request, persist_request):
            self.assertEqual(
                request.headers["authorization"], "Bearer service-role-test-key"
            )
        self.assertEqual(
            json.loads(locator_request.content), {"case_id": CASE_ID}
        )
        self.assertEqual(
            json.loads(get_request.content),
            {
                "case_id": CASE_ID,
                "report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_revision": 2,
            },
        )
        self.assertEqual(
            json.loads(persist_request.content),
            {
                "case_id": CASE_ID,
                "report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_revision": 2,
                "provider_name": "Acme Valuations",
                "extraction_status": "needs_confirmation",
                "confidence": 0.65,
                "extraction_schema_version": "1",
                "normalized_report": {"schemaVersion": "1", "safe": True},
            },
        )

    def test_report_locator_cannot_select_another_owner_or_object(self) -> None:
        gateway, _ = self.gateway(
            lambda _request: httpx.Response(200, content=PDF_BYTES)
        )
        wrong_path = {
            "bucket_id": "case-files",
            "storage_owner_id": USER_ID,
            "canonical_object_path": f"{USER_ID}/{CASE_ID}/other.pdf",
        }
        with self.assertRaises(SupabaseContractError):
            with gateway.materialize_total_loss_report_from_locator(
                CASE_ID, wrong_path, REPORT_UPLOAD_ID
            ):
                pass

    def test_extraction_cache_rejects_oversized_or_db_invalid_metadata(self) -> None:
        gateway, _ = self.gateway(
            lambda _request: self.fail("invalid cache must not reach Supabase")
        )
        cases = (
            {
                "provider_name": "x" * 201,
                "extraction_status": "needs_confirmation",
                "confidence": 0.5,
                "schema_version": "1",
                "normalized": {"safe": True},
            },
            {
                "provider_name": None,
                "extraction_status": "needs_confirmation",
                "confidence": float("nan"),
                "schema_version": "1",
                "normalized": {"safe": True},
            },
            {
                "provider_name": None,
                "extraction_status": "needs_confirmation",
                "confidence": 0.5,
                "schema_version": "v1",
                "normalized": {"safe": True},
            },
            {
                "provider_name": None,
                "extraction_status": "failed",
                "confidence": None,
                "schema_version": "1",
                "normalized": {"safe": True},
            },
            {
                "provider_name": None,
                "extraction_status": "needs_confirmation",
                "confidence": 0.5,
                "schema_version": "1",
                "normalized": {"large": "x" * MAX_EXTRACTION_CACHE_BYTES},
            },
        )
        for values in cases:
            with self.subTest(values=values), self.assertRaises(
                SupabaseContractError
            ):
                gateway.persist_total_loss_report_extraction(
                    CASE_ID,
                    REPORT_UPLOAD_ID,
                    2,
                    values["provider_name"],
                    values["extraction_status"],
                    values["confidence"],
                    values["schema_version"],
                    values["normalized"],
                )

    def test_configuration_rejects_malformed_or_reused_credentials(self) -> None:
        invalid_credentials = (
            ("publishable key", "service-role-test-key"),
            ("publishable-test-key ", "service-role-test-key"),
            ("publishable-test-key", "service\nrole"),
            ("same-key", "same-key"),
        )
        for publishable_key, service_role_key in invalid_credentials:
            with self.subTest(
                publishable_key=publishable_key,
                service_role_key=service_role_key,
            ):
                with self.assertRaises(SupabaseConfigurationError):
                    SupabaseServerConfiguration(
                        url="https://project.supabase.co",
                        publishable_key=publishable_key,
                        service_role_key=service_role_key,
                    )

    def gateway(
        self, handler: object
    ) -> tuple[SupabaseHttpGateway, httpx.Client]:
        client = httpx.Client(
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
        )
        self.addCleanup(client.close)
        return SupabaseHttpGateway(configuration(), client=client), client

    def test_auth_validates_the_browser_bearer_with_publishable_key(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"id": USER_ID})

        gateway, _ = self.gateway(handler)

        self.assertEqual(gateway.authenticate("browser-access-token"), USER_ID)
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(
            str(request.url), "https://project.supabase.co/auth/v1/user"
        )
        self.assertEqual(request.headers["apikey"], "publishable-test-key")
        self.assertEqual(
            request.headers["authorization"], "Bearer browser-access-token"
        )
        self.assertNotIn("service-role-test-key", request.headers.values())

    def test_auth_rejects_invalid_tokens_and_does_not_follow_redirects(self) -> None:
        for response in (
            httpx.Response(401, json={"message": "invalid"}),
            httpx.Response(302, headers={"Location": "https://evil.invalid"}),
        ):
            with self.subTest(status=response.status_code):
                gateway, _ = self.gateway(lambda _request, r=response: r)
                expected = (
                    SupabaseAuthenticationError
                    if response.status_code == 401
                    else SupabaseUnavailableError
                )
                with self.assertRaises(expected):
                    gateway.authenticate("bad-token")

    def test_case_claim_rpcs_use_exact_names_arguments_and_privilege_boundaries(
        self,
    ) -> None:
        requests: list[httpx.Request] = []
        resume = {
            "state": "secure_required",
            "case_id": CASE_ID,
            "contact_email": "owner@example.com",
            "workflow_phase": "review",
            "workflow_current_task": "secure_claim",
            "workflow_revision": 1,
        }
        renewal = {
            "state": "secure_required",
            "case_id": CASE_ID,
            "contact_email": "owner@example.com",
            "claim_id": CLAIM_ID,
            "claim_expires_at": "2026-08-26T18:30:00+00:00",
        }
        recovery = {
            "send_allowed": True,
            "claim_id": CLAIM_ID,
            "claim_expires_at": "2026-08-26T18:30:00+00:00",
            "requested_email": "owner@example.com",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            return httpx.Response(
                200,
                json={
                    "resolve_total_loss_case_claim": [resume],
                    "renew_total_loss_case_claim": [renewal],
                    "prepare_total_loss_case_access_recovery": [recovery],
                }[name],
            )

        gateway, _ = self.gateway(handler)

        self.assertEqual(
            gateway.resolve_total_loss_case_claim(CASE_ID, "browser-token"),
            resume,
        )
        self.assertEqual(
            gateway.renew_total_loss_case_claim(CASE_ID, "browser-token"),
            renewal,
        )
        self.assertEqual(
            gateway.prepare_total_loss_case_access_recovery(
                CASE_ID,
                "owner@example.com",
                "a" * 64,
                "b" * 64,
            ),
            recovery,
        )

        expected_bodies = {
            "resolve_total_loss_case_claim": {
                "requested_case_id": CASE_ID,
            },
            "renew_total_loss_case_claim": {
                "requested_case_id": CASE_ID,
            },
            "prepare_total_loss_case_access_recovery": {
                "requested_case_id": CASE_ID,
                "email": "owner@example.com",
                "requester_fingerprint": "a" * 64,
                "target_fingerprint": "b" * 64,
            },
        }
        for request in requests:
            name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(json.loads(request.content), expected_bodies[name])
            self.assertEqual(request.method, "POST")
            if name == "prepare_total_loss_case_access_recovery":
                expected_key = "service-role-test-key"
                expected_bearer = "Bearer service-role-test-key"
            else:
                expected_key = "publishable-test-key"
                expected_bearer = "Bearer browser-token"
            self.assertEqual(request.headers["apikey"], expected_key)
            self.assertEqual(request.headers["authorization"], expected_bearer)

    def test_case_claim_user_rpcs_preserve_hidden_rows_and_auth_failures(
        self,
    ) -> None:
        for payload in (None, []):
            with self.subTest(payload=payload):
                gateway, _ = self.gateway(
                    lambda _request, value=payload: (
                        httpx.Response(200, content=b"null")
                        if value is None
                        else httpx.Response(200, json=value)
                    )
                )
                self.assertIsNone(
                    gateway.resolve_total_loss_case_claim(
                        CASE_ID, "browser-token"
                    )
                )

        for response, expected in (
            (
                httpx.Response(401, json={"message": "invalid"}),
                SupabaseAuthenticationError,
            ),
            (
                httpx.Response(403, json={"message": "forbidden"}),
                SupabaseAuthenticationError,
            ),
            (
                httpx.Response(503, json={"message": "unavailable"}),
                SupabaseUnavailableError,
            ),
            (httpx.Response(200, json=[{}, {}]), SupabaseContractError),
        ):
            with self.subTest(status=response.status_code, expected=expected):
                gateway, _ = self.gateway(lambda _request, r=response: r)
                with self.assertRaises(expected):
                    gateway.renew_total_loss_case_claim(
                        CASE_ID, "browser-token"
                    )

    def test_insurer_response_user_rpcs_use_exact_names_and_arguments(
        self,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[{"outcome": "accepted"}])

        gateway, _ = self.gateway(handler)
        upload_values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "outboundCommunicationId": OUTBOUND_ID,
            "originalFilename": "response.pdf",
            "mediaType": "application/pdf",
            "byteSize": 1024,
            "contentDigest": "a" * 64,
            "supersedesResponseId": None,
        }
        record_values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "outboundCommunicationId": OUTBOUND_ID,
            "responseText": "Please see the revised offer.",
            "revisedOfferMinorUnits": 2_100_000,
            "documentId": None,
            "retainedDocumentId": RETAINED_DOCUMENT_ID,
            "supersedesResponseId": SUPERSEDED_RESPONSE_ID,
        }

        self.assertEqual(
            gateway.prepare_total_loss_insurer_response_upload(
                CASE_ID, upload_values, "browser-token"
            ),
            {"outcome": "accepted"},
        )
        self.assertEqual(
            gateway.record_total_loss_insurer_response(
                CASE_ID, record_values, "browser-token"
            ),
            {"outcome": "accepted"},
        )

        expected_bodies = {
            "prepare_total_loss_insurer_response_upload": {
                "requested_case_id": CASE_ID,
                "requested_client_request_id": CLIENT_REQUEST_ID,
                "expected_workflow_revision": 4,
                "requested_outbound_communication_id": OUTBOUND_ID,
                "requested_original_filename": "response.pdf",
                "requested_media_type": "application/pdf",
                "requested_byte_size": 1024,
                "requested_content_digest": "a" * 64,
                "requested_supersedes_response_id": None,
            },
            "record_total_loss_insurer_response": {
                "requested_case_id": CASE_ID,
                "requested_client_request_id": CLIENT_REQUEST_ID,
                "expected_workflow_revision": 4,
                "requested_outbound_communication_id": OUTBOUND_ID,
                "requested_response_text": "Please see the revised offer.",
                "requested_revised_offer_minor_units": 2_100_000,
                "requested_document_id": None,
                "requested_retained_document_id": RETAINED_DOCUMENT_ID,
                "requested_supersedes_response_id": SUPERSEDED_RESPONSE_ID,
            },
        }
        self.assertEqual(len(requests), 2)
        for request in requests:
            rpc_name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(request.method, "POST")
            self.assertEqual(json.loads(request.content), expected_bodies[rpc_name])
            self.assertEqual(request.headers["apikey"], "publishable-test-key")
            self.assertEqual(
                request.headers["authorization"], "Bearer browser-token"
            )

    def test_insurer_response_owner_denial_is_a_neutral_write_conflict(
        self,
    ) -> None:
        gateway, _ = self.gateway(
            lambda _request: httpx.Response(
                403,
                json={"code": "42501", "message": "unavailable"},
            )
        )
        upload_values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "outboundCommunicationId": OUTBOUND_ID,
            "originalFilename": "response.pdf",
            "mediaType": "application/pdf",
            "byteSize": 1024,
            "contentDigest": "a" * 64,
            "supersedesResponseId": None,
        }
        record_values = {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "outboundCommunicationId": OUTBOUND_ID,
            "responseText": "Please see the response.",
            "revisedOfferMinorUnits": None,
            "documentId": None,
            "retainedDocumentId": None,
            "supersedesResponseId": None,
        }

        for operation in (
            lambda: gateway.prepare_total_loss_insurer_response_upload(
                CASE_ID, upload_values, "browser-token"
            ),
            lambda: gateway.record_total_loss_insurer_response(
                CASE_ID, record_values, "browser-token"
            ),
        ):
            with self.subTest(operation=operation), self.assertRaises(
                SupabaseConflictError
            ):
                operation()

    def test_insurer_response_analysis_rpcs_keep_service_and_owner_boundaries(
        self,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            if name == "retry_total_loss_insurer_response_analysis":
                return httpx.Response(
                    200,
                    json={
                        "state": "insurer_response_reviewing",
                        "processingState": "pending",
                        "workflowRevision": 9,
                    },
                )
            return httpx.Response(200, json=[{"outcome": name}])

        gateway, _ = self.gateway(handler)
        self.assertEqual(
            gateway.claim_current_total_loss_insurer_response_analysis(
                CASE_ID,
                TOKEN_ID,
                "openai",
                "gpt-response-test",
                "1",
                "1",
                "1",
            ),
            {"outcome": "claim_current_total_loss_insurer_response_analysis"},
        )
        self.assertEqual(
            gateway.resolve_total_loss_insurer_response_analysis_context(
                JOB_ID, TOKEN_ID
            ),
            {
                "outcome": (
                    "resolve_total_loss_response_recommendation_processing_context"
                )
            },
        )
        self.assertEqual(
            gateway.retry_total_loss_insurer_response_analysis(
                CASE_ID, CLIENT_REQUEST_ID, 8, "browser-token"
            )["workflowRevision"],
            9,
        )

        claim, context, retry = requests
        self.assertEqual(
            json.loads(claim.content),
            {
                "requested_case_id": CASE_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_provider_identifier": "openai",
                "requested_model_identifier": "gpt-response-test",
                "requested_prompt_version": "1",
                "requested_schema_version": "1",
                "requested_context_version": "1",
            },
        )
        self.assertEqual(
            json.loads(context.content),
            {
                "requested_job_id": JOB_ID,
                "requested_processing_token": TOKEN_ID,
            },
        )
        self.assertEqual(
            json.loads(retry.content),
            {
                "requested_case_id": CASE_ID,
                "requested_client_request_id": CLIENT_REQUEST_ID,
                "expected_workflow_revision": 8,
            },
        )
        for request in (claim, context):
            self.assertEqual(
                request.headers["authorization"],
                "Bearer service-role-test-key",
            )
        self.assertEqual(
            retry.headers["authorization"], "Bearer browser-token"
        )

    def test_insurer_response_dispatch_rpcs_are_service_only_and_exact(
        self,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            if name == "list_due_total_loss_insurer_response_analysis_jobs":
                return httpx.Response(
                    200,
                    json=[
                        {
                            "job_id": JOB_ID,
                            "case_id": CASE_ID,
                            "attempt_count": 0,
                        }
                    ],
                )
            return httpx.Response(
                200,
                json=[{"job_id": JOB_ID, "case_id": CASE_ID}],
            )

        gateway, _ = self.gateway(handler)

        self.assertEqual(
            gateway.list_due_total_loss_insurer_response_analysis_jobs(25),
            [{"job_id": JOB_ID, "case_id": CASE_ID, "attempt_count": 0}],
        )
        self.assertEqual(
            gateway.resolve_total_loss_insurer_response_analysis_job_case(
                JOB_ID
            ),
            {"job_id": JOB_ID, "case_id": CASE_ID},
        )
        self.assertEqual(
            [json.loads(request.content) for request in requests],
            [
                {"requested_limit": 25},
                {"requested_job_id": JOB_ID},
            ],
        )
        for request in requests:
            self.assertEqual(
                request.headers["authorization"],
                "Bearer service-role-test-key",
            )

        before = len(requests)
        for limit in (0, 101, True):
            with self.subTest(limit=limit), self.assertRaises(
                SupabaseContractError
            ):
                gateway.list_due_total_loss_insurer_response_analysis_jobs(
                    limit
                )
        self.assertEqual(len(requests), before)

    def test_response_document_materialization_verifies_sealed_identity_but_not_content_semantics(
        self,
    ) -> None:
        content = b"malformed PDF material handled by the understanding layer"
        digest = hashlib.sha256(content).hexdigest()
        object_name = (
            f"{USER_ID}/{CASE_ID}/insurer-responses/{CLIENT_REQUEST_ID}.pdf"
        )
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, content=content)

        gateway, _ = self.gateway(handler)
        with gateway.materialize_total_loss_insurer_response_document(
            CASE_ID,
            CLIENT_REQUEST_ID,
            {
                "storage_bucket_id": "case-files",
                "storage_object_name": object_name,
            },
            "application/pdf",
            len(content),
            digest,
            TOKEN_ID,
        ) as path:
            self.assertEqual(path.read_bytes(), content)
        self.assertEqual(len(requests), 1)
        self.assertEqual(
            requests[0].url.path,
            f"/storage/v1/object/authenticated/case-files/{object_name}",
        )
        self.assertEqual(
            requests[0].headers["authorization"],
            "Bearer service-role-test-key",
        )

        with self.assertRaises(SupabaseContractError):
            with gateway.materialize_total_loss_insurer_response_document(
                CASE_ID,
                CLIENT_REQUEST_ID,
                {
                    "storage_bucket_id": "case-files",
                    "storage_object_name": object_name.replace(
                        CASE_ID, JOB_ID
                    ),
                },
                "application/pdf",
                len(content),
                digest,
                TOKEN_ID,
            ):
                pass
        with self.assertRaises(SupabaseResponseDocumentInvalidError):
            with gateway.materialize_total_loss_insurer_response_document(
                CASE_ID,
                CLIENT_REQUEST_ID,
                {
                    "storage_bucket_id": "case-files",
                    "storage_object_name": object_name,
                },
                "application/pdf",
                len(content),
                "f" * 64,
                TOKEN_ID,
            ):
                pass

    def test_magic_link_uses_service_role_otp_with_only_the_server_callback(
        self,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={})

        gateway, _ = self.gateway(handler)
        gateway.send_total_loss_case_magic_link(
            "owner@example.com",
            CLAIM_ID,
            "https://app.venfour.example/",
        )

        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(
            str(request.url.copy_with(query=None)),
            "https://project.supabase.co/auth/v1/otp",
        )
        self.assertEqual(
            request.url.params["redirect_to"],
            (
                "https://app.venfour.example/auth/callback/case-claim/"
                f"{CLAIM_ID}"
            ),
        )
        self.assertEqual(
            json.loads(request.content),
            {"email": "owner@example.com", "create_user": True},
        )
        self.assertEqual(request.headers["apikey"], "service-role-test-key")
        self.assertEqual(
            request.headers["authorization"], "Bearer service-role-test-key"
        )

    def test_response_original_signing_uses_exact_authorized_locator_and_safe_name(self) -> None:
        for media_type, extension in {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif"}.items():
            with self.subTest(media_type=media_type):
                requests: list[httpx.Request] = []
                object_path = f"{USER_ID}/{CASE_ID}/insurer-responses/{RETAINED_DOCUMENT_ID}.{extension}"
                def handler(request: httpx.Request) -> httpx.Response:
                    requests.append(request)
                    if request.url.path.endswith("/authorize_total_loss_insurer_response_original_download"):
                        return httpx.Response(200, json=[{
                            "case_id": CASE_ID, "response_id": SUPERSEDED_RESPONSE_ID,
                            "document_id": RETAINED_DOCUMENT_ID, "storage_owner_id": USER_ID,
                            "media_type": media_type, "storage_bucket_id": "case-files",
                            "storage_object_name": object_path,
                        }])
                    self.assertEqual(request.url.path, f"/storage/v1/object/sign/case-files/{object_path}")
                    self.assertEqual(json.loads(request.content), {"expiresIn": 120})
                    return httpx.Response(200, json={"signedURL": f"/object/sign/case-files/{object_path}?token=private%2Btoken&download=unsafe.pdf"})
                gateway, _ = self.gateway(handler)
                result = gateway.create_total_loss_insurer_response_original_download(CASE_ID, SUPERSEDED_RESPONSE_ID, USER_ID)
                assert result is not None
                self.assertEqual(set(result), {"downloadUrl", "suggestedFilename", "expiresAt"})
                self.assertEqual(result["suggestedFilename"], f"Insurer_Response_Original.{extension}")
                self.assertEqual(httpx.URL(result["downloadUrl"]).params["download"], result["suggestedFilename"])
                self.assertEqual(httpx.URL(result["downloadUrl"]).params["token"], "private+token")
                self.assertEqual(json.loads(requests[0].content), {
                    "requested_case_id": CASE_ID,
                    "requested_response_id": SUPERSEDED_RESPONSE_ID,
                    "requested_user_id": USER_ID,
                })
                self.assertEqual(requests[0].headers["authorization"], "Bearer service-role-test-key")
                self.assertEqual(len(requests), 2)

    def test_response_original_denied_or_invalid_authorization_never_signs(self) -> None:
        row = {
            "case_id": CASE_ID, "response_id": SUPERSEDED_RESPONSE_ID,
            "document_id": RETAINED_DOCUMENT_ID, "storage_owner_id": USER_ID,
            "media_type": "application/pdf", "storage_bucket_id": "case-files",
            "storage_object_name": f"{USER_ID}/{CASE_ID}/insurer-responses/{RETAINED_DOCUMENT_ID}.pdf",
        }
        for mutation in [
            None, {"case_id": USER_ID}, {"response_id": USER_ID},
            {"storage_owner_id": CASE_ID}, {"document_id": CASE_ID},
            {"storage_bucket_id": "public"}, {"media_type": "text/html"},
            {"storage_object_name": f"{USER_ID}/{CASE_ID}/insurer-responses/../report.pdf"},
        ]:
            with self.subTest(mutation=mutation):
                requests: list[httpx.Request] = []
                def handler(request: httpx.Request) -> httpx.Response:
                    requests.append(request)
                    self.assertTrue(request.url.path.endswith("/authorize_total_loss_insurer_response_original_download"))
                    return httpx.Response(200, json=[] if mutation is None else [{**row, **mutation}])
                gateway, _ = self.gateway(handler)
                if mutation is None:
                    self.assertIsNone(gateway.create_total_loss_insurer_response_original_download(CASE_ID, SUPERSEDED_RESPONSE_ID, USER_ID))
                else:
                    with self.assertRaises(SupabaseContractError):
                        gateway.create_total_loss_insurer_response_original_download(CASE_ID, SUPERSEDED_RESPONSE_ID, USER_ID)
                self.assertEqual(len(requests), 1)

    def test_response_original_rejects_unsafe_or_failed_signing(self) -> None:
        object_path = f"{USER_ID}/{CASE_ID}/insurer-responses/{RETAINED_DOCUMENT_ID}.pdf"
        for signed_url in ["https://attacker.example/file?token=x", f"/object/sign/case-files/{object_path}?token=", f"/object/sign/case-files/{object_path}?token=x&token=y", None]:
            with self.subTest(signed_url=signed_url):
                def handler(request: httpx.Request) -> httpx.Response:
                    if request.url.path.endswith("/authorize_total_loss_insurer_response_original_download"):
                        return httpx.Response(200, json=[{
                            "case_id": CASE_ID, "response_id": SUPERSEDED_RESPONSE_ID,
                            "document_id": RETAINED_DOCUMENT_ID, "storage_owner_id": USER_ID,
                            "media_type": "application/pdf", "storage_bucket_id": "case-files",
                            "storage_object_name": object_path,
                        }])
                    return httpx.Response(503 if signed_url is None else 200, json={"signedURL": signed_url})
                gateway, _ = self.gateway(handler)
                with self.assertRaises(SupabaseUnavailableError if signed_url is None else SupabaseContractError):
                    gateway.create_total_loss_insurer_response_original_download(CASE_ID, SUPERSEDED_RESPONSE_ID, USER_ID)

    def test_customer_report_download_uses_neutral_name_without_changing_storage_identity(self) -> None:
        requests: list[httpx.Request] = []
        object_path = self.deliverable_locator()["storage_object_name"]
        signed_path = f"/storage/v1/object/sign/case-deliverables/{object_path}"

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith(
                "/rest/v1/rpc/authorize_total_loss_customer_report_download"
            ):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "case_id": CASE_ID,
                            "report_version_id": REPORT_VERSION_ID,
                            "report_series_id": REPORT_SERIES_ID,
                            "suggested_filename": "Venfour_Valuation_Evidence_CASE_v1.pdf",
                            "storage_bucket_id": "case-deliverables",
                            "storage_object_name": object_path,
                        }
                    ],
                )
            self.assertEqual(request.url.path, signed_path)
            return httpx.Response(
                200,
                json={
                    "signedURL": (
                        f"/object/sign/case-deliverables/{object_path}"
                        "?token=signed%2Bvalue&download=legacy.pdf"
                    )
                },
            )

        gateway, _ = self.gateway(handler)
        result = gateway.create_total_loss_customer_report_download(
            CASE_ID, REPORT_VERSION_ID, USER_ID
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(
            result["suggestedFilename"], CUSTOMER_TOTAL_LOSS_REPORT_FILENAME
        )
        download_url = httpx.URL(result["downloadUrl"])
        self.assertEqual(download_url.path, signed_path)
        self.assertEqual(download_url.params["token"], "signed+value")
        self.assertEqual(
            download_url.params["download"], CUSTOMER_TOTAL_LOSS_REPORT_FILENAME
        )
        self.assertEqual(len(requests), 2)
        self.assertEqual(
            json.loads(requests[0].content),
            {
                "requested_case_id": CASE_ID,
                "requested_report_version_id": REPORT_VERSION_ID,
                "requested_user_id": USER_ID,
            },
        )
        self.assertEqual(json.loads(requests[1].content), {"expiresIn": 120})

    def test_magic_link_rejects_untrusted_inputs_and_maps_delivery_failures(
        self,
    ) -> None:
        requests: list[httpx.Request] = []
        gateway, _ = self.gateway(
            lambda request: (
                requests.append(request)
                or httpx.Response(200, json={})
            )
        )
        invalid_values = (
            ("Owner@Example.com", CLAIM_ID, "https://app.venfour.example"),
            ("owner@example.com", "not-a-uuid", "https://app.venfour.example"),
            ("owner@example.com", CLAIM_ID, "http://app.venfour.example"),
            ("owner@example.com", CLAIM_ID, "https://evil.example/path"),
            ("owner@example.com", CLAIM_ID, "https://user:pass@evil.example"),
        )
        for email, claim_id, origin in invalid_values:
            with self.subTest(email=email, claim_id=claim_id, origin=origin):
                with self.assertRaises(SupabaseContractError):
                    gateway.send_total_loss_case_magic_link(
                        email, claim_id, origin
                    )
        self.assertEqual(requests, [])

        for response in (
            httpx.Response(429, json={"message": "rate limited"}),
            httpx.Response(302, headers={"location": "https://evil.invalid"}),
        ):
            with self.subTest(status=response.status_code):
                gateway, _ = self.gateway(lambda _request, r=response: r)
                with self.assertRaises(SupabaseUnavailableError):
                    gateway.send_total_loss_case_magic_link(
                        "owner@example.com",
                        CLAIM_ID,
                        "https://app.venfour.example",
                    )

        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("synthetic timeout", request=request)

        gateway, _ = self.gateway(timeout)
        with self.assertRaises(SupabaseUnavailableError):
            gateway.send_total_loss_case_magic_link(
                "owner@example.com",
                CLAIM_ID,
                "https://app.venfour.example",
            )

    def test_rpc_names_arguments_and_service_role_headers_are_exact(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            responses = {
                "claim_total_loss_analysis": [
                    {"outcome": "processing", "attempt_count": 2}
                ],
                "get_total_loss_analysis_status": {
                    "outcome": "not_submitted"
                },
                "complete_total_loss_analysis": True,
                "fail_total_loss_analysis": [
                    {"fail_total_loss_analysis": True}
                ],
                "get_owned_analysis_run": {"artifact": {"runId": RUN_ID}},
            }
            return httpx.Response(200, json=responses[name])

        gateway, _ = self.gateway(handler)
        artifact = {"runId": RUN_ID, "safe": True}

        self.assertEqual(
            gateway.claim_total_loss_analysis(CASE_ID, USER_ID, TOKEN_ID)[
                "outcome"
            ],
            "processing",
        )
        self.assertEqual(
            gateway.get_total_loss_analysis_status(CASE_ID, USER_ID)["outcome"],
            "not_submitted",
        )
        self.assertTrue(
            gateway.complete_total_loss_analysis(
                JOB_ID, TOKEN_ID, RUN_ID, artifact
            )
        )
        self.assertTrue(
            gateway.fail_total_loss_analysis(
                JOB_ID, TOKEN_ID, "REPORT_UNAVAILABLE", True
            )
        )
        self.assertEqual(
            gateway.get_owned_analysis_run(RUN_ID, USER_ID), {"runId": RUN_ID}
        )

        expected_bodies = {
            "claim_total_loss_analysis": {
                "case_id": CASE_ID,
                "user_id": USER_ID,
                "processing_token": TOKEN_ID,
            },
            "get_total_loss_analysis_status": {
                "case_id": CASE_ID,
                "user_id": USER_ID,
            },
            "complete_total_loss_analysis": {
                "job_id": JOB_ID,
                "processing_token": TOKEN_ID,
                "run_id": RUN_ID,
                "artifact": artifact,
            },
            "fail_total_loss_analysis": {
                "job_id": JOB_ID,
                "processing_token": TOKEN_ID,
                "failure_code": "REPORT_UNAVAILABLE",
                "retryable": True,
            },
            "get_owned_analysis_run": {
                "run_id": RUN_ID,
                "user_id": USER_ID,
            },
        }
        self.assertEqual(len(requests), len(expected_bodies))
        for request in requests:
            name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(
                str(request.url),
                f"https://project.supabase.co/rest/v1/rpc/{name}",
            )
            self.assertEqual(
                json.loads(request.content), expected_bodies[name]
            )
            self.assertEqual(request.headers["apikey"], "service-role-test-key")
            self.assertEqual(
                request.headers["authorization"],
                "Bearer service-role-test-key",
            )

    def test_package_processing_rpcs_preserve_exact_fenced_contracts(self) -> None:
        requests: list[httpx.Request] = []
        digest = "a" * 64
        source = {
            "schemaVersion": "1",
            "createdAt": "2026-08-26T12:30:00Z",
            "lineage": {"sourceSnapshotId": SOURCE_SNAPSHOT_ID},
            "sourceDocument": None,
            "extraction": None,
            "analysis": {"artifactDigest": digest},
            "evidenceCutoff": {"currentObservedDate": "2026-08-26"},
            "snapshotDigest": digest,
        }
        assessment = {
            "schemaVersion": "1",
            "methodologyVersion": "1",
            "finalClassification": "MATERIAL_UNDERVALUE_SIGNAL",
            "continuationStatus": "SUPPORTS_CONTINUATION",
            "insurerValuationReviewed": {"currency": "USD"},
            "supportedRange": {
                "currency": "USD",
                "lowMinorUnits": 2_000_000,
                "medianMinorUnits": 2_100_000,
                "highMinorUnits": 2_200_000,
            },
            "findings": [],
            "limitations": [],
            "preliminaryToFinalComparison": {
                "reasonCodes": ["UNCHANGED_EVIDENCE"]
            },
            "assessmentDigest": digest,
        }

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            responses = {
                "enqueue_total_loss_package_job": [
                    {"outcome": "created", "work_item_id": WORK_ITEM_ID}
                ],
                "reserve_due_workflow_work_items": [
                    {"work_item_id": WORK_ITEM_ID}
                ],
                "mark_workflow_work_item_dispatched": True,
                "release_workflow_work_item_dispatch": True,
                "claim_total_loss_package_work_item": [
                    {"outcome": "claimed", "work_item_id": WORK_ITEM_ID}
                ],
                "resolve_total_loss_package_source_context": [
                    {"work_item_id": WORK_ITEM_ID}
                ],
                "seal_total_loss_source_snapshot": [
                    {
                        "outcome": "created",
                        "source_snapshot_id": SOURCE_SNAPSHOT_ID,
                    }
                ],
                "persist_total_loss_final_assessment": [
                    {
                        "outcome": "created",
                        "final_assessment_id": FINAL_ASSESSMENT_ID,
                    }
                ],
                "complete_total_loss_package_work_item": True,
                "fail_total_loss_package_work_item": True,
            }
            return httpx.Response(200, json=responses[name])

        gateway, _ = self.gateway(handler)
        gateway.enqueue_total_loss_package_job(ENTITLEMENT_ID)
        gateway.reserve_due_workflow_work_items(DISPATCH_TOKEN_ID, 25)
        self.assertTrue(
            gateway.mark_workflow_work_item_dispatched(
                WORK_ITEM_ID, DISPATCH_TOKEN_ID
            )
        )
        self.assertTrue(
            gateway.release_workflow_work_item_dispatch(
                WORK_ITEM_ID,
                DISPATCH_TOKEN_ID,
                "TASK_DISPATCH_UNAVAILABLE",
                30,
            )
        )
        gateway.claim_total_loss_package_work_item(WORK_ITEM_ID, TOKEN_ID)
        gateway.resolve_total_loss_package_source_context(WORK_ITEM_ID, TOKEN_ID)
        gateway.seal_total_loss_source_snapshot(WORK_ITEM_ID, TOKEN_ID, source)
        gateway.persist_total_loss_final_assessment(
            WORK_ITEM_ID,
            TOKEN_ID,
            SOURCE_SNAPSHOT_ID,
            assessment,
        )
        self.assertTrue(
            gateway.complete_total_loss_package_work_item(
                WORK_ITEM_ID,
                TOKEN_ID,
                FINAL_ASSESSMENT_ID,
                "assessment_ready",
            )
        )
        self.assertTrue(
            gateway.fail_total_loss_package_work_item(
                WORK_ITEM_ID,
                TOKEN_ID,
                "SOURCE_LINEAGE_CONFLICT",
                "terminal",
                0,
            )
        )

        expected_bodies = {
            "enqueue_total_loss_package_job": {
                "requested_entitlement_id": ENTITLEMENT_ID,
            },
            "reserve_due_workflow_work_items": {
                "requested_dispatch_token": DISPATCH_TOKEN_ID,
                "requested_limit": 25,
            },
            "mark_workflow_work_item_dispatched": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_dispatch_token": DISPATCH_TOKEN_ID,
            },
            "release_workflow_work_item_dispatch": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_dispatch_token": DISPATCH_TOKEN_ID,
                "requested_error_code": "TASK_DISPATCH_UNAVAILABLE",
                "requested_delay_seconds": 30,
            },
            "claim_total_loss_package_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "resolve_total_loss_package_source_context": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "seal_total_loss_source_snapshot": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_source_snapshot_id": SOURCE_SNAPSHOT_ID,
                "requested_source_document_media_type": None,
                "requested_source_document_byte_size": None,
                "requested_source_document_sha256": None,
                "requested_analysis_artifact_digest": digest,
                "requested_normalized_extraction_digest": None,
                "requested_evidence_cutoff": "2026-08-26",
                "requested_snapshot_created_at": "2026-08-26T12:30:00Z",
                "requested_snapshot_schema_version": "1",
                "requested_source_snapshot": source,
                "requested_snapshot_digest": digest,
            },
            "persist_total_loss_final_assessment": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_source_snapshot_id": SOURCE_SNAPSHOT_ID,
                "requested_conclusion_code": "MATERIAL_UNDERVALUE_SIGNAL",
                "requested_currency": "USD",
                "requested_range_low_minor_units": 2_000_000,
                "requested_range_median_minor_units": 2_100_000,
                "requested_range_high_minor_units": 2_200_000,
                "requested_findings": [],
                "requested_limitations": [],
                "requested_reason_codes": ["UNCHANGED_EVIDENCE"],
                "requested_preliminary_to_final_comparison": {
                    "reasonCodes": ["UNCHANGED_EVIDENCE"]
                },
                "requested_assessment": assessment,
                "requested_methodology_version": "1",
                "requested_schema_version": "1",
                "requested_assessment_digest": digest,
            },
            "complete_total_loss_package_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_final_assessment_id": FINAL_ASSESSMENT_ID,
                "requested_package_status": "assessment_ready",
                "requested_reason_code": None,
            },
            "fail_total_loss_package_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_failure_code": "SOURCE_LINEAGE_CONFLICT",
                "requested_failure_kind": "terminal",
                "requested_retry_delay_seconds": None,
            },
        }
        self.assertEqual(len(requests), len(expected_bodies))
        for request in requests:
            name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(json.loads(request.content), expected_bodies[name])
            self.assertEqual(request.headers["apikey"], "service-role-test-key")
            self.assertEqual(
                request.headers["authorization"],
                "Bearer service-role-test-key",
            )

    def test_report_release_rpcs_use_exact_privilege_and_argument_contracts(
        self,
    ) -> None:
        requests: list[httpx.Request] = []
        digest = "a" * 64

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[{"outcome": "completed"}])

        gateway, _ = self.gateway(handler)
        gateway.enqueue_total_loss_report_generation(PACKAGE_JOB_ID)
        gateway.resolve_workflow_work_item_kind(WORK_ITEM_ID)
        gateway.claim_total_loss_report_generation_work_item(
            WORK_ITEM_ID, TOKEN_ID
        )
        gateway.resolve_total_loss_report_generation_context(
            WORK_ITEM_ID, TOKEN_ID
        )
        gateway.complete_total_loss_report_generation(
            WORK_ITEM_ID,
            TOKEN_ID,
            {"schemaVersion": "1"},
            digest,
            "reportlab-1",
            "valuation-evidence-v1",
            "1",
            "1",
            {"status": "PASS"},
            len(PDF_BYTES),
            digest,
        )
        gateway.claim_total_loss_report_review_work_item(
            WORK_ITEM_ID, TOKEN_ID
        )
        gateway.resolve_total_loss_report_review_context(
            WORK_ITEM_ID, TOKEN_ID
        )
        gateway.begin_total_loss_ai_review(
            WORK_ITEM_ID,
            TOKEN_ID,
            "openai",
            "gpt-review-1",
            "1",
            "1",
            digest,
        )
        gateway.complete_total_loss_ai_review(
            WORK_ITEM_ID,
            TOKEN_ID,
            RUN_ID,
            "completed",
            "gpt-review-1",
            "PASS",
            "HIGH",
            {"schemaVersion": "1"},
            digest,
            {"inputTokens": 1},
            None,
            {"disposition": "AUTO_RELEASE_SUPPORTABLE"},
            digest,
        )
        gateway.resolve_total_loss_report_release_context(
            WORK_ITEM_ID, TOKEN_ID, RUN_ID
        )
        gateway.resolve_total_loss_report_release(
            WORK_ITEM_ID, TOKEN_ID, RUN_ID
        )
        gateway.resolve_total_loss_no_dispute_refund(REPORT_VERSION_ID)
        gateway.complete_total_loss_no_dispute_refund(
            REPORT_VERSION_ID, CLAIM_ID
        )
        gateway.hold_total_loss_no_dispute_refund_failure(
            REPORT_VERSION_ID, CLAIM_ID
        )
        gateway.fail_total_loss_report_work_item(
            WORK_ITEM_ID,
            TOKEN_ID,
            "REPORT_REVIEW_TIMEOUT",
            "retryable",
            60,
        )
        gateway.get_total_loss_release_review(
            CLAIM_ID, "staff-access-token"
        )
        gateway.decide_total_loss_release_review(
            CLAIM_ID,
            "2026-08-26T12:30:00Z",
            "revision_requested",
            "Generate a new immutable report version.",
            "staff-access-token",
        )

        expected_bodies = {
            "enqueue_total_loss_report_generation": {
                "requested_package_job_id": PACKAGE_JOB_ID
            },
            "resolve_workflow_work_item_kind": {
                "requested_work_item_id": WORK_ITEM_ID
            },
            "claim_total_loss_report_generation_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "resolve_total_loss_report_generation_context": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "complete_total_loss_report_generation": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_report": {"schemaVersion": "1"},
                "requested_report_digest": digest,
                "requested_renderer_version": "reportlab-1",
                "requested_template_version": "valuation-evidence-v1",
                "requested_schema_version": "1",
                "requested_validation_version": "1",
                "requested_validation_manifest": {"status": "PASS"},
                "requested_pdf_byte_size": len(PDF_BYTES),
                "requested_pdf_digest": digest,
            },
            "claim_total_loss_report_review_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "resolve_total_loss_report_review_context": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
            },
            "begin_total_loss_ai_review": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_provider_identifier": "openai",
                "requested_configured_model_identifier": "gpt-review-1",
                "requested_prompt_version": "1",
                "requested_schema_version": "1",
                "requested_input_digest": digest,
            },
            "complete_total_loss_ai_review": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_ai_review_run_id": RUN_ID,
                "requested_terminal_status": "completed",
                "requested_returned_model_identifier": "gpt-review-1",
                "requested_recommendation": "PASS",
                "requested_confidence": "HIGH",
                "requested_review_result": {"schemaVersion": "1"},
                "requested_output_digest": digest,
                "requested_usage_metadata": {"inputTokens": 1},
                "requested_failure_code": None,
                "requested_release_gate_manifest": {
                    "disposition": "AUTO_RELEASE_SUPPORTABLE"
                },
                "requested_release_gate_digest": digest,
            },
            "resolve_total_loss_report_release_context": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_ai_review_run_id": RUN_ID,
            },
            "resolve_total_loss_report_release": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_ai_review_run_id": RUN_ID,
            },
            "resolve_total_loss_no_dispute_refund_recovery": {
                "requested_report_version_id": REPORT_VERSION_ID
            },
            "complete_total_loss_no_dispute_refund": {
                "requested_report_version_id": REPORT_VERSION_ID,
                "requested_refund_request_id": CLAIM_ID,
            },
            "hold_total_loss_no_dispute_refund_failure": {
                "requested_report_version_id": REPORT_VERSION_ID,
                "requested_refund_request_id": CLAIM_ID,
            },
            "fail_total_loss_report_work_item": {
                "requested_work_item_id": WORK_ITEM_ID,
                "requested_processing_token": TOKEN_ID,
                "requested_failure_code": "REPORT_REVIEW_TIMEOUT",
                "requested_failure_kind": "retryable",
                "requested_retry_delay_seconds": 60,
            },
            "get_total_loss_release_review": {
                "requested_release_review_id": CLAIM_ID
            },
            "decide_total_loss_release_review": {
                "requested_release_review_id": CLAIM_ID,
                "requested_expected_updated_at": "2026-08-26T12:30:00Z",
                "requested_decision": "revision_requested",
                "requested_rationale": (
                    "Generate a new immutable report version."
                ),
            },
        }
        self.assertEqual(len(requests), len(expected_bodies))
        for request in requests:
            name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(json.loads(request.content), expected_bodies[name])
            if name in {
                "get_total_loss_release_review",
                "decide_total_loss_release_review",
            }:
                self.assertEqual(request.headers["apikey"], "publishable-test-key")
                self.assertEqual(
                    request.headers["authorization"],
                    "Bearer staff-access-token",
                )
            else:
                self.assertEqual(request.headers["apikey"], "service-role-test-key")
                self.assertEqual(
                    request.headers["authorization"],
                    "Bearer service-role-test-key",
                )

    def test_vehicle_trim_cache_uses_only_the_bounded_service_role_rpcs(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            responses = {
                "claim_vehicle_trim_cache": [
                    {
                        "outcome": "ready",
                        "trims": ["LE", "XLE"],
                        "model_identifier": "gpt-5.6-luna",
                    }
                ],
                "complete_vehicle_trim_cache": True,
                "release_vehicle_trim_cache": True,
            }
            return httpx.Response(200, json=responses[name])

        gateway, _ = self.gateway(handler)
        key = "2020|toyota|camry"

        self.assertEqual(
            gateway.claim_vehicle_trim_cache(
                key,
                2020,
                "Toyota",
                "Camry",
                TRIM_TOKEN_ID,
            )["outcome"],
            "ready",
        )
        self.assertTrue(
            gateway.complete_vehicle_trim_cache(
                key,
                TRIM_TOKEN_ID,
                "gpt-5.6-luna",
                ["LE", "XLE"],
            )
        )
        self.assertTrue(
            gateway.release_vehicle_trim_cache(key, TRIM_TOKEN_ID)
        )

        self.assertEqual(len(requests), 3)
        expected_bodies = {
            "claim_vehicle_trim_cache": {
                "requested_lookup_key": key,
                "requested_vehicle_year": 2020,
                "requested_vehicle_make": "Toyota",
                "requested_vehicle_model": "Camry",
                "requested_generation_token": TRIM_TOKEN_ID,
            },
            "complete_vehicle_trim_cache": {
                "requested_lookup_key": key,
                "requested_generation_token": TRIM_TOKEN_ID,
                "requested_model_identifier": "gpt-5.6-luna",
                "requested_trims": ["LE", "XLE"],
            },
            "release_vehicle_trim_cache": {
                "requested_lookup_key": key,
                "requested_generation_token": TRIM_TOKEN_ID,
            },
        }
        for request in requests:
            name = request.url.path.rsplit("/", 1)[-1]
            self.assertEqual(json.loads(request.content), expected_bodies[name])
            self.assertEqual(request.headers["apikey"], "service-role-test-key")
            self.assertEqual(
                request.headers["authorization"],
                "Bearer service-role-test-key",
            )

    def test_claim_retries_a_lost_response_with_the_exact_same_token(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if len(requests) == 1:
                raise httpx.ReadTimeout(
                    "synthetic response loss", request=request
                )
            return httpx.Response(
                200,
                json=[
                    {
                        "outcome": "claimed",
                        "job_id": JOB_ID,
                        "status": "processing",
                        "attempt_count": 1,
                        "run_id": RUN_ID,
                        "postal_code": "60611",
                        "failure_code": None,
                        "retryable": None,
                        "processing_expires_at": (
                            "2026-08-19T17:00:00+00:00"
                        ),
                    }
                ],
            )

        gateway, _ = self.gateway(handler)

        result = gateway.claim_total_loss_analysis(
            CASE_ID, USER_ID, TOKEN_ID
        )

        self.assertEqual(result["outcome"], "claimed")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].url, requests[1].url)
        self.assertEqual(requests[0].content, requests[1].content)
        self.assertEqual(
            json.loads(requests[1].content)["processing_token"], TOKEN_ID
        )

    def test_claim_retries_a_5xx_with_the_exact_same_arguments(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(503, json={"message": "unavailable"})
            return httpx.Response(
                200,
                json=[
                    {
                        "outcome": "claimed",
                        "job_id": JOB_ID,
                        "status": "processing",
                        "attempt_count": 1,
                        "run_id": RUN_ID,
                        "postal_code": "60611",
                        "failure_code": None,
                        "retryable": None,
                        "processing_expires_at": (
                            "2026-08-19T17:00:00+00:00"
                        ),
                    }
                ],
            )

        gateway, _ = self.gateway(handler)

        result = gateway.claim_total_loss_analysis(
            CASE_ID, USER_ID, TOKEN_ID
        )

        self.assertEqual(result["outcome"], "claimed")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].content, requests[1].content)

    def test_completion_does_not_use_the_claim_retry(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(503, json={"message": "unavailable"})

        gateway, _ = self.gateway(handler)

        with self.assertRaises(SupabaseUnavailableError):
            gateway.complete_total_loss_analysis(
                JOB_ID,
                TOKEN_ID,
                RUN_ID,
                {"runId": RUN_ID},
            )

        self.assertEqual(len(requests), 1)

    def test_private_report_path_is_derived_and_materialized_temporarily(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, content=PDF_BYTES)

        gateway, _ = self.gateway(handler)
        with gateway.materialize_total_loss_report(
            USER_ID, CASE_ID, JOB_ID
        ) as path:
            self.assertTrue(path.exists())
            self.assertEqual(path.name, "report.pdf")
            self.assertEqual(path.read_bytes(), PDF_BYTES)
            materialized_path = path

        self.assertFalse(materialized_path.exists())
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(
            request.url.path,
            (
                "/storage/v1/object/authenticated/case-files/"
                f"{USER_ID}/{CASE_ID}/valuation-report.pdf"
            ),
        )
        self.assertEqual(request.url.params["cacheNonce"], JOB_ID)
        self.assertEqual(request.headers["apikey"], "service-role-test-key")

    def test_report_download_maps_missing_invalid_and_oversized_bytes(self) -> None:
        cases = (
            (httpx.Response(404), SupabaseReportNotFoundError, None),
            (
                httpx.Response(200, content=b"not a pdf"),
                SupabaseReportInvalidError,
                None,
            ),
            (
                httpx.Response(200, content=PDF_BYTES),
                SupabaseReportInvalidError,
                len(PDF_BYTES) - 1,
            ),
        )
        for response, expected, maximum in cases:
            with self.subTest(expected=expected.__name__):
                gateway, _ = self.gateway(lambda _request, r=response: r)
                limit = (
                    patch("venfour.supabase_gateway.MAX_PDF_BYTES", maximum)
                    if maximum is not None
                    else patch(
                        "venfour.supabase_gateway.MAX_PDF_BYTES",
                        50 * 1024 * 1024,
                    )
                )
                with limit, self.assertRaises(expected):
                    with gateway.materialize_total_loss_report(
                        USER_ID, CASE_ID, JOB_ID
                    ):
                        pass

    def test_report_size_limit_allows_the_exact_boundary(self) -> None:
        gateway, _ = self.gateway(
            lambda _request: httpx.Response(200, content=PDF_BYTES)
        )
        with patch(
            "venfour.supabase_gateway.MAX_PDF_BYTES", len(PDF_BYTES)
        ):
            with gateway.materialize_total_loss_report(
                USER_ID, CASE_ID, JOB_ID
            ) as path:
                self.assertEqual(path.stat().st_size, len(PDF_BYTES))


if __name__ == "__main__":
    unittest.main()
