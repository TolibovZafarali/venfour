"""Offline guards and initialization service contracts for the local harness."""
import copy
import os
import socket
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from starlette.testclient import TestClient

from scripts.local_claim_flow import block_provider_network, initialize, require_local, synthetic_artifact
from venfour.package_processing import TotalLossPackageCoordinator
from venfour.supabase_gateway import SupabaseHttpGateway


class LocalClaimFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = synthetic_artifact(str(uuid4())).to_dict()

    def test_explicit_local_configuration_required(self):
        for environment in ({}, {"VENFOUR_LOCAL_POST_CONTINUE":"true"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","SUPABASE_URL":"https://project.supabase.co"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","VENFOUR_PUBLIC_APP_ORIGIN":"https://staging.venfour.com"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","K_SERVICE":"backend"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","STRIPE_SECRET_KEY":"sk_"+"live_"+"fixture"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","STRIPE_SECRET_KEY":"rk_"+"live_"+"fixture"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","STRIPE_PUBLISHABLE_KEY":"pk_"+"live_"+"fixture"}):
            with self.subTest(environment=tuple(environment)), self.assertRaises(RuntimeError):
                require_local(environment)
        require_local({"VENFOUR_LOCAL_POST_CONTINUE":"1","SUPABASE_URL":"http://127.0.0.1:54321"})

    def test_ordinary_application_has_no_local_endpoints(self):
        from venfour.api import create_app
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(enable_legacy_api=False)
        paths = {route.path for route in app.routes}
        self.assertFalse(any("post-continue" in path or "/api/local/" in path for path in paths))

    def test_no_provider_network_or_secret_available(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY":"synthetic-local-sentinel"}), patch.object(socket,"getaddrinfo",Mock()) as original:
            block_provider_network()
            self.assertFalse("OPENAI_API_KEY" in os.environ)
            for host in ("api.openai.com","api.marketcheck.com","evil.example","127.0.0.1.evil.example"):
                with self.assertRaises(RuntimeError):
                    socket.getaddrinfo(host,443)
            original.assert_not_called()
            socket.getaddrinfo("127.0.0.1",54321)
            original.assert_called_once()

    def test_initializer_derives_projection_and_only_then_resolves(self):
        gateway=Mock()
        gateway.authenticate.return_value=str(uuid4())
        gateway._rpc.side_effect=[{"initialized":False,"artifact":self.artifact},"created"]
        service=Mock()
        service.resolve.return_value=SimpleNamespace(to_dict=lambda:{"state":"secure_required"})
        case_id=str(uuid4())
        self.assertEqual(initialize(gateway,service,case_id,"owner-token"),{"state":"secure_required"})
        args=gateway._rpc.call_args_list[1].args[1]
        self.assertEqual(args["expected_run_id"],self.artifact["runId"])
        self.assertEqual(args["frozen_presentation"]["insurerValuation"]["value"]["cents"],2000000)
        service.resolve.assert_called_once_with(case_id,"owner-token")

    def test_resume_does_not_rebuild_or_overwrite(self):
        gateway=Mock()
        gateway._rpc.return_value={"initialized":True,"artifact":None}
        service=Mock()
        initialize(gateway,service,str(uuid4()),"owner-token")
        gateway._rpc.assert_called_once()
        service.resolve.assert_called_once()

    def test_wrong_owner_cannot_initialize(self):
        gateway=Mock()
        gateway._rpc.return_value=None
        service=Mock()
        with self.assertRaises(LookupError): initialize(gateway,service,str(uuid4()),"wrong-owner")
        gateway._rpc.assert_called_once()
        service.resolve.assert_not_called()

    def test_stale_or_ineligible_source_does_not_resolve(self):
        gateway=Mock()
        gateway._rpc.side_effect=[{"initialized":False,"artifact":copy.deepcopy(self.artifact)},"ineligible"]
        service=Mock()
        with self.assertRaises(ValueError): initialize(gateway,service,str(uuid4()),"owner-token")
        service.resolve.assert_not_called()


class LocalClaimCompositionTests(unittest.TestCase):
    def create_local_app(self, gateway, *, provider=None):
        from scripts.local_claim_flow import create_app
        from tests.test_commerce import configuration

        environment = {"VENFOUR_LOCAL_POST_CONTINUE": "1"}
        if provider is not None:
            environment["VENFOUR_LOCAL_STRIPE_CHECKOUT"] = "1"
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, environment, clear=True))
            stack.enter_context(patch("scripts.local_claim_flow.block_provider_network"))
            stack.enter_context(patch("scripts.local_claim_flow.local_status", return_value={}))
            stack.enter_context(patch("scripts.local_claim_flow.gateway_from_status", return_value=gateway))
            if provider is not None:
                stack.enter_context(patch("venfour.commerce.StripeSdkGateway", return_value=provider))
                stack.enter_context(patch(
                    "scripts.local_claim_flow.StripeCommerceConfiguration.from_environment",
                    return_value=configuration(public_app_origin="http://localhost:5173"),
                ))
            return create_app()

    def test_local_commerce_shares_coordinator_and_preserves_shutdown(self):
        gateway = Mock(spec=SupabaseHttpGateway)
        app = self.create_local_app(gateway)
        coordinator = app.state.package_coordinator
        self.assertIsInstance(coordinator, TotalLossPackageCoordinator)
        self.assertIs(coordinator._database, gateway)
        self.assertIsNone(coordinator._dispatcher)
        self.assertIs(app.state.commerce_service._entitlement_fulfillment_hook, coordinator)
        gateway.close.assert_not_called()
        self.assertFalse(app.state.accepting_customer_requests)

        with TestClient(app):
            self.assertTrue(app.state.accepting_customer_requests)
            gateway.close.assert_not_called()

        self.assertFalse(app.state.accepting_customer_requests)
        gateway.close.assert_called_once_with()

    def test_local_sandbox_webhook_enqueues_before_finalization(self):
        from tests.test_commerce import (
            CASE_ID, ENTITLEMENT_ID, INTENT_ID,
            RecordingDatabase, RecordingProvider, checkout_session,
        )

        database = RecordingDatabase()
        gateway = Mock(spec=SupabaseHttpGateway)
        for name in (
            "claim_stripe_webhook_event", "resolve_total_loss_checkout_context",
            "fulfill_total_loss_checkout_payment", "finalize_stripe_webhook_event",
        ):
            getattr(gateway, name).side_effect = getattr(database, name)

        def enqueue(entitlement_id):
            database.calls.append(("enqueue_total_loss_package_job", (entitlement_id,)))
            return {
                "outcome": "created", "case_id": CASE_ID,
                "entitlement_id": entitlement_id, "package_job_id": str(uuid4()),
                "work_item_id": str(uuid4()), "package_status": "queued",
                "work_item_status": "queued", "workflow_revision": 1,
            }

        gateway.enqueue_total_loss_package_job.side_effect = enqueue
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete", payment_status="paid", url=None,
            payment_intent_id=INTENT_ID,
        )
        app = self.create_local_app(gateway, provider=provider)
        with TestClient(app):
            self.assertEqual(app.state.commerce_service.handle_webhook(b"signed-raw", "valid"), "processed")

        gateway.enqueue_total_loss_package_job.assert_called_once_with(ENTITLEMENT_ID)
        gateway.reserve_due_workflow_work_items.assert_not_called()
        names = [name for name, _ in database.calls]
        self.assertLess(names.index("fulfill_total_loss_checkout_payment"), names.index("enqueue_total_loss_package_job"))
        self.assertLess(names.index("enqueue_total_loss_package_job"), names.index("finalize_stripe_webhook_event"))
        gateway.close.assert_called_once_with()

    def test_local_factory_closes_owned_gateway_when_composition_fails(self):
        gateway = Mock(spec=SupabaseHttpGateway)
        with patch("venfour.api.create_app", side_effect=RuntimeError("local composition failed")):
            with self.assertRaisesRegex(RuntimeError, "local composition failed"):
                self.create_local_app(gateway)
        gateway.close.assert_called_once_with()
