"""Explicit local-only integration for the sealed report Storage boundary.

This module is intentionally named outside ``test*.py`` so normal unit-test
discovery cannot run it. Run it only against a freshly reset local Supabase:

    .venv/bin/python -m unittest tests.local_report_storage_integration -v

The fixture creates an immutable sealed deliverable, so reset the local
database before rerunning it. It never deletes or rewrites the sealed object.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from tests import test_valuation_evidence_report as _report_fixture
from venfour.report_processing import TotalLossReportProcessor
from venfour.supabase_gateway import (
    CASE_DELIVERABLES_BUCKET,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
    TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SUPABASE_EXECUTABLE = (
    REPOSITORY_ROOT / "frontend" / "node_modules" / ".bin" / "supabase"
)
LOCAL_API_URL = "http://127.0.0.1:54321"
LOCAL_DATABASE_CONTAINER = "supabase_db_venfour"
ORDER_ID = "00000000-0000-4000-8000-000000000120"
PAYMENT_TRANSACTION_ID = "00000000-0000-4000-8000-000000000121"
FINAL_ASSESSMENT_ID = _report_fixture.FINAL_ASSESSMENT_ID


def _status_json(output: str) -> Mapping[str, Any]:
    start = output.find("{")
    end = output.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Local Supabase status did not return JSON")
    try:
        parsed = json.loads(output[start : end + 1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("Local Supabase status returned invalid JSON") from exc
    if not isinstance(parsed, Mapping):
        raise RuntimeError("Local Supabase status returned an invalid object")
    return parsed


def _local_configuration() -> SupabaseServerConfiguration:
    if not SUPABASE_EXECUTABLE.is_file():
        raise RuntimeError("The repository-local Supabase CLI is unavailable")
    completed = subprocess.run(
        (str(SUPABASE_EXECUTABLE), "status", "--output", "json"),
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError("The local Supabase stack is not running")
    status = _status_json(f"{completed.stdout}\n{completed.stderr}")
    api_url = status.get("API_URL")
    publishable_key = status.get("PUBLISHABLE_KEY") or status.get("ANON_KEY")
    service_role_key = status.get("SECRET_KEY") or status.get(
        "SERVICE_ROLE_KEY"
    )
    if api_url != LOCAL_API_URL:
        raise RuntimeError("Refusing to run against a non-canonical local API")
    parsed = urlsplit(str(api_url))
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.port != 54321
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Refusing to run against a non-loopback API")
    if not isinstance(publishable_key, str) or not publishable_key.strip():
        raise RuntimeError("Local Supabase publishable key is unavailable")
    if not isinstance(service_role_key, str) or not service_role_key.strip():
        raise RuntimeError("Local Supabase service-role key is unavailable")
    return SupabaseServerConfiguration(
        url=str(api_url),
        publishable_key=publishable_key,
        service_role_key=service_role_key,
    )


def _psql(sql: str) -> str:
    docker_host = os.environ.get("DOCKER_HOST")
    if docker_host and not docker_host.startswith("unix://"):
        raise RuntimeError("Refusing to seed a non-local Docker daemon")
    context = subprocess.run(
        (
            "docker",
            "context",
            "inspect",
            "--format",
            "{{(index .Endpoints \"docker\").Host}}",
        ),
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if context.returncode != 0 or not context.stdout.strip().startswith(
        "unix://"
    ):
        raise RuntimeError("Refusing to seed a non-local Docker daemon")
    inspected = subprocess.run(
        (
            "docker",
            "inspect",
            "--format",
            "{{.State.Running}}",
            LOCAL_DATABASE_CONTAINER,
        ),
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if inspected.returncode != 0 or inspected.stdout.strip() != "true":
        raise RuntimeError("The expected local Supabase database is not running")
    completed = subprocess.run(
        (
            "docker",
            "exec",
            "-i",
            LOCAL_DATABASE_CONTAINER,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-tA",
        ),
        cwd=REPOSITORY_ROOT,
        input=sql,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        details = completed.stderr.strip().splitlines()
        detail = details[-1] if details else "unknown local SQL error"
        raise RuntimeError(
            f"Local PostgreSQL fixture operation failed: {detail}"
        )
    return completed.stdout.strip()


def _json_literal(value: Mapping[str, Any] | list[Any]) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    delimiter = "$venfour_local_fixture$"
    if delimiter in serialized:
        raise RuntimeError("Fixture JSON contains the SQL delimiter")
    return f"{delimiter}{serialized}{delimiter}::jsonb"


def _text_literal(value: Any) -> str:
    if not isinstance(value, str):
        raise RuntimeError("Fixture SQL text must be a string")
    return "'" + value.replace("'", "''") + "'"


def _optional_text_literal(value: Any) -> str:
    return "null" if value is None else _text_literal(value)


def _seed_sql(source: Mapping[str, Any], assessment: Mapping[str, Any]) -> str:
    lineage = source["lineage"]
    source_input = source["input"]
    analysis = source["analysis"]
    preliminary = source["preliminary"]
    supported = preliminary["supportedRange"]
    assessment_range = assessment["supportedRange"]
    if not isinstance(assessment_range, Mapping):
        raise RuntimeError("The local integration fixture requires a supported range")
    case_id = lineage["caseId"]
    owner_id = lineage["ownerUserIdAtCreation"]
    analysis_input_id = source_input["analysisInputId"]
    analysis_input_revision = source_input["analysisInputRevision"]
    source_snapshot_id = lineage["sourceSnapshotId"]
    preliminary_snapshot_id = lineage["preliminarySnapshotId"]
    analysis_job_id = lineage["analysisJobId"]
    analysis_run_id = lineage["analysisRunId"]
    entitlement_id = lineage["entitlementId"]
    package_job_id = lineage["packageJobId"]
    confirmed = source_input["confirmedFacts"]
    return f"""
