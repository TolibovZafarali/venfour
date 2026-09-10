"""Provider response observations can only tighten shared request accounting."""
from datetime import timedelta
from email.message import Message
from io import BytesIO
from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from uuid import uuid4

from tests.test_market_request_budget import NOW, ACCOUNT, CASE, limits
from venfour.market_request_budget import (
    MarketRequestBudget, MarketRequestBudgetExceeded, MemoryMarketRequestGateway,
    MarketRequestPolicy,
)
from venfour.marketcheck import MarketCheckHttpResponse, MarketCheckProvider, _UrllibMarketCheckTransport


class QuotaHeaderTests(TestCase):
    def setUp(self):
        self.now = NOW
        self.gateway = MemoryMarketRequestGateway(clock=lambda: self.now)
        self.limits = limits(monthly_allowance=500, monthly_usage_before_tracking=200,
                             max_requests_per_window=5, rate_window_seconds=1)
        self.budget = self.worker()
        self.budget.reserve_attempt('active_inventory')

    def worker(self, case=CASE):
        return MarketRequestBudget(self.gateway, ACCOUNT, case, account_limits=self.limits,
                                   clock=lambda: self.now)

    def denied(self, code, case=CASE):
        with self.assertRaises(MarketRequestBudgetExceeded) as caught:
            self.worker(case).reserve_attempt('active_inventory')
        self.assertEqual(caught.exception.reason_code, code)
        return caught.exception

    def test_optimistic_headers_never_raise_capacity_or_lower_prior_usage(self):
        self.budget.report_response(200, headers={
            'Quota-Limit': '5000', 'Quota-Remaining': '4999',
            'Quota-Reset-Time': '2026-10-01T00:00:00Z',
            'RateLimit-Limit': '500', 'RateLimit-Remaining': '499',
        })
        for _ in range(4):
            self.worker().reserve_attempt('active_inventory')
        self.denied('MARKET_ACCOUNT_RATE_LIMIT_REACHED')
        usage = self.worker().snapshot()
        self.assertEqual((usage['monthlyAttempts'], usage['monthlyRoutineLimit']), (205, 400))

    def test_lower_monthly_allowance_or_remaining_stops_other_cases_and_workers(self):
        for headers in ({'Quota-Limit': '400'}, {'Quota-Remaining': '298'}, {'Quota-Remaining': '0'}):
            with self.subTest(headers=headers):
                self.setUp()
                self.budget.report_response(200, headers=headers)
                self.now += timedelta(seconds=10)
                self.denied('MARKET_ACCOUNT_QUOTA_EXHAUSTED', str(uuid4()))
                self.assertEqual(self.worker().snapshot()['monthlyAttempts'], 201)
                self.budget.report_response(200, headers={'Quota-Remaining': '500'})
                self.denied('MARKET_ACCOUNT_QUOTA_EXHAUSTED')

    def test_provider_reset_never_advances_pinned_period(self):
        self.budget.report_response(200, headers={'Quota-Reset-Time': '2026-11-01T00:00:00Z'})
        self.denied('MARKET_ACCOUNT_QUOTA_EXHAUSTED')
        self.assertEqual(self.worker().snapshot()['monthlyAttempts'], 201)

    def test_matching_epoch_reset_is_accepted_without_resetting_usage(self):
        self.budget.report_response(200, headers={'Quota-Reset-Time': '1790812800'})
        self.worker().reserve_attempt('active_inventory')
        self.assertEqual(self.worker().snapshot()['monthlyAttempts'], 202)

    def test_rate_exhaustion_is_shared_cooldown_not_monthly_exhaustion(self):
        self.budget.report_response(429, headers={
            'Quota-Limit': '500', 'Quota-Remaining': '399',
            'RateLimit-Limit': '5', 'RateLimit-Remaining': '0',
            'RateLimit-Reset-Time': (NOW + timedelta(seconds=3)).isoformat(),
            'retry-after': '5',
        })
        self.assertEqual(self.denied('MARKET_ACCOUNT_THROTTLED', str(uuid4())).retry_after_seconds, 5)
        self.now += timedelta(seconds=5)
        self.worker().reserve_attempt('active_inventory')
        self.assertEqual(self.worker().snapshot()['monthlyAttempts'], 202)

    def test_lower_rate_contract_remains_blocked_after_worker_restart(self):
        self.budget.report_response(200, headers={'RateLimit-Limit': '2'})
        self.now += timedelta(seconds=60)
        self.assertGreater(self.denied('MARKET_ACCOUNT_THROTTLED').retry_after_seconds, 60)

    def test_missing_malformed_duplicate_and_unzoned_headers_do_not_weaken_guards(self):
        for bad in ('', '-1', 'nan', 'inf', '500,1', '1e9', '9' * 100, '2026-10-01T00:00:00'):
            self.budget.report_response(200, headers={k: bad for k in (
                'Quota-Limit', 'Quota-Remaining', 'Quota-Reset-Time',
                'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset-Time')})
        duplicate = Message(); duplicate['Quota-Limit'] = '500'; duplicate['quota-limit'] = '1'
        self.budget.report_response(200, headers=duplicate)
        self.budget.report_response(200)
        self.assertEqual(self.worker().snapshot()['monthlyAttempts'], 201)
        self.budget.report_response(429, headers={'Retry-After': 'bad', 'RateLimit-Reset-Time': 'bad'})
        self.assertEqual(self.denied('MARKET_ACCOUNT_THROTTLED').retry_after_seconds, 1)

    def test_failed_or_invalid_state_write_fails_closed(self):
        for result in ({}, {'recorded': False}, None):
            with patch.object(self.gateway, 'record_market_request_account_state', return_value=result):
                with self.assertRaises(MarketRequestBudgetExceeded) as caught:
                    self.budget.report_response(200, headers={'Quota-Remaining': '0'})
                self.assertEqual(caught.exception.reason_code, 'MARKET_REQUEST_ACCOUNTING_INVALID')
        with patch.object(self.gateway, 'record_market_request_account_state', side_effect=RuntimeError):
            with self.assertRaises(MarketRequestBudgetExceeded) as caught:
                self.budget.report_response(429)
            self.assertEqual(caught.exception.reason_code, 'MARKET_REQUEST_ACCOUNTING_UNAVAILABLE')

    def test_success_headers_reach_budget_before_next_transport(self):
        transport = Mock()
        transport.get.return_value = MarketCheckHttpResponse(b'{"listings": []}', {'Quota-Remaining': '0'})
        provider = MarketCheckProvider('fixture-key', transport=transport, request_budget=self.budget)
        provider._request_json({'api_key': 'fixture-key'})
        with self.assertRaises(MarketRequestBudgetExceeded):
            provider._request_json({'api_key': 'fixture-key'})
        self.assertEqual(transport.get.call_count, 1)

    def test_error_monthly_headers_prevent_retry_transport(self):
        transport = Mock()
        transport.get.side_effect = HTTPError('https://fixture.invalid', 429, 'limited',
                                             {'Quota-Remaining': '0'}, BytesIO(b'{}'))
        provider = MarketCheckProvider('fixture-key', transport=transport, request_budget=self.budget)
        with patch('venfour.marketcheck.sleep'):
            with self.assertRaises(MarketRequestBudgetExceeded):
                provider._request_json({'api_key': 'fixture-key'})
        self.assertEqual(transport.get.call_count, 1)

    def test_native_transport_preserves_headers_without_network(self):
        transport = _UrllibMarketCheckTransport()
        response = Mock(); response.read.return_value = b'{}'; response.headers = {'Quota-Remaining': '399'}
        transport._opener = Mock()
        transport._opener.open.return_value.__enter__ = Mock(return_value=response)
        transport._opener.open.return_value.__exit__ = Mock(return_value=False)
        result = transport.get('https://fixture.invalid', {}, {}, 1)
        self.assertEqual(result, MarketCheckHttpResponse(b'{}', response.headers))

    def test_twenty_attempt_cap_survives_optimistic_response_headers(self):
        policy = MarketRequestPolicy(total_attempts=20, active_discovery_attempts=20)
        gateway = MemoryMarketRequestGateway(clock=lambda: self.now)
        def worker():
            return MarketRequestBudget(gateway, ACCOUNT, CASE, policy=policy, account_limits=self.limits,
                                       clock=lambda: self.now)
        for _ in range(20):
            worker().reserve_attempt('active_inventory')
            worker().report_response(200, headers={'Quota-Limit': '5000', 'Quota-Remaining': '4000'})
            self.now += timedelta(seconds=1)
        with self.assertRaises(MarketRequestBudgetExceeded) as caught:
            worker().reserve_attempt('active_inventory')
        self.assertEqual(caught.exception.reason_code, 'MARKET_CASE_BUDGET_EXHAUSTED')
