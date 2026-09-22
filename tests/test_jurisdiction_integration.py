"""Exercise shadow observations through existing server and worker fixtures."""

from contextlib import ExitStack
import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import Mock, patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.jurisdiction_adapter import FLAG, observe_scope
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration

import test_commerce as commerce_fixtures
from test_jurisdiction import CASE, NOW, facts


class JurisdictionIntegrationTests(unittest.TestCase):
    def shadow_gateway(self):
        gateway = Mock()
        gateway.get_jurisdiction_context.side_effect = lambda case_id, owner_user_id=None: {
            "case_id": case_id, "revision": 1, "facts": facts().to_dict(),
            "date_of_loss": "2026-08-01", "intake_updated_at": NOW.isoformat(),
        }
        return gateway

    def exercise(self, case_class, method_name, module, expected, *, references=False, class_setup=False):
        """Reuse established deterministic fixtures and their behavior assertions."""
        gateway = self.shadow_gateway()
        observed = []

        def observe(_database, case_id, boundary, **kwargs):
            snapshot = observe_scope(gateway, case_id, boundary, **kwargs)
            self.assertFalse(snapshot.to_dict()["proposed_allowed"])
            observed.append(boundary)
            return snapshot

        def reference(_database, _reference_id, _kind, boundary):
            return observe(_database, CASE, boundary)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {FLAG: "shadow"}))
            stack.enter_context(patch("venfour.jurisdiction_adapter.LOGGER"))
            stack.enter_context(patch(f"venfour.{module}.observe_scope", side_effect=observe))
            if references:
                stack.enter_context(patch(f"venfour.{module}.observe_reference_scope", side_effect=reference))
            if class_setup:
                case_class.setUpClass()
                stack.callback(case_class.tearDownClass)
            case = case_class(method_name)
            stack.callback(case.doCleanups)
            case.setUp()
            getattr(case, method_name)()
            case.tearDown()
        self.assertTrue(set(expected).issubset(observed), observed)

    def test_direct_checkout_api_observes_before_provider_and_keeps_shadow_available(self):
        commerce, database, provider = commerce_fixtures.service()
        gateway = self.shadow_gateway()

        def observe(_database, case_id, boundary):
            self.assertEqual(provider.calls, [])
            return observe_scope(gateway, case_id, boundary)

        with patch.dict(os.environ, {FLAG: "shadow"}), patch("venfour.jurisdiction_adapter.LOGGER"), patch("venfour.commerce.observe_scope", side_effect=observe) as seam:
            with TestClient(create_app(commerce_service=commerce, enable_legacy_api=False)) as client:
                response=client.post(f"/api/v1/appraisal-cases/{CASE}/checkout-sessions",
                    headers={"Authorization":f"Bearer {commerce_fixtures.ACCESS_TOKEN}"},
                    json={"clientRequestId":commerce_fixtures.CLIENT_REQUEST_ID})
        self.assertEqual(response.status_code,200)
        seam.assert_called_once_with(database,CASE,"checkout")
        self.assertFalse(gateway.record_jurisdiction_decision.call_args.args[0]["proposed_allowed"])

    def test_existing_checkout_refusal_stops_before_scope_or_provider(self):
        commerce, database, provider=commerce_fixtures.service()
        database.preflight_row["checkout_available"]=False
        with patch("venfour.commerce.observe_scope") as seam, self.assertRaises(commerce_fixtures.CommerceConflictError):
            commerce.create_checkout(CASE,commerce_fixtures.ACCESS_TOKEN,commerce_fixtures.CLIENT_REQUEST_ID)
        seam.assert_not_called()
        self.assertEqual(provider.calls,[])

    def test_valid_signed_paid_event_and_duplicate_reconcile_despite_proposed_hold(self):
        provider=commerce_fixtures.RecordingProvider()
        verifier=commerce_fixtures.StripeSdkGateway(commerce_fixtures.configuration(),client=commerce_fixtures.FakeStripeClient())
        provider.verify_webhook=verifier.verify_webhook
        provider.session=commerce_fixtures.checkout_session(status="complete",payment_status="paid",url=None,payment_intent_id=commerce_fixtures.INTENT_ID)
        commerce,database,_=commerce_fixtures.service(provider=provider)
        timestamp=int(time.time())
        payload=json.dumps({"id":commerce_fixtures.EVENT_ID,"type":"checkout.session.completed",
            "created":commerce_fixtures.NOW,"livemode":False,"api_version":"2025-12-15.clover",
            "data":{"object":{"id":commerce_fixtures.SESSION_ID}}},separators=(",",":")).encode()
        signature=hmac.new(commerce_fixtures.WEBHOOK_SECRET.encode(),f"{timestamp}.".encode()+payload,hashlib.sha256).hexdigest()
        header=f"t={timestamp},v1={signature}"
        gateway=self.shadow_gateway()
        with patch.dict(os.environ,{FLAG:"shadow"}),patch("venfour.jurisdiction_adapter.LOGGER"):
            self.assertFalse(observe_scope(gateway,CASE,"report_release").to_dict()["proposed_allowed"])
            with patch("venfour.commerce.observe_scope",side_effect=AssertionError("Financial reconciliation must not use delivery permission")):
                self.assertEqual(commerce.handle_webhook(payload,header),"processed")
                database.claim_row={"state":"processed","webhook_event_id":commerce_fixtures.WEBHOOK_ROW_ID,"processing_token":commerce_fixtures.PROCESSING_TOKEN}
                self.assertEqual(commerce.handle_webhook(payload,header),"processed")
        self.assertEqual(sum(name=="fulfill_total_loss_checkout_payment" for name,_ in database.calls),1)

    def test_preview_direct_service_cannot_skip_observation(self):
        from test_case_analyses import CaseAnalysisServiceTests
        self.exercise(CaseAnalysisServiceTests,"test_confirmed_manual_claim_never_materializes_or_claims_report_evidence","case_analyses",["preview_process"])

    def test_full_review_worker_observes_and_reuses_saved_evidence(self):
        from test_full_review_processing import FullReviewProcessingTests
        self.exercise(FullReviewProcessingTests,"test_completed_extraction_is_reused_and_strict_positive_result_can_pay_without_staff","full_review_processing",["full_review_process"])

    def test_paid_queue_observes_before_finalizing_package(self):
        from test_package_processing import PackageProcessorTests
        self.exercise(PackageProcessorTests,"test_normal_paid_case_reaches_assessment_ready","package_processing",["package_process"])

    def test_report_generation_and_release_observe_without_changing_existing_gate(self):
        from test_report_processing import ReportProcessingTests
        self.exercise(ReportProcessingTests,"test_generation_completes_with_canonical_report_and_pdf","report_processing",["report_process"],references=True,class_setup=True)
        self.exercise(ReportProcessingTests,"test_pass_high_review_reaches_supportable_release","report_processing",["report_process","report_release"],references=True,class_setup=True)

    def test_no_support_still_refunds_with_retained_access_under_shadow(self):
        from test_report_processing import ReportProcessingTests
        self.exercise(ReportProcessingTests,"test_no_dispute_release_refunds_and_completes_resolution","report_processing",["report_release"],references=True,class_setup=True)

    def test_customer_draft_and_follow_up_generation_observe(self):
        from test_customer_delivery import CustomerDeliveryServiceTests
        from test_follow_up_delivery import FollowUpDeliveryTests
        self.exercise(CustomerDeliveryServiceTests,"test_prepare_open_and_sent_keep_distinct_authority","customer_delivery",["draft_release"])
        self.exercise(FollowUpDeliveryTests,"test_generation_binds_verified_server_context_and_atomic_store","customer_delivery",["draft_process"])
        self.exercise(FollowUpDeliveryTests,"test_edit_and_prepare_preserve_exact_customer_content_and_revision","customer_delivery",["draft_release"])

    def test_coaching_worker_observes_processing_and_release(self):
        from test_insurer_response_processing import InsurerResponseProcessorTests
        self.exercise(InsurerResponseProcessorTests,"test_success_uses_only_allowlisted_model_context_and_persists_result","insurer_response_processing",["coaching_process","coaching_release"])

    def test_historical_download_does_not_reauthorize_new_work(self):
        from test_customer_delivery import CustomerDeliveryServiceTests
        case=CustomerDeliveryServiceTests("test_report_download_uses_the_neutral_customer_filename")
        with patch.dict(os.environ,{FLAG:"shadow"}),patch("venfour.customer_delivery.observe_scope",side_effect=AssertionError("Historical access must remain separate")):
            case.test_report_download_uses_the_neutral_customer_filename()

    def test_startup_rejects_enforcement_even_if_supplied_by_environment(self):
        with patch.dict(os.environ,{FLAG:"enforce"}),self.assertRaises(ValueError):
            create_app(enable_legacy_api=False)

    def test_gateway_uses_service_only_rpc_and_no_user_supplied_permissions(self):
        seen=[]
        def transport(request):
            seen.append(request)
            if request.url.path.endswith("get_jurisdiction_context"):
                return httpx.Response(200,json={"case_id":CASE,"revision":0,"facts":{"schema_version":"1","assertions":[]}})
            return httpx.Response(204)
        client=httpx.Client(transport=httpx.MockTransport(transport))
        self.addCleanup(client.close)
        gateway=SupabaseHttpGateway(SupabaseServerConfiguration("https://scope.example.test","public-test-key","service-test-key"),client=client)
        gateway.get_jurisdiction_context(CASE)
        gateway.record_jurisdiction_decision({"case_id":CASE},"a"*64)
        self.assertEqual([r.url.path.rsplit("/",1)[-1] for r in seen],["get_jurisdiction_context","record_jurisdiction_decision"])
        self.assertTrue(all(r.headers["Authorization"]=="Bearer service-test-key" for r in seen))