begin;

do $fixture_guard$
begin
  if exists (select 1 from public.appraisal_cases where id = '{case_id}'::uuid)
    or exists (select 1 from auth.users where id = '{owner_id}'::uuid)
  then
    raise exception 'Local report-storage fixture already exists; reset the local database before rerunning.';
  end if;
end;
$fixture_guard$;

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('{owner_id}', 'local-report-storage@example.test', statement_timestamp(), false);

insert into public.appraisal_cases (id, user_id, service_type, status)
values ('{case_id}', '{owner_id}', 'total_loss', 'check_complete');

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, vehicle_condition, vehicle_options_packages,
  intake_completed_at, analysis_input_revision, analysis_input_id
) values (
  '{case_id}', 'manual', '1HGCM82633A004352',
  {int(confirmed['year'])}, {_text_literal(confirmed['make'])},
  {_text_literal(confirmed['model'])}, {_text_literal(confirmed['trim'])},
  {int(confirmed['mileage'])}, {_text_literal(confirmed['postalCode'])},
  {_text_literal(confirmed['lossDate'])}::date,
  {_text_literal(confirmed['insurerName'])},
  {int(confirmed['insurerVehicleValuationMinorUnits']) / 100:.2f},
  {_text_literal(confirmed['condition'])},
  {_text_literal(confirmed['optionsPackages'])}, statement_timestamp(),
  {int(analysis_input_revision)}, '{analysis_input_id}'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  '{case_id}', 'Local Storage Customer',
  'local-report-storage@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  '{analysis_job_id}', '{case_id}', statement_timestamp(), 'completed', 1,
  gen_random_uuid(), '{analysis_run_id}', statement_timestamp(), 'manual',
  {int(analysis_input_revision)}, '{analysis_input_id}'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  '{analysis_run_id}', '{analysis_job_id}', '{case_id}',
  {_json_literal(analysis['artifact'])}, {_text_literal(analysis['requestDigest'])},
  {_text_literal(analysis['analysisRunSchemaVersion'])},
  {_text_literal(analysis['analysisVersion'])},
  {_text_literal(analysis['discrepancyAnalysisVersion'])},
  {_text_literal(analysis['comparableScoringVersion'])}
);

