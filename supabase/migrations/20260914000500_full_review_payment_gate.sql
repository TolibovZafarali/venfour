-- Preserve the report-fact boundary and require its exact strict result before payment.
create table public.total_loss_full_review_assessments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases(id),
  report_id uuid not null,
  report_revision bigint not null check (report_revision > 0),
  source_run_id uuid not null references public.analysis_runs(id),
  source_input_id uuid not null,
  source_input_revision bigint not null check (source_input_revision > 0),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  review_version text not null check (review_version = '1'),
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  calculation_digest text not null check (calculation_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(report_id, report_revision, review_version),
  foreign key(report_id,case_id) references public.total_loss_full_review_reports(id,case_id),
  check (coalesce(calculation->>'newProviderRequests' = '0',false))
);
alter table public.total_loss_full_review_assessments enable row level security;
revoke all on public.total_loss_full_review_assessments from public,anon,authenticated,service_role;
grant select on public.total_loss_full_review_assessments to service_role;
create function public.protect_full_review_assessment_internal() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'STRICT_REVIEW_IMMUTABLE'; end $$;
create trigger protect_full_review_assessment before update or delete on public.total_loss_full_review_assessments
  for each row execute function public.protect_full_review_assessment_internal();
revoke all on function public.protect_full_review_assessment_internal() from public,anon,authenticated,service_role;

-- Reuse the durable outbox, authenticated dispatcher and bounded recovery for unpaid preparation.
alter table public.workflow_work_items alter column package_job_id drop not null;
alter table public.workflow_work_items add column full_review_report_id uuid;
alter table public.workflow_work_items add column full_review_report_revision bigint;
alter table public.workflow_work_items add constraint workflow_full_review_report_case_fkey
  foreign key(full_review_report_id,case_id) references public.total_loss_full_review_reports(id,case_id);
alter table public.workflow_work_items add constraint workflow_preparation_identity check (
  (package_job_id is not null and full_review_report_id is null and full_review_report_revision is null
    and work_type <> 'total_loss_full_review_prepare') or
  (package_job_id is null and full_review_report_id is not null and full_review_report_revision is not null and full_review_report_revision > 0
    and work_type='total_loss_full_review_prepare' and work_version='1'));
create unique index workflow_full_review_revision_key on public.workflow_work_items(full_review_report_id,full_review_report_revision)
  where full_review_report_id is not null;
create unique index workflow_full_review_active_key on public.workflow_work_items(full_review_report_id)
  where full_review_report_id is not null and status not in ('completed','terminal_failed');
drop trigger workflow_work_items_protect_identity on public.workflow_work_items;
create trigger workflow_work_items_protect_identity before update on public.workflow_work_items
  for each row execute function public.protect_total_loss_stable_columns(
    'id','case_id','package_job_id','work_type','work_version','created_at','full_review_report_id');

