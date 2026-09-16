"""Optional network-isolated PostgreSQL integration using the existing commerce fixture."""
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = os.environ.get('VENFOUR_EARNINGS_TEST_CONTAINER')


@unittest.skipUnless(CONTAINER, 'Set a dedicated local migration-rehearsal container')
class EarningsDatabaseTests(unittest.TestCase):
    def run_accounting_fixture(self, *, mature=False, outcomes=False):
        self.assertRegex(CONTAINER, r'^venfour-migration-rehearsal[-a-z0-9]*$')
        network = subprocess.check_output(['docker', 'inspect', CONTAINER, '--format', '{{.HostConfig.NetworkMode}}'], text=True).strip()
        self.assertEqual(network, 'none')
        # Reuse the tested commerce setup through first payment. No hosted events.
        fixture = (ROOT / 'supabase/tests/database/038_referral_partner_attribution.test.sql').read_text()
        fixture = fixture.split("insert into attribution_fixture select 'refund',")[0]
        policy = json.loads((ROOT / 'venfour/data/referral_partner_agreement_draft.json').read_text())['commission_policy']
        old = '{"commission_amount_minor_units":4500,"currency":"USD"}'
        new = json.dumps(dict(commission_amount_minor_units=4500, currency='USD', commission_policy=policy), separators=(',', ':'))
        self.assertIn(old, fixture)
        fixture = fixture.replace(old, new)
        assertions = (ROOT / 'supabase/tests/rehearsal/partner_earnings_assertions.sql').read_text()
        if outcomes:
            assertions = assertions.split('set local role service_role;')[0]
            assertions += (ROOT / 'supabase/tests/rehearsal/partner_outcome_assertions.sql').read_text()
        if mature:
            # Synthetic historical attribution/payment timestamps, inside the rollback.
            fixture = fixture.replace('begin;\n', "begin;\nalter table public.referral_case_attributions alter column bound_at set default (statement_timestamp()-interval '45 days');\n", 1)
            fixture = fixture.replace("values('paid_at',to_jsonb(statement_timestamp()))", "values('paid_at',to_jsonb(statement_timestamp()-interval '31 days'))")
            assertions = assertions.split("select public.record_total_loss_dispute(")[0]
            assertions = assertions.replace("'waiting','thirty-day waiting period is explicit'", "'ready','mature payment is eligible after verification'")
            assertions += (ROOT / 'supabase/tests/rehearsal/partner_earnings_paid_assertions.sql').read_text()
        sql = fixture + assertions
        result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], input=sql, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout[-8000:] + result.stderr)
        self.assertNotRegex(result.stdout, r'(?m)^not ok ')
        self.assertRegex(result.stdout, r'(?m)^1\.\.\d+$')
        print(result.stdout.strip().splitlines()[-1])

    def test_transactional_accounting_and_owner_projection(self):
        self.run_accounting_fixture()

    def test_reconciled_payment_and_later_dispute_preserve_history(self):
        self.run_accounting_fixture(mature=True)

    def test_manager_outcome_review_and_atomic_commission(self):
        self.run_accounting_fixture(outcomes=True)
