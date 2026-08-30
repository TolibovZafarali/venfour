"""Explicitly enabled localhost product-testing composition and terminal helpers."""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from venfour.analysis_runs import AnalysisRunArtifact
from venfour.commerce import (
    CheckoutContext, CommerceUnavailableError, StripeCommerceConfiguration,
    StripePrice, TotalLossCommerceService,
)
from venfour.package_assessment import canonical_package_digest
from venfour.package_processing import TotalLossPackageCoordinator, TotalLossPackageProcessor
from venfour.presentation import AnalysisPresentationProjector
from venfour.supabase_gateway import (
    SupabaseAuthenticationError, SupabaseHttpGateway, SupabaseServerConfiguration,
)

ROOT = Path(__file__).resolve().parents[1]
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
MODES = ("supportable", "exception")


def require_local(environment=None):
    env = os.environ if environment is None else environment
    if env.get("VENFOUR_LOCAL_POST_CONTINUE") != "1":
        raise RuntimeError("Set VENFOUR_LOCAL_POST_CONTINUE=1 explicitly for local testing.")
    if any(env.get(key) for key in ("K_SERVICE", "CLOUD_RUN_JOB", "VENFOUR_STAGING_PROXY_SECRET")):
        raise RuntimeError("Local testing cannot run in a deployed environment.")
    for key in ("SUPABASE_URL", "VENFOUR_PUBLIC_APP_ORIGIN"):
        if env.get(key):
            parsed = urlsplit(env[key])
            if parsed.scheme != "http" or parsed.hostname not in LOOPBACK or parsed.username:
                raise RuntimeError("Local testing requires loopback HTTP services.")
    if (env.get("STRIPE_SECRET_KEY", "").startswith(("sk_live_", "rk_live_"))
        or env.get("STRIPE_PUBLISHABLE_KEY", "").startswith("pk_live_")):
        raise RuntimeError("Live payment credentials are forbidden in local testing.")


