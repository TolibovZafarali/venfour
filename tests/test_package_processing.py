from __future__ import annotations

import hashlib
import tempfile
import unittest
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from venfour.package_assessment import (
    HUMAN_REVIEW_REQUIRED,
    PackageAssessmentError,
)
from venfour.package_processing import (
    PACKAGE_WORK_TYPE,
    PACKAGE_WORK_VERSION,
    CloudTasksConfiguration,
    CloudTasksWorkItemDispatcher,
    DeterministicPackageAssessmentBuilder,
    GoogleOidcInternalCallerVerifier,
    InternalCallerAuthenticationError,
    InternalOidcConfiguration,
    PackageDispatchUnavailableError,
    PackageProcessingContractError,
    PackageProcessingInputError,
    PackageProcessingUnavailableError,
    PackageStaleFenceError,
    PackageWorkBusyError,
    TotalLossPackageCoordinator,
    TotalLossPackageProcessor,
)
from venfour.supabase_gateway import (
    SupabaseReportNotFoundError,
    SupabaseUnavailableError,
)


CASE_ID = "10000000-0000-4000-8000-000000000001"
OWNER_ID = "20000000-0000-4000-8000-000000000002"
ENTITLEMENT_ID = "30000000-0000-4000-8000-000000000003"
PACKAGE_JOB_ID = "40000000-0000-4000-8000-000000000004"
WORK_ITEM_ID = "50000000-0000-4000-8000-000000000005"
PRELIMINARY_ID = "60000000-0000-4000-8000-000000000006"
ANALYSIS_JOB_ID = "70000000-0000-4000-8000-000000000007"
ANALYSIS_RUN_ID = "80000000-0000-4000-8000-000000000008"
ANALYSIS_INPUT_ID = "90000000-0000-4000-8000-000000000009"
SOURCE_SNAPSHOT_ID = "a0000000-0000-4000-8000-00000000000a"
FINAL_ASSESSMENT_ID = "b0000000-0000-4000-8000-00000000000b"
PROCESSING_TOKEN_1 = "c0000000-0000-4000-8000-00000000000c"
PROCESSING_TOKEN_2 = "d0000000-0000-4000-8000-00000000000d"
PROCESSING_TOKEN_3 = "e0000000-0000-4000-8000-00000000000e"
DISPATCH_TOKEN = "f0000000-0000-4000-8000-00000000000f"
SOURCE_DIGEST = "a" * 64
ASSESSMENT_DIGEST = "b" * 64


class TokenSequence:
    def __init__(self, *values: str) -> None:
        self._values = iter(values)

    def __call__(self) -> UUID:
        return UUID(next(self._values))


class FakeDispatcher:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[str] = []

    def dispatch(self, work_item_id: str) -> str:
        self.calls.append(work_item_id)
        if self.fail:
            raise PackageDispatchUnavailableError("offline")
        return f"tasks/{work_item_id}"


class FakeAssessmentBuilder:
    def __init__(
        self,
        *,
        continuation_status: str = "SUPPORTS_CONTINUATION",
        reason_codes: tuple[str, ...] = ("UNCHANGED_EVIDENCE",),
        source_error: Exception | None = None,
        assessment_error: Exception | None = None,
    ) -> None:
        self.continuation_status = continuation_status
        self.reason_codes = reason_codes
        self.source_error = source_error
        self.assessment_error = assessment_error
        self.source_calls: list[
            tuple[Mapping[str, object], Mapping[str, object] | None]
        ] = []
        self.assessment_calls: list[Mapping[str, object]] = []

    def build_source_snapshot(
        self,
        context: Mapping[str, object],
        source_document: Mapping[str, object] | None,
    ) -> Mapping[str, object]:
        self.source_calls.append((context, source_document))
        if self.source_error is not None:
            raise self.source_error
        return {
            "lineage": {
                "packageJobId": context["package_job_id"],
                "sourceSnapshotId": context["source_snapshot_id"],
            },
            "sourceDocument": source_document,
            "snapshotDigest": SOURCE_DIGEST,
        }

    def build_final_assessment(
        self, source_snapshot: Mapping[str, object]
    ) -> Mapping[str, object]:
        self.assessment_calls.append(source_snapshot)
        if self.assessment_error is not None:
            raise self.assessment_error
        lineage = source_snapshot["lineage"]
        assert isinstance(lineage, Mapping)
        return {
            "lineage": {
                "packageJobId": lineage["packageJobId"],
                "sourceSnapshotId": lineage["sourceSnapshotId"],
            },
            "continuationStatus": self.continuation_status,
            "preliminaryToFinalComparison": {
                "reasonCodes": list(self.reason_codes)
            },
            "validationIssues": [],
            "assessmentDigest": ASSESSMENT_DIGEST,
        }


