import unittest

from venfour.search_geography import SearchGeography, distance_miles


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


if __name__ == "__main__":
    unittest.main()
