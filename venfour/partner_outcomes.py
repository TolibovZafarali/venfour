"""Manager-reviewed referral outcomes backed by retained case evidence."""
from datetime import datetime
from uuid import UUID

from venfour.partner_commissions import ineligibility
from venfour.partner_earnings import CommissionLedger, restore_outcome
from venfour.partner_service import PartnerError

DECISIONS = {'approved', 'needs_evidence', 'ineligible'}
DOCUMENT_FIELDS = ('baseline_document_id', 'final_document_id', 'acceptance_document_id', 'review_document_id')
TIME_FIELDS = ('baseline_communicated_at', 'service_started_at', 'accepted_at')
CONFIRMATIONS = ('latest_written_baseline_confirmed', 'equivalent_vehicle_components_confirmed', 'process_completed',
                 'insurer_evidence_verified', 'final_acceptance_verified', 'refund_rights_reviewed',
                 'no_outcome_dispute', 'unregulated_partner_confirmed')
FACT_FIELDS = {*DOCUMENT_FIELDS, *TIME_FIELDS, *CONFIRMATIONS, 'baseline_vehicle_value_minor', 'final_vehicle_value_minor'}


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def validate_request(action, payload):
    fields = {'partner_id'} if action == 'outcome_queue' else {'partner_id', 'attribution_id'}
    if action == 'outcome_queue':
        fields |= {'page'}
    if action == 'outcome_decide':
        fields |= {'request_id', 'source_digest', 'decision', 'notes', 'facts'}
    valid = set(payload) == fields and valid_uuid(payload.get('partner_id'))
    if action != 'outcome_queue':
        valid = valid and valid_uuid(payload.get('attribution_id'))
    else:
        valid = valid and type(payload.get('page')) is int and 1 <= payload['page'] <= 100000
    if action == 'outcome_decide':
        import re
        valid = valid and valid_uuid(payload.get('request_id')) and isinstance(payload.get('source_digest'), str) and bool(re.fullmatch('[0-9a-f]{64}', payload['source_digest']))
        valid = valid and isinstance(payload.get('decision'), str) and payload['decision'] in DECISIONS and isinstance(payload.get('notes'), str) and 20 <= len(payload['notes'].strip()) <= 2000
        facts = payload.get('facts')
        valid = valid and isinstance(facts, dict) and (set(facts) == FACT_FIELDS if payload.get('decision') == 'approved' else facts == {})
        if valid and payload['decision'] == 'approved':
            valid = all(valid_uuid(facts.get(k)) for k in DOCUMENT_FIELDS) and all(facts.get(k) is True for k in CONFIRMATIONS)
            valid = valid and all(type(facts.get(k)) is int and 0 <= facts[k] <= 9_007_199_254_740_991 for k in ('baseline_vehicle_value_minor', 'final_vehicle_value_minor'))
            try:
                valid = valid and all(isinstance(facts[k], str) and datetime.fromisoformat(facts[k].replace('Z', '+00:00')).utcoffset() is not None for k in TIME_FIELDS)
            except ValueError:
                valid = False
    if not valid:
        raise PartnerError(400, 'INVALID_OUTCOME_REVIEW', 'Complete the evidence, review notes, and required confirmations.')


def decide(gateway, payload, token):
    context = gateway.operation('outcome_prepare', payload, token)
    if 'result' in context:
        return context['result']
    award = None
    if payload['decision'] == 'approved':
        if not context['source']['program_enabled'] or context['source']['payment_held']:
            raise PartnerError(409, 'OUTCOME_BLOCKED', 'The agreement or payment needs review before approval.')
        facts = payload['facts']
        documents = {d['id'] for d in context['source']['documents']}
        if any(facts[k] not in documents for k in DOCUMENT_FIELDS):
            raise PartnerError(400, 'OUTCOME_EVIDENCE_REQUIRED', 'Select retained evidence from this case.')
        source = context['source']
        outcome = restore_outcome({k: facts[k] for k in (*TIME_FIELDS, *DOCUMENT_FIELDS[:3], 'baseline_vehicle_value_minor', 'final_vehicle_value_minor', *CONFIRMATIONS[:5])} | {
            'case_id': source['case_id'], 'partner_id': payload['partner_id'], 'attribution_id': payload['attribution_id'],
            'agreement_digest': source['agreement_digest'], 'policy_id': 'verified-outcome-tiers-v1', 'service': 'total_loss',
            'attributed_at': source['attributed_at'], 'paid_at': source['paid_at'], 'verified_at': context['verified_at'],
            'reviewer_id': context['reviewer_id'], 'refund': 'none', 'relevant_dispute_open': False,
            'automatic_refund_due': False, 'outcome_guarantee_eligible': False, 'regulated_partner': False, 'compliance_approval_id': None,
        })
        reasons = ineligibility(outcome)
        if reasons:
            raise PartnerError(400, 'OUTCOME_NOT_QUALIFIED', 'The evidence does not meet the timing, value increase, or successful-outcome requirements.')
        try:
            award = CommissionLedger(gateway).prepare(outcome)
        except ValueError as exc:
            raise PartnerError(409, 'OUTCOME_CHANGED', 'Commission records changed. Reload this review before approving.') from exc
    return gateway.outcome_worker({'request': payload, 'reviewer_id': context['reviewer_id'], 'verified_at': context['verified_at'], 'award': award})
