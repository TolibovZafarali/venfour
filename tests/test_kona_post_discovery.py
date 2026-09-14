"""Confirmed subject regression with explicitly fictional, network-free listings."""
from __future__ import annotations

import copy
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock, patch

from tests.test_efficient_search import candidate
from tests.test_marketcheck_historical import make_history
from venfour.analysis_diagnostics import execution, failure_diagnostic, phase, progress
from venfour.analysis_runs import FileAnalysisRunRepository
from venfour.creation import AnalysisCreationService
from venfour.efficient_search import EfficientMarketSearch, EfficientSearchPolicy, subject_material_facts
from venfour.market_request_budget import MarketAccountLimits, MarketRequestBudget, MarketRequestPolicy, MemoryMarketRequestGateway, market_account_key
from venfour.marketcheck import MarketCheckProvider, MarketCheckHistoricalProvider
from venfour.orchestration import AnalysisOrchestrator
from venfour.search_progress import CaseSearchRecovery, MarketSearchInterrupted
from venfour.search_summary import validate_summary

SUBJECT = {"intake_mode": "manual", "vin": "KM8HA3AB8TU437528", "vehicle_year": 2026,
    "vehicle_make": "HYUNDAI", "vehicle_model": "Kona", "vehicle_trim": "SE", "mileage_at_loss": 2908,
    "postal_code": "63123", "date_of_loss": "2026-08-11", "insurer_name": "State Farm",
    "insurer_vehicle_valuation": 25704, "vehicle_facts": {"doors": "5", "engine": "2.0L (family: MPI NU PE)",
        "bodyType": "SUV", "fuelType": "Unleaded", "cylinders": "4", "drivetrain": "FWD", "transmission": "Automatic"}}
CASE = "10000000-0000-4000-8000-000000000001"
JOB = "10000000-0000-4000-8000-000000000002"
TOKEN = "10000000-0000-4000-8000-000000000003"


