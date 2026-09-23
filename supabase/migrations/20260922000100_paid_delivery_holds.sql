-- Dormant recovery contract: application roles cannot enroll cases or publish authority.
create table public.jurisdiction_delivery_authority (
  revision bigint primary key check(revision>0),
  registry_digest text not null check(registry_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create table public.jurisdiction_delivery_operators (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create table public.jurisdiction_delivery_cases (
  case_id uuid primary key references public.appraisal_cases(id),
  order_id uuid not null references public.commerce_orders(id),
  state text not null default 'held' check(state in ('held','released','cancelled')),
  snapshot_id uuid references public.jurisdiction_decision_snapshots(id),
  authority_revision bigint references public.jurisdiction_delivery_authority(revision),
  reasons text[] not null default array['MISSING_CURRENT_APPROVAL'],
  capabilities text[] not null default array['market_evidence_report','personalized_valuation','customer_reconsideration_draft','insurer_response_coaching'],
  valid_until timestamptz,
  refund_request_key uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(state<>'released' or (snapshot_id is not null and authority_revision is not null and valid_until is not null)),
  check((state='cancelled')=(refund_request_key is not null))
);
create table public.jurisdiction_delivery_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.jurisdiction_delivery_cases(case_id),
  action text not null check(action in ('held','release','cancel_refund','release_refused')),
  request_id uuid unique,
  resolver_id uuid references auth.users(id),
  snapshot_id uuid references public.jurisdiction_decision_snapshots(id),
  reasons text[] not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
do $$ declare t text; begin
  foreach t in array array['jurisdiction_delivery_authority','jurisdiction_delivery_operators','jurisdiction_delivery_cases','jurisdiction_delivery_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create trigger jurisdiction_delivery_events_immutable before update or delete on public.jurisdiction_delivery_events
  for each row execute function public.prevent_jurisdiction_history_update();
create trigger jurisdiction_delivery_authority_immutable before update or delete on public.jurisdiction_delivery_authority
  for each row execute function public.prevent_jurisdiction_history_update();

create function public.jurisdiction_delivery_lock_internal(requested_case_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  if exists(select 1 from public.jurisdiction_delivery_cases where case_id=requested_case_id) then
    perform pg_catalog.pg_advisory_xact_lock(726104,1);
  end if;
end $$;
create function public.jurisdiction_delivery_hold_internal(requested_case_id uuid, requested_reasons text[])
returns void language plpgsql security definer set search_path='' as $$
declare c public.jurisdiction_delivery_cases;
begin
  perform public.jurisdiction_delivery_lock_internal(requested_case_id);
  select * into c from public.jurisdiction_delivery_cases where case_id=requested_case_id for update;
  if c.case_id is null or c.state='cancelled' then return; end if;
  if c.state='held' and c.reasons=requested_reasons then return; end if;
  update public.jurisdiction_delivery_cases set state='held',reasons=requested_reasons,
    updated_at=clock_timestamp() where case_id=c.case_id;
  insert into public.jurisdiction_delivery_events(case_id,action,snapshot_id,reasons,result)
    values(c.case_id,'held',c.snapshot_id,requested_reasons,jsonb_build_object('state','held'));
end $$;

create function public.jurisdiction_delivery_enrollment_internal()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  -- A server-start setting, not an application env value or request parameter.
  if current_setting('cluster_name')<>'venfour-delivery-rehearsal' then
    raise exception using errcode='42501',message='Delivery enrollment is restricted to isolated rehearsals.';
  end if;
  if new.state<>'held' or not exists(select 1 from public.commerce_orders o
    where o.id=new.order_id and o.case_id=new.case_id and o.provider_livemode=false) then
    raise exception using errcode='22023',message='A matching sandbox order is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(726104,1);
  return new;
end $$;
create trigger jurisdiction_delivery_enrollment before insert on public.jurisdiction_delivery_cases
  for each row execute function public.jurisdiction_delivery_enrollment_internal();
create function public.jurisdiction_delivery_enrolled_internal() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into public.jurisdiction_delivery_events(case_id,action,reasons,result)
    values(new.case_id,'held',new.reasons,jsonb_build_object('state','held'));
  return new;
end $$;
create trigger jurisdiction_delivery_enrolled after insert on public.jurisdiction_delivery_cases
  for each row execute function public.jurisdiction_delivery_enrolled_internal();

create function public.jurisdiction_delivery_authority_changed_internal() returns trigger
language plpgsql security definer set search_path='' as $$ declare c record; begin
  perform pg_catalog.pg_advisory_xact_lock(726104,1);
  if new.revision<>coalesce((select max(revision) from public.jurisdiction_delivery_authority),0)+1 then
    raise exception using errcode='40001',message='Authority revision changed.';
  end if;
  for c in select case_id from public.jurisdiction_delivery_cases where state='released' loop
    perform public.jurisdiction_delivery_hold_internal(c.case_id,array['REGISTRY_CHANGED']);
  end loop;
  return new;
end $$;
create trigger jurisdiction_delivery_authority_changed before insert on public.jurisdiction_delivery_authority
  for each row execute function public.jurisdiction_delivery_authority_changed_internal();
create function public.jurisdiction_delivery_facts_changed_internal() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if tg_op='UPDATE' then
    if new.date_of_loss is not distinct from old.date_of_loss then return new; end if;
  end if;
  perform public.jurisdiction_delivery_hold_internal(new.case_id,array['FACTS_CHANGED']);
  return new;
end $$;
create trigger jurisdiction_delivery_facts_changed after insert on public.case_jurisdiction_fact_versions
  for each row execute function public.jurisdiction_delivery_facts_changed_internal();
create trigger jurisdiction_delivery_intake_changed after update on public.total_loss_case_details
  for each row execute function public.jurisdiction_delivery_facts_changed_internal();

create function public.jurisdiction_delivery_is_open_internal(requested_case_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.jurisdiction_delivery_cases c where c.case_id=requested_case_id
    and (c.state<>'released' or c.valid_until<=statement_timestamp()
      or c.authority_revision is distinct from (select max(revision) from public.jurisdiction_delivery_authority)
      or (select s.snapshot->'delivery_context' from public.jurisdiction_decision_snapshots s where s.id=c.snapshot_id)
        is distinct from public.get_jurisdiction_context(c.case_id)));
$$;
create function public.check_paid_delivery(requested_reference_id uuid, requested_kind text default 'case', requested_user_id uuid default null)
returns text language plpgsql security definer set search_path='' as $$
declare target uuid; c public.jurisdiction_delivery_cases;
begin
  if requested_kind='work_item' and exists(select 1 from public.workflow_work_items w join public.total_loss_package_jobs p on p.id=w.package_job_id where w.id=requested_reference_id and w.work_type='total_loss_report_review' and w.status='completed' and p.status='refund_pending') then return 'financial_recovery'; end if;
  target:=case when requested_kind='case' then requested_reference_id
    else public.get_jurisdiction_reference_case(requested_reference_id,requested_kind) end;
  if requested_user_id is not null and not exists(select 1 from public.appraisal_cases where id=target and user_id=requested_user_id) then
    raise exception using errcode='42501',message='Case access required.';
  end if;
  perform public.jurisdiction_delivery_lock_internal(target);
  select * into c from public.jurisdiction_delivery_cases where case_id=target for update;
  if not found then return 'unenrolled'; end if;
  if c.state='released' and not public.jurisdiction_delivery_is_open_internal(target) then
    perform public.jurisdiction_delivery_hold_internal(target,array['STALE_DELIVERY_APPROVAL']);
    return 'held';
  end if;
  return c.state;
end $$;
create function public.jurisdiction_delivery_assert_internal(requested_case_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform public.jurisdiction_delivery_lock_internal(requested_case_id);
  if not public.jurisdiction_delivery_is_open_internal(requested_case_id) then
    raise exception using errcode='PJD01',message='New paid delivery is held.';
  end if;
end $$;

-- Preserve financial enqueue and original work status. Separate holds suppress dispatch;
-- duplicate deliveries acknowledge the hold without consuming execution attempts.
do $$ declare definition text; needle text; begin
  definition:=pg_get_functiondef('public.reserve_due_workflow_work_items(uuid,integer)'::regprocedure);
  needle:='where (p.processing_expires_at';
  if position(needle in definition)=0 then raise exception 'Unexpected dispatch contract'; end if;
  execute replace(definition,needle,'where public.jurisdiction_delivery_is_open_internal(i.case_id) and (p.processing_expires_at');
  definition:=pg_get_functiondef('public.list_due_total_loss_insurer_response_analysis_jobs(integer)'::regprocedure);
  needle:='where job.status = ''pending''';
  if position(needle in definition)=0 then raise exception 'Unexpected coaching queue contract'; end if;
  definition:=replace(definition,needle,'where public.jurisdiction_delivery_is_open_internal(job.case_id) and (job.status = ''pending''');
  definition:=replace(definition,E'  order by',E'  )\n  order by');
  execute definition;
end $$;

-- Entry fences precede the existing row-lock order. Artifact triggers below also
-- cover service-role writes and functions which bypass these entry points.
do $$ declare item record; definition text; begin
  for item in select * from (values
    ('claim_total_loss_package_work_item(uuid,uuid)','(select fence_work.case_id from public.workflow_work_items fence_work where fence_work.id=requested_work_item_id)'),
    ('claim_total_loss_report_generation_work_item(uuid,uuid)','(select fence_work.case_id from public.workflow_work_items fence_work where fence_work.id=requested_work_item_id)'),
    ('claim_total_loss_report_review_work_item(uuid,uuid)','(select fence_work.case_id from public.workflow_work_items fence_work where fence_work.id=requested_work_item_id)'),
    ('claim_current_total_loss_insurer_response_analysis(uuid,uuid,text,text,text,text,text)','requested_case_id'),
    ('prepare_total_loss_customer_message(uuid,uuid,bigint)','requested_case_id'),
    ('store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb)','requested_case_id'),
    ('prepare_total_loss_customer_follow_up(uuid,uuid,uuid,bigint,bigint)','requested_case_id'),
    ('resolve_total_loss_report_release(uuid,uuid,uuid)','(select fence_work.case_id from public.workflow_work_items fence_work where fence_work.id=requested_work_item_id)')
  ) as entries(signature,expression) loop
    definition:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
    if position(E'begin\n' in definition)=0 then raise exception 'Unexpected delivery RPC contract: %',item.signature; end if;
    if item.signature='claim_total_loss_report_review_work_item(uuid,uuid)' then
      definition:=regexp_replace(definition,E'begin\n','begin'||E'\n  if not exists(select 1 from public.workflow_work_items w join public.total_loss_package_jobs p on p.id=w.package_job_id where w.id=requested_work_item_id and w.status=''completed'' and p.status=''refund_pending'') then perform public.jurisdiction_delivery_assert_internal('||item.expression||'); end if;'||E'\n');
    else
    definition:=regexp_replace(definition,E'begin\n','begin'||E'\n  perform public.jurisdiction_delivery_assert_internal('||item.expression||');'||E'\n');
    end if;
    execute definition;
  end loop;
end $$;
create function public.jurisdiction_delivery_artifact_fence_internal() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  perform public.jurisdiction_delivery_assert_internal(new.case_id);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['total_loss_source_snapshots','total_loss_final_assessments',
    'total_loss_report_versions','total_loss_message_drafts','total_loss_message_versions',
    'total_loss_insurer_response_analysis_results','total_loss_insurer_response_analysis_runs','total_loss_recommendations','total_loss_follow_up_sources'] loop
    execute format('create trigger jurisdiction_new_artifact before insert on public.%I for each row execute function public.jurisdiction_delivery_artifact_fence_internal()',t);
  end loop;
end $$;
create trigger jurisdiction_report_publication before update of status on public.total_loss_report_versions
  for each row when(new.status='published' and old.status is distinct from new.status)
  execute function public.jurisdiction_delivery_artifact_fence_internal();

create trigger jurisdiction_report_content before update of report on public.total_loss_report_versions
  for each row when(new.report is distinct from old.report)
  execute function public.jurisdiction_delivery_artifact_fence_internal();
create trigger jurisdiction_coaching_publication before update of status on public.total_loss_recommendations
  for each row when(new.status='published' and old.status is distinct from new.status)
  execute function public.jurisdiction_delivery_artifact_fence_internal();
create trigger jurisdiction_work_claim before update of status,processing_token on public.workflow_work_items
  for each row when(new.status='processing')
  execute function public.jurisdiction_delivery_artifact_fence_internal();
create trigger jurisdiction_work_insert before insert on public.workflow_work_items
  for each row when(new.status='processing')
  execute function public.jurisdiction_delivery_artifact_fence_internal();
create trigger jurisdiction_coaching_claim before update of status on public.total_loss_insurer_response_analysis_jobs
  for each row when(new.status='processing')
  execute function public.jurisdiction_delivery_artifact_fence_internal();

create function public.jurisdiction_delivery_require_operator_internal(requested_user_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$ begin
  if not exists(select 1 from public.jurisdiction_delivery_operators o
    join public.staff_members s on s.user_id=o.user_id join auth.users u on u.id=o.user_id
    where o.user_id=requested_user_id and not coalesce(u.is_anonymous,false)) then
    raise exception using errcode='42501',message='Delivery recovery authority required.';
  end if;
end $$;
create function public.inspect_paid_delivery(requested_case_id uuid default null, requested_after_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; result jsonb;
begin
  perform public.jurisdiction_delivery_require_operator_internal((select auth.uid()));
  for candidate in select case_id from public.jurisdiction_delivery_cases
    where (requested_case_id is null or case_id=requested_case_id)
      and (requested_after_case_id is null or case_id>requested_after_case_id) order by case_id limit 100 loop
    perform public.check_paid_delivery(candidate.case_id);
  end loop;
  select coalesce(jsonb_agg(row),'[]') into result from (
    select to_jsonb(c)||jsonb_build_object('order_status',o.status,'payment_transaction_id',p.id,
      'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount_minor_units',p.amount_minor_units,'kind',p.transaction_kind,'recorded_at',p.recorded_at)),'[]') from public.payment_transactions p where p.order_id=c.order_id),
      'refund_requests',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'client_request_id',r.client_request_id,'payment_transaction_id',r.payment_transaction_id)),'[]') from public.commerce_refund_requests r where r.order_id=c.order_id),
      'work_items',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'type',w.work_type,'status',w.status)),'[]')
        from public.workflow_work_items w where w.case_id=c.case_id),
      'history',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.jurisdiction_delivery_events e where e.case_id=c.case_id),
      'available_actions',case c.state when 'held' then '["release","cancel_refund"]'::jsonb
        when 'cancelled' then '["cancel_refund"]'::jsonb else '[]'::jsonb end) as row
    from public.jurisdiction_delivery_cases c join public.commerce_orders o on o.id=c.order_id
    left join lateral (select id from public.payment_transactions where order_id=c.order_id and transaction_kind='payment' order by recorded_at,id limit 1) p on true
    where (requested_case_id is null or c.case_id=requested_case_id)
      and (requested_after_case_id is null or c.case_id>requested_after_case_id) order by c.case_id limit 100
  ) q;
  return result;