alter function public.get_total_loss_full_review_context(uuid,uuid) rename to full_review_context_before_payment_internal;
create function public.get_total_loss_full_review_context(requested_case_id uuid,requested_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when ctx is null then null else ctx || jsonb_build_object(
    'strict_review',(select to_jsonb(a) from public.total_loss_full_review_assessments a
      where a.case_id=requested_case_id and a.report_id::text=ctx->'report'->>'id'
        and a.report_revision::text=ctx->'report'->>'revision' and a.review_version='1'
        and a.source_run_id::text=ctx->>'source_run_id' and a.source_input_id::text=ctx->>'source_input_id'
        and a.source_input_revision::text=ctx->>'source_input_revision'),
    'review_work',(select jsonb_build_object('id',w.id,'status',w.status,'revision',w.full_review_report_revision,
      'processingExpiresAt',w.processing_expires_at) from public.workflow_work_items w
      where w.full_review_report_id::text=ctx->'report'->>'id'
      order by w.created_at desc,w.id desc limit 1)) end
  from (select public.full_review_context_before_payment_internal($1,$2) ctx) s;
$$;

create function public.full_review_calculation_payment_eligible_internal(calculation jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    calculation->>'newProviderRequests'='0'
    and calculation#>>'{artifact,result,discrepancyResult,classification}' in ('POTENTIAL_UNDERVALUE','MATERIAL_UNDERVALUE_SIGNAL')
    and calculation#>>'{artifact,result,discrepancyResult,evidenceStrength}' in ('MODERATE','STRONG')
    and calculation#>>'{presentation,assessment,classification}'=calculation#>>'{artifact,result,discrepancyResult,classification}'
    and calculation#>>'{presentation,assessment,evidenceStrength}'=calculation#>>'{artifact,result,discrepancyResult,evidenceStrength}'
    and calculation#>>'{artifact,result,preliminaryQualification,qualificationVersion}'='1'
    and calculation#>>'{artifact,result,preliminaryQualification,marketClassification}'=calculation#>>'{artifact,result,discrepancyResult,classification}'
    and calculation#>>'{artifact,result,preliminaryQualification,outcome}'='CLEAR_MARKET_VALUE_GAP'
    and calculation#>'{artifact,result,preliminaryQualification,unresolvedMaterialChecks}'='[]'::jsonb
    and calculation#>'{artifact,result,preliminaryQualification,applicableMaterialReviewComplete}'='true'::jsonb,false);
$$;
alter function public.total_loss_full_review_ready(uuid,uuid) rename to full_review_facts_ready_internal;
create function public.total_loss_full_review_ready(requested_case_id uuid,requested_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.full_review_facts_ready_internal($1,$2)
    and ctx->'strict_review'->>'review_version'='1'
    and ctx->'strict_review'->>'document_sha256'=ctx->'report'->>'document_sha256'
    and public.full_review_calculation_payment_eligible_internal(ctx->'strict_review'->'calculation'),false)
  from (select public.get_total_loss_full_review_context($1,$2) ctx) s;
$$;

-- A retry of the same latest PDF reuses its row and immutable object, including after a lost response.
alter function public.begin_total_loss_full_review_report(uuid,uuid,uuid,text,text,bigint)
  rename to begin_full_review_before_dedup_internal;
create function public.begin_total_loss_full_review_report(requested_case_id uuid,requested_user_id uuid,
  requested_report_id uuid,requested_filename text,requested_sha256 text,requested_byte_size bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=requested_case_id and user_id=requested_user_id for update;
  ctx:=public.get_total_loss_full_review_context($1,$2);
  if ctx is null then raise exception 'FULL_REVIEW_NOT_FOUND'; end if;
  if (ctx->>'locked')::boolean then raise exception 'FULL_REVIEW_LOCKED'; end if;
  if ctx->'report'->>'document_sha256'=requested_sha256 and ctx->'report'->>'byte_size'=requested_byte_size::text then
    return ctx->'report';
  end if;
  if ctx->'report'->>'status'='uploading'
    and (ctx->'report'->>'created_at')::timestamptz>clock_timestamp()-interval '5 minutes' then
    raise exception 'FULL_REVIEW_BUSY';
  end if;
  if exists(select 1 from public.workflow_work_items where case_id=requested_case_id
    and work_type='total_loss_full_review_prepare' and status not in ('completed','terminal_failed')) then
    raise exception 'FULL_REVIEW_BUSY';
  end if;
  return public.begin_full_review_before_dedup_internal($1,$2,$3,$4,$5,$6);
end;
$$;

create function public.enqueue_total_loss_full_review(requested_case_id uuid,requested_user_id uuid,
  requested_report_id uuid,expected_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare ctx jsonb; r public.total_loss_full_review_reports; w public.workflow_work_items;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=requested_case_id and user_id=requested_user_id for update;
  ctx:=public.get_total_loss_full_review_context($1,$2);
  if ctx is null then raise exception 'FULL_REVIEW_NOT_FOUND'; end if;
  if (ctx->>'locked')::boolean then raise exception 'FULL_REVIEW_LOCKED'; end if;
  if ctx->'report'->>'id' is distinct from requested_report_id::text then raise exception 'FULL_REVIEW_STALE'; end if;
  select * into strict r from public.total_loss_full_review_reports where id=requested_report_id for update;
  select * into w from public.workflow_work_items where full_review_report_id=r.id
    order by created_at desc,id desc limit 1;
  if w.id is not null and (w.status not in ('completed','terminal_failed') or w.full_review_report_revision=r.revision) then return w.id; end if;
  if r.revision<>expected_revision then raise exception 'FULL_REVIEW_STALE'; end if;
  if r.status in ('report_invalid','needs_confirmation') or ctx->'strict_review' is not null and ctx->'strict_review'<>'null'::jsonb then return null; end if;
  if r.status='uploading' then
    if not exists(select 1 from storage.objects where bucket_id=r.storage_bucket and name=r.storage_object_name
      and metadata->>'size'=r.byte_size::text) then raise exception 'FULL_REVIEW_FILE_REQUIRED'; end if;
    update public.total_loss_full_review_reports set status='uploaded' where id=r.id returning * into r;
  end if;
  if r.status not in ('uploaded','extraction_failed','extracting','ready') then raise exception 'FULL_REVIEW_TRANSITION_INVALID'; end if;
  insert into public.workflow_work_items(case_id,work_type,work_version,full_review_report_id,full_review_report_revision)
    values(r.case_id,'total_loss_full_review_prepare','1',r.id,r.revision) returning id into w.id;
  return w.id;
end;
$$;

-- Preparation leases share the durable worker deadline, without creating a paid package.
create function public.claim_total_loss_full_review_work(requested_work_item_id uuid,requested_processing_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.workflow_work_items; r public.total_loss_full_review_reports; ctx jsonb; owner_id uuid;
begin
  select * into w from public.workflow_work_items where id=requested_work_item_id;
  if w.id is null or w.work_type<>'total_loss_full_review_prepare' or w.work_version<>'1' or requested_processing_token is null then
    raise exception 'FULL_REVIEW_WORK_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(w.case_id::text));
  select user_id into owner_id from public.appraisal_cases where id=w.case_id for update;
  select * into w from public.workflow_work_items where id=requested_work_item_id for update;
  if w.status in ('completed','terminal_failed') then return jsonb_build_object('state',w.status); end if;
  if w.status='processing' and w.processing_expires_at>clock_timestamp() then return jsonb_build_object('state','already_processing'); end if;
  if w.next_attempt_at>clock_timestamp() then return jsonb_build_object('state','retry_later'); end if;
  if public.hold_exhausted_workflow_work_internal(w.id,w.work_type) then return jsonb_build_object('state','terminal_failed'); end if;
  ctx:=public.get_total_loss_full_review_context(w.case_id,owner_id);
  if ctx is null or ctx->'report'->>'id' is distinct from w.full_review_report_id::text or (ctx->>'locked')::boolean then
    update public.workflow_work_items set status='terminal_failed',attempt_count=attempt_count+1,
      dispatch_token=null,dispatch_expires_at=null,processing_token=requested_processing_token,processing_expires_at=null,
      retryable=false,last_error_code='FULL_REVIEW_STALE',failed_at=clock_timestamp() where id=w.id;
    return jsonb_build_object('state','terminal_failed');
  end if;
  select * into strict r from public.total_loss_full_review_reports where id=w.full_review_report_id for update;
  if r.status='extracting' and r.processing_expires_at>clock_timestamp() then return jsonb_build_object('state','already_processing'); end if;
  update public.workflow_work_items set status='processing',attempt_count=attempt_count+1,
    dispatch_token=null,dispatch_expires_at=null,processing_token=requested_processing_token,
    processing_expires_at=clock_timestamp()+interval '17 minutes',last_error_code=null,retryable=null,failed_at=null
    where id=w.id;
  if r.extraction is null then
    update public.total_loss_full_review_reports set status='extracting',processing_token=requested_processing_token,
      processing_expires_at=clock_timestamp()+interval '17 minutes' where id=r.id;
  end if;
  return jsonb_build_object('state','claimed','context',public.get_total_loss_full_review_context(w.case_id,owner_id));
end;
$$;

create function public.complete_total_loss_full_review_work(requested_work_item_id uuid,requested_processing_token uuid,
  expected_report_revision bigint,requested_calculation jsonb,requested_digest text)
returns boolean language plpgsql security definer set search_path='' as $$
declare w public.workflow_work_items; r public.total_loss_full_review_reports; ctx jsonb; owner_id uuid;
begin
  select * into w from public.workflow_work_items where id=requested_work_item_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(w.case_id::text));
  select user_id into owner_id from public.appraisal_cases where id=w.case_id for update;
  select * into w from public.workflow_work_items where id=requested_work_item_id for update;
  if w.work_type<>'total_loss_full_review_prepare' or w.status<>'processing' or w.processing_token is distinct from requested_processing_token
    or w.processing_expires_at<=clock_timestamp() then return false; end if;
  ctx:=public.get_total_loss_full_review_context(w.case_id,owner_id);
  if ctx is null or (ctx->>'locked')::boolean or ctx->'report'->>'id' is distinct from w.full_review_report_id::text then return false; end if;
  select * into strict r from public.total_loss_full_review_reports where id=w.full_review_report_id for update;
  if r.revision<>expected_report_revision or r.status not in ('ready','needs_confirmation','report_invalid') then return false; end if;
  if r.status='ready' then
    if requested_calculation is null or jsonb_typeof(requested_calculation)<>'object'
      or requested_calculation->>'newProviderRequests' is distinct from '0'
      or requested_digest is null or requested_digest !~ '^[a-f0-9]{64}$'
      or requested_calculation#>>'{artifact,result,discrepancyResult,classification}' is null
      or requested_calculation#>>'{presentation,runId}' is distinct from requested_calculation#>>'{artifact,runId}' then
      raise exception 'STRICT_REVIEW_INVALID'; end if;
    insert into public.total_loss_full_review_assessments(case_id,report_id,report_revision,source_run_id,source_input_id,
      source_input_revision,document_sha256,review_version,calculation,calculation_digest)
    values(r.case_id,r.id,r.revision,r.source_run_id,r.source_input_id,(ctx->>'source_input_revision')::bigint,r.document_sha256,'1',requested_calculation,requested_digest);
  elsif requested_calculation is not null then raise exception 'STRICT_REVIEW_FACTS_REQUIRED'; end if;
  update public.workflow_work_items set status='completed',full_review_report_revision=r.revision,
    processing_expires_at=null,completed_at=clock_timestamp() where id=w.id;
  return true;
end;
$$;

create function public.fail_total_loss_full_review_work(requested_work_item_id uuid,requested_processing_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare w public.workflow_work_items; r public.total_loss_full_review_reports;
begin
  select * into w from public.workflow_work_items where id=requested_work_item_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(w.case_id::text));
  perform 1 from public.appraisal_cases where id=w.case_id for update;
  select * into w from public.workflow_work_items where id=requested_work_item_id for update;
  if w.work_type<>'total_loss_full_review_prepare' or w.status<>'processing' or w.processing_token is distinct from requested_processing_token
    or w.processing_expires_at<=clock_timestamp() then return false; end if;
  select * into r from public.total_loss_full_review_reports where id=w.full_review_report_id for update;
  if r.status='extracting' and r.processing_token=requested_processing_token then
    update public.total_loss_full_review_reports set status='extraction_failed',processing_token=null,processing_expires_at=null
      where id=r.id returning * into r;
  end if;
  update public.workflow_work_items set status=case when attempt_count<3 then 'retryable_failed' else 'terminal_failed' end,
    full_review_report_revision=r.revision,processing_expires_at=null,retryable=attempt_count<3,
    last_error_code='FULL_REVIEW_PREPARATION_FAILED',failed_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '1 minute'
    where id=w.id;
  return true;
end;
$$;

alter function public.hold_exhausted_workflow_work_internal(uuid,text,boolean) rename to hold_exhausted_paid_work_internal;
create function public.hold_exhausted_workflow_work_internal(requested_work_item_id uuid,expected_work_type text,delivery_exhausted boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare w public.workflow_work_items; r public.total_loss_full_review_reports;
begin
  if expected_work_type<>'total_loss_full_review_prepare' then
    return public.hold_exhausted_paid_work_internal($1,$2,$3); end if;
  select * into w from public.workflow_work_items where id=$1 for update;
  if w.id is null or w.work_type<>$2 or w.status in ('completed','terminal_failed') or w.processing_expires_at>clock_timestamp()
    or not delivery_exhausted and w.attempt_count<3 or delivery_exhausted and w.delivery_generation<5 then return false; end if;
  select * into strict r from public.total_loss_full_review_reports where id=w.full_review_report_id for update;
  if r.status='extracting' and r.processing_expires_at<=clock_timestamp() then
    update public.total_loss_full_review_reports set status='extraction_failed',processing_token=null,processing_expires_at=null
      where id=r.id returning * into r;
  end if;
  update public.workflow_work_items set status='terminal_failed',dispatch_token=null,dispatch_expires_at=null,
    full_review_report_revision=r.revision,
    processing_token=gen_random_uuid(),processing_expires_at=null,retryable=false,failed_at=clock_timestamp(),completed_at=null,
    last_error_code=case when delivery_exhausted then 'TASK_DELIVERY_EXHAUSTED' else 'WORK_ATTEMPTS_EXHAUSTED' end where id=w.id;
  return true;
end;
$$;
-- Preserve existing recovery ordering, generation limits and paid-work predicates.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.reserve_due_workflow_work_items(uuid,integer)'::regprocedure);
  if position('join public.total_loss_package_jobs p on p.id=i.package_job_id' in definition)=0 then raise exception 'Unexpected recovery contract'; end if;
  definition:=replace(definition,'join public.total_loss_package_jobs p on p.id=i.package_job_id',
    'left join public.total_loss_package_jobs p on p.id=i.package_job_id');
  execute definition;
end $$;

-- Old continuation signatures lose execution permission. Both backend and RPC check the saved review identity.
alter function public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)
  rename to initialize_post_continue_before_strict_internal;
create function public.initialize_total_loss_post_continue(requested_case_id uuid,requested_user_id uuid,expected_run_id uuid,
  expected_analysis_input_id uuid,expected_analysis_input_revision bigint,expected_report_id uuid,expected_report_revision bigint,
  frozen_presentation jsonb,frozen_digest text,expected_strict_review_id uuid,expected_strict_review_version text,expected_strict_review_digest text)
returns text language plpgsql security definer set search_path='' as $$
declare ctx jsonb; outcome text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=$1 and user_id=$2 for update;
  ctx:=public.get_total_loss_full_review_context($1,$2);
  if ctx is null then return 'not_found'; end if;
  if exists(select 1 from public.case_entitlements where case_id=$1 and status in ('active','refunded_access_retained'))
    or exists(select 1 from public.commerce_orders o left join public.total_loss_checkout_review_reports b on b.order_id=o.id
      where o.case_id=$1 and o.status<>'void' and b.strict_review_id is distinct from expected_strict_review_id) then return 'not_ready'; end if;
  if expected_strict_review_id is null or expected_strict_review_version is distinct from '1' or expected_strict_review_digest is null
    or ctx->'strict_review'->>'id' is distinct from expected_strict_review_id::text
    or ctx->'strict_review'->>'calculation_digest' is distinct from expected_strict_review_digest
    or not public.total_loss_full_review_ready($1,$2) then return 'not_ready'; end if;
  outcome:=public.initialize_post_continue_before_strict_internal($1,$2,$3,$4,$5,$6,$7,$8,$9);
  return outcome;
end;
$$;

alter table public.total_loss_checkout_review_reports add column strict_review_id uuid
  references public.total_loss_full_review_assessments(id);
create function public.bind_checkout_strict_review_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; ctx jsonb;
begin
  select user_id into owner_id from public.appraisal_cases where id=new.case_id;
  ctx:=public.get_total_loss_full_review_context(new.case_id,owner_id);
  if not public.total_loss_full_review_ready(new.case_id,owner_id)
    or new.report_id::text is distinct from ctx->'strict_review'->>'report_id'
    or new.report_revision::text is distinct from ctx->'strict_review'->>'report_revision' then raise exception 'STRICT_REVIEW_REQUIRED'; end if;
  new.strict_review_id:=(ctx->'strict_review'->>'id')::uuid;
  return new;
end;
$$;
create trigger bind_checkout_strict_review before insert on public.total_loss_checkout_review_reports
  for each row execute function public.bind_checkout_strict_review_internal();

-- An old pending order is not an exemption from strict eligibility for a new payment attempt.
create function public.full_review_existing_orders_match_internal(requested_case_id uuid,requested_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.commerce_orders o
    left join public.total_loss_checkout_review_reports b on b.order_id=o.id
    where o.case_id=$1 and o.status<>'void' and (b.strict_review_id is null
      or b.strict_review_id::text is distinct from public.get_total_loss_full_review_context($1,$2)->'strict_review'->>'id'));
$$;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.authorize_total_loss_checkout_preflight(uuid,uuid)'::regprocedure);
  if position('(r.has_pending_order or public.total_loss_full_review_ready($1,$2))' in definition)=0 then raise exception 'Unexpected checkout preflight'; end if;
  execute replace(definition,'(r.has_pending_order or public.total_loss_full_review_ready($1,$2))',
    '(public.total_loss_full_review_ready($1,$2) and public.full_review_existing_orders_match_internal($1,$2))');
  definition:=pg_get_functiondef('public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)'::regprocedure);
  if position('if not existing_order and not public.total_loss_full_review_ready($1,$2)' in definition)=0 then raise exception 'Unexpected checkout reservation'; end if;
  execute replace(definition,'if not existing_order and not public.total_loss_full_review_ready($1,$2)',
    'if not exists(select 1 from public.case_entitlements where case_id=requested_case_id and status in (''active'',''refunded_access_retained'')) and (not public.total_loss_full_review_ready($1,$2) or not public.full_review_existing_orders_match_internal($1,$2))');
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('full_review_context_before_payment_internal','full_review_calculation_payment_eligible_internal',
      'full_review_facts_ready_internal','begin_full_review_before_dedup_internal','hold_exhausted_paid_work_internal',
      'hold_exhausted_workflow_work_internal','initialize_post_continue_before_strict_internal','bind_checkout_strict_review_internal',
      'full_review_existing_orders_match_internal') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('get_total_loss_full_review_context','total_loss_full_review_ready','begin_total_loss_full_review_report',
      'enqueue_total_loss_full_review','claim_total_loss_full_review_work','complete_total_loss_full_review_work',
      'fail_total_loss_full_review_work','initialize_total_loss_post_continue') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
notify pgrst,'reload schema';
