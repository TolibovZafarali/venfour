-- Durable delivery generations are distinct from work identity and execution attempts.
alter table public.workflow_work_items add column delivery_generation integer not null default 0
  check (delivery_generation between 0 and 5);

-- A dispatch outage can become terminal without pretending a worker executed.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.workflow_work_items'::regclass and conname='workflow_work_items_state_complete';
  if definition is null then raise exception 'Missing durable work state constraint'; end if;
  execute 'alter table public.workflow_work_items drop constraint workflow_work_items_state_complete';
  execute 'alter table public.workflow_work_items add constraint workflow_work_items_state_complete check (('
    || substring(definition from 7) || ') or (status=''terminal_failed'' and attempt_count=0'
    || ' and dispatch_token is null and dispatch_expires_at is null and processing_token is not null'
    || ' and processing_expires_at is null and last_error_code=''TASK_DELIVERY_EXHAUSTED'''
    || ' and retryable=false and completed_at is null and failed_at is not null))';
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.total_loss_package_jobs'::regclass and conname='total_loss_package_jobs_state_complete';
  if definition is null then raise exception 'Missing package state constraint'; end if;
  execute 'alter table public.total_loss_package_jobs drop constraint total_loss_package_jobs_state_complete';
  execute 'alter table public.total_loss_package_jobs add constraint total_loss_package_jobs_state_complete check (('
    || substring(definition from 7) || ') or (status=''failed'' and attempt_count=0'
    || ' and processing_token is not null and processing_expires_at is null'
    || ' and failure_code=''TASK_DELIVERY_EXHAUSTED'' and retryable=false'
    || ' and started_at is null and finished_at is not null))';
end;
$$;

create function public.hold_exhausted_workflow_work_internal(
  requested_work_item_id uuid, expected_work_type text, delivery_exhausted boolean default false)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  w public.workflow_work_items%rowtype;
  p public.total_loss_package_jobs%rowtype;
  r public.total_loss_report_versions%rowtype;
  failure text := case when delivery_exhausted then 'TASK_DELIVERY_EXHAUSTED' else 'WORK_ATTEMPTS_EXHAUSTED' end;
  fence uuid := gen_random_uuid();
