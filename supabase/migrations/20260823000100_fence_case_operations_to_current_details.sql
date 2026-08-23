create or replace view public.total_loss_case_operations_internal
with (security_invoker = true)
as
select
  appraisal_case.id as case_id,
  appraisal_case.user_id as owner_user_id,
  case
    when profile.full_name_confirmed_at is not null
      then profile.display_name
    else null
  end as customer_full_name,
  case
    when auth_user.email_confirmed_at is not null
      then auth_user.email
    else null
  end as verified_email,
  profile.operational_follow_up_allowed,
  appraisal_case.service_type,
  appraisal_case.status as case_status,
  case
    when appraisal_case.status = 'closed'
      then 'closed'::public.case_operation_stage
    when details.report_upload_id is not null
      and details.report_upload_expires_at <= statement_timestamp()
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'completed'
      and analysis_job.source_details_updated_at = details.updated_at
      and analysis_run.id is not null
      and appraisal_case.status in ('check_complete', 'completed')
      then 'analysis_complete'::public.case_operation_stage
    when analysis_job.status = 'completed'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'processing'
      and analysis_job.source_details_updated_at = details.updated_at
      and appraisal_case.status = 'checking'
      and analysis_job.processing_expires_at > statement_timestamp()
      then 'analysis_processing'::public.case_operation_stage
    when analysis_job.status = 'processing'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'failed'
      and analysis_job.source_details_updated_at = details.updated_at
      and appraisal_case.status = 'draft'
      then 'analysis_failed'::public.case_operation_stage
    when analysis_job.status = 'failed'
      then 'needs_attention'::public.case_operation_stage
    when appraisal_case.status <> 'draft'
      then 'needs_attention'::public.case_operation_stage
    when details.case_id is null
      then 'intake_not_started'::public.case_operation_stage
    when num_nonnulls(
      details.report_last_upload_id,
      details.report_original_filename,
      details.report_uploaded_at
    ) not in (0, 3)
      then 'needs_attention'::public.case_operation_stage
    when details.report_last_upload_id is not null
      and details.report_upload_id is null
      and canonical_report.id is null
      then 'needs_attention'::public.case_operation_stage
    when details.intake_completed_at is not null
      and details.intake_mode <> 'report'
      then 'report_required'::public.case_operation_stage
    when details.intake_completed_at is not null
      and nullif(btrim(details.postal_code), '') is null
      then 'needs_attention'::public.case_operation_stage
    when details.intake_completed_at is not null
      and details.postal_code !~ '^[0-9]{5}(-[0-9]{4})?$'
      then 'needs_attention'::public.case_operation_stage
    when details.intake_completed_at is not null
      and details.report_upload_id is not null
      and details.report_last_upload_id is not null
      then 'report_uploaded'::public.case_operation_stage
    when details.intake_completed_at is not null
      and details.report_upload_id is null
      and canonical_report.id is not null
      then 'ready_for_analysis'::public.case_operation_stage
    when details.intake_completed_at is not null
      then 'report_required'::public.case_operation_stage
    when canonical_report.id is not null
      then 'report_uploaded'::public.case_operation_stage
    else 'intake_in_progress'::public.case_operation_stage
  end as case_stage,
  appraisal_case.created_at as case_created_at,
  appraisal_case.updated_at as case_updated_at,
  appraisal_case.last_activity_at,
  details.intake_mode,
  details.vin,
  details.vehicle_year,
  details.vehicle_make,
  details.vehicle_model,
  details.vehicle_trim,
  details.mileage_at_loss,
  details.postal_code,
  details.date_of_loss,
  details.insurer_name,
  details.insurer_vehicle_valuation,
  details.intake_completed_at,
  details.created_at as details_created_at,
  details.updated_at as details_updated_at,
  details.report_original_filename,
  details.report_uploaded_at,
  details.report_last_upload_id,
  details.report_upload_id,
  details.report_upload_expires_at,
  canonical_report.id is not null as canonical_report_available,
  analysis_job.id as analysis_job_id,
  analysis_job.status as analysis_status,
  analysis_job.attempt_count as analysis_attempt_count,
  analysis_job.failure_code as analysis_failure_code,
  analysis_job.retryable as analysis_retryable,
  analysis_job.processing_expires_at as analysis_processing_expires_at,
  analysis_job.created_at as analysis_job_created_at,
  analysis_job.updated_at as analysis_job_updated_at,
  analysis_job.finished_at as analysis_job_finished_at,
  analysis_run.id as analysis_run_id,
  analysis_run.created_at as analysis_run_created_at,
  analysis_run.analysis_run_schema_version,
  analysis_run.analysis_version,
  analysis_run.discrepancy_analysis_version,
  analysis_run.comparable_scoring_version,
  analysis_run.artifact #>>
    '{result,discrepancyResult,classification}' as analysis_classification,
  analysis_run.artifact #>>
    '{result,discrepancyResult,evidenceStrength}' as analysis_evidence_strength,
  analysis_run.artifact #>>
    '{result,discrepancyResult,evidenceBasis}' as analysis_evidence_basis
from public.appraisal_cases as appraisal_case
join auth.users as auth_user
  on auth_user.id = appraisal_case.user_id
left join public.profiles as profile
  on profile.id = appraisal_case.user_id
left join public.total_loss_case_details as details
  on details.case_id = appraisal_case.id
left join storage.objects as canonical_report
  on canonical_report.bucket_id = 'case-files'
  and canonical_report.name = appraisal_case.user_id::text || '/'
    || appraisal_case.id::text || '/valuation-report.pdf'
  and canonical_report.user_metadata ->> 'uploadId'
    = details.report_last_upload_id::text
left join public.total_loss_analysis_jobs as analysis_job
  on analysis_job.case_id = appraisal_case.id
  and analysis_job.source_report_upload_id = details.report_last_upload_id
left join public.analysis_runs as analysis_run
  on analysis_run.id = analysis_job.run_id
  and analysis_run.job_id = analysis_job.id
  and analysis_run.case_id = analysis_job.case_id
where appraisal_case.service_type = 'total_loss';

comment on view public.total_loss_case_operations_internal is
  'Unprivileged current-report and current-details-version-aware Total-Loss operations projection. Browser access is available only through owner- or staff-gated RPCs.';

revoke all on table public.total_loss_case_operations_internal from public;
revoke all on table public.total_loss_case_operations_internal from anon;
revoke all on table public.total_loss_case_operations_internal from authenticated;
revoke all on table public.total_loss_case_operations_internal from service_role;
