"""Offline checks for qualification identity, authorization and transport caps."""
import copy
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from venfour.package_assessment import canonical_package_digest
from tests.template5_qualification import (
    BoundedResponses, budget_plan, validate_authorization, input_token_ceiling, run_live,
)
from tests.template5_qualification_fixtures import load_manifest
from venfour.report_review_evals import load_report_review_eval_suite


class QualificationSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)
        self.now = datetime(2026, 9, 23, 12, tzinfo=UTC)
        self.wire = dict(model='fixture-model', input=[], max_output_tokens=16000, store=False)
        self.plan = dict(model='fixture-model', cases={f'case-{i:02d}': dict(
            inputDigest='a'*64, wireDigest=canonical_package_digest(self.wire),
            inputTokenCeiling=input_token_ceiling(self.wire)) for i in range(28)})
        self.plan['budget'] = budget_plan(self.plan['cases'])
        self.plan['planDigest'] = canonical_package_digest(self.plan)
        self.auth = dict(schemaVersion='1', mode='template5-qualification',
            runId='00000000-0000-4000-8000-000000000555', owner='Fictional operator',
            issuedAt=(self.now-timedelta(minutes=1)).isoformat(),
            expiresAt=(self.now+timedelta(hours=1)).isoformat(),
            planDigest=self.plan['planDigest'], model='fixture-model', allowedCaseIds=sorted(self.plan['cases']),
            maxRequests=84, inputUsdPerMillion='1', outputUsdPerMillion='1', maxCostUsd='100',
            tariffSource='fixture-only-not-real-pricing', tariffVerifiedAt=self.now.isoformat(),
            tokenBoundConfirmed=True, visualReviewConfirmed=True, labelsReviewed=True, providerBudgetConfirmed=True)
        usage=SimpleNamespace(input_tokens=1, output_tokens=1, model_dump=lambda:{'input_tokens':1,'output_tokens':1})
        self.response=SimpleNamespace(model='fixture-model',usage=usage,
            model_dump=lambda:{'model':'fixture-model','usage':{'input_tokens':1,'output_tokens':1}})
        self.delegate=Mock(return_value=self.response)
        self.guard=BoundedResponses(self.delegate,self.auth,self.plan,self.output,clock=lambda:self.now)
        self.request=SimpleNamespace(input_digest='a'*64)

    def begin(self, index=0):
        self.guard.begin_case({'scenarioId':f'case-{index:02d}'},self.request)

    def test_exact_plan_counts_market_zero_and_retry_bound(self):
        plan=self.plan['budget']
        self.assertEqual((plan['expectedModelRequests'],plan['normalMaximum'],plan['retryAdditionalMaximum'],plan['absoluteHardCeiling']),(28,28,56,84))
        self.assertEqual(plan['marketRequests'],0)
        self.assertTrue(all(v==0 for v in plan['marketStages'].values()))
        self.assertEqual(plan['absoluteOutputTokenCeiling'],1344000)
        validate_authorization(self.auth,self.plan,self.now)

    def test_per_case_ceiling_rejects_before_fourth_transport(self):
        self.begin()
        for _ in range(3): self.guard.create(**self.wire)
        with self.assertRaisesRegex(ValueError,'ceiling'): self.guard.create(**self.wire)
        self.assertEqual(self.delegate.call_count,3)

    def test_global_ceiling_counts_every_physical_attempt(self):
        for index in range(28):
            self.begin(index)
            for _ in range(3): self.guard.create(**self.wire)
        with self.assertRaisesRegex(ValueError,'ceiling'): self.guard.create(**self.wire)
        self.assertEqual(self.delegate.call_count,84)
        rows=[json.loads(s) for s in (self.output/'provider-ledger.jsonl').read_text().splitlines()]
        self.assertEqual(sum(r['status']=='RESERVED_BEFORE_TRANSPORT' for r in rows),84)
        self.assertEqual(sum(r['status']=='RETURNED' for r in rows),84)

    def test_expiry_checked_again_immediately_before_transport(self):
        self.begin()
        self.guard.clock=lambda:self.now+timedelta(hours=2)
        with self.assertRaisesRegex(ValueError,'expired'): self.guard.create(**self.wire)
        self.delegate.assert_not_called()

    def test_invalid_authorizations_fail_before_transport(self):
        for key,value in [('mode','production'),('planDigest','b'*64),('model','other'),('allowedCaseIds',[]),
            ('maxRequests',85),('tokenBoundConfirmed',False),('visualReviewConfirmed',False),
            ('labelsReviewed',False),('providerBudgetConfirmed',False),('inputUsdPerMillion','NaN'),
            ('outputUsdPerMillion','0'),('maxCostUsd','0.01')]:
            with self.subTest(key=key):
                auth=dict(self.auth,**{key:value})
                with self.assertRaises(ValueError):validate_authorization(auth,self.plan,self.now)
        self.delegate.assert_not_called()

    def test_fixture_or_wire_drift_cannot_reach_transport(self):
        with self.assertRaises(ValueError):self.guard.begin_case({'scenarioId':'customer'},self.request)
        with self.assertRaises(ValueError):self.guard.begin_case({'scenarioId':'case-00'},SimpleNamespace(input_digest='b'*64))
        self.begin()
        for patch_value in ({'model':'other'},{'store':True},{'max_output_tokens':16001},{'input':[{'type':'input_file'}]}):
            with self.assertRaises(ValueError):self.guard.create(**dict(self.wire,**patch_value))
        self.delegate.assert_not_called()

    def test_plan_tampering_fails_even_with_old_claimed_digest(self):
        plan=copy.deepcopy(self.plan);plan['cases']['case-00']['inputTokenCeiling']=1
        with self.assertRaisesRegex(ValueError,'digest'):validate_authorization(self.auth,plan,self.now)

    def test_failed_transport_keeps_attempt_and_full_cost_reservation(self):
        self.begin();self.delegate.side_effect=TimeoutError('synthetic')
        for _ in range(3):
            with self.assertRaises(TimeoutError):self.guard.create(**self.wire)
        self.assertEqual(self.guard.total,3)
        self.assertGreater(self.guard.reserved,0)
        with self.assertRaises(ValueError):self.guard.create(**self.wire)
        self.assertEqual(self.delegate.call_count,3)

    def test_ledger_failure_stops_before_transport(self):
        self.begin()
        with patch.object(self.guard,'log',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.guard.create(**self.wire)
        self.delegate.assert_not_called()

    def test_unexpected_usage_prevents_candidate_success(self):
        self.begin();self.response.usage.input_tokens=10**9
        with self.assertRaisesRegex(ValueError,'usage'):self.guard.create(**self.wire)
        self.assertEqual(self.guard.total,1)
        with self.assertRaisesRegex(ValueError,'stopped'):self.guard.create(**self.wire)
        self.assertEqual(self.delegate.call_count,1)
        self.assertFalse((self.output/'candidate.json').exists())

    def test_manifest_bound_to_suite_and_all_cases_fictional(self):
        manifest=load_manifest();suite=load_report_review_eval_suite()
        self.assertEqual(len(manifest['cases']),28)
        self.assertEqual(suite.payload['fixtureManifestDigest'],canonical_package_digest(manifest))
        self.assertEqual(len(manifest['profiles']),5)
        self.assertTrue(manifest['fictional'])
        self.assertEqual({c['maxMarketRequests'] for c in manifest['cases']},{0})

    def test_consumed_run_id_rejected_before_client_even_from_another_auth_file(self):
        registry=self.output/'.venfour'/'qualification-runs';registry.mkdir(parents=True)
        (registry/(self.auth['runId']+'.used')).write_text('already consumed')
        from tests.template5_qualification import source_bundle_digest
        self.plan['sourceBundleDigest']=source_bundle_digest()
        authorization=self.output/'copied-authorization.json';authorization.write_text(json.dumps(self.auth))
        with patch('tests.template5_qualification.validate_authorization',return_value={}), patch('pathlib.Path.home',return_value=self.output), patch('openai.OpenAI') as client:
            with self.assertRaises(FileExistsError):run_live(self.output,self.plan,authorization,'synthetic-unused')
            client.assert_not_called()
