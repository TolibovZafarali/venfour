-- Temporary launch supervision is durable, staff-only, and closed by default.
create table public.total_loss_payment_approval_settings (
  singleton boolean primary key default true check (singleton),
  manual_approval_required boolean not null default true
);
insert into public.total_loss_payment_approval_settings values (true,true);
alter table public.total_loss_payment_approval_settings enable row level security;
revoke all on public.total_loss_payment_approval_settings from public,anon,authenticated,service_role;
grant select on public.total_loss_payment_approval_settings to service_role;

create table public.total_loss_payment_approval_decisions (
  sequence bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases(id),
  owner_id uuid not null references auth.users(id),
  staff_id uuid not null references auth.users(id),
  request_id uuid not null,
  decision text not null check (decision in ('approved','held','declined')),
  lineage jsonb not null check (jsonb_typeof(lineage)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(staff_id,request_id),
  check (staff_id<>owner_id)
);
create index payment_approval_case_latest on public.total_loss_payment_approval_decisions(case_id,sequence desc);
alter table public.total_loss_payment_approval_decisions enable row level security;
revoke all on public.total_loss_payment_approval_decisions from public,anon,authenticated,service_role;
revoke all on sequence public.total_loss_payment_approval_decisions_sequence_seq from public,anon,authenticated,service_role;
grant select on public.total_loss_payment_approval_decisions to service_role;
create function public.protect_payment_approval_decision_internal() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'PAYMENT_APPROVAL_IMMUTABLE'; end $$;
create trigger protect_payment_approval_decision before update or delete on public.total_loss_payment_approval_decisions
  for each row execute function public.protect_payment_approval_decision_internal();

create function public.payment_approval_lineage_internal(ctx jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case when ctx->'strict_review'->>'id' is null then null else jsonb_build_object(
    'caseId',ctx->>'case_id','ownerId',ctx->>'user_id',
    'inputId',ctx->>'source_input_id','inputRevision',ctx->'source_input_revision',
    'sourceRunId',ctx->>'source_run_id',
    'reportId',ctx->'report'->>'id','reportRevision',ctx->'report'->'revision',
    'documentDigest',ctx->'report'->>'document_sha256',
    'assessmentId',ctx->'strict_review'->>'id','assessmentVersion',ctx->'strict_review'->>'review_version',
    'assessmentDigest',ctx->'strict_review'->>'calculation_digest',
    'assessmentPayloadDigest',encode(extensions.digest((ctx->'strict_review'->'calculation')::text,'sha256'),'hex'),
    'sourceDigest',encode(extensions.digest((ctx->'artifact')::text,'sha256'),'hex'),
    'readinessDigest',encode(extensions.digest((ctx->'report'->'readiness')::text,'sha256'),'hex'),
    'inputDigest',encode(extensions.digest((ctx->'input')::text,'sha256'),'hex')) end;
$$;

-- This projection adds no writes on open and does not call the readiness function.
create function public.payment_approval_status_internal(ctx jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('configured',s.singleton is true,'required',coalesce(s.manual_approval_required,true),
    'status',case when s.singleton is null then 'unavailable'
      when not s.manual_approval_required then 'not_required'
      when d.id is null then 'awaiting_approval'
      when d.lineage is distinct from public.payment_approval_lineage_internal(ctx) then 'awaiting_approval'
      else d.decision end,
    'approved',s.singleton is true and (not s.manual_approval_required or
      coalesce(d.decision='approved' and d.lineage=public.payment_approval_lineage_internal(ctx),false)))
  from (values(true)) seed(singleton)
  left join public.total_loss_payment_approval_settings s using(singleton)
  left join lateral (select * from public.total_loss_payment_approval_decisions
    where case_id::text=ctx->>'case_id' order by sequence desc limit 1) d on true;
$$;

alter function public.get_total_loss_full_review_context(uuid,uuid) rename to full_review_context_before_approval_internal;
create function public.get_total_loss_full_review_context(requested_case_id uuid,requested_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when ctx is null then null else ctx || jsonb_build_object(
    'payment_approval',public.payment_approval_status_internal(ctx)) end
  from (select public.full_review_context_before_approval_internal($1,$2) ctx) s;
$$;

-- Preserve strict evidence qualification as an independently inspectable gate.
create function public.total_loss_payment_approved(requested_case_id uuid,requested_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.total_loss_full_review_ready($1,$2)
    and ctx->'review_work'->>'status'='completed'
    and ctx->'report'->'readiness'->'issues'='[]'::jsonb
    and ctx->'payment_approval'->'approved'='true'::jsonb,false)
  from (select public.get_total_loss_full_review_context($1,$2) ctx) s;
$$;

-- Keep ownership, pending-order, price, version, and payment checks in their existing path.
alter function public.authorize_total_loss_checkout_preflight(uuid,uuid) rename to checkout_preflight_before_approval_internal;
create function public.authorize_total_loss_checkout_preflight(requested_case_id uuid,requested_purchaser_user_id uuid)
returns setof public.total_loss_checkout_preflight_result language plpgsql stable security definer set search_path='' as $$
declare r public.total_loss_checkout_preflight_result;
begin
  for r in select * from public.checkout_preflight_before_approval_internal($1,$2) loop
    r.checkout_available:=r.checkout_available and public.total_loss_payment_approved($1,$2);
    return next r;
  end loop;
end;
$$;
alter function public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)
  rename to reserve_checkout_before_approval_internal;
create function public.reserve_total_loss_checkout(requested_case_id uuid,requested_purchaser_user_id uuid,requested_client_request_id uuid,
  configured_product_identifier text,configured_product_version text,configured_external_price_identifier text,
  configured_amount_minor_units bigint,configured_currency text,configured_terms_version text,
  configured_refund_policy_version text,configured_provider_livemode boolean)
returns setof public.total_loss_checkout_reservation_result language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=$1 and user_id=$2 for update;
  if not found then return; end if;
  if not exists(select 1 from public.case_entitlements where case_id=$1 and status in ('active','refunded_access_retained'))
    and not public.total_loss_full_review_ready($1,$2) then raise exception 'FULL_REVIEW_REPORT_REQUIRED'; end if;
  if not exists(select 1 from public.case_entitlements where case_id=$1 and status in ('active','refunded_access_retained'))
    and not public.total_loss_payment_approved($1,$2) then raise exception 'PAYMENT_APPROVAL_REQUIRED'; end if;
  return query select * from public.reserve_checkout_before_approval_internal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
end;
$$;

alter function public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text,uuid,text,text)
  rename to initialize_post_continue_before_approval_internal;
create function public.initialize_total_loss_post_continue(requested_case_id uuid,requested_user_id uuid,
  expected_run_id uuid,expected_analysis_input_id uuid,expected_analysis_input_revision bigint,expected_report_id uuid,expected_report_revision bigint,
  frozen_presentation jsonb,frozen_digest text,
  expected_strict_review_id uuid,expected_strict_review_version text,expected_strict_review_digest text)
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=$1 and user_id=$2 for update;
  if not found then return 'not_found'; end if;
  if not public.total_loss_payment_approved($1,$2) then return 'not_ready'; end if;
  return public.initialize_post_continue_before_approval_internal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
end;
$$;

create function public.staff_payment_approval_decide(requested_case_id uuid,expected_lineage jsonb,
  requested_decision text,requested_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; ctx jsonb; lineage jsonb; previous public.total_loss_payment_approval_decisions; recorded public.total_loss_payment_approval_decisions;
begin
  perform public.staff_admin_require_access();
  if requested_decision is null or requested_decision not in ('approved','held','declined') or requested_request_id is null then
    raise exception 'PAYMENT_APPROVAL_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'),pg_catalog.hashtext(requested_case_id::text));
  select user_id into owner_id from public.appraisal_cases where id=requested_case_id for update;
  if owner_id is null or owner_id=auth.uid() then raise exception using errcode='42501',message='Payment review unavailable.'; end if;
  ctx:=public.get_total_loss_full_review_context(requested_case_id,owner_id);
  lineage:=public.payment_approval_lineage_internal(ctx);
  if lineage is null or lineage is distinct from expected_lineage then raise exception 'PAYMENT_APPROVAL_STALE'; end if;
  if not public.total_loss_full_review_ready(requested_case_id,owner_id)
    or ctx->'review_work'->>'status' is distinct from 'completed'
    or ctx->'report'->'readiness'->'issues' is distinct from '[]'::jsonb
    or not exists(select 1 from public.total_loss_payment_approval_settings where singleton and manual_approval_required)
    or exists(select 1 from public.case_entitlements where case_id=requested_case_id)
    or exists(select 1 from public.commerce_orders where case_id=requested_case_id and status<>'void') then
    raise exception 'PAYMENT_APPROVAL_NOT_READY'; end if;
  select * into previous from public.total_loss_payment_approval_decisions where staff_id=auth.uid() and request_id=requested_request_id;
  if found then
    if previous.case_id<>requested_case_id or previous.lineage<>lineage or previous.decision<>requested_decision then
      raise exception 'PAYMENT_APPROVAL_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id',previous.id,'decision',previous.decision,'createdAt',previous.created_at);
  end if;
  insert into public.total_loss_payment_approval_decisions(case_id,owner_id,staff_id,request_id,decision,lineage)
    values(requested_case_id,owner_id,auth.uid(),requested_request_id,requested_decision,lineage) returning * into recorded;
  return jsonb_build_object('id',recorded.id,'decision',recorded.decision,'createdAt',recorded.created_at);