class FakeDatabase:
    def __init__(self) -> None:
        self.enqueue_calls = 0
        self.reservations: list[Mapping[str, object]] = []
        self.mark_result = True
        self.release_result = True
        self.marked: list[tuple[str, str]] = []
        self.released: list[tuple[str, str, str, int]] = []
        self.claim_calls: list[tuple[str, str]] = []
        self.force_busy = False
        self.force_terminal = False
        self.completed = False
        self.active_token: str | None = None
        self.attempt_count = 0
        self.source_snapshot: Mapping[str, object] | None = None
        self.source_snapshot_id: str | None = None
        self.source_insert_count = 0
        self.assessment: Mapping[str, object] | None = None
        self.assessment_insert_count = 0
        self.final_assessment_id: str | None = None
        self.raise_after_seal_once = False
        self.raise_after_persist_once = False
        self.seal_digest_override: str | None = None
        self.complete_result = True
        self.completions: list[tuple[str, str, str, str, str | None]] = []
        self.failures: list[tuple[str, str, str, str, int]] = []
        self.source_mode = "manual"
        self.report_error: Exception | None = None
        self.materialized_bytes = b"%PDF-1.7\nfixture\n%%EOF\n"
        self.materialize_calls: list[tuple[str, Mapping[str, object], str]] = []

    def enqueue_total_loss_package_job(
        self, entitlement_id: str
    ) -> Mapping[str, object]:
        self.enqueue_calls += 1
        return {
            "outcome": "created" if self.enqueue_calls == 1 else "existing",
            "case_id": CASE_ID,
            "entitlement_id": entitlement_id,
            "package_job_id": PACKAGE_JOB_ID,
            "work_item_id": WORK_ITEM_ID,
            "package_status": "queued",
            "work_item_status": "queued",
            "workflow_revision": 1,
        }

    def reserve_due_workflow_work_items(
        self, dispatch_token: str, limit: int
    ) -> list[Mapping[str, object]]:
        return list(self.reservations[:limit])

    def mark_workflow_work_item_dispatched(
        self, work_item_id: str, dispatch_token: str
    ) -> bool:
        self.marked.append((work_item_id, dispatch_token))
        return self.mark_result

    def release_workflow_work_item_dispatch(
        self,
        work_item_id: str,
        dispatch_token: str,
        error_code: str,
        delay_seconds: int,
    ) -> bool:
        self.released.append(
            (work_item_id, dispatch_token, error_code, delay_seconds)
        )
        return self.release_result

    def _claim_row(self, outcome: str, processing_token: str) -> Mapping[str, object]:
        return {
            "outcome": outcome,
            "case_id": CASE_ID,
            "package_job_id": PACKAGE_JOB_ID,
            "work_item_id": WORK_ITEM_ID,
            "package_status": (
                "assessment_ready" if self.completed else "processing"
            ),
            "work_item_status": "completed" if self.completed else "processing",
            "attempt_count": self.attempt_count or None,
            "processing_token": processing_token if outcome == "claimed" else None,
            "source_snapshot_id": self.source_snapshot_id,
            "final_assessment_id": self.final_assessment_id,
        }

    def claim_total_loss_package_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, object]:
        self.claim_calls.append((work_item_id, processing_token))
        if self.completed:
            return self._claim_row("completed", processing_token)
        if self.force_terminal:
            return self._claim_row("terminal_failed", processing_token)
        if self.force_busy or self.active_token is not None:
            return self._claim_row("busy", processing_token)
        self.active_token = processing_token
        self.attempt_count += 1
        return self._claim_row("claimed", processing_token)

    def resolve_total_loss_package_source_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, object]:
        if processing_token != self.active_token:
            raise AssertionError("stale processing token")
        return {
            "case_id": CASE_ID,
            "owner_user_id": OWNER_ID,
            "entitlement_id": ENTITLEMENT_ID,
            "package_job_id": PACKAGE_JOB_ID,
            "work_item_id": work_item_id,
            "preliminary_snapshot_id": PRELIMINARY_ID,
            "analysis_job_id": ANALYSIS_JOB_ID,
            "analysis_run_id": ANALYSIS_RUN_ID,
            "source_intake_mode": self.source_mode,
            "source_report_upload_id": None,
            "source_analysis_input_revision": 1,
            "source_analysis_input_id": ANALYSIS_INPUT_ID,
            "product_identifier": "total_loss_package",
            "product_version": "1",
            "lineage_current": True,
            "existing_source_snapshot_id": self.source_snapshot_id,
            "existing_source_snapshot": self.source_snapshot,
            "existing_source_snapshot_digest": (
                self.source_snapshot.get("snapshotDigest")
                if self.source_snapshot is not None
                else None
            ),
            "storage_bucket_id": "case-files",
            "storage_owner_id": OWNER_ID,
            "storage_object_name": "private/source.pdf",
            "storage_media_type": "application/pdf",
            "storage_byte_size": None,
            "source_report_original_filename": "valuation.pdf",
            "source_report_uploaded_at": "2026-08-26T12:00:00Z",
        }

    def seal_total_loss_source_snapshot(
        self,
        work_item_id: str,
        processing_token: str,
        snapshot: Mapping[str, object],
    ) -> Mapping[str, object]:
        if processing_token != self.active_token:
            raise AssertionError("stale processing token")
        lineage = snapshot["lineage"]
        assert isinstance(lineage, Mapping)
        requested_id = lineage["sourceSnapshotId"]
        assert isinstance(requested_id, str)
        outcome = "existing"
        if self.source_snapshot is None:
            self.source_snapshot = dict(snapshot)
            self.source_snapshot_id = requested_id
            self.source_insert_count += 1
            outcome = "created"
        elif (
            self.source_snapshot != snapshot
            or self.source_snapshot_id != requested_id
        ):
            raise PackageProcessingContractError("source replay mismatch")
        result = {
            "outcome": outcome,
            "source_snapshot_id": self.source_snapshot_id,
            "source_snapshot_digest": (
                self.seal_digest_override
                if self.seal_digest_override is not None
                else snapshot["snapshotDigest"]
            ),
            "package_status": "source_frozen",
        }
        if self.raise_after_seal_once:
            self.raise_after_seal_once = False
            raise SupabaseUnavailableError("ambiguous source commit")
        return result

    def persist_total_loss_final_assessment(
        self,
        work_item_id: str,
        processing_token: str,
        source_snapshot_id: str,
        assessment: Mapping[str, object],
    ) -> Mapping[str, object]:
        if processing_token != self.active_token:
            raise AssertionError("stale processing token")
        outcome = "existing"
        if self.assessment is None:
            self.assessment = dict(assessment)
            self.assessment_insert_count += 1
            self.final_assessment_id = FINAL_ASSESSMENT_ID
            outcome = "created"
        elif self.assessment != assessment:
            raise PackageProcessingContractError("assessment replay mismatch")
        result = {
            "outcome": outcome,
            "final_assessment_id": self.final_assessment_id,
            "assessment_digest": assessment["assessmentDigest"],
        }
        if self.raise_after_persist_once:
            self.raise_after_persist_once = False
            raise SupabaseUnavailableError("ambiguous assessment commit")
        return result

    def complete_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        final_assessment_id: str,
        package_status: str,
        reason_code: str | None,
    ) -> bool:
        self.completions.append(
            (
                work_item_id,
                processing_token,
                final_assessment_id,
                package_status,
                reason_code,
            )
        )
        if not self.complete_result or processing_token != self.active_token:
            return False
        self.completed = True
        self.active_token = None
        return True

    def fail_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> bool:
        if processing_token != self.active_token:
            return False
        self.failures.append(
            (
                work_item_id,
                processing_token,
                failure_code,
                failure_kind,
                retry_delay_seconds,
            )
        )
        self.active_token = None
        return True

    @contextmanager
    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, object],
        cache_nonce: str,
    ) -> Iterator[Path]:
        self.materialize_calls.append((case_id, storage_locator, cache_nonce))
        if self.report_error is not None:
            raise self.report_error
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.pdf"
            path.write_bytes(self.materialized_bytes)
            yield path


