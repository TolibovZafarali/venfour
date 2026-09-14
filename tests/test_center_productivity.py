"""Offline regression coverage for shared-center productivity and accounting."""

import copy
import math
from types import SimpleNamespace
import unittest

from tests import test_efficient_search as fixtures
from tests.test_adaptive_discovery_coverage import fictional_markets, run_market
from venfour.efficient_search import EfficientMarketSearch, EfficientSearchPolicy, replay_efficient_search
from venfour.search_geography import EARTH_RADIUS_MILES, SearchGeography, distance_miles


def engine_for_centers(*, strategy="3", maximum_radius=100):
    _, markets = fictional_markets()
    geography = SearchGeography(postal_centroids={"63026": fixtures.ORIGIN}, market_centers=markets)
    provider = SimpleNamespace(maximum_search_radius_miles=maximum_radius)
    engine = EfficientMarketSearch(current_provider=provider, historical_provider=provider,
                                   budget=None, geography=geography, _strategy_version=strategy)
    engine.origin = geography.origin("63026")
    engine.market_geography = geography
    engine.centers = [{**engine.origin, "radiusMiles": 100}, *markets]
    return engine


def branch(center_id, page, eligible, attempts=1, **extra):
    return {"centerId": center_id, "page": page, "newEligibleCandidates": eligible,
            "physicalAttempts": attempts, "usefulCandidatesPerAttempt": eligible / attempts, **extra}


class CenterProductivityTests(unittest.TestCase):
    def test_counterpart_center_ranking_aggregates_productive_and_duplicate_pages(self):
        engine = engine_for_centers()
        weak, productive = engine.centers[1:3]
        engine.branch_state["historical"] = [
            branch(weak["id"], 0, 1),
            branch(productive["id"], 0, 30),
            branch(productive["id"], 1, 0),
        ]
        self.assertEqual(engine._next_center("current")["id"], productive["id"])
        # Page traversal order cannot convert an aggregate into a last-page score.
        engine.branch_state["historical"].reverse()
        self.assertEqual(engine._next_center("current")["id"], productive["id"])
        engine.stream_centers_used["current"].add(productive["id"])
        self.assertEqual(engine._next_center("current")["id"], weak["id"])

    def test_retry_cost_is_part_of_center_yield(self):
        engine = engine_for_centers()
        costly, efficient = engine.centers[1:3]
        engine.branch_state["historical"] = [
            branch(costly["id"], 0, 15, attempts=3),
            branch(efficient["id"], 0, 6),
        ]
        self.assertEqual(engine._next_center("current")["id"], efficient["id"])

    def test_prices_and_insurer_offer_do_not_affect_counterpart_market_choice(self):
        engine = engine_for_centers()
        weak, productive = engine.centers[1:3]
        engine.branch_state["historical"] = [branch(weak["id"], 0, 1), branch(productive["id"], 0, 3)]
        before = engine._next_center("current")
        changed = copy.deepcopy(engine.branch_state["historical"])
        for index, item in enumerate(changed):
            item.update(askingPrice=500_000 - index * 100_000, insurerOffer=1 + index * 900_000)
        engine.branch_state["historical"] = changed
        engine.origin["insurerOffer"] = 999_999
        self.assertEqual(engine._next_center("current"), before)

    def test_legacy_replay_keeps_original_center_order(self):
        engine = engine_for_centers(strategy="2")
        first, productive = engine.centers[1:3]
        engine.branch_state["historical"] = [branch(first["id"], 0, 0), branch(productive["id"], 0, 30)]
        self.assertEqual(engine._next_center("current")["id"], first["id"])

    def test_shared_center_radius_respects_the_receiving_provider_limit(self):
        engine = engine_for_centers(maximum_radius=80)
        center = engine._next_center("current")
        self.assertEqual(center["radiusMiles"], 80)
        self.assertLessEqual(distance_miles(engine.origin, center) + center["radiusMiles"], 250)
        self.assertEqual(engine.centers[1]["radiusMiles"], 100)

    def test_selected_kona_center_circumferences_are_within_customer_boundary(self):
        geography = SearchGeography()
        origin = geography.origin("63123")
        used = [{**origin, "radiusMiles": 100}]
        for _ in range(4):
            center = geography.next_center(origin, used, endpoint_radius_miles=100, outer_boundary_miles=250)
            lat, lon = map(math.radians, (center["latitude"], center["longitude"]))
            angular = center["radiusMiles"] / EARTH_RADIUS_MILES
            for heading in range(0, 360, 10):
                bearing = math.radians(heading)
                target_lat = math.asin(math.sin(lat) * math.cos(angular)
                                      + math.cos(lat) * math.sin(angular) * math.cos(bearing))
                target_lon = lon + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat),
                                              math.cos(angular) - math.sin(lat) * math.sin(target_lat))
                point = {"latitude": math.degrees(target_lat), "longitude": math.degrees(target_lon)}
                self.assertLessEqual(distance_miles(origin, point), 250)
            used.append(center)

    def test_one_remaining_observation_slot_does_not_invent_a_historical_attempt(self):
        transport = fixtures.FixtureTransport(current=[fixtures.candidate(index) for index in range(8)])
        result, budget = run_market(transport, policy=EfficientSearchPolicy(max_observations=9))
        discovery_events = [event for event in result.transcript["events"]
                            if event["operation"]["kind"] == "discovery"]
        branches = result.transcript["branches"]
        self.assertEqual(len(branches["historical"]), 1)
        self.assertEqual(sum(len(values) for values in branches.values()), len(discovery_events))
        self.assertEqual(sum(row["physicalAttempts"] for values in branches.values() for row in values),
                         budget.snapshot()["totalAttempts"])
        self.assertEqual(budget.snapshot()["totalAttempts"], len(transport.calls))
        self.assertEqual(result.transcript["stopReasons"]["historical"], "OBSERVATION_LIMIT")
        self.assertEqual(replay_efficient_search(result.transcript).transcript, result.transcript)


if __name__ == "__main__":
    unittest.main()
