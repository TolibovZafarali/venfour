"""Draft commission rules for trusted, documented outcome review.

This module has no payment side effects or public endpoint. Purchase conversions
and customer-recorded outcomes must never be passed off as verified outcomes.
The release hold remains until the authoritative review workflow and accounting
operations are connected and approved.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from zoneinfo import ZoneInfo

POLICY_ID = "verified-outcome-tiers-v1"
CENTRAL = ZoneInfo("America/Chicago")


class RefundKind(Enum):
    NONE = "none"
    POLICY = "policy"
    REVERSAL = "reversal"
    CHARGEBACK = "chargeback"
    GOODWILL = "discretionary_goodwill"


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError("A timezone-aware recorded time is required")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class VerifiedOutcome:
    """Facts established by an authorized reviewer, never by a customer request."""
    case_id: str
    partner_id: str
    attribution_id: str
    agreement_digest: str
    policy_id: str
    service: str
    attributed_at: datetime
    paid_at: datetime
    service_started_at: datetime
    baseline_communicated_at: datetime
    accepted_at: datetime
    verified_at: datetime
    reviewer_id: str
    baseline_document_id: str
    final_document_id: str
    acceptance_document_id: str
    baseline_vehicle_value_minor: int
    final_vehicle_value_minor: int
    latest_written_baseline_confirmed: bool
    equivalent_vehicle_components_confirmed: bool
    process_completed: bool
    insurer_evidence_verified: bool
    final_acceptance_verified: bool
    outcome_guarantee_eligible: bool | None
    automatic_refund_due: bool | None
    relevant_dispute_open: bool
    refund: RefundKind
    regulated_partner: bool
    compliance_approval_id: str | None


def ineligibility(outcome: VerifiedOutcome) -> tuple[str, ...]:
    """Fail closed on missing evidence, unknown refund eligibility, and timing."""
    reasons = []
    times = {key: _aware(getattr(outcome, key)) for key in (
        "attributed_at", "paid_at", "service_started_at", "baseline_communicated_at", "accepted_at", "verified_at")}
    if outcome.policy_id != POLICY_ID or outcome.service != "total_loss":
        reasons.append("service_or_policy_not_covered")
    if not all((outcome.case_id, outcome.partner_id, outcome.attribution_id, outcome.reviewer_id,
                outcome.baseline_document_id, outcome.final_document_id, outcome.acceptance_document_id)):
        reasons.append("documented_verification_required")
    if len(outcome.agreement_digest) != 64 or any(c not in "0123456789abcdef" for c in outcome.agreement_digest):
        reasons.append("retained_agreement_required")
    if not (times["attributed_at"] < times["paid_at"] <= times["service_started_at"]
            and times["baseline_communicated_at"] < times["service_started_at"]
            <= times["accepted_at"] <= times["verified_at"]):
        reasons.append("invalid_event_order")
    for value in (outcome.baseline_vehicle_value_minor, outcome.final_vehicle_value_minor):
        if type(value) is not int or value < 0:
            raise ValueError("Vehicle values must be nonnegative integer cents")
    if outcome.final_vehicle_value_minor - outcome.baseline_vehicle_value_minor <= 100_000:
        reasons.append("increase_not_greater_than_1000")
    if any(getattr(outcome, key) is not True for key in (
        "latest_written_baseline_confirmed", "equivalent_vehicle_components_confirmed", "process_completed",
        "insurer_evidence_verified", "final_acceptance_verified")):
        reasons.append("outcome_not_verified")
    if outcome.automatic_refund_due is not False or outcome.outcome_guarantee_eligible is not False:
        reasons.append("refund_entitlement_not_cleared")
    if outcome.relevant_dispute_open is not False:
        reasons.append("unresolved_dispute")
    if outcome.refund is not RefundKind.NONE:
        reasons.append("payment_not_retained")
    if outcome.regulated_partner is not False and not outcome.compliance_approval_id:
        reasons.append("regulated_partner_approval_required")
    return tuple(reasons)


def verification_month(verified_at: datetime) -> str:
    return _aware(verified_at).astimezone(CENTRAL).strftime("%Y-%m")


@dataclass(frozen=True)
class CommissionEntry:
    outcome: VerifiedOutcome
    month: str
    sequence: int
    amount_minor: int
    eligible_at: datetime


def record_success(existing: tuple[CommissionEntry, ...], outcome: VerifiedOutcome) -> tuple[CommissionEntry, ...]:
    """Append once; an adapter must serialize by partner and retain these records.

    Reversals must not delete earlier entries or renumber good-faith rates.
    Exactly repeated verification is idempotent; a second partner cannot win.
    """
    for entry in existing:
        if entry.outcome.case_id == outcome.case_id or entry.outcome.attribution_id == outcome.attribution_id:
            if entry.outcome == outcome:
                return existing
            raise ValueError("Case or attribution already recorded; use documented correction review")
    reasons = ineligibility(outcome)
    if reasons:
        raise ValueError(", ".join(reasons))
    verified_at = _aware(outcome.verified_at)
    partner_entries = [entry for entry in existing if entry.outcome.partner_id == outcome.partner_id]
    if any(_aware(entry.outcome.verified_at) > verified_at for entry in partner_entries):
        raise ValueError("Do not backdate verification; review a documented processing correction")
    month = verification_month(verified_at)
    ordinal = sum(entry.month == month for entry in partner_entries) + 1
    entry = CommissionEntry(outcome, month, ordinal, 5000 if ordinal <= 9 else 7500,
                            max(verified_at, _aware(outcome.paid_at) + timedelta(days=30)))
    return (*existing, entry)


def payout_due_date(entry: CommissionEntry, *, banking_holidays: frozenset[date]) -> date:
    """Following eligibility month; caller supplies its reviewed banking calendar."""
    eligible = entry.eligible_at.astimezone(CENTRAL)
    year, month = (eligible.year + 1, 1) if eligible.month == 12 else (eligible.year, eligible.month + 1)
    due = date(year, month, 15)
    while due.weekday() >= 5 or due in banking_holidays:
        due += timedelta(days=1)
    return due


@dataclass(frozen=True)
class PaymentReview:
    refund: RefundKind
    relevant_dispute_open: bool
    automatic_refund_due: bool | None
    outcome_guarantee_eligible: bool | None
    goodwill_only_confirmed: bool = False


def payment_disposition(entry: CommissionEntry, review: PaymentReview, *, already_paid: bool) -> str:
    """Recommend manual handling; never debit, offset, transfer, or erase history."""
    if not isinstance(review.refund, RefundKind):
        raise ValueError("An authoritative payment classification is required")
    if review.relevant_dispute_open is not False:
        return "hold_for_review"
    if review.automatic_refund_due is None or review.outcome_guarantee_eligible is None:
        return "hold_for_review"
    invalid = (review.refund in {RefundKind.POLICY, RefundKind.REVERSAL, RefundKind.CHARGEBACK}
               or review.automatic_refund_due is not False or review.outcome_guarantee_eligible is not False)
    if review.refund is RefundKind.GOODWILL:
        if review.goodwill_only_confirmed is not True:
            return "hold_for_review"
        # Only an already established successful case can retain this exception.
        invalid = invalid or bool(ineligibility(entry.outcome))
    if invalid:
        return "documented_recovery_review" if already_paid else "ineligible"
    return "paid" if already_paid else "eligible_when_due"


def statement_row(entry: CommissionEntry, *, reference: str, banking_holidays: frozenset[date], disposition: str) -> dict:
    """Privacy-limited proposed statement; no customer, evidence, or bank data."""
    return {"reference": reference, "verified_at": entry.outcome.verified_at.isoformat(), "month": entry.month,
            "sequence": entry.sequence, "commission_minor": entry.amount_minor, "currency": "USD",
            "eligible_at": entry.eligible_at.isoformat(),
            "payout_due": payout_due_date(entry, banking_holidays=banking_holidays).isoformat(), "status": disposition}