insert into public.total_loss_preliminary_snapshots (
  id, case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
  source_intake_mode, source_analysis_input_revision, source_analysis_input_id,
  preliminary_classification, insurer_valuation_minor_units,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, currency, analysis_run_schema_version,
  analysis_version, discrepancy_analysis_version, comparable_scoring_version,
  presentation_schema_version, snapshot_schema_version, source_references,
  snapshot, snapshot_digest
) values (
  '{preliminary_snapshot_id}', '{case_id}', '{analysis_job_id}',
  '{analysis_run_id}', '{owner_id}', 'manual', {int(analysis_input_revision)},
  '{analysis_input_id}', {_text_literal(preliminary['classification'])},
  {int(preliminary['insurerValueMinorUnits'])},
  {int(supported['lowMinorUnits'])}, {int(supported['medianMinorUnits'])},
  {int(supported['highMinorUnits'])}, {_text_literal(supported['currency'])},
  {_text_literal(analysis['analysisRunSchemaVersion'])},
  {_text_literal(analysis['analysisVersion'])},
  {_text_literal(analysis['discrepancyAnalysisVersion'])},
  {_text_literal(analysis['comparableScoringVersion'])},
  {_text_literal(preliminary['presentationSchemaVersion'])},
  {_text_literal(preliminary['snapshotSchemaVersion'])},
  jsonb_build_object('analysisRunId', '{analysis_run_id}'),
  {_json_literal(preliminary['snapshot'])},
  {_text_literal(preliminary['snapshotDigest'])}
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
) values (
  '{case_id}', '{preliminary_snapshot_id}', 'review',
  'awaiting_report_generation'
);

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  payment_provider, external_price_identifier, provider_livemode,
  purchaser_email, status, terms_version, refund_policy_version, paid_at
) values (
  '{ORDER_ID}', '{case_id}', '{owner_id}', '{preliminary_snapshot_id}',
  'total-loss-package', '1', 9900, 'USD', 'stripe',
  'price_test_total_loss_v1', false, 'local-report-storage@example.test',
  'paid', 'local-test', 'local-test', statement_timestamp()
);

insert into public.payment_transactions (
  id, case_id, order_id, payment_provider, transaction_kind,
  external_object_id, amount_minor_units, currency, provider_occurred_at
) values (
  '{PAYMENT_TRANSACTION_ID}', '{case_id}', '{ORDER_ID}', 'stripe', 'payment',
  'pi_local_report_storage_fixture', 9900, 'USD', statement_timestamp()
);

insert into public.case_entitlements (
  id, case_id, order_id, preliminary_snapshot_id, product_identifier,
  product_version, status
) values (
  '{entitlement_id}', '{case_id}', '{ORDER_ID}', '{preliminary_snapshot_id}',
  'total-loss-package', '1', 'active'
);

insert into public.total_loss_package_jobs (
  id, case_id, entitlement_id, preliminary_snapshot_id, status,
  attempt_count, processing_token, started_at, finished_at
) values (
  '{package_job_id}', '{case_id}', '{entitlement_id}',
  '{preliminary_snapshot_id}', 'assessment_ready', 1, gen_random_uuid(),
  statement_timestamp(), statement_timestamp()
);

update public.total_loss_claim_workflows
set current_package_job_id = '{package_job_id}', revision = revision + 1
where case_id = '{case_id}';

