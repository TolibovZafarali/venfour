"""Loopback-only valuation composition with fictional MarketCheck transports."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import sys
import threading
from contextvars import ContextVar
from datetime import UTC, datetime
from uuid import uuid4

from starlette.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.routing import Route

from scripts.local_claim_flow import ROOT, local_database, require_local
from scripts.local_market_fixtures import OUTPUT, SCENARIOS, SUBJECT_VINS, FixtureTransport, extract_fixture, generate_reports
from venfour.case_analyses import CaseAnalysisService
from venfour.creation import AnalysisCreationService
from venfour.efficient_search import EfficientMarketSearch, EfficientSearchPolicy
from venfour.market_request_budget import MarketAccountLimits, MarketRequestBudget, MarketRequestPolicy, market_account_key
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.orchestration import AnalysisOrchestrator
from venfour.report_ingestion import ReportIngestionService, ReportExtractionError
from venfour.vehicle_catalog import VehicleTrimOption

ACCOUNT = market_account_key("localhost-fictional-market-fixtures-v1")
BOOT_ID = str(uuid4())
LOCK = threading.Lock()
DOCUMENT_CONNECTIONS = ContextVar("local_document_connections", default=None)
DOCUMENT_HOST = "api.openai.com"
COUNTERS = {"fixtureAttempts": 0, "blockedExternalAttempts": 0, "blockedNativeTransportAttempts": 0,
            "guardSelfChecksPassed": 0, "documentExtractions": 0}


def require_mock():
    require_local()
    if os.environ.get("VENFOUR_LOCAL_MARKET_FIXTURES") != "1":
        raise RuntimeError("Use the explicit --mock-market local launcher.")
    if os.environ.get("VENFOUR_LOCAL_FULL_FLOW") == "1" or os.environ.get("VENFOUR_LOCAL_STRIPE_CHECKOUT") == "1":
        raise RuntimeError("Provider-backed development modes cannot be combined with market fixtures.")
    if os.environ.get("SUPABASE_URL") not in {None, "http://127.0.0.1:54321"}:
        raise RuntimeError("Only canonical local Supabase is supported.")


def record(event):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with LOCK:
        if event["event"] == "fixture_attempt":
            COUNTERS["fixtureAttempts"] += 1
        with (OUTPUT / "requests.jsonl").open("a") as handle:
            handle.write(json.dumps({"bootId": BOOT_ID, "at": datetime.now(UTC).isoformat(), **event}) + "\n")


def network_audit(event, args):
    host = None
    if event == "socket.getaddrinfo":
        host = args[0]
    elif event == "socket.connect" and isinstance(args[1], tuple):
        host = args[1][0]
    if host is None:
        return
    value = host.decode() if isinstance(host, bytes) else host
    try:
        local = value == "localhost" or ipaddress.ip_address(value).is_loopback
    except ValueError:
        local = False
    document_ips = DOCUMENT_CONNECTIONS.get()
    document_allowed = document_ips is not None and (
        (event == "socket.getaddrinfo" and value == DOCUMENT_HOST) or
        (event == "socket.connect" and value in document_ips and args[1][1] == 443))
    if not local and not document_allowed:
        COUNTERS["blockedExternalAttempts"] += 1
        record({"event": "blocked_external_attempt", "host": str(host)})
        raise PermissionError("Local market fixtures forbid external network traffic.")


def install_network_guard():
    """Only the scoped document reader may resolve and connect to its provider."""
    original = socket.getaddrinfo

    def document_resolution(host, *args, **kwargs):
        addresses = original(host, *args, **kwargs)
        document_ips = DOCUMENT_CONNECTIONS.get()
        value = host.decode() if isinstance(host, bytes) else host
        if value == DOCUMENT_HOST and document_ips is not None:
            document_ips.update(address[4][0] for address in addresses)
        return addresses

    socket.getaddrinfo = document_resolution
    sys.addaudithook(network_audit)
    import venfour.marketcheck as adapter

    def blocked_native(*args, **kwargs):
        COUNTERS["blockedNativeTransportAttempts"] += 1
        record({"event": "blocked_native_transport"})
        raise PermissionError("The native MarketCheck transport is disabled in fixture mode.")

    adapter._UrllibMarketCheckTransport.get = blocked_native
    def direct_ip_probe():
        with socket.socket() as connection:
            connection.connect(("192.0.2.1", 443))

    for probe in (lambda: socket.getaddrinfo("api.marketcheck.com", 443),
                  direct_ip_probe,
                  lambda: adapter._UrllibMarketCheckTransport().get("", {}, {}, 1)):
        try:
            probe()
        except PermissionError:
            COUNTERS["guardSelfChecksPassed"] += 1
        else:
            raise RuntimeError("Network guard self-check failed.")
    record({"event": "guard_ready", "selfChecksPassed": COUNTERS["guardSelfChecksPassed"]})


def creation_factory(repository, run_id):
    gateway = repository.market_request_gateway
    context = {}

    def orchestrator(as_of):
        scenario = context["scenario"]
        with local_database() as connection:
            connection.execute("insert into local_claim_testing.cases(case_id,mode) values(%s,'supportable') "
                               "on conflict (case_id) do nothing", (repository.market_case_id,))
        now = datetime.now(UTC)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1)
        limits = MarketAccountLimits(monthly_allowance=100000, max_requests_per_window=10000,
            rate_window_seconds=1, monthly_period_start=start.isoformat(), monthly_period_end=end.isoformat(),
            monthly_usage_before_tracking=0)
        budget = MarketRequestBudget(gateway, ACCOUNT, repository.market_case_id,
            policy=MarketRequestPolicy(total_attempts=5) if scenario == "budget" else MarketRequestPolicy(),
            account_limits=limits, job_id=repository.market_job_id, processing_token=repository.market_processing_token)
        transport = FixtureTransport(scenario, loss_date=context["loss_date"],
            vehicle=context["vehicle"], postal_code=context["postal_code"],
            record=lambda event: record({**event, "caseId": repository.market_case_id, "scenario": scenario}))
        current = MarketCheckProvider("local-fixture-no-live-credential", transport=transport,
                                      maximum_search_radius_miles=100, request_budget=budget)
        historical = MarketCheckHistoricalProvider("local-fixture-no-live-credential", as_of_date=as_of,
            transport=transport, maximum_search_radius_miles=100, request_budget=budget)
        progress = repository.market_search_progress(7)

        def checkpoint(value):
            progress.save(value)
            if scenario == "resume" and len(value["events"]) == 2:
                marker = OUTPUT / (repository.market_case_id + ".interrupted")
                try:
                    with marker.open("x") as handle:
                        handle.write("Intentional local interruption after durable search checkpoint.\n")
                except FileExistsError:
                    return
                record({"event": "fixture_interruption", "caseId": repository.market_case_id})
                raise RuntimeError("Simulated local interruption; retry reuses saved discovery and verification.")

        return AnalysisOrchestrator(repository, current_provider=current, historical_provider=historical,
            run_id_factory=lambda: run_id,
            market_search=EfficientMarketSearch(current_provider=current, historical_provider=historical,
                budget=budget, policy=EfficientSearchPolicy(), checkpoint=checkpoint, resume_loader=progress.load))

    class FixtureCreationService(AnalysisCreationService):
        def _run_legacy_report(self, report_data, postal_code, **kwargs):
            vehicle = report_data["vehicle"]
            scenario = next((key for key, value in SUBJECT_VINS.items() if value == vehicle.get("vin")), "expansion")
            context.update(scenario=scenario, vehicle=vehicle, postal_code=postal_code,
                loss_date=kwargs.get("loss_date_override") or report_data["report"].get("lossDate") or self._observed_date().isoformat())
            return super()._run_legacy_report(report_data, postal_code, **kwargs)

    return FixtureCreationService(orchestrator, ingestion_service=ingestion_service(),
        report_ingestion_recorder=repository.record_report_ingestion)


def extract_document(path, schema, *, generic=False):
    try:
        return extract_fixture(path, schema)
    except ReportExtractionError:
        if not os.environ.get("OPENAI_API_KEY"):
            raise ReportExtractionError("The document reader requires the configured extraction credential.") from None
    from scripts.extract_report_ai import extract_report_with_openai
    from venfour.report_ingestion import extract_generic_report_with_openai
    token = DOCUMENT_CONNECTIONS.set(set())
    try:
        COUNTERS["documentExtractions"] += 1
        record({"event": "document_extraction", "marketAccess": "MOCKED"})
        extractor = extract_generic_report_with_openai if generic else extract_report_with_openai
        return extractor(path, schema)
    finally:
        DOCUMENT_CONNECTIONS.reset(token)


def ingestion_service():
    return ReportIngestionService(ccc_extractor=extract_document,
        generic_extractor=lambda path, schema: extract_document(path, schema, generic=True), ccc_schema_version="2")


class FixtureCatalog:
    def list_trims(self, request):
        return (VehicleTrimOption("local-fixture", "local-sel", "SEL", "SEL", "trim", ("SEL",)),)


class FixtureChallenge:
    def verify(self, token):
        return token == "XXXX.DUMMY.TOKEN.XXXX"


def status_payload():
    with local_database() as connection:
        rows = connection.execute("select case_id::text,endpoint,phase,count(*) as attempts "
            "from public.market_request_attempts where account_key=%s group by case_id,endpoint,phase "
            "order by case_id,endpoint,phase", (ACCOUNT,)).fetchall()
    return {"mode": "FICTIONAL_LOCAL_FIXTURES", "bootId": BOOT_ID, **COUNTERS,
            "liveMarketCheckRequests": 0, "nativeMarketCheckTransport": "DISABLED",
            "externalNetwork": "DOCUMENT_EXTRACTION_ONLY", "simulatedLedger": rows,
            "ownReportUpload": "CONFIGURED" if os.environ.get("OPENAI_API_KEY") else "EXTRACTION_CREDENTIAL_MISSING",
            "counterNote": "Transport and blocked counters are per process; the ledger persists across restarts. "
                           "Blocked counters include two network probes and one native-transport probe at startup."}


def create_app():
    require_mock()
    for key in list(os.environ):
        if (key.startswith(("MARKETCHECK_", "INSURER_RESPONSE_")) or
            (key.startswith("OPENAI_") and key != "OPENAI_API_KEY") or
            key.upper() in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} or
            key in {"RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"}):
            os.environ.pop(key)
    os.environ["OPENAI_BASE_URL"] = "https://api.openai.com/v1"
    from scripts.local_claim_flow import create_app as fixture_app
    app = fixture_app(network_guard=install_network_guard)
    gateway = app.state.case_analysis_service._gateway
    app.state.case_analysis_service = CaseAnalysisService(gateway, creation_service_factory=creation_factory,
                                                         report_ingestion_service=ingestion_service())
    app.state.vehicle_trim_catalog_service = FixtureCatalog()
    if app.state.case_claim_access_service:
        app.state.case_claim_access_service._turnstile_verifier = FixtureChallenge()
    if app.state.preview_access_service:
        app.state.preview_access_service._verifier = FixtureChallenge()
    app.state.customer_readiness_reasons = ()
    app.state.customer_path_configured = True
    app.state.market_search_readiness_probe = lambda: None

    def overview(request):
        items = "".join(f'<li><a href="/api/local/market-fixtures/reports/{name}.pdf">{name}.pdf</a></li>' for name in SCENARIOS)
        return HTMLResponse('<!doctype html><html><meta charset="utf-8"><title>Local valuation fixtures</title>'
            '<style>body{font:18px system-ui;max-width:800px;margin:60px auto;padding:24px;line-height:1.6}a{color:#18533c}code{font-size:15px}</style>'
            '<h1>Local valuation test</h1><p><strong>Fictional data. Live MarketCheck access is disabled.</strong></p>'
            '<p><a href="/start?service=total-loss">Start your valuation test</a>, choose I have my valuation report, '
            'enter your ZIP, and upload your own CCC PDF. Your document uses the configured document reader. '
            'MarketCheck stays mocked: listings use your extracted vehicle details with fixed fictional prices, '
            'so this tests the flow and does not establish a real vehicle value.</p>'
            '<p>Optional sample reports below use ZIP 63026 and require no external document extraction.</p>'
            '<ul>' + items + '</ul><p>Dense: local results. Expansion: local shortage followed by another geographic center. '
            'Limited: one comparable. Failure: simulated timeouts. Budget: five-attempt cap. '
            'Resume: one intentional interruption; use Retry value check to reuse the saved checkpoint.</p>'
            '<p>For saved account access, open <a href="http://localhost:54324">the local email inbox</a>. '
            'For a paid report, Continue and secure your case first, then run this from the project root:</p>'
            '<pre>.venv/bin/python -m scripts.local_market_flow fulfill CASE_ID</pre>'
            '<p>This records a synthetic local payment and processes the real report workflow. No card or provider is contacted. '
            'Refresh the case and complete its preparation steps to open the report. '
            'Checkout may show payment temporarily unavailable before this helper runs; live Checkout is disabled.</p>'
            '<p><a href="/api/local/market-fixtures/status">Request accounting and network guard status</a></p></html>')

    def fixture_pdf(request):
        name = request.path_params["scenario"]
        if name not in SCENARIOS:
            return JSONResponse({"error": "Unknown fixture"}, 404)
        return FileResponse(OUTPUT / f"{name}.pdf", filename=f"{name}.pdf", media_type="application/pdf")

    def status(request):
        return JSONResponse(status_payload(), headers={"Cache-Control": "no-store"})

    app.router.routes.extend([
        Route("/api/local/market-fixtures", overview),
        Route("/api/local/market-fixtures/reports/{scenario}.pdf", fixture_pdf),
        Route("/api/local/market-fixtures/status", status),
    ])
    return app


def prepare():
    require_mock()
    with local_database() as connection:
        connection.execute((ROOT / "scripts/local-post-continue.sql").read_text())
    generate_reports()
    for name in SCENARIOS:
        ingestion_service().ingest(OUTPUT / f"{name}.pdf")
    print("Local report fixtures and continuation helpers are ready.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "fulfill", "status"))
    parser.add_argument("case_id", nargs="?")
    args = parser.parse_args()
    os.environ["VENFOUR_LOCAL_POST_CONTINUE"] = "1"
    os.environ["VENFOUR_LOCAL_MARKET_FIXTURES"] = "1"
    require_mock()
    if args.command == "prepare":
        prepare()
    elif args.command == "status":
        print(json.dumps(status_payload()))
    else:
        with local_database() as connection:
            if not connection.execute("select 1 from public.market_request_cases where case_id=%s and account_key=%s",
                                      (args.case_id, ACCOUNT)).fetchone():
                raise RuntimeError("Only a case created using these market fixtures may be fulfilled.")
        install_network_guard()
        from scripts.local_claim_flow import pay_fixture
        from scripts.local_claim_package import process_fixture
        print("Local synthetic entitlement:", pay_fixture(args.case_id))
        process_fixture(args.case_id)


if __name__ == "__main__":
    main()
