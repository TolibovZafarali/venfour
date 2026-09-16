"""Readable referral URLs retain authorization and first-draft attribution."""
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock
from venfour.partner_service import PartnerService, PartnerError, _referral_response

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = os.environ.get('VENFOUR_EARNINGS_TEST_CONTAINER')

class PartnerAliasTests(unittest.TestCase):
    def test_request_validation_and_audience(self):
        gateway = Mock()
        service = PartnerService(gateway)
        service.operation('partner_resolve', {'slug': 'ozark-auto'}, 'token', staff=False)
        gateway.operation.assert_called_once_with('partner_resolve', {'slug': 'ozark-auto'}, 'token')
        for slug in ['admin', 'UPPER', 'foo--bar', 'a' * 48, '../other', 'ab', 'a' * 64, None]:
            with self.subTest(slug=slug), self.assertRaises(PartnerError):
                service.operation('staff_resolve', {'slug': slug}, 'token', staff=True)
        for action in ['slug_update', 'staff_resolve']:
            with self.assertRaises(PartnerError):
                service.operation(action, {'slug': 'ozark-auto'}, 'token', staff=False)
        with self.assertRaises(PartnerError):
            service.operation('slug_update', {'slug': 'ozark-auto'}, 'token', staff=True)

    def test_summary_remains_private_and_accepts_legacy_or_readable_links(self):
        link = dict(id='f8200000-0000-4000-8000-000000000001', code='a'*48, status='active', revision=1, created_at='2026-09-16T12:00:00Z')
        result = dict(link=link, summary=dict(submitted_count=0, purchased_count=0, refunded_count=0, under_review_count=0))
        self.assertEqual(_referral_response('referral_summary', result), result)
        link['slug'] = 'ozark-auto'
        self.assertEqual(_referral_response('referral_summary', result), result)
        link['customer_email'] = 'private@example.test'
        with self.assertRaises(PartnerError):
            _referral_response('referral_summary', result)
        del link['customer_email']
        link['slug'] = '../elsewhere'
        with self.assertRaises(PartnerError):
            _referral_response('referral_summary', result)

    @unittest.skipUnless(CONTAINER, 'Requires an isolated local migration rehearsal')
    def test_alias_database_boundaries(self):
        self.assertRegex(CONTAINER, r'^venfour-migration-rehearsal[-a-z0-9]*$')
        self.assertEqual(subprocess.check_output(['docker', 'inspect', CONTAINER, '--format', '{{.HostConfig.NetworkMode}}'], text=True).strip(), 'none')
        fixture = (ROOT / 'supabase/tests/database/038_referral_partner_attribution.test.sql').read_text().split('set local role authenticated;')[0]
        sql = fixture + (ROOT / 'supabase/tests/rehearsal/partner_alias_assertions.sql').read_text()
        result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], input=sql, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout[-7000:] + result.stderr)
        self.assertNotRegex(result.stdout, r'(?m)^not ok ')
        self.assertRegex(result.stdout, r'(?m)^1\.\.\d+$')
        print(result.stdout.strip().splitlines()[-1])
