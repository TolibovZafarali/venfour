"""Local composition isolation, qualification, and durable worker contracts."""
import asyncio
import json
import os
import socket
import tempfile
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from starlette.testclient import TestClient

from scripts.local_full_flow import (
    LocalSetupError, LocalWorker, create_app, qualified_review_environment,
    read_local_status, require_full_flow, restrict_network,
)
from tests.test_commerce import configuration
from venfour.report_review_evals import REPORT_REVIEW_EVAL_ATTESTATION_PATH
from venfour.supabase_gateway import SupabaseHttpGateway


def environment():
    commerce = configuration(public_app_origin="http://localhost:5173")
    return {
        "VENFOUR_LOCAL_FULL_FLOW": "1", "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_PUBLISHABLE_KEY": "local-public", "SUPABASE_SERVICE_ROLE_KEY": "local-private",
        "VENFOUR_PUBLIC_APP_ORIGIN": commerce.public_app_origin,
        "STRIPE_SECRET_KEY": commerce.secret_key, "STRIPE_PUBLISHABLE_KEY": commerce.publishable_key,
        "STRIPE_WEBHOOK_SECRET": commerce.webhook_secret,
        "VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID": commerce.price_id,
        "VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER": commerce.product_identifier,
        "VENFOUR_TOTAL_LOSS_PRODUCT_VERSION": commerce.product_version,
        "VENFOUR_TOTAL_LOSS_TERMS_VERSION": commerce.terms_version,
        "VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION": commerce.refund_policy_version,
        "OPENAI_API_KEY": "local-provider-fixture", "MARKETCHECK_API_KEY": "local-market-fixture",
        "VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET": "local-recovery-fixture-not-for-production",
        "VENFOUR_TURNSTILE_SECRET": "local-challenge-fixture",
    }


