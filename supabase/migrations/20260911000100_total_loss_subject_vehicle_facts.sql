-- Explicit customer facts supplement the retained trim/version identity.
create function public.subject_vehicle_facts_are_valid(facts jsonb)
returns boolean language plpgsql immutable strict security invoker set search_path = '' as $$
declare item record;
begin
  if jsonb_typeof(facts) <> 'object' then return false; end if;
  for item in select * from jsonb_each(facts) loop
    if item.key <> all(array['bodyType','drivetrain','engine','fuelType','transmission',
      'powertrain','cabType','bedLength','doors','cylinders','bodySubtype'])
      or jsonb_typeof(item.value) <> 'string'
      or length(btrim(item.value #>> '{}')) not between 1 and 200
      or (item.value #>> '{}') ~ '[[:cntrl:]]'
    then return false; end if;
    if item.key = 'drivetrain' and (item.value #>> '{}') <> all(array['FWD','RWD','AWD','4WD'])
    then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.subject_vehicle_facts_are_valid(jsonb) from public, anon;
grant execute on function public.subject_vehicle_facts_are_valid(jsonb) to authenticated, service_role;

alter table public.total_loss_case_details add column vehicle_facts jsonb,
  add constraint total_loss_subject_vehicle_facts_valid check (
    vehicle_facts is null or public.subject_vehicle_facts_are_valid(vehicle_facts)
  );
comment on column public.total_loss_case_details.vehicle_facts is
  'Explicit customer-confirmed body and powertrain facts; unknown facts remain absent. Included in immutable analysis snapshots.';
grant select (vehicle_facts), insert (vehicle_facts), update (vehicle_facts)
  on public.total_loss_case_details to authenticated;

create or replace function public.set_total_loss_case_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  customer_input_changed boolean;
begin
  if (
    new.intake_mode = 'report'
    and new.intake_mode is distinct from old.intake_mode
  )
    or new.report_last_upload_id is distinct from old.report_last_upload_id
  then
    new.vehicle_configuration := null;
  elsif row(
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model
  ) is distinct from row(
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model
  )
    and new.vehicle_configuration is not distinct from old.vehicle_configuration
  then
    new.vehicle_configuration := null;
  end if;

  if new.report_last_upload_id is distinct from old.report_last_upload_id
    or (new.intake_mode = 'report' and new.intake_mode is distinct from old.intake_mode)
  then
    new.vehicle_facts := null;
  elsif row(new.vin, new.vehicle_year, new.vehicle_make, new.vehicle_model, new.vehicle_trim)
      is distinct from row(old.vin, old.vehicle_year, old.vehicle_make, old.vehicle_model, old.vehicle_trim)
    and new.vehicle_facts is not distinct from old.vehicle_facts
  then
    new.vehicle_facts := null;
  end if;

  customer_input_changed := row(
    new.intake_mode,
    new.vin,
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model,
    new.vehicle_trim,
    new.vehicle_configuration,
    new.vehicle_facts,
    new.mileage_at_loss,
    new.postal_code,
    new.date_of_loss,
    new.insurer_name,
    new.insurer_vehicle_valuation,
    new.prior_title_status,
    new.vehicle_condition,
    new.existing_damage_description,
    new.vehicle_options_packages,
    new.report_original_filename,
    new.report_uploaded_at,
    new.report_last_upload_id
  ) is distinct from row(
    old.intake_mode,
    old.vin,
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model,
    old.vehicle_trim,
    old.vehicle_configuration,
    old.vehicle_facts,
    old.mileage_at_loss,
    old.postal_code,
    old.date_of_loss,
    old.insurer_name,
    old.insurer_vehicle_valuation,
    old.prior_title_status,
    old.vehicle_condition,
    old.existing_damage_description,
    old.vehicle_options_packages,
    old.report_original_filename,
    old.report_uploaded_at,
    old.report_last_upload_id
  );

  if customer_input_changed
    or row(
      new.intake_completed_at,
      new.report_facts_confirmed_at
    ) is distinct from row(
      old.intake_completed_at,
      old.report_facts_confirmed_at
    )
  then
    new.updated_at := statement_timestamp();
    new.analysis_input_revision := old.analysis_input_revision + 1;
    new.analysis_input_id := gen_random_uuid();

    if customer_input_changed then
      new.intake_completed_at := null;
      new.report_facts_confirmed_at := null;
      new.report_extraction_status := case
        when new.intake_mode = 'report'
          and new.report_last_upload_id is not null
          then 'pending'
        else 'not_requested'
      end;
      new.report_extraction_confidence := null;
      new.report_extracted_at := null;
      new.report_extraction_source_upload_id := null;
      new.report_extraction_input_revision := null;

      if new.intake_mode <> 'report' then
        new.report_provider_name := null;
      end if;
    end if;
  else
    new.updated_at := old.updated_at;
    new.analysis_input_revision := old.analysis_input_revision;
    new.analysis_input_id := old.analysis_input_id;
  end if;

  return new;
end;
$$;

comment on function public.set_total_loss_case_details_updated_at() is
  'Invalidates stale provider vehicle identity, then advances customer-visible and opaque analysis fences for material claim-input changes, clears prior confirmation and stale extraction metadata after customer-input changes, and keeps lease/extraction coordination version-neutral.';

create or replace function public.build_total_loss_analysis_input_snapshot(
  details public.total_loss_case_details
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'case_id', $1.case_id,
    'intake_mode', $1.intake_mode,
    'vin', $1.vin,
    'vehicle_year', $1.vehicle_year,
    'vehicle_make', $1.vehicle_make,
    'vehicle_model', $1.vehicle_model,
    'vehicle_trim', $1.vehicle_trim,
    'vehicle_configuration', $1.vehicle_configuration,
    'vehicle_facts', $1.vehicle_facts,
    'mileage_at_loss', $1.mileage_at_loss,
    'postal_code', nullif(btrim($1.postal_code), ''),
    'date_of_loss', $1.date_of_loss,
    'insurer_name', $1.insurer_name,
    'insurer_vehicle_valuation', $1.insurer_vehicle_valuation,
    'prior_title_status', $1.prior_title_status,
    'vehicle_condition', $1.vehicle_condition,
    'existing_damage_description', $1.existing_damage_description,
    'vehicle_options_packages', $1.vehicle_options_packages,
    'report_provider_name', $1.report_provider_name,
    'analysis_input_revision', $1.analysis_input_revision,
    'analysis_input_id', $1.analysis_input_id,
    'intake_completed_at', $1.intake_completed_at
  );
$$;

comment on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) is
  'Builds the bounded, provider-neutral, customer-confirmed input snapshot returned only through trusted analysis coordination, including retained provider vehicle identity, title history, and conditionally described pre-loss issues.';

-- Keep actionable validation attached to its exact failed job for case resume.
alter table public.total_loss_analysis_jobs add column subject_readiness jsonb
  check (subject_readiness is null or (jsonb_typeof(subject_readiness) = 'object'
    and octet_length(subject_readiness::text) <= 8192));
alter type public.total_loss_analysis_result add attribute subject_readiness jsonb;

create function public.fail_total_loss_analysis_subject_readiness(
  job_id uuid, processing_token uuid, subject_readiness jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if $3 is null or jsonb_typeof($3) <> 'object' or octet_length($3::text) > 8192
    or $3->'ready' is distinct from 'false'::jsonb
    or jsonb_typeof($3->'issues') is distinct from 'array'
  then raise exception using errcode = '22023', message = 'Invalid subject readiness result.'; end if;
  if not public.fail_total_loss_analysis($1, $2, 'ANALYSIS_INPUT_INVALID', false)
  then return false; end if;
  update public.total_loss_analysis_jobs set subject_readiness = $3 where id = $1;
  return true;
end;
$$;
revoke all on function public.fail_total_loss_analysis_subject_readiness(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_total_loss_analysis_subject_readiness(uuid, uuid, jsonb) to service_role;

create or replace function public.get_total_loss_analysis_status(
  case_id uuid,
  user_id uuid
)
returns setof public.total_loss_analysis_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  details_row public.total_loss_case_details%rowtype;
  job_row public.total_loss_analysis_jobs%rowtype;
  result_row public.total_loss_analysis_result;
begin
  if $1 is null or $2 is null or not exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = $1
      and appraisal_case.user_id = $2
      and appraisal_case.service_type = 'total_loss'
  ) then
    result_row.outcome := 'not_found';
    return next result_row;
    return;
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1;

  if not found then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  result_row.postal_code := nullif(btrim(details_row.postal_code), '');
  result_row.intake_mode := details_row.intake_mode;
  result_row.source_report_upload_id := case
    when details_row.intake_mode = 'report'
      then details_row.report_last_upload_id
    else null
  end;
  result_row.analysis_input_revision := details_row.analysis_input_revision;
  result_row.analysis_input_id := details_row.analysis_input_id;
  result_row.input_snapshot :=
    public.build_total_loss_analysis_input_snapshot(details_row);

  if details_row.intake_mode = 'report' then
    result_row.storage_bucket := 'case-files';
    result_row.storage_owner_id := details_row.report_storage_owner_id;
    result_row.storage_object_path :=
      details_row.report_storage_owner_id::text || '/' || details_row.case_id::text
      || '/valuation-report.pdf';
    result_row.report_extraction_available := exists (
      select 1
      from public.total_loss_report_extractions as extraction
      where extraction.case_id = details_row.case_id
        and extraction.report_upload_id = details_row.report_last_upload_id
        and extraction.analysis_input_revision =
          details_row.analysis_input_revision
        and extraction.analysis_input_id = details_row.analysis_input_id
        and extraction.extraction_status = 'confirmed'
    );

    if details_row.report_last_upload_id is null then
      result_row.outcome := 'not_submitted';
      return next result_row;
      return;
    end if;

    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'report'
      and analysis_job.source_report_upload_id = details_row.report_last_upload_id
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id;
  else
    result_row.report_extraction_available := false;

    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'manual'
      and analysis_job.source_report_upload_id is null
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id;
  end if;

  if not found then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  result_row.outcome := job_row.status::text::public.total_loss_analysis_outcome;
  result_row.job_id := job_row.id;
  result_row.status := job_row.status;
  result_row.attempt_count := job_row.attempt_count;
  result_row.run_id := job_row.run_id;
  result_row.failure_code := job_row.failure_code;
  result_row.retryable := job_row.retryable;
  result_row.subject_readiness := job_row.subject_readiness;
  result_row.processing_expires_at := job_row.processing_expires_at;
  return next result_row;
end;
$$;

comment on function public.get_total_loss_analysis_status(uuid, uuid) is
  'Returns bounded current-source status for either report or manual intake after explicit trusted owner verification.';

