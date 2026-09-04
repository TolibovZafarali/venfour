"""Disposable loopback-only integration probe for intake correction.

Run with PYTHONPATH=. .venv/bin/python tests/local_intake_correction_integration.py.
Requires the local Supabase container; creates and removes only its own fixture.
"""
from __future__ import annotations

import json
import secrets
import subprocess
from datetime import date
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql
from starlette.testclient import TestClient

from tests.test_analysis_runs import (
    CURRENT_OBSERVED_DATE,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    make_orchestrator,
)
from venfour.api import create_app
from venfour.case_analyses import CaseAnalysisService
from venfour.creation import AnalysisCreationService
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration


configuration = json.loads(subprocess.check_output(
    ["frontend/node_modules/.bin/supabase", "status", "-o", "json"],
    stderr=subprocess.DEVNULL,
))
for value in (configuration["API_URL"], configuration["DB_URL"]):
    assert urlsplit(value).hostname in {"127.0.0.1", "localhost"}
assert subprocess.check_output(
    ["docker", "inspect", "--format", "{{.Name}}", "supabase_db_venfour"],
    text=True,
).strip() == "/supabase_db_venfour"

origin = configuration["API_URL"].rstrip("/")
details_columns = (
    "case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,"
    "mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,"
    "updated_at,intake_completed_at,analysis_input_id,analysis_input_revision"
)
owner_id, case_id = str(uuid4()), str(uuid4())
email = f"intake-recovery-{owner_id}@example.test"
password = secrets.token_urlsafe(32)
admin_headers = {
    "apikey": configuration["SERVICE_ROLE_KEY"],
    "Authorization": f"Bearer {configuration['SERVICE_ROLE_KEY']}",
}
gateway = SupabaseHttpGateway(SupabaseServerConfiguration(
    url=origin, publishable_key=configuration["ANON_KEY"],
    service_role_key=configuration["SERVICE_ROLE_KEY"],
))
created_owner = False
with psycopg.connect(configuration["DB_URL"]) as db:
    migrations_before = db.execute(
        "select version from supabase_migrations.schema_migrations order by version"
    ).fetchall()

def creation_factory(repository, run_id):
    return AnalysisCreationService(
        lambda _date: make_orchestrator(
            repository, current_provider=RecordingCurrentProvider(),
            historical_provider=RecordingHistoricalProvider(), run_id=run_id,
        ),
        date_factory=lambda: date.fromisoformat(CURRENT_OBSERVED_DATE),
    )

def require_success(response):
    if not response.is_success:
        payload = response.json()
        raise AssertionError(f"Local request failed: {response.status_code} {payload.get('code')} {payload.get('message')}")
    return response.json()

