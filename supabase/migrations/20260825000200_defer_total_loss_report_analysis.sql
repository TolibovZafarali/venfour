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

  if details_row.intake_mode = 'manual' then
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
  elsif details_row.intake_mode = 'report' then
    if nullif(btrim(details_row.postal_code), '') is null
      or details_row.postal_code !~ '^[0-9]{5}(-[0-9]{4})?$'
    then
      raise exception using
        errcode = '22023',
        message = 'A valid market ZIP code is required before report analysis.';
    end if;

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
  else
    raise exception using
      errcode = '22023',
      message = 'A supported Total-Loss intake mode is required.';
  end if;

  update public.total_loss_case_details as details
  set
    intake_completed_at = coalesce(details.intake_completed_at, confirmed_at),
    report_facts_confirmed_at = case
      when details.intake_mode = 'manual' then null
      else details.report_facts_confirmed_at
    end
  where details.case_id = $1
  returning details.* into details_row;

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
  'Confirms an owned Total-Loss intake after contact and legal acknowledgement. Manual intake requires the confirmed vehicle and claim facts; report intake requires only a market ZIP and finalized private report because report interpretation is deferred to analysis.';
