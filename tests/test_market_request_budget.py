"""Physical attempts share durable-style case, account and optional-pass limits."""

from __future__ import annotations

import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import httpx

from venfour.market_request_budget import (
    MarketAccountLimits, MarketRequestBudget, MarketRequestBudgetExceeded,
    MarketRequestPolicy, MemoryMarketRequestGateway, market_account_key,
)
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration


NOW = datetime(2026, 9, 9, 12, tzinfo=UTC)
CASE = "20000000-0000-4000-8000-000000000002"
JOB = "20000000-0000-4000-8000-000000000003"
PROCESSING_TOKEN = "20000000-0000-4000-8000-000000000004"
ACCOUNT = market_account_key("fixture-account")
VIN = "KM8HACABXTU436557"


def limits(**changes):
    return replace(MarketAccountLimits(
        monthly_allowance=1000, max_requests_per_window=1000, rate_window_seconds=60,
        monthly_period_start="2026-09-01T00:00:00Z", monthly_period_end="2026-10-01T00:00:00Z",
        monthly_usage_before_tracking=0,
    ), **changes)


class MarketRequestBudgetTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.gateway = MemoryMarketRequestGateway(clock=lambda: self.now)

    def budget(self, *, policy=None, account_limits=None, case=CASE, account=ACCOUNT):
        return MarketRequestBudget(self.gateway, account, case, policy=policy,
                                   account_limits=account_limits or limits(), clock=lambda: self.now)

    def denied(self, budget, code, endpoint="active_inventory", **kwargs):
        with self.assertRaises(MarketRequestBudgetExceeded) as caught:
            budget.reserve_attempt(endpoint, **kwargs)
        self.assertEqual(caught.exception.reason_code, code)
        return caught.exception

    def test_sixty_attempts_cover_both_streams_enrichment_and_optional_work(self):
        budget = self.budget()
        for _ in range(8):
            budget.reserve_attempt("historical_inventory")
        for _ in range(8):
            budget.reserve_attempt("active_inventory")
        for index in range(35):
            budget.reserve_attempt("vin_history", vin=f"KM8HACABXTU{index:06d}")
        for _ in range(4):
            budget.reserve_attempt("active_inventory", phase="enrichment", vin=VIN)
        for index in range(5):
            budget.reserve_attempt("vin_history", phase="supporting", vin=f"KM8HACABXTV{index:06d}")
        self.assertEqual(budget.snapshot()["totalAttempts"], 60)
        self.assertEqual(budget.remaining, 0)
        self.denied(budget, "MARKET_CASE_BUDGET_EXHAUSTED", "active_inventory", phase="enrichment", vin=VIN)
        self.assertEqual(budget.snapshot()["phaseAttempts"], {"baseline": 51, "enrichment": 4, "supporting": 5})

    def test_endpoint_and_per_vin_limits_include_retries_and_failed_requests(self):
        budget = self.budget()
        for _ in range(3):
            budget.reserve_attempt("vin_history", vin=VIN)
            budget.report_response(500)
        self.denied(budget, "MARKET_VIN_HISTORY_BUDGET_EXHAUSTED", "vin_history", vin=VIN)
        for _ in range(8):
            budget.reserve_attempt("active_inventory")
        self.denied(budget, "MARKET_ENDPOINT_BUDGET_EXHAUSTED")
        self.assertEqual(budget.snapshot()["totalAttempts"], 11)

    def test_supporting_histories_share_five_and_discovery_has_two_attempts(self):
        budget = self.budget()
        budget.reserve_attempt("active_inventory", phase="supporting")
        budget.reserve_attempt("historical_inventory", phase="supporting")
        self.denied(budget, "MARKET_SUPPORTING_DISCOVERY_BUDGET_EXHAUSTED", phase="supporting")
        for _ in range(3):
            budget.reserve_attempt("vin_history", phase="supporting", vin=VIN)
        self.denied(budget, "MARKET_SUPPORTING_BUDGET_EXHAUSTED", "vin_history", phase="supporting", vin="KM8HACABXTU000001")
        budget.reserve_attempt("active_inventory")
        self.assertEqual(budget.remaining, 54)

    def test_concurrent_workers_cannot_exceed_the_case_allowance(self):
        policy = MarketRequestPolicy(total_attempts=4, active_discovery_attempts=10)
        def attempt(_):
            try:
                self.budget(policy=policy).reserve_attempt("active_inventory")
                return True
            except MarketRequestBudgetExceeded:
                return False
        with ThreadPoolExecutor(max_workers=16) as pool:
            accepted = list(pool.map(attempt, range(40)))
        self.assertEqual(sum(accepted), 4)
        self.assertEqual(self.budget(policy=policy).remaining, 0)

    def test_new_cases_and_workers_share_monthly_reserve_and_existing_usage(self):
        account_limits = limits(monthly_allowance=10, monthly_usage_before_tracking=5)
        def attempt(_):
            try:
                self.budget(account_limits=account_limits, case=str(uuid4())).reserve_attempt("active_inventory")
                return True
            except MarketRequestBudgetExceeded:
                return False
        with ThreadPoolExecutor(max_workers=12) as pool:
            accepted = list(pool.map(attempt, range(30)))
        self.assertEqual(sum(accepted), 3)
        self.denied(self.budget(account_limits=account_limits), "MARKET_MONTHLY_RESERVE_REACHED")
        usage = self.budget(account_limits=account_limits).snapshot()
        self.assertEqual((usage["monthlyAttempts"], usage["monthlyRoutineLimit"]), (8, 8))

    def test_cumulative_case_usage_survives_new_worker_and_new_month(self):
        policy = MarketRequestPolicy(total_attempts=2)
        first = self.budget(policy=policy)
        first.reserve_attempt("active_inventory")
        self.now = datetime(2026, 10, 2, tzinfo=UTC)
        october = limits(monthly_period_start="2026-10-01T00:00:00Z", monthly_period_end="2026-11-01T00:00:00Z")
        resumed = self.budget(policy=policy, account_limits=october)
        resumed.reserve_attempt("active_inventory")
        self.denied(resumed, "MARKET_CASE_BUDGET_EXHAUSTED")
        self.assertEqual(resumed.snapshot()["monthlyAttempts"], 1)
        self.assertEqual(resumed.snapshot()["totalAttempts"], 2)

    def test_changing_policy_or_overlapping_period_cannot_reset_usage(self):
        self.budget(policy=MarketRequestPolicy(total_attempts=1)).reserve_attempt("active_inventory")
        self.denied(self.budget(policy=MarketRequestPolicy(total_attempts=60)), "MARKET_CASE_POLICY_CHANGED")
        self.denied(self.budget(policy=MarketRequestPolicy(total_attempts=1), account=market_account_key("other-account")),
                    "MARKET_CASE_ACCOUNT_CHANGED")
        self.denied(self.budget(policy=MarketRequestPolicy(total_attempts=1),
                               account_limits=limits(monthly_period_start="2026-09-09T00:00:00Z")),
                    "MARKET_ACCOUNT_CONFIGURATION_CHANGED")

    def test_prior_usage_can_increase_without_refunding_counted_requests(self):
        self.budget().reserve_attempt("active_inventory")
        reconciled = self.budget(account_limits=limits(monthly_usage_before_tracking=799))
        self.denied(reconciled, "MARKET_MONTHLY_RESERVE_REACHED")
        self.assertEqual(reconciled.snapshot()["monthlyAttempts"], 800)
        self.denied(self.budget(), "MARKET_ACCOUNT_CONFIGURATION_CHANGED")
        self.assertEqual(reconciled.snapshot()["totalAttempts"], 1)

    def test_rate_limit_coordinates_instances_and_retry_after_is_shared(self):
        account_limits = limits(max_requests_per_window=2, rate_window_seconds=10)
        first = self.budget(account_limits=account_limits)
        first.reserve_attempt("active_inventory")
        self.budget(account_limits=account_limits, case=str(uuid4())).reserve_attempt("active_inventory")
        caught = self.denied(first, "MARKET_ACCOUNT_RATE_LIMIT_REACHED")
        self.assertEqual(caught.retry_after_seconds, 10)
        self.now += timedelta(seconds=10)
        first.reserve_attempt("active_inventory")
        first.report_response(429, retry_after="120")
        self.now += timedelta(seconds=11)
        other = self.budget(account_limits=account_limits, case=str(uuid4()))
        caught = self.denied(other, "MARKET_ACCOUNT_THROTTLED")
        self.assertEqual(caught.retry_after_seconds, 109)
        self.now += timedelta(seconds=110)
        other.reserve_attempt("active_inventory")

    def test_http_date_retry_after_and_explicit_quota_are_distinct(self):
        budget = self.budget()
        budget.reserve_attempt("active_inventory")
        budget.report_response(503, "Wed, 09 Sep 2026 12:05:00 GMT")
        self.assertEqual(self.denied(self.budget(), "MARKET_ACCOUNT_THROTTLED").retry_after_seconds, 300)
        self.now += timedelta(seconds=301)
        budget.reserve_attempt("active_inventory")
        budget.report_response(429, "0", quota_exhausted=True)
        self.denied(self.budget(case=str(uuid4())), "MARKET_ACCOUNT_QUOTA_EXHAUSTED")
        self.assertEqual(budget.snapshot()["totalAttempts"], 2)

    def test_unknown_plan_fails_closed_including_metered_accounts(self):
        for config, reason in (
            (MarketAccountLimits(), "MARKET_ACCOUNT_RATE_LIMIT_UNCONFIGURED"),
            (MarketAccountLimits(max_requests_per_window=3, rate_window_seconds=10), "MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED"),
            (limits(monthly_period_start=None), "MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED"),
            (limits(monthly_usage_before_tracking=None), "MARKET_ACCOUNT_PRIOR_USAGE_UNCONFIGURED"),
            (limits(metered=True, monthly_allowance=None), "MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED"),
            (limits(metered=True, monthly_period_start=None), "MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED"),
            (limits(metered=True, monthly_usage_before_tracking=None), "MARKET_ACCOUNT_PRIOR_USAGE_UNCONFIGURED"),
        ):
            with self.subTest(reason=reason):
                budget = self.budget(account_limits=config, account=market_account_key(reason), case=str(uuid4()))
                self.denied(budget, reason)
                self.assertEqual(budget.snapshot()["totalAttempts"], 0)
        metered = self.budget(account=market_account_key("metered"), case=str(uuid4()), account_limits=limits(metered=True))
        metered.reserve_attempt("active_inventory")
        self.assertEqual(metered.snapshot()["monthlyRoutineLimit"], 800)

    def test_duplicate_reservation_cannot_authorize_an_uncounted_http_attempt(self):
        budget = self.budget()
        token = str(uuid4())
        budget.reserve_attempt("active_inventory", reservation_id=token)
        self.denied(budget, "MARKET_ATTEMPT_ALREADY_RESERVED", reservation_id=token)
        self.assertEqual(budget.snapshot()["totalAttempts"], 1)

    def test_charges_are_separate_and_unknown_endpoints_remain_unpriced(self):
        budget = self.budget(account_limits=limits(confirmed_tariff_usd_per_attempt={"active_inventory": "0.006"}))
        budget.reserve_attempt("active_inventory")
        budget.report_response(500)
        budget.reserve_attempt("active_inventory")
        self.assertEqual(budget.snapshot()["estimatedBillableUsd"], "0.012000")
        budget.reserve_attempt("vin_history", vin=VIN)
        usage = budget.snapshot()
        self.assertIsNone(usage["estimatedBillableUsd"])
        self.assertEqual(usage["estimatedPricedAttemptsUsd"], "0.012000")
        self.assertEqual((usage["pricedAttempts"], usage["unpricedAttempts"]), (2, 1))

    def test_no_raw_vin_or_provider_secret_is_sent_to_ledger(self):
        gateway = Mock(spec=MemoryMarketRequestGateway)
        gateway.reserve_market_request_attempt.side_effect = lambda p: self.gateway.reserve_market_request_attempt(p)
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW,
                                     job_id=JOB, processing_token=PROCESSING_TOKEN)
        budget.reserve_attempt("https://api.marketcheck.com/v2/history/car/" + VIN, vin=VIN)
        payload = gateway.reserve_market_request_attempt.call_args.args[0]
        self.assertNotIn(VIN, json.dumps(payload))
        self.assertEqual(len(payload["vinKey"]), 64)

    def test_uncertain_gateway_never_falls_back_to_unaccounted_requests(self):
        gateway = Mock(spec=MemoryMarketRequestGateway)
        gateway.reserve_market_request_attempt.side_effect = RuntimeError("unavailable")
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW)
        self.denied(budget, "MARKET_REQUEST_ACCOUNTING_UNAVAILABLE")
        gateway.reserve_market_request_attempt.assert_called_once()

    def test_environment_requires_explicit_limits_and_accepts_zero_prior_usage(self):
        parsed = MarketAccountLimits.from_environment({
            "MARKETCHECK_MONTHLY_REQUEST_ALLOWANCE": "1000",
            "MARKETCHECK_RATE_LIMIT_REQUESTS": "5", "MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS": "1",
            "MARKETCHECK_QUOTA_PERIOD_START": "2026-09-01T00:00:00Z",
            "MARKETCHECK_QUOTA_PERIOD_END": "2026-10-01T00:00:00Z",
            "MARKETCHECK_MONTHLY_USAGE_BEFORE_TRACKING": "0",
        })
        self.assertIsNone(parsed.configuration_reason(NOW))
        with self.assertRaises(ValueError):
            MarketAccountLimits.from_environment({"MARKETCHECK_ACCOUNT_METERED": "probably"})
        policy = MarketRequestPolicy.from_environment({
            "MARKETCHECK_BUDGET_ACTIVE_DISCOVERY_ATTEMPTS": "0",
            "MARKETCHECK_BUDGET_TOTAL_ATTEMPTS": "40",
        })
        self.assertEqual((policy.total_attempts, policy.active_discovery_attempts), (40, 0))


