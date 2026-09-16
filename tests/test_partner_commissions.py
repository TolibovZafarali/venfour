"""Draft outcome-based commission boundaries; no payment or provider calls."""
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from venfour.partner_commissions import (
    POLICY_ID, PaymentReview, RefundKind, VerifiedOutcome, ineligibility,
    payment_disposition, payout_due_date, record_success, statement_row, verification_month,
)


def outcome(**changes):
    at = datetime(2026, 9, 1, 12, tzinfo=timezone.utc)
    return replace(VerifiedOutcome(
        case_id="case-1", partner_id="partner-1", attribution_id="attribution-1", agreement_digest="a" * 64,
        policy_id=POLICY_ID, service="total_loss", attributed_at=at - timedelta(days=1), paid_at=at,
        service_started_at=at + timedelta(minutes=1), baseline_communicated_at=at - timedelta(days=2),
        accepted_at=at + timedelta(days=5), verified_at=at + timedelta(days=6), reviewer_id="reviewer-1",
        baseline_document_id="baseline-doc", final_document_id="final-doc", acceptance_document_id="acceptance-doc",
        baseline_vehicle_value_minor=2_000_000, final_vehicle_value_minor=2_100_001,
        latest_written_baseline_confirmed=True, equivalent_vehicle_components_confirmed=True,
        process_completed=True, insurer_evidence_verified=True, final_acceptance_verified=True,
        outcome_guarantee_eligible=False, automatic_refund_due=False, relevant_dispute_open=False,
        refund=RefundKind.NONE, regulated_partner=False, compliance_approval_id=None,
    ), **changes)


