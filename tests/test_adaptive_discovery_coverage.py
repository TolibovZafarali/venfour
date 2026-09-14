"""Deterministic fictional markets exercise adaptive discovery without transport."""

import copy
import math
import unittest
from dataclasses import replace

from tests import test_efficient_search as fixtures
from venfour.efficient_search import EfficientSearchPolicy
from venfour.market_request_budget import MarketRequestBudgetExceeded, MarketRequestPolicy
from venfour.search_geography import EARTH_RADIUS_MILES, SearchGeography, distance_miles


CANARY_POLICY = MarketRequestPolicy(
    total_attempts=20, active_discovery_attempts=6, historical_discovery_attempts=6,
    history_attempts=12, enrichment_attempts=1, vehicle_terms_attempts=1,
    supporting_attempts=2, supporting_discovery_attempts=1,
    per_vin_history_attempts=3, optimization_target_min=20, optimization_target_max=20,
)
SEARCH_POLICY = EfficientSearchPolicy(supporting_attempts=2, supporting_discovery_requests=1)


def fictional_markets():
    """Four distinct fictional markets 145 miles from the fixture origin."""
    lat, lon = map(math.radians, fixtures.ORIGIN)
    angular = 145 / EARTH_RADIUS_MILES
    markets = []
    for index, bearing_degrees in enumerate((0, 90, 180, 270), 1):
        bearing = math.radians(bearing_degrees)
        target_lat = math.asin(math.sin(lat) * math.cos(angular)
                               + math.cos(lat) * math.sin(angular) * math.cos(bearing))
        target_lon = lon + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat),
                                      math.cos(angular) - math.sin(lat) * math.sin(target_lat))
        markets.append({"id": f"cbsa:9900{index}", "label": f"Fictional direction {index} Metro Area",
                        "latitude": round(math.degrees(target_lat), 8),
                        "longitude": round(math.degrees(target_lon), 8)})
    geography = SearchGeography(postal_centroids={"63026": fixtures.ORIGIN}, market_centers=markets)
    origin = geography.origin("63026")
    chosen = [{**origin, "radiusMiles": 100}]
    while center := geography.next_center(origin, chosen, endpoint_radius_miles=100, outer_boundary_miles=250):
        chosen.append(center)
    return markets, chosen[1:]


def run_market(transport, *, streams=("historical", "current"), policy=SEARCH_POLICY,
               request_policy=CANARY_POLICY, subject_facts=None, readiness_stage="full_review", **kwargs):
    helper = fixtures.EfficientSearchTests(methodName="runTest")
    markets, _ = fictional_markets()
    result, budget = helper.run_fixture(transport, markets=markets, streams=streams, policy=policy,
        request_policy=request_policy, subject_facts=subject_facts, readiness_stage=readiness_stage, **kwargs)
    return result, budget


def point(center):
    return center["latitude"], center["longitude"]


def local_rows(count, start=0, *, mileage=50_000):
    return [fixtures.candidate(index, mileage=mileage) for index in range(start, start + count)]


def outer_rows(center, count, start=100, *, mileage=50_000):
    return [fixtures.candidate(index, mileage=mileage, latitude=center["latitude"], longitude=center["longitude"])
            for index in range(start, start + count)]


def scenario_transport(name):
    _, centers = fictional_markets()
    if name == "dense_local":
        rows = local_rows(50)
        return fixtures.FixtureTransport(current=rows, historical=rows), ("historical", "current")
    if name == "sparse_local_productive_outer":
        rows = outer_rows(centers[3], 9)
        return fixtures.FixtureTransport(centers={
            (stream, point(centers[3])): rows for stream in ("historical", "current")
        }), ("historical", "current")
    if name == "duplicate_heavy":
        # The shared inventory lies in the overlap between local and first outer
        # circles. It is qualified GOOD, so neither page creates false sufficiency.
        shared = {"latitude": (fixtures.ORIGIN[0] + centers[0]["latitude"]) / 2,
                  "longitude": (fixtures.ORIGIN[1] + centers[0]["longitude"]) / 2}
        rows = outer_rows(shared, 50, mileage=62_000)
        pool = [*rows, *copy.deepcopy(rows[:10])]
        # Historical discovery is configured but empty in this fictional case;
        # overlapping current inventory exercises duplicate-page stopping.
        return fixtures.FixtureTransport(current=rows, centers={("current", point(centers[0])): pool}), ("historical", "current")
    if name == "one_productive_direction":
        rows = outer_rows(centers[1], 3)
        return fixtures.FixtureTransport(centers={
            (stream, point(centers[1])): rows for stream in ("historical", "current")
        }), ("historical", "current")
    if name == "very_rare_trim":
        return fixtures.FixtureTransport(), ("historical", "current")
    if name == "enough_local_matches":
        return fixtures.FixtureTransport(current=local_rows(9)), ("historical", "current")
    raise ValueError("Unknown fictional scenario")