class FullFlowGuards(unittest.TestCase):
    def test_rejects_wrong_modes_destinations_credentials_and_remote_dispatch(self):
        require_full_flow(environment())
        for override in (
            {"VENFOUR_LOCAL_FULL_FLOW": "0"}, {"VENFOUR_LOCAL_POST_CONTINUE": "1"},
            {"K_SERVICE": "deployed"}, {"CLOUD_RUN_JOB": "deployed"},
            {"VENFOUR_STAGING_PROXY_SECRET": "private-fixture"},
            {"SUPABASE_URL": "https://project.supabase.co"},
            {"SUPABASE_URL": "http://127.0.0.1:54321@remote.example.test"},
            {"VENFOUR_PUBLIC_APP_ORIGIN": "https://staging.venfour.com"},
            {"VENFOUR_PACKAGE_TASKS_QUEUE": "remote-queue"},
            {"VENFOUR_PACKAGE_WORKER_ORIGIN": "https://worker.example.test"},
            {"VENFOUR_ENABLE_LEGACY_ANALYSIS_API": "1"},
            {"OPENAI_BASE_URL": "https://untrusted.example.test/v1"},
            {"MARKETCHECK_API_KEY": ""},
            {"STRIPE_SECRET_KEY": "sk" + "_live_" + "fixture-only-value"},
            {"STRIPE_PUBLISHABLE_KEY": "pk" + "_live_" + "fixture-only-value"},
        ):
            with self.subTest(setting=list(override)), self.assertRaises(LocalSetupError):
                require_full_flow(environment() | override)

    def test_cli_discovery_cannot_select_remote_database_or_mismatched_keys(self):
        status = {"API_URL": environment()["SUPABASE_URL"],
                  "DB_URL": "postgresql://postgres:fixture@127.0.0.1:54322/postgres",
                  "PUBLISHABLE_KEY": "local-public", "SECRET_KEY": "local-private"}
        with patch.dict(os.environ, environment(), clear=True):
            for override in ({"DB_URL": "postgresql://user:fixture@remote.example.test:54322/postgres"},
                             {"DB_URL": "postgresql://user:fixture@127.0.0.1:54322/another"},
                             {"API_URL": "https://project.supabase.co"}, {"SECRET_KEY": "other-private"}):
                with patch("scripts.local_full_flow.subprocess.run", return_value=SimpleNamespace(
                    returncode=0, stdout=json.dumps(status | override),
                )), self.assertRaises(LocalSetupError):
                    read_local_status()

    def test_preserves_provider_keys_and_only_allows_named_destinations(self):
        original = Mock()
        with patch.dict(os.environ, environment(), clear=True), patch.object(socket, "getaddrinfo", original):
            restore = restrict_network()
            try:
                for host in ("127.0.0.1", "api.openai.com", "api.marketcheck.com", "api.stripe.com"):
                    socket.getaddrinfo(host, 443)
                for host in ("evil.example.test", "127.0.0.1.evil.example.test", "api.stripe.com.evil.example.test"):
                    with self.assertRaises(RuntimeError):
                        socket.getaddrinfo(host, 443)
                self.assertEqual(os.environ["OPENAI_API_KEY"], "local-provider-fixture")
                self.assertEqual(original.call_count, 4)
            finally:
                restore()
            self.assertIs(socket.getaddrinfo, original)

    def test_only_current_all_pass_measured_qualification_can_enable_review(self):
        valid = qualified_review_environment({})
        self.assertEqual(valid["OPENAI_REPORT_RELEASE_GATE_ENABLED"], "true")
        for override in ({"OPENAI_REPORT_RELEASE_GATE_ENABLED": "false"},
                         {"OPENAI_REPORT_REVIEW_MODEL": "another-model"},
                         {"OPENAI_REPORT_REVIEW_APPROVED_EVAL_SUITE_DIGEST": "0" * 64}):
            with self.assertRaises(LocalSetupError):
                qualified_review_environment(valid | override)
        with self.assertRaises(LocalSetupError):
            qualified_review_environment({"OPENAI_REPORT_REVIEW_MODEL": valid["OPENAI_REPORT_REVIEW_MODEL"]})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qualification.json"
            with self.assertRaises(LocalSetupError):
                qualified_review_environment({}, path=path)
            payload = json.loads(REPORT_REVIEW_EVAL_ATTESTATION_PATH.read_text())
            payload["passedCaseCount"] -= 1
            path.write_text(json.dumps(payload))
            with self.assertRaises(LocalSetupError):
                qualified_review_environment({}, path=path)


