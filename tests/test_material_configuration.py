"""Focused coverage for explicit drivetrain facts and versioned matching."""

from dataclasses import replace
import copy
import unittest

from venfour.comparables import rank_market_comparables, validate_comparable_ranking_result
from venfour.market import VehicleConfigurationIdentity, normalize_drivetrain
from venfour.marketcheck import MarketCheckProvider, configuration_drivetrain
from tests.test_comparables import make_listing, make_result, make_target
from tests.test_marketcheck import make_raw_listing, RecordingTransport


class MaterialConfigurationTests(unittest.TestCase):
    def test_known_different_drivetrain_is_ineligible_without_price_adjustment(self):
        listing = make_listing(drivetrain="AWD", price=25_397)
        result = rank_market_comparables(make_target(drivetrain="FWD"), make_result(listing))
        candidate = result.candidates[0]
        self.assertFalse(candidate.eligible)
        self.assertEqual(candidate.tier, "INELIGIBLE")
        self.assertIn("DRIVETRAIN_MISMATCH", candidate.reasons)
        self.assertEqual(candidate.listing.price, 25_397)
        self.assertEqual(result.scoring_version, "2")

    def test_unknown_candidate_stays_explicitly_unknown_and_cannot_be_strong(self):
        target = make_target(drivetrain="FWD")
        unknown = make_listing(drivetrain=None, drivetrain_recorded=True)
        known = replace(unknown, drivetrain="FWD")
        missing = rank_market_comparables(target, make_result(unknown)).candidates[0]
        exact = rank_market_comparables(target, make_result(known)).candidates[0]
        self.assertIsNone(missing.listing.to_dict()["drivetrain"])
        self.assertEqual(missing.score, exact.score)
        self.assertEqual(missing.tier, "GOOD")
        self.assertEqual(exact.tier, "STRONG")
        self.assertIn("LISTING_DRIVETRAIN_UNAVAILABLE", missing.reasons)
        self.assertIn("EXACT_DRIVETRAIN", exact.reasons)

    def test_unavailable_subject_preserves_existing_manual_similarity(self):
        candidate = rank_market_comparables(make_target(), make_result(make_listing())).candidates[0]
        self.assertEqual(candidate.score, 100)
        self.assertEqual(candidate.tier, "STRONG")
        self.assertNotIn("drivetrain", candidate.listing.to_dict())

    def test_legacy_scoring_replay_does_not_gain_new_configuration_meaning(self):
        target = make_target()
        result = make_result(make_listing())
        legacy = rank_market_comparables(target, result, scoring_version="1").to_dict()
        before = copy.deepcopy(legacy)
        validate_comparable_ranking_result(legacy)
        self.assertEqual(legacy, before)
        self.assertEqual(legacy["scoringVersion"], "1")
        self.assertNotIn("drivetrain", legacy["target"])
        self.assertNotIn("drivetrain", legacy["candidates"][0]["listing"])

    def test_price_changes_cannot_change_drivetrain_eligibility_or_ranking(self):
        target = make_target(drivetrain="FWD")
        rows = [make_listing(source_listing_id="wrong", drivetrain="AWD", price=1),
                make_listing(source_listing_id="exact", drivetrain="FWD", price=1_000_000)]
        first = rank_market_comparables(target, make_result(*rows))
        second = rank_market_comparables(target, make_result(*(replace(row, price=2_000_000-row.price) for row in rows)))
        projection = lambda result: [(c.listing.source_listing_id, c.eligible, c.score, c.tier, c.rank, c.reasons) for c in result.candidates]
        self.assertEqual(projection(first), projection(second))

    def test_provider_uses_only_explicit_structured_drivetrain(self):
        provider = MarketCheckProvider("test-key", transport=RecordingTransport([]))
        raw = make_raw_listing()
        raw["build"]["drivetrain"] = "Front Wheel Drive"
        self.assertEqual(provider._normalize_listing(raw, 0).drivetrain, "FWD")
        del raw["build"]["drivetrain"]
        raw["build"]["trim"] = "SE AWD"
        raw["vdp_url"] = "https://dealer.invalid/used-kona-awd"
        self.assertIsNone(provider._normalize_listing(raw, 0).to_dict()["drivetrain"])
        for raw_value in ("2WD", "FWD/AWD", "Unknown", None):
            self.assertIsNone(normalize_drivetrain(raw_value))

    def test_verified_historical_record_preserves_candidate_configuration(self):
        from tests.test_marketcheck_historical import make_candidate, make_history, make_request, search_with
        from venfour.historical_market import historical_evidence_to_market_search_result
        from venfour.comparables import comparable_target_from_search_request

        candidate = make_candidate()
        candidate["build"]["drivetrain"] = "All Wheel Drive"
        result, _ = search_with([
            {"num_found": 1, "listings": [candidate]}, [make_history()],
        ], request=make_request(drivetrain="FWD"))
        listing = result.evidence[0].listing
        self.assertEqual(listing.drivetrain, "AWD")
        self.assertEqual(listing.price, 24_000)
        market = historical_evidence_to_market_search_result(result)
        ranked = rank_market_comparables(comparable_target_from_search_request(market.request), market)
        self.assertFalse(ranked.candidates[0].eligible)

    def test_only_provider_owned_explicit_version_facets_can_describe_manual_drive(self):
        self.assertEqual(configuration_drivetrain(VehicleConfigurationIdentity(
            source="marketcheck", field="version", values=("SE FWD", "SE Front Wheel Drive"))), "FWD")
        for configuration in (
            VehicleConfigurationIdentity(source="marketcheck", field="trim", values=("SE FWD",)),
            VehicleConfigurationIdentity(source="other", field="version", values=("SE FWD",)),
            VehicleConfigurationIdentity(source="marketcheck", field="version", values=("SE FWD", "SE AWD")),
            VehicleConfigurationIdentity(source="marketcheck", field="version", values=("SE",)),
        ):
            self.assertIsNone(configuration_drivetrain(configuration))

    def test_new_artifact_preserves_configuration_through_adaptive_replay(self):
        from venfour.analysis_runs import validate_analysis_run_artifact
        from tests.test_analysis_runs import make_orchestrator, make_run_request, RecordingCurrentProvider

        class Repository:
            def save(self, artifact):
                self.artifact = artifact

            def get(self, run_id):
                return self.artifact

        repository = Repository()
        request = make_run_request(historical=False)
        report = copy.deepcopy(request.ccc_report)
        report["vehicle"]["drivetrain"] = "FWD"
        outcome = make_orchestrator(repository, current_provider=RecordingCurrentProvider(), historical_provider=None).run(
            replace(request, ccc_report=report)
        ).artifact.to_dict()
        validate_analysis_run_artifact(outcome, include_environment_secrets=False)
        self.assertEqual(outcome["analysisRunSchemaVersion"], "7")
        self.assertEqual(outcome["request"]["currentSearchRequest"]["drivetrain"], "FWD")
        self.assertEqual(outcome["result"]["currentRanking"]["tierCounts"]["STRONG"], 0)
        self.assertEqual(outcome["discrepancyAnalysisVersion"], "2")

    def test_old_artifact_shape_replays_without_rewriting_version_or_digest(self):
        from venfour.analysis_runs import canonical_json_bytes, discrepancy_request_digest, validate_analysis_run_artifact
        from tests.test_analysis_runs import make_orchestrator, make_run_request, RecordingCurrentProvider

        class Repository:
            def save(self, artifact):
                self.artifact = artifact

            def get(self, run_id):
                return self.artifact

        repository = Repository()
        outcome = make_orchestrator(repository, current_provider=RecordingCurrentProvider(), historical_provider=None).run(
            make_run_request(historical=False)
        ).artifact.to_dict()
        outcome.update(analysisRunSchemaVersion="6", analysisVersion="6", comparableScoringVersion="1")
        outcome["result"]["currentRanking"]["scoringVersion"] = "1"
        outcome["result"]["discrepancyRequest"]["currentEvidence"]["ranking"]["scoringVersion"] = "1"
        outcome["requestDigest"] = discrepancy_request_digest(outcome["result"]["discrepancyRequest"])
        before = canonical_json_bytes(outcome)
        validate_analysis_run_artifact(outcome, include_environment_secrets=False)
        self.assertEqual(canonical_json_bytes(outcome), before)


if __name__ == "__main__":
    unittest.main()
