-- Initialize production continuation from the exact completed input and ready report.
create or replace function public.get_total_loss_full_review_context(requested_case_id uuid, requested_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('case_id',c.id,'user_id',c.user_id,'input',public.build_total_loss_analysis_input_snapshot(d),
    'source_run_id',j.run_id,'source_input_id',j.source_analysis_input_id,
    'source_input_revision',j.source_analysis_input_revision,'artifact',a.artifact,
    'report', (select to_jsonb(r) from public.total_loss_full_review_reports r
      where r.case_id=c.id and r.source_run_id=j.run_id order by r.created_at desc,r.id desc limit 1),
    'existing_report',case when d.intake_mode='report' then jsonb_build_object(
      'storage_bucket','case-files','storage_object_name',d.report_storage_owner_id::text || '/' || c.id::text || '/valuation-report.pdf',
      'storage_owner_id',d.report_storage_owner_id,'original_filename',d.report_original_filename,
      'extraction',coalesce((select e.normalized_report from public.total_loss_report_extractions e
        where e.case_id=c.id and e.report_upload_id=d.report_last_upload_id
        and e.analysis_input_revision=d.analysis_input_revision and e.extraction_status='confirmed' limit 1),
        (select e.ingestion from public.total_loss_analysis_report_evidence e where e.analysis_run_id=j.run_id
          and e.case_id=c.id and e.report_upload_id=d.report_last_upload_id limit 1))) else null end,
    'locked',exists(select 1 from public.commerce_orders o where o.case_id=c.id and o.status <> 'void'))
  from public.appraisal_cases c join public.total_loss_case_details d on d.case_id=c.id
  join public.total_loss_analysis_jobs j on j.case_id=c.id and j.status='completed'
    and j.source_analysis_input_revision=d.analysis_input_revision and j.source_analysis_input_id is not distinct from d.analysis_input_id
  join public.analysis_runs a on a.id=j.run_id
  where c.id=requested_case_id and c.user_id=requested_user_id and c.service_type='total_loss'
  order by j.created_at desc limit 1;
$$;

create function public.initialize_total_loss_post_continue(
  requested_case_id uuid, requested_user_id uuid, expected_run_id uuid,
  expected_analysis_input_id uuid, expected_analysis_input_revision bigint,
  expected_report_id uuid, expected_report_revision bigint,
  frozen_presentation jsonb, frozen_digest text
)
returns text language plpgsql volatile security definer set search_path='' as $$
declare
  details_row public.total_loss_case_details%rowtype;
  report_row public.total_loss_full_review_reports%rowtype;
  run_row public.analysis_runs%rowtype;
  job_row public.total_loss_analysis_jobs%rowtype;
  snapshot_row public.total_loss_preliminary_snapshots%rowtype;
  snapshot_id uuid;
  context jsonb;
  classification text;
  legacy_range boolean;
begin
  if requested_case_id is null or requested_user_id is null or expected_run_id is null
    or expected_analysis_input_id is null or expected_analysis_input_revision is null
    or expected_analysis_input_revision < 1 or expected_report_id is null
    or expected_report_revision is null or expected_report_revision < 1
    or frozen_presentation is null or jsonb_typeof(frozen_presentation)<>'object'
    or frozen_digest is null or frozen_digest !~ '^[0-9a-f]{64}$' then
    return 'not_ready';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases c where c.id=requested_case_id
    and c.user_id=requested_user_id and c.service_type='total_loss' for update;
  if not found then return 'not_found'; end if;
  select * into details_row from public.total_loss_case_details
    where case_id=requested_case_id for update;
  if not found then return 'not_ready'; end if;
  if details_row.analysis_input_id is distinct from expected_analysis_input_id
    or details_row.analysis_input_revision is distinct from expected_analysis_input_revision then
    return 'stale';
  end if;

  context := public.get_total_loss_full_review_context(requested_case_id,requested_user_id);
  if context is null then return 'not_ready'; end if;
  if context->>'source_run_id' is distinct from expected_run_id::text
    or context->'report'->>'id' is distinct from expected_report_id::text then
    return 'stale';
  end if;
  select * into report_row from public.total_loss_full_review_reports
    where id=expected_report_id and case_id=requested_case_id for update;
  if not found then return 'stale'; end if;
  if report_row.revision is distinct from expected_report_revision
    or report_row.source_run_id is distinct from expected_run_id
    or report_row.source_input_id is distinct from expected_analysis_input_id then
    return 'stale';
  end if;
  if not public.total_loss_full_review_ready(requested_case_id,requested_user_id) then
    return 'not_ready';
  end if;
  select * into run_row from public.analysis_runs where id=expected_run_id and case_id=requested_case_id;
  select * into job_row from public.total_loss_analysis_jobs where id=run_row.job_id
    and run_id=expected_run_id and case_id=requested_case_id and status='completed';
  if job_row.id is null or job_row.source_analysis_input_id is distinct from expected_analysis_input_id
    or job_row.source_analysis_input_revision is distinct from expected_analysis_input_revision then
    return 'stale';
  end if;
  classification := run_row.artifact #>> '{result,discrepancyResult,classification}';
  if classification is null or classification !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or frozen_presentation->>'runId' is distinct from expected_run_id::text
    or frozen_presentation #>> '{assessment,classification}' is distinct from classification
    or coalesce(frozen_presentation->>'presentationVersion','') !~ '^[2-8]$'
    or (frozen_presentation->>'presentationVersion'='8' and not coalesce(
      frozen_presentation #>> '{preliminaryResult,outcome}' in ('ESTIMATE','LISTING_CONTEXT','INSUFFICIENT'),false))
    or (frozen_presentation->>'presentationVersion'<>'8'
      and classification not in ('MATERIAL_UNDERVALUE_SIGNAL','POTENTIAL_UNDERVALUE')) then
    return 'not_ready';
  end if;

  select p.* into snapshot_row from public.total_loss_claim_workflows w
    join public.total_loss_preliminary_snapshots p on p.id=w.preliminary_snapshot_id and p.case_id=w.case_id
    where w.case_id=requested_case_id;
  if found then
    if snapshot_row.analysis_run_id is distinct from expected_run_id
      or snapshot_row.source_analysis_input_id is distinct from expected_analysis_input_id
      or snapshot_row.source_analysis_input_revision is distinct from expected_analysis_input_revision
      or snapshot_row.snapshot->'presentation' is distinct from frozen_presentation
      or snapshot_row.snapshot_digest is distinct from frozen_digest then return 'stale'; end if;
    snapshot_id := snapshot_row.id;
    if exists(select 1 from public.total_loss_workflow_events e
      where e.case_id=requested_case_id and e.event_type='full_review.checkout_prepared'
        and e.associated_entity_id=expected_report_id
        and e.details->>'reportRevision'=expected_report_revision::text
        and e.details->>'preliminarySnapshotId'=snapshot_id::text) then
      return 'existing';
    end if;
    -- Legacy purchased snapshots already have an immutable accepted-report binding.
    if not (snapshot_row.source_references ? 'checkoutInitializationVersion')
      and exists(select 1 from public.total_loss_checkout_review_reports b where b.case_id=requested_case_id
        and b.report_id=expected_report_id and b.report_revision=expected_report_revision) then
      return 'existing';
    end if;
    if exists(select 1 from public.commerce_orders o where o.case_id=requested_case_id) then
      return 'stale';
    end if;
  else
  -- Keep the exact result; listing context never becomes a supported valuation range.
  legacy_range := frozen_presentation->>'presentationVersion'<>'8';
  insert into public.total_loss_preliminary_snapshots (
    case_id,analysis_job_id,analysis_run_id,owner_user_id_at_snapshot,
    source_intake_mode,source_report_upload_id,source_analysis_input_revision,source_analysis_input_id,
    preliminary_classification,insurer_valuation_minor_units,supported_range_low_minor_units,
    supported_range_median_minor_units,supported_range_high_minor_units,currency,
    analysis_run_schema_version,analysis_version,discrepancy_analysis_version,comparable_scoring_version,
    presentation_schema_version,snapshot_schema_version,source_references,snapshot,snapshot_digest
  ) values (
    requested_case_id,job_row.id,expected_run_id,requested_user_id,
    job_row.source_intake_mode,job_row.source_report_upload_id,expected_analysis_input_revision,expected_analysis_input_id,
    classification,(frozen_presentation #>> '{insurerValuation,value,cents}')::bigint,
    case when legacy_range then (frozen_presentation #>> '{primaryExternalEvidence,prices,minimumPrice,cents}')::bigint end,
    case when legacy_range then (frozen_presentation #>> '{primaryExternalEvidence,prices,medianPrice,cents}')::bigint end,
    case when legacy_range then (frozen_presentation #>> '{primaryExternalEvidence,prices,maximumPrice,cents}')::bigint end,
    'USD',run_row.analysis_run_schema_version,run_row.analysis_version,run_row.discrepancy_analysis_version,
    run_row.comparable_scoring_version,frozen_presentation->>'presentationVersion','1',
    jsonb_build_object('analysisRunId',expected_run_id,'analysisJobId',job_row.id,
      'checkoutInitializationVersion','1','fullReviewReportId',expected_report_id,
      'fullReviewReportRevision',expected_report_revision),
    jsonb_build_object('schemaVersion','1','presentation',frozen_presentation),frozen_digest
  ) returning id into snapshot_id;
  insert into public.total_loss_claim_workflows(case_id,preliminary_snapshot_id,phase,current_task)
    values(requested_case_id,snapshot_id,'review','secure_claim');
  end if;
  -- A replacement report gets a new immutable preparation event; the original
  -- free result and earlier report preparations remain unchanged.
  insert into public.total_loss_workflow_events(case_id,event_type,actor_type,
    associated_entity_type,associated_entity_id,details)
  values(requested_case_id,'full_review.checkout_prepared','system','full_review_report',expected_report_id,
    jsonb_build_object('preliminarySnapshotId',snapshot_id,'analysisRunId',expected_run_id,
      'analysisInputId',expected_analysis_input_id,'analysisInputRevision',expected_analysis_input_revision,
      'reportRevision',expected_report_revision));
  return 'created';
end;
$$;
revoke all on function public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)
  to service_role;

create function public.total_loss_preliminary_checkout_eligible_internal(requested_snapshot_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.total_loss_preliminary_snapshots p
    join public.appraisal_cases c on c.id=p.case_id
    where p.id=requested_snapshot_id and (
      (p.preliminary_classification in ('MATERIAL_UNDERVALUE_SIGNAL','POTENTIAL_UNDERVALUE')
        and not (p.source_references ? 'checkoutInitializationVersion'))
      or ((p.preliminary_classification in ('MATERIAL_UNDERVALUE_SIGNAL','POTENTIAL_UNDERVALUE')
          or (p.presentation_schema_version='8'
            and p.snapshot #>> '{presentation,preliminaryResult,outcome}' in ('ESTIMATE','LISTING_CONTEXT','INSUFFICIENT')))
        and p.snapshot #>> '{presentation,assessment,classification}'=p.preliminary_classification
        and public.total_loss_full_review_ready(p.case_id,c.user_id)
        and exists(select 1 from public.total_loss_full_review_reports r
          join public.total_loss_workflow_events e on e.case_id=r.case_id
            and e.event_type='full_review.checkout_prepared' and e.associated_entity_type='full_review_report'
            and e.associated_entity_id=r.id and e.details->>'reportRevision'=r.revision::text
            and e.details->>'preliminarySnapshotId'=p.id::text
            and e.details->>'analysisRunId'=p.analysis_run_id::text
            and e.details->>'analysisInputId'=p.source_analysis_input_id::text
            and e.details->>'analysisInputRevision'=p.source_analysis_input_revision::text
          where r.case_id=p.case_id and r.source_run_id=p.analysis_run_id
            and r.source_input_id is not distinct from p.source_analysis_input_id
            and r.status='ready'
            and r.id::text=public.get_total_loss_full_review_context(p.case_id,c.user_id)->'report'->>'id'))
    ));
$$;
revoke all on function public.total_loss_preliminary_checkout_eligible_internal(uuid)
  from public,anon,authenticated,service_role;

-- Change only the classification predicate inside the established owned commerce
-- contracts. Keep every identity, entitlement, order, referral and report wrapper.
do $$
declare
  target regprocedure;
  definition text;
  pattern text := 'snapshot\.preliminary_classification in \(\s*''MATERIAL_UNDERVALUE_SIGNAL'',\s*''POTENTIAL_UNDERVALUE''\s*\)';
begin
  foreach target in array array[
    'public.total_loss_post_continue_case_is_eligible_internal(uuid)'::regprocedure,
    'public.authorize_total_loss_checkout_before_report_internal(uuid,uuid)'::regprocedure,
    'public.reserve_total_loss_checkout_without_referral_internal(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    if (select count(*) from regexp_matches(definition,pattern,'g'))<>1 then
      raise exception 'Unexpected checkout classification contract: %',target;
    end if;
    execute regexp_replace(definition,pattern,
      'public.total_loss_preliminary_checkout_eligible_internal(snapshot.id)');
  end loop;
end;
$$;
comment on function public.total_loss_post_continue_case_is_eligible_internal(uuid) is
  'Current-input eligibility from the immutable result; current preliminary outcomes additionally require their exact ready review report.';

notify pgrst, 'reload schema';
