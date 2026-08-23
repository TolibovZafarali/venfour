alter table public.profiles
add column full_name_confirmed_at timestamptz,
add column service_terms_version text,
add column service_terms_acknowledged_at timestamptz,
add column privacy_notice_version text,
add column privacy_notice_acknowledged_at timestamptz,
add column operational_follow_up_allowed boolean,
add column operational_follow_up_updated_at timestamptz,
add constraint profiles_confirmed_name_valid
  check (
    full_name_confirmed_at is null
    or (
      display_name is not null
      and char_length(display_name) between 1 and 200
      and display_name = regexp_replace(
        btrim(display_name),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and display_name !~ '[[:cntrl:]]'
      and display_name !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
add constraint profiles_service_terms_acknowledgement_complete
  check (
    (service_terms_version is null) =
      (service_terms_acknowledged_at is null)
  ),
add constraint profiles_privacy_notice_acknowledgement_complete
  check (
    (privacy_notice_version is null) =
      (privacy_notice_acknowledged_at is null)
  ),
add constraint profiles_operational_follow_up_preference_complete
  check (
    (operational_follow_up_allowed is null) =
      (operational_follow_up_updated_at is null)
  );

comment on column public.profiles.display_name is
  'The customer-confirmed full name once full_name_confirmed_at is present. Auth provider metadata may only be an unpersisted suggestion.';
comment on column public.profiles.full_name_confirmed_at is
  'Database time when the customer most recently confirmed or corrected display_name as their full name.';
comment on column public.profiles.service_terms_version is
  'The version of the required service terms most recently acknowledged by this customer.';
comment on column public.profiles.service_terms_acknowledged_at is
  'Database time when this customer acknowledged service_terms_version.';
comment on column public.profiles.privacy_notice_version is
  'The version of the required privacy notice most recently acknowledged by this customer.';
comment on column public.profiles.privacy_notice_acknowledged_at is
  'Database time when this customer acknowledged privacy_notice_version.';
comment on column public.profiles.operational_follow_up_allowed is
  'Optional permission for non-service-critical operational follow-up. NULL means no preference has been recorded and does not limit transactional service communication.';
comment on column public.profiles.operational_follow_up_updated_at is
  'Database time when the optional operational follow-up preference was recorded or changed.';

create function public.protect_confirmed_customer_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name
    and new.full_name_confirmed_at is not distinct from old.full_name_confirmed_at
  then
    if old.full_name_confirmed_at is not null then
      raise exception using
        errcode = '42501',
        message = 'A confirmed customer name must be changed through the profile-confirmation workflow.';
    end if;

    new.full_name_confirmed_at := null;
  end if;

  return new;
end;
$$;

comment on function public.protect_confirmed_customer_name() is
  'Trigger-only guard that prevents a confirmed name from being silently replaced and keeps direct pre-confirmation display-name edits unconfirmed.';

revoke execute on function public.protect_confirmed_customer_name() from public;
revoke execute on function public.protect_confirmed_customer_name() from anon;
revoke execute on function public.protect_confirmed_customer_name() from authenticated;
revoke execute on function public.protect_confirmed_customer_name() from service_role;

create trigger profiles_protect_confirmed_customer_name
before update on public.profiles
for each row execute function public.protect_confirmed_customer_name();

create function public.has_current_customer_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    where profile.id = (select auth.uid())
      and nullif(btrim(profile.display_name), '') is not null
      and profile.full_name_confirmed_at is not null
      and profile.service_terms_version = '2026-08-23'
      and profile.service_terms_acknowledged_at is not null
      and profile.privacy_notice_version = '2026-08-23'
      and profile.privacy_notice_acknowledged_at is not null
      and profile.operational_follow_up_allowed is not null
      and profile.operational_follow_up_updated_at is not null
      and nullif(btrim(auth_user.email), '') is not null
      and auth_user.email_confirmed_at is not null
  );
$$;

comment on function public.has_current_customer_profile() is
  'Returns only whether the current Auth identity has a verified email, confirmed full name, current required acknowledgements, and an explicit optional follow-up preference.';

revoke execute on function public.has_current_customer_profile() from public;
revoke execute on function public.has_current_customer_profile() from anon;
grant execute on function public.has_current_customer_profile() to authenticated;
revoke execute on function public.has_current_customer_profile() from service_role;

create function public.confirm_customer_profile(
  full_name text,
  service_terms_version text,
  privacy_notice_version text,
  operational_follow_up_allowed boolean
)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  normalized_full_name text;
  profile_row public.profiles%rowtype;
  confirmation_time timestamptz := statement_timestamp();
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to confirm a customer profile.';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = authenticated_user_id
      and nullif(btrim(auth_user.email), '') is not null
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = '42501',
      message = 'A verified Auth email is required to confirm a customer profile.';
  end if;

  normalized_full_name := regexp_replace(
    btrim(coalesce($1, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if char_length(normalized_full_name) not between 1 and 200
    or normalized_full_name ~ '[[:cntrl:]]'
    or normalized_full_name ~
      U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe full name between 1 and 200 characters is required.';
  end if;

  if $2 is distinct from '2026-08-23'::text
    or $3 is distinct from '2026-08-23'::text
  then
    raise exception using
      errcode = '22023',
      message = 'The current service and privacy versions must be acknowledged.';
  end if;

  if $4 is null then
    raise exception using
      errcode = '22023',
      message = 'An explicit operational follow-up preference is required.';
  end if;

  update public.profiles as profile
  set
    display_name = normalized_full_name,
    full_name_confirmed_at = case
      when profile.display_name is distinct from normalized_full_name
        or profile.full_name_confirmed_at is null
        then confirmation_time
      else profile.full_name_confirmed_at
    end,
    service_terms_version = $2,
    service_terms_acknowledged_at = case
      when profile.service_terms_version is distinct from $2
        or profile.service_terms_acknowledged_at is null
        then confirmation_time
      else profile.service_terms_acknowledged_at
    end,
    privacy_notice_version = $3,
    privacy_notice_acknowledged_at = case
      when profile.privacy_notice_version is distinct from $3
        or profile.privacy_notice_acknowledged_at is null
        then confirmation_time
      else profile.privacy_notice_acknowledged_at
    end,
    operational_follow_up_allowed = $4,
    operational_follow_up_updated_at = case
      when profile.operational_follow_up_allowed is distinct from $4
        or profile.operational_follow_up_updated_at is null
        then confirmation_time
      else profile.operational_follow_up_updated_at
    end
  where profile.id = authenticated_user_id
  returning profile.* into profile_row;

  if not found then
    insert into public.profiles (
      id,
      display_name,
      full_name_confirmed_at,
      service_terms_version,
      service_terms_acknowledged_at,
      privacy_notice_version,
      privacy_notice_acknowledged_at,
      operational_follow_up_allowed,
      operational_follow_up_updated_at
    )
    values (
      authenticated_user_id,
      normalized_full_name,
      confirmation_time,
      $2,
      confirmation_time,
      $3,
      confirmation_time,
      $4,
      confirmation_time
    )
    returning * into profile_row;
  end if;

  return profile_row;
end;
$$;

comment on function public.confirm_customer_profile(text, text, text, boolean) is
  'Confirms the current verified-email customer full name, current required service/privacy versions, and distinct optional operational follow-up preference using database timestamps.';

revoke execute on function public.confirm_customer_profile(text, text, text, boolean) from public;
revoke execute on function public.confirm_customer_profile(text, text, text, boolean) from anon;
grant execute on function public.confirm_customer_profile(text, text, text, boolean) to authenticated;
revoke execute on function public.confirm_customer_profile(text, text, text, boolean) from service_role;

create function public.get_or_create_total_loss_draft()
returns public.appraisal_cases
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  case_row public.appraisal_cases%rowtype;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to prepare a total-loss draft.';
  end if;

  if not (select public.has_current_customer_profile()) then
    raise exception using
      errcode = '42501',
      message = 'A current confirmed customer profile is required to prepare a total-loss draft.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'venfour:total-loss-draft:' || authenticated_user_id::text,
      0
    )
  );

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  order by
    appraisal_case.last_activity_at desc,
    appraisal_case.created_at desc,
    appraisal_case.id desc
  limit 1
  for update;

  if found then
    return case_row;
  end if;

  insert into public.appraisal_cases (user_id, service_type)
  values (authenticated_user_id, 'total_loss')
  returning * into case_row;

  return case_row;
end;
$$;

comment on function public.get_or_create_total_loss_draft() is
  'Advisory-locks the authenticated customer draft scope, returns the newest owned Total-Loss draft when present, and otherwise creates one explicitly owner-scoped draft. The legacy owned direct-insert policy remains temporarily available for rollout compatibility.';

revoke execute on function public.get_or_create_total_loss_draft() from public;
revoke execute on function public.get_or_create_total_loss_draft() from anon;
grant execute on function public.get_or_create_total_loss_draft() to authenticated;
revoke execute on function public.get_or_create_total_loss_draft() from service_role;

create type public.case_operation_stage as enum (
  'intake_not_started',
  'intake_in_progress',
  'report_uploaded',
  'report_required',
  'ready_for_analysis',
  'analysis_processing',
  'analysis_failed',
  'analysis_complete',
  'submitted',
  'closed',
  'needs_attention'
);

comment on type public.case_operation_stage is
  'A computed customer/operator read-model stage. It is derived from current domain facts and is not persisted into appraisal_cases.status.';

revoke all on type public.case_operation_stage from public;
revoke all on type public.case_operation_stage from anon;
grant usage on type public.case_operation_stage to authenticated, service_role;
grant usage on type public.total_loss_analysis_status to authenticated;

create view public.total_loss_case_operations_internal
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
      and analysis_run.id is not null
      and appraisal_case.status in ('check_complete', 'completed')
      then 'analysis_complete'::public.case_operation_stage
    when analysis_job.status = 'completed'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'processing'
      and appraisal_case.status = 'checking'
      and analysis_job.processing_expires_at > statement_timestamp()
      then 'analysis_processing'::public.case_operation_stage
    when analysis_job.status = 'processing'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'failed'
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
  'Unprivileged internal projection for current-report-aware Total-Loss operations. Browser access is available only through owner- or staff-gated RPCs.';

revoke all on table public.total_loss_case_operations_internal from public;
revoke all on table public.total_loss_case_operations_internal from anon;
revoke all on table public.total_loss_case_operations_internal from authenticated;
revoke all on table public.total_loss_case_operations_internal from service_role;

create function public.list_owned_case_operations()
returns table (
  case_id uuid,
  owner_user_id uuid,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  report_uploaded_at timestamptz,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_retryable boolean,
  analysis_failure_code text,
  analysis_processing_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.report_uploaded_at,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_retryable,
    operation.analysis_failure_code,
    operation.analysis_processing_expires_at
  from public.total_loss_case_operations_internal as operation
  where operation.owner_user_id = (select auth.uid())
    and (
      operation.case_status <> 'draft'
      or not exists (
        select 1
        from public.appraisal_cases as newer_draft
        where newer_draft.user_id = operation.owner_user_id
          and newer_draft.service_type = 'total_loss'
          and newer_draft.status = 'draft'
          and row(
            newer_draft.last_activity_at,
            newer_draft.created_at,
            newer_draft.id
          ) > row(
            operation.last_activity_at,
            operation.case_created_at,
            operation.case_id
          )
      )
    )

  union all

  select
    appraisal_case.id,
    appraisal_case.user_id,
    appraisal_case.service_type,
    appraisal_case.status,
    case appraisal_case.status
      when 'draft' then 'intake_in_progress'::public.case_operation_stage
      when 'submitted' then 'submitted'::public.case_operation_stage
      when 'closed' then 'closed'::public.case_operation_stage
      else 'needs_attention'::public.case_operation_stage
    end,
    appraisal_case.status not in ('draft', 'submitted', 'closed'),
    appraisal_case.created_at,
    appraisal_case.updated_at,
    appraisal_case.last_activity_at,
    null::timestamptz,
    null::public.total_loss_analysis_status,
    null::integer,
    null::boolean,
    null::text,
    null::timestamptz
  from public.appraisal_cases as appraisal_case
  where appraisal_case.user_id = (select auth.uid())
    and appraisal_case.service_type = 'diminished_value'

  order by last_activity_at desc, case_id desc;
$$;

comment on function public.list_owned_case_operations() is
  'Returns customer-owned case read models, including a current-report-aware computed Total-Loss caseStage, while presenting only the same newest recoverable Total-Loss draft selected by the atomic resolver and exposing no internal report tokens or analysis artifacts.';

revoke execute on function public.list_owned_case_operations() from public;
revoke execute on function public.list_owned_case_operations() from anon;
grant execute on function public.list_owned_case_operations() to authenticated;
revoke execute on function public.list_owned_case_operations() from service_role;

create function public.staff_list_case_operations()
returns table (
  case_id uuid,
  owner_user_id uuid,
  customer_full_name text,
  verified_email text,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  report_uploaded_at timestamptz,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_retryable boolean,
  analysis_failure_code text,
  analysis_processing_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.customer_full_name,
    operation.verified_email,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.report_uploaded_at,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_retryable,
    operation.analysis_failure_code,
    operation.analysis_processing_expires_at
  from public.total_loss_case_operations_internal as operation
  where (select public.is_venfour_staff())

  union all

  select
    appraisal_case.id,
    appraisal_case.user_id,
    coalesce(
      case
        when profile.full_name_confirmed_at is not null
          then profile.display_name
        else null
      end,
      nullif(btrim(details.full_name), '')
    ),
    case
      when auth_user.email_confirmed_at is not null
        then auth_user.email
      else null
    end,
    appraisal_case.service_type,
    appraisal_case.status,
    'submitted'::public.case_operation_stage,
    false,
    appraisal_case.created_at,
    appraisal_case.updated_at,
    appraisal_case.last_activity_at,
    null::timestamptz,
    null::public.total_loss_analysis_status,
    null::integer,
    null::boolean,
    null::text,
    null::timestamptz
  from public.appraisal_cases as appraisal_case
  join public.diminished_value_case_details as details
    on details.case_id = appraisal_case.id
    and details.submitted_at is not null
  join auth.users as auth_user
    on auth_user.id = appraisal_case.user_id
  left join public.profiles as profile
    on profile.id = appraisal_case.user_id
  where (select public.is_venfour_staff())
    and appraisal_case.service_type = 'diminished_value'
    and appraisal_case.status = 'submitted'

  order by last_activity_at desc, case_id desc;
$$;

comment on function public.staff_list_case_operations() is
  'Returns all Total-Loss cases and only authoritative submitted Diminished Value cases to currently authorized staff, including verified Auth email through a tightly scoped projection.';

revoke execute on function public.staff_list_case_operations() from public;
revoke execute on function public.staff_list_case_operations() from anon;
grant execute on function public.staff_list_case_operations() to authenticated;
revoke execute on function public.staff_list_case_operations() from service_role;

create function public.staff_get_total_loss_case_operation(
  requested_case_id uuid
)
returns table (
  case_id uuid,
  owner_user_id uuid,
  customer_full_name text,
  verified_email text,
  operational_follow_up_allowed boolean,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  intake_mode public.total_loss_intake_mode,
  vin text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  mileage_at_loss integer,
  postal_code text,
  date_of_loss date,
  insurer_name text,
  insurer_vehicle_valuation numeric(12, 2),
  intake_completed_at timestamptz,
  details_created_at timestamptz,
  details_updated_at timestamptz,
  report_original_filename text,
  report_uploaded_at timestamptz,
  analysis_job_id uuid,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_failure_code text,
  analysis_retryable boolean,
  analysis_processing_expires_at timestamptz,
  analysis_job_created_at timestamptz,
  analysis_job_updated_at timestamptz,
  analysis_job_finished_at timestamptz,
  analysis_run_id uuid,
  analysis_run_created_at timestamptz,
  analysis_run_schema_version text,
  analysis_version text,
  discrepancy_analysis_version text,
  comparable_scoring_version text,
  analysis_classification text,
  analysis_evidence_strength text,
  analysis_evidence_basis text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.customer_full_name,
    operation.verified_email,
    operation.operational_follow_up_allowed,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.intake_mode,
    operation.vin,
    operation.vehicle_year,
    operation.vehicle_make,
    operation.vehicle_model,
    operation.vehicle_trim,
    operation.mileage_at_loss,
    operation.postal_code,
    operation.date_of_loss,
    operation.insurer_name,
    operation.insurer_vehicle_valuation,
    operation.intake_completed_at,
    operation.details_created_at,
    operation.details_updated_at,
    operation.report_original_filename,
    operation.report_uploaded_at,
    operation.analysis_job_id,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_failure_code,
    operation.analysis_retryable,
    operation.analysis_processing_expires_at,
    operation.analysis_job_created_at,
    operation.analysis_job_updated_at,
    operation.analysis_job_finished_at,
    operation.analysis_run_id,
    operation.analysis_run_created_at,
    operation.analysis_run_schema_version,
    operation.analysis_version,
    operation.discrepancy_analysis_version,
    operation.comparable_scoring_version,
    operation.analysis_classification,
    operation.analysis_evidence_strength,
    operation.analysis_evidence_basis
  from public.total_loss_case_operations_internal as operation
  where (select public.is_venfour_staff())
    and operation.case_id = $1;
$$;

comment on function public.staff_get_total_loss_case_operation(uuid) is
  'Returns one bounded read-only Total-Loss operational detail to currently authorized staff and no row for nonstaff, DV, foreign, or nonexistent identifiers.';

revoke execute on function public.staff_get_total_loss_case_operation(uuid) from public;
revoke execute on function public.staff_get_total_loss_case_operation(uuid) from anon;
grant execute on function public.staff_get_total_loss_case_operation(uuid) to authenticated;
revoke execute on function public.staff_get_total_loss_case_operation(uuid) from service_role;
