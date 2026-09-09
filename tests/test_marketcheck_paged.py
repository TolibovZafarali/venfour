"""Offline discovery, bounded verification, and physical-attempt accounting."""

from __future__ import annotations

import copy
import io
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from urllib.error import HTTPError

from venfour.market import MarketContractError, MarketProviderRateLimitError
from venfour.market_request_budget import (
    MarketAccountLimits, MarketRequestBudget, MarketRequestBudgetExceeded,
    MarketRequestPolicy, MemoryMarketRequestGateway, market_account_key,
)
from venfour.marketcheck import (
    MARKETCHECK_ACTIVE_INVENTORY_URL, MARKETCHECK_PAST_INVENTORY_URL,
    MarketCheckHistoricalProvider, MarketCheckProvider,
)
from tests.test_marketcheck_historical import (
    AS_OF_DATE, EVIDENCE_DATE, RecordingTransport, make_candidate,
    make_candidate_page, make_history, make_history_for_candidate, make_request,
)


class MarketCheckPagedTests(unittest.TestCase):
    def provider(self, responses, *, historical=True, budget=None):
        transport = RecordingTransport(responses)
        provider = (MarketCheckHistoricalProvider("fixture-key", as_of_date=AS_OF_DATE,
                    transport=transport, request_budget=budget) if historical else
                    MarketCheckProvider("fixture-key", transport=transport, request_budget=budget))
        return provider, transport

    def test_one_page_preserves_all_candidates_without_history_fanout(self):
        records = [make_candidate(index) for index in range(50)]
        provider, transport = self.provider([make_candidate_page(records, 200)])
        result = provider.discover_page(make_request())
        self.assertEqual(len(result.observations), 50)
        self.assertTrue(result.has_more)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(transport.calls[0]["endpoint"], MARKETCHECK_PAST_INVENTORY_URL)
        self.assertEqual(transport.calls[0]["params"]["sort_by"], "dist")
        self.assertEqual(transport.calls[0]["params"]["sort_order"], "asc")
        self.assertFalse(result.observations[0]["dateVerified"])

    def test_alternate_center_preserves_original_request_and_filters(self):
        request = make_request(radius_miles=100)
        provider, transport = self.provider([make_candidate_page([], 0)])
        provider.discover_page(request, center={"latitude": 38.5, "longitude": -90.7}, start=50)
        params = transport.calls[0]["params"]
        self.assertNotIn("zip", params)
        self.assertEqual((params["latitude"], params["longitude"]), ("38.5", "-90.7"))
        self.assertEqual(request.postal_code, "63026")
        self.assertEqual((params["year"], params["trim"], params["radius"]), (2024, "SEL", 100))
        self.assertEqual(params["active_inventory_date_range"], "20260519-20260519")

    def test_price_sort_is_explicitly_supporting_on_both_endpoints(self):
        for historical in (False, True):
            provider, transport = self.provider([make_candidate_page([make_candidate()], 1)], historical=historical)
            request = make_request() if historical else make_request().to_market_search_request()
            result = provider.discover_page(request, supporting=True)
            self.assertEqual(transport.calls[0]["params"]["sort_by"], "price")
            self.assertEqual(transport.calls[0]["params"]["sort_order"], "desc")
            self.assertEqual(result.observations[0]["purpose"], "supporting")

    def test_verification_uses_selected_history_price_mileage_and_location(self):
        raw = make_candidate(dist=2)
        raw["dealer"].update(latitude=1, longitude=2)
        raw["build"].update(body_type="Sedan", engine="2.0L I4")
        history = make_history(price=25000, miles=40000, latitude="38.51", longitude="-90.61")
        provider, transport = self.provider([make_candidate_page([raw], 1), [history]])
        page = provider.discover_page(make_request())
        batch = provider.verify_historical_candidates(make_request(), page.listings, observations=page.observations)
        observation = batch.observations[0]
        self.assertEqual(observation["listing"]["price"], 25000)
        self.assertEqual(observation["listing"]["mileage"], 40000)
        self.assertIsNone(observation["listing"]["distanceMiles"])
        self.assertEqual(observation["location"]["latitude"], 38.51)
        self.assertEqual(observation["location"]["source"], "HISTORY_RECORD")
        self.assertEqual(observation["materialFacts"]["engine"], "2.0L I4")
        self.assertEqual(observation["historicalEvidence"], batch.result.evidence[0].to_dict())
        self.assertIn("latitude", transport.calls[1]["params"]["fields"])
        self.assertTrue(observation["dateVerified"])
        self.assertEqual(observation["relevantDate"], EVIDENCE_DATE)

    def test_missing_history_location_does_not_inherit_candidate_coordinates(self):
        raw = make_candidate()
        raw["dealer"].update(latitude=38.51, longitude=-90.61)
        history = make_history()
        history["id"] = raw["id"]
        for field in ("city", "state", "zip"):
            history.pop(field)
        provider, _ = self.provider([make_candidate_page([raw], 1), [history]])
        page = provider.discover_page(make_request())
        batch = provider.verify_historical_candidates(make_request(), page.listings)
        self.assertIsNone(batch.observations[0]["location"]["latitude"])
        self.assertIsNone(batch.observations[0]["location"]["postalCode"])
        self.assertIsNone(batch.result.evidence[0].listing.distance_miles)

    def test_full_three_history_pages_remain_unresolved_even_with_matching_row(self):
        full_page = [make_history_for_candidate(index, candidate_index=0) for index in range(50)]
        provider, transport = self.provider([make_candidate_page([make_candidate()], 1),
                                             full_page, copy.deepcopy(full_page), copy.deepcopy(full_page)])
        page = provider.discover_page(make_request())
        batch = provider.verify_historical_candidates(make_request(), page.listings)
        self.assertEqual(len(transport.calls), 4)
        self.assertEqual(batch.result.evidence, ())
        self.assertEqual(batch.result.issues[0].reason, "PAGINATION_SAFETY_LIMIT_REACHED")

    def test_conflicting_history_prices_are_not_resolved_to_the_higher_price(self):
        provider, _ = self.provider([make_candidate_page([make_candidate()], 1),
                                    [make_history(price=20000), make_history(price=40000)]])
        page = provider.discover_page(make_request())
        batch = provider.verify_historical_candidates(make_request(), page.listings)
        self.assertEqual(batch.result.evidence, ())
        self.assertEqual(batch.result.issues[0].status, "AMBIGUOUS")

    def test_later_history_failure_preserves_prior_verified_batch_evidence(self):
        records = [make_candidate(0), make_candidate(1)]
        provider, transport = self.provider([make_candidate_page(records, 2), [make_history(0)],
                                             TimeoutError(), TimeoutError()])
        page = provider.discover_page(make_request())
        with patch("venfour.marketcheck.sleep"):
            batch = provider.verify_historical_candidates(make_request(), page.listings)
        self.assertEqual(len(batch.result.evidence), 1)
        self.assertEqual(len(batch.observations), 1)
        self.assertIsNotNone(batch.failure)
        self.assertEqual(len(transport.calls), 4)

    def test_repeated_verification_reuses_one_vin_history_fetch(self):
        provider, transport = self.provider([make_candidate_page([make_candidate()], 1), [make_history()]])
        page = provider.discover_page(make_request())
        provider.verify_historical_candidates(make_request(), page.listings)
        again = provider.verify_historical_candidates(make_request(), page.listings, supporting=True)
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(again.observations[0]["purpose"], "supporting")

    def test_invalid_geography_and_page_size_make_no_requests(self):
        provider, transport = self.provider([])
        for arguments in ({"rows": 51}, {"rows": True}, {"start": -1}, {"center": {"latitude": 91, "longitude": 0}}):
            with self.assertRaises(MarketContractError):
                provider.discover_page(make_request(), **arguments)
        self.assertEqual(transport.calls, [])

    def test_absent_or_malformed_equipment_remains_unknown(self):
        for value, expected in ((None, None), (["Package", {}], None), ([], []), (["  Package  "], ["Package"])):
            row = make_candidate()
            if value is not None:
                row["build"]["options_packages"] = value
            provider, _ = self.provider([make_candidate_page([row], 1)])
            observation = provider.discover_page(make_request()).observations[0]
            self.assertEqual(observation["materialFacts"]["equipment"], expected)
            self.assertIsNone(observation["materialFacts"]["warranty"])


