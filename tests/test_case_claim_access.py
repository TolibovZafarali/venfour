"""Offline service and HTTP coverage for secure Total-Loss case access."""

from __future__ import annotations

import json
import os
import unittest
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qs
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.case_claim_access import (
    CLAIM_RECOVERY_TURNSTILE_ACTION,
    MAX_TURNSTILE_TOKEN_CHARACTERS,
    TURNSTILE_ALWAYS_PASS_TEST_SECRET,
    CaseClaimAccessInputError,
    CaseClaimAccessNotFoundError,
    CaseClaimAccessService,
    CaseClaimAccessUnavailableError,
    CaseClaimRecoveryConfiguration,
    CloudflareTurnstileVerifier,
    TurnstileRejectedError,
    normalize_recovery_email,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseContractError,
    SupabaseUnavailableError,
)


CASE_ID = "20000000-0000-4000-8000-000000000002"
CLAIM_ID = "30000000-0000-4000-8000-000000000003"
USER_ID = "10000000-0000-4000-8000-000000000001"
EMAIL = "owner@example.com"
EXPIRES_AT = "2026-08-26T18:30:00+00:00"
ACCESS_TOKEN = "browser-access-token"
TURNSTILE_SECRET = "turnstile-unit-test-secret"
RATE_LIMIT_SECRET = "rate-limit-unit-test-secret"
STAGING_PROXY_SECRET = "staging-proxy-unit-test-secret-value-1234567890"


def resume_row(
    state: str = "secure_required",
    *,
    contact_email: str | None = EMAIL,
) -> dict[str, Any]:
    secured = state == "secured"
    return {
        "state": state,
        "case_id": CASE_ID,
        "contact_email": contact_email,
        "workflow_phase": "review",
        "workflow_current_task": "secure_claim",
        "workflow_revision": 1,
        "checkout_available": secured,
        "commerce_order_status": None,
        "payment_status": None,
        "entitlement_status": None,
        "next_task": "checkout" if secured else None,
    }


def legacy_secured_resume_row() -> dict[str, Any]:
    return {
        **resume_row("secured"),
        "workflow_phase": None,
        "workflow_current_task": None,
        "workflow_revision": None,
        "checkout_available": False,
        "next_task": None,
        "customer_journey": None,
        "published_report": None,
        "education_progress": None,
        "sending_details": None,
        "message_draft": None,
        "insurer_response": None,
        "commerce_amount_minor_units": None,
        "commerce_currency": None,
    }


def access_link_row(
    state: str = "secure_required",
) -> dict[str, Any]:
    return {
        "state": state,
        "case_id": CASE_ID,
        "contact_email": EMAIL if state == "secure_required" else None,
        "claim_id": CLAIM_ID if state == "secure_required" else None,
        "claim_expires_at": EXPIRES_AT if state == "secure_required" else None,
    }


