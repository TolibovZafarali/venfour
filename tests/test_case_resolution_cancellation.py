"""Closure request lifetime stops work on disconnect, deadline, or cancellation."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from venfour.api import _confirm_resolution_for_request
from venfour.supabase_gateway import SupabaseUnavailableError, resolution_request_scope


class CaseResolutionCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def exercise_stopped_request(self, reason: str) -> None:
        started, finished = Event(), Event()
        captured = {}

        @contextmanager
        def scope(cancelled):
            captured["cancelled"] = cancelled
            with resolution_request_scope(cancelled):
                yield

        def confirm(*args):
            started.set()
            try:
                if not captured["cancelled"].wait(1):
                    raise AssertionError("The request did not stop its worker")
                raise SupabaseUnavailableError("Stopped")
            finally:
                finished.set()

        async def is_disconnected():
            return reason == "disconnect" and started.is_set()

        request = SimpleNamespace(
            path_params={"case_id": "case"},
            headers={"authorization": "Bearer local-token"},
            app=SimpleNamespace(state=SimpleNamespace(
                customer_delivery_service=SimpleNamespace(confirm_resolution=confirm),
            )),
            is_disconnected=is_disconnected,
        )
        with patch("venfour.api.resolution_request_scope", scope), patch(
            "venfour.api.CASE_RESOLUTION_TIMEOUT_SECONDS", 0.15,
        ):
            task = asyncio.create_task(_confirm_resolution_for_request(request, {}))
            if reason == "cancel":
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            else:
                with self.assertRaises(SupabaseUnavailableError):
                    await task
        self.assertTrue(captured["cancelled"].is_set())
        self.assertTrue(await asyncio.to_thread(finished.wait, 1))

    async def test_disconnect_stops_worker(self):
        await self.exercise_stopped_request("disconnect")

    async def test_deadline_stops_worker(self):
        await self.exercise_stopped_request("deadline")

    async def test_cancellation_stops_worker(self):
        await self.exercise_stopped_request("cancel")

    async def test_disconnect_poll_swallowing_cancellation_does_not_delay_response(self):
        watching = Event()

        async def is_disconnected():
            watching.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                return False

        def confirm(*args):
            if not watching.wait(1):
                raise AssertionError("Disconnect polling did not start")
            return {"state": "resolved"}

        request = SimpleNamespace(
            path_params={"case_id": "case"},
            headers={"authorization": "Bearer local-token"},
            app=SimpleNamespace(state=SimpleNamespace(
                customer_delivery_service=SimpleNamespace(confirm_resolution=confirm),
            )),
            is_disconnected=is_disconnected,
        )
        result = await asyncio.wait_for(_confirm_resolution_for_request(request, {}), 1)
        self.assertEqual(result, {"state": "resolved"})


if __name__ == "__main__":
    unittest.main()
