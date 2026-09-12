"""Offline full-search fixtures, deterministic replay, and resumed accounting."""

from __future__ import annotations

import copy
import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import patch

from venfour.adaptive_search import adaptive_discover_historical_market_evidence, adaptive_discover_market_listings
from venfour.comparables import comparable_target_from_search_request
from venfour.efficient_search import EfficientMarketSearch, EfficientSearchPolicy, _digest, replay_efficient_search
from venfour.market_request_budget import MarketAccountLimits, MarketRequestBudget, MarketRequestPolicy, MemoryMarketRequestGateway, market_account_key
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.search_geography import SearchGeography
from tests.test_marketcheck_historical import AS_OF_DATE, make_candidate, make_history, make_request


SUBJECT_FACTS = {"bodyType": "Sedan", "engine": "2.0L I4", "fuelType": "Unleaded", "transmission": "Automatic"}
ORIGIN = [38.5, -90.5]


def vin(index):
    return f"1HGCM82633A{index:06d}"


def candidate(index, *, price=None, mileage=50000, latitude=38.5, longitude=-90.5, **changes):
    row = make_candidate(index, vin=vin(index), price=20000 + index * 100 if price is None else price, miles=mileage)
    row["dealer"].update(latitude=latitude, longitude=longitude)
    row["build"].update(body_type="Sedan", engine="2.0L I4", fuel_type="Unleaded", transmission="Automatic", drivetrain="FWD")
    row.update(changes)
    return row


class FixtureTransport:
    def __init__(self, *, current=(), historical=(), centers=None, history_overrides=None):
        self.pools = {"current": list(current), "historical": list(historical)}
        self.centers = centers or {}
        self.rows = {row["vin"]: row for row in [*current, *historical, *(item for values in self.centers.values() for item in values)]}
        self.history_overrides = history_overrides or {}
        self.calls = []
        self.fail_vin = None
        self.fail_discovery_at = None

    def get(self, endpoint, params, headers, timeout):
        self.calls.append({"endpoint": endpoint, "params": dict(params)})
        if "/history/" in endpoint:
            identity = endpoint.rsplit("/", 1)[-1]
            if self.fail_vin == identity:
                raise TimeoutError()
            if identity in self.history_overrides:
                result = self.history_overrides[identity]
            else:
                row = self.rows[identity]
                index = int(identity[-6:])
                result = [make_history(index, vin=identity, price=row["price"], miles=row["miles"],
                                      latitude=row["dealer"].get("latitude"), longitude=row["dealer"].get("longitude"))]
            page = params["page"]
            payload = result[(page - 1) * 50:page * 50]
        else:
            if self.fail_discovery_at == len(self.calls):
                raise TimeoutError()
            stream = "historical" if endpoint.endswith("recents") else "current"
            point = (float(params.get("latitude", ORIGIN[0])), float(params.get("longitude", ORIGIN[1])))
            pool = list(self.centers.get((stream, point), self.pools[stream] if point == tuple(ORIGIN) else []))
            if params.get("sort_by") == "price":
                pool.sort(key=lambda row: row["price"], reverse=True)
            payload = {"num_found": len(pool), "listings": pool[params["start"]:params["start"] + params["rows"]]}
        return json.dumps(payload).encode()


