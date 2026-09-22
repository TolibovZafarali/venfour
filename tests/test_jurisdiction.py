"""Synthetic scope fixtures exercise machinery, never approve a real service."""

import copy
from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from jsonschema import Draft202012Validator, FormatChecker

from venfour.jurisdiction import (
    Assertion, Capability, CaseFacts, DATA, FACT_FIELDS, Registry, ResearchInventory,
    US_JURISDICTIONS, digest, evaluate, load_packaged_registry, resolve,
)
from venfour.jurisdiction_adapter import (
    BOUNDARIES, FLAG, configured_mode, decide, observe_reference_scope, observe_scope,
)


NOW = datetime(2026, 9, 22, 12, tzinfo=timezone.utc)
CASE = "20000000-0000-4000-8000-000000000002"


def facts(**changes):
    values = dict(customer_residence="US-MO", claim_type="first_party",
                  policy_use="personal", provider_role="valuation_service",
                  loss_date="2026-08-01")
    values.update(changes)
    return CaseFacts(tuple(Assertion(k, v, "customer", "synthetic-intake", NOW.isoformat()) for k, v in values.items()))


def registry_payload():
    return {
        "schema_version": "1", "version": "synthetic-only",
        "interpretations": [{
            "id": "fixture-scope", "version": 1, "capability": Capability.MARKET_REPORT.value,
            "candidate_jurisdictions": ["MO"], "claim_type": "first_party",
            "policy_use": "personal", "provider_role": "valuation_service",
            "required_facts": ["customer_residence"], "date_anchor": "service_date",
            "review_evidence": "synthetic-review", "reviewed_by": "fixture-reviewer",
            "reviewed_at": "2026-08-01T00:00:00Z", "source_ids": ["MO-L1"],
            "assumptions": [],
        }],
        "rules": [{
            "id": "fixture-rule", "version": 1, "applicability_id": "fixture-scope",
            "applicability_version": 1, "determination": "permitted",
            "effective_from": "2026-08-01", "effective_until": "2026-10-18",
            "approved_by": "fixture-reviewer", "approved_at": "2026-08-02T00:00:00Z",
            "approval_evidence": "synthetic-approval", "review_due_at": "2027-01-01T00:00:00Z",
            "revoked_at": None, "required_credential_refs": [], "required_terms": [], "limitations": [],
        }],
    }


def registry(raw=None, reviewers=frozenset({"fixture-reviewer"})):
    return Registry.from_dict(raw or registry_payload(), authorized_reviewers=reviewers, source_ids=frozenset({"MO-L1"}))


def decision(case=None, rules=None, **kwargs):
    return evaluate(case or facts(), Capability.MARKET_REPORT, rules or registry(),
                    evaluated_at=kwargs.pop("evaluated_at", NOW), existing_eligible=kwargs.pop("existing_eligible", True), **kwargs)


