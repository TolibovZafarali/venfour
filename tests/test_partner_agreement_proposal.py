"""Proposal consistency, unsigned copies, and immutable completed rendering."""
import copy
import hashlib
import json
from pathlib import Path
import unittest

import pymupdf

from scripts.render_partner_agreement_draft import draft_payload
from tests.test_partner_delivery import agreement_fixture
from venfour.analysis_runs import canonical_json_bytes
from venfour.partner_documents import PartnerDocumentError, render_partner_agreement, render_partner_agreement_draft

ROOT = Path(__file__).resolve().parents[1]


class AgreementProposalTests(unittest.TestCase):
    def test_text_artifacts_match_the_seeded_draft(self):
        proposal = json.loads((ROOT/'venfour/data/referral_partner_agreement_draft.json').read_text())
        sql = (ROOT/'supabase/migrations/20260916000300_referral_partner_agreement_proposal.sql').read_text()
        markdown = (ROOT/'docs/agreements/referral-partner-agreement-draft.md').read_text()
        self.assertEqual(json.loads(sql.split('$proposal$')[1]), proposal['sections'])
        self.assertEqual(json.loads(sql.split('$policy$')[1]), proposal['commission_policy'])
        for section in proposal['sections']:
            self.assertIn(section['heading'], markdown)
            self.assertIn(section['body'], markdown)
        self.assertTrue(proposal['release_hold'])
        self.assertEqual(proposal['status'], 'draft')

    def test_unsigned_pdf_cannot_be_misrepresented_as_completed(self):
        payload = draft_payload()
        with self.assertRaisesRegex(PartnerDocumentError, 'not a completed agreement'):
            render_partner_agreement(payload)
        content = render_partner_agreement_draft(payload)
        self.assertEqual(content, render_partner_agreement_draft(payload))
        with pymupdf.open(stream=content, filetype='pdf') as document:
            text = '\n'.join(page.get_text() for page in document)
            self.assertIn('DRAFT - OWNER REVIEW ONLY - NOT SIGNED', text)
            self.assertIn('15 successful cases = $900', text)
            self.assertIn('No signatures', text)
            self.assertNotIn('Fixed commission per qualifying purchase', text)
            for page in document:
                for block in page.get_text('blocks'):
                    self.assertGreaterEqual(block[0], 50)
                    self.assertLessEqual(block[2], 562)
                    self.assertGreaterEqual(block[1], 20)
                    self.assertLessEqual(block[3], 780)

    def test_completed_policy_uses_frozen_terms_not_mutable_proposal(self):
        payload = agreement_fixture()
        proposal = draft_payload()['snapshot']
        payload['snapshot'].update({key: copy.deepcopy(proposal[key]) for key in ['sections','commission_policy']})
        payload['content_sha256'] = hashlib.sha256(canonical_json_bytes(payload['snapshot'])).hexdigest()
        content = render_partner_agreement(payload)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            text = '\n'.join(page.get_text() for page in document)
            self.assertIn('Completed referral partner agreement', text)
            self.assertIn('Successful cases 1-9', text)
            self.assertIn('Exactly $1,000 does not qualify', text)
            self.assertIn('Electronic signatures', text)
            self.assertNotIn('Fixed commission per qualifying purchase', text)
        payload['snapshot']['sections'][0]['body'] = 'Replaced wording'
        with self.assertRaisesRegex(PartnerDocumentError, 'signed digest'):
            render_partner_agreement(payload)

    def test_unknown_policy_is_not_silently_rendered_as_a_fixed_rate(self):
        payload = agreement_fixture()
        payload['snapshot']['commission_policy'] = {'id': 'unknown'}
        payload['content_sha256'] = hashlib.sha256(canonical_json_bytes(payload['snapshot'])).hexdigest()
        with self.assertRaisesRegex(PartnerDocumentError, 'commission policy'):
            render_partner_agreement(payload)