def local_status():
    require_local()
    completed = subprocess.run(
        [str(ROOT / "frontend/node_modules/.bin/supabase"), "status", "--output", "json"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    status = json.loads(completed.stdout)
    for key, port in (("API_URL", 54321), ("DB_URL", 54322)):
        parsed = urlsplit(status[key])
        if parsed.hostname not in LOOPBACK or parsed.port != port:
            raise RuntimeError("Refusing a nonstandard or remote data service.")
    return status


def gateway_from_status(status):
    return SupabaseHttpGateway(SupabaseServerConfiguration(
        status["API_URL"], status.get("PUBLISHABLE_KEY", status["ANON_KEY"]),
        status.get("SECRET_KEY", status["SERVICE_ROLE_KEY"]),
    ))


@contextmanager
def local_database():
    status = local_status()
    with psycopg.connect(status["DB_URL"], row_factory=dict_row) as connection:
        yield connection


def marked_case(connection, case_id):
    UUID(case_id)
    row = connection.execute(
        "select m.*, c.user_id from local_claim_testing.cases m "
        "join public.appraisal_cases c on c.id=m.case_id where m.case_id=%s for update of m",
        (case_id,),
    ).fetchone()
    if not row:
        raise RuntimeError("Only a case created by this local synthetic harness is allowed.")
    return row


def block_provider_network():
    """Fail before DNS/connect for every nonlocal host except the test challenge."""
    for key in list(os.environ):
        if key.startswith("OPENAI_") or key == "MARKETCHECK_API_KEY":
            os.environ.pop(key)
    original = socket.getaddrinfo
    if getattr(original, "local_claim_guard", False) is True:
        return

    def guarded(host, *args, **kwargs):
        value = host.decode() if isinstance(host, bytes) else host
        allowed = LOOPBACK | {"challenges.cloudflare.com"}
        if os.environ.get("VENFOUR_LOCAL_STRIPE_CHECKOUT") == "1":
            allowed.add("api.stripe.com")
        if value not in allowed:
            raise RuntimeError("External provider calls are disabled for local claim testing.")
        return original(host, *args, **kwargs)

    guarded.local_claim_guard = True
    socket.getaddrinfo = guarded


def initialize(gateway, claim_service, case_id, access_token):
    if str(UUID(case_id)) != case_id:
        raise ValueError("Invalid case ID")
    user_id = gateway.authenticate(access_token)
    context = gateway._rpc("local_post_continue_context", {
        "requested_case_id": case_id, "requested_user_id": user_id,
    })
    if not context:
        raise LookupError("Case not found")
    if not context["initialized"]:
        artifact = AnalysisRunArtifact.from_dict(context["artifact"])
        presentation = AnalysisPresentationProjector().project(artifact).to_dict()
        if presentation["assessment"]["classification"] not in {
            "MATERIAL_UNDERVALUE_SIGNAL", "POTENTIAL_UNDERVALUE",
        }:
            raise ValueError("This analysis is not eligible for continuation")
        snapshot = {"schemaVersion": "1", "presentation": presentation}
        outcome = gateway._rpc("local_initialize_post_continue", {
            "requested_case_id": case_id, "requested_user_id": user_id,
            "expected_run_id": artifact.run_id,
            "frozen_presentation": presentation,
            "frozen_digest": canonical_package_digest(snapshot),
        })
        if outcome == "not_found":
            raise LookupError("Case not found")
        if outcome not in {"created", "existing"}:
            raise ValueError("The analysis changed or is not eligible")
    return claim_service.resolve(case_id, access_token).to_dict()


def synthetic_artifact(run_id, *, no_dispute=False):
    from dataclasses import replace
    from tempfile import TemporaryDirectory
    from tests.test_analysis_runs import (
        CONSISTENT_PRICES, MATERIAL_PRICES, RecordingCurrentProvider,
        RecordingHistoricalProvider, make_orchestrator, make_run_request,
    )
    from venfour.analysis_runs import FileAnalysisRunRepository
    prices = CONSISTENT_PRICES if no_dispute else MATERIAL_PRICES
    request = make_run_request()
    report = dict(request.ccc_report)
    report["comparables"] = []
    context = {
        "inputMode": "MANUAL", "reportAvailable": False, "reportExtractionAvailable": False,
        "reportProvider": None, "reportAdapter": None, "partialExtraction": False,
        "offerAvailable": True, "insurerValuationAvailable": True,
        "reportComparablesAvailable": False, "reportAdjustmentsAvailable": False,
        "conditionInformationAvailable": False, "optionsInformationAvailable": False,
        "conditionAndOptionsDollarAdjusted": False,
    }
    with TemporaryDirectory() as temporary:
        return make_orchestrator(
            FileAnalysisRunRepository(temporary), run_id=run_id,
            current_provider=RecordingCurrentProvider(prices),
            historical_provider=RecordingHistoricalProvider(prices),
        ).run(replace(request, ccc_report=report, evidence_context=context)).artifact


def create_fixture(owner_id, mode):
    require_local()
    if mode not in MODES:
        raise ValueError("Unknown fixture mode")
    case_id, job_id, run_id, input_id = (str(uuid4()) for _ in range(4))
    artifact = synthetic_artifact(run_id).to_dict()
    with local_database() as db:
        owner = db.execute("select email, is_anonymous from auth.users where id=%s", (owner_id,)).fetchone()
        if not owner:
            raise LookupError("Owner not found")
        email = owner["email"] if not owner["is_anonymous"] else f"local-claim-{case_id[:8]}@example.test"
        db.execute("insert into public.appraisal_cases(id,user_id,service_type,status) values(%s,%s,'total_loss','check_complete')", (case_id, owner_id))
        db.execute("""insert into public.total_loss_case_details(
          case_id,intake_mode,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,
          mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,
          intake_completed_at,analysis_input_revision,analysis_input_id
        ) values(%s,'manual','1ABCDEFGH23456789',2024,'Synthetic','Sedan','SEL',
          50000,'63026','2026-05-19','Synthetic Insurance',20000,now(),1,%s)""", (case_id,input_id))
        db.execute("""insert into public.total_loss_case_contacts(
          case_id,full_name,email,service_terms_version,service_terms_acknowledged_at,
          privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,
          operational_follow_up_updated_at) values(%s,'Local Test Customer',%s,
          '2026-08-23',now(),'2026-08-23',now(),false,now())""", (case_id,email))
        db.execute("""insert into public.total_loss_analysis_jobs(
          id,case_id,source_details_updated_at,status,attempt_count,processing_token,run_id,
          finished_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id
        ) values(%s,%s,now(),'completed',1,%s,%s,now(),'manual',1,%s)""",
          (job_id,case_id,str(uuid4()),run_id,input_id))
        db.execute("""insert into public.analysis_runs(
          id,job_id,case_id,artifact,request_digest,analysis_run_schema_version,analysis_version,
          discrepancy_analysis_version,comparable_scoring_version)
          values(%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (run_id,job_id,case_id,Jsonb(artifact),
            artifact["requestDigest"],artifact["analysisRunSchemaVersion"],artifact["analysisVersion"],
            artifact["discrepancyAnalysisVersion"],artifact["comparableScoringVersion"]))
        db.execute("insert into local_claim_testing.cases(case_id,mode) values(%s,%s)", (case_id,mode))
    return {"caseId": case_id, "email": email, "mode": mode}


def test_commerce_configuration():
    return StripeCommerceConfiguration(
        secret_key="sk_" + "test_" + "local_fixture_only",
        webhook_secret="whsec_" + "local_fixture_only",
        price_id="price_local_fixture", product_identifier="total_loss_advisory_package",
        product_version="local_v1", terms_version="local_v1", refund_policy_version="local_v1",
        public_app_origin="http://localhost:5173",
    )


class LocalPriceProvider:
    def retrieve_price(self, price_id):
        return StripePrice(price_id, 100, "USD", False, True, "one_time", "prod_local_fixture", True)

    def unavailable(self, *args, **kwargs):
        raise CommerceUnavailableError("Use the terminal payment helper or configure sandbox Checkout.")

    verify_webhook = unavailable
    create_checkout_session = unavailable
    retrieve_checkout_session = unavailable
    expire_checkout_session = unavailable
    retrieve_payment_intent = unavailable
    create_refund = unavailable
    retrieve_refund = unavailable
    retrieve_charge = unavailable
    retrieve_dispute = unavailable


def pay_fixture(case_id):
    require_local()
    with local_database() as db:
        row = marked_case(db, case_id)
        existing = db.execute("select id from public.case_entitlements where case_id=%s", (case_id,)).fetchone()
        if existing:
            return str(existing["id"])
        owner_id = str(row["user_id"])
    gateway = gateway_from_status(local_status())
    config = test_commerce_configuration()
    price = LocalPriceProvider().retrieve_price(config.price_id)
    reservation = gateway.reserve_total_loss_checkout(case_id,owner_id,str(uuid4()),config,price)
    if not reservation:
        raise RuntimeError("Secure this claim with its matching permanent owner before simulating payment.")
    attempt_id = reservation["checkout_attempt_id"]
    now = int(time.time())
    with local_database() as db:
        attempt = db.execute("select external_checkout_session_id, external_payment_intent_id from public.checkout_attempts where id=%s", (attempt_id,)).fetchone()
    session = SimpleNamespace(id="cs_test_local_"+uuid4().hex, payment_intent_id="pi_local_"+uuid4().hex,
        customer_id=None, expires_at=now+3600, livemode=False, line_item_price_id=price.id, line_item_quantity=1)
    if attempt["external_checkout_session_id"]:
        if not attempt["external_checkout_session_id"].startswith("cs_test_local_"):
            raise RuntimeError("An actual sandbox Checkout must be paid through Stripe.")
        session.id = attempt["external_checkout_session_id"]
        session.payment_intent_id = attempt["external_payment_intent_id"]
    else:
        gateway.attach_total_loss_checkout_session(attempt_id,session)
    context = CheckoutContext.from_row(gateway.resolve_total_loss_checkout_context(reservation["order_id"],attempt_id))
    event = SimpleNamespace(id="evt_local_"+uuid4().hex,type="checkout.session.completed",livemode=False,
        api_version=None,created=now)
    token = str(uuid4())
    event_claim = gateway.claim_stripe_webhook_event(event,canonical_package_digest({"localCase":case_id}),1,token)
    result = gateway.fulfill_total_loss_checkout_payment(context,session,
        SimpleNamespace(id=session.payment_intent_id,amount_received=100,currency="USD",livemode=False),
        event.id,token,now)
    entitlement_id = result["entitlement_id"]
    gateway.finalize_stripe_webhook_event(event_claim["webhook_event_id"], token, "processed", case_id, reservation["order_id"], None)
    TotalLossPackageCoordinator(gateway,None).ensure_for_entitlement(entitlement_id)
    gateway.close()
    return entitlement_id


def create_app():
    require_local()
    block_provider_network()
    from venfour.api import create_app as production_app
    gateway = gateway_from_status(local_status())
    try:
        configuration = test_commerce_configuration()
        provider = LocalPriceProvider()
        if os.environ.get("VENFOUR_LOCAL_STRIPE_CHECKOUT") == "1":
            from venfour.commerce import StripeSdkGateway
            configuration = StripeCommerceConfiguration.from_environment(os.environ)
            if configuration.livemode:
                raise RuntimeError("Only sandbox Checkout is permitted")
            provider = StripeSdkGateway(configuration)
        coordinator = TotalLossPackageCoordinator(gateway, None)
        commerce = TotalLossCommerceService(gateway, provider, configuration, coordinator)
        app = production_app(supabase_gateway=gateway, commerce_service=commerce,
            package_coordinator=coordinator, package_processor=TotalLossPackageProcessor(gateway))
    except BaseException:
        gateway.close()
        raise

    production_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def local_lifespan(application):
        try:
            async with production_lifespan(application) as state:
                yield state
        finally:
            gateway.close()

    app.router.lifespan_context = local_lifespan

    async def post_continue(request):
        if await request.body():
            return JSONResponse({"error":{"code":"INVALID_INPUT","message":"No request body is accepted."}},400)
        try:
            authorization=request.headers.get("authorization", "")
            if not authorization.startswith("Bearer "):
                raise SupabaseAuthenticationError("Authentication required")
            result=await run_in_threadpool(initialize,gateway,app.state.case_claim_access_service,
                request.path_params["case_id"],authorization[7:])
            return JSONResponse(result,headers={"Cache-Control":"no-store"})
        except SupabaseAuthenticationError:
            status=401
        except LookupError:
            status=404
        except (ValueError, TypeError):
            status=409
        except Exception:
            status=503
        return JSONResponse({"error":{"code":"POST_CONTINUE_UNAVAILABLE","message":"Unable to initialize this claim."}},status,
            headers={"Cache-Control":"no-store"})

    async def new_fixture(request):
        try:
            authorization=request.headers.get("authorization", "")
            if not authorization.startswith("Bearer "):
                raise SupabaseAuthenticationError("Authentication required")
            owner=await run_in_threadpool(gateway.authenticate,authorization[7:])
            payload=await request.json()
            if set(payload) != {"mode"}:
                raise ValueError("Invalid fixture")
            result=await run_in_threadpool(create_fixture,owner,payload["mode"])
            return JSONResponse(result,headers={"Cache-Control":"no-store"})
        except SupabaseAuthenticationError:
            return JSONResponse({"error":"Authentication required"},401)
        except Exception:
            return JSONResponse({"error":"Unable to create local fixture"},400)

    async def loopback_only(request,call_next):
        require_local()
        host=request.url.hostname
        origin=request.headers.get("origin")
        if host not in LOOPBACK or (origin and urlsplit(origin).hostname not in LOOPBACK):
            return JSONResponse({"error":"Local testing only"},404)
        if request.client and request.client.host not in LOOPBACK:
            return JSONResponse({"error":"Local testing only"},404)
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=loopback_only)

    app.router.routes.extend([
        Route("/api/v1/appraisal-cases/{case_id}/post-continue",post_continue,methods=["POST"]),
        Route("/api/local/claim-fixtures",new_fixture,methods=["POST"]),
    ])
    return app


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install","new","pay","process","reset"))
    parser.add_argument("case_id",nargs="?")
    parser.add_argument("--owner")
    parser.add_argument("--mode",choices=MODES,default="supportable")
    args=parser.parse_args()
    require_local()
    if args.command=="install":
        with local_database() as db:
            db.execute((ROOT/"scripts/local-post-continue.sql").read_text())
        print("Local initialization installed. No linked project was contacted.")
    elif args.command=="new":
        print(json.dumps(create_fixture(args.owner,args.mode)))
    elif args.command=="pay":
        print("Synthetic test payment verified; entitlement: "+pay_fixture(args.case_id))
    else:
        from scripts.local_claim_package import process_fixture, reset_fixture
        (process_fixture if args.command=="process" else reset_fixture)(args.case_id)


if __name__ == "__main__":
    main()