begin
  select * into w from public.workflow_work_items where id=requested_work_item_id for update;
  if not found or w.work_type<>expected_work_type or w.work_version<>'1'
    or w.status in ('completed','terminal_failed')
    or (w.processing_expires_at > statement_timestamp())
    or (not delivery_exhausted and w.attempt_count<3)
    or (delivery_exhausted and w.delivery_generation<5) then return false; end if;
  select * into p from public.total_loss_package_jobs where id=w.package_job_id for update;
  if p.processing_expires_at > statement_timestamp() then return false; end if;
  -- Never let an obsolete work item change the current case workflow or a released package.
  perform 1 from public.total_loss_claim_workflows where case_id=w.case_id
    and current_package_job_id=p.id and phase='review' for update;
  if not found or p.status in ('ready','not_supportable','review_required','new_evidence_required','failed') then
    update public.workflow_work_items set status='terminal_failed',dispatch_token=null,dispatch_expires_at=null,
      processing_token=fence,processing_expires_at=null,retryable=false,last_error_code=failure,
      failed_at=statement_timestamp(),completed_at=null where id=w.id;
    return true;
  end if;
  select * into r from public.total_loss_report_versions where id=w.report_version_id for update;
  if r.id is not null and r.status not in ('published','superseded','failed') then
    insert into public.total_loss_release_reviews(case_id,report_version_id,final_assessment_id,status,due_at)
      values(w.case_id,r.id,r.final_assessment_id,'queued',statement_timestamp()+interval '2 days')
      on conflict do nothing;
    if r.report is not null then
      update public.total_loss_report_versions set status='human_review_required' where id=r.id;
    else
      update public.total_loss_report_versions set status='failed',failure_code=failure where id=r.id;
    end if;
  end if;
  update public.workflow_work_items set status='terminal_failed',dispatch_token=null,dispatch_expires_at=null,
    processing_token=fence,processing_expires_at=null,retryable=false,last_error_code=failure,
    failed_at=statement_timestamp(),completed_at=null where id=w.id;
  update public.total_loss_package_jobs set
    status=case when r.id is not null then 'waiting_human_review' else 'failed' end,
    processing_token=fence,processing_expires_at=null,
    failure_code=case when r.id is not null then null else failure end,
    retryable=case when r.id is not null then null else false end,
    finished_at=case when r.id is not null then null else statement_timestamp() end
    where id=p.id;
  update public.total_loss_claim_workflows set current_task='exception_review',revision=revision+1
    where case_id=w.case_id and current_package_job_id=p.id;
  insert into public.total_loss_workflow_events(case_id,event_type,actor_type,associated_entity_type,
    associated_entity_id,client_request_id,details)
    values(w.case_id,'work.recovery_exhausted','system','workflow_work_item',w.id,w.id,
      jsonb_build_object('failureCode',failure,'deliveryGeneration',w.delivery_generation,'executionAttempts',w.attempt_count))
    on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.hold_exhausted_workflow_work_internal(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.workflow_work_item_delivery_generation(requested_work_item_id uuid,requested_dispatch_token uuid)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare generation integer;
begin
  select delivery_generation into generation from public.workflow_work_items
    where id=requested_work_item_id and status='dispatching' and dispatch_token=requested_dispatch_token
      and dispatch_expires_at>statement_timestamp() for update;
  if not found then raise exception using errcode='55000',message='Dispatch fence is stale.'; end if;
  return generation;
end;
$$;
create function public.advance_workflow_work_item_delivery(requested_work_item_id uuid,requested_dispatch_token uuid,requested_generation integer)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare generation integer; kind text;
begin
  if requested_generation is null or requested_generation not between 0 and 5 then
    raise exception using errcode='22023',message='Delivery generation is invalid.';
  end if;
  generation:=public.workflow_work_item_delivery_generation(requested_work_item_id,requested_dispatch_token);
  if generation=requested_generation+1 then return generation; end if;
  if generation<>requested_generation then raise exception using errcode='55000',message='Delivery generation fence is stale.'; end if;
  if generation=5 then
    select work_type into kind from public.workflow_work_items where id=requested_work_item_id;
    if not public.hold_exhausted_workflow_work_internal(requested_work_item_id,kind,true) then
      raise exception using errcode='55000',message='Delivery exhaustion fence is stale.';
    end if;
    return null;
  end if;
  update public.workflow_work_items set delivery_generation=delivery_generation+1 where id=requested_work_item_id;
  return generation+1;
end;
$$;
revoke all on function public.workflow_work_item_delivery_generation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.advance_workflow_work_item_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.workflow_work_item_delivery_generation(uuid,uuid) to service_role;
grant execute on function public.advance_workflow_work_item_delivery(uuid,uuid,integer) to service_role;

create or replace function public.reserve_due_workflow_work_items(requested_dispatch_token uuid,requested_limit integer)
returns table(work_item_id uuid,package_job_id uuid,work_type text,work_version text,dispatch_attempt_count integer)
language plpgsql volatile security definer set search_path='' as $$
declare w public.workflow_work_items%rowtype;
begin
  if requested_dispatch_token is null or requested_limit is null or requested_limit not between 1 and 100 then
    raise exception using errcode='22023',message='Dispatch reservation is invalid.';
  end if;
  for w in select i.* from public.workflow_work_items i
    join public.total_loss_package_jobs p on p.id=i.package_job_id
    where (p.processing_expires_at is null or p.processing_expires_at<=statement_timestamp()) and (
      (i.status in ('queued','retryable_failed') and i.next_attempt_at<=statement_timestamp()) or
      (i.status='dispatching' and i.dispatch_expires_at<=statement_timestamp()) or
      (i.status='processing' and i.processing_expires_at<=statement_timestamp()))
    order by i.next_attempt_at,i.created_at,i.id limit requested_limit for update of i skip locked
  loop
    if public.hold_exhausted_workflow_work_internal(w.id,w.work_type) then continue; end if;
    update public.workflow_work_items i set status='dispatching',dispatch_attempt_count=i.dispatch_attempt_count+1,
      dispatch_token=requested_dispatch_token,dispatch_expires_at=statement_timestamp()+interval '5 minutes',
      processing_token=null,processing_expires_at=null,retryable=null,completed_at=null,failed_at=null,
      last_error_code=case when w.status='processing' then 'WORK_LEASE_EXPIRED' else i.last_error_code end
      where i.id=w.id returning i.* into w;
    return query select w.id,w.package_job_id,w.work_type,w.work_version,w.dispatch_attempt_count;
  end loop;
end;
$$;

-- Guard the reviewed claim bodies; refuse installation if their lease contract drifts.
-- A 17-minute fence outlasts the 15-minute service timeout and 16-minute task deadline.
do $$
declare target regprocedure; definition text; kind text; needle text;
begin
  foreach kind in array array['package','report_generation','report_review'] loop
    target:=('public.claim_total_loss_'||kind||'_work_item(uuid,uuid)')::regprocedure;
    definition:=pg_get_functiondef(target);
    if (select count(*) from regexp_matches(definition,'''30 minutes''','g'))<>1 then
      raise exception 'Unexpected paid work lease contract: %',target;
    end if;
    definition:=replace(definition,'''30 minutes''','''17 minutes''');
    needle:='  select work_item.*';
    if position(needle in definition)=0 then raise exception 'Unexpected claim contract: %',target; end if;
    definition:=overlay(definition placing
      ('  perform public.hold_exhausted_workflow_work_internal(requested_work_item_id, '
       ||quote_literal(case kind when 'package' then 'total_loss_package_finalize' when 'report_generation' then 'total_loss_report_generate' else 'total_loss_report_review' end)||');'||E'\n\n')
      from position(needle in definition) for 0);
    execute definition;
  end loop;
end;
$$;
notify pgrst,'reload schema';
