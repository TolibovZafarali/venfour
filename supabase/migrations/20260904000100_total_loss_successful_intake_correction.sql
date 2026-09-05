create function public.prepare_total_loss_intake_correction(
  requested_case_id uuid,
  requested_user_id uuid,
  expected_analysis_input_id uuid,
  expected_analysis_input_revision bigint,
  expected_case_updated_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  case_row public.appraisal_cases%rowtype;
  details_row public.total_loss_case_details%rowtype;
begin
  if $1 is null
    or $2 is null
    or $3 is null
    or $4 is null
    or $4 < 1
    or $5 is null
  then
    return false;
  end if;

  -- Continuation locks this parent before freezing the preliminary snapshot.
  -- Taking the same lock first makes correction versus continuation deterministic.
  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = $2
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext($1::text)
  );

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found
    or case_row.status not in ('draft', 'check_complete')
    or (
      case_row.status = 'check_complete'
      and case_row.updated_at is distinct from $5
    )
    or details_row.analysis_input_id is distinct from $3
    or details_row.analysis_input_revision is distinct from $4
    or details_row.intake_completed_at is null
    or exists (
      select 1
      from public.total_loss_preliminary_snapshots as preliminary
      where preliminary.case_id = $1
    )
    or exists (
      select 1
      from public.total_loss_claim_workflows as workflow
      where workflow.case_id = $1
    )
  then
    return false;
  end if;

  if case_row.status = 'check_complete' then
    update public.appraisal_cases as appraisal_case
    set
      status = 'draft',
      last_activity_at = statement_timestamp()
    where appraisal_case.id = $1
      and appraisal_case.user_id = $2
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'check_complete'
      and appraisal_case.updated_at = $5
      and not exists (
        select 1
        from public.total_loss_preliminary_snapshots as preliminary
        where preliminary.case_id = $1
      )
      and not exists (
        select 1
        from public.total_loss_claim_workflows as workflow
        where workflow.case_id = $1
      );

    if not found then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.prepare_total_loss_intake_correction(
  uuid,
  uuid,
  uuid,
  bigint,
  timestamptz
) is
  'Atomically prepares an exact owned confirmed intake for correction only before any immutable preliminary snapshot or paid claim workflow exists.';

revoke all on function public.prepare_total_loss_intake_correction(
  uuid,
  uuid,
  uuid,
  bigint,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.prepare_total_loss_intake_correction(
  uuid,
  uuid,
  uuid,
  bigint,
  timestamptz
) to service_role;