end;
$$;

create function public.staff_payment_approval_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.staff_admin_require_access();
  select coalesce(jsonb_agg(row order by row->>'caseId'),'[]') into result from (
    select jsonb_build_object('caseId',c.id,'customerId',c.user_id,'customerName',contact.full_name,'customerEmail',contact.email,
      'vehicle',concat_ws(' ',ctx->'input'->>'vehicle_year',ctx->'input'->>'vehicle_make',ctx->'input'->>'vehicle_model',ctx->'input'->>'vehicle_trim'),
      'insurerValuation',(ctx#>>'{strict_review,calculation,presentation,insurerValuation,value,cents}')::numeric/100,
      'preliminaryOutcome',ctx#>>'{artifact,result,preliminaryQualification,outcome}',
      'classification',ctx#>>'{strict_review,calculation,presentation,assessment,classification}',
      'evidenceStrength',ctx#>>'{strict_review,calculation,presentation,assessment,evidenceStrength}',
      'eligibleComparables',jsonb_build_object(
        'current',coalesce(ctx#>'{strict_review,calculation,artifact,result,currentRanking,eligibleCount}','0'),
        'historical',coalesce(ctx#>'{strict_review,calculation,artifact,result,historicalRanking,eligibleCount}','0')),
      'limitations',coalesce(ctx#>'{strict_review,calculation,presentation,limitations}','[]'),
      'reportReady',true,'lineage',public.payment_approval_lineage_internal(ctx),
      'status',ctx->'payment_approval'->>'status','canApprove',c.user_id<>auth.uid()) row
    from public.appraisal_cases c
    left join public.total_loss_case_contacts contact on contact.case_id=c.id
    cross join lateral (select public.get_total_loss_full_review_context(c.id,c.user_id) ctx) s
    where c.service_type='total_loss' and public.total_loss_full_review_ready(c.id,c.user_id)
      and ctx->'review_work'->>'status'='completed' and ctx->'report'->'readiness'->'issues'='[]'::jsonb
      and ctx->'payment_approval'->>'status' in ('awaiting_approval','held','declined')
      and not exists(select 1 from public.commerce_orders where case_id=c.id and status<>'void')
      and not exists(select 1 from public.case_entitlements where case_id=c.id)
  ) rows;
  return result;
end;
$$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('protect_payment_approval_decision_internal','payment_approval_lineage_internal','payment_approval_status_internal',
      'full_review_context_before_approval_internal','checkout_preflight_before_approval_internal',
      'reserve_checkout_before_approval_internal','initialize_post_continue_before_approval_internal') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('get_total_loss_full_review_context','total_loss_payment_approved','authorize_total_loss_checkout_preflight',
      'reserve_total_loss_checkout','initialize_total_loss_post_continue') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
revoke all on function public.staff_payment_approval_decide(uuid,jsonb,text,uuid),public.staff_payment_approval_queue() from public,anon,authenticated,service_role;
grant execute on function public.staff_payment_approval_decide(uuid,jsonb,text,uuid),public.staff_payment_approval_queue() to authenticated;
notify pgrst,'reload schema';
