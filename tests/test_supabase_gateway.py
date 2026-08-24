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
