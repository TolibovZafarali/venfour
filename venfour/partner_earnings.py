"""Private commission projections and trusted accounting adapter.

Outcome interpretation belongs to an authorized review workflow. This adapter
records reviewed facts; it never verifies a customer assertion or transfers funds.
"""
from dataclasses import asdict
from datetime import datetime
from uuid import UUID

from venfour.partner_commissions import CommissionEntry, RefundKind, VerifiedOutcome, record_success


STATUSES = {'not_enabled', 'unverified', 'waiting', 'ready', 'held', 'paid', 'reversed', 'recovery_review'}
SUMMARY_FIELDS = {'earned_month_minor', 'awaiting_payout_minor', 'held_minor', 'paid_minor', 'verified_month_count'}


def timestamp(value):
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() is not None
    except ValueError:
        return False


def count(value):
    return type(value) is int and 0 <= value <= 9_007_199_254_740_991


def validate_earnings(value):
    """Reject additional fields instead of leaking private evidence or payments."""
    import re
    if not isinstance(value, dict) or set(value) != {'availability', 'currency', 'period', 'as_of', 'summary', 'items', 'total', 'page', 'page_size'}:
        raise ValueError('Invalid earnings projection')
    if value['availability'] not in ('enabled', 'not_enabled') or value['currency'] != 'USD' or not isinstance(value['period'], str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', value['period']) or not timestamp(value['as_of']):
        raise ValueError('Invalid earnings period')
    if not count(value['total']) or not count(value['page']) or not 1 <= value['page'] <= 100000 or not count(value['page_size']) or not 1 <= value['page_size'] <= 100 or not isinstance(value['items'], list) or len(value['items']) > min(value['page_size'], value['total']):
        raise ValueError('Invalid earnings pagination')
    summary = value['summary']
    if value['availability'] == 'not_enabled':
        if summary is not None:
            raise ValueError('Disabled earnings cannot imply a balance')
    elif not isinstance(summary, dict) or set(summary) != SUMMARY_FIELDS or not all(count(n) for n in summary.values()) or summary['held_minor'] > summary['awaiting_payout_minor']:
        raise ValueError('Invalid earnings totals')
    seen = set()
    for item in value['items']:
        if not isinstance(item, dict) or set(item) != {'reference', 'amount_minor', 'verified_at', 'eligible_at', 'status', 'paid_at'}:
            raise ValueError('Invalid earnings row')
        ref = item['reference']
        if not isinstance(ref, str) or str(UUID(ref)) != ref or ref in seen or item['status'] not in STATUSES:
            raise ValueError('Invalid earnings reference')
        seen.add(ref)
        if value['availability'] == 'not_enabled' and item['status'] != 'not_enabled':
            raise ValueError('Disabled earnings cannot imply a commission')
        if item['status'] in ('unverified', 'not_enabled'):
            if any(item[k] is not None for k in ('amount_minor', 'verified_at', 'eligible_at', 'paid_at')):
                raise ValueError('Unverified referrals cannot imply earnings')
        elif type(item['amount_minor']) is not int or item['amount_minor'] not in (5000, 7500) or not timestamp(item['verified_at']) or not timestamp(item['eligible_at']):
            raise ValueError('Invalid recorded commission')
        if (item['status'] in ('paid', 'recovery_review')) != (item['paid_at'] is not None) or (item['paid_at'] is not None and not timestamp(item['paid_at'])):
            raise ValueError('Invalid payment record')
    return value


def serialize_outcome(outcome):
    return {key: value.isoformat() if isinstance(value, datetime) else value.value if isinstance(value, RefundKind) else value
            for key, value in asdict(outcome).items()}


def restore_outcome(value):
    values = dict(value)
    for key in ('attributed_at', 'paid_at', 'service_started_at', 'baseline_communicated_at', 'accepted_at', 'verified_at'):
        values[key] = datetime.fromisoformat(values[key].replace('Z', '+00:00'))
    values['refund'] = RefundKind(values['refund'])
    return VerifiedOutcome(**values)


class CommissionLedger:
    def __init__(self, gateway):
        self.gateway = gateway

    def record(self, outcome: VerifiedOutcome):
        """Persist trusted review once. A concurrency conflict requires fresh context.

        The caller retains the same outcome on retry, including verification time.
        No customer or partner HTTP action can call this method.
        """
        return self.gateway.commission_worker('record', self.prepare(outcome))

    def prepare(self, outcome: VerifiedOutcome):
        """Calculate a proposed entry; persistence rechecks serialized source state."""
        context = self.gateway.commission_worker('context', {'partner_id': outcome.partner_id})
        if context.get('enabled') is not True:
            raise ValueError('Commission program is not enabled')
        existing = tuple(CommissionEntry(restore_outcome(row['outcome']), row['month'], row['sequence'],
                                        row['amount_minor'], datetime.fromisoformat(row['eligible_at'].replace('Z', '+00:00')))
                         for row in context['entries'])
        updated = record_success(existing, outcome)
        entry = next(item for item in updated if item.outcome.attribution_id == outcome.attribution_id)
        return {
            'partner_id': outcome.partner_id, 'outcome': serialize_outcome(outcome), 'month': entry.month,
            'sequence': entry.sequence, 'amount_minor': entry.amount_minor, 'eligible_at': entry.eligible_at.isoformat(),
        }

    def record_event(self, *, partner_id, entry_id, reviewer_id, request_id, expected_revision, kind, reason, payment_reference=None):
        """Retain a reviewed adjustment or evidence of an already completed payment.

        This records accounting only. Bank/tax data and payment execution are excluded.
        """
        if kind not in {'hold', 'release', 'reverse', 'paid', 'recovery_review'}:
            raise ValueError('Invalid accounting event')
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 500 or type(expected_revision) is not int or expected_revision < 0:
            raise ValueError('A reason and current revision are required')
        if (kind == 'paid') != (payment_reference is not None):
            raise ValueError('Completed payments require a reconciliation reference')
        return self.gateway.commission_worker('event', dict(partner_id=partner_id, entry_id=entry_id, reviewer_id=reviewer_id,
            request_id=request_id, expected_revision=expected_revision, kind=kind, reason=reason, payment_reference=payment_reference))
