"""Validate and resume one local sandbox purchase missing its report evidence."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from scripts.local_claim_flow import gateway_from_status
from venfour.package_processing import TotalLossPackageProcessor
from venfour.report_evidence import validate_report_evidence_for_artifact
from venfour.report_ingestion import ReportIngestionResult

ROOT = Path(__file__).resolve().parents[1]


def local_status(environment=None):
    env = os.environ if environment is None else environment
    if (env.get("VENFOUR_LOCAL_FULL_FLOW") != "1"
        or env.get("VENFOUR_LOCAL_POST_CONTINUE") not in {None, "", "0"}
        or any(env.get(key) for key in ("K_SERVICE", "CLOUD_RUN_JOB", "VENFOUR_STAGING_PROXY_SECRET"))):
        raise ValueError("Recovery requires explicit local full-flow mode.")
    for key, allowed in (
        ("SUPABASE_URL", {"http://127.0.0.1:54321"}),
        ("VENFOUR_PUBLIC_APP_ORIGIN", {"http://localhost:5173", "http://127.0.0.1:5173"}),
    ):
        if env.get(key) and env[key] not in allowed:
            raise ValueError("Remote application configuration is forbidden.")
    if (env.get("STRIPE_SECRET_KEY", "").startswith(("sk_live_", "rk_live_"))
        or env.get("STRIPE_PUBLISHABLE_KEY", "").startswith("pk_live_")):
        raise ValueError("Live payment configuration is forbidden.")
    result = subprocess.run(
        [str(ROOT / "frontend/node_modules/.bin/supabase"), "status", "--output", "json"],
        cwd=ROOT, capture_output=True, text=True, timeout=20, check=True,
    )
    status = json.loads(result.stdout)
    database = urlsplit(status["DB_URL"])
    if (status["API_URL"] != "http://127.0.0.1:54321"
        or database.scheme != "postgresql" or database.hostname != "127.0.0.1"
        or database.port != 54322 or database.path != "/postgres"
        or database.query or database.fragment):
        raise ValueError("Recovery accepts only the canonical local database.")
    return status


def recover(case_id: str, evidence_path: Path, *, apply: bool = False):
    UUID(case_id)
    status = local_status()
    ingestion = ReportIngestionResult.from_dict(json.loads(evidence_path.read_text()))
    gateway = gateway_from_status(status)
    package_id, work_id, token = (str(uuid4()) for _ in range(3))
    with psycopg.connect(status["DB_URL"], row_factory=dict_row) as db:
        row = db.execute("""
          select p.id as old_package_id,p.status as package_status,p.failure_code,
            p.supersedes_package_job_id,p.entitlement_id,p.preliminary_snapshot_id,
            w.phase,w.current_report_version_id,e.status as entitlement_status,
            o.status as order_status,o.payment_provider,o.provider_livemode,
            s.analysis_run_id,s.analysis_job_id,s.source_report_upload_id,
            s.source_analysis_input_revision,s.source_analysis_input_id,
            s.source_intake_mode,a.artifact
          from public.total_loss_claim_workflows w
          join public.total_loss_package_jobs p on p.id=w.current_package_job_id and p.case_id=w.case_id
          join public.case_entitlements e on e.id=p.entitlement_id and e.case_id=p.case_id
          join public.commerce_orders o on o.id=e.order_id and o.case_id=e.case_id
          join public.total_loss_preliminary_snapshots s on s.id=p.preliminary_snapshot_id and s.case_id=p.case_id
          join public.analysis_runs a on a.id=s.analysis_run_id and a.case_id=s.case_id
          where w.case_id=%s for update of w,p,e,o
        """, (case_id,)).fetchone()
        if not row:
            raise ValueError("No existing paid package was found for this local case.")
        if row["supersedes_package_job_id"]:
            db.rollback()
            return {"status": "already_recovered", "packageId": str(row["old_package_id"])}
        if (row["package_status"] != "failed" or row["failure_code"] != "SOURCE_LINEAGE_CONFLICT"
            or row["phase"] != "review" or row["current_report_version_id"] is not None
            or row["entitlement_status"] != "active" or row["order_status"] != "paid"
            or row["payment_provider"] != "stripe" or row["provider_livemode"] is not False
            or row["source_intake_mode"] != "report"):
            raise ValueError("Only an active sandbox purchase with missing report lineage can be recovered.")
        if db.execute("select 1 from public.total_loss_source_snapshots where package_job_id=%s",
                      (row["old_package_id"],)).fetchone():
            raise ValueError("A sealed source already exists; it must not be replaced.")
        validate_report_evidence_for_artifact(ingestion, row["artifact"])
        stored = db.execute("select ingestion from public.total_loss_analysis_report_evidence where analysis_run_id=%s",
                            (row["analysis_run_id"],)).fetchone()
        if stored and stored["ingestion"] != ingestion.to_dict():
            raise ValueError("Existing report evidence cannot be replaced.")
        if not stored:
            db.execute("""insert into public.total_loss_analysis_report_evidence(
              analysis_run_id,analysis_job_id,case_id,report_upload_id,analysis_input_revision,
              analysis_input_id,ingestion,evidence_origin)
              values(%s,%s,%s,%s,%s,%s,%s,'verified_recovery')""", (
                row["analysis_run_id"],row["analysis_job_id"],case_id,row["source_report_upload_id"],
                row["source_analysis_input_revision"],row["source_analysis_input_id"],Jsonb(ingestion.to_dict()),
            ))
        db.execute("""insert into public.total_loss_package_jobs(
          id,case_id,entitlement_id,preliminary_snapshot_id,status,supersedes_package_job_id)
          values(%s,%s,%s,%s,'queued',%s)""", (
            package_id,case_id,row["entitlement_id"],row["preliminary_snapshot_id"],row["old_package_id"],
        ))
        db.execute("""insert into public.workflow_work_items(
          id,case_id,package_job_id,work_type,work_version,status)
          values(%s,%s,%s,'total_loss_package_finalize','1','queued')""", (work_id,case_id,package_id))
        db.execute("""update public.total_loss_claim_workflows
          set current_package_job_id=%s,current_task='package_queued',revision=revision+1 where case_id=%s""",
          (package_id,case_id))

        # Validate with the real claim, resolver, private PDF and assessment builder.
        # Roll this preview back so the normal worker receives a queued attempt.
        db.execute("savepoint validate_recovery")
        claimed = db.execute("select * from public.claim_total_loss_package_work_item(%s,%s)", (work_id,token)).fetchone()
        if claimed["outcome"] != "claimed":
            raise ValueError("The replacement attempt could not be claimed safely.")
        result = db.execute("select row_to_json(c) as context from public.resolve_total_loss_package_source_context(%s,%s) c",
                            (work_id,token)).fetchone()
        if not result or not result["context"]["lineage_current"]:
            raise ValueError("Report input lineage has changed; recovery was cancelled.")
        context = result["context"]
        context["source_snapshot_id"] = str(uuid4())
        processor = TotalLossPackageProcessor(gateway)
        source = processor._build_source_snapshot(context, work_item_id=work_id)
        assessment = processor._assessment_builder.build_final_assessment(source)
        payload = source.to_dict()
        document = payload["sourceDocument"]
        sealed = db.execute("""select * from public.seal_total_loss_source_snapshot(
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (
            work_id,token,context["source_snapshot_id"],document["detectedMediaType"],
            document["byteSize"],document["sha256"],payload["analysis"]["artifactDigest"],
            payload["extraction"]["normalizedReportDigest"],payload["evidenceCutoff"]["currentObservedDate"],
            payload["createdAt"],payload["schemaVersion"],Jsonb(payload),payload["snapshotDigest"],
        )).fetchone()
        if not sealed:
            raise ValueError("The report source could not be sealed safely.")
        db.execute("rollback to savepoint validate_recovery")
        db.execute("""insert into public.total_loss_workflow_events(
          case_id,event_type,actor_type,associated_entity_type,associated_entity_id,details)
          values(%s,'report_source_recovered','system','package_job',%s,%s)""", (
            case_id,package_id,Jsonb({"supersedesPackageJobId": str(row["old_package_id"]),
                                    "analysisRunId": str(row["analysis_run_id"])}),
        ))
        if not apply:
            db.rollback()
        return {"status": "queued" if apply else "validated_dry_run", "packageId": package_id,
                "continuationStatus": assessment.to_dict()["continuationStatus"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(recover(args.case_id, args.evidence, apply=args.apply)))
