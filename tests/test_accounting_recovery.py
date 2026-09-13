"""Recovery may retry accounting messages; it may not duplicate provider work."""
import copy
import json
import unittest
from unittest.mock import Mock, patch

import httpx

from tests.test_market_request_budget import ACCOUNT, CASE, JOB, PROCESSING_TOKEN, NOW, limits
from tests.test_search_progress import checkpoint
from venfour.market_request_budget import MarketRequestBudget, MemoryMarketRequestGateway, MarketRequestBudgetExceeded
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration
from venfour.marketcheck import MarketCheckProvider
from tests.test_marketcheck_historical import RecordingTransport, make_request
from venfour.search_progress import CaseSearchRecovery, MarketSearchInterrupted, operation_digest
from venfour.case_analyses import CaseAnalysisService


class AccountingAcknowledgmentTests(unittest.TestCase):
    def exercise(self, mode):
        store = MemoryMarketRequestGateway(clock=lambda: NOW)
        requests = []
        def handle(request):
            payload = json.loads(request.content)["requested"]
            requests.append(payload)
            if len(requests) == 1 and mode in {"lost", "uncommitted", "busy"}:
                if mode == "lost":
                    store.reserve_market_request_attempt(payload)
                return httpx.Response(400, json={"code":"55P03"}) if mode == "busy" else httpx.Response(504, json={"message":"private detail"})
            if mode == "unavailable":
                return httpx.Response(504, json={"message":"private detail"})
            return httpx.Response(200, json=store.reserve_market_request_attempt(payload))
        client = httpx.Client(transport=httpx.MockTransport(handle))
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co",
            publishable_key="fixture-public", service_role_key="fixture-secret"), client=client)
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW,
            job_id=JOB, processing_token=PROCESSING_TOKEN)
        transport = RecordingTransport([{"num_found": 0, "listings": []}])
        provider = MarketCheckProvider("fixture-provider-secret", transport=transport, request_budget=budget)
        with patch("venfour.supabase_gateway.time.sleep"), self.assertLogs("venfour.market_accounting", level="INFO") as logs:
            if mode in {"lost", "unavailable"}:
                with self.assertRaises(MarketRequestBudgetExceeded):
                    provider.discover_page(make_request().to_market_search_request())
            else:
                provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(len(transport.calls), 1 if mode in {"uncommitted", "busy"} else 0)
        for secret in ("private detail", "fixture-secret", "fixture-provider-secret", CASE, PROCESSING_TOKEN):
            self.assertNotIn(secret, " ".join(logs.output))
        return store.get_market_request_usage(budget._identity)["totalAttempts"]

    def test_gateway_failure_before_commit_recovers_one_physical_call(self):
        self.assertEqual(self.exercise("uncommitted"), 1)

    def test_busy_database_rolls_back_then_recovers_one_physical_call(self):
        self.assertEqual(self.exercise("busy"), 1)

    def test_committed_reservation_with_lost_ack_cannot_authorize_transport(self):
        self.assertEqual(self.exercise("lost"), 1)

    def test_persistent_gateway_failure_never_reaches_transport(self):
        self.assertEqual(self.exercise("unavailable"), 0)


class OperationalRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.gateway.get_case_market_search_progress.return_value = None
        self.gateway.save_case_market_search_progress.return_value = True
        self.journal = {"totalAttempts": 0, "knownAttempts": 0, "events": []}
        self.gateway.access_case_market_search_journal.side_effect = lambda _args: copy.deepcopy(self.journal)
        self.saved = checkpoint()
        self.operation = {"kind": "discovery", "stream": "historical", "start": 0, "centerId": "fixture"}

    def progress(self, retention=None):
        return CaseSearchRecovery(self.gateway, case_id=CASE, job_id=JOB,
                                  processing_token=PROCESSING_TOKEN, retention_days=retention)

    def completed(self, status="completed", before=0, after=1):
        self.journal = {"totalAttempts": after, "knownAttempts": after if status == "completed" else before,
            "events": [{"index": 0, "operationDigest": operation_digest(self.operation), "status": status,
                        "attemptsBefore": before, "attemptsAfter": after if status == "completed" else None,
                        "requiresReconciliation": False}]}
        self.saved["events"] = [{"operation": self.operation, "payload": {"observations": [{"fixture": "normalized evidence"}]},
                                "usageBefore": {"totalAttempts": before}, "usageAfter": {"totalAttempts": after}}]

    def test_retention_disabled_persists_only_digests_and_execution_metadata(self):
        progress = self.progress()
        self.assertIsNone(progress.load(self.saved["inputDigest"]))
        progress.begin(0, self.operation)
        self.completed()
        progress.save(self.saved)
        sent = self.gateway.access_case_market_search_journal.call_args.args[0]
        self.assertEqual(sent["requested_action"], "complete")
        self.assertEqual(sent["requested_operation_digest"], operation_digest(self.operation))
        self.assertNotIn("normalized evidence", json.dumps(sent))
        self.gateway.save_case_market_search_progress.assert_not_called()
        self.gateway.get_case_market_search_progress.assert_not_called()

    def test_missing_or_expired_evidence_cannot_repeat_paid_for_discovery(self):
        self.completed()
        for days in (None, 7):
            with self.subTest(retention=days), self.assertRaises(MarketSearchInterrupted) as caught:
                self.progress(days).load(self.saved["inputDigest"])
            self.assertTrue(caught.exception.recovery_required)

    def test_pre_journal_canary_with_four_spent_attempts_requires_recovery(self):
        self.journal["totalAttempts"] = 4
        with self.assertRaises(MarketSearchInterrupted) as caught:
            self.progress().load(self.saved["inputDigest"])
        self.assertTrue(caught.exception.recovery_required)

    def test_retained_normalized_evidence_resumes_without_refetch(self):
        self.completed()
        self.gateway.get_case_market_search_progress.return_value = self.saved
        result = self.progress(7).load(self.saved["inputDigest"])
        self.assertEqual(result, self.saved)
        self.gateway.save_case_market_search_progress.assert_not_called()

    def test_checkpoint_saved_but_completion_ack_lost_can_resume(self):
        self.completed(status="started")
        self.gateway.get_case_market_search_progress.return_value = self.saved
        self.assertEqual(self.progress(7).load(self.saved["inputDigest"]), self.saved)

    def test_partial_operation_after_saved_checkpoint_cannot_be_repeated(self):
        self.completed(status="started", before=1, after=2)
        self.saved["events"][0]["usageAfter"]["totalAttempts"] = 1
        self.gateway.get_case_market_search_progress.return_value = self.saved
        with self.assertRaises(MarketSearchInterrupted):
            self.progress(7).load(self.saved["inputDigest"])

    def test_uncertain_account_headers_require_reconciliation_even_with_evidence(self):
        self.completed()
        self.journal["events"][0]["requiresReconciliation"] = True
        self.gateway.get_case_market_search_progress.return_value = self.saved
        with self.assertRaises(MarketSearchInterrupted) as caught:
            self.progress(7).load(self.saved["inputDigest"])
        self.assertTrue(caught.exception.recovery_required)

    def test_checkpoint_write_outage_is_a_processing_interruption(self):
        progress = self.progress(7)
        progress.load(self.saved["inputDigest"])
        self.completed()
        self.gateway.save_case_market_search_progress.side_effect = RuntimeError("fixture database outage")
        with self.assertRaises(MarketSearchInterrupted):
            progress.save(self.saved)
        self.assertEqual(self.gateway.access_case_market_search_journal.call_count, 1)

    def test_failure_codes_distinguish_processing_from_evidence_sufficiency(self):
        self.assertEqual(CaseAnalysisService._failure_for(MarketSearchInterrupted()), ("ANALYSIS_PROCESSING_INTERRUPTED", True))
        self.assertEqual(CaseAnalysisService._failure_for(MarketSearchInterrupted(recovery_required=True)), ("ANALYSIS_RECOVERY_REQUIRED", False))
        self.assertEqual(CaseAnalysisService._failure_for(MarketRequestBudgetExceeded("MARKET_REQUEST_ACCOUNTING_UNAVAILABLE")), ("ANALYSIS_PROCESSING_INTERRUPTED", True))

