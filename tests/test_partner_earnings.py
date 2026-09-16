"""Private earnings projections and trusted persistence boundaries."""
import unittest
from unittest.mock import Mock

from venfour.partner_earnings import CommissionLedger, serialize_outcome, validate_earnings
from venfour.partner_service import PartnerError, PartnerService
from tests.test_partner_commissions import outcome

PARTNER = '22222222-2222-4222-8222-222222222222'
REFERENCE = '33333333-3333-4333-8333-333333333333'
AT = '2026-09-16T12:00:00+00:00'


def projection():
    return dict(availability='enabled', currency='USD', period='2026-09', as_of=AT,
                summary=dict(earned_month_minor=5000, awaiting_payout_minor=5000, held_minor=0, paid_minor=0, verified_month_count=1),
                items=[dict(reference=REFERENCE, amount_minor=5000, verified_at=AT, eligible_at=AT, status='ready', paid_at=None)],
                total=1, page=1, page_size=25)


class EarningsTests(unittest.TestCase):
    def test_private_reads_keep_caller_authorization_and_scope(self):
        gateway = Mock(); gateway.operation.return_value = projection()
        service = PartnerService(gateway)
        for staff, action in ((False, 'earnings'), (True, 'staff_earnings')):
            self.assertEqual(service.operation('earnings', {'partner_id': PARTNER}, 'owner-token', staff=staff), projection())
            gateway.operation.assert_called_with(action, {'partner_id': PARTNER}, 'owner-token')
        gateway.operation.side_effect = PartnerError(403, 'PARTNER_ACCESS_DENIED', 'Denied')
        with self.assertRaises(PartnerError):
            service.operation('earnings', {'partner_id': PARTNER}, 'owner-token', staff=False)

    def test_no_browser_or_manager_route_can_mint_or_pay_commissions(self):
        gateway = Mock(); service = PartnerService(gateway)
        for staff in (False, True):
            for action in ('commission_record', 'commission_worker', 'simulate_commission', 'record_event', 'staff_earnings'):
                with self.assertRaises(PartnerError):
                    service.operation(action, {'partner_id': PARTNER}, 'token', staff=staff)
        gateway.operation.assert_not_called()

    def test_private_evidence_and_invalid_balances_fail_closed(self):
        gateway = Mock(); service = PartnerService(gateway)
        for field in ('customer_name', 'case_id', 'evidence', 'payment_reference', 'bank_account'):
            result = projection(); result['items'][0][field] = 'private'
            gateway.operation.return_value = result
            with self.assertRaises(PartnerError) as caught:
                service.operation('earnings', {'partner_id': PARTNER}, 'token', staff=False)
            self.assertEqual(caught.exception.status, 503)
            self.assertNotIn('private', caught.exception.message)
        for change in ({'amount_minor': 50}, {'status': 'unverified'}, {'status': 'paid'}, {'amount_minor': True}):
            value = projection(); value['items'][0].update(change)
            with self.assertRaises(ValueError): validate_earnings(value)
        value = projection(); value['summary']['held_minor'] = 6000
        with self.assertRaises(ValueError): validate_earnings(value)
        value = projection(); value['items'] *= 2; value['total'] = 2
        with self.assertRaises(ValueError): validate_earnings(value)
        value = projection(); value['availability'] = 'not_enabled'
        with self.assertRaises(ValueError): validate_earnings(value)
        value.update(summary=None, items=[], total=0)
        self.assertEqual(validate_earnings(value), value)

    def test_bounded_requests_never_reach_storage(self):
        gateway = Mock(); service = PartnerService(gateway)
        for payload in ({'partner_id': PARTNER, 'page_size': 101}, {'partner_id': PARTNER, 'balance': 5000}, {'partner_id': 'other'}, {'partner_id': PARTNER, 'page': True}):
            with self.assertRaises(PartnerError): service.operation('earnings', payload, 'token', staff=False)
        gateway.operation.assert_not_called()

    def test_adapter_reuses_rules_and_retained_entries_for_tenth_case_and_replay(self):
        from venfour.partner_commissions import record_success
        entries = ()
        for n in range(9): entries = record_success(entries, outcome(case_id=str(n), attribution_id=str(n)))
        saved = [dict(outcome=serialize_outcome(e.outcome), month=e.month, sequence=e.sequence, amount_minor=e.amount_minor, eligible_at=e.eligible_at.isoformat()) for e in entries]
        gateway = Mock()
        gateway.commission_worker.side_effect = [{'enabled': True, 'entries': saved}, {'id': 'saved', 'amount_minor': 7500}]
        ledger = CommissionLedger(gateway)
        verified = outcome(case_id='ten', attribution_id='ten')
        self.assertEqual(ledger.record(verified)['amount_minor'], 7500)
        self.assertEqual(gateway.commission_worker.call_args.args[1]['sequence'], 10)
        self.assertEqual(gateway.commission_worker.call_args.args[1]['outcome'], serialize_outcome(verified))
        gateway.reset_mock(); gateway.commission_worker.side_effect = [{'enabled': True, 'entries': saved}, {'id': 'existing', 'amount_minor': 5000}]
        ledger.record(entries[0].outcome)
        self.assertEqual(gateway.commission_worker.call_args.args[1]['sequence'], 1)

    def test_unverified_refund_held_program_and_unknown_outcomes_cannot_be_recorded(self):
        gateway = Mock(); ledger = CommissionLedger(gateway)
        gateway.commission_worker.return_value = {'enabled': False, 'entries': []}
        with self.assertRaises(ValueError): ledger.record(outcome())
        gateway.commission_worker.assert_called_once()
        for change in ({'insurer_evidence_verified': False}, {'final_vehicle_value_minor': 2100000}, {'automatic_refund_due': True}):
            gateway.reset_mock(); gateway.commission_worker.return_value = {'enabled': True, 'entries': []}
            with self.assertRaises(ValueError): ledger.record(outcome(**change))
            gateway.commission_worker.assert_called_once()
        with self.assertRaises(ValueError): ledger.record_event(partner_id=PARTNER, entry_id=REFERENCE, reviewer_id='manager', request_id='request', expected_revision=0, kind='paid', reason='Reconciled')
