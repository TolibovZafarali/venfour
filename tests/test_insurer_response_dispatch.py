"""Offline durable dispatch coverage for insurer-response analysis jobs."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any

from venfour.insurer_response_processing import (
    CloudTasksInsurerResponseJobDispatcher,
    InsurerResponseDispatchUnavailableError,
    InsurerResponseExecutionResult,
    InsurerResponseProcessingContractError,
    TotalLossInsurerResponseCoordinator,
)
from venfour.package_processing import CloudTasksConfiguration


CASE_ID = "10000000-0000-4000-8000-000000000001"
JOB_ID = "20000000-0000-4000-8000-000000000002"
OTHER_JOB_ID = "30000000-0000-4000-8000-000000000003"


def _configuration() -> CloudTasksConfiguration:
    return CloudTasksConfiguration(
        project="venfour-test",
        location="us-central1",
        queue="case-processing",
        worker_origin="https://worker.example.test",
        oidc_service_account=(
            "case-worker@venfour-test.iam.gserviceaccount.com"
        ),
        oidc_audience="https://worker.example.test",
    )


class _CloudTasksClient:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[dict[str, Any], float]] = []
        self.closed = False

    def create_task(
        self, *, request: dict[str, Any], timeout: float
    ) -> SimpleNamespace:
        self.calls.append((request, timeout))
        if self.error is not None:
            raise self.error
        return SimpleNamespace(name=request["task"]["name"])

    def close(self) -> None:
        self.closed = True


class _Dispatcher:
    def __init__(self, *, failing_jobs: set[str] | None = None) -> None:
        self.failing_jobs = failing_jobs or set()
        self.calls: list[tuple[str, int]] = []

    def dispatch(self, job_id: str, attempt_count: int) -> str:
        self.calls.append((job_id, attempt_count))
        if job_id in self.failing_jobs:
            raise InsurerResponseDispatchUnavailableError("private failure")
        return f"tasks/{job_id}-attempt-{attempt_count}"


class _Database:
    def __init__(self) -> None:
        self.due_rows: list[dict[str, Any]] = []
        self.list_calls: list[int] = []
        self.resolved: dict[str, Any] | None = {
            "job_id": JOB_ID,
            "case_id": CASE_ID,
        }
        self.resolve_calls: list[str] = []

    def list_due_total_loss_insurer_response_analysis_jobs(
        self, limit: int
    ) -> list[dict[str, Any]]:
        self.list_calls.append(limit)
        return list(self.due_rows)

    def resolve_total_loss_insurer_response_analysis_job_case(
        self, job_id: str
    ) -> dict[str, Any] | None:
        self.resolve_calls.append(job_id)
        return dict(self.resolved) if self.resolved is not None else None


class _Processor:
    def __init__(self) -> None:
        self.case_ids: list[str] = []
        self.result = InsurerResponseExecutionResult(
            state="completed",
            case_id=CASE_ID,
            job_id=JOB_ID,
            run_id=OTHER_JOB_ID,
            attempt_count=1,
        )

    def execute(self, case_id: str) -> InsurerResponseExecutionResult:
        self.case_ids.append(case_id)
        return self.result


class CloudTasksInsurerResponseDispatcherTests(unittest.TestCase):
    def test_task_identity_is_deterministic_per_job_attempt(self) -> None:
        client = _CloudTasksClient()
        dispatcher = CloudTasksInsurerResponseJobDispatcher(
            _configuration(), client=client
        )

        first = dispatcher.dispatch(JOB_ID, 0)
        replay = dispatcher.dispatch(JOB_ID, 0)
        retry = dispatcher.dispatch(JOB_ID, 1)

        prefix = (
            "projects/venfour-test/locations/us-central1/queues/"
            "case-processing/tasks/"
        )
        self.assertEqual(first, prefix + f"ira-{JOB_ID}-attempt-0")
        self.assertEqual(replay, first)
        self.assertEqual(retry, prefix + f"ira-{JOB_ID}-attempt-1")
        request, timeout = client.calls[0]
        self.assertEqual(timeout, 10.0)
        self.assertEqual(request["parent"], _configuration().queue_path)
        task = request["task"]
        self.assertEqual(task["name"], first)
        self.assertEqual(
            task["http_request"]["url"],
            "https://worker.example.test/internal/v1/"
            f"insurer-response-analysis-jobs/{JOB_ID}/execute",
        )
        self.assertNotIn("body", task["http_request"])
        self.assertEqual(
            task["http_request"]["oidc_token"],
            {
                "service_account_email": (
                    "case-worker@venfour-test.iam.gserviceaccount.com"
                ),
                "audience": "https://worker.example.test",
            },
        )

    def test_already_existing_task_is_success_and_client_closes(self) -> None:
        class AlreadyExists(Exception):
            pass

        client = _CloudTasksClient(error=AlreadyExists())
        dispatcher = CloudTasksInsurerResponseJobDispatcher(
            _configuration(),
            client=client,
            already_exists_errors=(AlreadyExists,),
        )

        self.assertTrue(dispatcher.dispatch(JOB_ID, 2).endswith("attempt-2"))
        dispatcher.close()
        self.assertTrue(client.closed)

    def test_invalid_job_or_attempt_is_rejected_before_network_io(self) -> None:
        client = _CloudTasksClient()
        dispatcher = CloudTasksInsurerResponseJobDispatcher(
            _configuration(), client=client
        )

        for job_id, attempt in (("owner@example.test", 0), (JOB_ID, -1)):
            with self.subTest(job_id=job_id, attempt=attempt), self.assertRaises(
                (ValueError, InsurerResponseProcessingContractError)
            ):
                dispatcher.dispatch(job_id, attempt)
        self.assertEqual(client.calls, [])


class InsurerResponseCoordinatorTests(unittest.TestCase):
    def test_reconciliation_dispatches_each_due_generation_and_counts_failures(
        self,
    ) -> None:
        database = _Database()
        database.due_rows = [
            {"job_id": JOB_ID, "case_id": CASE_ID, "attempt_count": 0},
            {
                "job_id": OTHER_JOB_ID,
                "case_id": CASE_ID,
                "attempt_count": 2,
            },
        ]
        dispatcher = _Dispatcher(failing_jobs={OTHER_JOB_ID})
        coordinator = TotalLossInsurerResponseCoordinator(
            database, _Processor(), dispatcher
        )

        result = coordinator.reconcile_due(limit=2)

        self.assertTrue(result.dispatcher_configured)
        self.assertEqual((result.due, result.dispatched, result.failed), (2, 1, 1))
        self.assertEqual(
            dispatcher.calls,
            [(JOB_ID, 0), (OTHER_JOB_ID, 2)],
        )
        self.assertEqual(database.list_calls, [2])

    def test_no_dispatcher_is_an_inert_local_fallback(self) -> None:
        database = _Database()
        coordinator = TotalLossInsurerResponseCoordinator(
            database, _Processor()
        )

        result = coordinator.reconcile_due()

        self.assertFalse(coordinator.dispatcher_configured)
        self.assertFalse(result.dispatcher_configured)
        self.assertEqual((result.due, result.dispatched, result.failed), (0, 0, 0))
        self.assertEqual(database.list_calls, [])

    def test_due_rows_are_exact_bounded_and_unique(self) -> None:
        invalid_rows = (
            [{"job_id": JOB_ID, "case_id": CASE_ID}],
            [
                {"job_id": JOB_ID, "case_id": CASE_ID, "attempt_count": 0},
                {"job_id": JOB_ID, "case_id": CASE_ID, "attempt_count": 0},
            ],
            [{"job_id": JOB_ID, "case_id": CASE_ID, "attempt_count": -1}],
        )
        for rows in invalid_rows:
            with self.subTest(rows=rows):
                database = _Database()
                database.due_rows = rows
                coordinator = TotalLossInsurerResponseCoordinator(
                    database, _Processor(), _Dispatcher()
                )
                with self.assertRaises(InsurerResponseProcessingContractError):
                    coordinator.reconcile_due()
        database = _Database()
        coordinator = TotalLossInsurerResponseCoordinator(
            database, _Processor(), _Dispatcher()
        )
        for limit in (0, 101, True):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                coordinator.reconcile_due(limit=limit)

    def test_callback_resolves_current_job_before_case_execution(self) -> None:
        database = _Database()
        processor = _Processor()
        coordinator = TotalLossInsurerResponseCoordinator(database, processor)

        result = coordinator.execute(JOB_ID)

        self.assertEqual(result.to_dict(), {
            "state": "completed",
            "jobId": JOB_ID,
            "attemptCount": 1,
        })
        self.assertEqual(database.resolve_calls, [JOB_ID])
        self.assertEqual(processor.case_ids, [CASE_ID])

    def test_stale_job_is_a_noop_and_raced_identity_is_superseded(self) -> None:
        database = _Database()
        database.resolved = None
        processor = _Processor()
        coordinator = TotalLossInsurerResponseCoordinator(database, processor)

        stale = coordinator.execute(JOB_ID)

        self.assertEqual(stale.state, "not_found")
        self.assertEqual(processor.case_ids, [])

        database.resolved = {"job_id": JOB_ID, "case_id": CASE_ID}
        processor.result = InsurerResponseExecutionResult(
            state="completed",
            case_id=CASE_ID,
            job_id=OTHER_JOB_ID,
            run_id=JOB_ID,
            attempt_count=3,
        )
        raced = coordinator.execute(JOB_ID)
        self.assertEqual(raced.state, "superseded")


if __name__ == "__main__":
    unittest.main()
