"""Offline guards and initialization service contracts for the local harness."""
import copy
import os
import socket
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from scripts.local_claim_flow import block_provider_network, initialize, require_local, synthetic_artifact


class LocalClaimFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = synthetic_artifact(str(uuid4())).to_dict()

    def test_explicit_local_configuration_required(self):
        for environment in ({}, {"VENFOUR_LOCAL_POST_CONTINUE":"true"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","SUPABASE_URL":"https://project.supabase.co"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","VENFOUR_PUBLIC_APP_ORIGIN":"https://staging.venfour.com"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","K_SERVICE":"backend"},
            {"VENFOUR_LOCAL_POST_CONTINUE":"1","STRIPE_SECRET_KEY":"sk_"+"live_"+"fixture"}):
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
