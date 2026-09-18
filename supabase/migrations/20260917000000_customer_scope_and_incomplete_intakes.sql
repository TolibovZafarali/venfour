-- Keep early report uploads available to staff without treating their owners as customers.
create or replace view public.staff_admin_case_index_internal as
select operation.*,
  workflow.phase::text as workflow_phase, workflow.current_task,
  workflow.current_package_job_id, workflow.current_report_version_id,
  workflow.current_response_analysis_job_id, workflow.resolution_code, workflow.resolved_at,
  workflow.revision as workflow_revision,
  coalesce(workflow.current_task, operation.case_stage::text) as current_status,
  operation.case_status <> 'closed' and workflow.resolved_at is null as is_active,
  greatest(operation.last_activity_at, workflow.updated_at,
    package.updated_at, response.updated_at, finance.updated_at, event.created_at) as activity_at,
  array_remove(array[
    case when workflow.case_id is null and operation.case_stage in ('analysis_failed','needs_attention')
      then coalesce(operation.analysis_failure_code, operation.case_stage::text) end,
    case when workflow.case_id is null and operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp() then 'REPORT_UPLOAD_EXPIRED' end,
    case when workflow.case_id is null and operation.intake_mode = 'report'
      and operation.report_last_upload_id is not null and operation.report_upload_id is null
      and not operation.canonical_report_available then 'REPORT_UPLOAD_INCOMPLETE' end,
    case when workflow.resolved_at is null and package.status in ('failed','retryable_failed','review_required','new_evidence_required')
      then coalesce(package.failure_code, 'PACKAGE_' || upper(package.status)) end,
    case when workflow.resolved_at is null and response.status in ('retryable_failed','terminal_failed','unsupported')
      then coalesce(response.failure_code, 'RESPONSE_' || upper(response.status)) end,
    case when workflow.resolved_at is null and (package.status='waiting_human_review' or exists (
      select 1 from public.total_loss_release_reviews review
      left join public.total_loss_report_versions version on version.id = review.report_version_id
      where review.case_id = operation.case_id and review.status in ('queued','in_review')
        and (review.report_version_id = workflow.current_report_version_id
          or version.package_job_id = workflow.current_package_job_id)
    )) then 'REPORT_REVIEW_HOLD' end,
    case when exists (
      select 1 from public.commerce_refund_requests refund
      where refund.case_id = operation.case_id and refund.status in ('failed','canceled')
        and not exists (select 1 from public.commerce_refund_requests successor
          where successor.order_id = refund.order_id and successor.reason_code = refund.reason_code
            and successor.created_at > refund.created_at and successor.status not in ('failed','canceled'))
    ) then 'REFUND_FAILED' end,
    case when exists (select 1 from public.commerce_disputes dispute
      where dispute.case_id = operation.case_id and dispute.status = 'active') then 'ACTIVE_PAYMENT_DISPUTE' end
  ]::text[], null) as attention_reasons
from public.total_loss_case_operations_internal operation
left join public.total_loss_claim_workflows workflow on workflow.case_id = operation.case_id
left join public.total_loss_package_jobs package on package.id = workflow.current_package_job_id
left join public.total_loss_insurer_response_analysis_jobs response on response.id = workflow.current_response_analysis_job_id
left join lateral (
  select max(changed.updated_at) as updated_at from (
    select updated_at from public.commerce_orders where case_id = operation.case_id
    union all select updated_at from public.commerce_refund_requests where case_id = operation.case_id
    union all select updated_at from public.commerce_disputes where case_id = operation.case_id
  ) changed
) finance on true
left join lateral (select max(created_at) as created_at from public.total_loss_workflow_events
  where case_id = operation.case_id) event on true
where operation.service_type = 'total_loss'
  and operation.intake_completed_at is not null;

alter function public.staff_admin_rows_internal(text,boolean,text)
  rename to staff_admin_rows_before_customer_scope_internal;
revoke all on function public.staff_admin_rows_before_customer_scope_internal(text,boolean,text)
  from public, anon, authenticated, service_role;

