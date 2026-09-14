import math
import unittest

from venfour.search_geography import (
    COVERAGE_CENTER_SELECTOR,
    EARTH_RADIUS_MILES,
    LEGACY_CENTER_SELECTOR,
    MINIMUM_NOVEL_CIRCLE_FRACTION,
    MINIMUM_NOVEL_FULL_RADIUS_FRACTION,
    SearchGeography,
    coverage_metrics,
    distance_miles,
)


def market(identifier, east_miles, north_miles=0, *, metro=False, **extra):
    return {"id": identifier, "label": identifier + (" Metro Area" if metro else " Micro Area"),
            "latitude": math.degrees(north_miles / EARTH_RADIUS_MILES),
            "longitude": math.degrees(east_miles / EARTH_RADIUS_MILES), **extra}


class SearchGeographyTests(unittest.TestCase):
    def test_customer_distance_is_independent_of_query_center(self):
        geo = SearchGeography(postal_centroids={"00001": [38.0, -90.0], "00002": [38.0, -88.0]}, market_centers=[])
        origin = geo.origin("00001")
        listing = geo.locate({"postalCode": "00002"})
        self.assertGreater(distance_miles(origin, listing), 100)
        self.assertEqual(listing["precision"], "POSTAL_AREA_APPROXIMATION")
        self.assertIsNone(geo.locate({"postalCode": "99999"}))
        self.assertIsNone(geo.locate({"latitude": 38, "longitude": -90, "ambiguous": True}))
        self.assertIsNotNone(geo.locate({"postalCode": "00002-1234"}))
        self.assertIsNone(geo.locate({"postalCode": "00001 / 00002"}))
        self.assertIsNone(geo.locate({"postalCode": "00002unknown"}))

    def test_centers_are_distinct_nearby_and_queries_stay_inside_boundary(self):
        markets = [{"id": str(i), "label": str(i), "latitude": 38, "longitude": lon}
                   for i, lon in enumerate((-89.9, -88.5, -87, -85, -91.7))]
        geo = SearchGeography(postal_centroids={"00001": [38, -90]}, market_centers=markets)
        origin = geo.origin("00001")
        used = [origin]
        while (center := geo.next_center(origin, used, endpoint_radius_miles=100, outer_boundary_miles=250)):
            self.assertLessEqual(center["radiusMiles"] + center["distanceFromCustomerMiles"], 250)
            self.assertNotIn(center["id"], [row["id"] for row in used])
            used.append(center)
        self.assertGreater(len(used), 1)
        self.assertEqual(geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250), used[1])

    def test_packaged_dataset_has_known_locations(self):
        geo = SearchGeography()
        origin = geo.origin("63026")
        self.assertIsNotNone(origin)
        self.assertIsNotNone(geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250))

    def test_legacy_selector_preserves_recorded_kona_center_order(self):
        geo = SearchGeography()
        origin = geo.origin("63123")
        used = [origin]
        for identifier in ("cbsa:16060", "cbsa:27620", "cbsa:44100", "cbsa:16460"):
            center = geo.next_center(origin, used, endpoint_radius_miles=100, outer_boundary_miles=250,
                                     selector_version=LEGACY_CENTER_SELECTOR)
            self.assertEqual(center["id"], identifier)
            used.append(center)

    def test_sparse_expansion_supplies_four_materially_new_markets(self):
        geo = SearchGeography()
        origin = geo.origin("63123")
        used = [{**origin, "radiusMiles": 100}]
        for identifier in ("cbsa:21780", "cbsa:14010", "cbsa:17860", "cbsa:48460"):
            center = geo.next_center(origin, used, endpoint_radius_miles=100, outer_boundary_miles=250)
            self.assertEqual(center["id"], identifier)
            self.assertGreater(center["distanceFromCustomerMiles"], 120)
            coverage = coverage_metrics(origin, center, used, endpoint_radius_miles=100,
                                        integration_slices=4096)
            self.assertGreaterEqual(coverage["novelFraction"], MINIMUM_NOVEL_CIRCLE_FRACTION)
            self.assertGreaterEqual(coverage["newFullRadiusFraction"], MINIMUM_NOVEL_FULL_RADIUS_FRACTION)
            self.assertLessEqual(center["radiusMiles"] + center["distanceFromCustomerMiles"], 250)
            used.append(center)
        self.assertEqual(len(used), 5)

    def test_small_movements_and_distant_tiny_circles_are_not_useful_expansion(self):
        geo = SearchGeography(postal_centroids={"00001": [0, 0]},
                              market_centers=[market("near", 70), market("far", 220, metro=True)])
        origin = geo.origin("00001")
        self.assertIsNone(geo.next_center(origin, [origin], endpoint_radius_miles=100,
                                         outer_boundary_miles=250))

    def test_metropolitan_classification_is_a_bounded_density_proxy(self):
        markets = [market("a-micro", -140), market("z-metro", 140, metro=True)]
        geo = SearchGeography(postal_centroids={"00001": [0, 0]}, market_centers=markets)
        origin = geo.origin("00001")
        chosen = geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250)
        self.assertEqual(chosen["id"], "z-metro")
        # Market type cannot override the minimum useful-area requirement.
        geo = SearchGeography(postal_centroids={"00001": [0, 0]},
                              market_centers=[market("tiny-metro", 220, metro=True), market("useful-micro", 140)])
        self.assertEqual(geo.next_center(origin, [origin], endpoint_radius_miles=100,
                                        outer_boundary_miles=250)["id"], "useful-micro")

    def test_price_offer_input_order_and_unverified_density_fields_do_not_change_selection(self):
        rows = [market("west", -145), market("east", 140, metro=True), market("north", 0, 130)]
        origin = {"id": "customer", "latitude": 0, "longitude": 0}
        original = SearchGeography(market_centers=rows).next_center(
            origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250)
        changed = [{**row, "price": 999999, "insurerOffer": 1,
                    "population": 9999999, "dealerCount": 999999} for row in reversed(rows)]
        chosen = SearchGeography(market_centers=changed).next_center(
            {**origin, "insurerOffer": 999999}, [origin], endpoint_radius_miles=100, outer_boundary_miles=250)
        self.assertEqual(chosen, original)

    def test_incremental_area_subtracts_union_not_sum_of_overlaps(self):
        origin = {"id": "customer", "latitude": 0, "longitude": 0}
        candidate = {**market("east", 100), "radiusMiles": 100}
        actual = coverage_metrics(origin, candidate, [origin], endpoint_radius_miles=100,
                                  integration_slices=8192)
        overlap = 2 * 100 ** 2 * math.acos(0.5) - 0.5 * 100 * math.sqrt(4 * 100 ** 2 - 100 ** 2)
        expected_new = math.pi * 100 ** 2 - overlap
        self.assertAlmostEqual(actual["newAreaSquareMiles"], expected_new, delta=0.05)
        duplicated_prior = coverage_metrics(origin, candidate, [origin, origin], endpoint_radius_miles=100,
                                            integration_slices=8192)
        self.assertEqual(duplicated_prior, actual)
        self.assertEqual(coverage_metrics(origin, candidate, [candidate], endpoint_radius_miles=100)
                         ["newAreaSquareMiles"], 0)

    def test_area_estimate_selection_resolution_matches_fine_audit(self):
        geo = SearchGeography()
        origin = geo.origin("63123")
        used = [origin]
        for _ in range(4):
            center = geo.next_center(origin, used, endpoint_radius_miles=100, outer_boundary_miles=250)
            fast = coverage_metrics(origin, center, used, endpoint_radius_miles=100)
            fine = coverage_metrics(origin, center, used, endpoint_radius_miles=100, integration_slices=8192)
            self.assertAlmostEqual(fast["novelFraction"], fine["novelFraction"], delta=0.001)
            used.append(center)

    def test_excluded_or_already_covered_centers_do_not_repeat(self):
        rows = [market("east", 145, metro=True), market("east-again", 146, metro=True), market("west", -140)]
        geo = SearchGeography(market_centers=rows)
        origin = {"id": "customer", "latitude": 0, "longitude": 0}
        first = geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250)
        second = geo.next_center(origin, [origin, first], endpoint_radius_miles=100, outer_boundary_miles=250)
        self.assertEqual(second["id"], "west")
        self.assertIsNone(geo.next_center(origin, [origin, first], endpoint_radius_miles=100,
                                         outer_boundary_miles=250, excluded_ids=["west"]))

    def test_unrounded_distance_constrains_radius(self):
        geo = SearchGeography(market_centers=[market("outside-full-radius", 150.001, metro=True)])
        origin = {"id": "customer", "latitude": 0, "longitude": 0}
        center = geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250)
        self.assertEqual(center["radiusMiles"], 99)
        self.assertLessEqual(150.001 + center["radiusMiles"], 250)

    def test_unknown_selector_and_invalid_coverage_integration_fail_closed(self):
        origin = {"id": "customer", "latitude": 0, "longitude": 0}
        geo = SearchGeography(market_centers=[])
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            geo.next_center(origin, [origin], endpoint_radius_miles=100, outer_boundary_miles=250,
                            selector_version="guessed")
        with self.assertRaisesRegex(ValueError, "at least 16"):
            coverage_metrics(origin, origin, [], endpoint_radius_miles=100, integration_slices=0)
        self.assertNotEqual(COVERAGE_CENTER_SELECTOR, LEGACY_CENTER_SELECTOR)


if __name__ == "__main__":
    unittest.main()
