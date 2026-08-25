create or replace function public.acquire_total_loss_report_upload(
  case_id uuid,
  expected_updated_at timestamptz,
  upload_id uuid
)
returns setof public.total_loss_report_upload_lease
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  recovery_required boolean := false;
  details_found boolean := false;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to acquire a report-upload lease.';
  end if;

  if $3 is null then
    raise exception using
      errcode = '22023',
      message = 'A report-upload attempt identifier is required.';
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
      message = 'The report-upload case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;
  details_found := found;

  if details_found and details_row.report_upload_id = $3 then
    update public.total_loss_case_details as details
    set report_upload_expires_at = statement_timestamp() + interval '30 minutes'
    where details.case_id = $1
    returning details.* into details_row;

    return query
    select
      details_row.report_upload_id,
      details_row.report_upload_expires_at,
      details_row.report_upload_details_updated_at,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      details_row.report_upload_phase = 'recovering';
    return;
  end if;

  if $2 is null and details_found then
    raise exception using
      errcode = '40001',
      message = 'Total-loss details already exist for this case.';
  end if;

  if $2 is not null and (
    not details_found
    or details_row.updated_at is distinct from $2
  ) then
    raise exception using
      errcode = '40001',
      message = 'The total-loss details changed before the report upload began.';
  end if;

  if not details_found then
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      report_upload_id,
      report_upload_expires_at,
      report_upload_details_updated_at,
      report_upload_phase
    )
    values (
      $1,
      'report',
      $3,
      statement_timestamp() + interval '30 minutes',
      statement_timestamp(),
      'preparing'
    )
    returning * into details_row;

    return query
    select
      details_row.report_upload_id,
      details_row.report_upload_expires_at,
      details_row.report_upload_details_updated_at,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      false;
    return;
  end if;

  if details_row.report_upload_id is not null
    and details_row.report_upload_expires_at > statement_timestamp() then
    raise exception using
      errcode = '55P03',
      message = 'Another report upload is already active for this case.';
  end if;

  recovery_required :=
    details_row.report_upload_id is not null
    and details_row.report_upload_phase in ('ready', 'recovering')
    and details_row.report_upload_has_backup;

  update public.total_loss_case_details as details
  set
    report_upload_id = $3,
    report_upload_expires_at = statement_timestamp() + interval '30 minutes',
    report_upload_details_updated_at = details_row.updated_at,
    report_upload_phase = case
      when recovery_required then 'recovering'
      else 'preparing'
    end,
    report_upload_has_backup = recovery_required
  where details.case_id = $1
  returning details.* into details_row;

  return query
  select
    details_row.report_upload_id,
    details_row.report_upload_expires_at,
    details_row.report_upload_details_updated_at,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    recovery_required;
end;
$$;

comment on function public.acquire_total_loss_report_upload(uuid, timestamptz, uuid) is
  'Idempotently acquires one owned draft-case upload lease with a caller-reserved attempt ID, or takes over an expired lease in an explicit recovery phase.';

alter table public.total_loss_case_details
drop column report_upload_recovery_required;

alter table public.total_loss_case_details
add column report_upload_recovery_required boolean
generated always as (report_upload_id is not null) stored not null;

comment on column public.total_loss_case_details.report_upload_recovery_required is
  'Owner-visible safety gate derived from the existence of private in-flight report-upload coordination state.';

grant select (report_upload_recovery_required)
on public.total_loss_case_details to authenticated;

create or replace function public.reclaim_total_loss_report_upload(
  case_id uuid,
  expected_updated_at timestamptz,
  upload_id uuid
)
returns setof public.total_loss_report_upload_lease
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  recovery_required boolean := false;
  backup_path text;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to reclaim a report upload.';
  end if;

  if $2 is null or $3 is null then
    raise exception using
      errcode = '22023',
      message = 'A details version and upload attempt identifier are required.';
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
      message = 'The report-upload case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'No interrupted report upload is available to reclaim.';
  end if;

  if details_row.updated_at is distinct from $2 then
    raise exception using
      errcode = '40001',
      message = 'The total-loss details changed before recovery began.';
  end if;

  if details_row.report_upload_id is null then
    raise exception using
      errcode = '55000',
      message = 'No interrupted report upload is available to reclaim.';
  end if;

  if details_row.report_upload_id = $3 then
    update public.total_loss_case_details as details
    set report_upload_expires_at = statement_timestamp() + interval '30 minutes'
    where details.case_id = $1
    returning details.* into details_row;

    return query
    select
      details_row.report_upload_id,
      details_row.report_upload_expires_at,
      details_row.report_upload_details_updated_at,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      details_row.report_upload_phase = 'recovering'
        and details_row.report_upload_has_backup;
    return;
  end if;

  recovery_required :=
    details_row.report_upload_phase in ('ready', 'recovering')
    and details_row.report_upload_has_backup;

  if recovery_required then
    backup_path := details_row.report_storage_owner_id::text || '/'
      || $1::text || '/valuation-report-backup.pdf';

    if not exists (
      select 1
      from storage.objects as stored_object
      where stored_object.bucket_id = 'case-files'
        and stored_object.name = backup_path
        and stored_object.user_metadata ->> 'uploadId'
          = details_row.report_upload_id::text
    ) then
      raise exception using
        errcode = '55000',
        message = 'The interrupted report backup is unavailable for recovery.';
    end if;
  end if;

  update public.total_loss_case_details as details
  set
    report_upload_id = $3,
    report_upload_expires_at = statement_timestamp() + interval '30 minutes',
    report_upload_details_updated_at = details_row.updated_at,
    report_upload_phase = case
      when recovery_required then 'recovering'
      else 'preparing'
    end,
    report_upload_has_backup = recovery_required
  where details.case_id = $1
  returning details.* into details_row;

  return query
  select
    details_row.report_upload_id,
    details_row.report_upload_expires_at,
    details_row.report_upload_details_updated_at,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    recovery_required;
end;
$$;

comment on function public.reclaim_total_loss_report_upload(uuid, timestamptz, uuid) is
  'Rotates an owned interrupted report-upload lease to a fresh caller-known token without exposing the prior token or weakening ordinary acquisition.';

revoke execute on function public.reclaim_total_loss_report_upload(uuid, timestamptz, uuid) from public;
revoke execute on function public.reclaim_total_loss_report_upload(uuid, timestamptz, uuid) from anon;
grant execute on function public.reclaim_total_loss_report_upload(uuid, timestamptz, uuid) to authenticated, service_role;
