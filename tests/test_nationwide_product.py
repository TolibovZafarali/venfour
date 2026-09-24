"""Product coverage is independent of operating permission and monetary policy."""
import copy
from dataclasses import replace
import os
import unittest
from unittest.mock import Mock, patch

from starlette.applications import Starlette
from starlette.testclient import TestClient

from venfour.jurisdiction import Assertion, CaseFacts, US_JURISDICTIONS
from venfour.efficient_search import EfficientSearchPolicy
from venfour.nationwide_product import (
    REPORT_LABEL, PRODUCT_FIELDS, DISABLED_CAPABILITIES, configurations, product_context,
    VerifiedOverride, applicable_overrides, apply_search_overrides, validate_frozen_context,
)
from venfour.nationwide_product_api import nationwide_product_routes
from venfour.supabase_gateway import SupabaseAuthenticationError, SupabaseConflictError
from venfour.search_geography import SearchGeography

CASE = '11111111-1111-4111-8111-111111111111'
NOW = '2026-09-22'

def facts(code='MO', claim='first_party', use='personal'):
    return CaseFacts(tuple(Assertion(field, claim if field == 'claim_type' else use if field == 'policy_use' else f'US-{code}', 'customer', 'synthetic-confirmation', NOW+'T00:00:00Z') for field in PRODUCT_FIELDS))

def context(value=None):
    return {'case_id': CASE, 'revision': 1, 'facts': (value or facts()).to_dict(), 'date_of_loss': '2026-09-01'}