class DraftCommissionTests(unittest.TestCase):
    def test_strict_threshold_in_cents(self):
        for increase in (-1, 0, 99_999, 100_000):
            with self.subTest(increase=increase):
                self.assertIn("increase_not_greater_than_1000", ineligibility(outcome(final_vehicle_value_minor=2_000_000 + increase)))
        self.assertEqual(ineligibility(outcome()), ())
        with self.assertRaises(ValueError):
            ineligibility(outcome(final_vehicle_value_minor=2_100_001.0))

    def test_ninth_tenth_fifteenth_and_idempotency(self):
        ledger = ()
        for n in range(1, 16):
            fact = outcome(case_id=f"case-{n}", attribution_id=f"attribution-{n}")
            ledger = record_success(ledger, fact)
            self.assertIs(record_success(ledger, fact), ledger)
        self.assertEqual([entry.amount_minor for entry in ledger], [5000] * 9 + [7500] * 6)
        self.assertEqual(sum(entry.amount_minor for entry in ledger), 90000)
        self.assertEqual([entry.sequence for entry in ledger], list(range(1, 16)))
        self.assertEqual(record_success(ledger, outcome(case_id="other", attribution_id="other", partner_id="other"))[-1].amount_minor, 5000)

    def test_central_month_boundaries_winter_and_summer(self):
        for timestamp, month in [
            ("2026-10-01T04:59:59+00:00", "2026-09"), ("2026-10-01T05:00:00+00:00", "2026-10"),
            ("2027-01-01T05:59:59+00:00", "2026-12"), ("2027-01-01T06:00:00+00:00", "2027-01"),
        ]:
            self.assertEqual(verification_month(datetime.fromisoformat(timestamp)), month)
        ledger = record_success((), outcome(verified_at=datetime.fromisoformat("2026-10-01T04:59:59+00:00")))
        ledger = record_success(ledger, outcome(case_id="new", attribution_id="new", verified_at=datetime.fromisoformat("2026-10-01T05:00:00+00:00")))
        self.assertEqual([row.sequence for row in ledger], [1, 1])
        with self.assertRaises(ValueError):
            verification_month(datetime(2026, 10, 1))

    def test_unknown_or_incomplete_facts_do_not_qualify(self):
        for change in [dict(service="diminished_value"), dict(policy_id="future"), dict(baseline_document_id=""),
                       dict(final_document_id=""), dict(acceptance_document_id=""), dict(reviewer_id=""),
                       dict(agreement_digest=""), dict(latest_written_baseline_confirmed=False),
                       dict(equivalent_vehicle_components_confirmed=False), dict(process_completed=False),
                       dict(insurer_evidence_verified=False), dict(final_acceptance_verified=False),
                       dict(outcome_guarantee_eligible=None), dict(outcome_guarantee_eligible=True),
                       dict(automatic_refund_due=True), dict(relevant_dispute_open=True),
                       dict(regulated_partner=True)]:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    record_success((), outcome(**change))
        self.assertEqual(ineligibility(outcome(regulated_partner=True, compliance_approval_id="review-1")), ())

    def test_timing_and_duplicate_attribution_cannot_create_success(self):
        first = outcome()
        for changed in [replace(first, attributed_at=first.paid_at), replace(first, baseline_communicated_at=first.service_started_at),
                        replace(first, verified_at=first.accepted_at - timedelta(seconds=1))]:
            self.assertIn("invalid_event_order", ineligibility(changed))
        ledger = record_success((), first)
        for change in [dict(partner_id="other"), dict(case_id="other"), dict(attribution_id="other"),
                       dict(agreement_digest="b" * 64)]:
            with self.assertRaises(ValueError):
                record_success(ledger, replace(first, **change))
        self.assertEqual(ledger[0].outcome.agreement_digest, "a" * 64)

    def test_verification_is_not_backdated(self):
        ledger = record_success((), outcome())
        with self.assertRaises(ValueError):
            record_success(ledger, outcome(case_id="new", attribution_id="new", verified_at=outcome().verified_at-timedelta(minutes=1)))

    def test_later_of_verification_or_payment_hold_and_following_eligibility_month(self):
        entry = record_success((), outcome())[-1]
        self.assertEqual(entry.eligible_at, outcome().paid_at + timedelta(days=30))
        self.assertEqual(payout_due_date(entry, banking_holidays=frozenset()), date(2026, 11, 16))
        self.assertEqual(payout_due_date(entry, banking_holidays=frozenset({date(2026, 11, 16)})), date(2026, 11, 17))
        later = outcome(verified_at=datetime(2026, 12, 31, 23, tzinfo=timezone.utc))
        entry = record_success((), later)[-1]
        self.assertEqual(entry.eligible_at, later.verified_at)
        self.assertEqual(payout_due_date(entry, banking_holidays=frozenset()), date(2027, 1, 15))

    def test_refunds_reversals_chargebacks_and_goodwill(self):
        entry = record_success((), outcome())[-1]
        for refund in (RefundKind.POLICY, RefundKind.REVERSAL, RefundKind.CHARGEBACK):
            with self.assertRaises(ValueError):
                record_success((), outcome(refund=refund))
            review = PaymentReview(refund, False, False, False)
            self.assertEqual(payment_disposition(entry, review, already_paid=False), "ineligible")
            self.assertEqual(payment_disposition(entry, review, already_paid=True), "documented_recovery_review")
        review = PaymentReview(RefundKind.GOODWILL, False, False, False, True)
        self.assertEqual(payment_disposition(entry, review, already_paid=True), "paid")
        self.assertEqual(payment_disposition(entry, replace(review, outcome_guarantee_eligible=True), already_paid=True), "documented_recovery_review")
        self.assertEqual(payment_disposition(entry, replace(review, goodwill_only_confirmed=False), already_paid=True), "hold_for_review")
        self.assertEqual(payment_disposition(entry, replace(review, relevant_dispute_open=True), already_paid=False), "hold_for_review")
        self.assertEqual(payment_disposition(entry, replace(review, automatic_refund_due=None), already_paid=False), "hold_for_review")
        self.assertEqual(entry.amount_minor, 5000)

    def test_reversal_does_not_renumber_other_cases_and_statement_is_limited(self):
        ledger = ()
        for n in range(10):
            ledger = record_success(ledger, outcome(case_id=str(n), attribution_id=str(n)))
        payment_disposition(ledger[0], PaymentReview(RefundKind.REVERSAL, False, False, False), already_paid=True)
        self.assertEqual(ledger[9].amount_minor, 7500)
        row = statement_row(ledger[9], reference="REF-10", banking_holidays=frozenset(), disposition="eligible_when_due")
        self.assertEqual(set(row), {"reference", "verified_at", "month", "sequence", "commission_minor", "currency", "eligible_at", "payout_due", "status"})
        self.assertEqual(row["commission_minor"], 7500)
