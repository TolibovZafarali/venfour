"""Offline case-search integration, immutable replay, and valuation separation."""
from __future__ import annotations

import copy
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from tests.test_analysis_runs import RUN_ID_1, make_report
from tests.test_efficient_search import FixtureTransport, ORIGIN, candidate
from venfour.analysis_runs import AnalysisRunContractError, FileAnalysisRunRepository, validate_analysis_run_artifact
from venfour.efficient_search import EfficientMarketSearch, EfficientSearchPolicy, _digest
from venfour.market_request_budget import MarketAccountLimits, MarketRequestBudget, MarketRequestPolicy, MemoryMarketRequestGateway, market_account_key
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.orchestration import AnalysisOrchestrator, AnalysisRunRequest, CurrentMarketSearchConfiguration, HistoricalMarketSearchConfiguration
from venfour.presentation import AnalysisPresentationProjector, validate_analysis_presentation


NOW = datetime(2026, 8, 10, tzinfo=UTC)
CASE_ID = '10000000-0000-4000-8000-000000000001'


def run_analysis(directory, rows, *, offer=20000, supporting=5, request_policy=None, source_report=True,
                 source_vehicle_overrides=None):
    report = make_report()
    report['vehicle'].update(make='Hyundai', model='Elantra', engine='2.0L I4', fuelType='Unleaded', drivetrain='FWD', equipment=[])
    report['valuation']['adjustedVehicleValue'] = offer
    for comparable in report['comparables']:
        comparable.update(make='Hyundai', model='Elantra')
    qualification_report = copy.deepcopy(report) if source_report else None
    if source_vehicle_overrides is not None:
        qualification_report['vehicle'].update(source_vehicle_overrides)
    budget = MarketRequestBudget(
        MemoryMarketRequestGateway(clock=lambda: NOW), market_account_key('fixture-account'), CASE_ID,
        policy=request_policy,
        account_limits=MarketAccountLimits(metered=True, max_requests_per_window=1000, rate_window_seconds=1), clock=lambda: NOW)
    transport = FixtureTransport(current=rows, historical=rows)
    current = MarketCheckProvider('fixture-key', transport=transport, request_budget=budget)
    historical = MarketCheckHistoricalProvider('fixture-key', as_of_date=NOW.date(), transport=transport, request_budget=budget)
    engine = EfficientMarketSearch(
        current_provider=current, historical_provider=historical, budget=budget,
        geography=SearchGeography(postal_centroids={'63026': ORIGIN}, market_centers=[]),
        policy=EfficientSearchPolicy(supporting_attempts=supporting))
    repository = FileAnalysisRunRepository(directory)
    orchestrator = AnalysisOrchestrator(repository, current_provider=current, historical_provider=historical,
                                        market_search=engine, run_id_factory=lambda: RUN_ID_1, clock=lambda: NOW)
    with patch('socket.create_connection', side_effect=AssertionError('Offline fixture must not use network')):
        artifact = orchestrator.run(AnalysisRunRequest(
            ccc_report=report, qualification_source_report=qualification_report, postal_code='63026',
            current_search=CurrentMarketSearchConfiguration(observed_date=NOW.date().isoformat()),
            historical_search=HistoricalMarketSearchConfiguration())).artifact
    return artifact, repository, transport, budget


from venfour.search_geography import SearchGeography