create function public.staff_admin_rows_internal(
  requested_resource text, include_details boolean default true, requested_record_id text default null
)
returns table (
  id text, case_id uuid, customer_id uuid, status text, kind text, identity text,
  verified boolean, has_cases boolean, attention boolean, active boolean,
  search_text text, created_at timestamptz, updated_at timestamptz, payload jsonb
) language plpgsql stable security definer set search_path = '' as $$
begin
  if requested_resource = 'customers' then
    return query
    select u.id::text, null::uuid, u.id,
      case when u.email_confirmed_at is not null then 'verified' else 'unverified' end,
      case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
      case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
      u.email_confirmed_at is not null, true, false, false,
      concat_ws(' ',u.id,case when p.full_name_confirmed_at is not null then p.display_name end,u.email),
      u.created_at, greatest(u.updated_at,p.updated_at,cases.updated_at,u.created_at),
      public.staff_admin_row(u.id::text,null,u.id,
        coalesce(case when p.full_name_confirmed_at is not null then nullif(btrim(p.display_name),'') end,u.email,'Guest identity'),
        u.email, cases.case_count::text || ' total-loss cases',
        case when u.email_confirmed_at is not null then 'verified' else 'unverified' end,
        case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
        u.email_confirmed_at is not null,cases.case_count,'{}',u.created_at,greatest(u.updated_at,p.updated_at,cases.updated_at,u.created_at),
        public.staff_admin_facts('Confirmed name',case when p.full_name_confirmed_at is not null then p.display_name end,
          'Name confirmed at',p.full_name_confirmed_at::text,'Account email',u.email,
          'Email verified at',u.email_confirmed_at::text,'Follow-up allowed',p.operational_follow_up_allowed::text,
          'Follow-up preference recorded',p.operational_follow_up_updated_at::text,'Total-loss cases',cases.case_count::text),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Account ID',u.id::text,'Account created',u.created_at::text,'Profile updated',p.updated_at::text))))
    from auth.users u
    left join public.profiles p on p.id=u.id
    cross join lateral (
      select count(*)::integer case_count, max(c.activity_at) updated_at
      from public.staff_admin_case_index_internal c
      where c.owner_user_id=u.id
    ) cases
    where cases.case_count > 0
      and not exists(select 1 from public.staff_members staff where staff.user_id=u.id)
      and not exists(select 1 from public.referral_partners partner
        where partner.user_id=u.id or lower(partner.contact_email)=lower(u.email))
      and (requested_record_id is null or u.id::text=requested_record_id);
  elsif requested_resource = 'incomplete_intakes' then
    return query
    select operation.case_id::text, operation.case_id, operation.owner_user_id,
      case when operation.canonical_report_available then 'report_saved' else 'uploading' end,
      'incomplete_intake'::text,
      case when operation.owner_is_anonymous then 'guest' else 'account' end,
      operation.verified_email is not null, false, false, false,
      concat_ws(' ',operation.case_id,operation.owner_user_id,operation.report_original_filename,
        operation.verified_email,operation.contact_email),
      operation.case_created_at, greatest(operation.last_activity_at,operation.details_updated_at,operation.report_uploaded_at),
      public.staff_admin_row(operation.case_id::text,operation.case_id,operation.owner_user_id,
        coalesce(operation.report_original_filename,'Valuation report upload'),
        coalesce(operation.verified_email,operation.contact_email,'No contact details submitted'),
        'Saved valuation report before contact details were submitted.',
        case when operation.canonical_report_available then 'report_saved' else 'uploading' end,
        'incomplete_intake',case when operation.owner_is_anonymous then 'guest' else 'account' end,
        operation.verified_email is not null,null,'{}',operation.case_created_at,
        greatest(operation.last_activity_at,operation.details_updated_at,operation.report_uploaded_at),
        public.staff_admin_facts('Report filename',operation.report_original_filename,
          'Uploaded at',operation.report_uploaded_at::text,'Upload status',operation.report_extraction_status,
          'Contact details submitted','false','Email',coalesce(operation.verified_email,operation.contact_email)),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Case ID',operation.case_id::text,'Account ID',operation.owner_user_id::text,
          'Storage object',operation.report_storage_object_path))))
    from public.total_loss_case_operations_internal operation
    where operation.service_type='total_loss'
      and operation.intake_completed_at is null
      and (operation.report_original_filename is not null or operation.report_storage_object_path is not null
        or operation.report_last_upload_id is not null)
      and (requested_record_id is null or operation.case_id::text=requested_record_id);
  else
    return query
      select * from public.staff_admin_rows_before_customer_scope_internal(requested_resource,include_details,requested_record_id);
  end if;
end;
$$;

