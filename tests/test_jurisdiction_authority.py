"""Offline compilation, cryptographic binding and attestation scope checks."""
import copy
from datetime import timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from jsonschema import ValidationError

from jurisdiction_authority_fixtures import NOW, manifest, source, credential, document, stamp
from test_jurisdiction import facts
from venfour.jurisdiction import Capability, DATA, load_packaged_registry
from venfour.jurisdiction_authority import (
    canonical, content_digest, compile_authority, verify_artifact, evaluate_attested,
    validate_attestation, validate_manifest, attested_snapshot, authenticator,
)

ERRORS = (ValueError, ValidationError, TypeError)


class AuthorityCompileTests(unittest.TestCase):
    def setUp(self):
        self.config, self.source = manifest(), source()

    def compile(self):
        return compile_authority(self.source, self.config, now=NOW)

    def test_packaged_sets_remain_empty(self):
        self.assertEqual(load_packaged_registry().rules, ())
        cfg = json.loads((DATA/'jurisdiction_reviewers.json').read_text())
        self.assertEqual(cfg['authorized_reviewers'], [])
        self.assertEqual(cfg['attestation_writers'], [])
        self.assertEqual(cfg['publishers'], [])

    def test_research_cannot_compile(self):
        with self.assertRaises(ERRORS):
            compile_authority(json.loads((DATA/'jurisdiction_research_seed.json').read_text()), self.config, now=NOW)

    def test_single_reviewer_rejected(self):
        self.source['reviews'].pop()
        with self.assertRaises(ERRORS): self.compile()

    def test_duplicate_reviewer_rejected(self):
        self.source['reviews'][1]['reviewer'] = 'review-a'
        with self.assertRaises(ERRORS): self.compile()

    def test_unauthorized_reviewers_rejected(self):
        self.config['authorized_reviewers'] = []
        with self.assertRaises(ERRORS): self.compile()

    def test_two_independent_reviewers_validate(self):
        self.assertEqual(self.compile().payload['rules'][0]['determination'], 'permitted')

    def test_same_key_cannot_represent_two_reviewers(self):
        self.config['authorized_reviewers'][1]['key_id'] = 'review-a'
        with self.assertRaises(ERRORS): validate_manifest(self.config)

    def test_deterministic_canonical_digest(self):
        first = self.compile()
        reordered = dict(reversed(list(self.source.items())))
        self.assertEqual(first, compile_authority(reordered,self.config,now=NOW))
        self.assertEqual(first.digest, content_digest(first.canonical_json))
        self.assertIn('Compilation only',first.summary)

    def test_tamper_rejected(self):
        a=self.compile()
        with self.assertRaises(ERRORS): verify_artifact(a.canonical_json.replace('permitted','prohibited'),a.digest,self.config,now=NOW)

    def test_noncanonical_artifact_rejected(self):
        content=json.dumps(self.source)
        with self.assertRaises(ERRORS): verify_artifact(content,content_digest(content),self.config,now=NOW)

    def test_signature_bound_to_exact_content_and_identity_key(self):
        a=self.compile()
        self.assertNotEqual(authenticator(a.canonical_json,b'a'*32),authenticator(a.canonical_json,b'b'*32))
        self.assertNotEqual(authenticator(a.canonical_json,b'a'*32),authenticator(a.canonical_json+' ',b'a'*32))

    def test_removed_reviewer_stales_compilation(self):
        a=self.compile(); self.config['revision']+=1; self.config['authorized_reviewers'].pop()
        with self.assertRaises(ERRORS): verify_artifact(a.canonical_json,a.digest,self.config,now=NOW)

    def test_expired_review_rejected(self):
        self.source['rules'][0]['review_due_at']=stamp(NOW)
        with self.assertRaises(ERRORS): self.compile()

    def test_future_approval_rejected(self):
        self.source['reviews'][0]['approved_at']=stamp(NOW+timedelta(seconds=1))
        with self.assertRaises(ERRORS): self.compile()

    def test_overlap_rejected_even_with_conditions(self):
        other=copy.deepcopy(self.source['rules'][0]); other['id']='another-rule';other['conditions']=[dict(field='loss_location',equals='US-MO')]
        self.source['rules'].append(other)
        with self.assertRaises(ERRORS): self.compile()

    def test_disjoint_effective_intervals_allowed(self):
        self.source['rules'][0]['effective_until']='2026-09-25'
        other=copy.deepcopy(self.source['rules'][0]); other['id']='later-rule';other['effective_from']=other['effective_until'];other['effective_until']=None
        self.source['rules'].append(other)
        self.compile()

    def test_unsupported_capability_rejected(self):
        self.source['rules'][0]['capability']='formal_appraisal_clause'
        with self.assertRaises(ERRORS): self.compile()

    def test_unimplemented_condition_and_free_text_rejected(self):
        for field,value in [('conditions',[{'description':'may operate'}]),('limitations',['subject to future review'])]:
            self.source=source();self.source['rules'][0][field]=value
            with self.assertRaises(ERRORS): self.compile()

    def test_malformed_primary_source_rejected(self):
        for field,value in [('kind','research'),('url','not-a-url'),('locator',''),('document_digest','unknown')]:
            self.source=source();self.source['rules'][0]['sources'][0][field]=value
            with self.assertRaises(ERRORS): self.compile()

    def test_missing_requirement_lists_rejected(self):
        for field in ['credential_policy','terms_policy']:
            self.source=source();self.source['rules'][0][field]='required'
            with self.assertRaises(ERRORS): self.compile()

    def test_database_and_offline_schemas_are_identical(self):
        import re
        migration=Path('supabase/migrations/20260922000200_jurisdiction_trusted_authority.sql').read_text()
        embedded=[json.loads(s) for s in re.findall(r'\$json\$(.*?)\$json\$',migration)]
        for name in ['reviewed-authority-v1','reviewer-authority-v2','authority-attestation-v1']:
            self.assertIn(json.loads(Path('schemas/jurisdiction/'+name+'.schema.json').read_text()),embedded)

    def test_future_effective_date_after_review_deadline_rejected(self):
        self.source['rules'][0]['effective_from']='2030-01-01'
        self.source['rules'][0]['effective_until']=None
        with self.assertRaises(ERRORS): self.compile()

    def test_not_applicable_never_allows(self):
        self.source['rules'][0]['determination']='not_applicable'
        a=self.compile();result=evaluate_attested(artifact=a,facts=facts(),capability=Capability.MARKET_REPORT,bundle=bundle(a),now=NOW,existing_eligible=True)
        self.assertFalse(result.proposed_allowed)

    def test_revocation_retains_original_review_and_fails_closed(self):
        self.source['operation']='revoke'; self.source['rules'][0]['revocation']=dict(at=stamp(NOW),by='review-a',reference='synthetic-revocation')
        a=self.compile(); self.assertEqual(a.payload['rules'][0]['reviews'],self.source['rules'][0]['reviews'])
        self.assertFalse(evaluate_attested(artifact=a,facts=facts(),capability=Capability.MARKET_REPORT,bundle=bundle(a),now=NOW,existing_eligible=True).proposed_allowed)

    def test_no_network_during_compile(self):
        with patch('socket.socket',side_effect=AssertionError('Network forbidden')): self.compile()