class EfficientAnalysisTests(unittest.TestCase):
    def test_confirmed_vin_and_equipment_can_differ_from_original_report(self):
        original_vin = '1HGCM82633A000099'
        original_equipment = ['Power sunroof']
        with tempfile.TemporaryDirectory() as directory:
            artifact, repository, transport, _ = run_analysis(
                directory, [candidate(i) for i in range(12)],
                source_vehicle_overrides={'vin': original_vin, 'equipment': original_equipment},
            )
            saved = artifact.to_dict()
            effective = saved['request']['marketSubjectFacts']
            self.assertEqual(effective['vin'], make_report()['vehicle']['vin'])
            self.assertEqual(effective['equipment'], [])
            self.assertNotEqual(effective['vin'], original_vin)
            self.assertEqual(saved['request']['qualificationSourceReport']['vehicle']['vin'], original_vin)
            self.assertEqual(saved['request']['qualificationSourceReport']['vehicle']['equipment'], original_equipment)
            self.assertEqual(saved['result']['marketSearch']['input']['subjectFacts'], effective)
            count = len(transport.calls)
            loaded = repository.get(artifact.run_id)
            validate_analysis_run_artifact(loaded)
            presentation = AnalysisPresentationProjector().project(loaded)
            validate_analysis_presentation(presentation)
            self.assertEqual(len(transport.calls), count)

    def test_saved_run_replays_and_projects_without_provider_work(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact, repository, transport, budget = run_analysis(directory, [candidate(i) for i in range(50)])
            self.assertEqual(artifact.analysis_run_schema_version, '11')
            self.assertEqual(budget.snapshot()['totalAttempts'], 16)
            count = len(transport.calls)
            loaded = repository.get(artifact.run_id)
            self.assertEqual(loaded.to_dict(), artifact.to_dict())
            presentation = AnalysisPresentationProjector().project(loaded).to_dict()
            validate_analysis_presentation(presentation)
            self.assertEqual(len(transport.calls), count)
            self.assertEqual(presentation['presentationVersion'], '7')
            self.assertEqual(artifact.result['marketSearch']['baselineStatus'], 'SUFFICIENT')

    def test_expensive_examples_preserve_broader_no_material_discrepancy(self):
        rows = [candidate(i, price=20000 if i < 47 else 23000) for i in range(50)]
        with tempfile.TemporaryDirectory() as directory:
            first, _, _, _ = run_analysis(Path(directory) / 'support', rows)
            baseline, _, _, _ = run_analysis(Path(directory) / 'baseline', rows, supporting=0)
            self.assertEqual(first.result['discrepancyResult'], baseline.result['discrepancyResult'])
            self.assertEqual(first.result['preliminaryQualification'], baseline.result['preliminaryQualification'])
            self.assertEqual(first.result['discrepancyResult']['classification'], 'NO_MATERIAL_DISCREPANCY')
            self.assertEqual(first.result['discrepancyResult']['primaryComparison']['externalMedianPriceCents'], 2000000)
            supporting = first.to_dict()['result']['marketSearch']['supportingEvidence']
            self.assertTrue(supporting['listings'])
            self.assertTrue(all(row['verifiedAskingPrice'] > 20000 for row in supporting['listings']))
            self.assertFalse(supporting['affectsBaselineValuation'])

    def test_offer_does_not_change_discovery_or_independent_value(self):
        rows = [candidate(i) for i in range(15)]
        with tempfile.TemporaryDirectory() as directory:
            first, _, first_transport, _ = run_analysis(Path(directory) / 'first', rows, offer=18000)
            second, _, second_transport, _ = run_analysis(Path(directory) / 'second', rows, offer=22000)
            self.assertEqual(first_transport.calls, second_transport.calls)
            self.assertEqual(first.result['marketSearch'], second.result['marketSearch'])
            self.assertEqual(first.result['discrepancyResult']['primaryComparison']['externalMedianPriceCents'],
                             second.result['discrepancyResult']['primaryComparison']['externalMedianPriceCents'])

    def test_incomplete_search_cannot_be_an_adequate_negative_review(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact, _, _, _ = run_analysis(directory, [candidate(i, price=20000) for i in range(5)])
            self.assertEqual(artifact.result['marketSearch']['baselineStatus'], 'LIMITED')
            qualification = artifact.result['preliminaryQualification']
            self.assertIn('MARKET_SEARCH_LIMITED', qualification['reasonCodes'])
            self.assertNotEqual(qualification['outcome'], 'ADEQUATE_REVIEW_NO_SUPPORTED_ISSUE')
            self.assertEqual(artifact.result['marketSearch']['supportingEvidence']['searchStatus'], 'SKIPPED_INSUFFICIENT_BASELINE')
            validate_analysis_presentation(AnalysisPresentationProjector().project(artifact))

    def test_rehashed_supporting_or_baseline_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact, _, _, _ = run_analysis(directory, [candidate(i) for i in range(12)])
            original = artifact.to_dict()
            for mutate in (
                lambda data: data['result']['marketSearch']['supportingEvidence']['listings'].clear(),
                lambda data: data['result']['marketSearch']['baselineIdentities']['historical'].reverse(),
                lambda data: data['result']['preliminaryResolution'].update(marketSearchStatus='LIMITED'),
            ):
                data = copy.deepcopy(original)
                mutate(data)
                transcript = data['result']['marketSearch']; transcript.pop('digest')
                transcript['digest'] = _digest(transcript)
                with self.assertRaises(AnalysisRunContractError):
                    validate_analysis_run_artifact(data)


if __name__ == '__main__':
    unittest.main()
