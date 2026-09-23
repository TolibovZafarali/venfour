"""Offline boundary and recovery tests; synthetic permissions are test-only."""

from datetime import timedelta
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.paid_delivery import PaidDeliveryHeld, PaidDeliveryRecoveryService, require_paid_delivery
from venfour.package_processing import TotalLossPackageProcessor
from venfour.report_processing import TotalLossReportProcessor
from venfour.insurer_response_processing import TotalLossInsurerResponseProcessor
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration, SupabaseAuthenticationError
from test_jurisdiction import CASE, NOW, facts, registry, registry_payload
from venfour.jurisdiction import Capability, load_packaged_registry
import test_commerce as commerce_fixtures


class HeldGateway:
    def __init__(self, state="held"):
        self.state = state
        self.calls = []

    def check_paid_delivery(self, reference, kind="case", owner_user_id=None):
        self.calls.append((reference, kind, owner_user_id))
        return self.state

    def __getattr__(self, name):
        raise AssertionError(f"Held work reached {name}")


def approved_registry():
    raw = registry_payload()
    scope, rule = raw["interpretations"][0], raw["rules"][0]
    raw["interpretations"], raw["rules"] = [], []
    for cap in (Capability.MARKET_REPORT, Capability.VALUATION, Capability.DRAFT, Capability.COACHING):
        raw["interpretations"].append({**scope, "id": cap.value, "capability": cap.value})
        raw["rules"].append({**rule, "id": cap.value, "applicability_id": cap.value})
    return registry(raw)


