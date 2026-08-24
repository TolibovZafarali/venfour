-- Forward-only correction for PL/pgSQL parameter/column ambiguity found by
-- linked database lint after the guest-first migration was applied.

create or replace function public.save_total_loss_contact_and_begin_claim(
  case_id uuid,
  full_name text,
  email text,
  service_terms_version text,
  privacy_notice_version text,
  operational_follow_up_allowed boolean
)
returns setof public.total_loss_case_claim_begin_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  normalized_full_name text;
  normalized_email text;
  recorded_at timestamptz := statement_timestamp();
  contact_row public.total_loss_case_contacts%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  result_row public.total_loss_case_claim_begin_result;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to save Total-Loss contact information.';
  end if;

  normalized_full_name := regexp_replace(
    btrim(coalesce($2, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_email := lower(btrim(coalesce($3, '')));

  if char_length(normalized_full_name) not between 1 and 200
    or normalized_full_name ~ '[[:cntrl:]]'
    or normalized_full_name ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe full name between 1 and 200 characters is required.';
  end if;

  if char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_email ~ '[[:cntrl:]]'
    or normalized_email ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A valid email address is required.';
  end if;

  if $4 is distinct from '2026-08-23'::text
    or $5 is distinct from '2026-08-23'::text
  then
    raise exception using
      errcode = '22023',
      message = 'The current service and privacy versions must be acknowledged.';
  end if;

  if $6 is null then
    raise exception using
      errcode = '22023',
      message = 'An explicit optional follow-up preference is required.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_details as details
    on details.case_id = appraisal_case.id
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update of appraisal_case;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss draft is unavailable for contact confirmation.';
  end if;

  insert into public.total_loss_case_contacts (
    case_id,
    full_name,
    email,
    email_verified_at,
    service_terms_version,
    service_terms_acknowledged_at,
    privacy_notice_version,
    privacy_notice_acknowledged_at,
    operational_follow_up_allowed,
    operational_follow_up_updated_at
  )
  values (
    $1,
    normalized_full_name,
    normalized_email,
    null,
    $4,
    recorded_at,
    $5,
    recorded_at,
    $6,
    recorded_at
  )
  on conflict on constraint total_loss_case_contacts_pkey do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    email_verified_at = null,
    service_terms_version = excluded.service_terms_version,
    service_terms_acknowledged_at = case
      when total_loss_case_contacts.service_terms_version
        is distinct from excluded.service_terms_version
        then excluded.service_terms_acknowledged_at
      else total_loss_case_contacts.service_terms_acknowledged_at
    end,
    privacy_notice_version = excluded.privacy_notice_version,
    privacy_notice_acknowledged_at = case
      when total_loss_case_contacts.privacy_notice_version
        is distinct from excluded.privacy_notice_version
        then excluded.privacy_notice_acknowledged_at
      else total_loss_case_contacts.privacy_notice_acknowledged_at
    end,
    operational_follow_up_allowed = excluded.operational_follow_up_allowed,
    operational_follow_up_updated_at = case
      when total_loss_case_contacts.operational_follow_up_allowed
        is distinct from excluded.operational_follow_up_allowed
        then excluded.operational_follow_up_updated_at
      else total_loss_case_contacts.operational_follow_up_updated_at
    end
  returning * into contact_row;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = $1
    and identity_claim.source_user_id = authenticated_user_id
    and identity_claim.requested_email = normalized_email
    and identity_claim.claimed_at is null
    and identity_claim.revoked_at is null
    and identity_claim.expires_at > recorded_at
  for update;

  if not found then
    update public.total_loss_case_identity_claims as identity_claim
    set revoked_at = recorded_at
    where identity_claim.case_id = $1
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      expires_at
    )
    values (
      $1,
      authenticated_user_id,
      normalized_email,
      recorded_at + interval '30 minutes'
    )
    returning * into claim_row;
  end if;

  result_row.case_id := $1;
  result_row.full_name := contact_row.full_name;
  result_row.email := contact_row.email;
  result_row.email_verified_at := contact_row.email_verified_at;
  result_row.service_terms_version := contact_row.service_terms_version;
  result_row.service_terms_acknowledged_at :=
    contact_row.service_terms_acknowledged_at;
  result_row.privacy_notice_version := contact_row.privacy_notice_version;
  result_row.privacy_notice_acknowledged_at :=
    contact_row.privacy_notice_acknowledged_at;
  result_row.operational_follow_up_allowed :=
    contact_row.operational_follow_up_allowed;
  result_row.operational_follow_up_updated_at :=
    contact_row.operational_follow_up_updated_at;
  result_row.created_at := contact_row.created_at;
  result_row.updated_at := contact_row.updated_at;
  result_row.claim_id := claim_row.id;
  result_row.claim_expires_at := claim_row.expires_at;
  return next result_row;
end;
$$;

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
    or nullif(btrim(details_row.vehicle_condition), '') is null
    or nullif(btrim(details_row.vehicle_options_packages), '') is null
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

create or replace function public.persist_total_loss_report_extraction(
  case_id uuid,
  report_upload_id uuid,
  analysis_input_revision bigint,
  provider_name text,
  extraction_status text,
  confidence numeric,
  extraction_schema_version text,
  normalized_report jsonb
)
returns setof public.total_loss_report_extraction_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  details_row public.total_loss_case_details%rowtype;
  extraction_row public.total_loss_report_extractions%rowtype;
  normalized_provider text := nullif(btrim($4), '');
  recorded_at timestamptz := statement_timestamp();
  canonical_path text;
begin
  if $1 is null
    or $2 is null
    or $3 is null
    or $5 is null
    or $7 is null
    or $5 not in ('needs_confirmation', 'confirmed', 'failed')
    or $7 !~ '^[0-9]{1,16}$'
    or $6 is not null and ($6 < 0 or $6 > 1)
    or normalized_provider is not null and (
      char_length(normalized_provider) > 200
      or normalized_provider ~ '[[:cntrl:]]'
      or normalized_provider ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
    or (
      $5 = 'failed'
      and $8 is not null
    )
    or (
      $5 in ('needs_confirmation', 'confirmed')
      and (
        coalesce(jsonb_typeof($8), 'missing') <> 'object'
        or pg_column_size($8) > 1048576
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'A bounded current report extraction is required.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
  where details.case_id = $1
    and appraisal_case.service_type = 'total_loss'
    and details.intake_mode = 'report'
    and details.report_upload_id is null
    and details.report_last_upload_id = $2
    and details.analysis_input_revision = $3
  for update of details;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  canonical_path := details_row.report_storage_owner_id::text || '/'
    || details_row.case_id::text || '/valuation-report.pdf';

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = canonical_path
      and stored_object.user_metadata ->> 'uploadId' = $2::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  insert into public.total_loss_report_extractions (
    case_id,
    report_upload_id,
    analysis_input_revision,
    analysis_input_id,
    provider_name,
    extraction_status,
    confidence,
    extraction_schema_version,
    normalized_report,
    extracted_at,
    updated_at
  )
  values (
    $1,
    $2,
    $3,
    details_row.analysis_input_id,
    normalized_provider,
    $5,
    $6,
    $7,
    $8,
    recorded_at,
    recorded_at
  )
  on conflict on constraint total_loss_report_extractions_pkey do update
  set
    analysis_input_id = excluded.analysis_input_id,
    provider_name = excluded.provider_name,
    extraction_status = excluded.extraction_status,
    confidence = excluded.confidence,
    extraction_schema_version = excluded.extraction_schema_version,
    normalized_report = excluded.normalized_report,
    extracted_at = excluded.extracted_at,
    updated_at = excluded.updated_at
  returning * into extraction_row;

  update public.total_loss_case_details as details
  set
    report_provider_name = normalized_provider,
    report_extraction_status = $5,
    report_extraction_confidence = $6,
    report_extracted_at = recorded_at,
    report_extraction_source_upload_id = $2,
    report_extraction_input_revision = $3
  where details.case_id = $1
    and details.report_last_upload_id = $2
    and details.analysis_input_revision = $3;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  return query
  select
    extraction_row.case_id,
    extraction_row.report_upload_id,
    extraction_row.analysis_input_revision,
    extraction_row.provider_name,
    extraction_row.extraction_status,
    extraction_row.confidence,
    extraction_row.extraction_schema_version,
    extraction_row.normalized_report,
    extraction_row.extracted_at,
    extraction_row.updated_at;
end;
$$;
