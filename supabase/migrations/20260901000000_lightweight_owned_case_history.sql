-- Keep the owned-case list complete and lightweight. Rich post-Continue state
-- remains available only through the focal-case claim resolver.

drop function public.list_owned_case_operations();

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
  analysis_processing_expires_at timestamptz,
  has_total_loss_claim_workflow boolean
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
    ) or coalesce(
      commerce.entitlement_status in (
        'suspended'::public.case_entitlement_status,
        'revoked'::public.case_entitlement_status
      ),
      false
    ) or coalesce(
      commerce.order_status = 'void'::public.commerce_order_status
        and commerce.entitlement_status is null,
      false
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    greatest(
      operation.last_activity_at,
      workflow.updated_at,
      commerce.order_updated_at,
      commerce.entitlement_updated_at
    ) as last_activity_at,
    operation.report_uploaded_at,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_retryable,
    operation.analysis_failure_code,
    operation.analysis_processing_expires_at,
    workflow.case_id is not null as has_total_loss_claim_workflow
  from public.total_loss_case_operations_internal as operation
  left join public.total_loss_claim_workflows as workflow
    on workflow.case_id = operation.case_id
  left join lateral (
    select
      commerce_order.status as order_status,
      commerce_order.updated_at as order_updated_at,
      entitlement.status as entitlement_status,
      entitlement.updated_at as entitlement_updated_at
    from public.commerce_orders as commerce_order
    left join public.case_entitlements as entitlement
      on entitlement.order_id = commerce_order.id
    where commerce_order.case_id = operation.case_id
    order by commerce_order.created_at desc, commerce_order.id desc
    limit 1
  ) as commerce on true
  where operation.owner_user_id = (select auth.uid())

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
    null::timestamptz,
    false
  from public.appraisal_cases as appraisal_case
  where appraisal_case.user_id = (select auth.uid())
    and appraisal_case.service_type = 'diminished_value'

  order by last_activity_at desc, case_id desc;
$$;

comment on function public.list_owned_case_operations() is
  'Complete lightweight owned-case list with effective workflow and commerce activity plus coarse post-Continue existence and attention signals; focal rich state comes from the claim resolver.';

revoke execute on function public.list_owned_case_operations() from public, anon, service_role;
grant execute on function public.list_owned_case_operations() to authenticated;