class JurisdictionFactsTests(unittest.TestCase):
    def test_unknowns_remain_explicit_without_zip_or_ip_resolution(self):
        result = resolve(CaseFacts())
        self.assertEqual(result.candidates, ())
        self.assertEqual(set(result.missing_facts), FACT_FIELDS)
        self.assertIn("JURISDICTION_UNKNOWN", result.review_reasons)
        for bad in ({"postal_code": "63123"}, {"ip": "127.0.0.1"}, {"approved": True}):
            with self.assertRaises((ValueError, TypeError)):
                CaseFacts.from_dict({"schema_version": "1", "assertions": [], **bad})

    def test_all_51_codes_resolve_including_dc(self):
        self.assertEqual(len(US_JURISDICTIONS), 51)
        for code in US_JURISDICTIONS:
            with self.subTest(code=code):
                self.assertEqual(resolve(facts(customer_residence="US-" + code)).candidates, (code,))

    def test_territories_non_us_unknown_and_invalid_codes_are_explicit(self):
        for value, reason in [("US-PR", "UNSUPPORTED_TERRITORY"), ("US-GU", "UNSUPPORTED_TERRITORY"),
                              ("CA-ON", "UNSUPPORTED_COUNTRY"), ("US-XX", "UNKNOWN_LOCATION_CODE"),
                              ("MO", "UNKNOWN_LOCATION_CODE"), ("63123", "UNKNOWN_LOCATION_CODE"),
                              ("us-mo", "UNKNOWN_LOCATION_CODE")]:
            with self.subTest(value=value):
                result = resolve(facts(customer_residence=value))
                self.assertEqual(result.candidates, ())
                self.assertIn(reason, result.review_reasons)
                self.assertFalse(decision(facts(customer_residence=value)).proposed_allowed)

    def test_unknown_null_conflict_and_multiple_locations_are_distinct(self):
        base = facts(customer_residence=None)
        self.assertIn("customer_residence", resolve(base).missing_facts)
        multiple = facts(loss_location="US-IL")
        self.assertEqual(resolve(multiple).candidates, ("IL", "MO"))
        self.assertEqual(resolve(multiple).conflicting_facts, ())
        self.assertFalse(decision(multiple).proposed_allowed)
        conflict = CaseFacts(facts().assertions + (Assertion("customer_residence", "US-IL", "document", "private-document-id", NOW.isoformat()),))
        self.assertIn("customer_residence", resolve(conflict).conflicting_facts)
        self.assertIn("CONFLICTING_FACTS", decision(conflict).reasons)

    def test_no_universal_priority_even_for_reviewed_multi_state_scope(self):
        raw = registry_payload()
        raw["interpretations"][0]["candidate_jurisdictions"] = ["MO", "IL"]
        case = facts(loss_location="US-IL")
        self.assertTrue(decision(case, registry(raw)).proposed_allowed)
        self.assertFalse(decision(facts(loss_location="US-IL", provider_location="US-TX"), registry(raw)).proposed_allowed)

    def test_invalid_policy_period_and_claim_values(self):
        self.assertIn("INVALID_POLICY_PERIOD", decision(facts(policy_start="2026-10-01", policy_end="2026-01-01")).reasons)
        for values in ({"claim_type": "both"}, {"policy_use": "unknown"}, {"loss_date": "2026-02-30"}):
            with self.assertRaises(ValueError): facts(**values)

    def test_schema_and_python_contract_roundtrip(self):
        schema = json.loads(Path("schemas/jurisdiction/case-facts-v1.schema.json").read_text())
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        for case in (CaseFacts(), facts(), facts(loss_location=None), facts(customer_residence="US-PR")):
            validator.validate(case.to_dict())
            self.assertEqual(CaseFacts.from_dict(case.to_dict()), case)
        with self.assertRaises(FrozenInstanceError): facts().schema_version = "2"