class MarketCheckAttemptBudgetTests(unittest.TestCase):
    def budget(self, *, policy=None):
        now = datetime(2026, 9, 9, tzinfo=UTC)
        clock = lambda: now
        return MarketRequestBudget(MemoryMarketRequestGateway(clock=clock), market_account_key("fixture-account"),
                                   "10000000-0000-4000-8000-000000000001", policy=policy,
                                   account_limits=MarketAccountLimits(metered=True, max_requests_per_window=100,
                                                                      rate_window_seconds=1), clock=clock)

    def test_retry_and_failure_both_consume_attempts_at_transport_boundary(self):
        budget = self.budget()
        transport = RecordingTransport([TimeoutError(), make_candidate_page([], 0)])
        provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
        with patch("venfour.marketcheck.sleep"):
            provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(budget.snapshot()["totalAttempts"], 2)
        self.assertEqual(len(transport.calls), 2)

    def test_denied_retry_does_not_issue_unaccounted_http_request(self):
        budget = self.budget(policy=MarketRequestPolicy(total_attempts=1))
        transport = RecordingTransport([TimeoutError()])
        provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
        with patch("venfour.marketcheck.sleep"), self.assertRaises(MarketRequestBudgetExceeded):
            provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(budget.snapshot()["totalAttempts"], 1)

    def test_supporting_discovery_subbudget_is_inside_case_budget(self):
        budget = self.budget()
        transport = RecordingTransport([make_candidate_page([], 0), make_candidate_page([], 0)])
        provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
        for _ in range(2):
            provider.discover_page(make_request().to_market_search_request(), supporting=True)
        with self.assertRaises(MarketRequestBudgetExceeded):
            provider.discover_page(make_request().to_market_search_request(), supporting=True)
        self.assertEqual(budget.snapshot()["totalAttempts"], 2)
        self.assertEqual(len(transport.calls), 2)

    def test_long_retry_after_records_throttle_without_early_retry(self):
        budget = self.budget()
        error = HTTPError(MARKETCHECK_ACTIVE_INVENTORY_URL, 429, "throttle", {"Retry-After": "120"}, io.BytesIO())
        transport = RecordingTransport([error])
        provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
        with patch("venfour.marketcheck.sleep") as sleep, self.assertRaises(MarketProviderRateLimitError):
            provider.discover_page(make_request().to_market_search_request())
        sleep.assert_not_called()
        with self.assertRaises(MarketRequestBudgetExceeded) as blocked:
            provider.discover_page(make_request().to_market_search_request())
        self.assertEqual(blocked.exception.reason_code, "MARKET_ACCOUNT_THROTTLED")
        self.assertEqual(len(transport.calls), 1)

    def test_history_retry_consumes_per_vin_allowance_and_preserves_unresolved_state(self):
        budget = self.budget()
        vin = "1HGCM82633A004352"
        row = make_candidate(vin=vin)
        full_page = [make_history_for_candidate(index, candidate_index=0, vin=vin) for index in range(50)]
        transport = RecordingTransport([make_candidate_page([row], 1), TimeoutError(), full_page, full_page])
        provider = MarketCheckHistoricalProvider("fixture-key", as_of_date=AS_OF_DATE,
                                                 transport=transport, request_budget=budget)
        page = provider.discover_page(make_request())
        with patch("venfour.marketcheck.sleep"):
            batch = provider.verify_historical_candidates(make_request(), page.listings)
        self.assertEqual(batch.result.evidence, ())
        self.assertEqual(batch.failure.reason_code, "MARKET_VIN_HISTORY_BUDGET_EXHAUSTED")
        self.assertEqual(budget.snapshot()["totalAttempts"], 4)
        self.assertEqual(len(transport.calls), 4)

    def test_rate_window_waits_without_counting_denied_reservations(self):
        moments = [datetime(2026, 9, 9, tzinfo=UTC)]
        clock = lambda: moments[0]
        budget = MarketRequestBudget(MemoryMarketRequestGateway(clock=clock), market_account_key("paced-fixture"),
                                     "10000000-0000-4000-8000-000000000001",
                                     account_limits=MarketAccountLimits(metered=True, max_requests_per_window=2,
                                                                        rate_window_seconds=1), clock=clock)
        transport = RecordingTransport([make_candidate_page([], 0)] * 3)
        provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
        def advance(seconds):
            moments[0] += timedelta(seconds=seconds)
        with patch("venfour.marketcheck.sleep", side_effect=advance) as pause:
            for _ in range(3):
                provider.discover_page(make_request().to_market_search_request())
        pause.assert_called_once_with(1.0)
        self.assertEqual(budget.snapshot()["totalAttempts"], 3)
        self.assertEqual(len(transport.calls), 3)


if __name__ == "__main__":
    unittest.main()
