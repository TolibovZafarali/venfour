"""Offline exact-source continuation and configuration-only payment gates."""

import copy
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from starlette.testclient import TestClient

from scripts.local_claim_flow import synthetic_artifact
from venfour.api import create_app
from venfour.claim_initialization import TotalLossClaimInitializationService
from venfour.commerce import CommerceConflictError, CommerceInputError, CommerceNotFoundError, CommerceUnavailableError
from venfour.full_review import FullReviewService
from venfour.package_assessment import canonical_package_digest
from venfour.presentation import AnalysisPresentationProjector
from venfour.supabase_gateway import SupabaseAuthenticationError, SupabaseContractError, SupabaseHttpGateway
from tests.full_review_fixtures import strict_fixture


class ClaimInitializationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = synthetic_artifact(str(uuid4()))

    def setUp(self):
        self.case, self.user, self.input_id, self.report_id = (str(uuid4()) for _ in range(4))
        self.context = {
            "case_id": self.case, "user_id": self.user,
            "source_run_id": self.artifact.run_id, "source_input_id": self.input_id,
            "source_input_revision": 2, "input": {"analysis_input_revision": 2},
            "artifact": self.artifact.to_dict(),
            "report": {"id": self.report_id, "revision": 5, "source_run_id": self.artifact.run_id,
                       "source_input_id": self.input_id, "status": "ready", "original_filename": "insurer.pdf",
                       "readiness": {"ready": True, "message": "Ready", "issues": []}},
        }
        calculation = strict_fixture()["calculation"]
        self.review_id = str(uuid4())
        self.context["report"]["document_sha256"] = "a"*64
        self.context["strict_review"] = {"id": self.review_id, "review_version": "1", "case_id": self.case,
            "report_id": self.report_id, "report_revision": 5, "source_run_id": self.artifact.run_id,
            "source_input_id": self.input_id, "source_input_revision": 2, "document_sha256": "a"*64,
            "calculation": calculation, "calculation_digest": canonical_package_digest(calculation)}
        self.gateway = Mock(spec=SupabaseHttpGateway)
        self.gateway.authenticate.return_value = self.user
        self.gateway.get_full_review_context.return_value = self.context
        self.gateway.full_review_ready.return_value = True
        self.gateway.initialize_total_loss_post_continue.return_value = "created"
        self.claim = Mock()
        self.claim.resolve.return_value = SimpleNamespace(to_dict=lambda: {"caseId": self.case, "state": "secure_required"})
        self.commerce = SimpleNamespace(checkout_configured=True)
        self.service = TotalLossClaimInitializationService(self.gateway, self.claim, self.commerce)
        self.expected = dict(expected_analysis_input_id=self.input_id, expected_analysis_input_revision=2,
                             expected_report_id=self.report_id, expected_report_revision=5,
                             expected_strict_review_id=self.review_id, expected_strict_review_version="1",
                             expected_strict_review_digest=self.context["strict_review"]["calculation_digest"])

    def initialize(self, **changes):
        return self.service.initialize(self.case, "owner-token", **{**self.expected, **changes})

    def test_initialization_preserves_validated_presentation_and_repeats_idempotently(self):
        original = copy.deepcopy(self.context)
        self.gateway.initialize_total_loss_post_continue.side_effect = ["created", "existing"]
        first = self.initialize()
        self.assertEqual(self.initialize(), first)
        expected_presentation = AnalysisPresentationProjector().project(self.artifact).to_dict()
        args = self.gateway.initialize_total_loss_post_continue.call_args.args
        self.assertEqual(args[:7], (self.case, self.user, self.artifact.run_id, self.input_id, 2, self.report_id, 5))
        self.assertEqual(args[7], expected_presentation)
        self.assertEqual(args[8], canonical_package_digest({"schemaVersion": "1", "presentation": expected_presentation}))
        self.assertEqual(self.context, original)
        self.assertEqual(self.gateway.initialize_total_loss_post_continue.call_args_list[0], self.gateway.initialize_total_loss_post_continue.call_args_list[1])
        self.claim.resolve.assert_called_with(self.case, "owner-token")

    def test_invalid_tokens_fail_before_any_database_access(self):
        for overrides in ({"expected_analysis_input_id": "invalid"}, {"expected_report_id": self.report_id.upper()},
                          {"expected_analysis_input_revision": True}, {"expected_report_revision": 0},
                          {"expected_report_revision": 9007199254740992}, {"expected_report_revision": "5"}):
            with self.subTest(overrides=overrides), self.assertRaises(CommerceInputError):
                self.initialize(**overrides)
        self.gateway.authenticate.assert_not_called()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()

    def test_missing_configuration_fails_before_writes_or_provider_access(self):
        self.commerce.checkout_configured = False
        self.assertFalse(self.service.checkout_available)
        with self.assertRaises(CommerceUnavailableError): self.initialize()
        self.gateway.authenticate.assert_not_called()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()

    def test_unowned_and_incoherent_owner_fail_closed(self):
        self.gateway.get_full_review_context.return_value = None
        with self.assertRaises(CommerceNotFoundError): self.initialize()
        self.gateway.get_full_review_context.return_value = {**self.context, "user_id": str(uuid4())}
        with self.assertRaises(SupabaseContractError): self.initialize()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()

    def test_input_report_and_readiness_changes_cannot_initialize(self):
        for alteration in ("input_id", "input_revision", "report_id", "report_revision", "missing_report", "report_status", "report_readiness", "storage"):
            context = copy.deepcopy(self.context)
            self.gateway.full_review_ready.return_value = True
            if alteration == "input_id": context["source_input_id"] = str(uuid4())
            if alteration == "input_revision": context["source_input_revision"] = 3
            if alteration == "report_id": context["report"]["id"] = str(uuid4())
            if alteration == "report_revision": context["report"]["revision"] = 6
            if alteration == "missing_report": context["report"] = None
            if alteration == "report_status": context["report"]["status"] = "needs_confirmation"
            if alteration == "report_readiness": context["report"]["readiness"]["ready"] = False
            if alteration == "storage": self.gateway.full_review_ready.return_value = False
            self.gateway.get_full_review_context.return_value = context
            with self.subTest(alteration=alteration), self.assertRaises(CommerceConflictError): self.initialize()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()
        self.claim.resolve.assert_not_called()

    def test_invalid_artifact_and_report_source_fail_closed(self):
        for alteration in ("artifact", "run", "report_source", "report_input"):
            context = copy.deepcopy(self.context)
            if alteration == "artifact": context["artifact"] = {}
            if alteration == "run": context["source_run_id"] = str(uuid4())
            if alteration == "report_source": context["report"]["source_run_id"] = str(uuid4())
            if alteration == "report_input": context["report"]["source_input_id"] = str(uuid4())
            self.gateway.get_full_review_context.return_value = context
            with self.subTest(alteration=alteration), self.assertRaises((SupabaseContractError, CommerceConflictError)): self.initialize()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()

    def test_atomic_database_recheck_failure_never_resolves_claim(self):
        for outcome, error in (("stale", CommerceConflictError), ("not_ready", CommerceConflictError),
                               ("not_found", CommerceNotFoundError), ("unexpected", SupabaseContractError)):
            self.gateway.initialize_total_loss_post_continue.return_value = outcome
            with self.subTest(outcome=outcome), self.assertRaises(error): self.initialize()
        self.claim.resolve.assert_not_called()

    def test_full_review_identity_is_available_before_report_upload(self):
        self.context["report"] = None
        public = FullReviewService._public(self.context)
        self.assertEqual((public["analysisInputId"], public["analysisInputRevision"]), (self.input_id, 2))
        self.assertEqual(public["status"], "report_required")
        del self.context["source_input_revision"]
        self.assertEqual(FullReviewService._public(self.context)["analysisInputRevision"], 2)

    def test_api_requires_exact_body_and_routes_checked_service_errors(self):
        body = {"expectedAnalysisInputId": self.input_id, "expectedAnalysisInputRevision": 2,
                "expectedReportId": self.report_id, "expectedReportRevision": 5,
                "expectedStrictReviewId": self.review_id, "expectedStrictReviewVersion": "1",
                "expectedStrictReviewDigest": self.expected["expected_strict_review_digest"]}
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(claim_initialization_service=self.service, enable_legacy_api=False)
        with TestClient(app) as client:
            url = f"/api/v1/appraisal-cases/{self.case}/post-continue"
            self.assertEqual(client.post(url, json=body).status_code, 401)
            headers = {"Authorization": "Bearer owner-token"}
            for invalid in ({}, {**body, "amount": 1}, {**body, "expectedReportRevision": True}):
                self.assertEqual(client.post(url, json=invalid, headers=headers).status_code, 400)
            self.gateway.initialize_total_loss_post_continue.assert_not_called()
            response = client.post(url, json=body, headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("no-store", response.headers["cache-control"])
            self.gateway.authenticate.side_effect = SupabaseAuthenticationError("Invalid")
            self.assertEqual(client.post(url, json=body, headers=headers).status_code, 401)
            self.gateway.authenticate.side_effect = None
            self.gateway.initialize_total_loss_post_continue.return_value = "stale"
            self.assertEqual(client.post(url, json=body, headers=headers).status_code, 409)
            self.commerce.checkout_configured = False
            self.assertEqual(client.post(url, json=body, headers=headers).status_code, 503)

    def test_full_review_availability_requires_strict_evidence_and_configuration(self):
        case_service = Mock()
        case_service.authenticate.return_value = self.user
        review = FullReviewService(self.gateway)
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(case_analysis_service=case_service, full_review_service=review,
                             claim_initialization_service=self.service, enable_legacy_api=False)
        with TestClient(app) as client:
            url = f"/api/v1/appraisal-cases/{self.case}/full-review"
            response = client.get(url, headers={"Authorization": "Bearer owner-token"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertFalse(response.json()["checkoutAvailable"])
            self.assertEqual(response.json()["paymentReadiness"]["status"], "awaiting_approval")
            self.context["payment_approval"] = {"configured": True, "required": True, "approved": True, "status": "approved"}
            response = client.get(url, headers={"Authorization": "Bearer owner-token"})
            self.assertTrue(response.json()["checkoutAvailable"])
            self.assertTrue(response.json()["ready"])
            saved_review = self.context.pop("strict_review")
            self.assertFalse(client.get(url, headers={"Authorization": "Bearer owner-token"}).json()["checkoutAvailable"])
            self.context["strict_review"] = saved_review
            self.commerce.checkout_configured = False
            response = client.get(url, headers={"Authorization": "Bearer owner-token"})
            self.assertFalse(response.json()["checkoutAvailable"])
            self.assertTrue(response.json()["ready"])
        self.gateway.initialize_total_loss_post_continue.assert_not_called()

    def test_gateway_sends_only_the_checked_rpc_arguments(self):
        gateway = object.__new__(SupabaseHttpGateway)
        gateway._rpc = Mock(return_value="created")
        gateway.initialize_total_loss_post_continue(self.case, self.user, self.artifact.run_id,
            self.input_id, 2, self.report_id, 5, {"saved": "presentation"}, "a" * 64, self.review_id, "1", "b"*64)
        name, args = gateway._rpc.call_args.args
        self.assertEqual(name, "initialize_total_loss_post_continue")
        self.assertEqual(args["expected_analysis_input_revision"], 2)
        self.assertEqual(args["expected_report_revision"], 5)
        self.assertEqual(args["frozen_digest"], "a" * 64)
        gateway._rpc.return_value = {"outcome": "created"}
        with self.assertRaises(SupabaseContractError):
            gateway.initialize_total_loss_post_continue(self.case, self.user, self.artifact.run_id,
                self.input_id, 2, self.report_id, 5, {}, "a" * 64, self.review_id, "1", "b"*64)

    def test_missing_pending_failed_stale_and_insufficient_strict_reviews_reject_before_writes(self):
        for state in ("missing", "processing", "terminal_failed", "stale", "insufficient", "low", "unresolved", "digest"):
            context = copy.deepcopy(self.context)
            review = context["strict_review"]
            if state in {"missing", "processing", "terminal_failed"}:
                context.pop("strict_review")
                context["review_work"] = {"status": state}
            if state == "stale": review["source_input_revision"] += 1
            if state == "digest": review["calculation_digest"] = "c"*64
            if state in {"insufficient", "low", "unresolved"}:
                calculation = review["calculation"]
                if state == "insufficient": calculation["artifact"]["result"]["discrepancyResult"]["classification"] = "INSUFFICIENT_EVIDENCE"
                if state == "low": calculation["artifact"]["result"]["discrepancyResult"]["evidenceStrength"] = "LOW"
                if state == "unresolved": calculation["artifact"]["result"]["preliminaryQualification"]["unresolvedMaterialChecks"] = [{"reasonCode": "UNRESOLVED"}]
                review["calculation_digest"] = canonical_package_digest(calculation)
            self.gateway.get_full_review_context.return_value = context
            with self.subTest(state=state), self.assertRaises(CommerceConflictError): self.initialize()
        self.gateway.initialize_total_loss_post_continue.assert_not_called()