class EfficientSearchTests(unittest.TestCase):
    def run_fixture(self, transport, *, policy=None, request_policy=None, streams=("historical", "current"),
                    markets=(), budget=None, checkpoint=None, saved=None, subject_vin=None, subject_facts=None, readiness_stage="full_review"):
        now = datetime(2026, 8, 10, tzinfo=UTC)
        clock = lambda: now
        budget = budget or MarketRequestBudget(
            MemoryMarketRequestGateway(clock=clock), market_account_key("fixture-account"),
            "10000000-0000-4000-8000-000000000001", policy=request_policy,
            account_limits=MarketAccountLimits(monthly_allowance=1000, max_requests_per_window=1000, rate_window_seconds=1,
                monthly_period_start="2026-08-01T00:00:00Z", monthly_period_end="2026-09-01T00:00:00Z",
                monthly_usage_before_tracking=0), clock=clock)
        current = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget) if "current" in streams else None
        historical = MarketCheckHistoricalProvider("fixture-key", as_of_date=AS_OF_DATE, transport=transport, request_budget=budget) if "historical" in streams else None
        request = make_request(drivetrain="FWD", drivetrain_recorded=True, loss_vehicle_mileage=50000,
                               radius_miles=100, result_limit=50)
        geography = SearchGeography(postal_centroids={"63026": ORIGIN}, market_centers=markets)
        engine = EfficientMarketSearch(current_provider=current, historical_provider=historical, budget=budget,
                                       policy=policy, geography=geography, checkpoint=checkpoint,
                                       resumed_transcript=saved, readiness_stage=readiness_stage)
        with patch("venfour.marketcheck.sleep"):
            result = engine.run(target=comparable_target_from_search_request(request.to_market_search_request()),
                                current_request=request.to_market_search_request() if current else None,
                                historical_request=request if historical else None, observed_date=AS_OF_DATE,
                                subject_facts=SUBJECT_FACTS if subject_facts is None else subject_facts, subject_vin=subject_vin)
        return result, budget

    def assert_replays(self, result):
        replayed = replay_efficient_search(result.transcript)
        self.assertEqual(replayed.transcript, result.transcript)
        self.assertEqual(replayed.current, result.current)
        self.assertEqual(replayed.historical, result.historical)

    def test_free_estimate_uses_unknown_specs_with_limited_precision_and_replay(self):
        result, budget = self.run_fixture(FixtureTransport(current=[candidate(i) for i in range(15)]),
            streams=("current",), subject_facts={}, readiness_stage="free_estimate")
        self.assertGreaterEqual(len(result.current.listings), 9)
        self.assertEqual(result.transcript["baselineStatus"], "LIMITED")
        self.assertEqual(result.supporting["listings"], [])
        self.assertEqual(budget.snapshot()["totalAttempts"], 1)
        self.assert_replays(result)
        from venfour.market_evidence_presentation import project_market_search_context
        self.assertIn("limited", project_market_search_context(result.transcript)["summary"])

    def test_new_strategy_preserves_the_installed_checkpoint_storage_envelope(self):
        checkpoints = []
        result, budget = self.run_fixture(FixtureTransport(current=[candidate(i) for i in range(15)]),
            streams=("current",), checkpoint=checkpoints.append)
        self.assertTrue(checkpoints)
        self.assertTrue(all(c["version"] == "1" and c["input"]["normalizationVersion"] == "2" for c in checkpoints))
        before = budget.snapshot()["totalAttempts"]
        transport = FixtureTransport(current=[candidate(i) for i in range(15)])
        resumed, _ = self.run_fixture(transport, streams=("current",), saved=checkpoints[-1], budget=budget)
        self.assertEqual(resumed.transcript["version"], "2")
        self.assertEqual(resumed.current, result.current)
        self.assertEqual(transport.calls, [])
        self.assertEqual(budget.snapshot()["totalAttempts"], before)
        self.assert_replays(resumed)

    def test_dense_fixture_reduces_53_requests_to_16_with_separate_support(self):
        rows = [candidate(index) for index in range(50)]
        transport = FixtureTransport(current=rows, historical=rows)
        result, budget = self.run_fixture(transport)
        self.assertEqual(budget.snapshot()["totalAttempts"], 16)
        self.assertEqual(len(result.historical.evidence), 9)
        self.assertEqual(len(result.current.listings), 50)
        self.assertEqual(len(result.supporting["listings"]), 3)
        self.assertEqual(budget.snapshot()["phaseAttempts"]["supporting"], 5)
        self.assertTrue(all(row.listing.price <= 20800 for row in result.historical.evidence))
        self.assert_replays(result)
        old_transport = FixtureTransport(current=rows, historical=rows)
        old_current = MarketCheckProvider("fixture-key", transport=old_transport)
        old_historical = MarketCheckHistoricalProvider("fixture-key", as_of_date=AS_OF_DATE, transport=old_transport)
        request = make_request(drivetrain="FWD", drivetrain_recorded=True, loss_vehicle_mileage=50000)
        old_h = adaptive_discover_historical_market_evidence(request, old_historical)
        old_c = adaptive_discover_market_listings(request.to_market_search_request(), old_current)
        self.assertEqual(len(old_transport.calls), 53)
        self.assertEqual((len(old_h.result.evidence), len(old_c.result.listings)), (25, 25))

    def test_replay_preserves_the_final_shared_rate_window_observation(self):
        class MovingWindowGateway(MemoryMarketRequestGateway):
            observations = 0

            def get_market_request_usage(self, request):
                result = super().get_market_request_usage(request)
                self.observations += 1
                # Other cases and elapsed time can change this account-wide value.
                result["rateWindowAttempts"] = self.observations % 7
                return result

        now = datetime(2026, 8, 10, tzinfo=UTC)
        budget = MarketRequestBudget(MovingWindowGateway(clock=lambda: now), market_account_key("moving-window"),
            "10000000-0000-4000-8000-000000000001", clock=lambda: now,
            account_limits=MarketAccountLimits(monthly_allowance=1000, max_requests_per_window=1000,
                rate_window_seconds=1, monthly_period_start="2026-08-01T00:00:00Z",
                monthly_period_end="2026-09-01T00:00:00Z", monthly_usage_before_tracking=0))
        rows = [candidate(index) for index in range(12)]
        result, _ = self.run_fixture(FixtureTransport(current=rows, historical=rows), budget=budget)
        self.assertNotEqual(result.transcript["usageAfter"]["rateWindowAttempts"],
                            result.transcript["events"][-1]["usageAfter"]["rateWindowAttempts"])
        self.assert_replays(result)

    def test_prices_do_not_change_baseline_operations_or_quality(self):
        rows = [candidate(index) for index in range(30)]
        first, _ = self.run_fixture(FixtureTransport(current=rows, historical=rows))
        changed = [candidate(index, price=24000 - index * 30) for index in range(30)]
        second, _ = self.run_fixture(FixtureTransport(current=changed, historical=changed))
        def baseline(result):
            return [event["operation"] for event in result.transcript["events"] if event["operation"]["purpose"] == "baseline"]
        self.assertEqual(baseline(first), baseline(second))
        self.assertEqual(first.transcript["baselineIdentities"], second.transcript["baselineIdentities"])
        self.assertEqual([row["assessment"]["qualityKey"] for row in first.transcript["observations"][:30]],
                         [row["assessment"]["qualityKey"] for row in second.transcript["observations"][:30]])

    def test_current_price_directed_discoveries_cannot_enter_baseline(self):
        rows = [candidate(index) for index in range(50)]
        extra = [candidate(80, price=26000), candidate(81, price=27000), candidate(82, price=50000, mileage=10000)]
        transport = FixtureTransport(current=[*rows, *extra])
        result, budget = self.run_fixture(transport, streams=("current",))
        self.assertEqual(budget.snapshot()["totalAttempts"], 2)
        self.assertEqual(budget.snapshot()["supportingDiscoveryAttempts"], 1)
        self.assertEqual({row.vin for row in result.current.listings}, {row["vin"] for row in rows})
        directed = [row for row in result.transcript["observations"] if row["purpose"] == "supporting"]
        self.assertTrue(any(row["listing"]["vin"] == vin(81) for row in directed))
        self.assertTrue(all(not row["assessment"]["baselineEligible"] for row in directed))
        self.assertFalse(any(row["identity"] == f"vin:{vin(82).lower()}" for row in result.supporting["listings"]))
        self.assert_replays(result)

    def test_optional_historical_conflicts_do_not_change_baseline_issues(self):
        rows = [candidate(index) for index in range(12)]
        rows[-1]["price"] = 24000
        conflicting = [make_history(11, vin=vin(11), price=21000, miles=50000),
                       make_history(11, vin=vin(11), price=24000, miles=50000)]
        transport = FixtureTransport(historical=rows, history_overrides={vin(11): conflicting})
        result, _ = self.run_fixture(transport, streams=("historical",))
        self.assertEqual(len(result.historical.evidence), 9)
        self.assertEqual(result.historical.issues, ())
        self.assertTrue(result.transcript["supportingIssues"])
        self.assertEqual(result.transcript["supportingIssues"][0]["status"], "AMBIGUOUS")
        self.assert_replays(result)

    def test_expensive_inferior_candidate_is_screened_before_history(self):
        rows = [candidate(index) for index in range(12)]
        inferior = candidate(99, price=50000, mileage=150000)
        result, _ = self.run_fixture(FixtureTransport(historical=[inferior, *rows]), streams=("historical",))
        verified = [event["operation"]["identities"] for event in result.transcript["events"] if event["operation"]["kind"] == "verification"]
        self.assertNotIn(f"vin:{vin(99).lower()}", [value for values in verified for value in values])
        self.assertIn(20000, [item.listing.price for item in result.historical.evidence])
        self.assert_replays(result)

    def test_supporting_history_skips_strong_but_materially_different_mileage(self):
        rows = [candidate(index, price=20000) for index in range(9)]
        expensive_far = candidate(99, price=24000, mileage=40000)
        cheaper_close = candidate(98, price=22000, mileage=49000)
        transport = FixtureTransport(historical=[expensive_far, *rows, cheaper_close])
        result, _ = self.run_fixture(transport, streams=("historical",))
        history_vins = [call["endpoint"].rsplit("/", 1)[-1] for call in transport.calls if "/history/" in call["endpoint"]]
        self.assertNotIn(vin(99), history_vins)
        self.assertIn(vin(98), history_vins)
        self.assertEqual({item.listing.vin for item in result.historical.evidence}, {row["vin"] for row in rows})
        self.assertEqual([item["verifiedAskingPrice"] for item in result.supporting["listings"]], [22000])
        observed = next(row for row in result.transcript["observations"] if row["listing"]["vin"] == vin(99))
        self.assertTrue(observed["assessment"]["verificationEligible"])
        self.assertFalse(observed["assessment"]["supportingVerificationEligible"])
        self.assert_replays(result)

    def test_supporting_price_query_mileage_screen_avoids_history_fanout(self):
        rows = [candidate(index, price=20000) for index in range(9)]
        transport = FixtureTransport(historical=[*rows, candidate(99, price=24000, mileage=40000), candidate(98, price=22000, mileage=49000)])
        result, budget = self.run_fixture(transport, streams=("historical",), policy=EfficientSearchPolicy(page_size=9))
        history_vins = [call["endpoint"].rsplit("/", 1)[-1] for call in transport.calls if "/history/" in call["endpoint"]]
        self.assertEqual(budget.snapshot()["supportingDiscoveryAttempts"], 1)
        self.assertNotIn(vin(99), history_vins)
        self.assertIn(vin(98), history_vins)
        self.assertEqual([item["verifiedAskingPrice"] for item in result.supporting["listings"]], [22000])
        self.assert_replays(result)

    def test_same_vin_conflicts_remain_visible_and_do_not_select_highest(self):
        first = candidate(0, price=20000)
        conflicting = candidate(0, price=24000)
        result, _ = self.run_fixture(FixtureTransport(current=[first, conflicting, *[candidate(i) for i in range(1, 10)]]),
                                      streams=("current",))
        self.assertNotIn(vin(0), [row.vin for row in result.current.listings])
        retained = [row for row in result.transcript["observations"] if row["listing"]["vin"] == vin(0)]
        self.assertEqual(len(retained), 2)
        self.assertTrue(all(row["conflicted"] for row in retained))
        self.assert_replays(result)

    def test_subject_vehicle_and_unknown_configuration_are_excluded(self):
        rows = [candidate(index) for index in range(12)]
        rows[1]["build"]["trim"] = None
        rows[2]["build"]["engine"] = None
        result, _ = self.run_fixture(FixtureTransport(current=rows), streams=("current",), subject_vin=vin(0))
        self.assertFalse({vin(0), vin(1), vin(2)} & {row.vin for row in result.current.listings})
        self.assert_replays(result)

    def test_duplicate_heavy_fixture_uses_seven_requests_and_has_no_supporting_pass(self):
        rows = []
        for index in range(50):
            row = candidate(index % 5)
            row["id"] = f"duplicate-{index}"
            rows.append(row)
        transport = FixtureTransport(current=rows, historical=rows)
        result, budget = self.run_fixture(transport)
        self.assertEqual(len(transport.calls), 7)
        self.assertEqual((len(result.historical.evidence), len(result.current.listings)), (5, 5))
        self.assertEqual(result.transcript["baselineStatus"], "LIMITED")
        self.assertEqual(result.supporting["listings"], [])
        self.assertEqual(result.supporting["searchStatus"], "SKIPPED_INSUFFICIENT_BASELINE")
        self.assertEqual(budget.snapshot()["phaseAttempts"]["supporting"], 0)
        self.assert_replays(result)
        legacy = FixtureTransport(current=rows, historical=rows)
        request = make_request(drivetrain="FWD", drivetrain_recorded=True, loss_vehicle_mileage=50000)
        adaptive_discover_historical_market_evidence(request, MarketCheckHistoricalProvider("fixture-key", as_of_date=AS_OF_DATE, transport=legacy))
        adaptive_discover_market_listings(request.to_market_search_request(), MarketCheckProvider("fixture-key", transport=legacy))
        self.assertEqual(len(legacy.calls), 10)

    def test_cross_stream_material_conflict_is_retained_and_limits_baseline(self):
        historical = [candidate(index) for index in range(9)]
        current = candidate(0)
        current["build"]["engine"] = "3.5L V6"
        result, _ = self.run_fixture(FixtureTransport(historical=historical, current=[current]))
        self.assertEqual(len(result.historical.evidence), 8)
        self.assertEqual(result.current.listings, ())
        self.assertEqual(result.transcript["baselineStatus"], "LIMITED")
        retained = [row for row in result.transcript["observations"] if row["listing"]["vin"] == vin(0)]
        self.assertEqual(len(retained), 3)
        self.assertTrue(all(row["conflicted"] for row in retained))
        self.assert_replays(result)

    def test_global_four_center_budget_is_shared_and_existing_centers_reused(self):
        markets = [{"id": str(index), "label": f"Nearby market {index}", "latitude": lat, "longitude": lon}
                   for index, (lat, lon) in enumerate(((39.8, -90.5), (37.2, -90.5), (38.5, -88.8), (38.5, -92.2), (40.3, -89)))]
        result, budget = self.run_fixture(FixtureTransport(), markets=markets)
        self.assertLessEqual(len(result.transcript["centers"]), 5)
        centers = {stream: {event["operation"]["center"]["id"] for event in result.transcript["events"] if event["operation"]["stream"] == stream}
                   for stream in ("current", "historical")}
        self.assertEqual(centers["current"], centers["historical"])
        self.assertEqual(budget.snapshot()["totalAttempts"], 10)
        self.assertEqual(result.transcript["baselineStatus"], "LIMITED")
        self.assert_replays(result)

    def test_alternate_center_distance_is_measured_from_customer(self):
        market = {"id": "nearby", "label": "Nearby market", "latitude": 39.8, "longitude": -90.5}
        rows = [candidate(index, latitude=39.8) for index in range(9)]
        transport = FixtureTransport(centers={("current", (39.8, -90.5)): rows})
        result, _ = self.run_fixture(transport, streams=("current",), markets=[market])
        self.assertTrue(result.current.listings)
        self.assertTrue(all(row.distance_miles > 85 for row in result.current.listings))
        self.assertTrue(all(row.distance_miles != 0 for row in result.current.listings))
        self.assert_replays(result)

    def test_budget_failure_preserves_verified_evidence_and_limited_status(self):
        rows = [candidate(index) for index in range(20)]
        result, budget = self.run_fixture(FixtureTransport(historical=rows), streams=("historical",),
                                          request_policy=MarketRequestPolicy(total_attempts=5))
        self.assertEqual(budget.snapshot()["totalAttempts"], 5)
        self.assertEqual(len(result.historical.evidence), 4)
        self.assertEqual(result.transcript["stopReasons"]["historical"], "BUDGET_OR_QUOTA_LIMITED")
        self.assertEqual(result.transcript["baselineStatus"], "LIMITED")
        self.assert_replays(result)

    def test_failed_batch_resumes_without_recharging_completed_vins(self):
        rows = [candidate(index) for index in range(20)]
        transport = FixtureTransport(historical=rows)
        transport.fail_vin = vin(4)
        snapshots = []
        first, budget = self.run_fixture(transport, streams=("historical",), checkpoint=snapshots.append)
        self.assertEqual(len(first.historical.evidence), 4)
        prior = len(transport.calls)
        transport.fail_vin = None
        second, _ = self.run_fixture(transport, streams=("historical",), budget=budget, saved=snapshots[-1])
        completed_calls = [row for row in transport.calls[prior:] if row["endpoint"].endswith(vin(3))]
        self.assertEqual(completed_calls, [])
        self.assertEqual(len(second.historical.evidence), 9)
        self.assertTrue(any(event.get("priorAttempts") for event in second.transcript["events"]))
        self.assertEqual(budget.snapshot()["totalAttempts"], len(transport.calls))
        self.assert_replays(second)

    def test_observation_limit_is_hard_and_replay_rejects_altered_decisions(self):
        rows = [candidate(index) for index in range(50)]
        result, _ = self.run_fixture(FixtureTransport(current=rows), streams=("current",),
                                      policy=EfficientSearchPolicy(max_observations=12))
        self.assertLessEqual(len(result.transcript["observations"]), 12)
        self.assert_replays(result)
        changed = copy.deepcopy(result.transcript)
        changed["stopReasons"]["current"] = "PROVIDER_FAILURE"
        changed["digest"] = _digest({key: value for key, value in changed.items() if key != "digest"})
        with self.assertRaises(ValueError):
            replay_efficient_search(changed)

    def test_replay_validates_canonical_temporal_proof(self):
        result, _ = self.run_fixture(FixtureTransport(historical=[candidate(index) for index in range(9)]),
                                      streams=("historical",))
        changed = copy.deepcopy(result.transcript)
        verification = next(event for event in changed["events"] if event["operation"]["kind"] == "verification")
        verification["payload"]["result"]["evidence"][0]["temporalEvidence"]["recordFirstSeenAt"] = "2027-01-01"
        changed["digest"] = _digest({key: value for key, value in changed.items() if key != "digest"})
        with self.assertRaises(ValueError):
            replay_efficient_search(changed)


if __name__ == "__main__":
    unittest.main()
