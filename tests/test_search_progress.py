"""Resumable market evidence stays case scoped, bounded and credential free."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import Mock, patch

import httpx

from venfour.search_progress import CaseSearchProgress
from venfour.supabase_gateway import SupabaseContractError, SupabaseHttpGateway, SupabaseServerConfiguration


CASE = "39000000-0000-4000-8000-000000000001"
JOB = "39000000-0000-4000-8000-000000000002"
TOKEN = "39000000-0000-4000-8000-000000000003"


def checkpoint(scope="current"):
    inputs = {"scope": scope}
    return {"version": "1", "inputDigest": hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "input": inputs, "events": [], "geography": {}, "origin": None,
            "providers": {}, "usageBefore": {"totalAttempts": 0}, "historicalTemplate": None}


class CaseSearchProgressTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.gateway.save_case_market_search_progress.return_value = True
        self.gateway.get_case_market_search_progress.return_value = None
        self.progress = CaseSearchProgress(self.gateway, case_id=CASE, job_id=JOB, processing_token=TOKEN, retention_days=7)

    def test_load_and_save_bind_case_job_token_input_and_current_retention(self):
        saved = checkpoint()
        self.progress.save(saved)
        args = self.gateway.save_case_market_search_progress.call_args.args[0]
        self.assertEqual(args, {"requested_case_id": CASE, "requested_job_id": JOB, "requested_processing_token": TOKEN,
            "requested_input_digest": saved["inputDigest"], "requested_checkpoint": saved, "requested_retention_days": 7})
        args["requested_checkpoint"]["input"]["scope"] = "mutated gateway argument"
        self.assertEqual(saved["input"]["scope"], "current")
        self.gateway.get_case_market_search_progress.return_value = saved
        loaded = self.progress.load(saved["inputDigest"])
        self.assertEqual(loaded, saved)
        loaded["input"]["scope"] = "mutated caller data"
        self.assertEqual(saved["input"]["scope"], "current")
        self.assertEqual(self.gateway.get_case_market_search_progress.call_args.args[0]["requested_retention_days"], 7)

    def test_missing_or_expired_saved_work_does_not_resume(self):
        self.assertIsNone(self.progress.load(checkpoint()["inputDigest"]))
        self.gateway.save_case_market_search_progress.assert_not_called()

    def test_stale_save_fails_without_claiming_persistence(self):
        self.gateway.save_case_market_search_progress.return_value = False
        with self.assertRaisesRegex(ValueError, "lease changed"):
            self.progress.save(checkpoint())
        self.gateway.save_case_market_search_progress.assert_called_once()

    def test_wrong_input_and_tampered_input_are_rejected(self):
        self.gateway.get_case_market_search_progress.return_value = checkpoint("historical")
        with self.assertRaisesRegex(ValueError, "different input"):
            self.progress.load(checkpoint()["inputDigest"])
        changed = checkpoint()
        changed["input"]["scope"] = "different input"
        with self.assertRaisesRegex(ValueError, "digest"):
            self.progress.save(changed)
        self.gateway.save_case_market_search_progress.assert_not_called()

    def test_invalid_lease_identity_and_unconfirmed_retention_fail_before_gateway(self):
        for invalid in (None, "not-a-uuid", TOKEN.upper()):
            # The fixture UUID has no alphabetic digits, so use a different uppercase UUID.
            if invalid == TOKEN:
                invalid = "ABCDEF00-0000-4000-8000-000000000003"
            with self.subTest(identity=invalid), self.assertRaises(ValueError):
                CaseSearchProgress(self.gateway, case_id=CASE, job_id=JOB, processing_token=invalid, retention_days=7)
        for days in (None, True, 0, 31, 1.5):
            with self.subTest(days=days), self.assertRaises(ValueError):
                CaseSearchProgress(self.gateway, case_id=CASE, job_id=JOB, processing_token=TOKEN, retention_days=days)
        for digest in (None, "a" * 63, "A" * 64, []):
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                self.progress.load(digest)
        self.gateway.get_case_market_search_progress.assert_not_called()

    def test_credentials_and_raw_responses_are_rejected_without_echoing_them(self):
        for extra in ({"api_key": "fixture-sensitive-value"},
                      {"url": "https://example.test/listing?api%5Fkey=fixture-sensitive-value"},
                      {"url": "https://user:fixture-sensitive-value@example.test/listing"},
                      {"rawResponse": {"listings": []}}, {"provider_payload": {"listings": []}}):
            bad = checkpoint()
            bad["events"] = [{"payload": extra}]
            with self.subTest(extra=tuple(extra)), self.assertRaises(ValueError) as caught:
                self.progress.save(bad)
            self.assertNotIn("fixture-sensitive-value", str(caught.exception))
        with patch.dict("os.environ", {"MARKETCHECK_API_KEY": "fixture-sensitive-value"}):
            bad = checkpoint()
            bad["events"] = [{"label": "fixture-sensitive-value"}]
            with self.assertRaises(ValueError) as caught:
                self.progress.save(bad)
            self.assertNotIn("fixture-sensitive-value", str(caught.exception))
        self.gateway.save_case_market_search_progress.assert_not_called()

    def test_unbounded_or_unstructured_checkpoints_are_rejected(self):
        cases = [[], {"version": "1", "events": []}]
        oversized = checkpoint()
        oversized["events"] = [{}] * 201
        cases.append(oversized)
        unstructured = checkpoint()
        unstructured["rawResponse"] = {}
        cases.append(unstructured)
        nonfinite = checkpoint()
        nonfinite["usageBefore"]["totalAttempts"] = float("nan")
        cases.append(nonfinite)
        oversized = checkpoint()
        oversized["events"] = [{"text": "x" * 8_388_608}]
        cases.append(oversized)
        for value in cases:
            with self.subTest(kind=type(value).__name__), self.assertRaises((ValueError, TypeError)):
                self.progress.save(value)
        self.gateway.save_case_market_search_progress.assert_not_called()


class SearchProgressGatewayTests(unittest.TestCase):
    def gateway(self, handler):
        self.client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(self.client.close)
        return SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co",
            publishable_key="fixture-public-key", service_role_key="fixture-service-key"), client=self.client)

    def arguments(self, save=False):
        saved = checkpoint()
        args = {"requested_case_id": CASE, "requested_job_id": JOB, "requested_processing_token": TOKEN,
                "requested_input_digest": saved["inputDigest"], "requested_retention_days": 7}
        if save:
            args["requested_checkpoint"] = saved
        return args

    def test_gateway_uses_service_rpc_and_checked_payload(self):
        requests = []
        gateway = self.gateway(lambda r: requests.append(r) or httpx.Response(200, json=True if r.url.path.endswith('save_case_market_search_progress') else checkpoint()))
        self.assertTrue(gateway.save_case_market_search_progress(self.arguments(save=True)))
        self.assertEqual(gateway.get_case_market_search_progress(self.arguments()), checkpoint())
        self.assertEqual([r.url.path for r in requests], ["/rest/v1/rpc/save_case_market_search_progress", "/rest/v1/rpc/get_case_market_search_progress"])
        self.assertTrue(all(r.headers["authorization"] == "Bearer fixture-service-key" for r in requests))
        self.assertEqual(json.loads(requests[0].content), self.arguments(save=True))

    def test_direct_gateway_cannot_bypass_secret_or_identity_checks(self):
        requests = []
        gateway = self.gateway(lambda r: requests.append(r) or httpx.Response(200, json=True))
        bad = self.arguments(save=True)
        bad["requested_checkpoint"]["events"] = [{"apiKey": "fixture-sensitive-value"}]
        with self.assertRaises(SupabaseContractError):
            gateway.save_case_market_search_progress(bad)
        bad = self.arguments()
        bad["requested_processing_token"] = None
        with self.assertRaises(SupabaseContractError):
            gateway.get_case_market_search_progress(bad)
        self.assertEqual(requests, [])

    def test_returned_checkpoint_is_validated_before_reuse(self):
        for payload in ([], checkpoint("different input"), {**checkpoint(), "events": [{"headers": {}}]}):
            gateway = self.gateway(lambda _r, value=payload: httpx.Response(200, json=value))
            with self.subTest(kind=type(payload).__name__), self.assertRaises(SupabaseContractError):
                gateway.get_case_market_search_progress(self.arguments())
        gateway = self.gateway(lambda _r: httpx.Response(200, content=b"null", headers={"content-type": "application/json"}))
        self.assertIsNone(gateway.get_case_market_search_progress(self.arguments()))
        gateway = self.gateway(lambda _r: httpx.Response(200, json=1))
        with self.assertRaises(SupabaseContractError):
            gateway.save_case_market_search_progress(self.arguments(save=True))


if __name__ == "__main__":
    unittest.main()