SCENARIOS = ("dense_local", "sparse_local_productive_outer", "duplicate_heavy",
             "one_productive_direction", "very_rare_trim", "enough_local_matches")


def scenario_report(name):
    transport, streams = scenario_transport(name)
    result, budget = run_market(transport, streams=streams)
    usage = budget.snapshot()
    return {
        "scenario": name, "fictional": True, "physicalAttempts": len(transport.calls),
        "configuredStreams": list(streams),
        "ledgerAttempts": usage["totalAttempts"], "operationAttempts": usage["operationAttempts"],
        "supportingAttempts": usage["phaseAttempts"]["supporting"],
        "remainingAttempts": usage["remainingAttempts"], "stopReasons": result.transcript["stopReasons"],
        "actions": [{"kind": event["operation"]["kind"], "purpose": event["operation"]["purpose"],
                     "stream": event["operation"].get("stream", "historical"),
                     "centerId": event["operation"].get("center", {}).get("id"),
                     "pageStart": event["operation"].get("start"),
                     "physicalAttempts": event["usageAfter"]["totalAttempts"] - event["usageBefore"]["totalAttempts"]}
                    for event in result.transcript["events"]],
        "branches": result.transcript["branches"],
    }


class AdaptiveDiscoveryCoverageTests(unittest.TestCase):
    def test_sparse_market_reaches_more_than_three_centers(self):
        transport, streams = scenario_transport("sparse_local_productive_outer")
        result, budget = run_market(transport, streams=streams)
        discovery = [event["operation"] for event in result.transcript["events"] if event["operation"]["kind"] == "discovery"]
        self.assertEqual(len({operation["center"]["id"] for operation in discovery}), 5)
        self.assertTrue(result.historical.evidence or result.current.listings)
        self.assertEqual(result.transcript["stopReasons"]["current"], "OTHER_STREAM_SUFFICIENT")
        self.assertLessEqual(budget.snapshot()["totalAttempts"], 20)

    def test_dense_local_stops_without_expansion_and_probes_current_before_second_history_batch(self):
        transport, streams = scenario_transport("dense_local")
        result, budget = run_market(transport, streams=streams)
        events = [event["operation"] for event in result.transcript["events"]]
        self.assertEqual({operation["center"]["id"] for operation in events if operation["kind"] == "discovery"}, {"customer"})
        current_index = next(index for index, operation in enumerate(events) if operation["kind"] == "discovery" and operation["stream"] == "current")
        history_indices = [index for index, operation in enumerate(events) if operation["kind"] == "verification"]
        self.assertLess(history_indices[0], current_index)
        self.assertLess(current_index, history_indices[1])
        self.assertLess(budget.snapshot()["totalAttempts"], 20)

    def test_enough_local_current_matches_stop_after_both_configured_stream_probes(self):
        report = scenario_report("enough_local_matches")
        self.assertEqual(report["configuredStreams"], ["historical", "current"])
        self.assertEqual(report["physicalAttempts"], 2)
        self.assertEqual({action["centerId"] for action in report["actions"]}, {"customer"})

    def test_duplicate_heavy_centers_abandon_additional_pages(self):
        transport, streams = scenario_transport("duplicate_heavy")
        result, _ = run_market(transport, streams=streams)
        branches = [branch for rows in result.transcript["branches"].values() for branch in rows]
        duplicates = [branch for branch in branches if branch.get("stopReason") == "DUPLICATE_HEAVY"]
        self.assertTrue(duplicates)
        self.assertTrue(all(branch["page"] == 0 for branch in branches))
        self.assertTrue(all(branch["identityOverlapFraction"] == 1 for branch in duplicates))
        self.assertTrue(all(branch["usefulCandidatesPerAttempt"] == 0 for branch in duplicates))

    def test_productive_page_precedes_a_new_center(self):
        rows = local_rows(53)
        for row in rows[3:50]:
            row["build"]["trim"] = "Different trim"
        _, centers = fictional_markets()
        transport = fixtures.FixtureTransport(current=rows, centers={("current", point(centers[0])): outer_rows(centers[0], 9)})
        result, _ = run_market(transport, streams=("current",))
        baseline = [event["operation"] for event in result.transcript["events"] if event["operation"]["purpose"] == "baseline"]
        self.assertEqual([(op["center"]["id"], op["start"]) for op in baseline[:2]], [("customer", 0), ("customer", 50)])
        self.assertNotEqual(baseline[2]["center"]["id"], "customer")

    def test_all_scenarios_keep_discovery_bounded_and_atomic_counts_match_transport(self):
        for name in SCENARIOS:
            with self.subTest(scenario=name):
                report = scenario_report(name)
                operations = report["operationAttempts"]
                self.assertLessEqual(operations["active_discovery"] + operations["historical_discovery"], 12)
                self.assertLessEqual(operations["active_discovery"], 6)
                self.assertLessEqual(operations["historical_discovery"], 6)
                self.assertLessEqual(report["physicalAttempts"], 20)
                self.assertEqual(report["physicalAttempts"], report["ledgerAttempts"])

    def test_sparse_unproductive_search_preserves_capacity_for_other_work(self):
        report = scenario_report("very_rare_trim")
        self.assertEqual(report["operationAttempts"]["vin_history"], 0)
        self.assertGreaterEqual(report["remainingAttempts"], 8)
        self.assertTrue(all(branch["page"] == 0 for rows in report["branches"].values() for branch in rows))

    def test_twenty_first_attempt_cannot_be_reserved(self):
        _, budget = run_market(fixtures.FixtureTransport(), streams=())
        for _ in range(6):
            budget.reserve_attempt("active_inventory")
            budget.reserve_attempt("historical_inventory")
        for index in range(8):
            budget.reserve_attempt("vin_history", vin=fixtures.vin(index))
        self.assertEqual(budget.snapshot()["totalAttempts"], 20)
        with self.assertRaises(MarketRequestBudgetExceeded) as denied:
            budget.reserve_attempt("vin_history", vin=fixtures.vin(99))
        self.assertEqual(denied.exception.reason_code, "MARKET_CASE_BUDGET_EXHAUSTED")
        self.assertEqual(budget.snapshot()["totalAttempts"], 20)

    def test_listing_prices_cannot_change_geography_or_baseline_request_allocation(self):
        first, streams = scenario_transport("sparse_local_productive_outer")
        second, _ = scenario_transport("sparse_local_productive_outer")
        for index, row in enumerate(second.rows.values()):
            row["price"] = 100_000 - index * 1000
        left, left_budget = run_market(first, streams=streams)
        right, right_budget = run_market(second, streams=streams)
        baseline = lambda result: [event["operation"] for event in result.transcript["events"] if event["operation"]["purpose"] == "baseline"]
        self.assertEqual(baseline(left), baseline(right))
        self.assertEqual(left.transcript["centers"], right.transcript["centers"])
        self.assertEqual(left_budget.snapshot()["operationAttempts"], right_budget.snapshot()["operationAttempts"])

    def test_insurer_valuation_cannot_change_adaptive_discovery_decisions(self):
        from tests import test_analysis_runs as analysis_fixtures
        from venfour.efficient_search import EfficientMarketSearch
        from venfour.marketcheck import MarketCheckProvider
        from venfour.orchestration import AnalysisOrchestrator

        class Repository:
            def save(self, artifact):
                self.artifact = artifact

            def get(self, run_id):
                return self.artifact

        transcripts = []
        for offer in (10_000, 40_000):
            _, budget = run_market(fixtures.FixtureTransport(), streams=())
            transport, _ = scenario_transport("one_productive_direction")
            provider = MarketCheckProvider("fixture-key", transport=transport, request_budget=budget)
            markets, _ = fictional_markets()
            search = EfficientMarketSearch(current_provider=provider, historical_provider=None, budget=budget,
                policy=SEARCH_POLICY, geography=SearchGeography(postal_centroids={"63026": fixtures.ORIGIN}, market_centers=markets))
            request = analysis_fixtures.make_run_request(historical=False)
            report = copy.deepcopy(request.ccc_report)
            report["vehicle"].update(make="Hyundai", model="Elantra", drivetrain="FWD", engine="2.0L I4", equipment=[])
            report["valuation"].update(baseVehicleValue=offer + 100, adjustedVehicleValue=offer, total=offer)
            artifact = AnalysisOrchestrator(Repository(), current_provider=provider, market_search=search,
                run_id_factory=lambda: analysis_fixtures.RUN_ID_1, clock=lambda: analysis_fixtures.FIXED_CREATED_AT).run(
                    replace(request, ccc_report=report)).artifact.to_dict()
            self.assertEqual(artifact["result"]["discrepancyResult"]["cccVehicleValuationCents"], offer * 100)
            transcripts.append(artifact["result"]["marketSearch"])
        self.assertEqual([event["operation"] for event in transcripts[0]["events"]],
                         [event["operation"] for event in transcripts[1]["events"]])
        self.assertEqual(transcripts[0]["centers"], transcripts[1]["centers"])
        self.assertEqual(transcripts[0]["branches"], transcripts[1]["branches"])

    def test_selected_centers_and_provider_footprints_stay_inside_customer_boundary(self):
        transport, streams = scenario_transport("very_rare_trim")
        result, _ = run_market(transport, streams=streams)
        origin = result.transcript["origin"]
        for center in result.transcript["centers"][1:]:
            self.assertLessEqual(distance_miles(origin, center) + center["radiusMiles"], 250)
        for rows in result.transcript["branches"].values():
            for branch in rows:
                if branch["centerId"] != "customer" and branch["page"] == 0:
                    self.assertGreaterEqual(branch["geographicNovelty"]["novelFraction"], .55)
                    self.assertGreaterEqual(branch["geographicNovelty"]["newFullRadiusFraction"], .4)

    def test_provider_location_outside_customer_boundary_cannot_enter_baseline(self):
        row = fixtures.candidate(1, latitude=43, longitude=fixtures.ORIGIN[1])
        result, _ = run_market(fixtures.FixtureTransport(current=[row]), streams=("current",))
        self.assertFalse(result.current.listings)
        self.assertIn("OUTSIDE_GEOGRAPHIC_BOUNDARY", result.transcript["observations"][0]["assessment"]["reasonCodes"])

    def test_strategy_three_resumes_across_current_probe_without_repeating_transport(self):
        from venfour.search_progress import MarketSearchInterrupted

        _, budget = run_market(fixtures.FixtureTransport(), streams=())
        transport, streams = scenario_transport("dense_local")
        checkpoints = []

        def interrupt_after_current_probe(checkpoint):
            checkpoints.append(copy.deepcopy(checkpoint))
            events = checkpoint["events"]
            if events and events[-1]["operation"]["kind"] == "discovery" and events[-1]["operation"]["stream"] == "current":
                raise MarketSearchInterrupted()

        with self.assertLogs("venfour.analysis_failure", level="ERROR"), self.assertRaises(MarketSearchInterrupted):
            run_market(transport, streams=streams, budget=budget, checkpoint=interrupt_after_current_probe)
        self.assertEqual(len(transport.calls), 5)
        self.assertEqual(checkpoints[-1]["input"]["discoveryStrategyVersion"], "3")
        resumed_transport, _ = scenario_transport("dense_local")
        resumed, _ = run_market(resumed_transport, streams=streams, budget=budget, saved=checkpoints[-1])
        self.assertFalse(any("/search/" in call["endpoint"] for call in resumed_transport.calls))
        self.assertEqual(len(transport.calls) + len(resumed_transport.calls), budget.snapshot()["totalAttempts"])
        self.assertEqual(len(resumed.historical.evidence), 9)
        replayed = fixtures.replay_efficient_search(resumed.transcript)
        self.assertEqual(replayed.transcript, resumed.transcript)

    def test_observation_limit_does_not_attribute_previous_stream_event_to_a_new_branch(self):
        rows = local_rows(50)
        result, budget = run_market(fixtures.FixtureTransport(current=rows, historical=rows),
            policy=replace(SEARCH_POLICY, max_observations=9))
        self.assertLessEqual(len(result.transcript["observations"]), 9)
        events = [event for event in result.transcript["events"] if event["operation"]["kind"] == "discovery"]
        for stream in ("historical", "current"):
            branch_count = len(result.transcript["branches"][stream])
            event_count = sum(event["operation"]["stream"] == stream for event in events)
            self.assertEqual(branch_count, event_count, stream)
        branch_attempts = sum(branch["physicalAttempts"] for rows in result.transcript["branches"].values() for branch in rows)
        operations = budget.snapshot()["operationAttempts"]
        self.assertEqual(branch_attempts, operations["active_discovery"] + operations["historical_discovery"])
        replayed = fixtures.replay_efficient_search(result.transcript)
        self.assertEqual(replayed.transcript, result.transcript)


if __name__ == "__main__":
    unittest.main()