class SuccessfulBatchCheckpointTests(unittest.TestCase):
    def test_later_usage_read_outage_preserves_successful_batch_and_resumes_without_transport(self):
        from tests.test_efficient_search import EfficientSearchTests, FixtureTransport, candidate
        transport = FixtureTransport(current=[candidate(i) for i in range(12)])
        gateway = MemoryMarketRequestGateway(clock=lambda: NOW)
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW)
        original = gateway.get_market_request_usage
        failed = False
        def fail_once(request):
            nonlocal failed
            if transport.calls and not failed:
                failed = True
                raise RuntimeError('fixture accounting interruption')
            return original(request)
        gateway.get_market_request_usage = fail_once
        saved = []
        runner = EfficientSearchTests()
        with self.assertRaises(MarketSearchInterrupted):
            runner.run_fixture(transport, budget=budget, streams=('current',), checkpoint=lambda value:saved.append(copy.deepcopy(value)))
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(len(saved[-1]['events'][0]['payload']['observations']), 12)
        result, _ = runner.run_fixture(transport, budget=budget, streams=('current',), saved=saved[-1])
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(result.transcript['usageAfter']['totalAttempts'], 1)

    def test_header_accounting_outage_keeps_response_but_blocks_further_transport(self):
        from tests.test_efficient_search import EfficientSearchTests, FixtureTransport, candidate
        from venfour.marketcheck import MarketCheckHttpResponse
        transport = FixtureTransport(current=[candidate(i) for i in range(12)])
        original_transport = transport.get
        transport.get = lambda *args: MarketCheckHttpResponse(original_transport(*args), {'Quota-Remaining':'999'})
        gateway = MemoryMarketRequestGateway(clock=lambda: NOW)
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW)
        original = gateway.get_market_request_usage
        def fail_after_transport(request):
            if transport.calls:
                raise RuntimeError('fixture header accounting outage')
            return original(request)
        gateway.get_market_request_usage = fail_after_transport
        saved=[]
        with self.assertRaises(MarketSearchInterrupted) as caught:
            EfficientSearchTests().run_fixture(transport, budget=budget, streams=('current',), checkpoint=lambda value:saved.append(copy.deepcopy(value)))
        self.assertTrue(caught.exception.recovery_required)
        self.assertTrue(saved[-1]['events'][0]['accountStateUncertain'])
        self.assertEqual(len(saved[-1]['events'][0]['payload']['observations']), 12)
        with self.assertRaises(MarketRequestBudgetExceeded):
            budget.reserve_attempt('active_inventory')
        self.assertEqual(len(transport.calls), 1)

class AccountingDiagnosticContractTests(unittest.TestCase):
    def test_malformed_error_code_is_not_logged_or_treated_as_an_exception_message(self):
        from venfour.supabase_gateway import SupabaseUnavailableError
        with httpx.Client(transport=httpx.MockTransport(lambda _request:
            httpx.Response(504, json={'code': {}, 'message': 'fixture-sensitive-value'}))) as client:
            gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url='https://fixture.supabase.co',
                publishable_key='fixture-public', service_role_key='fixture-service'), client=client)
            with patch('venfour.supabase_gateway.time.sleep'), self.assertLogs('venfour.market_accounting') as logs:
                with self.assertRaises(SupabaseUnavailableError):
                    gateway._bounded_market_rpc('get_market_request_usage', {})
            self.assertEqual(len(logs.output), 2)
            self.assertNotIn('fixture-sensitive-value', ' '.join(logs.output))