insert into public.total_loss_source_snapshots (
  id, case_id, package_job_id, entitlement_id, preliminary_snapshot_id,
  analysis_job_id, analysis_run_id, owner_user_id_at_creation,
  source_intake_mode, source_analysis_input_revision, source_analysis_input_id,
  extraction_available, analysis_artifact_digest, preliminary_snapshot_digest,
  request_digest, search_diagnostics_digest, evidence_cutoff,
  snapshot_created_at, analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version,
  presentation_schema_version, preliminary_snapshot_schema_version,
  snapshot_schema_version, source_snapshot, snapshot_digest
) values (
  '{source_snapshot_id}', '{case_id}', '{package_job_id}', '{entitlement_id}',
  '{preliminary_snapshot_id}', '{analysis_job_id}', '{analysis_run_id}',
  '{owner_id}', 'manual', {int(analysis_input_revision)}, '{analysis_input_id}',
  false, {_text_literal(analysis['artifactDigest'])},
  {_text_literal(preliminary['snapshotDigest'])},
  {_text_literal(analysis['requestDigest'])},
  {_optional_text_literal(analysis['searchDiagnosticsDigest'])},
  {_text_literal(source['evidenceCutoff']['lossDate'])}::date,
  {_text_literal(source['createdAt'])}::timestamptz,
  {_text_literal(analysis['analysisRunSchemaVersion'])},
  {_text_literal(analysis['analysisVersion'])},
  {_text_literal(analysis['discrepancyAnalysisVersion'])},
  {_text_literal(analysis['comparableScoringVersion'])},
  {_text_literal(preliminary['presentationSchemaVersion'])},
  {_text_literal(preliminary['snapshotSchemaVersion'])},
  {_text_literal(source['schemaVersion'])}, {_json_literal(source)},
  {_text_literal(source['snapshotDigest'])}
);

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id, source_snapshot_id,
  version_number, conclusion_code, currency,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, findings, limitations, reason_codes,
  preliminary_to_final_comparison, assessment, methodology_version,
  schema_version, assessment_digest
) values (
  '{FINAL_ASSESSMENT_ID}', '{case_id}', '{package_job_id}',
  '{preliminary_snapshot_id}', '{source_snapshot_id}', 1,
  {_text_literal(assessment['finalClassification'])},
  {_text_literal(assessment_range['currency'])},
  {int(assessment_range['lowMinorUnits'])},
  {int(assessment_range['medianMinorUnits'])},
  {int(assessment_range['highMinorUnits'])},
  {_json_literal(assessment['findings'])},
  {_json_literal(assessment['limitations'])}, '[]'::jsonb,
  {_json_literal(assessment['preliminaryToFinalComparison'])},
  {_json_literal(assessment)}, {_text_literal(assessment['methodologyVersion'])},
  {_text_literal(assessment['schemaVersion'])},
  {_text_literal(assessment['assessmentDigest'])}
);

commit;
"""


def _stored_state(case_id: str, report_version_id: str) -> Mapping[str, Any]:
    query = f"""
select jsonb_build_object(
  'caseId', report.case_id,
  'packageJobId', report.package_job_id,
  'reportSeriesId', report.report_series_id,
  'reportVersionId', report.id,
  'versionNumber', report.version_number,
  'reportStatus', report.status,
  'reportDigest', report.report_digest,
  'pdfDigest', report.pdf_digest,
  'pdfByteSize', report.pdf_byte_size,
  'publishedAt', report.published_at,
  'suggestedFilename', report.report #>> '{{identity,suggestedFilename}}',
  'validationFilename', report.validation_manifest ->> 'filename',
  'documentId', document.id,
  'documentStatus', document.status,
  'documentBucket', document.storage_bucket_id,
  'documentObject', document.storage_object_name,
  'documentFilename', document.original_filename,
  'documentMediaType', document.media_type,
  'documentByteSize', document.byte_size,
  'documentDigest', document.content_digest,
  'documentSealedAt', document.sealed_at,
  'storageObjectId', stored.id,
  'storageMetadata', stored.metadata,
  'storageUserMetadata', stored.user_metadata,
  'packageStatus', package.status,
  'generationStatus', generation.status,
  'reviewStatus', review.status,
  'workflowTask', workflow.current_task,
  'seriesCurrentReportVersionId', series.current_report_version_id,
  'seriesPublishedReportVersionId', series.current_published_report_version_id,
  'workflowCurrentReportVersionId', workflow.current_report_version_id
)::text
from public.total_loss_report_versions as report
join public.total_loss_claim_documents as document
  on document.id = report.document_id and document.case_id = report.case_id