class MarketAccountingGatewayTests(unittest.TestCase):
    def test_rpc_is_service_only_and_uncertain_reservation_is_not_retried(self):
        recorded = []
        def handle(request):
            recorded.append(request)
            raise httpx.ReadTimeout("uncertain", request=request)
        client = httpx.Client(transport=httpx.MockTransport(handle))
        configuration = SupabaseServerConfiguration(url="https://project.supabase.co",
            publishable_key="fixture-public-key", service_role_key="fixture-service-key")
        gateway = SupabaseHttpGateway(configuration, client=client)
        budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW,
                                     job_id=JOB, processing_token=PROCESSING_TOKEN)
        with self.assertRaises(MarketRequestBudgetExceeded):
            budget.reserve_attempt("active_inventory")
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0].url.path, "/rest/v1/rpc/reserve_market_request_attempt")
        self.assertEqual(recorded[0].headers["authorization"], "Bearer fixture-service-key")
        self.assertEqual(set(json.loads(recorded[0].content)), {"requested"})
        self.assertEqual(json.loads(recorded[0].content)["requested"]["executionFence"],
                         {"jobId": JOB, "processingToken": PROCESSING_TOKEN})
        client.close()

    def test_hosted_gateway_requires_fence_before_accounting_or_provider_http(self):
        from venfour.marketcheck import MarketCheckProvider
        from tests.test_marketcheck_historical import RecordingTransport, make_request
        accounting_calls = []
        def handle(request):
            accounting_calls.append(request)
            return httpx.Response(500)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co",
                publishable_key="fixture-public-key", service_role_key="fixture-service-key"), client=client)
            budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW)
            transport = RecordingTransport([])
            provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
            with self.assertRaises(MarketRequestBudgetExceeded):
                provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(accounting_calls, [])
        self.assertEqual(transport.calls, [])

    def test_rejected_execution_lease_authorizes_no_provider_http(self):
        from venfour.marketcheck import MarketCheckProvider
        from tests.test_marketcheck_historical import RecordingTransport, make_request
        accounting_calls = []
        def handle(request):
            accounting_calls.append(request)
            return httpx.Response(200, json={"allowed": False,
                "reasonCode": "MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE", "retryAfterSeconds": None})
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co",
                publishable_key="fixture-public-key", service_role_key="fixture-service-key"), client=client)
            budget = MarketRequestBudget(gateway, ACCOUNT, CASE, account_limits=limits(), clock=lambda: NOW,
                                         job_id=JOB, processing_token=PROCESSING_TOKEN)
            transport = RecordingTransport([])
            provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
            with self.assertRaises(MarketRequestBudgetExceeded) as caught:
                provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(caught.exception.reason_code, "MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE")
        self.assertEqual(len(accounting_calls), 1)
        self.assertEqual(transport.calls, [])

    def test_partial_or_malformed_execution_identity_is_rejected(self):
        for job_id, processing_token in ((JOB, None), (None, PROCESSING_TOKEN), (JOB, "invalid")):
            with self.subTest(job_id=job_id, processing_token=processing_token), self.assertRaises(ValueError):
                MarketRequestBudget(MemoryMarketRequestGateway(), ACCOUNT, CASE, account_limits=limits(),
                                    job_id=job_id, processing_token=processing_token)


if __name__ == "__main__":
    unittest.main()