class FakeCloudTasksClient:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[Mapping[str, object], float]] = []

    def create_task(
        self, *, request: Mapping[str, object], timeout: float
    ) -> SimpleNamespace:
        self.calls.append((request, timeout))
        if self.error is not None:
            raise self.error
        task = request["task"]
        assert isinstance(task, Mapping)
        return SimpleNamespace(name=task["name"])


def cloud_tasks_configuration() -> CloudTasksConfiguration:
    return CloudTasksConfiguration(
        project="venfour-test",
        location="us-central1",
        queue="package-finalization",
        worker_origin="https://worker.example.test",
        oidc_service_account=(
            "package-worker@venfour-test.iam.gserviceaccount.com"
        ),
        oidc_audience="https://worker.example.test",
    )


class PackageConfigurationTests(unittest.TestCase):
    def test_cloud_tasks_configuration_is_optional_but_all_or_none(self) -> None:
        self.assertIsNone(CloudTasksConfiguration.from_environment({}))
        with self.assertRaises(ValueError):
            CloudTasksConfiguration.from_environment(
                {"VENFOUR_PACKAGE_TASKS_PROJECT": "venfour-test"}
            )
        with self.assertRaises(ValueError):
            CloudTasksConfiguration(
                project="venfour-test",
                location="us-central1",
                queue="package-finalization",
                worker_origin="http://worker.example.test",
                oidc_service_account=(
                    "package-worker@venfour-test.iam.gserviceaccount.com"
                ),
                oidc_audience="https://worker.example.test",
            )

    def test_internal_oidc_configuration_is_optional_but_all_or_none(self) -> None:
        self.assertIsNone(InternalOidcConfiguration.from_environment({}))
        with self.assertRaises(ValueError):
            InternalOidcConfiguration.from_environment(
                {
                    "VENFOUR_PACKAGE_TASKS_OIDC_AUDIENCE": (
                        "https://worker.example.test"
                    )
                }
            )