def bundle(artifact):
    return dict(authority_context=dict(epoch=artifact.payload['revision'],registry_digest=artifact.digest,config_revision=1,attestation_revision=0,acceptance_revision=0),
        artifact=artifact.canonical_json,config=manifest(),credentials=[],documents=[],acceptances=[],
        customer_id='customer',case_id='case',order_id='order')


class AttestationTests(unittest.TestCase):
    def setUp(self):
        self.raw=source(); self.cred=credential(); self.doc=document()
        r=self.raw['rules'][0]; r['credential_policy']='required';r['terms_policy']='required'
        r['credentials']=[{k:self.cred[k] for k in ('id','type','jurisdiction','holder','provider')}]
        r['documents']=[{k:self.doc[k] for k in ('type','version','digest')}]
        self.artifact=compile_authority(self.raw,manifest(),now=NOW)
        self.bundle=bundle(self.artifact); self.bundle['credentials']=[self.cred]; self.bundle['documents']=[self.doc]
        self.bundle['acceptances']=[dict(type='terms',version=self.doc['version'],digest=self.doc['digest'],customer_id='customer',case_id='case',order_id='order',accepted_at=stamp(NOW))]
        self.facts=facts(assigned_credential_ref='credential-fixture')

    def decision(self,now=NOW):
        return evaluate_attested(artifact=self.artifact,facts=self.facts,capability=Capability.MARKET_REPORT,bundle=self.bundle,now=now,existing_eligible=True)

    def test_current_scoped_credential_and_exact_acceptance_allow(self): self.assertTrue(self.decision().proposed_allowed)
    def test_missing_assignment_holds(self): self.facts=facts();self.assertFalse(self.decision().proposed_allowed)
    def test_stale_credential_configuration_holds(self): self.cred['config_revision']=0;self.assertFalse(self.decision().proposed_allowed)
    def test_stale_document_configuration_holds(self): self.doc['config_revision']=0;self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_acceptance_case_holds(self): self.bundle['acceptances'][0]['case_id']='other';self.assertFalse(self.decision().proposed_allowed)
    def test_missing_credential_holds(self): self.bundle['credentials']=[];self.assertFalse(self.decision().proposed_allowed)
    def test_expired_credential_holds(self): self.cred['expires_at']=stamp(NOW);self.assertFalse(self.decision().proposed_allowed)
    def test_revoked_credential_holds(self): self.cred['status']='revoked';self.assertFalse(self.decision().proposed_allowed)
    def test_suspended_credential_holds(self): self.cred['status']='suspended';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_jurisdiction_holds(self): self.cred['jurisdiction']='IL';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_holder_holds(self): self.cred['holder']='other';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_provider_holds(self): self.cred['provider']='other';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_capability_holds(self): self.cred['capabilities']=['case_specific_preview'];self.assertFalse(self.decision().proposed_allowed)
    def test_future_credential_holds(self): self.cred['valid_from']=stamp(NOW+timedelta(days=1));self.assertFalse(self.decision().proposed_allowed)
    def test_conflicting_credential_holds(self): self.bundle['credentials'].append(copy.deepcopy(self.cred));self.assertFalse(self.decision().proposed_allowed)
    def test_missing_terms_holds(self): self.bundle['acceptances']=[];self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_terms_version_holds(self): self.bundle['acceptances'][0]['version']='older';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_terms_digest_holds(self): self.bundle['acceptances'][0]['digest']='f'*64;self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_acceptance_owner_holds(self): self.bundle['acceptances'][0]['customer_id']='other';self.assertFalse(self.decision().proposed_allowed)
    def test_wrong_acceptance_order_holds(self): self.bundle['acceptances'][0]['order_id']='other';self.assertFalse(self.decision().proposed_allowed)
    def test_changed_document_holds_without_rewriting_old_acceptance(self):
        before=copy.deepcopy(self.bundle['acceptances']);self.doc['version']='new'
        self.assertFalse(self.decision().proposed_allowed);self.assertEqual(before,self.bundle['acceptances'])
    def test_stale_epoch_holds(self): self.bundle['authority_context']['epoch']+=1;self.assertFalse(self.decision().proposed_allowed)
    def test_changed_facts_hold(self): self.facts=facts(customer_residence='US-IL');self.assertFalse(self.decision().proposed_allowed)
    def test_review_expiry_holds(self): self.assertFalse(self.decision(NOW+timedelta(days=21)).proposed_allowed)
    def test_partner_assertion_cannot_be_attested(self):
        self.cred['writer']='partner'
        with self.assertRaises(ERRORS):validate_attestation(self.cred,manifest(),now=NOW)
    def test_credential_and_document_schema_validate(self):
        validate_attestation(self.cred,manifest(),now=NOW);validate_attestation(self.doc,manifest(),now=NOW)
    def test_unreviewed_missing_bundle_stays_held(self):
        self.bundle['artifact']=None
        snapshot=attested_snapshot(case_id='case',facts=self.facts,facts_revision=1,bundle=self.bundle,now=NOW).to_dict()
        self.assertFalse(snapshot['proposed_allowed'])
    def test_first_third_party_and_personal_commercial_remain_distinct(self):
        for changes in [dict(claim_type='third_party'),dict(policy_use='commercial')]:
            self.facts=facts(**changes);self.assertFalse(self.decision().proposed_allowed)
    def test_prior_evidence_refusal_is_preserved(self):
        self.assertFalse(evaluate_attested(artifact=self.artifact,facts=self.facts,capability=Capability.MARKET_REPORT,bundle=self.bundle,now=NOW,existing_eligible=False).proposed_allowed)
