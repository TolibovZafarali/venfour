"""Explicit localhost composition for intake, sandbox checkout, and delivery."""
from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from scripts.local_claim_flow import add_continuation_route, gateway_from_status
from venfour.commerce import StripeCommerceConfiguration
from venfour.customer_delivery import CustomerDeliveryService
from venfour.package_processing import TotalLossPackageCoordinator
from venfour.report_review import ReportReviewConfiguration
from venfour.report_review_evals import (
    REPORT_REVIEW_EVAL_ATTESTATION_PATH,
    load_report_review_eval_attestation,
)

ROOT = Path(__file__).resolve().parents[1]
LOCAL_API = "http://127.0.0.1:54321"
APP_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
REQUEST_ORIGINS = APP_ORIGINS | {"http://127.0.0.1:8000", "http://localhost:8000"}
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
PROVIDER_HOSTS = {"api.openai.com", "api.marketcheck.com", "api.stripe.com", "challenges.cloudflare.com"}
REVIEW_KEYS = (
    "OPENAI_REPORT_REVIEW_MODEL", "OPENAI_REPORT_REVIEW_APPROVED_MODEL",
    "OPENAI_REPORT_REVIEW_APPROVED_PROMPT_VERSION", "OPENAI_REPORT_REVIEW_APPROVED_SCHEMA_VERSION",
    "OPENAI_REPORT_REVIEW_APPROVED_EVAL_SUITE_DIGEST", "OPENAI_REPORT_RELEASE_GATE_ENABLED",
)


class LocalSetupError(RuntimeError):
    """A safe, credential-free local setup diagnostic."""


def require_full_flow(environment=None):
    env = os.environ if environment is None else environment
    if env.get("VENFOUR_LOCAL_FULL_FLOW") != "1":
        raise LocalSetupError("Start with node scripts/dev-local.mjs --full-flow.")
    if env.get("VENFOUR_LOCAL_POST_CONTINUE") not in {None, "", "0"}:
        raise LocalSetupError("Full-flow and synthetic fixture modes must remain separate.")
    if any(env.get(key) for key in ("K_SERVICE", "CLOUD_RUN_JOB", "VENFOUR_STAGING_PROXY_SECRET")):
        raise LocalSetupError("Full-flow development cannot run in a deployed environment.")
    if (any(value for key, value in env.items() if key.startswith("VENFOUR_PACKAGE_TASKS_")
            or key == "VENFOUR_PACKAGE_WORKER_ORIGIN")
        or env.get("VENFOUR_ENABLE_LEGACY_ANALYSIS_API") not in {None, "", "0"}):
        raise LocalSetupError("Remote task dispatch and the legacy API must be disabled locally.")
    if env.get("SUPABASE_URL") != LOCAL_API or env.get("VENFOUR_PUBLIC_APP_ORIGIN") not in APP_ORIGINS:
        raise LocalSetupError("Full-flow development requires the canonical local database and app origin.")
    if env.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/") != "https://api.openai.com/v1":
        raise LocalSetupError("Full-flow development requires the standard document-provider endpoint.")
    if not all(env.get(key, "").strip() for key in ("OPENAI_API_KEY", "MARKETCHECK_API_KEY")):
        raise LocalSetupError("Configure both analysis providers in the ignored root .env.")
    try:
        commerce = StripeCommerceConfiguration.from_environment(env)
    except (TypeError, ValueError):
        raise LocalSetupError("Complete the Stripe sandbox configuration in the ignored root .env.") from None
    if commerce.livemode or not env.get("STRIPE_PUBLISHABLE_KEY", "").startswith("pk_test_"):
        raise LocalSetupError("Full-flow development accepts only Stripe sandbox keys.")
    return commerce


def read_local_status():
    require_full_flow()
    result = subprocess.run(
        [str(ROOT / "frontend/node_modules/.bin/supabase"), "status", "--output", "json"],
        cwd=ROOT, capture_output=True, text=True, timeout=20, check=False,
    )
    try:
        if result.returncode != 0:
            raise ValueError()
        status = json.loads(result.stdout)
        database = urlsplit(status["DB_URL"])
        if (status["API_URL"] != LOCAL_API or database.scheme != "postgresql"
            or database.hostname != "127.0.0.1" or database.port != 54322
            or database.path != "/postgres" or database.query or database.fragment):
            raise ValueError()
        if any(os.environ.get(name) != (status.get(preferred) or status.get(fallback)) for name, preferred, fallback in (
            ("SUPABASE_PUBLISHABLE_KEY", "PUBLISHABLE_KEY", "ANON_KEY"),
            ("SUPABASE_SERVICE_ROLE_KEY", "SECRET_KEY", "SERVICE_ROLE_KEY"),
        )):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise LocalSetupError("The running local Supabase stack does not match the application configuration.") from None
    return status


def qualified_review_environment(environment, *, path=REPORT_REVIEW_EVAL_ATTESTATION_PATH):
    selected = {key: environment[key] for key in REVIEW_KEYS if environment.get(key)}
    try:
        if not selected:
            measured = json.loads(Path(path).read_text())
            selected = dict(zip(REVIEW_KEYS, (
                measured["returnedModelIdentifier"], measured["returnedModelIdentifier"],
                measured["promptVersion"], measured["reviewSchemaVersion"],
                measured["evalSuiteDigest"], "true",
            )))
        configuration = ReportReviewConfiguration.from_environment(selected)
        if (not configuration.approval_configuration_complete or not configuration.release_gate_enabled
            or configuration.model_identifier != configuration.approved_model_identifier):
            raise ValueError()
        qualification = load_report_review_eval_attestation(
            expected_model_identifier=configuration.approved_model_identifier,
            expected_prompt_version=configuration.approved_prompt_version,
            expected_review_schema_version=configuration.approved_schema_version,
            expected_eval_suite_digest=configuration.approved_eval_suite_digest,
            path=path,
        )
        if qualification is None:
            raise ValueError()
    except (OSError, KeyError, TypeError, ValueError):
        raise LocalSetupError(
            "Report release needs complete review configuration and a current, all-pass qualification for that exact model."
        ) from None
    return selected


