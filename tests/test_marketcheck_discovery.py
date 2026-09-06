"""Versioned drivetrain inventory filters at the existing provider boundary."""

import copy
import hashlib
import json
import unittest
from dataclasses import replace

from tests.test_marketcheck import RecordingTransport, SYNTHETIC_KEY, make_raw_listing, make_request
from tests.test_marketcheck_historical import (
    AS_OF_DATE, RecordingTransport as HistoricalTransport, candidate_calls, history_calls,
    make_candidate, make_candidate_page, make_history, make_request as make_historical_request,
)
from venfour.adaptive_search import (
    AdaptiveSearchPolicy, SearchStage, adaptive_discover_historical_market_evidence,
    adaptive_discover_market_listings,
)
from venfour.comparables import comparable_target_from_search_request, rank_market_comparables
from venfour.discrepancy import ValuationDiscrepancyRequest
from venfour.historical_market import historical_evidence_to_market_search_result
from venfour.market import DrivetrainDiscovery, MarketContractError, VehicleConfigurationIdentity
from venfour.marketcheck import (
    MARKETCHECK_ACTIVE_INVENTORY_URL,
    MarketCheckHistoricalProvider, MarketCheckProvider,
)
from venfour.preliminary_resolution import resolve_preliminary_evidence


VINS = ("1HGBH41JXMN109186", "1HGBH41JXMN109187", "1HGBH41JXMN109188")


def active_record(index, drivetrain):
    row = make_raw_listing(index, vin=VINS[index])
    row["build"]["drivetrain"] = drivetrain
    return row


def configured(request, drivetrain):
    return replace(request, drivetrain=drivetrain,
                   drivetrain_discovery=MarketCheckProvider.drivetrain_discovery(drivetrain))