class KonaReplay:
    def __init__(self, directory, *, verify_history=False):
        self.now = datetime(2026, 9, 13, 23, 26, 12, tzinfo=UTC)
        self.calls = []
        self.summaries = {}
        self.events = []
        self.verify_history = verify_history
        self.accounting = MemoryMarketRequestGateway(clock=lambda: self.now)
        self.budget = MarketRequestBudget(self.accounting, market_account_key("synthetic-kona-account"), CASE,
            policy=MarketRequestPolicy(total_attempts=20, active_discovery_attempts=3, historical_discovery_attempts=3,
                history_attempts=12, enrichment_attempts=1, vehicle_terms_attempts=1, supporting_attempts=2,
                supporting_discovery_attempts=1, optimization_target_max=20),
            account_limits=MarketAccountLimits(monthly_allowance=500, max_requests_per_window=5, rate_window_seconds=1,
                monthly_period_start="2026-09-01T00:00:00Z", monthly_period_end="2026-10-01T00:00:00Z",
                monthly_usage_before_tracking=200), clock=lambda: self.now)
        self.gateway = Mock()
        self.gateway.access_case_market_search_journal.side_effect = self.journal
        self.gateway.record_case_market_search_summary.side_effect = self.summary
        self.recovery = CaseSearchRecovery(self.gateway, case_id=CASE, job_id=JOB, processing_token=TOKEN, retention_days=None)
        current = MarketCheckProvider("fictional-key", transport=self, request_budget=self.budget)
        historical = MarketCheckHistoricalProvider("fictional-key", as_of_date=self.now.date(), transport=self, request_budget=self.budget)
        self.engine = EfficientMarketSearch(current_provider=current, historical_provider=historical, budget=self.budget,
            policy=EfficientSearchPolicy(supporting_attempts=2, supporting_discovery_requests=1),
            readiness_stage="free_estimate", resumable_evidence=False, resume_loader=self.recovery.load,
            operation_begin=self.recovery.begin, checkpoint=self.recovery.save, summary_callback=self.recovery.summary)
        self.repository = FileAnalysisRunRepository(directory)
        self.orchestrator = AnalysisOrchestrator(self.repository, current_provider=current, historical_provider=historical,
            market_search=self.engine, clock=lambda: self.now, run_id_factory=lambda: JOB)
        self.creation = AnalysisCreationService(orchestrator_factory=lambda _: self.orchestrator, date_factory=lambda: self.now.date())

    def journal(self, args):
        action, index = args["requested_action"], args["requested_event_index"]
        used = self.budget.snapshot()["totalAttempts"]
        if action == "begin":
            assert index == len(self.events)
            self.events.append({"index": index, "operationDigest": args["requested_operation_digest"], "status": "started",
                "attemptsBefore": used, "attemptsAfter": None, "requiresReconciliation": False})
        elif action == "complete":
            self.events[index].update(status="completed", attemptsAfter=used)
        elif action != "read":
            raise AssertionError("Unexpected fixture journal action")
        return {"totalAttempts": used, "knownAttempts": max([e["attemptsAfter"] or 0 for e in self.events] or [0]),
            "events": copy.deepcopy(self.events)}

    def summary(self, args):
        value = validate_summary(args["requested_summary"])
        index = args["requested_event_index"]
        assert self.events[index]["status"] == "completed"
        assert self.events[index]["attemptsAfter"] == value["requestAttemptsConsumed"]
        self.summaries[index] = value
        return True

    def get(self, endpoint, params, headers, timeout):
        self.calls.append({"endpoint": endpoint, "params": dict(params)})
        self.now += timedelta(seconds=2)
        if "/history/" in endpoint:
            identity = endpoint.rsplit("/", 1)[-1]
            index = int(identity[-6:])
            return json.dumps([make_history(index, vin=identity, price=20000 + index * 100, miles=2908 + index * 50,
                latitude=38.547432, longitude=-90.328109, first_seen_at_date="2026-08-10T00:00:00Z",
                last_seen_at_date="2026-08-12T00:00:00Z")]).encode()
        historical = endpoint.endswith("recents")
        rows = []
        for index in range(5):
            mileage = 150000 if historical and not self.verify_history else 2908 + index * 50
            row = candidate(index, mileage=mileage, latitude=38.547432, longitude=-90.328109)
            row["build"].update(year=2026, make="Hyundai", model="Kona", trim="SE", drivetrain="AWD" if index == 4 else "FWD",
                body_type="SUV", engine="2.0L I4", cylinders=4, doors=5)
            if index == 3:
                row["build"].pop("engine")
            rows.append(row)
        # Overlap within each page and across all three deterministic centers.
        rows.append(copy.deepcopy(rows[0]))
        return json.dumps({"num_found": len(rows), "listings": rows}).encode()

    def run(self):
        return self.creation.create_from_confirmed_input(copy.deepcopy(SUBJECT)).artifact


class KonaPostDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def test_six_discovery_replay_completes_with_canonical_drive_and_aggregate_journal(self):
        replay = KonaReplay(self.directory.name)
        artifact = replay.run()
        self.assertEqual(len(replay.calls), 6)
        self.assertEqual(replay.budget.snapshot()["totalAttempts"], 6)
        self.assertTrue(artifact)
        self.assertNotIn("drivetrain", replay.engine.subject_facts)
        self.assertEqual(replay.engine.target.drivetrain, "FWD")
        self.assertEqual([c["id"] for c in replay.engine.centers[:3]], ["customer", "cbsa:21780", "cbsa:14010"])
        self.assertEqual(sorted(c["params"]["radius"] for c in replay.calls), [93, 93, 97, 97, 100, 100])
        for call in replay.calls:
            self.assertEqual(call["params"]["rows"], 50)
            self.assertEqual(call["params"]["start"], 0)
        batches = [s for s in replay.summaries.values() if s["returnedRows"]]
        self.assertEqual(len(batches), 6)
        self.assertTrue(any(s["duplicateObservations"] > 0 for s in batches))
        self.assertTrue(any(s["baselineCandidates"] > 0 for s in batches))
        self.assertTrue(any(s["rejectedByCategory"]["CONFIGURATION"] > 0 for s in batches))
        self.assertTrue(any(s["rejectedByCategory"]["MILEAGE"] > 0 for s in batches))
        self.assertEqual(replay.engine.policy.verification_batch_size, 3)
        serialized = json.dumps(replay.summaries)
        for prohibited in ("price", "dealer", "vin", "fictional-key", SUBJECT["vin"], "20000", "25704"):
            self.assertNotIn(prohibited, serialized)
        replay.gateway.save_case_market_search_progress.assert_not_called()
        replay.gateway.get_case_market_search_progress.assert_not_called()

    def test_history_selection_and_verification_complete_within_twenty(self):
        replay = KonaReplay(self.directory.name, verify_history=True)
        self.assertTrue(replay.run())
        discovery = [c for c in replay.calls if "/history/" not in c["endpoint"]]
        history = [c for c in replay.calls if "/history/" in c["endpoint"]]
        self.assertEqual(len(discovery), 6)
        self.assertGreater(len(history), 0)
        self.assertLessEqual(len(history), 12)
        self.assertLessEqual(len(replay.calls), 20)
        self.assertTrue(any(s["historyVerificationNecessary"] for s in replay.summaries.values()))
        self.assertGreater(len(replay.engine.verified["historical"]), 0)
        replay.gateway.save_case_market_search_progress.assert_not_called()

    def test_original_projection_reproduces_artifact_failure_after_six_calls(self):
        replay = KonaReplay(self.directory.name)
        def original(report):
            return {**subject_material_facts(report), **report["confirmedVehicleFacts"]}
        with patch("venfour.orchestration.subject_material_facts", side_effect=original):
            with self.assertRaises(Exception) as caught:
                replay.run()
        diagnostic = failure_diagnostic(caught.exception)
        self.assertEqual(diagnostic["internalErrorCode"], "ANALYSIS_ANALYSIS_ARTIFACT_VALIDATION_FAILED")
        self.assertEqual(diagnostic["exceptionType"], "AnalysisRunContractError")
        self.assertEqual(len(replay.calls), 6)
        self.assertEqual(diagnostic["requestAttemptsConsumed"], 6)
        self.assertTrue(diagnostic["providerTransportCompleted"])
        self.assertTrue(diagnostic["evidenceNormalized"])
        self.assertFalse(diagnostic["historyVerificationBegun"])
        self.assertEqual(len([s for s in replay.summaries.values() if s["returnedRows"]]), 6)
        self.assertFalse(list(self.repository_files()))
        with self.assertRaises(MarketSearchInterrupted) as resumed:
            replay.recovery.load(replay.engine.input_digest)
        self.assertTrue(resumed.exception.recovery_required)
        self.assertEqual(len(replay.calls), 6)
        replay.gateway.save_case_market_search_progress.assert_not_called()

    def repository_files(self):
        from pathlib import Path
        return Path(self.directory.name).rglob("*.json")

    def test_artifact_persistence_failure_keeps_summary_and_accounting(self):
        replay = KonaReplay(self.directory.name)
        with patch.object(replay.repository, "save", side_effect=OSError("private-payload fictional-key")):
            with self.assertRaises(Exception) as caught:
                replay.run()
        diagnostic = failure_diagnostic(caught.exception)
        self.assertEqual(diagnostic["operation"], "artifact_persistence")
        self.assertEqual(diagnostic["exceptionType"], "OSError")
        self.assertNotIn("private-payload", json.dumps(diagnostic))
        self.assertEqual(len(replay.calls), 6)
        self.assertEqual(len([s for s in replay.summaries.values() if s["returnedRows"]]), 6)

    def test_post_transport_boundaries_keep_exact_phase_and_physical_accounting(self):
        boundaries = [
            ("venfour.marketcheck.MarketCheckProvider._listing_page", "provider", "response_shape"),
            ("venfour.marketcheck.MarketCheckProvider._normalize_listing", "provider", "observation_normalization"),
            ("venfour.efficient_search.distance_miles", "search", "customer_distance"),
            ("venfour.efficient_search.assess_observation", "search", "candidate_scoring"),
            ("venfour.efficient_search.EfficientMarketSearch._observation_conflicts", "search", "identity_merge"),
        ]
        for target, expected_phase, operation in boundaries:
            with self.subTest(operation=operation):
                replay = KonaReplay(self.directory.name)
                with patch(target, side_effect=RuntimeError("private-provider-payload")):
                    with self.assertRaises(Exception) as caught:
                        replay.run()
                diagnostic = failure_diagnostic(caught.exception)
                self.assertEqual((diagnostic["phase"], diagnostic["operation"]), (expected_phase, operation))
                self.assertTrue(diagnostic["providerTransportCompleted"])
                self.assertEqual(diagnostic["requestAttemptsConsumed"], 1)
                self.assertEqual(len(replay.calls), 1)
                self.assertEqual(replay.budget.snapshot()["totalAttempts"], 1)
                self.assertNotIn("private-provider-payload", json.dumps(diagnostic))
                if expected_phase == "search":
                    self.assertEqual(replay.summaries[0]["returnedRows"], 6)
                    self.assertFalse(replay.summaries[0]["scoringCompleted"])
                with self.assertRaises(MarketSearchInterrupted):
                    replay.recovery.load(replay.engine.input_digest)
                self.assertEqual(len(replay.calls), 1)

    def test_summary_write_failure_never_repeats_paid_discovery(self):
        replay = KonaReplay(self.directory.name)
        replay.gateway.record_case_market_search_summary.side_effect = RuntimeError("private-rpc-detail")
        with self.assertRaises(Exception) as caught:
            replay.run()
        diagnostic = failure_diagnostic(caught.exception)
        self.assertEqual(diagnostic["operation"], "summary_persistence")
        self.assertEqual(replay.events[0]["status"], "completed")
        self.assertEqual(replay.events[0]["attemptsAfter"], 1)
        with self.assertRaises(MarketSearchInterrupted) as resumed:
            replay.recovery.load(replay.engine.input_digest)
        self.assertTrue(resumed.exception.recovery_required)
        self.assertEqual(len(replay.calls), 1)