class CloudTasksDispatcherTests(unittest.TestCase):
    def test_dispatch_builds_deterministic_opaque_oidc_request(self) -> None:
        client = FakeCloudTasksClient()
        dispatcher = CloudTasksWorkItemDispatcher(
            cloud_tasks_configuration(), client=client
        )

        task_name = dispatcher.dispatch(WORK_ITEM_ID)

        digest = hashlib.sha256(WORK_ITEM_ID.encode("ascii")).hexdigest()
        expected_name = (
            "projects/venfour-test/locations/us-central1/queues/"
            f"package-finalization/tasks/wi-{digest}"
        )
        self.assertEqual(task_name, expected_name)
        request, timeout = client.calls[0]
        self.assertEqual(timeout, 10.0)
        self.assertEqual(request["parent"], cloud_tasks_configuration().queue_path)
        task = request["task"]
        assert isinstance(task, Mapping)
        self.assertEqual(task["name"], expected_name)
        http_request = task["http_request"]
        assert isinstance(http_request, Mapping)
        self.assertEqual(http_request["http_method"], "POST")
        self.assertEqual(
            http_request["url"],
            "https://worker.example.test/internal/v1/work-items/"
            f"{WORK_ITEM_ID}/execute",
        )
        self.assertNotIn("body", http_request)
        self.assertEqual(
            http_request["oidc_token"],
            {
                "service_account_email": (
                    "package-worker@venfour-test.iam.gserviceaccount.com"
                ),
                "audience": "https://worker.example.test",
            },
        )

    def test_already_existing_deterministic_task_is_success(self) -> None:
        class AlreadyExists(Exception):
            pass

        client = FakeCloudTasksClient(error=AlreadyExists())
        dispatcher = CloudTasksWorkItemDispatcher(
            cloud_tasks_configuration(),
            client=client,
            already_exists_errors=(AlreadyExists,),
        )

        self.assertIn(WORK_ITEM_ID[:0], dispatcher.dispatch(WORK_ITEM_ID))

    def test_dispatch_rejects_invalid_work_identity(self) -> None:
        dispatcher = CloudTasksWorkItemDispatcher(
            cloud_tasks_configuration(), client=FakeCloudTasksClient()
        )
        with self.assertRaises(PackageProcessingInputError):
            dispatcher.dispatch("customer@example.test")


class InternalCallerVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.configuration = InternalOidcConfiguration(
            audience="https://worker.example.test",
            service_account_email=(
                "package-worker@venfour-test.iam.gserviceaccount.com"
            ),
        )

    def test_exact_google_workload_identity_is_accepted(self) -> None:
        calls: list[tuple[str, str]] = []

        def verify(token: str, audience: str) -> Mapping[str, object]:
            calls.append((token, audience))
            return {
                "aud": audience,
                "iss": "https://accounts.google.com",
                "email": self.configuration.service_account_email,
                "email_verified": True,
            }

        verifier = GoogleOidcInternalCallerVerifier(
            self.configuration, claims_verifier=verify
        )
        self.assertEqual(
            verifier.verify("signed-token"),
            self.configuration.service_account_email,
        )
        self.assertEqual(
            calls, [("signed-token", "https://worker.example.test")]
        )

    def test_wrong_audience_issuer_email_or_verification_is_rejected(self) -> None:
        valid = {
            "aud": self.configuration.audience,
            "iss": "accounts.google.com",
            "email": self.configuration.service_account_email,
            "email_verified": True,
        }
        mutations = (
            {"aud": "https://other.example.test"},
            {"iss": "https://issuer.example.test"},
            {"email": "other@venfour-test.iam.gserviceaccount.com"},
            {"email_verified": False},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                claims = {**valid, **mutation}
                verifier = GoogleOidcInternalCallerVerifier(
                    self.configuration,
                    claims_verifier=lambda _token, _audience, value=claims: value,
                )
                with self.assertRaises(InternalCallerAuthenticationError):
                    verifier.verify("signed-token")

    def test_malformed_token_is_rejected_before_claim_verification(self) -> None:
        verifier = GoogleOidcInternalCallerVerifier(
            self.configuration,
            claims_verifier=lambda _token, _audience: self.fail(
                "claims verifier must not be called"
            ),
        )
        for value in ("", " token", "token\n"):
            with self.subTest(value=value):
                with self.assertRaises(InternalCallerAuthenticationError):
                    verifier.verify(value)


class PackageCoordinatorTests(unittest.TestCase):
    def test_duplicate_enqueue_converges_on_one_package_and_work_item(self) -> None:
        database = FakeDatabase()
        coordinator = TotalLossPackageCoordinator(database)

        created = coordinator.ensure_for_entitlement(ENTITLEMENT_ID)
        existing = coordinator.ensure_for_entitlement(ENTITLEMENT_ID)

        self.assertEqual(created.state, "created")
        self.assertEqual(existing.state, "existing")
        self.assertEqual(created.package_job_id, existing.package_job_id)
        self.assertEqual(created.work_item_id, existing.work_item_id)

    def test_enqueue_reconciles_durable_due_work_when_dispatch_is_configured(
        self,
    ) -> None:
        database = FakeDatabase()
        database.reservations = [
            {
                "work_item_id": WORK_ITEM_ID,
                "package_job_id": PACKAGE_JOB_ID,
                "work_type": PACKAGE_WORK_TYPE,
                "work_version": PACKAGE_WORK_VERSION,
                "dispatch_attempt_count": 1,
            }
        ]
        dispatcher = FakeDispatcher()
        coordinator = TotalLossPackageCoordinator(
            database,
            dispatcher,
            token_factory=TokenSequence(DISPATCH_TOKEN),
        )

        result = coordinator.ensure_for_entitlement(ENTITLEMENT_ID)

        self.assertTrue(result.dispatch_attempted)
        self.assertEqual(dispatcher.calls, [WORK_ITEM_ID])
        self.assertEqual(database.marked, [(WORK_ITEM_ID, DISPATCH_TOKEN)])

    def test_dispatch_failure_releases_the_durable_reservation(self) -> None:
        database = FakeDatabase()
        database.reservations = [
            {
                "work_item_id": WORK_ITEM_ID,
                "package_job_id": PACKAGE_JOB_ID,
                "work_type": PACKAGE_WORK_TYPE,
                "work_version": PACKAGE_WORK_VERSION,
                "dispatch_attempt_count": 3,
            }
        ]
        coordinator = TotalLossPackageCoordinator(
            database,
            FakeDispatcher(fail=True),
            token_factory=TokenSequence(DISPATCH_TOKEN),
        )

        result = coordinator.reconcile_due(limit=1)

        self.assertEqual((result.reserved, result.dispatched, result.failed), (1, 0, 1))
        self.assertEqual(
            database.released,
            [(WORK_ITEM_ID, DISPATCH_TOKEN, "TASK_DISPATCH_UNAVAILABLE", 8)],
        )

    def test_stale_dispatch_fence_is_rejected(self) -> None:
        database = FakeDatabase()
        database.mark_result = False
        database.reservations = [
            {
                "work_item_id": WORK_ITEM_ID,
                "package_job_id": PACKAGE_JOB_ID,
                "work_type": PACKAGE_WORK_TYPE,
                "work_version": PACKAGE_WORK_VERSION,
                "dispatch_attempt_count": 1,
            }
        ]
        coordinator = TotalLossPackageCoordinator(
            database,
            FakeDispatcher(),
            token_factory=TokenSequence(DISPATCH_TOKEN),
        )
        with self.assertRaises(PackageStaleFenceError):
            coordinator.reconcile_due()

    def test_absent_dispatcher_leaves_database_work_queued(self) -> None:
        database = FakeDatabase()
        result = TotalLossPackageCoordinator(database).reconcile_due()
        self.assertFalse(result.dispatcher_configured)
        self.assertEqual(result.reserved, 0)


class DeterministicAssessmentAdapterTests(unittest.TestCase):
    def test_confirmed_database_facts_are_projected_exactly_to_domain_shape(
        self,
    ) -> None:
        context = {
            "case_id": CASE_ID,
            "package_job_id": PACKAGE_JOB_ID,
            "entitlement_id": ENTITLEMENT_ID,
            "preliminary_snapshot_id": PRELIMINARY_ID,
            "source_snapshot_id": SOURCE_SNAPSHOT_ID,
            "analysis_job_id": ANALYSIS_JOB_ID,
            "analysis_run_id": ANALYSIS_RUN_ID,
            "owner_user_id": OWNER_ID,
            "product_identifier": "total_loss_package",
            "product_version": "1",
            "source_intake_mode": "manual",
            "source_analysis_input_revision": 2,
            "source_analysis_input_id": ANALYSIS_INPUT_ID,
            "confirmed_facts": {
                "case_id": CASE_ID,
                "vin": "4T1G11AK0LU000001",
                "vehicle_year": 2020,
                "vehicle_make": "Toyota",
                "vehicle_model": "Camry",
                "vehicle_trim": "SE",
                "vehicle_configuration": {
                    "source": "catalog",
                    "field": "style",
                    "values": ["SE AWD"],
                },
                "mileage_at_loss": 51_000,
                "postal_code": "78701",
                "date_of_loss": "2026-05-19",
                "insurer_name": "Example Insurance",
                "insurer_vehicle_valuation": Decimal("17750.25"),
                "prior_title_status": None,
                "vehicle_condition": "Good",
                "existing_damage_description": None,
                "vehicle_options_packages": "Technology package",
                "intake_completed_at": "2026-08-26T07:00:00-05:00",
            },
            "analysis_artifact": {},
            "preliminary_presentation": {},
            "preliminary_snapshot": {"classification": "SIGNAL"},
            "preliminary_snapshot_digest": "c" * 64,
            "preliminary_snapshot_schema_version": "1",
        }
        sentinel = object()
        with patch(
            "venfour.package_assessment.build_total_loss_source_snapshot_v1",
            return_value=sentinel,
        ) as build:
            result = DeterministicPackageAssessmentBuilder(
                clock=lambda: datetime(
                    2026, 8, 26, 12, 30, tzinfo=timezone.utc
                )
            ).build_source_snapshot(context, None)

        self.assertIs(result, sentinel)
        arguments = build.call_args.kwargs
        self.assertEqual(arguments["created_at"], "2026-08-26T12:30:00Z")
        self.assertEqual(
            arguments["lineage"]["sourceSnapshotId"], SOURCE_SNAPSHOT_ID
        )
        self.assertEqual(
            arguments["confirmed_facts"],
            {
                "vin": "4T1G11AK0LU000001",
                "year": 2020,
                "make": "Toyota",
                "model": "Camry",
                "trim": "SE",
                "vehicleConfiguration": {
                    "source": "catalog",
                    "field": "style",
                    "values": ["SE AWD"],
                },
                "mileage": 51_000,
                "postalCode": "78701",
                "lossDate": "2026-05-19",
                "insurerName": "Example Insurance",
                "insurerVehicleValuationMinorUnits": 1_775_025,
                "priorTitleStatus": None,
                "condition": "Good",
                "existingDamageDescription": None,
                "optionsPackages": "Technology package",
                "intakeCompletedAt": "2026-08-26T12:00:00Z",
            },
        )
        self.assertEqual(
            arguments["preliminary_snapshot"],
            {"classification": "SIGNAL"},
        )
        self.assertEqual(arguments["preliminary_snapshot_schema_version"], "1")

    def test_fractional_cent_confirmed_valuation_is_rejected(self) -> None:
        with self.assertRaises(PackageProcessingContractError):
            DeterministicPackageAssessmentBuilder._insurer_minor_units(
                Decimal("1.001")
            )


class PackageProcessorTests(unittest.TestCase):
    @staticmethod
    def processor(
        database: FakeDatabase,
        builder: FakeAssessmentBuilder,
        *tokens: str,
    ) -> TotalLossPackageProcessor:
        return TotalLossPackageProcessor(
            database,
            assessment_builder=builder,
            token_factory=TokenSequence(*tokens),
            retry_delay_seconds=30,
        )

    def test_normal_paid_case_reaches_assessment_ready(self) -> None:
        database = FakeDatabase()
        builder = FakeAssessmentBuilder()
        processor = self.processor(
            database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        )

        result = processor.execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_status, "assessment_ready")
        self.assertEqual(database.source_insert_count, 1)
        self.assertEqual(database.assessment_insert_count, 1)
        self.assertEqual(database.completions[0][3:], ("assessment_ready", None))

    def test_no_material_discrepancy_is_still_a_completed_assessment(self) -> None:
        database = FakeDatabase()
        builder = FakeAssessmentBuilder(
            continuation_status="DOES_NOT_SUPPORT_CONTINUATION"
        )
        result = self.processor(
            database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        ).execute(WORK_ITEM_ID)
        self.assertEqual(result.package_status, "assessment_ready")
        self.assertIsNone(database.completions[0][4])

    def test_review_and_new_evidence_outcomes_preserve_bounded_reason(self) -> None:
        cases = (
            ("REVIEW_REQUIRED", "SOURCE_LINEAGE_CONFLICT", "review_required"),
            (
                "NEW_EVIDENCE_REQUIRED",
                "NEW_EVIDENCE_REQUIRED",
                "new_evidence_required",
            ),
        )
        for continuation, reason, expected_status in cases:
            with self.subTest(continuation=continuation):
                database = FakeDatabase()
                builder = FakeAssessmentBuilder(
                    continuation_status=continuation,
                    reason_codes=(reason,),
                )
                result = self.processor(
                    database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
                ).execute(WORK_ITEM_ID)
                self.assertEqual(result.package_status, expected_status)
                self.assertEqual(database.completions[0][4], reason)

    def test_duplicate_delivery_after_completion_is_a_no_op(self) -> None:
        database = FakeDatabase()
        builder = FakeAssessmentBuilder()
        processor = self.processor(
            database,
            builder,
            PROCESSING_TOKEN_1,
            SOURCE_SNAPSHOT_ID,
            PROCESSING_TOKEN_2,
        )

        first = processor.execute(WORK_ITEM_ID)
        second = processor.execute(WORK_ITEM_ID)

        self.assertEqual(first.state, "completed")
        self.assertEqual(second.state, "completed")
        self.assertEqual(len(builder.source_calls), 1)
        self.assertEqual(len(builder.assessment_calls), 1)
        self.assertEqual(database.assessment_insert_count, 1)

    def test_second_worker_observes_busy_lease(self) -> None:
        database = FakeDatabase()
        database.force_busy = True
        processor = self.processor(
            database, FakeAssessmentBuilder(), PROCESSING_TOKEN_1
        )
        with self.assertRaises(PackageWorkBusyError):
            processor.execute(WORK_ITEM_ID)

    def test_retryable_dependency_failure_is_durably_recorded(self) -> None:
        database = FakeDatabase()
        builder = FakeAssessmentBuilder(
            source_error=SupabaseUnavailableError("offline")
        )
        processor = self.processor(
            database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        )

        with self.assertRaises(PackageProcessingUnavailableError):
            processor.execute(WORK_ITEM_ID)

        self.assertEqual(database.failures[0][2:], (
            "PACKAGE_DEPENDENCY_UNAVAILABLE",
            "retryable",
            30,
        ))

    def test_retry_after_pre_freeze_failure_completes_without_duplication(
        self,
    ) -> None:
        database = FakeDatabase()
        failing_builder = FakeAssessmentBuilder(
            source_error=SupabaseUnavailableError("offline")
        )
        first = self.processor(
            database, failing_builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        )

        with self.assertRaises(PackageProcessingUnavailableError):
            first.execute(WORK_ITEM_ID)

        succeeding_builder = FakeAssessmentBuilder()
        result = self.processor(
            database,
            succeeding_builder,
            PROCESSING_TOKEN_2,
            SOURCE_SNAPSHOT_ID,
        ).execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(database.attempt_count, 2)
        self.assertEqual(database.source_insert_count, 1)
        self.assertEqual(database.assessment_insert_count, 1)

    def test_human_review_domain_failure_is_not_retried(self) -> None:
        database = FakeDatabase()
        builder = FakeAssessmentBuilder(
            source_error=PackageAssessmentError(
                "review",
                classification=HUMAN_REVIEW_REQUIRED,
                code="SOURCE_REVIEW_REQUIRED",
            )
        )
        result = self.processor(
            database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        ).execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "review_required")
        self.assertEqual(
            database.failures[0][2:],
            ("SOURCE_REVIEW_REQUIRED", "review_required", 0),
        )

    def test_missing_private_report_enters_review_without_fabrication(self) -> None:
        database = FakeDatabase()
        database.source_mode = "report"
        database.report_error = SupabaseReportNotFoundError("missing")
        builder = FakeAssessmentBuilder()

        result = self.processor(
            database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
        ).execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "review_required")
        self.assertEqual(len(builder.source_calls), 0)
        self.assertEqual(database.failures[0][2], "SOURCE_REPORT_MISSING")

    def test_report_source_binds_validated_materialized_byte_size(self) -> None:
        database = FakeDatabase()
        database.source_mode = "report"
        builder = FakeAssessmentBuilder()
        validated = SimpleNamespace(page_count=2, sha256="c" * 64)
        with patch(
            "venfour.package_processing.validate_canonical_pdf",
            return_value=validated,
        ):
            self.processor(
                database, builder, PROCESSING_TOKEN_1, SOURCE_SNAPSHOT_ID
            ).execute(WORK_ITEM_ID)

        document = builder.source_calls[0][1]
        assert document is not None
        self.assertEqual(document["byteSize"], len(database.materialized_bytes))
        self.assertEqual(document["sha256"], "c" * 64)
        self.assertEqual(document["objectPath"], "private/source.pdf")

    def test_crash_after_source_insert_reuses_exact_immutable_snapshot(self) -> None:
        database = FakeDatabase()
        database.raise_after_seal_once = True
        builder = FakeAssessmentBuilder()
        processor = self.processor(
            database,
            builder,
            PROCESSING_TOKEN_1,
            SOURCE_SNAPSHOT_ID,
            PROCESSING_TOKEN_2,
        )

        with self.assertRaises(PackageProcessingUnavailableError):
            processor.execute(WORK_ITEM_ID)
        with patch(
            "venfour.package_assessment.validate_total_loss_source_snapshot_v1"
        ):
            result = processor.execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(database.source_insert_count, 1)
        self.assertEqual(len(builder.source_calls), 1)
        self.assertEqual(len(builder.assessment_calls), 1)

    def test_crash_after_assessment_insert_reuses_both_immutable_rows(self) -> None:
        database = FakeDatabase()
        database.raise_after_persist_once = True
        builder = FakeAssessmentBuilder()
        processor = self.processor(
            database,
            builder,
            PROCESSING_TOKEN_1,
            SOURCE_SNAPSHOT_ID,
            PROCESSING_TOKEN_2,
        )

        with self.assertRaises(PackageProcessingUnavailableError):
            processor.execute(WORK_ITEM_ID)
        with patch(
            "venfour.package_assessment.validate_total_loss_source_snapshot_v1"
        ):
            result = processor.execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(database.source_insert_count, 1)
        self.assertEqual(database.assessment_insert_count, 1)
        self.assertEqual(len(builder.source_calls), 1)

    def test_stale_completion_fence_rejects_old_worker_failure_write(self) -> None:
        database = FakeDatabase()
        database.complete_result = False
        processor = self.processor(
            database,
            FakeAssessmentBuilder(),
            PROCESSING_TOKEN_1,
            SOURCE_SNAPSHOT_ID,
        )

        with self.assertRaises(PackageStaleFenceError):
            processor.execute(WORK_ITEM_ID)
        self.assertEqual(database.failures, [])

    def test_source_digest_mismatch_fails_closed(self) -> None:
        database = FakeDatabase()
        database.seal_digest_override = "0" * 64
        result = self.processor(
            database,
            FakeAssessmentBuilder(),
            PROCESSING_TOKEN_1,
            SOURCE_SNAPSHOT_ID,
        ).execute(WORK_ITEM_ID)

        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(
            database.failures[0][2:],
            ("SOURCE_LINEAGE_CONFLICT", "terminal", 0),
        )

    def test_terminal_claim_does_not_reload_or_mutate_authoritative_state(self) -> None:
        database = FakeDatabase()
        database.force_terminal = True
        builder = FakeAssessmentBuilder()
        result = self.processor(
            database, builder, PROCESSING_TOKEN_1
        ).execute(WORK_ITEM_ID)
        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(builder.source_calls, [])
        self.assertEqual(database.failures, [])


if __name__ == "__main__":
    unittest.main()
