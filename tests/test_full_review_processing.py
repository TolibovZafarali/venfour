"""Durable preparation and payment projection use saved evidence, never a live search."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tests.full_review_fixtures import strict_fixture
from tests.test_full_review import CASE, USER, MemoryGateway
from venfour.full_review import FullReviewService
from venfour.full_review_processing import FullReviewWorkProcessor
from venfour.package_processing import PackageStaleFenceError


class FullReviewProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        fixture = strict_fixture()
        self.gateway = MemoryGateway(Path(self.temp.name), artifact=fixture["artifact"])
        self.gateway.context.update(artifact=fixture["artifact"], input=fixture["input"],
            payment_approval={"configured": True, "required": False, "approved": True, "status": "not_required"},
            source_run_id=fixture["artifact"]["runId"], report={
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "case_id": CASE, "revision": 4,
                "status": "ready", "original_filename": "synthetic.pdf", "byte_size": 123,
                "document_sha256": "a"*64, "readiness": fixture["readiness"], "extraction": fixture["extraction"],
                "source_run_id": fixture["artifact"]["runId"], "source_input_id": self.gateway.context["source_input_id"],
            })
        self.ingestion = Mock()
        self.processor = FullReviewWorkProcessor(self.gateway, ingestion_service=self.ingestion)
        self.service = FullReviewService(self.gateway)
        self.service.extract(CASE, USER)

    def test_completed_extraction_is_reused_and_strict_positive_result_can_pay_without_staff(self):
        before = copy.deepcopy(self.gateway.context["report"])
        result = self.processor.execute(self.gateway.work["id"])
        self.assertEqual(result.state, "completed")
        public = self.service.status(CASE, USER)
        self.assertTrue(public["ready"])
        self.assertTrue(public["paymentReadiness"]["eligible"])
        self.assertEqual(public["paymentReadiness"]["status"], "eligible")
        self.assertEqual(public["paymentReadiness"]["version"], "1")
        self.assertEqual(self.gateway.context["report"], before)
        self.processor.execute(self.gateway.work["id"])
        self.ingestion.ingest.assert_not_called()
        self.assertEqual(self.gateway.context["strict_review"]["calculation"]["newProviderRequests"], 0)

    def test_missing_invalid_held_and_stale_approval_never_unlock_payment(self):
        self.processor.execute(self.gateway.work["id"])
        for approval in (None, {}, {"approved": True},
            {"configured": False, "approved": True, "status": "approved"},
            {"configured": True, "approved": "true", "status": "approved"},
            {"configured": True, "approved": False, "status": "awaiting_approval"},
            {"configured": True, "approved": False, "status": "held"},
            {"configured": True, "approved": False, "status": "declined"}):
            with self.subTest(approval=approval):
                self.gateway.context["payment_approval"] = approval
                state = self.service.status(CASE, USER)
                self.assertFalse(state["paymentReadiness"]["eligible"])
                self.assertEqual(state["paymentReadiness"]["status"], "awaiting_approval")

    def test_automatic_eligibility_does_not_override_a_changed_report_revision(self):
        self.processor.execute(self.gateway.work["id"])
        self.gateway.context["report"]["revision"] += 1
        self.assertFalse(self.service.status(CASE, USER)["paymentReadiness"]["eligible"])

    def test_stale_completion_never_replaces_a_newer_preparation(self):
        with patch.object(self.gateway, "complete_full_review_work", return_value=False), patch.object(self.gateway, "fail_full_review_work") as fail:
            with self.assertRaises(PackageStaleFenceError): self.processor.execute(self.gateway.work["id"])
            fail.assert_not_called()
        self.assertNotIn("strict_review", self.gateway.context)

    def test_acknowledged_upload_returns_accepted_when_dispatch_is_interrupted(self):
        from starlette.testclient import TestClient
        from venfour.api import create_app
        case_service = Mock(); case_service.authenticate.return_value = USER
        review = Mock(); review.extract.return_value = self.service.status(CASE, USER)
        coordinator = Mock(); coordinator.reconcile_due.side_effect = RuntimeError("dispatch unavailable")
        with TestClient(create_app(case_analysis_service=case_service, full_review_service=review,
                package_coordinator=coordinator, enable_legacy_api=False)) as client:
            response = client.post(f"/api/v1/appraisal-cases/{CASE}/full-review/extract", headers={"Authorization": "Bearer owner"})
        self.assertEqual(response.status_code, 202)
        self.assertFalse(response.json()["checkoutAvailable"])
        self.assertEqual(response.json()["paymentReadiness"]["status"], "processing")
        coordinator.reconcile_due.assert_called_once_with(limit=1)