create or replace function public.staff_admin_list(
  resource text, search text default '', filters jsonb default '{}', sort text default 'updated',
  page integer default 1, page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; filter_key text; filter_value jsonb;
begin
  perform public.staff_admin_require_access();
  if resource is null or resource not in ('cases','customers','reports','processing','payments','activity','incomplete_intakes')
    or search is null or char_length(search)>200 or sort is null or sort not in ('updated','created')
    or page is null or page<1 or page>1000000 or page_size is null or page_size<1 or page_size>100
    or filters is null or jsonb_typeof(filters)<>'object' or pg_column_size(filters)>4096 then
    raise exception using errcode='22023',message='Invalid staff list arguments.';
  end if;
  for filter_key,filter_value in select key,value from jsonb_each(filters) loop
    if filter_key not in ('caseId','customerId','status','kind','identity','verified','hasCases','attention','active')
      or jsonb_typeof(filter_value)<>'string' then
      raise exception using errcode='22023',message='Invalid staff list filter.';
    end if;
    if (filter_key in ('verified','hasCases','attention','active') and filters->>filter_key not in ('true','false'))
      or (filter_key='identity' and filters->>filter_key not in ('account','guest'))
      or (filter_key in ('status','kind') and filters->>filter_key !~ '^[A-Za-z0-9_.-]{1,100}$') then
      raise exception using errcode='22023',message='Invalid staff list filter value.';
    end if;
    if filter_key in ('caseId','customerId') then
      begin perform (filters->>filter_key)::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='22023',message='Invalid staff identity filter.';
      end;
    end if;
  end loop;
  with matching as materialized (
    select row.* from public.staff_admin_rows_internal(resource,false) row
    where (search='' or strpos(lower(row.search_text),lower(btrim(search)))>0)
      and (not filters?'caseId' or row.case_id=(filters->>'caseId')::uuid)
      and (not filters?'customerId' or row.customer_id=(filters->>'customerId')::uuid)
      and (not filters?'status' or row.status=filters->>'status')
      and (not filters?'kind' or row.kind=filters->>'kind')
      and (case when resource='customers' then row.identity=coalesce(filters->>'identity','account')
        else not filters?'identity' or row.identity=filters->>'identity' end)
      and (not filters?'verified' or row.verified=(filters->>'verified')::boolean)
      and (not filters?'hasCases' or row.has_cases=(filters->>'hasCases')::boolean)
      and (not filters?'attention' or row.attention=(filters->>'attention')::boolean)
      and (not filters?'active' or row.active=(filters->>'active')::boolean)
  ), selected as (
    select row.* from matching row order by
      case when sort='created' then row.created_at else row.updated_at end desc,row.id desc
    limit page_size offset ((page::bigint-1)*page_size)
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_set(selected.payload,'{sections}','[]') order by
      case when sort='created' then selected.created_at else selected.updated_at end desc,selected.id desc) from selected),'[]'),
    'total',(select count(*) from matching),'page',page,'pageSize',page_size,'asOf',statement_timestamp()) into result;
  return result;
end;
$$;

create or replace function public.staff_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return jsonb_build_object('asOf',statement_timestamp(),
    'activeCases',(select count(*) from public.staff_admin_case_index_internal where is_active),
    'attentionCases',(select count(*) from public.staff_admin_case_index_internal where cardinality(attention_reasons)>0),
    'processingJobs',(select count(*) from public.staff_admin_rows_internal('processing',false) where active),
    'registeredAccounts',(select count(*) from public.staff_admin_rows_internal('customers',false) where identity='account'),
    'attention',public.staff_admin_list('cases','',jsonb_build_object('attention','true'),'updated',1,5)->'items',
    'activity',public.staff_admin_list('activity','','{}','updated',1,8)->'items');
end;
$$;