class NationwideProductTests(unittest.TestCase):
    def test_all_51_generic_records_cannot_approve_or_invent_rules(self):
        inventory = configurations()
        self.assertEqual(set(inventory), US_JURISDICTIONS)
        self.assertEqual(len(inventory), 51)
        for code, config in inventory.items():
            for claim in ('first_party', 'third_party'):
                with self.subTest(state=code, claim=claim):
                    result = product_context(context(facts(code, claim)), as_of=NOW)
                    self.assertEqual(result['status'], 'PRODUCT_READY_WITH_GENERIC_RULES')
                    self.assertEqual(result['report_label'], REPORT_LABEL)
                    self.assertFalse(result['appraisal_label_allowed'])
                    self.assertTrue(result['generic_method_available'])
                    self.assertEqual(result['applied_overrides'], [])
                    self.assertEqual(set(result['disabled_capabilities']), set(DISABLED_CAPABILITIES))
                    self.assertEqual(result['authority'], 'not_determined_by_product_configuration')
                    self.assertIsNone(result['settlement_total_minor'])
                    self.assertTrue(all(c['amount_minor'] is None and not c['included_in_vehicle_value'] for c in result['settlement_components']))
                    self.assertIsNone(config.workflow['disclosures'])
                    self.assertTrue(all(p['verified_on'] is None and p['status'] == 'research_only' for p in config.provenance))
                    validate_frozen_context(result)
    def test_inventory_cannot_be_mutated_between_cases(self):
        configurations()['MO'].presentation['report_label'] = 'invented'
        self.assertEqual(configurations()['MO'].presentation['report_label'], REPORT_LABEL)
    def test_unknown_territory_country_and_conflicting_facts(self):
        cases = [(CaseFacts(), 'PRODUCT_REVIEW_REQUIRED'), (facts('PR'), 'PRODUCT_UNSUPPORTED'), (facts('ZZ'), 'PRODUCT_UNSUPPORTED')]
        conflict = CaseFacts(facts().assertions + (Assertion('vehicle_registration', 'US-IL', 'document', 'synthetic-document', NOW+'T00:00:00Z'),))
        cases.append((conflict, 'PRODUCT_REVIEW_REQUIRED'))
        for value, status in cases:
            with self.subTest(status=status, value=value):
                result = product_context(context(value), as_of=NOW)
                self.assertEqual(result['status'], status)
                self.assertEqual(result['applied_overrides'], [])
        self.assertEqual(product_context(context(conflict), as_of=NOW)['conflicts'], ['vehicle_registration'])
        foreign = CaseFacts((Assertion('loss_location', 'CA-ON', 'customer', 'synthetic', NOW+'T00:00:00Z'),))
        self.assertEqual(product_context(context(foreign), as_of=NOW)['status'], 'PRODUCT_UNSUPPORTED')
    def test_multiple_states_and_commercial_are_explicit_without_priority(self):
        value = CaseFacts(tuple(replace(a, value='US-IL') if a.field == 'loss_location' else a for a in facts().assertions))
        result = product_context(context(value), as_of=NOW)
        self.assertEqual(result['candidates'], ['IL', 'MO'])
        self.assertEqual(result['method'], 'generic_product_method')
        self.assertTrue(result['generic_method_available'])
        self.assertIn('COMMERCIAL_USE_REQUIRES_REVIEW', product_context(context(facts(use='commercial')), as_of=NOW)['review_reasons'])
    def test_zip_never_selects_legal_state_but_market_origin_still_uses_zip(self):
        value = context(CaseFacts())
        value.update(zipCode='90210', postal_code='63123', ip='127.0.0.1')
        self.assertEqual(product_context(value, as_of=NOW)['candidates'], [])
        geo = SearchGeography()
        for code in ('63123', '90210', '99501', '96813', '20001'):
            with self.subTest(zip=code):
                self.assertEqual(geo.origin(code)['postalCode'], code)
        self.assertNotEqual(geo.origin('90210')['longitude'], geo.origin('63123')['longitude'])
    def test_verified_override_scope_dates_and_bounded_policy(self):
        rule = VerifiedOverride('synthetic-narrow-distance', 'MO', 'first_party', 'personal', '2026-09-01', '2026-10-01', '2026-09-10', 'https://example.invalid/synthetic', 'fictional fixture', 'fixture-only', max_distance_miles=150)
        for state, claim, loss, now, applies in [('MO','first_party','2026-09-01',NOW,True), ('IL','first_party','2026-09-01',NOW,False), ('MO','third_party','2026-09-01',NOW,False), ('MO','first_party','2026-08-31',NOW,False), ('MO','first_party','2026-10-01',NOW,False), ('MO','first_party','2026-09-01','2026-09-09',False)]:
            with self.subTest(state=state, claim=claim, loss=loss, now=now):
                matches = applicable_overrides(facts(state, claim), loss, now, (rule,))
                self.assertEqual(bool(matches), applies)
        conflicting_date = CaseFacts(facts().assertions + (Assertion('loss_date', '2026-08-01', 'document', 'fixture', NOW+'T00:00:00Z'),))
        self.assertEqual(applicable_overrides(conflicting_date, '2026-09-01', NOW, (rule,)), ())
        from venfour.market_search_runtime import search_policy_from_environment
        from venfour.market_request_budget import MarketRequestPolicy
        self.assertEqual(search_policy_from_environment({}, MarketRequestPolicy(), product_rules=(rule,)).boundary, 150)
        policy = EfficientSearchPolicy()
        narrowed = apply_search_overrides(policy, (rule,))
        self.assertEqual(narrowed.boundary, 150)
        self.assertEqual(narrowed.additional_centers, policy.additional_centers)
        self.assertEqual(narrowed.max_observations, policy.max_observations)
        self.assertEqual(apply_search_overrides(replace(policy, case_maximum_distance_miles=120), (rule,)).boundary, 120)
        self.assertIs(apply_search_overrides(policy, ()), policy)
        with self.assertRaises(ValueError): replace(rule, max_distance_miles=251)
        with self.assertRaises(ValueError): applicable_overrides(facts(), '2026-09-01', NOW, (rule, rule))
    def test_verified_settlement_note_is_separate_and_never_invents_money(self):
        rule = VerifiedOverride('synthetic-fee-note', 'MO', 'first_party', 'personal', '2026-09-01', '2026-10-01', NOW, 'https://example.invalid/synthetic', 'fixture', 'fixture-only', settlement_component='title', settlement_note='Synthetic separately reviewed item; amount not established.')
        result = product_context(context(), as_of=NOW, overrides=(rule,))
        item = next(c for c in result['settlement_components'] if c['component'] == 'title')
        self.assertEqual(item['status'], 'verified_state_override')
        self.assertFalse(item['included_in_vehicle_value'])
        self.assertIsNone(item['amount_minor'])
        self.assertIsNone(result['settlement_total_minor'])
        with self.assertRaises(ValueError): validate_frozen_context(result)  # fixture rules cannot enter shipped report version
    def test_frozen_context_rejects_tampering_and_version_drift(self):
        result = product_context(context(), as_of=NOW)
        for key, value in [('report_label', 'Appraisal'), ('product_version', 'future'), ('facts_revision', -1)]:
            changed = copy.deepcopy(result); changed[key] = value
            with self.assertRaises(ValueError): validate_frozen_context(changed)

class ProductApiTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.gateway.get_case_product_facts.return_value = context()
        app = Starlette(routes=nationwide_product_routes())
        app.state.nationwide_product_gateway = self.gateway
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.flags = patch.dict(os.environ, {'VENFOUR_NATIONWIDE_PRODUCT': 'true'})
        self.flags.start(); self.addCleanup(self.flags.stop)
        self.path = f'/api/v1/appraisal-cases/{CASE}/product'
        self.headers = {'Authorization': 'Bearer synthetic-token'}
    def test_disabled_default_has_no_gateway_access(self):
        with patch.dict(os.environ, {'VENFOUR_NATIONWIDE_PRODUCT': 'false'}):
            self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 404)
        self.assertEqual(self.gateway.mock_calls, [])
    def test_authentication_and_staff_boundary(self):
        self.assertEqual(self.client.get(self.path).status_code, 401)
        self.gateway.get_case_product_facts.side_effect = SupabaseAuthenticationError('denied')
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 403)
        staff_path = self.path.replace('/api/v1/', '/api/v1/staff/')
        self.assertEqual(self.client.get(staff_path, headers=self.headers).status_code, 403)
        self.gateway.get_case_product_facts.assert_called_with('synthetic-token', CASE, True)
        self.assertEqual(self.client.post(staff_path, headers=self.headers, json={}).status_code, 405)
    def test_save_uses_owned_revision_rpc_and_returns_no_permission(self):
        result = self.client.post(self.path, headers=self.headers, json={'expected_revision': 1, 'facts': facts().to_dict()})
        self.assertEqual(result.status_code, 200)
        self.gateway.append_product_facts.assert_called_once_with('synthetic-token', CASE, 1, facts().to_dict())
        self.assertIsNone(result.json()['delivery'])
        self.assertEqual(result.json()['context']['authority'], 'not_determined_by_product_configuration')
    def test_all_states_can_save_generic_product_facts_without_published_rules(self):
        for code in sorted(US_JURISDICTIONS):
            with self.subTest(state=code):
                self.gateway.get_case_product_facts.return_value = context(facts(code))
                result = self.client.post(self.path, headers=self.headers, json={
                    'expected_revision': 1, 'facts': facts(code).to_dict(),
                })
                self.assertEqual(result.status_code, 200)
                product = result.json()['context']
                self.assertTrue(product['generic_method_available'])
                self.assertEqual(product['status'], 'PRODUCT_READY_WITH_GENERIC_RULES')
                self.assertEqual(product['candidates'], [code])
                self.assertEqual(product['applied_overrides'], [])
                self.assertEqual(len(result.json()['locations']), 51)
                self.assertTrue(all(item['status'] == 'unresolved_state_specific_component'
                                    for item in product['settlement_components']))
    def test_revision_conflict_does_not_overwrite(self):
        self.gateway.append_product_facts.side_effect = SupabaseConflictError('changed')
        self.assertEqual(self.client.post(self.path, headers=self.headers, json={'expected_revision': 0, 'facts': facts().to_dict()}).status_code, 409)
        self.gateway.get_case_product_facts.assert_not_called()
    def test_forged_permissions_provenance_and_oversized_payloads_rejected(self):
        for payload in ({'expected_revision': True, 'facts': facts().to_dict()}, {'expected_revision': 1, 'facts': facts().to_dict(), 'approved': True}, {'expected_revision': 1, 'facts': CaseFacts((replace(facts().assertions[0], provenance='staff'),)).to_dict()}, {'unexpected': 'x'*33000}):
            self.assertEqual(self.client.post(self.path, headers=self.headers, json=payload).status_code, 400)
        self.gateway.append_product_facts.assert_not_called()