class FailureDiagnosticTests(unittest.TestCase):
    def test_nested_success_restores_boundary_and_chained_frames_are_private(self):
        @execution
        def fail():
            progress(requestAttemptsConsumed=6, evidenceNormalized=True, providerTransportCompleted=True)
            with phase("analysis", "artifact_validation"):
                with phase("search", "candidate_scoring"):
                    pass
                try:
                    raise ValueError("secret-vin-price-provider-payload")
                except ValueError as exc:
                    raise RuntimeError("private wrapper") from exc
        with self.assertLogs("venfour.analysis_failure") as logs, self.assertRaises(RuntimeError) as caught:
            fail()
        value = failure_diagnostic(caught.exception)
        self.assertEqual(value["operation"], "artifact_validation")
        self.assertEqual(value["requestAttemptsConsumed"], 6)
        self.assertEqual([e["exceptionType"] for e in value["exceptionChain"]], ["RuntimeError", "ValueError"])
        logged = json.loads(logs.records[0].getMessage())
        self.assertTrue(all(e["frames"] for e in logged["exceptionChain"]))
        self.assertNotIn("secret-vin-price", json.dumps(value))
        self.assertNotIn("private wrapper", "".join(logs.output))
        @execution
        def separate():
            raise ValueError("separate")
        with self.assertRaises(ValueError) as other:
            separate()
        self.assertIsNone(failure_diagnostic(other.exception)["requestAttemptsConsumed"])

    def test_detached_transport_keeps_frames_without_retaining_private_exception(self):
        from urllib.error import URLError
        from venfour.analysis_diagnostics import inherit_sanitized_failure
        from venfour.market import MarketProviderUnavailableError
        @execution
        def fail():
            saved = None
            try:
                with phase("provider", "transport"):
                    raise URLError("https://provider.invalid/?api_key=private-secret")
            except URLError as exc:
                saved = MarketProviderUnavailableError("Provider unavailable")
                inherit_sanitized_failure(saved, exc)
            raise saved
        with self.assertLogs("venfour.analysis_failure") as logs, self.assertRaises(MarketProviderUnavailableError) as caught:
            fail()
        import traceback
        self.assertIsNone(caught.exception.__cause__)
        self.assertIsNone(caught.exception.__context__)
        self.assertNotIn("private-secret", "".join(traceback.format_exception(caught.exception)))
        logged = json.loads(logs.records[0].getMessage())
        self.assertEqual(logged["exceptionType"], "URLError")
        self.assertEqual(logged["operation"], "transport")
        self.assertTrue(logged["exceptionChain"][-1]["frames"])
        self.assertNotIn("private-secret", json.dumps(logged))

    def test_customer_failure_and_reopen_are_generic_and_do_not_restart_work(self):
        from tests.test_case_analyses import FakeCaseGateway, PersistingCreationFactory, CASE_ID, USER_ID, TOKEN_ID
        from venfour.case_analyses import CaseAnalysisService
        events = []
        gateway = FakeCaseGateway()
        service = CaseAnalysisService(gateway, creation_service_factory=PersistingCreationFactory(RuntimeError("secret-internal")),
            token_factory=lambda: TOKEN_ID, lifecycle_event_sink=events.append)
        first = service.submit(CASE_ID, USER_ID)
        self.assertEqual(first.status, "failed")
        self.assertEqual(first.failure_code, "ANALYSIS_CREATION_FAILED")
        self.assertTrue(first.retryable)
        reopened = service.status(CASE_ID, USER_ID)
        repeated = service.submit(CASE_ID, USER_ID)
        failure_fields = ("status", "attemptCount", "error", "retryable")
        expected_failure = {key: first.to_dict()[key] for key in failure_fields}
        for response in (reopened, repeated):
            self.assertEqual(
                {key: response.to_dict()[key] for key in failure_fields},
                expected_failure,
            )
        self.assertNotIn("submissionAvailability", first.to_dict())
        self.assertEqual(reopened.to_dict()["submissionAvailability"], {"available": True})
        self.assertEqual(len(gateway.failures), 1)
        self.assertEqual(len(events), 2)
        self.assertNotIn("secret-internal", json.dumps(events))
        self.assertNotIn("diagnostic", first.to_dict())
        self.assertIn("diagnostic", json.loads(events[-1]))

