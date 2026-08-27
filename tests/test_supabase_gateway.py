"""Offline tests for the server-only Supabase HTTP boundary."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

from venfour.supabase_gateway import (
    MAX_EXTRACTION_CACHE_BYTES,
    SupabaseAuthenticationError,
    SupabaseConfigurationError,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
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
PDF_BYTES = b"%PDF-1.7\nsynthetic private report\n%%EOF\n"


def configuration() -> SupabaseServerConfiguration:
    return SupabaseServerConfiguration(
        url="https://project.supabase.co",
        publishable_key="publishable-test-key",
        service_role_key="service-role-test-key",
    )


class SupabaseHttpGatewayTests(unittest.TestCase):
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
