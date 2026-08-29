"""Terminal-only synthetic package execution and selected-case cleanup."""
from __future__ import annotations

import time
from types import SimpleNamespace
from uuid import uuid4

from psycopg import sql

from scripts.local_claim_flow import (
    block_provider_network, gateway_from_status, local_database, local_status,
    marked_case, require_local,
)
from venfour.package_assessment import canonical_package_digest
from venfour.package_processing import TotalLossPackageProcessor
from venfour.report_processing import TotalLossReportProcessor, TotalLossWorkItemProcessor
from venfour.report_review import (
    CompletedReportReview, ReportQualityReviewV1, ReportReviewConfiguration,
    REPORT_REVIEW_PROMPT_VERSION, REPORT_REVIEW_SCHEMA_VERSION,
    REPORT_REVIEW_PROVIDER_IDENTIFIER,
)
from venfour.report_review_evals import (
    REPORT_REVIEW_EVAL_SCENARIO_IDS, build_report_review_eval_attestation_v1,
    report_review_eval_suite_digest,
)

MODEL = "local-deterministic-fixture-v1"


class LocalReviewer:
    def __init__(self, mode):
        self.mode = mode

    def review(self, request):
        from tests.test_report_review import pass_review_payload, held_review_payload
        payload = (held_review_payload(request) if self.mode == "exception"
                   else pass_review_payload(request))
        review = ReportQualityReviewV1.from_dict(payload, request=request)
        return CompletedReportReview(
            provider_identifier=REPORT_REVIEW_PROVIDER_IDENTIFIER,
            configured_model_identifier=MODEL, returned_model_identifier=MODEL,
            prompt_version=REPORT_REVIEW_PROMPT_VERSION, schema_version=REPORT_REVIEW_SCHEMA_VERSION,
            input_digest=request.input_digest, output_digest=canonical_package_digest(review.to_dict()),
            review=review, usage_metadata={"inputTokens": 0, "outputTokens": 0},
        )


class LocalRefunds:
    def __init__(self, gateway):
        self.gateway = gateway

    def refund(self, **kwargs):
        with local_database() as db:
            marked_case(db, kwargs["case_id"])
        row = self.gateway.reserve_total_loss_refund(**kwargs)
        if not row or row["provider_livemode"]:
            raise RuntimeError("Only synthetic sandbox payments can be refunded")
        if not row["external_payment_intent_id"].startswith("pi_local_"):
            raise RuntimeError("Use sandbox Stripe to refund actual test Checkout payments")
        if row["state"] != "already_succeeded":
            refund = SimpleNamespace(id="re_local_"+uuid4().hex,
                status="succeeded", amount=row["amount_minor_units"], currency=row["currency"],
                livemode=False, balance_transaction_id=None, failure_balance_transaction_id=None)
            self.gateway.record_total_loss_refund_result(row["refund_request_id"],refund,None,None,int(time.time()))
        return SimpleNamespace(refund_status="succeeded")


def process_fixture(case_id):
    require_local()
    with local_database() as db:
        case = marked_case(db, case_id)
    if case["mode"] == "no-dispute":
        raise RuntimeError("No-dispute needs a separate downstream fixture: the frozen assessment cannot change classification during review.")
    block_provider_network()
    gateway = gateway_from_status(local_status())
    digest = report_review_eval_suite_digest()
    config = ReportReviewConfiguration(model_identifier=MODEL,approved_model_identifier=MODEL,
        approved_prompt_version=REPORT_REVIEW_PROMPT_VERSION,approved_schema_version=REPORT_REVIEW_SCHEMA_VERSION,
        approved_eval_suite_digest=digest,release_gate_enabled=True)
    attestation = build_report_review_eval_attestation_v1(returned_model_identifier=MODEL,
        prompt_version=REPORT_REVIEW_PROMPT_VERSION,review_schema_version=REPORT_REVIEW_SCHEMA_VERSION,
        eval_suite_digest=digest,passed_case_count=len(REPORT_REVIEW_EVAL_SCENARIO_IDS),
        total_case_count=len(REPORT_REVIEW_EVAL_SCENARIO_IDS),evaluated_at="2026-08-29T00:00:00Z")
    processor = TotalLossWorkItemProcessor(gateway,TotalLossPackageProcessor(gateway),
        TotalLossReportProcessor(gateway,reviewer=LocalReviewer(case["mode"]),review_configuration=config,
            provider_evaluation_attestation=attestation.to_dict(),commerce_service=LocalRefunds(gateway)))
    for _ in range(6):
        with local_database() as db:
            work = db.execute("select id,work_type from public.workflow_work_items "
                "where case_id=%s and status in ('queued','dispatching','retryable_failed') "
                "order by created_at limit 1",(case_id,)).fetchone()
        if not work:
            break
        result = processor.execute(str(work["id"]))
        print(work["work_type"],result.state)
    with local_database() as db:
        workflow=db.execute("select current_task from public.total_loss_claim_workflows where case_id=%s",(case_id,)).fetchone()
        print("Current task:", workflow["current_task"] if workflow else "Continue first")
    gateway.close()


def reset_fixture(case_id):
    require_local()
    with local_database() as db:
        marked_case(db,case_id)
        # A transaction-scoped replica setting permits deleting immutable synthetic
        # descendants. It is never exposed through an RPC or browser endpoint.
        db.execute("select 1 from public.appraisal_cases where id=%s for update",(case_id,))
        active=db.execute("select 1 from public.workflow_work_items where case_id=%s "
            "and status='processing' and processing_expires_at>now()",(case_id,)).fetchone()
        if active:
            raise RuntimeError("Wait for the local processor to finish before resetting")
        tables = (
            "total_loss_sending_details", "total_loss_communication_documents",
            "total_loss_communications", "total_loss_message_versions", "total_loss_message_drafts",
            "total_loss_education_progress", "total_loss_negotiation_rounds",
            "total_loss_release_reviews", "total_loss_ai_review_runs", "total_loss_report_versions",
            "total_loss_claim_documents", "total_loss_report_series", "total_loss_final_assessments",
            "total_loss_source_snapshots", "workflow_work_items", "total_loss_package_jobs",
            "total_loss_workflow_events", "total_loss_fact_assertions", "total_loss_offers",
            "total_loss_recommendations", "commerce_disputes", "commerce_refund_requests",
            "stripe_webhook_events", "payment_transactions", "checkout_attempts", "case_entitlements",
            "commerce_orders", "total_loss_claim_workflows", "total_loss_preliminary_snapshots",
        )
        db.execute("set local session_replication_role = replica")
        for table in tables:
            db.execute(sql.SQL("delete from public.{} where case_id=%s").format(sql.Identifier(table)),(case_id,))
    print("Reset synthetic post-Continue rows; original analysis and owner retained:",case_id)