try:
    with httpx.Client(base_url=origin, timeout=30, follow_redirects=False) as client:
        created = require_success(client.post("/auth/v1/admin/users", headers=admin_headers,
            json={"id": owner_id, "email": email, "password": password, "email_confirm": True}))
        assert created["id"] == owner_id
        created_owner = True
        link = require_success(client.post("/auth/v1/admin/generate_link",
            headers=admin_headers, json={"type": "magiclink", "email": email}))
        token = require_success(client.post("/auth/v1/verify",
            headers={"apikey": configuration["ANON_KEY"]},
            json={"type": "magiclink", "token_hash": link["hashed_token"]}))["access_token"]
        user_headers = {
            "apikey": configuration["ANON_KEY"], "Authorization": f"Bearer {token}",
            "Prefer": "return=representation",
        }
        case_response = require_success(client.post("/rest/v1/rpc/get_or_create_total_loss_draft",
            headers=user_headers, json={}))
        case = case_response[0] if isinstance(case_response, list) else case_response
        case_id = case["id"]
        details = require_success(client.post("/rest/v1/total_loss_case_details", headers=user_headers,
            params={"select": details_columns},
            json={"case_id": case_id, "intake_mode": "manual", "vehicle_year": 2024,
                "vehicle_make": "Synthetic", "vehicle_model": "Sedan", "vehicle_trim": "SEL",
                "mileage_at_loss": 50000, "postal_code": "63026", "date_of_loss": "2026-05-19",
                "insurer_name": "Synthetic Insurer", "insurer_vehicle_valuation": None}))[0]
        require_success(client.post("/rest/v1/rpc/save_total_loss_contact_and_begin_claim",
            headers=user_headers, json={"case_id": case_id, "full_name": "Synthetic Recovery",
                "email": email, "service_terms_version": "2026-08-23",
                "privacy_notice_version": "2026-08-23", "operational_follow_up_allowed": False}))
        initial = require_success(client.post("/rest/v1/rpc/confirm_total_loss_intake",
            headers=user_headers,
            json={"case_id": case_id, "expected_details_updated_at": details["updated_at"]}))[0]
        service = CaseAnalysisService(gateway, creation_service_factory=creation_factory,
            lifecycle_event_sink=lambda _line: None)
        first = service.submit(case_id, owner_id)
        assert first.status == "completed"
        presentation = service.get_presentation(first.run_id, owner_id)
        assert presentation["assessment"]["classification"] == "INSUFFICIENT_EVIDENCE"
        assert presentation["analysisScope"]["inputMode"] == "MANUAL"
        assert any(row["code"] == "MISSING_CCC_VEHICLE_VALUATION" for row in presentation["findings"])
        before = gateway.get_total_loss_intake_correction_context(case_id, owner_id)
        assert before["status"] == "check_complete" and before["has_workflow"] is False
        assert before["analysis_input_id"] == initial["analysis_input_id"]
        assert gateway.get_total_loss_intake_correction_context(case_id, str(uuid4())) is None
        assert gateway.reopen_total_loss_intake_for_correction(
            case_id, owner_id, "2026-01-01T00:00:00Z") is False
        assert gateway.reopen_total_loss_intake_for_correction(
            case_id, str(uuid4()), before["updated_at"]) is False
        print("PASS: real local Auth, owner-scoped PostgREST context, stale/other-owner CAS rejection")
        app = create_app(case_analysis_service=service, enable_legacy_api=False)
        with TestClient(app) as api:
            response = api.post(f"/api/v1/appraisal-cases/{case_id}/intake-correction",
                headers={"Authorization": f"Bearer {token}"},
                json={"analysisInputId": initial["analysis_input_id"]})
            assert response.status_code == 200, response.text
            assert response.json() == {"caseId": case_id, "analysisInputId": initial["analysis_input_id"]}
            replay = api.post(f"/api/v1/appraisal-cases/{case_id}/intake-correction",
                headers={"Authorization": f"Bearer {token}"},
                json={"analysisInputId": initial["analysis_input_id"]})
            assert replay.status_code == 200
        reopened = gateway.get_total_loss_intake_correction_context(case_id, owner_id)
        assert reopened["status"] == "draft"
        assert reopened["analysis_input_id"] == before["analysis_input_id"]
        assert reopened["analysis_input_revision"] == before["analysis_input_revision"]
        assert service.status(case_id, owner_id).run_id == first.run_id
        print("PASS: actual correction endpoint and idempotent replay reopen only the parent; inputs/run unchanged")
        current_details = require_success(client.get("/rest/v1/total_loss_case_details",
            headers=user_headers, params={"case_id": f"eq.{case_id}", "select": details_columns}))[0]
        corrected = require_success(client.patch("/rest/v1/total_loss_case_details",
            headers=user_headers, params={"case_id": f"eq.{case_id}",
                "updated_at": f"eq.{current_details['updated_at']}", "select": details_columns},
            json={"insurer_vehicle_valuation": 18500}))[0]
        assert corrected["intake_completed_at"] is None
        assert corrected["analysis_input_id"] != before["analysis_input_id"]
        assert service.status(case_id, owner_id).status == "not_submitted"
        confirmed = require_success(client.post("/rest/v1/rpc/confirm_total_loss_intake",
            headers=user_headers, json={"case_id": case_id,
                "expected_details_updated_at": corrected["updated_at"]}))[0]
        assert service.status(case_id, owner_id).status == "not_submitted"
        with TestClient(app) as api:
            response = api.post(f"/api/v1/appraisal-cases/{case_id}/intake-correction",
                headers={"Authorization": f"Bearer {token}"},
                json={"analysisInputId": confirmed["analysis_input_id"]})
            assert response.status_code == 200, response.text
            assert response.json() == {"caseId": case_id, "analysisInputId": confirmed["analysis_input_id"]}
        assert service.status(case_id, owner_id).status == "not_submitted"
        with psycopg.connect(configuration["DB_URL"]) as db:
            assert db.execute("select count(*) from public.total_loss_analysis_jobs where case_id=%s", (case_id,)).fetchone()[0] == 1
            assert db.execute("select count(*) from public.analysis_runs where case_id=%s", (case_id,)).fetchone()[0] == 1
        print("PASS: actual correction endpoint resumes newly confirmed manual inputs without creating another job or run")
        second = service.submit(case_id, owner_id)
        assert second.status == "completed" and second.run_id != first.run_id
        assert service.get_presentation(second.run_id, owner_id)["insurerValuation"]["value"]["cents"] == 1850000
        assert service.submit(case_id, owner_id).run_id == second.run_id
        with psycopg.connect(configuration["DB_URL"]) as db:
            assert db.execute("select count(*) from public.appraisal_cases where user_id=%s", (owner_id,)).fetchone()[0] == 1
            assert db.execute("select count(*) from public.total_loss_analysis_jobs where case_id=%s", (case_id,)).fetchone()[0] == 2
            assert db.execute("select count(*) from public.analysis_runs where case_id=%s", (case_id,)).fetchone()[0] == 2
        print("PASS: owner RLS update + existing confirm RPC produce a new current run; both immutable histories retained")
        print("PASS: normal completed resume returns the corrected run idempotently; exactly one case and two runs")
finally:
    gateway.close()
    with psycopg.connect(configuration["DB_URL"]) as db:
        db.execute("select 1 from public.appraisal_cases where id=%s and user_id=%s for update", (case_id, owner_id))
        db.execute("set local session_replication_role = replica")
        for table in ("analysis_runs", "total_loss_analysis_jobs", "total_loss_case_identity_claims",
                      "total_loss_case_contacts", "total_loss_case_details"):
            db.execute(sql.SQL("delete from public.{} where case_id=%s").format(sql.Identifier(table)), (case_id,))
        db.execute("delete from public.appraisal_cases where id=%s and user_id=%s", (case_id, owner_id))
    if created_owner:
        with httpx.Client(base_url=origin, timeout=30, follow_redirects=False) as client:
            response = client.delete(f"/auth/v1/admin/users/{owner_id}", headers=admin_headers)
            assert response.is_success
    with psycopg.connect(configuration["DB_URL"]) as db:
        assert db.execute("select count(*) from public.appraisal_cases where id=%s", (case_id,)).fetchone()[0] == 0
        assert db.execute("select count(*) from auth.users where id=%s", (owner_id,)).fetchone()[0] == 0
        assert db.execute("select version from supabase_migrations.schema_migrations order by version").fetchall() == migrations_before
    print("CLEANUP: removed only disposable synthetic fixture rows and test user; schema unchanged")
