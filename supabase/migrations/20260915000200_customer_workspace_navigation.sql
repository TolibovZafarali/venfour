-- Add compact owner-only navigation facts without resolving every claim or
-- loading valuation artifacts. Existing lifecycle and payment authority stays
-- in the selected workspace's read contracts.
alter function public.list_owned_case_operations() rename to owned_case_operations_before_navigation_internal;
revoke all on function public.owned_case_operations_before_navigation_internal() from public, anon, authenticated, service_role;

create function public.list_owned_case_operations()
returns table (
  case_id uuid, owner_user_id uuid, service_type public.appraisal_service_type,
  case_status public.appraisal_case_status, case_stage public.case_operation_stage,
  needs_attention boolean, case_created_at timestamptz, case_updated_at timestamptz,
  last_activity_at timestamptz, report_uploaded_at timestamptz,
  analysis_status public.total_loss_analysis_status, analysis_attempt_count integer,
  analysis_retryable boolean, analysis_failure_code text, analysis_processing_expires_at timestamptz,
  has_total_loss_claim_workflow boolean, vehicle_label text,
  has_full_review_report boolean, workspace_status text
)
language sql stable security definer set search_path = '' as $$
  select c.case_id, c.owner_user_id, c.service_type, c.case_status, c.case_stage,
    c.needs_attention, c.case_created_at, c.case_updated_at,
    greatest(c.last_activity_at, r.updated_at, work.updated_at),
    c.report_uploaded_at, c.analysis_status, c.analysis_attempt_count,
    c.analysis_retryable, c.analysis_failure_code, c.analysis_processing_expires_at,
    c.has_total_loss_claim_workflow,
    nullif(concat_ws(' ', d.vehicle_year, nullif(btrim(d.vehicle_make), ''), nullif(btrim(d.vehicle_model), '')), ''),
    r.id is not null,
    case when c.has_total_loss_claim_workflow then w.current_task
      when work.status = 'completed' and r.status = 'ready' then 'review_prepared'
      when work.status = 'terminal_failed' then 'review_failed'
      when work.status is not null and work.status <> 'completed' then 'review_preparing'
      else r.status end
  from public.owned_case_operations_before_navigation_internal() c
  left join public.total_loss_case_details d on d.case_id = c.case_id
  left join public.total_loss_claim_workflows w on w.case_id = c.case_id
  left join lateral (
    select report.id, report.status, report.updated_at
    from public.total_loss_full_review_reports report
    join public.total_loss_analysis_jobs job on job.run_id = report.source_run_id and job.case_id = c.case_id
      and job.status = 'completed' and job.source_analysis_input_revision = d.analysis_input_revision
      and job.source_analysis_input_id is not distinct from d.analysis_input_id
    where report.case_id = c.case_id
    order by report.created_at desc, report.id desc limit 1
  ) r on true
  left join lateral (
    select item.status, item.updated_at from public.workflow_work_items item
    where item.full_review_report_id = r.id
    order by item.created_at desc, item.id desc limit 1
  ) work on true
  where c.owner_user_id = (select auth.uid())
  order by greatest(c.last_activity_at, r.updated_at, work.updated_at) desc, c.case_id desc;
$$;
revoke all on function public.list_owned_case_operations() from public, anon, service_role;
grant execute on function public.list_owned_case_operations() to authenticated;

-- Destination selection only; every staff/partner page retains its own access gate.
create function public.get_account_workspace_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_venfour_staff() then 'staff'
    when exists(select 1 from auth.users u where u.id = (select auth.uid())
      and not coalesce(u.is_anonymous, false) and u.email_confirmed_at is not null
      and (public.referral_partner_is_manager_internal(u.id)
        or exists(select 1 from public.referral_partners p where p.user_id = u.id))) then 'partner'
    else 'customer' end;
$$;
revoke all on function public.get_account_workspace_role() from public, anon, service_role;
grant execute on function public.get_account_workspace_role() to authenticated;