class RecordingVerifier:
    def __init__(self, result: bool = True, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.tokens: list[str] = []
        self.closed = False

    def verify(self, token: str) -> bool:
        self.tokens.append(token)
        if self.error is not None:
            raise self.error
        return self.result

    def close(self) -> None:
        self.closed = True


class RecordingGateway:
    def __init__(self) -> None:
        self.authenticated_tokens: list[str] = []
        self.resolve_calls: list[tuple[str, str]] = []
        self.renew_calls: list[tuple[str, str]] = []
        self.prepare_calls: list[tuple[str, str, str, str]] = []
        self.send_calls: list[tuple[str, str, str]] = []
        self.resolve_result: Mapping[str, Any] | None = resume_row()
        self.renew_result: Mapping[str, Any] | None = access_link_row()
        self.prepare_result: Mapping[str, Any] = {
            "send_allowed": True,
            "claim_id": CLAIM_ID,
            "claim_expires_at": EXPIRES_AT,
            "requested_email": EMAIL,
        }
        self.authenticate_error: Exception | None = None
        self.resolve_error: Exception | None = None
        self.renew_error: Exception | None = None
        self.prepare_error: Exception | None = None
        self.send_error: Exception | None = None

    def authenticate(self, access_token: str) -> str:
        self.authenticated_tokens.append(access_token)
        if self.authenticate_error is not None:
            raise self.authenticate_error
        return USER_ID

    def resolve_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None:
        self.resolve_calls.append((case_id, access_token))
        if self.resolve_error is not None:
            raise self.resolve_error
        return self.resolve_result

    def renew_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None:
        self.renew_calls.append((case_id, access_token))
        if self.renew_error is not None:
            raise self.renew_error
        return self.renew_result

    def prepare_total_loss_case_access_recovery(
        self,
        case_id: str,
        email: str,
        requester_fingerprint: str,
        target_fingerprint: str,
    ) -> Mapping[str, Any]:
        self.prepare_calls.append(
            (case_id, email, requester_fingerprint, target_fingerprint)
        )
        if self.prepare_error is not None:
            raise self.prepare_error
        return self.prepare_result

    def send_total_loss_case_magic_link(
        self,
        email: str,
        claim_id: str,
        public_app_origin: str,
    ) -> None:
        self.send_calls.append((email, claim_id, public_app_origin))
        if self.send_error is not None:
            raise self.send_error


def recovery_configuration(
    *,
    origin: str = "https://app.venfour.example",
    turnstile_secret: str = TURNSTILE_SECRET,
) -> CaseClaimRecoveryConfiguration:
    return CaseClaimRecoveryConfiguration(
        public_app_origin=origin,
        rate_limit_secret=RATE_LIMIT_SECRET,
        turnstile_secret=turnstile_secret,
    )


def claim_service(
    gateway: RecordingGateway | None = None,
    verifier: RecordingVerifier | None = None,
) -> tuple[CaseClaimAccessService, RecordingGateway, RecordingVerifier]:
    selected_gateway = gateway or RecordingGateway()
    selected_verifier = verifier or RecordingVerifier()
    return (
        CaseClaimAccessService(
            selected_gateway,
            recovery_configuration=recovery_configuration(),
            turnstile_verifier=selected_verifier,
        ),
        selected_gateway,
        selected_verifier,
    )


class CaseClaimConfigurationTests(unittest.TestCase):
    def test_email_normalization_is_conservative_and_matches_the_rpc_shape(
        self,
    ) -> None:
        self.assertEqual(normalize_recovery_email(" Owner@Example.COM "), EMAIL)
        for value in (
            None,
            "",
            "owner@example",
            "owner @example.com",
            "owner@example.com\n",
            "owner\u202e@example.com",
            "x" * 310 + "@example.com",
        ):
            with self.subTest(value=value), self.assertRaises(
                CaseClaimAccessInputError
            ):
                normalize_recovery_email(value)

    def test_configuration_validates_origins_and_domain_separates_fingerprints(
        self,
    ) -> None:
        configuration = recovery_configuration(
            origin="https://App.Venfour.Example/"
        )

        self.assertEqual(
            configuration.public_app_origin,
            "https://App.Venfour.Example",
        )
        self.assertEqual(configuration.turnstile_hostname, "app.venfour.example")
        requester = configuration.fingerprint("requester", "203.0.113.10")
        target = configuration.fingerprint("target", "203.0.113.10")
        self.assertRegex(requester, r"^[0-9a-f]{64}$")
        self.assertRegex(target, r"^[0-9a-f]{64}$")
        self.assertNotEqual(requester, target)
        self.assertNotIn("203.0.113.10", requester)
        self.assertEqual(
            requester,
            configuration.fingerprint("requester", "203.0.113.10"),
        )
        with self.assertRaises(ValueError):
            configuration.fingerprint("other", "203.0.113.10")

    def test_configuration_rejects_unsafe_origins_and_secrets(self) -> None:
        for origin in (
            "http://app.venfour.example",
            "https://user:secret@app.venfour.example",
            "https://app.venfour.example/path",
            "https://app.venfour.example?query=1",
            "https://app.venfour.example#fragment",
            "https://app.venfour.example:bad",
            " https://app.venfour.example",
        ):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                recovery_configuration(origin=origin)
        for turnstile_secret, rate_limit_secret in (
            ("", RATE_LIMIT_SECRET),
            ("secret with spaces", RATE_LIMIT_SECRET),
            (TURNSTILE_SECRET, TURNSTILE_SECRET),
        ):
            with self.subTest(turnstile_secret=turnstile_secret):
                with self.assertRaises(ValueError):
                    CaseClaimRecoveryConfiguration(
                        public_app_origin="https://app.venfour.example",
                        rate_limit_secret=rate_limit_secret,
                        turnstile_secret=turnstile_secret,
                    )

    def test_official_always_pass_response_is_enabled_only_for_loopback(self) -> None:
        local = recovery_configuration(
            origin="http://localhost:5173",
            turnstile_secret=TURNSTILE_ALWAYS_PASS_TEST_SECRET,
        )
        production = recovery_configuration(
            turnstile_secret=TURNSTILE_ALWAYS_PASS_TEST_SECRET,
        )

        self.assertTrue(local.allows_turnstile_test_response)
        self.assertFalse(production.allows_turnstile_test_response)


class CloudflareTurnstileVerifierTests(unittest.TestCase):
    def client(
        self, handler: Any
    ) -> tuple[httpx.Client, list[httpx.Request]]:
        requests: list[httpx.Request] = []

        def recording_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return handler(request)

        client = httpx.Client(
            transport=httpx.MockTransport(recording_handler),
            follow_redirects=False,
        )
        self.addCleanup(client.close)
        return client, requests

    def verifier(
        self,
        payload: Any,
        *,
        status_code: int = 200,
        secret: str = TURNSTILE_SECRET,
        hostname: str = "app.venfour.example",
        allow_test_response: bool = False,
    ) -> tuple[CloudflareTurnstileVerifier, list[httpx.Request]]:
        client, requests = self.client(
            lambda _request: httpx.Response(status_code, json=payload)
        )
        return (
            CloudflareTurnstileVerifier(
                secret,
                expected_hostname=hostname,
                allow_test_response=allow_test_response,
                client=client,
            ),
            requests,
        )

    def test_siteverify_request_and_bound_response_are_exact(self) -> None:
        verifier, requests = self.verifier(
            {
                "success": True,
                "action": CLAIM_RECOVERY_TURNSTILE_ACTION,
                "hostname": "app.venfour.example",
            }
        )

        self.assertTrue(verifier.verify("one-time-widget-token"))
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            str(request.url),
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        )
        self.assertEqual(
            parse_qs(request.content.decode("ascii")),
            {
                "secret": [TURNSTILE_SECRET],
                "response": ["one-time-widget-token"],
            },
        )

    def test_siteverify_requires_strict_success_action_and_hostname(self) -> None:
        payloads = (
            {
                "success": "true",
                "action": "claim-recovery",
                "hostname": "app.venfour.example",
            },
            {
                "success": True,
                "action": "magic-link",
                "hostname": "app.venfour.example",
            },
            {"success": True, "action": "claim-recovery", "hostname": "evil.example"},
            {"success": True, "action": "claim-recovery"},
            {
                "success": False,
                "action": "claim-recovery",
                "hostname": "app.venfour.example",
            },
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                verifier, _requests = self.verifier(payload)
                self.assertFalse(verifier.verify("widget-token"))

    def test_loopback_official_test_key_accepts_the_documented_test_shape(
        self,
    ) -> None:
        verifier, _requests = self.verifier(
            {"success": True, "hostname": "example.com", "action": None},
            secret=TURNSTILE_ALWAYS_PASS_TEST_SECRET,
            hostname="localhost",
            allow_test_response=True,
        )

        self.assertTrue(verifier.verify("turnstile-test-claim-recovery-1"))
        for secret, hostname in (
            (TURNSTILE_SECRET, "localhost"),
            (TURNSTILE_ALWAYS_PASS_TEST_SECRET, "app.venfour.example"),
        ):
            with self.subTest(secret=secret, hostname=hostname):
                with self.assertRaises(ValueError):
                    CloudflareTurnstileVerifier(
                        secret,
                        expected_hostname=hostname,
                        allow_test_response=True,
                    )

    def test_invalid_tokens_never_reach_siteverify(self) -> None:
        verifier, requests = self.verifier({"success": True})
        for token in (
            "",
            "token\n",
            "x" * (MAX_TURNSTILE_TOKEN_CHARACTERS + 1),
        ):
            with self.subTest(length=len(token)), self.assertRaises(
                TurnstileRejectedError
            ):
                verifier.verify(token)
        self.assertEqual(requests, [])

    def test_siteverify_transport_status_and_json_failures_are_unavailable(
        self,
    ) -> None:
        cases: tuple[Any, ...] = (
            httpx.Response(503, json={"success": False}),
            httpx.Response(302, headers={"location": "https://evil.invalid"}),
            httpx.Response(200, content=b"not-json"),
            httpx.Response(200, json=[]),
        )
        for response in cases:
            with self.subTest(status=response.status_code):
                client, _requests = self.client(lambda _request, r=response: r)
                verifier = CloudflareTurnstileVerifier(
                    TURNSTILE_SECRET,
                    expected_hostname="app.venfour.example",
                    client=client,
                )
                with self.assertRaises(CaseClaimAccessUnavailableError):
                    verifier.verify("widget-token")

        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("synthetic timeout", request=request)

        client, _requests = self.client(timeout)
        verifier = CloudflareTurnstileVerifier(
            TURNSTILE_SECRET,
            expected_hostname="app.venfour.example",
            client=client,
        )
        with self.assertRaises(CaseClaimAccessUnavailableError):
            verifier.verify("widget-token")


class CaseClaimAccessServiceTests(unittest.TestCase):
    def test_resume_projects_all_states_and_normalizes_database_mismatch(self) -> None:
        service, gateway, _verifier = claim_service()
        expected = {
            "secure_required": ("secure_required", EMAIL),
            "secured": ("secured", EMAIL),
            "account_mismatch": ("account_switch_required", None),
        }
        for database_state, (state, email) in expected.items():
            with self.subTest(state=database_state):
                gateway.resolve_result = resume_row(database_state)
                result = service.resolve(CASE_ID, ACCESS_TOKEN).to_dict()
                self.assertEqual(result["state"], state)
                self.assertEqual(result["caseId"], CASE_ID)
                self.assertEqual(result["contactEmail"], email)
                self.assertEqual(
                    result["workflow"],
                    {
                        "phase": "review",
                        "currentTask": "secure_claim",
                        "revision": 1,
                    },
                )
                self.assertEqual(
                    result["commerce"],
                    {
                        "checkoutAvailable": True,
                        "orderStatus": None,
                        "paymentStatus": None,
                        "entitlementStatus": None,
                        "nextTask": "checkout",
                    }
                    if state == "secured"
                    else None,
                )
        self.assertEqual(
            gateway.resolve_calls,
            [(CASE_ID, ACCESS_TOKEN)] * len(expected),
        )

    def test_resume_accepts_truthful_refund_pending_fulfillment(self) -> None:
        service, gateway, _verifier = claim_service()
        response_row = {
            **resume_row("secured"),
            "customer_journey": {
                "nextState": "no_dispute",
                "fulfillmentState": "refund_pending",
                "retryable": False,
            },
            "published_report": None,
            "education_progress": None,
            "sending_details": None,
            "message_draft": None,
        }
        gateway.resolve_result = response_row

        result = service.resolve(CASE_ID, ACCESS_TOKEN).to_dict()

        self.assertEqual(
            result["journey"],
            {
                "nextState": "no_dispute",
                "fulfillmentState": "refund_pending",
                "retryable": False,
            },
        )

    def test_resume_projects_the_current_owner_response_without_storage_details(
        self,
    ) -> None:
        service, gateway, _verifier = claim_service()
        response = {
            "responseId": "80000000-0000-4000-8000-000000000008",
            "clientRequestId": "60000000-0000-4000-8000-000000000006",
            "receivedAt": "2026-09-01T12:00:00Z",
            "sourceType": "pasted_message",
            "text": "The insurer declined the request.",
            "document": None,
            "revisedOffer": None,
            "processingState": "not_started",
            "supersedesResponseId": None,
        }
        response_row = {
            **resume_row("secured"),
            "workflow_phase": "negotiation",
            "workflow_current_task": "insurer_response_received",
            "workflow_revision": 5,
            "checkout_available": False,
            "next_task": "insurer_response_received",
            "customer_journey": {
                "nextState": "insurer_response_received",
                "fulfillmentState": "insurer_response_received",
                "retryable": False,
            },
            "published_report": {"validated": "below"},
            "education_progress": None,
            "sending_details": None,
            "message_draft": None,
            "insurer_response": response,
        }
        gateway.resolve_result = response_row

        with patch(
            "venfour.case_claim_access.validate_report_projection",
            return_value={"reportId": "validated-report"},
        ):
            result = service.resolve(CASE_ID, ACCESS_TOKEN).to_dict()

        self.assertEqual(result["insurerResponse"], response)
        self.assertEqual(
            result["journey"],
            {
                "nextState": "insurer_response_received",
                "fulfillmentState": "insurer_response_received",
                "retryable": False,
            },
        )
        self.assertEqual(result["report"], {"reportId": "validated-report"})

        gateway.resolve_result = {
            **response_row,
            "entitlement_status": "suspended",
            "next_task": "payment_review",
            "customer_journey": {
                "nextState": "needs_attention",
                "fulfillmentState": "needs_attention",
                "retryable": False,
            },
            "published_report": None,
        }
        needs_attention = service.resolve(CASE_ID, ACCESS_TOKEN).to_dict()
        self.assertEqual(needs_attention["insurerResponse"], response)
        self.assertIsNone(needs_attention["report"])

        invalid_rows = (
            {**response_row, "insurer_response": None},
            {
                **response_row,
                "workflow_current_task": "awaiting_insurer_response",
            },
            {
                **resume_row("secured"),
                "workflow_phase": "negotiation",
                "workflow_current_task": "insurer_response_received",
                "workflow_revision": 5,
                "checkout_available": False,
                "next_task": "insurer_response_received",
            },
            {
                **response_row,
                "insurer_response": {**response, "processingState": "analyzed"},
            },
            {
                **response_row,
                "state": "account_mismatch",
                "contact_email": None,
                "checkout_available": False,
                "commerce_order_status": None,
                "payment_status": None,
                "entitlement_status": None,
                "next_task": None,
                "customer_journey": {
                    "nextState": "secure_claim",
                    "fulfillmentState": "not_started",
                    "retryable": False,
                },
                "published_report": None,
                "education_progress": None,
                "sending_details": None,
                "message_draft": None,
            },
        )
        for row in invalid_rows:
            with self.subTest(row=row), patch(
                "venfour.case_claim_access.validate_report_projection",
                return_value={"reportId": "validated-report"},
            ), self.assertRaises(SupabaseContractError):
                gateway.resolve_result = row
                service.resolve(CASE_ID, ACCESS_TOKEN)

    def test_resume_preserves_legacy_secured_case_without_workflow(self) -> None:
        service, gateway, _verifier = claim_service()
        gateway.resolve_result = legacy_secured_resume_row()

        self.assertEqual(
            service.resolve(CASE_ID, ACCESS_TOKEN).to_dict(),
            {
                "state": "secured",
                "caseId": CASE_ID,
                "contactEmail": EMAIL,
                "workflow": None,
                "commerce": None,
            },
        )

        gateway.resolve_result = {
            **gateway.resolve_result,
            "customer_journey": {
                "nextState": "checkout",
                "fulfillmentState": "not_started",
                "retryable": False,
            },
        }
        with self.assertRaises(SupabaseContractError):
            service.resolve(CASE_ID, ACCESS_TOKEN)

    def test_resume_hides_unknown_cases_and_rejects_invalid_database_contracts(
        self,
    ) -> None:
        service, gateway, _verifier = claim_service()
        gateway.resolve_result = None
        with self.assertRaises(CaseClaimAccessNotFoundError):
            service.resolve(CASE_ID, ACCESS_TOKEN)

        invalid_rows = (
            {**resume_row(), "case_id": CLAIM_ID},
            {**resume_row(), "state": "unexpected"},
            {**resume_row(), "contact_email": "not-an-email"},
            {**resume_row(), "workflow_phase": "unexpected"},
            {**resume_row(), "workflow_current_task": "Unsafe Task"},
            {**resume_row(), "workflow_revision": True},
            {**resume_row(), "workflow_revision": 0},
            {**resume_row("secured"), "checkout_available": None},
            {**resume_row("secured"), "commerce_order_status": "invalid"},
            {**resume_row("secured"), "payment_status": "paid"},
            {**resume_row("secured"), "entitlement_status": "invalid"},
            {**resume_row("secured"), "next_task": "Unsafe Task"},
            {**resume_row(), "commerce_order_status": "pending"},
        )
        for row in invalid_rows:
            with self.subTest(row=row):
                gateway.resolve_result = row
                with self.assertRaises(
                    (SupabaseContractError, CaseClaimAccessInputError)
                ):
                    service.resolve(CASE_ID, ACCESS_TOKEN)

    def test_access_link_projects_claim_and_nonclaim_states_exactly(self) -> None:
        service, gateway, _verifier = claim_service()
        secure = service.access_link(CASE_ID, ACCESS_TOKEN).to_dict()
        self.assertEqual(
            secure,
            {
                "state": "secure_required",
                "caseId": CASE_ID,
                "contactEmail": EMAIL,
                "claimId": CLAIM_ID,
                "expiresAt": EXPIRES_AT,
            },
        )

        for database_state, frontend_state in (
            ("secured", "secured"),
            ("account_mismatch", "account_switch_required"),
        ):
            with self.subTest(state=database_state):
                gateway.renew_result = access_link_row(database_state)
                self.assertEqual(
                    service.access_link(CASE_ID, ACCESS_TOKEN).to_dict(),
                    {
                        "state": frontend_state,
                        "caseId": CASE_ID,
                        "contactEmail": None,
                        "claimId": None,
                        "expiresAt": None,
                    },
                )

    def test_access_link_rejects_invalid_claim_and_expiry_contracts(self) -> None:
        service, gateway, _verifier = claim_service()
        invalid_rows = (
            {**access_link_row(), "claim_id": "not-a-uuid"},
            {**access_link_row(), "claim_expires_at": "not-a-timestamp"},
            {**access_link_row(), "claim_expires_at": "2026-08-26T18:30:00"},
            {**access_link_row("secured"), "claim_id": CLAIM_ID},
            {**access_link_row("account_mismatch"), "claim_expires_at": EXPIRES_AT},
        )
        for row in invalid_rows:
            with self.subTest(row=row):
                gateway.renew_result = row
                with self.assertRaises(
                    (SupabaseContractError, CaseClaimAccessInputError)
                ):
                    service.access_link(CASE_ID, ACCESS_TOKEN)

    def test_recovery_verifies_first_then_uses_only_keyed_fingerprints(self) -> None:
        service, gateway, verifier = claim_service()

        service.recover(
            CASE_ID,
            " Owner@Example.COM ",
            "one-time-widget-token",
            "203.0.113.10",
        )

        self.assertEqual(verifier.tokens, ["one-time-widget-token"])
        self.assertEqual(len(gateway.prepare_calls), 1)
        case_id, email, requester_fingerprint, target_fingerprint = (
            gateway.prepare_calls[0]
        )
        configuration = recovery_configuration()
        self.assertEqual((case_id, email), (CASE_ID, EMAIL))
        self.assertEqual(
            requester_fingerprint,
            configuration.fingerprint("requester", "203.0.113.10"),
        )
        self.assertEqual(
            target_fingerprint,
            configuration.fingerprint("target", f"{CASE_ID}:{EMAIL}"),
        )
        self.assertNotIn("203.0.113.10", requester_fingerprint)
        self.assertNotIn(EMAIL, target_fingerprint)
        self.assertEqual(
            gateway.send_calls,
            [(EMAIL, CLAIM_ID, "https://app.venfour.example")],
        )

    def test_recovery_rejects_the_challenge_before_database_or_mail(self) -> None:
        verifier = RecordingVerifier(result=False)
        service, gateway, _verifier = claim_service(verifier=verifier)

        with self.assertRaises(TurnstileRejectedError):
            service.recover(CASE_ID, EMAIL, "widget-token", "203.0.113.10")

        self.assertEqual(gateway.prepare_calls, [])
        self.assertEqual(gateway.send_calls, [])

    def test_recovery_is_neutral_for_every_post_challenge_outcome(self) -> None:
        downstream_errors = (
            SupabaseUnavailableError("database unavailable"),
            SupabaseContractError("bad response"),
            SupabaseAuthenticationError("unexpected auth failure"),
            RuntimeError("unexpected downstream failure"),
        )
        for error in downstream_errors:
            with self.subTest(error=type(error).__name__):
                gateway = RecordingGateway()
                gateway.prepare_error = error
                service, _gateway, _verifier = claim_service(gateway=gateway)
                service.recover(
                    CASE_ID, EMAIL, "widget-token", "203.0.113.10"
                )
                self.assertEqual(gateway.send_calls, [])

        gateway = RecordingGateway()
        gateway.prepare_result = {"send_allowed": False}
        service, _gateway, _verifier = claim_service(gateway=gateway)
        service.recover(CASE_ID, EMAIL, "widget-token", "203.0.113.10")
        self.assertEqual(gateway.send_calls, [])

        gateway = RecordingGateway()
        gateway.send_error = RuntimeError("mail failed")
        service, _gateway, _verifier = claim_service(gateway=gateway)
        service.recover(CASE_ID, EMAIL, "widget-token", "203.0.113.10")
        self.assertEqual(len(gateway.send_calls), 1)

    def test_recovery_configuration_and_verifier_failures_remain_visible(self) -> None:
        gateway = RecordingGateway()
        service = CaseClaimAccessService(gateway)
        with self.assertRaises(CaseClaimAccessUnavailableError):
            service.recover(CASE_ID, EMAIL, "widget-token", "203.0.113.10")

        verifier = RecordingVerifier(
            error=CaseClaimAccessUnavailableError("challenge unavailable")
        )
        service, gateway, _verifier = claim_service(verifier=verifier)
        with self.assertRaises(CaseClaimAccessUnavailableError):
            service.recover(CASE_ID, EMAIL, "widget-token", "203.0.113.10")
        self.assertEqual(gateway.prepare_calls, [])

    def test_service_closes_only_the_injected_verifier_boundary(self) -> None:
        service, _gateway, verifier = claim_service()
        service.close()
        self.assertTrue(verifier.closed)


class CaseClaimAccessApiTests(unittest.TestCase):
    def client(
        self,
        gateway: RecordingGateway | None = None,
        verifier: RecordingVerifier | None = None,
        *,
        staging_proxy_secret: str | None = None,
    ) -> tuple[TestClient, RecordingGateway, RecordingVerifier]:
        service, selected_gateway, selected_verifier = claim_service(
            gateway=gateway,
            verifier=verifier,
        )
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(
                case_claim_access_service=service,
                enable_legacy_api=False,
                staging_proxy_secret=staging_proxy_secret,
            )
        client = TestClient(app)
        self.addCleanup(client.close)
        return client, selected_gateway, selected_verifier

    @staticmethod
    def assert_private(response: httpx.Response) -> None:
        assert response.headers["cache-control"] == "private, no-store"

    def test_get_claim_requires_and_validates_bearer_authentication(self) -> None:
        client, gateway, _verifier = self.client()
        missing = client.get(f"/api/v1/appraisal-cases/{CASE_ID}/claim")
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(
            missing.json()["error"]["code"], "AUTHENTICATION_REQUIRED"
        )
        self.assertEqual(missing.headers["www-authenticate"], "Bearer")
        self.assert_private(missing)

        gateway.authenticate_error = SupabaseAuthenticationError("invalid")
        invalid = client.get(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim",
            headers={"Authorization": "Bearer invalid-token"},
        )
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(
            invalid.json()["error"]["code"], "AUTHENTICATION_INVALID"
        )
        self.assertEqual(gateway.resolve_calls, [])

    def test_get_claim_returns_the_frozen_camel_case_projection(self) -> None:
        client, gateway, _verifier = self.client()
        response = client.get(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "state": "secure_required",
                "caseId": CASE_ID,
                "contactEmail": EMAIL,
                "workflow": {
                    "phase": "review",
                    "currentTask": "secure_claim",
                    "revision": 1,
                },
                "commerce": None,
            },
        )
        self.assertEqual(gateway.authenticated_tokens, [ACCESS_TOKEN])
        self.assertEqual(gateway.resolve_calls, [(CASE_ID, ACCESS_TOKEN)])
        self.assert_private(response)

    def test_get_claim_keeps_legacy_secured_case_without_workflow_available(
        self,
    ) -> None:
        gateway = RecordingGateway()
        gateway.resolve_result = legacy_secured_resume_row()
        client, gateway, _verifier = self.client(gateway=gateway)

        response = client.get(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "state": "secured",
                "caseId": CASE_ID,
                "contactEmail": EMAIL,
                "workflow": None,
                "commerce": None,
            },
        )
        self.assert_private(response)

    def test_claim_routes_hide_missing_cases_and_reject_noncanonical_ids(self) -> None:
        gateway = RecordingGateway()
        gateway.resolve_result = None
        client, gateway, _verifier = self.client(gateway=gateway)
        missing = client.get(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
        invalid = client.get(
            "/api/v1/appraisal-cases/not-a-uuid/claim",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["error"]["code"], "CASE_NOT_FOUND")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "INVALID_CASE_ID")

    def test_access_link_requires_empty_body_and_returns_stored_identity(
        self,
    ) -> None:
        client, gateway, _verifier = self.client()
        rejected = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-link",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={},
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            rejected.json()["error"]["code"], "INVALID_CLAIM_ACCESS_REQUEST"
        )
        self.assertEqual(gateway.renew_calls, [])

        accepted = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-link",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            content=b"",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(
            accepted.json(),
            {
                "state": "secure_required",
                "caseId": CASE_ID,
                "contactEmail": EMAIL,
                "claimId": CLAIM_ID,
                "expiresAt": EXPIRES_AT,
            },
        )
        self.assert_private(accepted)

    def test_recovery_is_public_and_returns_the_same_neutral_202(self) -> None:
        client, gateway, verifier = self.client()
        accepted = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
            json={"email": EMAIL, "turnstileToken": "widget-token"},
        )
        self.assertEqual(accepted.status_code, 202)
        self.assertEqual(accepted.json(), {"status": "accepted"})
        self.assertEqual(gateway.authenticated_tokens, [])
        self.assertEqual(verifier.tokens, ["widget-token"])
        self.assertEqual(len(gateway.send_calls), 1)
        self.assert_private(accepted)

        gateway.prepare_result = {"send_allowed": False}
        neutral = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
            json={"email": "different@example.com", "turnstileToken": "other-token"},
        )
        self.assertEqual(neutral.status_code, accepted.status_code)
        self.assertEqual(neutral.json(), accepted.json())
        self.assertEqual(len(gateway.send_calls), 1)

    def test_recovery_maps_challenge_rejection_without_querying_the_case(self) -> None:
        verifier = RecordingVerifier(result=False)
        client, gateway, _verifier = self.client(verifier=verifier)
        response = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
            json={"email": EMAIL, "turnstileToken": "rejected-token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "SECURITY_CHECK_FAILED")
        self.assertEqual(gateway.prepare_calls, [])
        self.assertEqual(gateway.send_calls, [])

    def test_direct_recovery_ignores_spoofed_cloudflare_client_ip(self) -> None:
        client, gateway, _verifier = self.client()
        response = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
            headers={"CF-Connecting-IP": "203.0.113.75"},
            json={"email": EMAIL, "turnstileToken": "widget-token"},
        )

        self.assertEqual(response.status_code, 202)
        requester_fingerprint = gateway.prepare_calls[0][2]
        configuration = recovery_configuration()
        self.assertEqual(
            requester_fingerprint,
            configuration.fingerprint("requester", "testclient"),
        )
        self.assertNotEqual(
            requester_fingerprint,
            configuration.fingerprint("requester", "203.0.113.75"),
        )

    def test_proxy_recovery_uses_one_valid_cloudflare_client_ip(self) -> None:
        client, gateway, _verifier = self.client(
            staging_proxy_secret=STAGING_PROXY_SECRET
        )
        response = client.post(
            f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
            headers={
                "CF-Connecting-IP": "2001:0DB8:0:0:0:0:0:5",
                "X-Venfour-Staging-Proxy": STAGING_PROXY_SECRET,
            },
            json={"email": EMAIL, "turnstileToken": "widget-token"},
        )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(
            gateway.prepare_calls[0][2],
            recovery_configuration().fingerprint(
                "requester", "2001:db8::5"
            ),
        )

    def test_proxy_recovery_fails_before_challenge_without_valid_client_ip(
        self,
    ) -> None:
        malformed_headers: tuple[list[tuple[str, str]], ...] = (
            [],
            [("CF-Connecting-IP", "not-an-ip")],
            [("CF-Connecting-IP", " 203.0.113.75")],
            [("CF-Connecting-IP", "203.0.113.75, 198.51.100.8")],
            [("CF-Connecting-IP", "fe80::1%eth0")],
            [
                ("CF-Connecting-IP", "203.0.113.75"),
                ("CF-Connecting-IP", "198.51.100.8"),
            ],
        )
        for extra_headers in malformed_headers:
            with self.subTest(headers=extra_headers):
                client, gateway, verifier = self.client(
                    staging_proxy_secret=STAGING_PROXY_SECRET
                )
                response = client.post(
                    (
                        f"/api/v1/appraisal-cases/{CASE_ID}/claim/"
                        "access-recovery"
                    ),
                    headers=[
                        (
                            "X-Venfour-Staging-Proxy",
                            STAGING_PROXY_SECRET,
                        ),
                        *extra_headers,
                    ],
                    json={
                        "email": EMAIL,
                        "turnstileToken": "widget-token",
                    },
                )

                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.json()["error"]["code"],
                    "CLAIM_ACCESS_UNAVAILABLE",
                )
                self.assertEqual(verifier.tokens, [])
                self.assertEqual(gateway.prepare_calls, [])
                self.assert_private(response)

    def test_recovery_rejects_unbounded_or_ambiguous_json_before_service(self) -> None:
        client, gateway, verifier = self.client()
        requests = (
            {"content": b"", "headers": {"content-type": "application/json"}},
            {"content": b"not-json", "headers": {"content-type": "application/json"}},
            {"json": {"email": EMAIL}},
            {"json": {"email": EMAIL, "turnstileToken": "token", "extra": True}},
            {"json": {"email": 1, "turnstileToken": "token"}},
            {
                "content": json.dumps(
                    {"email": EMAIL, "turnstileToken": "token"}
                ),
                "headers": {"content-type": "text/plain"},
            },
            {"content": b"x" * 8193, "headers": {"content-type": "application/json"}},
        )
        for arguments in requests:
            with self.subTest(arguments=tuple(arguments)):
                response = client.post(
                    f"/api/v1/appraisal-cases/{CASE_ID}/claim/access-recovery",
                    **arguments,
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json()["error"]["code"],
                    "INVALID_CLAIM_ACCESS_REQUEST",
                )
        self.assertEqual(verifier.tokens, [])
        self.assertEqual(gateway.prepare_calls, [])


if __name__ == "__main__":
    unittest.main()