class FullFlowComposition(unittest.TestCase):
    def test_startup_does_not_wait_for_a_queued_report_review(self):
        gateway = Mock(spec=SupabaseHttpGateway)
        gateway.reserve_due_workflow_work_items.return_value = [{
            "work_item_id": str(uuid4()), "package_job_id": str(uuid4()),
            "work_type": "total_loss_report_review", "work_version": "1", "dispatch_attempt_count": 1,
        }]
        gateway.mark_workflow_work_item_dispatched.return_value = True
        release = threading.Event()
        completed = threading.Event()

        def review(work_item_id):
            release.wait(timeout=2)
            completed.set()
            return SimpleNamespace(state="completed")

        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, environment(), clear=True))
            stack.enter_context(patch("scripts.local_full_flow.read_local_status", return_value={}))
            stack.enter_context(patch("scripts.local_full_flow.gateway_from_status", return_value=gateway))
            app = create_app()
            stack.enter_context(patch.object(app.state.package_processor, "execute", side_effect=review))
            with TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 55000)) as client:
                try:
                    self.assertFalse(completed.is_set())
                    self.assertEqual(client.get("/ready").status_code, 200)
                finally:
                    release.set()

    def test_continuation_available_without_fixture_routes_and_readiness_tracks_worker(self):
        gateway = Mock(spec=SupabaseHttpGateway)
        gateway.reserve_due_workflow_work_items.return_value = []
        original_dns = socket.getaddrinfo
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, environment(), clear=True))
            stack.enter_context(patch("scripts.local_full_flow.read_local_status", return_value={}))
            stack.enter_context(patch("scripts.local_full_flow.gateway_from_status", return_value=gateway))
            app = create_app()
            self.assertIsNone(app.state.package_coordinator._dispatcher)
            paths = {route.path for route in app.routes}
            self.assertIn("/api/v1/appraisal-cases/{case_id}/post-continue", paths)
            self.assertNotIn("/api/local/claim-fixtures", paths)
            self.assertFalse(any("/internal/" in path and "work-items" in path for path in paths))
            with TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 55000)) as client:
                self.assertEqual(client.get("/ready").status_code, 200)
                path = f"/api/v1/appraisal-cases/{uuid4()}/post-continue"
                self.assertEqual(client.post(path).status_code, 401)
                self.assertEqual(client.post(path, json={"value": 1}).status_code, 400)
                for headers in ({"Host": "staging.venfour.com"}, {"Origin": "https://venfour.com"},
                                {"Origin": "http://localhost:9999"}):
                    self.assertEqual(client.post(path, headers=headers).status_code, 404)
                with patch("scripts.local_claim_flow.initialize", side_effect=LookupError):
                    self.assertEqual(client.post(path, headers={"Authorization": "Bearer other-owner"}).status_code, 404)
                app.state.local_worker.healthy = False
                self.assertEqual(client.get("/ready").status_code, 503)
        gateway.close.assert_called_once()
        self.assertIs(socket.getaddrinfo, original_dns)

    def test_composition_failure_closes_resources_and_restores_network(self):
        gateway = Mock(spec=SupabaseHttpGateway)
        original_dns = socket.getaddrinfo
        with patch.dict(os.environ, environment(), clear=True), \
            patch("scripts.local_full_flow.read_local_status", return_value={}), \
            patch("scripts.local_full_flow.gateway_from_status", return_value=gateway), \
            patch("venfour.api.create_app", side_effect=RuntimeError("composition failed")):
            with self.assertRaises(RuntimeError):
                create_app()
        gateway.close.assert_called_once()
        self.assertIs(socket.getaddrinfo, original_dns)


class FullFlowWorker(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock(spec=SupabaseHttpGateway)
        self.work_id = str(uuid4())
        self.gateway.reserve_due_workflow_work_items.return_value = [{
            "work_item_id": self.work_id, "package_job_id": str(uuid4()),
            "work_type": "total_loss_package_finalize", "work_version": "1", "dispatch_attempt_count": 1,
        }]
        self.gateway.mark_workflow_work_item_dispatched.return_value = True
        self.processor = Mock()
        self.worker = LocalWorker(self.gateway, self.processor)

    def test_acknowledges_dispatch_before_using_existing_processor(self):
        def execute(identity):
            self.gateway.mark_workflow_work_item_dispatched.assert_called_once()
            self.assertEqual(identity, self.work_id)
            return SimpleNamespace(state="completed")
        self.processor.execute.side_effect = execute
        self.assertTrue(self.worker.tick())
        self.gateway.reserve_due_workflow_work_items.assert_called_once()
        self.assertEqual(self.gateway.reserve_due_workflow_work_items.call_args.args[1], 1)
        self.assertTrue(self.worker.healthy)

    def test_stale_dispatch_fence_never_executes(self):
        self.gateway.mark_workflow_work_item_dispatched.return_value = False
        with self.assertRaises(Exception):
            self.worker.tick()
        self.processor.execute.assert_not_called()

    def test_failed_iteration_recovers_without_replaying_an_unreserved_item(self):
        async def exercise():
            stop = asyncio.Event()
            self.processor.execute.side_effect = RuntimeError("private-provider-detail")
            original_tick = self.worker.tick
            calls = 0
            def tick():
                nonlocal calls
                calls += 1
                if calls == 2:
                    self.gateway.reserve_due_workflow_work_items.return_value = []
                    stop.set()
                return original_tick()
            async def no_wait(awaitable, timeout):
                awaitable.close()
                raise TimeoutError
            with patch.object(self.worker, "tick", side_effect=tick), \
                patch("scripts.local_full_flow.asyncio.wait_for", side_effect=no_wait):
                await self.worker.run(stop)
            self.processor.execute.assert_called_once_with(self.work_id)
            self.assertFalse(self.worker.healthy)
        asyncio.run(exercise())
