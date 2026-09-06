"""Controlled evidence resolution without external provider requests."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from dataclasses import replace

from tests.test_discrepancy import make_listing, make_request, make_target, make_temporal
from venfour.historical_market import HistoricalCoverage, HistoricalEvidenceItem, HistoricalMarketSearchRequest, HistoricalMarketSearchResult
from venfour.market import MarketSearchRequest, MarketSearchResult
from venfour.marketcheck import drivetrain_lookup_failure, validate_drivetrain_lookup_result
from venfour.preliminary_resolution import (
    PreliminaryResolutionContractError, replay_preliminary_resolution,
    resolve_preliminary_evidence, validate_preliminary_resolution,
)


OBSERVED_AT = "2026-09-05T12:00:00Z"


def inputs(*, count=3, drivetrain=None, target_drivetrain="FWD", value=20000):
    target = make_target(drivetrain=target_drivetrain, drivetrain_recorded=True)
    listings = tuple(make_listing(index, 1990000 + index * 10000,
                                  vin=f"1HGCM82633A{index:06d}", drivetrain=drivetrain,
                                  drivetrain_recorded=True)
                     for index in range(1, count + 1))
    current = MarketSearchResult(
        provider="synthetic-current",
        request=MarketSearchRequest(year=target.year, make=target.make, model=target.model,
                                    trim=target.trim, loss_vehicle_mileage=target.mileage,
                                    postal_code=target.postal_code, drivetrain=target_drivetrain,
                                    drivetrain_recorded=True),
        listings=listings,
    )
    return {"base_request": make_request(target=target, ccc_vehicle_valuation=value),
            "current_result": current, "historical_result": None,
            "current_observed_date": "2026-08-10", "source_report": None,
            "evidence_context": {"inputMode": "MANUAL", "reportAvailable": False,
                                 "partialExtraction": False}}


def provider_result(vin, *, year, make, model, drivetrain="FWD", status="RESOLVED", cache_hit=False):
    evidence = [] if status != "RESOLVED" else [{
        "listingId": "controlled-spec-" + vin, "vin": vin, "year": year, "make": make, "model": model,
        "rawDrivetrain": drivetrain, "drivetrain": drivetrain,
        "sourcePath": "$.listings[0].build.drivetrain", "endpointCategory": "active", "retrievedAt": OBSERVED_AT,
    }]
    digest = hashlib.sha256(json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return validate_drivetrain_lookup_result({
        "provider": "marketcheck", "resolverVersion": "1", "vin": vin,
        "vehicle": {"year": year, "make": make, "model": model}, "status": status,
        "drivetrain": drivetrain if status == "RESOLVED" else None,
        "reasonCode": "EXPLICIT_DRIVETRAIN_FOUND" if status == "RESOLVED" else "NO_EXPLICIT_DRIVETRAIN",
        "evidence": evidence, "evidenceDigest": digest, "retrievedAt": OBSERVED_AT,
        "lookupSource": "ACTIVE_VIN_LOOKUP", "cacheHit": cache_hit,
        "providerRequestCount": 0 if cache_hit else 1,
    })


class RecordingLookup:
    def __init__(self, *, drivetrain="FWD", status="RESOLVED", cache_hit=False):
        self.calls = []
        self.drivetrain, self.status, self.cache_hit = drivetrain, status, cache_hit

    def __call__(self, vin, **vehicle):
        self.calls.append({"vin": vin, **vehicle})
        return provider_result(vin, **vehicle, drivetrain=self.drivetrain,
                               status=self.status, cache_hit=self.cache_hit)


class PreliminaryResolutionTests(unittest.TestCase):
    def test_explicit_provider_fact_requalifies_without_changing_prices(self):
        original = inputs()
        lookup = RecordingLookup()
        result = resolve_preliminary_evidence(**original, lookup=lookup)
        self.assertEqual(len(lookup.calls), 3)
        self.assertEqual(result.preliminary_qualification["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertEqual(result.discrepancy_result.classification, "NO_MATERIAL_DISCREPANCY")
        self.assertEqual([item.price for item in result.current_result.listings], [item.price for item in original["current_result"].listings])
        self.assertTrue(all(item.drivetrain == "FWD" for item in result.current_result.listings))
        self.assertTrue(all(item.drivetrain is None for item in original["current_result"].listings))
        self.assertEqual(result.resolution["budget"]["providerRequestCount"], 3)
        self.assertEqual(len(result.resolution["evidenceUpdates"]), 3)

    def test_no_value_preserves_unknown_and_provider_responsibility(self):
        result = resolve_preliminary_evidence(**inputs(), lookup=RecordingLookup(status="UNAVAILABLE"))
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertTrue(all(item.drivetrain is None for item in result.current_result.listings))
        self.assertEqual(result.resolution["evidenceUpdates"], [])
        self.assertTrue(all(item["resolution"] == "PROVIDER_MARKET_DATA" for item in result.resolution["checks"]))

    def test_provider_timeout_is_recorded_and_does_not_fail_analysis(self):
        calls = []

        def failing(vin, **vehicle):
            calls.append(vin)
            raise TimeoutError("controlled timeout")

        result = resolve_preliminary_evidence(**inputs(), lookup=failing)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        provider_attempts = [item for item in result.resolution["attempts"] if item["sourceKind"] == "EXISTING_PROVIDER"]
        self.assertTrue(all(item["status"] == "FAILED" and item["reasonCode"] == "PROVIDER_LOOKUP_TIMEOUT" for item in provider_attempts))
        replay = replay_preliminary_resolution(**inputs(), resolution=result.resolution)
        self.assertEqual(replay.to_dict(), result.to_dict())

    def test_cached_lookup_retains_provenance_and_records_zero_provider_requests(self):
        result = resolve_preliminary_evidence(**inputs(), lookup=RecordingLookup(cache_hit=True))
        self.assertEqual(result.resolution["budget"]["providerRequestCount"], 0)
        self.assertEqual(result.preliminary_qualification["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        for item in result.resolution["attempts"]:
            if item["lookupResult"]:
                self.assertTrue(item["lookupResult"]["cacheHit"])
                self.assertEqual(item["lookupResult"]["retrievedAt"], OBSERVED_AT)

    def test_saved_typed_same_vin_fact_precedes_provider(self):
        original = inputs()
        base = original["current_result"]
        original["current_result"] = replace(base, listings=base.listings + tuple(replace(row, drivetrain="FWD", source_listing_id="same-vin-" + row.vin)
                                                                                 for row in base.listings))
        lookup = RecordingLookup(drivetrain="AWD")
        result = resolve_preliminary_evidence(**original, lookup=lookup)
        self.assertEqual(lookup.calls, [])
        self.assertEqual(result.preliminary_qualification["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertEqual(result.resolution["budget"]["providerRequestCount"], 0)

    def test_saved_provider_observation_is_reusable_across_analyses(self):
        original = inputs()
        evidence = [provider_result(item.vin, year=item.year, make=item.make, model=item.model) for item in original["current_result"].listings]
        lookup = RecordingLookup(drivetrain="AWD")
        result = resolve_preliminary_evidence(**original, lookup=lookup, saved_evidence=evidence)
        self.assertEqual(lookup.calls, [])
        self.assertEqual(result.preliminary_qualification["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        replay = replay_preliminary_resolution(**original, resolution=result.resolution)
        self.assertEqual(replay.to_dict(), result.to_dict())

    def test_known_drive_conflict_changes_existing_eligibility(self):
        result = resolve_preliminary_evidence(**inputs(), lookup=RecordingLookup(drivetrain="4WD"))
        self.assertEqual(result.current_ranking.eligible_count, 0)
        self.assertTrue(all(item.tier == "INELIGIBLE" for item in result.current_ranking.candidates))
        self.assertEqual(result.discrepancy_result.classification, "INSUFFICIENT_EVIDENCE")
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_budget_visits_newly_selected_fallbacks_but_never_expands_discovery(self):
        lookup = RecordingLookup(drivetrain="AWD")
        result = resolve_preliminary_evidence(**inputs(count=12, value=22000), lookup=lookup)
        self.assertEqual(len(lookup.calls), 9)
        self.assertEqual(len({item["vin"] for item in lookup.calls}), 9)
        self.assertEqual(len(result.current_result.listings), 12)
        self.assertEqual(result.resolution["budget"]["providerVinsAttempted"], 9)
        self.assertIn("PROVIDER_VIN_BUDGET_EXHAUSTED", [item["reasonCode"] for item in result.resolution["attempts"]])
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_customer_only_gap_does_not_call_provider(self):
        lookup = RecordingLookup()
        result = resolve_preliminary_evidence(**inputs(drivetrain="FWD", target_drivetrain=None), lookup=lookup)
        self.assertEqual(lookup.calls, [])
        self.assertEqual(result.resolution["checks"][0]["resolution"], "CUSTOMER_RESOLVABLE")
        self.assertEqual(result.resolution["checks"][0]["action"], "EXISTING_CUSTOMER_CONFIRMATION")

    def test_partial_resolution_keeps_the_same_material_check_unresolved(self):
        def partial(vin, **vehicle):
            return provider_result(vin, **vehicle, status="RESOLVED" if vin.endswith("000001") else "UNAVAILABLE")
        result = resolve_preliminary_evidence(**inputs(), lookup=partial)
        checks = [item for item in result.resolution["checks"] if item["reasonCode"] == "SELECTED_COMPARABLE_DRIVETRAIN_UNVERIFIED"]
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0]["status"], "UNRESOLVED")
        self.assertEqual(checks[0]["qualificationInputDigest"], result.preliminary_qualification["inputDigest"])
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_stream_fallback_retains_prior_attempts_for_still_unknown_vins(self):
        original = inputs(count=4)
        current = original["current_result"]
        target = original["base_request"].loss_vehicle
        original["current_result"] = replace(current, listings=current.listings[:3] + (replace(current.listings[3], drivetrain="FWD"),))
        original["historical_result"] = HistoricalMarketSearchResult(
            provider=current.provider, evidence_date="2026-05-19", as_of_date="2026-08-10",
            coverage=HistoricalCoverage("SUPPORTED", 90),
            request=HistoricalMarketSearchRequest(evidence_date="2026-05-19", year=target.year, make=target.make,
                                                   model=target.model, trim=target.trim, loss_vehicle_mileage=target.mileage,
                                                   postal_code=target.postal_code, drivetrain="FWD"),
            evidence=tuple(HistoricalEvidenceItem(row, make_temporal()) for row in current.listings[:3]),
        )

        def partial(vin, **vehicle):
            return provider_result(vin, **vehicle, drivetrain="AWD", status="RESOLVED" if vin.endswith("000001") else "UNAVAILABLE")

        result = resolve_preliminary_evidence(**original, lookup=partial)
        self.assertEqual(result.discrepancy_result.evidence_basis, "CURRENT_MARKET")
        current_check = next(item for item in result.resolution["checks"] if item["status"] == "UNRESOLVED")
        self.assertEqual(len(current_check["attemptIds"]), 4)
        self.assertNotIn("NO_SUPPORTED_AUTOMATIC_RESOLVER_FOR_CHECK", current_check["reasonCodes"])
        self.assertEqual(result.to_dict(), replay_preliminary_resolution(**original, resolution=result.resolution).to_dict())

    def test_manual_complete_path_has_no_unnecessary_enrichment(self):
        lookup = RecordingLookup()
        result = resolve_preliminary_evidence(**inputs(drivetrain="FWD"), lookup=lookup)
        self.assertEqual(lookup.calls, [])
        self.assertEqual(result.resolution["attempts"], [])
        self.assertFalse(result.preliminary_qualification["reportReviewApplicable"])

    def test_provider_unavailable_retains_honest_route(self):
        result = resolve_preliminary_evidence(**inputs())
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertIn("EXISTING_PROVIDER_RESOLVER_UNAVAILABLE", [item["reasonCode"] for item in result.resolution["attempts"]])
        self.assertEqual(result.resolution, replay_preliminary_resolution(**inputs(), resolution=result.resolution).resolution)

    def test_insurer_value_does_not_change_lookup_targets_or_resolved_market_facts(self):
        outputs, calls = [], []
        for value in (10000, 20000, 30000):
            lookup = RecordingLookup()
            result = resolve_preliminary_evidence(**inputs(value=value), lookup=lookup)
            outputs.append((result.current_result.to_dict(), result.current_ranking.to_dict(), result.resolution["evidenceUpdates"]))
            calls.append(lookup.calls)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(calls[1], calls[2])
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[1], outputs[2])

    def test_replay_rejects_altered_provider_provenance_or_update(self):
        original = inputs()
        result = resolve_preliminary_evidence(**original, lookup=RecordingLookup())
        for change in ("evidence", "update", "omission"):
            ledger = copy.deepcopy(dict(result.resolution))
            if change == "evidence":
                next(item for item in ledger["attempts"] if item["lookupResult"])["lookupResult"]["evidence"][0]["vin"] = "1HGCM82633A999999"
            elif change == "update":
                ledger["evidenceUpdates"][0]["drivetrain"] = "AWD"
            else:
                ledger["checks"] = []
            with self.subTest(change=change), self.assertRaises((PreliminaryResolutionContractError, ValueError)):
                replay_preliminary_resolution(**original, resolution=ledger)

    def test_invalid_lookup_identity_is_a_failed_resolution_not_an_overlay(self):
        def wrong(vin, **vehicle):
            return provider_result("1HGCM82633A999999", **vehicle)
        result = resolve_preliminary_evidence(**inputs(), lookup=wrong)
        self.assertEqual(result.resolution["evidenceUpdates"], [])
        self.assertEqual(result.preliminary_qualification["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_plain_display_text_cannot_be_supplied_as_authoritative_evidence(self):
        with self.assertRaises((PreliminaryResolutionContractError, ValueError)):
            resolve_preliminary_evidence(**inputs(), saved_evidence=[{"vin": "1HGCM82633A000001", "drivetrain": "AWD", "sourceReference": "URL says AWD"}])

    def test_resolution_schema_and_semantics_reject_customer_assignment_for_provider(self):
        result = resolve_preliminary_evidence(**inputs())
        ledger = copy.deepcopy(dict(result.resolution))
        ledger["checks"][0]["action"] = "EXISTING_CUSTOMER_CONFIRMATION"
        with self.assertRaises(PreliminaryResolutionContractError):
            validate_preliminary_resolution(ledger)


if __name__ == "__main__":
    unittest.main()