create or replace function public.staff_admin_customer(requested_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return (select payload from public.staff_admin_rows_internal('customers',true,requested_user_id::text) where customer_id=requested_user_id);
end;
$$;

create or replace function public.staff_admin_case(requested_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return (select payload from public.staff_admin_rows_internal('cases',true,requested_case_id::text) where case_id=requested_case_id);
end;
$$;

create or replace function public.staff_admin_record(resource text, requested_record_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  if resource is null or resource not in ('reports','processing','payments','activity','incomplete_intakes')
    or requested_record_id is null or char_length(requested_record_id)>512
    or btrim(requested_record_id)='' then
    raise exception using errcode='22023',message='Invalid staff record arguments.';
  end if;
  return (select payload from public.staff_admin_rows_internal(resource,true,requested_record_id)
    where id=requested_record_id);
end;
$$;

create function public.staff_total_loss_source_report_locator(requested_case_id uuid)
returns table (filename text, object_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return query
  select operation.report_original_filename, operation.report_storage_object_path
  from public.total_loss_case_operations_internal operation
  where operation.case_id=requested_case_id
    and operation.service_type='total_loss'
    and operation.report_original_filename is not null
    and operation.report_storage_object_path is not null
    and exists(select 1 from storage.objects object
      where object.bucket_id='case-files' and object.name=operation.report_storage_object_path);
end;
$$;

drop policy if exists "Staff can read private case files" on storage.objects;
create policy "Staff can read private case files"
on storage.objects for select to authenticated
using (bucket_id='case-files' and (select public.is_venfour_staff()));

revoke all on function public.staff_admin_rows_internal(text,boolean,text),
  public.staff_total_loss_source_report_locator(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_admin_list(text,text,jsonb,text,integer,integer),
  public.staff_admin_overview(), public.staff_admin_customer(uuid), public.staff_admin_case(uuid),
  public.staff_admin_record(text,text), public.staff_total_loss_source_report_locator(uuid)
  to authenticated;

comment on function public.staff_total_loss_source_report_locator(uuid) is
  'Staff-authorized locator for a private uploaded valuation PDF. Browser storage access remains short-lived and subject to staff-only storage RLS.';

-- A saved valuation report is product evidence, even when its anonymous owner
-- never submits contact details. Keep that owner and its private source file
-- out of the abandoned-guest deletion queue.
create or replace function public.is_abandoned_anonymous_guest_eligible(
  candidate_user_id uuid,
  observed_at timestamptz default statement_timestamp()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users auth_user
    join public.profiles profile on profile.id=auth_user.id
    where auth_user.id=candidate_user_id
      and auth_user.is_anonymous is true
      and not public.anonymous_guest_has_protected_referral(auth_user.id)
      and not exists (
        select 1 from public.total_loss_case_details details
        join public.appraisal_cases appraisal_case on appraisal_case.id=details.case_id
        join storage.objects stored_object on stored_object.bucket_id='case-files'
          and stored_object.name=details.report_storage_owner_id::text || '/' || details.case_id::text || '/valuation-report.pdf'
        where appraisal_case.user_id=auth_user.id
          and details.report_storage_owner_id=auth_user.id
          and details.report_last_upload_id is not null
      )
      and auth_user.deleted_at is null
      and auth_user.created_at <= observed_at - interval '30 days'
      and coalesce(auth_user.updated_at,auth_user.created_at) <= observed_at - interval '30 days'
      and coalesce(auth_user.last_sign_in_at,auth_user.created_at) <= observed_at - interval '30 days'
      and profile.created_at <= observed_at - interval '30 days'
      and profile.updated_at <= observed_at - interval '30 days'
      and not exists (select 1 from auth.identities identity where identity.user_id=auth_user.id and identity.provider<>'anonymous')
      and not exists (select 1 from public.staff_members staff_member where staff_member.user_id=auth_user.id)
      and not exists (
        select 1 from public.appraisal_cases appraisal_case where appraisal_case.user_id=auth_user.id
          and (appraisal_case.service_type<>'total_loss' or appraisal_case.status<>'draft'
            or appraisal_case.created_at>observed_at-interval '30 days'
            or appraisal_case.updated_at>observed_at-interval '30 days'
            or appraisal_case.last_activity_at>observed_at-interval '30 days')
      )
      and not exists (
        select 1 from public.total_loss_case_details details
        join public.appraisal_cases appraisal_case on appraisal_case.id=details.case_id
        where appraisal_case.user_id=auth_user.id and (
          details.report_storage_owner_id<>auth_user.id or details.intake_completed_at is not null
          or details.report_extraction_status='pending'
          or (details.report_upload_id is not null and details.report_upload_expires_at>observed_at)
          or details.created_at>observed_at-interval '30 days' or details.updated_at>observed_at-interval '30 days')
      )
      and not exists (
        select 1 from public.total_loss_case_details details
        join public.appraisal_cases appraisal_case on appraisal_case.id=details.case_id
        where details.report_storage_owner_id=auth_user.id and appraisal_case.user_id<>auth_user.id
      )
      and not exists (
        select 1 from storage.objects stored_object where stored_object.bucket_id='case-files'
          and stored_object.name like auth_user.id::text || '/%'
          and (stored_object.created_at>observed_at-interval '30 days' or stored_object.updated_at>observed_at-interval '30 days')
      )
      and not exists (
        select 1 from public.total_loss_case_contacts contact
        join public.appraisal_cases appraisal_case on appraisal_case.id=contact.case_id
        where appraisal_case.user_id=auth_user.id and (
          contact.email_verified_at is not null or contact.created_at>observed_at-interval '30 days'
          or contact.updated_at>observed_at-interval '30 days')
      )
      and not exists (
        select 1 from public.total_loss_case_identity_claims identity_claim
        join public.appraisal_cases appraisal_case on appraisal_case.id=identity_claim.case_id
        where (identity_claim.source_user_id=auth_user.id or appraisal_case.user_id=auth_user.id)
          and (identity_claim.claimed_at is not null or (identity_claim.claimed_at is null
            and identity_claim.revoked_at is null and identity_claim.expires_at>observed_at))
      )
      and not exists (select 1 from public.total_loss_analysis_jobs analysis_job
        join public.appraisal_cases appraisal_case on appraisal_case.id=analysis_job.case_id where appraisal_case.user_id=auth_user.id)
      and not exists (select 1 from public.analysis_runs analysis_run
        join public.appraisal_cases appraisal_case on appraisal_case.id=analysis_run.case_id where appraisal_case.user_id=auth_user.id)
  );
$$;

create or replace function public.staff_list_case_operations()
returns table (
  case_id uuid, owner_user_id uuid, customer_full_name text, verified_email text,
  owner_is_anonymous boolean, contact_full_name text, contact_email text,
  contact_email_verified boolean, identity_claimed_at timestamptz,
  service_type public.appraisal_service_type, case_status public.appraisal_case_status,
  case_stage public.case_operation_stage, needs_attention boolean,
  case_created_at timestamptz, case_updated_at timestamptz, last_activity_at timestamptz,
  report_uploaded_at timestamptz, analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer, analysis_retryable boolean, analysis_failure_code text,
  analysis_processing_expires_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select operation.case_id,operation.owner_user_id,operation.customer_full_name,operation.verified_email,
    operation.owner_is_anonymous,operation.contact_full_name,operation.contact_email,
    operation.contact_email_verified,operation.identity_claimed_at,operation.service_type,
    operation.case_status,operation.case_stage,
    operation.case_stage in ('analysis_failed'::public.case_operation_stage,'needs_attention'::public.case_operation_stage)
      or (operation.report_upload_id is not null and operation.report_upload_expires_at<=statement_timestamp())
      or (operation.intake_mode='report' and operation.report_last_upload_id is not null
        and operation.report_upload_id is null and not operation.canonical_report_available),
    operation.case_created_at,operation.case_updated_at,operation.last_activity_at,operation.report_uploaded_at,
    operation.analysis_status,operation.analysis_attempt_count,operation.analysis_retryable,
    operation.analysis_failure_code,operation.analysis_processing_expires_at
  from public.total_loss_case_operations_internal operation
  where (select public.is_venfour_staff()) and operation.intake_completed_at is not null
  union all
  select appraisal_case.id,appraisal_case.user_id,
    coalesce(case when profile.full_name_confirmed_at is not null then profile.display_name else null end,
      nullif(btrim(details.full_name),'')),
    case when auth_user.email_confirmed_at is not null then auth_user.email else null end,
    coalesce(auth_user.is_anonymous,false),null::text,null::text,false,null::timestamptz,
    appraisal_case.service_type,appraisal_case.status,'submitted'::public.case_operation_stage,false,
    appraisal_case.created_at,appraisal_case.updated_at,appraisal_case.last_activity_at,null::timestamptz,
    null::public.total_loss_analysis_status,null::integer,null::boolean,null::text,null::timestamptz
  from public.appraisal_cases appraisal_case
  join public.diminished_value_case_details details on details.case_id=appraisal_case.id and details.submitted_at is not null
  join auth.users auth_user on auth_user.id=appraisal_case.user_id
  left join public.profiles profile on profile.id=appraisal_case.user_id
  where (select public.is_venfour_staff()) and appraisal_case.service_type='diminished_value'
    and appraisal_case.status='submitted'
  order by last_activity_at desc,case_id desc;
$$;

revoke execute on function public.is_abandoned_anonymous_guest_eligible(uuid,timestamptz),
  public.staff_list_case_operations() from public, anon, authenticated, service_role;
grant execute on function public.staff_list_case_operations() to authenticated;