end $$;

create function public.get_paid_delivery_review_context(requested_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  perform public.jurisdiction_delivery_lock_internal(requested_case_id);
  return jsonb_build_object('context',public.get_jurisdiction_context(requested_case_id),
    'authority_revision',(select max(revision) from public.jurisdiction_delivery_authority));
end $$;

create function public.resolve_paid_delivery(requested_case_id uuid,requested_operator_id uuid,
  requested_action text,requested_request_id uuid,requested_snapshot_id uuid default null,requested_valid_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.jurisdiction_delivery_cases; s public.jurisdiction_decision_snapshots;
  a public.jurisdiction_delivery_authority; prior public.jurisdiction_delivery_events;
  payment_id uuid; result jsonb; reason text[]; reservation record;
begin
  perform public.jurisdiction_delivery_require_operator_internal(requested_operator_id);
  if requested_action not in ('release','cancel_refund') or requested_action is null or requested_request_id is null then
    raise exception using errcode='22023',message='Invalid recovery action.';
  end if;
  perform public.jurisdiction_delivery_lock_internal(requested_case_id);
  select * into strict c from public.jurisdiction_delivery_cases where case_id=requested_case_id for update;
  select * into prior from public.jurisdiction_delivery_events where request_id=requested_request_id;
  if found then
    if prior.case_id<>c.case_id or prior.resolver_id<>requested_operator_id
       or prior.action not in (requested_action,case when requested_action='release' then 'release_refused' else requested_action end) then
      raise exception using errcode='22023',message='Recovery request identity conflict.';
    end if;
    return prior.result;
  end if;
  if requested_action='release' then
    select * into s from public.jurisdiction_decision_snapshots where id=requested_snapshot_id;
    select * into a from public.jurisdiction_delivery_authority order by revision desc limit 1;
    reason:=array['CURRENT_APPROVAL_REQUIRED'];
    if c.state='cancelled' then reason:=array['FULFILLMENT_CANCELLED'];
    elsif c.state='released' then return jsonb_build_object('state','released','case_id',c.case_id);
    elsif s.case_id=c.case_id and s.snapshot->>'boundary'='checkout'
      and s.snapshot->'proposed_allowed'='true'::jsonb
      and s.snapshot->>'registry_digest'=a.registry_digest
      and s.snapshot->>'delivery_authority_revision'=a.revision::text
      and s.snapshot->'delivery_context'=public.get_jurisdiction_context(c.case_id)
      and (s.snapshot->>'evaluated_at')::timestamptz between clock_timestamp()-interval '30 seconds' and clock_timestamp()
      and s.recorded_at>=c.updated_at
      and requested_valid_until>clock_timestamp() and requested_valid_until<=clock_timestamp()+interval '5 minutes'
      and jsonb_array_length(s.snapshot->'decisions')=4
      and not exists(select 1 from unnest(c.capabilities) cap where not exists(
        select 1 from jsonb_array_elements(s.snapshot->'decisions') d where d->>'capability'=cap
          and d->'proposed_allowed'='true'::jsonb and d->'reasons'='[]'::jsonb
          and jsonb_array_length(d->'rule_versions')>0)) then
      update public.jurisdiction_delivery_cases set state='released',snapshot_id=s.id,
        authority_revision=a.revision,valid_until=requested_valid_until,reasons='{}',updated_at=clock_timestamp() where case_id=c.case_id;
      result:=jsonb_build_object('state','released','case_id',c.case_id); reason:='{}';
    end if;
    if result is null then
      if c.state='held' and s.case_id=c.case_id then
        update public.jurisdiction_delivery_cases set snapshot_id=s.id where case_id=c.case_id;
      end if;
      result:=jsonb_build_object('state',c.state,'case_id',c.case_id,'reasons',reason);
    end if;
  else
    if c.state not in ('held','cancelled') then raise exception using errcode='55000',message='Only held work can be cancelled through recovery.'; end if;
    select id into payment_id from public.payment_transactions where order_id=c.order_id and case_id=c.case_id
      and transaction_kind='payment' order by recorded_at,id limit 1;
    if payment_id is null then raise exception using errcode='55000',message='Reconcile payment before refund recovery.'; end if;
    c.refund_request_key:=coalesce(c.refund_request_key,requested_request_id);
    if (select count(*) from public.payment_transactions where order_id=c.order_id and transaction_kind='payment')<>1
      or exists(select 1 from public.commerce_refund_requests r where r.order_id=c.order_id
        and r.client_request_id<>c.refund_request_key and r.status in ('creating','pending','succeeded')) then
      -- Financial ambiguity stays with the established support/refund tooling.
      -- Cancellation remains durable; no arbitrary charge is selected/refunded.
      payment_id:=null;
    else
      select * into reservation from public.reserve_total_loss_refund(c.case_id,c.order_id,payment_id,
        c.refund_request_key,'JURISDICTION_NONFULFILLMENT','retain');
    end if;
    update public.jurisdiction_delivery_cases set state='cancelled',refund_request_key=c.refund_request_key,
      reasons=array['FULFILLMENT_CANCELLED'],updated_at=clock_timestamp() where case_id=c.case_id;
    result:=jsonb_build_object('state','cancelled','case_id',c.case_id,'order_id',c.order_id,
      'payment_transaction_id',payment_id,'refund_request_key',c.refund_request_key,
      'refund_status',case when payment_id is null then 'support_required' else 'reserved' end);
    reason:=case when payment_id is null then array['FULFILLMENT_CANCELLED','REFUND_SUPPORT_REQUIRED'] else array['FULFILLMENT_CANCELLED'] end;
  end if;
  insert into public.jurisdiction_delivery_events(case_id,action,request_id,resolver_id,snapshot_id,reasons,result)
    values(c.case_id,case when requested_action='release' and cardinality(reason)>0 then 'release_refused' else requested_action end,
      requested_request_id,requested_operator_id,requested_snapshot_id,reason,result);
  return result;
end $$;

-- No enrollment/authority/operator grant is available to any application role.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and (proname like 'jurisdiction_delivery_%' or proname in ('get_paid_delivery_review_context','check_paid_delivery','inspect_paid_delivery','resolve_paid_delivery')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.get_paid_delivery_review_context(uuid) to service_role;
grant execute on function public.check_paid_delivery(uuid,text,uuid),public.resolve_paid_delivery(uuid,uuid,text,uuid,uuid,timestamptz) to service_role;
grant execute on function public.inspect_paid_delivery(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