join storage.objects as stored
  on stored.bucket_id = document.storage_bucket_id
  and stored.name = document.storage_object_name
join public.total_loss_package_jobs as package
  on package.id = report.package_job_id and package.case_id = report.case_id
join public.workflow_work_items as generation
  on generation.id = report.generation_work_item_id
join public.workflow_work_items as review
  on review.id = report.review_work_item_id
join public.total_loss_claim_workflows as workflow
  on workflow.case_id = report.case_id
join public.total_loss_report_series as series
  on series.id = report.report_series_id and series.case_id = report.case_id
where report.case_id = '{case_id}'::uuid
  and report.id = '{report_version_id}'::uuid;
"""
    output = _psql(query)
    if not output:
        raise RuntimeError("The generated local report state was not found")
    try:
        value = json.loads(output.splitlines()[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("The generated local report state is invalid") from exc
    if not isinstance(value, Mapping):
        raise RuntimeError("The generated local report state is invalid")
    return value


class LocalReportStorageIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.configuration = _local_configuration()
        cls.gateway = SupabaseHttpGateway(
            cls.configuration,
            client=httpx.Client(
                timeout=cls.configuration.timeout_seconds,
                follow_redirects=False,
                trust_env=False,
            ),
        )
        cls.fixture = _report_fixture.ValuationEvidenceReportTests(
            methodName="test_projects_complete_report_from_authoritative_contracts"
        )
        cls.fixture.setUp()
        source, assessment = cls.fixture._source(mode="MANUAL")
        cls.source = source.to_dict()
        cls.assessment = assessment.to_dict()
        _psql(_seed_sql(cls.source, cls.assessment))

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            cls.gateway.close()
        finally:
            cls.fixture.tearDown()
        super().tearDownClass()

    def test_real_rpc_gateway_storage_upload_and_seal(self) -> None:
        lineage = self.source["lineage"]
        case_id = lineage["caseId"]
        package_job_id = lineage["packageJobId"]
        enqueued = self.gateway.enqueue_total_loss_report_generation(
            package_job_id
        )
        self.assertEqual(enqueued["outcome"], "created")

        result = TotalLossReportProcessor(self.gateway).execute_generation(
            enqueued["work_item_id"]
        )
        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_job_id, package_job_id)
        self.assertEqual(result.package_status, "waiting_ai_review")
        self.assertIsNotNone(result.report_version_id)

        state = _stored_state(case_id, str(result.report_version_id))
        expected_object = "/".join(
            (
                "cases",
                case_id,
                "reports",
                state["reportSeriesId"],
                "versions",
                state["reportVersionId"],
                TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT,
            )
        )
        self.assertEqual(state["caseId"], case_id)
        self.assertEqual(state["packageJobId"], package_job_id)
        self.assertEqual(state["reportStatus"], "validated")
        self.assertIsNone(state["publishedAt"])
        self.assertEqual(state["documentStatus"], "ready")
        self.assertIsNotNone(state["documentSealedAt"])
        self.assertEqual(state["documentBucket"], CASE_DELIVERABLES_BUCKET)
        self.assertEqual(state["documentObject"], expected_object)
        self.assertEqual(
            state["documentFilename"], TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT
        )
        self.assertEqual(
            state["validationFilename"], TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT
        )
        self.assertNotEqual(
            state["suggestedFilename"], TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT
        )
        self.assertEqual(state["documentMediaType"], "application/pdf")
        self.assertEqual(state["documentByteSize"], state["pdfByteSize"])
        self.assertEqual(state["documentDigest"], state["pdfDigest"])
        self.assertRegex(state["reportDigest"], r"^[0-9a-f]{64}$")
        self.assertRegex(state["pdfDigest"], r"^[0-9a-f]{64}$")
        self.assertEqual(state["packageStatus"], "waiting_ai_review")
        self.assertEqual(state["generationStatus"], "completed")
        self.assertEqual(state["reviewStatus"], "queued")
        self.assertEqual(state["workflowTask"], "report_review_queued")
        self.assertEqual(
            state["seriesCurrentReportVersionId"], state["reportVersionId"]
        )
        self.assertIsNone(state["seriesPublishedReportVersionId"])
        self.assertEqual(
            state["workflowCurrentReportVersionId"], state["reportVersionId"]
        )
        self.assertIsNotNone(state["storageObjectId"])
        self.assertEqual(
            state["storageMetadata"]["mimetype"], "application/pdf"
        )
        self.assertEqual(
            int(state["storageMetadata"]["size"]), state["pdfByteSize"]
        )
        self.assertEqual(
            state["storageUserMetadata"]["caseId"], state["caseId"]
        )
        self.assertEqual(
            state["storageUserMetadata"]["reportSeriesId"],
            state["reportSeriesId"],
        )
        self.assertEqual(
            state["storageUserMetadata"]["reportVersionId"],
            state["reportVersionId"],
        )
        self.assertEqual(
            state["storageUserMetadata"]["sha256"], state["pdfDigest"]
        )
        self.assertEqual(
            state["storageUserMetadata"]["contentDigest"], state["pdfDigest"]
        )

        locator = {
            "storage_bucket_id": state["documentBucket"],
            "storage_object_name": state["documentObject"],
        }
        with self.gateway.materialize_total_loss_deliverable(
            case_id,
            state["reportSeriesId"],
            state["reportVersionId"],
            locator,
            str(uuid4()),
        ) as materialized:
            pdf = materialized.read_bytes()
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertEqual(len(pdf), state["pdfByteSize"])
        self.assertEqual(hashlib.sha256(pdf).hexdigest(), state["pdfDigest"])

    def test_malformed_and_cross_case_locators_make_no_http_request(self) -> None:
        requests: list[httpx.Request] = []

        def unexpected_request(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(500, request=request)

        client = httpx.Client(transport=httpx.MockTransport(unexpected_request))
        gateway = SupabaseHttpGateway(self.configuration, client=client)
        case_id = "10000000-0000-4000-8000-000000000001"
        series_id = "10000000-0000-4000-8000-000000000002"
        version_id = "10000000-0000-4000-8000-000000000003"
        other_case_id = "10000000-0000-4000-8000-000000000004"
        pdf = b"%PDF-1.4\n%%EOF\n"
        digest = hashlib.sha256(pdf).hexdigest()
        malformed = {
            "storage_bucket_id": CASE_DELIVERABLES_BUCKET,
            "storage_object_name": f"cases/{case_id}/report.pdf",
        }
        cross_case = {
            "storage_bucket_id": CASE_DELIVERABLES_BUCKET,
            "storage_object_name": (
                f"cases/{other_case_id}/reports/{series_id}/versions/"
                f"{version_id}/{TOTAL_LOSS_EVIDENCE_PACKAGE_OBJECT}"
            ),
        }
        try:
            with self.assertRaises(SupabaseContractError):
                gateway.upload_total_loss_deliverable_pdf(
                    case_id,
                    series_id,
                    version_id,
                    malformed,
                    pdf,
                    digest,
                )
            with self.assertRaises(SupabaseContractError):
                gateway.upload_total_loss_deliverable_pdf(
                    case_id,
                    series_id,
                    version_id,
                    cross_case,
                    pdf,
                    digest,
                )
        finally:
            gateway.close()
        self.assertEqual(requests, [])


if __name__ == "__main__":
    unittest.main()