class JurisdictionRegistryTests(unittest.TestCase):
    def test_seed_contains_51_unique_records_67_sources_and_no_permissions(self):
        raw = json.loads((DATA / "jurisdiction_research_seed.json").read_text())
        research = ResearchInventory.from_dict(raw)
        self.assertEqual(len(research.sources), 67)
        self.assertEqual({o.jurisdiction_code for o in research.observations}, US_JURISDICTIONS)
        packaged = load_packaged_registry()
        self.assertEqual(packaged.rules, ())
        self.assertEqual(packaged.interpretations, ())
        for code in US_JURISDICTIONS:
            for capability in Capability:
                result = evaluate(facts(customer_residence="US-"+code), capability, packaged, evaluated_at=NOW, existing_eligible=True)
                self.assertFalse(result.proposed_allowed)
                self.assertIn("MISSING_CURRENT_APPROVAL", result.reasons)

    def test_research_status_source_portal_and_upload_cannot_authorize(self):
        seed = json.loads((DATA / "jurisdiction_research_seed.json").read_text())
        changes = [lambda d: d["approved_rules"].append(registry_payload()["rules"][0]),
                   lambda d: d.update(production_activation_permitted=True),
                   lambda d: d["jurisdictions"][0].update(launch_approval="yes"),
                   lambda d: d["jurisdictions"][0]["capability_reviews"][Capability.PREVIEW.value].update(review_status="permitted"),
                   lambda d: d["jurisdictions"].__setitem__(0, copy.deepcopy(d["jurisdictions"][1]))]
        for mutate in changes:
            raw = copy.deepcopy(seed); mutate(raw)
            with self.assertRaises(ValueError): ResearchInventory.from_dict(raw)
        with self.assertRaises(ValueError): Registry.from_dict(seed, authorized_reviewers=frozenset(), source_ids=frozenset())
        with self.assertRaises(ValueError): registry(reviewers=frozenset())
        with self.assertRaises(ValueError): CaseFacts.from_dict({"schema_version": "1", "assertions": [], "rules": registry_payload()["rules"]})

    def test_authorization_version_and_review_evidence_are_mandatory(self):
        for section, field, value in [("rules", "approved_by", "document"), ("rules", "approval_evidence", ""),
                ("rules", "version", True), ("rules", "applicability_version", 2),
                ("interpretations", "reviewed_by", "untrusted-output"), ("interpretations", "review_evidence", ""),
                ("interpretations", "source_ids", ["missing"]), ("interpretations", "claim_type", "any")]:
            raw = registry_payload(); raw[section][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): registry(raw)
        raw = registry_payload(); raw["rules"].append(copy.deepcopy(raw["rules"][0]))
        with self.assertRaises(ValueError): registry(raw)

    def test_claim_types_policy_uses_roles_and_capabilities_are_independent(self):
        self.assertTrue(decision().proposed_allowed)
        for change in ({"claim_type": "third_party"}, {"claim_type": None}, {"policy_use": "commercial"}, {"provider_role": "licensed_adjuster"}):
            self.assertFalse(decision(facts(**change)).proposed_allowed)
        for capability in set(Capability) - {Capability.MARKET_REPORT}:
            self.assertFalse(evaluate(facts(), capability, registry(), evaluated_at=NOW, existing_eligible=True).proposed_allowed)

    def test_unresolved_not_applicable_and_prohibited_never_allow(self):
        for status in ("unresolved", "not_applicable", "prohibited"):
            raw=registry_payload(); raw["rules"][0]["determination"]=status
            result=decision(rules=registry(raw))
            self.assertEqual(result.determination,status)
            self.assertFalse(result.proposed_allowed)

    def test_effective_dates_approval_review_due_and_revocation(self):
        for field, value in [("effective_from","2026-09-23"),("effective_until","2026-09-22"),
                             ("approved_at","2026-09-23T00:00:00Z"),("review_due_at",NOW.isoformat()),
                             ("revoked_at",NOW.isoformat())]:
            raw=registry_payload();raw["rules"][0][field]=value
            with self.subTest(field=field): self.assertFalse(decision(rules=registry(raw)).proposed_allowed)

    def test_current_future_versions_use_only_the_reviewed_anchor(self):
        raw=registry_payload()
        future={**raw["rules"][0],"version":2,"effective_from":"2026-10-18","effective_until":None}
        raw["rules"].append(future)
        rules=registry(raw)
        self.assertEqual(decision(rules=rules).rule_versions,("fixture-rule@1",))
        self.assertEqual(decision(rules=rules,evaluated_at=datetime(2026,10,18,tzinfo=timezone.utc)).rule_versions,("fixture-rule@2",))
        raw["interpretations"][0]["date_anchor"]="loss_date"
        self.assertEqual(decision(rules=registry(raw),evaluated_at=datetime(2026,10,18,tzinfo=timezone.utc)).rule_versions,("fixture-rule@1",))
        raw["interpretations"][0]["date_anchor"]="unresolved"
        self.assertIn("UNRESOLVED_DATE_ANCHOR",decision(rules=registry(raw)).reasons)
        raw["interpretations"][0]["date_anchor"]="settlement_date"
        self.assertIn("MISSING_DATE_ANCHOR",decision(rules=registry(raw)).reasons)

    def test_overlapping_approvals_require_review(self):
        raw=registry_payload(); raw["rules"].append({**raw["rules"][0],"version":2})
        self.assertIn("OVERLAPPING_OPERATIONAL_RULES",decision(rules=registry(raw)).reasons)

    def test_unimplemented_scope_assumptions_do_not_become_permission(self):
        raw=registry_payload(); raw["interpretations"][0]["assumptions"]=["Unimplemented provider relationship"]
        self.assertFalse(decision(rules=registry(raw)).proposed_allowed)

    def test_evidence_credential_and_terms_requirements_are_conjoined(self):
        self.assertFalse(decision(existing_eligible=False).proposed_allowed)
        raw=registry_payload(); rule=raw["rules"][0]
        rule.update(determination="limited",required_credential_refs=["entity-and-person-proof"],required_terms=["reviewed-terms"])
        rules=registry(raw)
        self.assertFalse(decision(facts(assigned_credential_ref="entity-and-person-proof"),rules).proposed_allowed)
        self.assertTrue(decision(rules=rules,verified_credentials=frozenset({"entity-and-person-proof"}),ready_terms=frozenset({"reviewed-terms"})).proposed_allowed)
        rule["limitations"]=["Unimplemented condition"]
        self.assertFalse(decision(rules=registry(raw),verified_credentials=frozenset({"entity-and-person-proof"}),ready_terms=frozenset({"reviewed-terms"})).proposed_allowed)


