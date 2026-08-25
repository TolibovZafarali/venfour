drop trigger if exists total_loss_case_details_validate_claim_facts
on public.total_loss_case_details;

drop function if exists public.validate_total_loss_claim_facts_on_confirmation();

create or replace function public.confirm_total_loss_intake(
  case_id uuid,
  expected_details_updated_at timestamptz
)
returns setof public.total_loss_intake_confirmation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  confirmed_at timestamptz := statement_timestamp();
  canonical_path text;
  confirmed_source_revision bigint;
  confirmed_source_input_id uuid;
  cached_extraction_found boolean := false;
  cached_extraction_status text;
  cached_extraction_provider text;
  cached_extraction_confidence numeric(5, 4);
  cached_extraction_extracted_at timestamptz;
begin
  if authenticated_user_id is null or $1 is null or $2 is null then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss intake is unavailable for confirmation.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss intake is unavailable for confirmation.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found or details_row.updated_at is distinct from $2 then
    raise exception using
      errcode = '40001',
      message = 'The Total-Loss details changed before confirmation.';
  end if;

  perform 1
  from public.total_loss_case_contacts as contact
  where contact.case_id = $1
    and contact.service_terms_version = '2026-08-23'
    and contact.service_terms_acknowledged_at is not null
    and contact.privacy_notice_version = '2026-08-23'
    and contact.privacy_notice_acknowledged_at is not null
    and contact.operational_follow_up_allowed is not null
    and contact.operational_follow_up_updated_at is not null
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Current contact, legal acknowledgement, and follow-up preference are required.';
  end if;

  if details_row.vehicle_year is null
    or details_row.vehicle_year < 1886
    or details_row.vehicle_year > extract(year from current_date)::integer + 1
    or nullif(btrim(details_row.vehicle_make), '') is null
    or nullif(btrim(details_row.vehicle_model), '') is null
    or nullif(btrim(details_row.vehicle_trim), '') is null
    or details_row.mileage_at_loss is null
    or details_row.mileage_at_loss < 0
    or nullif(btrim(details_row.postal_code), '') is null
    or details_row.postal_code !~ '^[0-9]{5}(-[0-9]{4})?$'
    or details_row.date_of_loss is null
    or nullif(btrim(details_row.insurer_name), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'Complete every required vehicle and claim fact before confirmation.';
  end if;

  if details_row.intake_mode = 'report' then
    canonical_path := details_row.report_storage_owner_id::text || '/'
      || details_row.case_id::text || '/valuation-report.pdf';

    if details_row.report_upload_id is not null
      or details_row.report_last_upload_id is null
      or details_row.report_original_filename is null
      or details_row.report_uploaded_at is null
      or not exists (
        select 1
        from storage.objects as stored_object
        where stored_object.bucket_id = 'case-files'
          and stored_object.name = canonical_path
          and stored_object.user_metadata ->> 'uploadId'
            = details_row.report_last_upload_id::text
      )
    then
      raise exception using
        errcode = '22023',
        message = 'A finalized current valuation report is required.';
    end if;

    confirmed_source_revision := details_row.analysis_input_revision;
    confirmed_source_input_id := details_row.analysis_input_id;

    select
      extraction.extraction_status,
      extraction.provider_name,
      extraction.confidence,
      extraction.extracted_at
    into
      cached_extraction_status,
      cached_extraction_provider,
      cached_extraction_confidence,
      cached_extraction_extracted_at
    from public.total_loss_report_extractions as extraction
    where extraction.case_id = details_row.case_id
      and extraction.report_upload_id = details_row.report_last_upload_id
      and extraction.analysis_input_revision =
        details_row.analysis_input_revision
      and extraction.analysis_input_id = details_row.analysis_input_id
    for update;
    cached_extraction_found := found;

    if cached_extraction_found and (
      details_row.report_extraction_source_upload_id is distinct from
        details_row.report_last_upload_id
      or details_row.report_extraction_input_revision is distinct from
        details_row.analysis_input_revision
      or details_row.report_extraction_status is distinct from
        cached_extraction_status
      or details_row.report_provider_name is distinct from
        cached_extraction_provider
      or details_row.report_extraction_confidence is distinct from
        cached_extraction_confidence
      or details_row.report_extracted_at is distinct from
        cached_extraction_extracted_at
    ) then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction metadata is inconsistent.';
    elsif not cached_extraction_found and (
      details_row.report_extraction_source_upload_id is not null
      or details_row.report_extraction_input_revision is not null
      or details_row.report_extraction_status in (
        'needs_confirmation',
        'confirmed',
        'failed'
      )
    ) then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction metadata is inconsistent.';
    end if;
  elsif details_row.intake_mode <> 'manual' then
    raise exception using
      errcode = '22023',
      message = 'A supported Total-Loss intake mode is required.';
  end if;

  update public.total_loss_case_details as details
  set
    intake_completed_at = confirmed_at,
    report_facts_confirmed_at = case
      when details.intake_mode = 'report' then confirmed_at
      else null
    end
  where details.case_id = $1
  returning details.* into details_row;

  if cached_extraction_found then
    cached_extraction_status := case
      when cached_extraction_status = 'needs_confirmation' then 'confirmed'
      else cached_extraction_status
    end;

    update public.total_loss_report_extractions as extraction
    set
      analysis_input_revision = details_row.analysis_input_revision,
      analysis_input_id = details_row.analysis_input_id,
      extraction_status = cached_extraction_status,
      updated_at = confirmed_at
    where extraction.case_id = details_row.case_id
      and extraction.report_upload_id = details_row.report_last_upload_id
      and extraction.analysis_input_revision = confirmed_source_revision
      and extraction.analysis_input_id = confirmed_source_input_id;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction changed during confirmation.';
    end if;

    update public.total_loss_case_details as details
    set
      report_provider_name = cached_extraction_provider,
      report_extraction_status = cached_extraction_status,
      report_extraction_confidence = cached_extraction_confidence,
      report_extracted_at = cached_extraction_extracted_at,
      report_extraction_source_upload_id = details.report_last_upload_id,
      report_extraction_input_revision = details.analysis_input_revision
    where details.case_id = $1
      and details.analysis_input_revision = details_row.analysis_input_revision
      and details.analysis_input_id = details_row.analysis_input_id
    returning details.* into details_row;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction changed during confirmation.';
    end if;
  end if;

  update public.appraisal_cases as appraisal_case
  set last_activity_at = confirmed_at
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The Total-Loss draft could not be touched after confirmation.';
  end if;

  return query
  select
    details_row.case_id,
    details_row.intake_mode,
    details_row.vin,
    details_row.vehicle_year,
    details_row.vehicle_make,
    details_row.vehicle_model,
    details_row.vehicle_trim,
    details_row.mileage_at_loss,
    details_row.postal_code,
    details_row.date_of_loss,
    details_row.insurer_name,
    details_row.insurer_vehicle_valuation,
    details_row.vehicle_condition,
    details_row.vehicle_options_packages,
    details_row.report_provider_name,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    details_row.report_facts_confirmed_at,
    details_row.intake_completed_at,
    details_row.analysis_input_revision,
    details_row.analysis_input_id,
    details_row.updated_at;
end;
$$;

comment on function public.confirm_total_loss_intake(uuid, timestamptz) is
  'Confirms an owned Total-Loss intake after validating only the vehicle identity, mileage, ZIP code, date of loss, insurer, legal acknowledgement, and any required report evidence; condition, options, VIN, and insurer valuation remain optional.';

create or replace function public.total_loss_manual_input_is_complete(
  details public.total_loss_case_details
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    $1.intake_mode = 'manual'
    and $1.intake_completed_at is not null
    and $1.vehicle_year is not null
    and $1.vehicle_year between 1886
      and extract(year from current_date)::integer + 1
    and nullif(btrim($1.vehicle_make), '') is not null
    and nullif(btrim($1.vehicle_model), '') is not null
    and nullif(btrim($1.vehicle_trim), '') is not null
    and $1.mileage_at_loss is not null
    and $1.mileage_at_loss >= 0
    and nullif(btrim($1.postal_code), '') is not null
    and $1.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
    and $1.date_of_loss is not null
    and nullif(btrim($1.insurer_name), '') is not null;
$$;

comment on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) is
  'Deterministically validates the confirmed minimum manual analysis inputs; VIN, insurer valuation, title history, condition, damage description, and options remain optional.';