class MarketCheckDiscoveryTests(unittest.TestCase):
    def test_provider_mapping_keeps_exact_values_and_awd_uncertainty(self):
        expected = {
            "FWD": ("EXACT_FILTER", "FWD"), "RWD": ("EXACT_FILTER", "RWD"),
            "4WD": ("EXACT_FILTER", "4WD"), "AWD": ("PROVIDER_MAPPING_UNVERIFIED", None),
            None: ("SUBJECT_DRIVETRAIN_UNKNOWN", None),
        }
        for drivetrain, (status, value) in expected.items():
            with self.subTest(drivetrain=drivetrain):
                self.assertEqual(MarketCheckProvider.drivetrain_discovery(drivetrain).to_dict(),
                                 {"version": "1", "status": status, "filterValue": value})
        with self.assertRaises(MarketContractError):
            MarketCheckProvider.drivetrain_discovery("4x4")

    def test_active_and_past_queries_add_only_the_supported_drive_filter(self):
        active = MarketCheckProvider(SYNTHETIC_KEY, transport=RecordingTransport([]))
        historical = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=HistoricalTransport([]))
        for drivetrain in ("FWD", "RWD", "4WD"):
            for request, params in ((make_request(), active._params), (make_historical_request(), historical._historical_params)):
                with self.subTest(drivetrain=drivetrain, request=type(request).__name__):
                    legacy = replace(request, drivetrain=drivetrain)
                    before = legacy.to_dict()
                    old_params = params(legacy, start=0, rows=25)
                    self.assertNotIn("drivetrain", old_params)
                    self.assertEqual(params(configured(request, drivetrain), start=0, rows=25),
                                     dict(old_params, drivetrain=drivetrain))
                    self.assertEqual(legacy.to_dict(), before)
                    self.assertNotIn("miles_range", old_params)
                    self.assertNotIn("transmission", old_params)
                    self.assertNotIn("engine", old_params)

    def test_unknown_and_unverified_drive_are_explicitly_unfiltered(self):
        active = MarketCheckProvider(SYNTHETIC_KEY, transport=RecordingTransport([]))
        historical = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=HistoricalTransport([]))
        for drivetrain in (None, "AWD"):
            for request, params in ((make_request(), active._params), (make_historical_request(), historical._historical_params)):
                with self.subTest(drivetrain=drivetrain, request=type(request).__name__):
                    request = configured(request, drivetrain)
                    self.assertNotIn("drivetrain", params(request, start=0, rows=10))
                    self.assertIsNone(request.to_dict()["drivetrainDiscovery"]["filterValue"])
                    self.assertEqual(request.to_dict().get("drivetrain"), drivetrain)

    def test_provider_rejects_a_marker_that_claims_an_unverified_mapping(self):
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=RecordingTransport([]))
        for drive, marker in (
            ("AWD", DrivetrainDiscovery(status="EXACT_FILTER", filter_value="AWD")),
            ("FWD", DrivetrainDiscovery(status="PROVIDER_MAPPING_UNVERIFIED")),
            ("FWD", DrivetrainDiscovery(status="EXACT_FILTER", filter_value="4WD")),
        ):
            with self.subTest(drivetrain=drive, status=marker.status):
                request = replace(make_request(), drivetrain=drive, drivetrain_discovery=marker)
                with self.assertRaises(MarketContractError):
                    provider._params(request, start=0, rows=10)

    def test_filtered_active_results_retain_unknown_and_contradictory_fields(self):
        rows = [active_record(index, drive) for index, drive in enumerate(("FWD", "4WD", None))]
        before = copy.deepcopy(rows)
        transport = RecordingTransport([{"num_found": 3, "listings": rows}])
        provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
        request = configured(make_request(), "FWD")
        result = provider.search(request)
        ranking = rank_market_comparables(comparable_target_from_search_request(request), result)
        by_vin = {item.listing.vin: item for item in ranking.candidates}
        self.assertEqual(by_vin[VINS[0]].tier, "STRONG")
        self.assertFalse(by_vin[VINS[1]].eligible)
        self.assertIn("DRIVETRAIN_MISMATCH", by_vin[VINS[1]].reasons)
        self.assertIsNone(by_vin[VINS[2]].listing.drivetrain)
        self.assertEqual(by_vin[VINS[2]].tier, "GOOD")
        self.assertEqual(rows, before)
        self.assertEqual(result.to_dict()["request"]["drivetrainDiscovery"], request.drivetrain_discovery.to_dict())
        self.assertEqual(transport.calls[0]["params"]["drivetrain"], "FWD")

    def test_filtered_historical_results_preserve_lifecycle_prices_and_drive(self):
        rows = [make_candidate(index) for index in range(3)]
        for row, drivetrain in zip(rows, ("FWD", "4WD", None)):
            row["build"]["drivetrain"] = drivetrain
        before = copy.deepcopy(rows)
        transport = HistoricalTransport([make_candidate_page(rows, 3), *[[make_history(index)] for index in range(3)]])
        provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
        request = configured(make_historical_request(), "FWD")
        result = provider.search_historical(request)
        projected = historical_evidence_to_market_search_result(result)
        ranking = rank_market_comparables(comparable_target_from_search_request(projected.request), projected)
        by_vin = {item.listing.vin: item for item in ranking.candidates}
        self.assertFalse(by_vin[rows[1]["vin"]].eligible)
        self.assertIsNone(by_vin[rows[2]["vin"]].listing.drivetrain)
        self.assertEqual(by_vin[rows[2]["vin"]].tier, "GOOD")
        self.assertEqual(sorted(item.listing.price for item in result.evidence), [24000, 24001, 24002])
        self.assertEqual(rows, before)
        self.assertEqual(projected.request.drivetrain_discovery, request.drivetrain_discovery)
        self.assertEqual(candidate_calls(transport)[0]["params"]["drivetrain"], "FWD")
        self.assertEqual(candidate_calls(transport)[0]["params"]["active_inventory_date_range"], "20260519-20260519")
        self.assertEqual(len(history_calls(transport)), 3)

    def test_adaptive_stages_keep_the_exact_filter_and_existing_scope(self):
        policy = AdaptiveSearchPolicy(stages=(SearchStage(50, 25), SearchStage(100, 50)))
        for historical in (False, True):
            with self.subTest(historical=historical):
                transport = RecordingTransport([{"num_found": 0, "listings": []}] * 2)
                if historical:
                    provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
                    result = adaptive_discover_historical_market_evidence(configured(make_historical_request(), "FWD"), provider, policy)
                else:
                    provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
                    result = adaptive_discover_market_listings(configured(make_request(), "FWD"), provider, policy)
                self.assertEqual([call["params"]["radius"] for call in transport.calls], [50, 100])
                self.assertTrue(all(call["params"]["drivetrain"] == "FWD" for call in transport.calls))
                self.assertEqual(len(result.diagnostics.attempts), 2)
                self.assertTrue(all(item.result.request.drivetrain_discovery.filter_value == "FWD" for item in result.diagnostics.attempts))

    def test_broader_active_capability_preserves_exact_filters_and_historical_ceiling(self):
        policy = AdaptiveSearchPolicy(stages=(
            SearchStage(50, 25), SearchStage(100, 50),
            SearchStage(200, 75), SearchStage(250, 100),
        ))
        for historical, radii in ((False, [50, 100, 200, 250]), (True, [50, 100])):
            with self.subTest(historical=historical):
                transport = RecordingTransport([{"num_found": 0, "listings": []}] * len(radii))
                configuration = VehicleConfigurationIdentity(source="marketcheck", field="version", values=("SE FWD",))
                if historical:
                    provider = MarketCheckHistoricalProvider(
                        SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport,
                        maximum_search_radius_miles=250,
                    )
                    request = replace(configured(make_historical_request(), "FWD"), configuration=configuration)
                    result = adaptive_discover_historical_market_evidence(request, provider, policy)
                else:
                    provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport, maximum_search_radius_miles=250)
                    request = replace(configured(make_request(), "FWD"), configuration=configuration)
                    result = adaptive_discover_market_listings(request, provider, policy)
                self.assertEqual([call["params"]["radius"] for call in transport.calls], radii)
                filters = [{key: value for key, value in call["params"].items() if key not in {"radius", "rows"}} for call in transport.calls]
                self.assertTrue(all(item == filters[0] for item in filters))
                self.assertEqual(filters[0]["version"], "SE FWD")
                self.assertEqual(filters[0]["drivetrain"], "FWD")
                self.assertEqual(filters[0]["car_type"], "used")
                self.assertEqual(filters[0]["has_price"], "true")
                self.assertTrue(all(item.result.request.configuration == configuration for item in result.diagnostics.attempts))

    def test_marked_history_excludes_conflicting_explicit_drivetrain(self):
        for candidate_drive, history_drive in (("FWD", "4WD"), ("4WD", "FWD"), ("AWD", "4WD")):
            with self.subTest(candidate=candidate_drive, history=history_drive):
                row = make_candidate()
                row["build"]["drivetrain"] = candidate_drive
                history = make_history(build={"drivetrain": history_drive})
                before = copy.deepcopy((row, history))
                transport = HistoricalTransport([make_candidate_page([row], 1), [history]])
                provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
                result = provider.search_historical(configured(make_historical_request(), candidate_drive))
                self.assertEqual(result.evidence, ())
                self.assertEqual([item.to_dict() for item in result.issues], [{
                    "status": "UNRESOLVED", "reason": "VEHICLE_CONFIGURATION_CONFLICT",
                    "vin": row["vin"], "sourceListingId": history["id"],
                }])
                self.assertEqual((row, history), before)
                self.assertEqual(len(history_calls(transport)), 1)

    def test_marked_history_uses_only_consistent_explicit_returned_drivetrain(self):
        for candidate_drive, history_drive, expected in (
            (None, "4WD", "4WD"), (None, "FWD", "FWD"),
            ("FWD", None, "FWD"), (None, None, None),
            ("FWD", "front wheel drive", "FWD"), (None, "unverified", None),
        ):
            with self.subTest(candidate=candidate_drive, history=history_drive):
                row = make_candidate()
                row["build"]["drivetrain"] = candidate_drive
                history = make_history(build={"drivetrain": history_drive})
                transport = HistoricalTransport([make_candidate_page([row], 1), [history]])
                provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
                result = provider.search_historical(configured(make_historical_request(), "FWD"))
                self.assertEqual(result.evidence[0].listing.drivetrain, expected)
                self.assertEqual(result.evidence[0].listing.price, history["price"])
                self.assertEqual(result.issues, ())
                market = historical_evidence_to_market_search_result(result)
                ranking = rank_market_comparables(comparable_target_from_search_request(market.request), market)
                self.assertEqual(ranking.candidates[0].eligible, expected != "4WD")
                self.assertEqual(ranking.candidates[0].tier, "STRONG" if expected == "FWD" else "GOOD" if expected is None else "INELIGIBLE")

    def test_unmarked_history_preserves_existing_drivetrain_projection(self):
        for candidate_drive in (None, "FWD"):
            with self.subTest(candidate=candidate_drive):
                row = make_candidate()
                row["build"]["drivetrain"] = candidate_drive
                history = make_history(build={"drivetrain": "4WD"})
                transport = HistoricalTransport([make_candidate_page([row], 1), [history]])
                provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
                result = provider.search_historical(replace(make_historical_request(), drivetrain="FWD"))
                self.assertEqual(result.evidence[0].listing.drivetrain, candidate_drive)
                self.assertEqual(result.issues, ())
                self.assertNotIn("drivetrain", candidate_calls(transport)[0]["params"])

    def test_raw_vin_history_cache_is_reused_across_filtered_search_stages(self):
        row = make_candidate()
        row["build"]["drivetrain"] = "FWD"
        transport = HistoricalTransport([make_candidate_page([row], 1), [make_history()], make_candidate_page([row], 1)])
        provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
        policy = AdaptiveSearchPolicy(stages=(SearchStage(50, 25), SearchStage(100, 50)))
        result = adaptive_discover_historical_market_evidence(configured(make_historical_request(), "FWD"), provider, policy)
        self.assertEqual(len(candidate_calls(transport)), 2)
        self.assertEqual(len(history_calls(transport)), 1)
        self.assertEqual(result.result.evidence[0].listing.drivetrain, "FWD")
        self.assertEqual(result.result.evidence[0].listing.price, 24000)
        self.assertTrue(all(call["params"]["drivetrain"] == "FWD" for call in candidate_calls(transport)))

    def test_raw_cached_history_is_reconciled_again_for_a_marked_search(self):
        row = make_candidate()
        row["build"]["drivetrain"] = "FWD"
        history = make_history(build={"drivetrain": "4WD"})
        transport = HistoricalTransport([make_candidate_page([row], 1), [history], make_candidate_page([row], 1)])
        provider = MarketCheckHistoricalProvider(SYNTHETIC_KEY, as_of_date=AS_OF_DATE, transport=transport)
        legacy = provider.search_historical(replace(make_historical_request(), drivetrain="FWD"))
        marked = provider.search_historical(configured(make_historical_request(), "FWD"))
        self.assertEqual(legacy.evidence[0].listing.drivetrain, "FWD")
        self.assertEqual(marked.evidence, ())
        self.assertEqual(marked.issues[0].reason, "VEHICLE_CONFIGURATION_CONFLICT")
        self.assertEqual(len(candidate_calls(transport)), 2)
        self.assertEqual(len(history_calls(transport)), 1)

    def test_filtered_request_identity_differs_from_legacy_and_other_drive(self):
        for make in (make_request, make_historical_request):
            legacy = replace(make(), drivetrain="FWD")
            requests = (legacy, configured(make(), "FWD"), configured(make(), "4WD"))
            digests = {hashlib.sha256(json.dumps(request.to_dict(), sort_keys=True, separators=(",", ":")).encode()).hexdigest() for request in requests}
            self.assertEqual(len(digests), 3)
            self.assertNotIn("drivetrainDiscovery", legacy.to_dict())

    def test_exact_vin_enrichment_is_used_only_for_missing_returned_drive(self):
        for missing in (False, True):
            with self.subTest(missing=missing):
                rows = [active_record(index, None if missing and index == 2 else "FWD") for index in range(3)]
                responses = [{"num_found": 3, "listings": rows}]
                if missing:
                    responses.append({"num_found": 1, "listings": [active_record(2, "FWD")]})
                transport = RecordingTransport(responses)
                provider = MarketCheckProvider(SYNTHETIC_KEY, transport=transport)
                request = configured(make_request(), "FWD")
                market = provider.search(request)
                base = ValuationDiscrepancyRequest(loss_vehicle=comparable_target_from_search_request(request), loss_date="2026-08-11", ccc_vehicle_valuation=25704, ccc_comparables=())
                resolved = resolve_preliminary_evidence(base_request=base, current_result=market, historical_result=None,
                    current_observed_date="2026-09-05", source_report=None,
                    evidence_context={"inputMode": "MANUAL", "reportAvailable": False, "partialExtraction": False},
                    lookup=provider.lookup_drivetrain)
                self.assertEqual(len(transport.calls), 2 if missing else 1)
                self.assertTrue(all(item.drivetrain == "FWD" for item in resolved.current_result.listings))
                if missing:
                    self.assertEqual(transport.calls[1]["params"]["vin"], VINS[2])
                    self.assertNotIn("drivetrain", transport.calls[1]["params"])
                self.assertTrue(all(call["endpoint"] == MARKETCHECK_ACTIVE_INVENTORY_URL for call in transport.calls))


if __name__ == "__main__":
    unittest.main()