class JurisdictionAdapterTests(unittest.TestCase):
    def gateway(self):
        gateway=Mock()
        gateway.get_jurisdiction_context.return_value={"case_id":CASE,"revision":1,"facts":facts().to_dict(),"date_of_loss":"2026-08-01","intake_updated_at":NOW.isoformat()}
        return gateway

    def test_default_off_performs_no_reads_or_writes(self):
        gateway=self.gateway()
        with patch.dict(os.environ,{},clear=True): self.assertIsNone(observe_scope(gateway,CASE,"checkout"))
        self.assertEqual(gateway.mock_calls,[])
        self.assertEqual(configured_mode({}),"off")
        for mode in ("enforce","true","nationwide",""):
            with self.assertRaises(ValueError): configured_mode({FLAG:mode})

    def test_shadow_records_immutable_proposed_hold_without_enforcement(self):
        gateway=self.gateway()
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            snapshot=observe_scope(gateway,CASE,"checkout")
        value=snapshot.to_dict()
        self.assertFalse(value["proposed_allowed"])
        self.assertTrue(value["existing_eligible"])
        self.assertEqual(snapshot.content_digest,digest(value))
        value["proposed_allowed"]=True
        self.assertFalse(snapshot.to_dict()["proposed_allowed"])
        gateway.record_jurisdiction_decision.assert_called_once()
        self.assertEqual(len(snapshot.to_dict()["decisions"]),4)

    def test_unknown_and_conflicting_saved_facts_never_turn_into_permission(self):
        gateway=self.gateway();gateway.get_jurisdiction_context.return_value["date_of_loss"]="2026-08-02"
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            snapshot=observe_scope(gateway,CASE,"checkout")
        self.assertIn("loss_date",snapshot.to_dict()["resolution"]["conflicting_facts"])
        self.assertEqual(snapshot.to_dict()["resolution"]["candidates"],["MO"])

    def test_unavailable_database_is_visible_and_shadow_does_not_change_live_flow(self):
        gateway=self.gateway();gateway.get_jurisdiction_context.side_effect=RuntimeError("sensitive contents")
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter") as logs:
            self.assertIsNone(observe_scope(gateway,CASE,"checkout"))
        self.assertNotIn("sensitive contents",str(logs.output))
        gateway.record_jurisdiction_decision.assert_not_called()

    def test_internal_reference_resolves_same_adapter(self):
        gateway=self.gateway();gateway.get_jurisdiction_reference_case.return_value=CASE
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            result=observe_reference_scope(gateway,"opaque-work-id","work_item","report_release")
        self.assertFalse(result.to_dict()["proposed_allowed"])
        gateway.get_jurisdiction_context.assert_called_once_with(CASE)

    def test_staff_scope_observation_requires_authorized_review_packet(self):
        gateway=self.gateway()
        gateway.get_total_loss_release_review.side_effect=PermissionError("not staff")
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            self.assertIsNone(observe_reference_scope(gateway,"review-id","release_review","report_release",access_token="untrusted"))
        gateway.get_jurisdiction_context.assert_not_called()
        gateway.get_total_loss_release_review.side_effect=None
        gateway.get_total_loss_release_review.return_value={"case_id":CASE}
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            self.assertFalse(observe_reference_scope(gateway,"review-id","release_review","report_release",access_token="staff-token").to_dict()["proposed_allowed"])
        gateway.get_jurisdiction_reference_case.assert_not_called()

    def test_customer_scope_observation_passes_authoritative_owner(self):
        gateway=self.gateway()
        with patch.dict(os.environ,{FLAG:"shadow"}),self.assertLogs("venfour.jurisdiction_adapter"):
            observe_scope(gateway,CASE,"draft_release",owner_user_id="owner-id")
        gateway.get_jurisdiction_context.assert_called_once_with(CASE,"owner-id")

    def test_every_processing_boundary_retains_evidence_refusal(self):
        for boundary in BOUNDARIES:
            value=decide(case_id=CASE,facts=facts(),facts_revision=1,boundary=boundary,registry=registry(),evaluated_at=NOW,existing_eligible=False).to_dict()
            self.assertFalse(value["proposed_allowed"])
            self.assertTrue(all("EXISTING_ELIGIBILITY_REFUSED" in d["reasons"] for d in value["decisions"]))