class PaidDeliveryBoundaryTests(unittest.TestCase):
    def test_held_and_cancelled_workers_do_zero_claims_providers_models_or_generation(self):
        for state in ("held", "cancelled"):
            for cls, method in ((TotalLossPackageProcessor, "execute"),
                                (TotalLossReportProcessor, "execute_generation"),
                                (TotalLossReportProcessor, "execute_review"),
                                (TotalLossInsurerResponseProcessor, "execute")):
                with self.subTest(state=state, method=method, cls=cls):
                    instance = cls.__new__(cls)
                    instance._database = HeldGateway(state)
                    instance._assessment_builder = Mock()
                    instance._analyzer = Mock()
                    for _ in range(2):
                        with self.assertRaises(PaidDeliveryHeld):
                            getattr(instance, method)(CASE)
                    instance._assessment_builder.assert_not_called()
                    instance._analyzer.assert_not_called()
                    self.assertEqual(len(instance._database.calls), 2)

    def test_missing_database_fence_cannot_bypass_admission(self):
        with self.assertRaises(TypeError): require_paid_delivery(object(), CASE)

    def test_no_environment_value_can_activate_enforcement(self):
        import os
        for value in ("enforce", "rehearsal", "test", "true"):
            with patch.dict(os.environ, {"VENFOUR_JURISDICTION_MODE": value}):
                with self.assertRaises(ValueError): create_app(enable_legacy_api=False)

    def test_unenrolled_and_released_continue_but_unknown_state_fails_closed(self):
        for state in ("unenrolled", "released"):
            require_paid_delivery(HeldGateway(state), CASE)
        for state in (None, "approved", "off"):
            with self.assertRaises(PaidDeliveryHeld): require_paid_delivery(HeldGateway(state), CASE)

    def test_initial_customer_draft_is_held_after_authentication(self):
        from test_customer_delivery import RecordingGateway, USER_ID, ACCESS_TOKEN
        from venfour.customer_delivery import CustomerDeliveryService
        gateway = RecordingGateway()
        with patch.object(type(gateway), "check_paid_delivery", return_value="held", create=True) as gate:
            service = CustomerDeliveryService(gateway)
            with self.assertRaises(PaidDeliveryHeld):
                service.prepare(CASE, CASE, 1, ACCESS_TOKEN)
            gate.assert_called_once_with(CASE, "case", USER_ID)
        self.assertFalse(any(name == "prepare" for name, _ in gateway.calls))

    def test_follow_up_generation_and_saved_history_boundaries(self):
        from test_follow_up_delivery import FollowUpDeliveryTests
        case = FollowUpDeliveryTests("test_generation_binds_verified_server_context_and_atomic_store")
        case.setUp()
        self.addCleanup(case.doCleanups)
        with patch.object(type(case.gateway), "check_paid_delivery", return_value="held", create=True):
            with self.assertRaises(PaidDeliveryHeld):
                case.test_generation_binds_verified_server_context_and_atomic_store()
            # Reading an existing edited draft remains independent of new delivery.
            case.gateway.calls.clear()
            case.test_read_does_not_create_and_cannot_replace_initial_request()

    def test_historical_download_and_existing_refund_do_not_use_delivery_gate(self):
        from test_customer_delivery import CustomerDeliveryServiceTests
        with patch("venfour.customer_delivery.require_paid_delivery", side_effect=AssertionError("historical access gated")):
            case = CustomerDeliveryServiceTests("test_report_download_uses_the_neutral_customer_filename")
            case.setUp(); self.addCleanup(case.doCleanups)
            case.test_report_download_uses_the_neutral_customer_filename()
        case = commerce_fixtures.CommerceRefundTests("test_full_refund_uses_stable_idempotency_and_retained_access_policy")
        case.test_full_refund_uses_stable_idempotency_and_retained_access_policy()

    def test_internal_duplicate_delivery_is_acknowledged_without_retry(self):
        processor = Mock()
        processor.execute.side_effect = PaidDeliveryHeld()
        verifier = SimpleNamespace(verify=lambda token: "worker")
        with TestClient(create_app(package_processor=processor, internal_caller_verifier=verifier, enable_legacy_api=False)) as client:
            for _ in range(2):
                response = client.post(f"/internal/v1/work-items/{CASE}/execute", headers={"Authorization": "Bearer fixture"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["state"], "jurisdiction_held")
                self.assertNotIn("Retry-After", response.headers)

    def test_signed_payment_and_duplicate_remain_independent(self):
        from test_jurisdiction_integration import JurisdictionIntegrationTests
        case = JurisdictionIntegrationTests("test_valid_signed_paid_event_and_duplicate_reconcile_despite_proposed_hold")
        case.test_valid_signed_paid_event_and_duplicate_reconcile_despite_proposed_hold()


class PaidDeliveryRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.gateway.authenticate.return_value = CASE
        self.gateway.get_jurisdiction_context.return_value = {
            "case_id": CASE, "revision": 1, "facts": facts().to_dict(),
            "date_of_loss": None, "intake_updated_at": NOW.isoformat(),
        }
        self.gateway.get_paid_delivery_review_context.return_value = {"context": self.gateway.get_jurisdiction_context.return_value, "authority_revision": 1}
        self.gateway.resolve_paid_delivery.return_value = {"state": "held"}
        self.commerce = Mock()
        self.service = PaidDeliveryRecoveryService(self.gateway, self.commerce, clock=lambda: NOW)

    def test_unauthorized_operator_cannot_read_facts_or_resolve(self):
        self.gateway.inspect_paid_delivery.side_effect = SupabaseAuthenticationError()
        with self.assertRaises(SupabaseAuthenticationError):
            self.service.resolve(CASE, "release", CASE, "token")
        self.gateway.get_paid_delivery_review_context.assert_not_called()
        self.gateway.resolve_paid_delivery.assert_not_called()

    def test_empty_current_registry_records_refused_snapshot_not_old_approval(self):
        self.service.resolve(CASE, "release", CASE, "token")
        snapshot = self.gateway.record_jurisdiction_decision.call_args.args[0]
        self.assertFalse(snapshot["proposed_allowed"])
        self.assertEqual(snapshot["registry_digest"], load_packaged_registry().content_digest)
        self.assertEqual(snapshot["delivery_context"], self.gateway.get_jurisdiction_context.return_value)
        self.commerce.refund.assert_not_called()

    def test_current_reviewed_registry_and_all_capabilities_are_required(self):
        self.service.registry_loader = approved_registry
        self.service.resolve(CASE, "release", CASE, "token")
        snapshot = self.gateway.record_jurisdiction_decision.call_args.args[0]
        self.assertTrue(snapshot["proposed_allowed"])
        self.assertEqual(len(snapshot["decisions"]), 4)
        self.assertEqual(self.gateway.resolve_paid_delivery.call_args.args[-1], (NOW + timedelta(minutes=5)).isoformat())
        self.service.registry_loader = registry  # Only the market-report capability.
        self.service.resolve(CASE, "release", CASE, "token")
        self.assertFalse(self.gateway.record_jurisdiction_decision.call_args.args[0]["proposed_allowed"])

    def test_unverified_credentials_and_terms_never_satisfied_by_staff(self):
        raw = registry_payload()
        raw["rules"][0]["required_credential_refs"] = ["assigned-license"]
        raw["rules"][0]["required_terms"] = ["reviewed-terms"]
        self.service.registry_loader = lambda: registry(raw)
        self.service.resolve(CASE, "release", CASE, "token")
        reasons = self.gateway.record_jurisdiction_decision.call_args.args[0]["decisions"][0]["reasons"]
        self.assertIn("CREDENTIALS_NOT_VERIFIED", reasons)
        self.assertIn("TERMS_NOT_READY", reasons)

    def test_cancel_uses_canonical_refund_key_and_retains_access_on_retry(self):
        self.gateway.resolve_paid_delivery.return_value = {
            "state": "cancelled", "order_id": CASE, "payment_transaction_id": CASE, "refund_request_key": CASE,
        }
        self.commerce.refund.side_effect = [RuntimeError("offline provider"), SimpleNamespace(refund_status="succeeded")]
        with self.assertRaises(RuntimeError): self.service.resolve(CASE, "cancel_refund", CASE, "token")
        result = self.service.resolve(CASE, "cancel_refund", CASE, "token")
        self.assertEqual(result["refund_status"], "succeeded")
        self.assertEqual(self.commerce.refund.call_args_list[0], self.commerce.refund.call_args_list[1])
        self.assertEqual(self.commerce.refund.call_args.kwargs["access_policy"], "retain")
        self.gateway.get_paid_delivery_review_context.assert_not_called()

    def test_ambiguous_payment_routes_to_support_without_provider_refund(self):
        self.gateway.resolve_paid_delivery.return_value = {"state": "cancelled", "refund_status": "support_required", "payment_transaction_id": None}
        result = self.service.resolve(CASE, "cancel_refund", CASE, "token")
        self.assertEqual(result["refund_status"], "support_required")
        self.commerce.refund.assert_not_called()

    def test_operator_api_auth_and_unknown_actions(self):
        app = create_app(enable_legacy_api=False)
        app.state.paid_delivery_recovery_service = self.service
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/v1/staff/paid-delivery-holds").status_code, 401)
            response = client.post(f"/api/v1/staff/paid-delivery-holds/{CASE}/resolve", headers={"Authorization": "Bearer token"}, json={"action": "approve_state", "requestId": CASE})
            self.assertEqual(response.status_code, 400)
            self.gateway.resolve_paid_delivery.assert_not_called()


class PaidDeliveryGatewayTests(unittest.TestCase):
    def test_service_rpc_maps_atomic_hold_and_validates_status(self):
        from test_jurisdiction_integration import JurisdictionIntegrationTests
        # Use the same non-secret server configuration as existing gateway coverage.
        config = SupabaseServerConfiguration(url="https://example.supabase.co", publishable_key="public", service_role_key="private")
        requests = []
        def handle(request):
            requests.append(request)
            return httpx.Response(200, json="held")
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            gateway = SupabaseHttpGateway(config, client=client)
            with self.assertRaises(PaidDeliveryHeld): require_paid_delivery(gateway, CASE)
        self.assertTrue(str(requests[0].url).endswith("/rpc/check_paid_delivery"))
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(400, json={"code": "PJD01"}))) as client:
            gateway = SupabaseHttpGateway(config, client=client)
            with self.assertRaises(PaidDeliveryHeld): gateway._rpc("claim_total_loss_package_work_item", {})