@contextmanager
def review_environment(values):
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def restrict_network():
    original = socket.getaddrinfo

    def guarded(host, *args, **kwargs):
        value = host.decode() if isinstance(host, bytes) else host
        if value not in LOOPBACK | PROVIDER_HOSTS:
            raise RuntimeError("This destination is not allowed in full-flow local development.")
        return original(host, *args, **kwargs)

    socket.getaddrinfo = guarded

    def restore():
        if socket.getaddrinfo is guarded:
            socket.getaddrinfo = original
    return restore


class LocalWorkDispatcher:
    def __init__(self):
        self.pending = []

    def dispatch(self, work_item_id):
        self.pending.append(work_item_id)
        return "local-work/" + work_item_id


class LocalWorker:
    """Use the existing dispatch and execution fences without a remote queue."""
    def __init__(self, gateway, processor):
        self.dispatcher = LocalWorkDispatcher()
        self.coordinator = TotalLossPackageCoordinator(gateway, self.dispatcher)
        self.processor = processor
        self.pending = []
        self.healthy = False

    def reserve(self):
        if self.pending:
            return
        self.dispatcher.pending.clear()
        self.coordinator.reconcile_due(limit=1)
        self.pending.extend(self.dispatcher.pending)
        self.healthy = True

    def tick(self):
        self.reserve()
        pending, self.pending = self.pending, []
        # Reconciliation acknowledges dispatch before execution can finish or fail.
        for work_item_id in pending:
            result = self.processor.execute(work_item_id)
            print(json.dumps({"event": "local_work_item_processed", "state": result.state}), flush=True)
        self.healthy = True
        return bool(pending)

    async def run(self, stop):
        try:
            while not stop.is_set():
                try:
                    worked = await run_in_threadpool(self.tick)
                except Exception:
                    self.healthy = False
                    worked = False
                    print('{"event":"local_worker_unavailable"}', flush=True)
                if worked:
                    continue
                try:
                    await asyncio.wait_for(stop.wait(), timeout=2 if self.healthy else 5)
                except TimeoutError:
                    pass
        finally:
            self.healthy = False


async def loopback_only(request, call_next):
    try:
        require_full_flow()
        origins = request.headers.getlist("origin")
        if (str(request.base_url).rstrip("/") not in REQUEST_ORIGINS
            or len(origins) > 1 or (origins and origins[0] not in APP_ORIGINS)
            or not request.client or request.client.host not in LOOPBACK):
            raise LocalSetupError("Local requests only.")
    except (LocalSetupError, ValueError):
        return JSONResponse({"error": "Local development only"}, 404)
    return await call_next(request)


def create_app():
    require_full_flow()
    status = read_local_status()
    review = qualified_review_environment(os.environ)
    gateway = gateway_from_status(status)
    restore_network = restrict_network()
    try:
        from venfour.api import create_app as production_app
        with review_environment(review):
            app = production_app(
                supabase_gateway=gateway,
                customer_delivery_service=CustomerDeliveryService(gateway),
                package_coordinator=TotalLossPackageCoordinator(gateway),
            )
        worker = LocalWorker(gateway, app.state.package_processor)
        app.state.local_worker = worker
        production_lifespan = app.router.lifespan_context

        @asynccontextmanager
        async def local_lifespan(application):
            try:
                async with production_lifespan(application) as state:
                    await run_in_threadpool(worker.reserve)
                    stop = asyncio.Event()
                    task = asyncio.create_task(worker.run(stop))
                    try:
                        yield state
                    finally:
                        stop.set()
                        await task
            finally:
                gateway.close()
                restore_network()

        def readiness(request):
            ready = (request.app.state.accepting_customer_requests
                     and request.app.state.customer_path_configured and worker.healthy)
            return JSONResponse({"status": "ready" if ready else "not_ready"},
                                200 if ready else 503, headers={"Cache-Control": "no-store"})

        app.router.lifespan_context = local_lifespan
        app.router.routes = [Route("/ready", readiness) if route.path == "/ready" else route
                             for route in app.router.routes]
        add_continuation_route(app, gateway)
        app.add_middleware(BaseHTTPMiddleware, dispatch=loopback_only)
        return app
    except BaseException:
        gateway.close()
        restore_network()
        raise


def prepare():
    status = read_local_status()
    review = qualified_review_environment(os.environ)
    with psycopg.connect(status["DB_URL"], connect_timeout=5) as connection:
        connection.execute((ROOT / "scripts/local-post-continue.sql").read_text())
    return {"reviewEnvironment": review}


if __name__ == "__main__":
    import sys
    try:
        if sys.argv[1:] != ["prepare"]:
            raise LocalSetupError("Use the repository launcher to prepare local development.")
        print(json.dumps(prepare()))
    except Exception as error:
        print(str(error) if isinstance(error, LocalSetupError) else "Local full-flow preparation failed; private details suppressed.", file=sys.stderr)
        raise SystemExit(1) from None