class SearchSummaryGatewayTests(unittest.TestCase):
    def test_lost_summary_ack_retries_identical_rpc_without_provider_transport(self):
        import httpx
        from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration, SupabaseContractError
        from venfour.search_summary import discovery_summary
        summary = discovery_summary({'stream':'historical','purpose':'baseline','center':{'id':'customer'},'start':0,'rows':50},
            [],returned_rows=0,parseable_observations=0,request_attempts=1)
        args = {'requested_case_id':CASE,'requested_job_id':JOB,'requested_processing_token':TOKEN,
            'requested_execution_id':'10000000-0000-4000-8000-000000000004','requested_input_digest':'a'*64,
            'requested_operation_digest':'b'*64,'requested_event_index':0,'requested_summary':summary}
        calls = []
        def handle(request):
            self.assertEqual(request.url.path, '/rest/v1/rpc/record_case_market_search_summary')
            calls.append(json.loads(request.content))
            return httpx.Response(504 if len(calls)==1 else 200, json=None if len(calls)==1 else True)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            gateway=SupabaseHttpGateway(SupabaseServerConfiguration(url='https://fixture.supabase.co',
                publishable_key='fixture-public',service_role_key='fixture-private'),client=client)
            with patch('venfour.supabase_gateway.time.sleep'):
                self.assertTrue(gateway.record_case_market_search_summary(args))
            self.assertEqual(calls,[args,args])
            invalid=copy.deepcopy(args);invalid['requested_summary']['price']=25000
            with self.assertRaises(SupabaseContractError):
                gateway.record_case_market_search_summary(invalid)
            self.assertEqual(len(calls),2)
