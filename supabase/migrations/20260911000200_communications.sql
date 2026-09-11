-- Communications observes the existing case workflow. Deployment sends nothing.
create table public.communication_settings (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'disabled' check(mode in ('disabled','dry_run','live')),
  enrolled_after timestamptz,
  activated_at timestamptz,
  revision bigint not null default 1,
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.communication_settings(singleton) values(true);
create table public.communication_automations (
  template_key text primary key,
  category text not null check(category in ('transactional','follow_up')),
  enabled boolean not null default true,
  delay_seconds integer not null check(delay_seconds between 0 and 2592000),
  revision bigint not null default 1
);
insert into public.communication_automations(template_key,category,delay_seconds) values
 ('intake_reminder','follow_up',86400), ('free_review_ready','transactional',0),
 ('free_review_reminder','follow_up',259200), ('paid_review_started','transactional',300),
 ('paid_review_ready','transactional',0), ('request_reminder','follow_up',172800),
 ('insurer_waiting_reminder','follow_up',604800), ('insurer_no_response_reminder','follow_up',1209600),
 ('response_review_ready','transactional',0), ('case_closed','transactional',0);
create table public.communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  source text not null check(source in ('lifecycle','auth','test')),
  source_key text not null unique check(length(source_key) between 1 and 256),
  template_key text not null,
  case_id uuid references public.appraisal_cases(id) on delete cascade,
  entity_id uuid,
  recipient_email text,
  recipient_hash text,
  category text not null check(category in ('transactional','follow_up')),
  status text not null default 'queued' check(status in ('queued','sending','accepted','cancelled','review')),
  due_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp()+interval '48 hours',
  attempts integer not null default 0 check(attempts between 0 and 8),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  prepared_provider text check(prepared_provider in ('resend','mailpit')),
  prepared_payload jsonb,
  template_version text,
  provider_message_id text,
  unsubscribe_token text not null default encode(extensions.gen_random_bytes(32),'hex') unique,
  error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  created_at timestamptz not null default statement_timestamp(),
  accepted_at timestamptz,
  check((status='sending')=(lease_token is not null and lease_expires_at is not null)),
  check(source='lifecycle' or prepared_payload is null),
  check(prepared_payload is null or jsonb_typeof(prepared_payload)='object')
);
create index communication_deliveries_due on public.communication_deliveries(due_at) where status in ('queued','sending');
create index communication_deliveries_recipient on public.communication_deliveries(recipient_hash,created_at);
create index communication_deliveries_provider on public.communication_deliveries(provider_message_id);
create table public.communication_events (
  event_id text primary key check(length(event_id) between 1 and 256),
  provider_message_id text not null check(length(provider_message_id) between 1 and 256),
  event_type text not null check(event_type in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp()
);
create index communication_events_message on public.communication_events(provider_message_id,occurred_at desc);
create table public.communication_suppressions (
  recipient_hash text primary key check(recipient_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check(reason in ('opt_out','bounce','complaint')),
  created_at timestamptz not null default statement_timestamp()
);
create table public.communication_admin_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  action text not null,
  changes jsonb not null,
  created_at timestamptz not null default statement_timestamp()
);
-- Control-plane audit history is append only, with no customer content.
create trigger communication_admin_events_immutable before update or delete on public.communication_admin_events
 for each row execute function public.reject_total_loss_immutable_record();
create trigger communication_events_immutable before update or delete on public.communication_events
 for each row execute function public.reject_total_loss_immutable_record();

do $$ declare t text; begin
 foreach t in array array['communication_settings','communication_automations','communication_deliveries','communication_events','communication_suppressions','communication_admin_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function public.communication_candidates_internal(p_case_id uuid default null)
returns table(case_id uuid,recipient_email text,template_key text,entity_id uuid,eligible_at timestamptz,category text)
language sql stable security definer set search_path='' as $$
 with base as (
  select o.*, c.email as delivery_email, c.operational_follow_up_allowed as follow_up,
    w.current_task,w.resolved_at,w.current_package_job_id,w.current_report_version_id,
    w.current_negotiation_round_id,w.current_response_analysis_job_id,
    w.updated_at as workflow_updated_at,
    exists(select 1 from public.commerce_orders ord where ord.case_id=o.case_id and ord.paid_at is not null) as purchased,
    exists(select 1 from public.case_entitlements e where e.case_id=o.case_id and e.status in ('active','refunded_access_retained')) as entitled
  from public.total_loss_case_operations_internal o
  join public.appraisal_cases ac on ac.id=o.case_id
  join public.total_loss_case_contacts c on c.case_id=ac.id
  join auth.users u on u.id=ac.user_id
  cross join public.communication_settings settings
  left join public.total_loss_claim_workflows w on w.case_id=ac.id
  where (p_case_id is null or o.case_id=p_case_id) and settings.enrolled_after is not null
    and ac.created_at>=settings.enrolled_after
    and u.deleted_at is null and coalesce(u.is_anonymous,false)=false
    and u.email_confirmed_at is not null and lower(btrim(u.email))=c.email
 ), milestones as (
  select b.case_id,b.delivery_email,'intake_reminder'::text as key,b.case_id as entity,
    b.last_activity_at as since,b.follow_up from base b
   where b.case_stage in ('intake_not_started','intake_in_progress','report_required','report_uploaded','ready_for_analysis')
    and not b.purchased and b.current_task is null
  union all
  select b.case_id,b.delivery_email,'free_review_ready',b.analysis_job_id,b.analysis_job_finished_at,b.follow_up
   from base b join public.total_loss_analysis_jobs j on j.id=b.analysis_job_id
   where b.case_stage='analysis_complete' and not b.purchased and not j.started_as_guest and b.resolved_at is null
  union all
  select b.case_id,b.delivery_email,'free_review_reminder',b.case_id,
    greatest(b.analysis_job_finished_at,b.last_activity_at),b.follow_up
   from base b where b.case_stage='analysis_complete' and not b.purchased and b.resolved_at is null
  union all
  select b.case_id,b.delivery_email,'paid_review_started',ord.id,ord.paid_at,b.follow_up
   from base b join public.commerce_orders ord on ord.case_id=b.case_id and ord.status='paid'
   where b.entitled and b.resolved_at is null and b.current_report_version_id is null
     and b.current_task in ('purchase_complete','package_queued','report_generation_queued','report_generating','report_review_queued','report_reviewing','report_revision_required','finalizing')
  union all
  select b.case_id,b.delivery_email,'paid_review_ready',r.id,r.published_at,b.follow_up
   from base b join public.total_loss_report_versions r on r.id=b.current_report_version_id and r.case_id=b.case_id
   where b.entitled and b.resolved_at is null and b.current_task in ('report_ready','prepare_request','no_dispute_resolved')
     and public.total_loss_customer_report_access_for_user_internal(b.case_id,r.id,b.owner_user_id)
  union all
  select b.case_id,b.delivery_email,'request_reminder',coalesce(b.current_negotiation_round_id,m.draft_id),
    greatest(m.created_at,b.last_activity_at),b.follow_up
   from base b join lateral (
    select v.created_at,d.id as draft_id from public.total_loss_message_versions v
    join public.total_loss_message_drafts d on d.id=v.message_draft_id
    where v.case_id=b.case_id
      and row(v.recipient,v.subject,v.body) is not distinct from row(d.recipient,d.subject,d.body)
      and ((v.negotiation_round_id is null and d.negotiation_round_id is null
        and v.purpose='initial_reconsideration' and b.current_negotiation_round_id is null and b.current_task='prepare_request')
       or (v.negotiation_round_id=b.current_negotiation_round_id and d.revision=v.source_draft_revision
        and exists(select 1 from public.total_loss_follow_up_sources src where src.message_draft_id=d.id
          and public.resolve_total_loss_follow_up_generation_context(b.case_id,b.owner_user_id,src.decision_id) is not null)))
      and v.report_version_id=b.current_report_version_id and v.message_state='prepared'
      and not exists(select 1 from public.total_loss_message_versions sent where sent.message_draft_id=d.id and sent.message_state='customer_reported_sent')
    order by v.created_at desc limit 1
   ) m on true
   where b.entitled and b.resolved_at is null
     and b.current_task in ('prepare_request','insurer_response_received','awaiting_insurer_response')
     and public.total_loss_customer_report_access_for_user_internal(b.case_id,b.current_report_version_id,b.owner_user_id)
  union all
  select b.case_id,b.delivery_email,k.key,b.current_negotiation_round_id,s.sent_at,b.follow_up
   from base b cross join (values('insurer_waiting_reminder'),('insurer_no_response_reminder')) k(key)
   join lateral (
    select max(v.sent_at) as sent_at from public.total_loss_message_versions v
     where v.case_id=b.case_id and v.negotiation_round_id=b.current_negotiation_round_id and v.message_state='customer_reported_sent'
   ) s on s.sent_at is not null
   where b.entitled and b.resolved_at is null and b.current_task='awaiting_insurer_response'
    and not exists(select 1 from public.total_loss_communications response where response.case_id=b.case_id
      and response.negotiation_round_id=b.current_negotiation_round_id and response.direction='inbound' and response.status='confirmed')
  union all
  select b.case_id,b.delivery_email,'response_review_ready',j.id,j.completed_at,b.follow_up
   from base b join public.total_loss_insurer_response_analysis_jobs j on j.id=b.current_response_analysis_job_id
    and j.case_id=b.case_id and j.negotiation_round_id=b.current_negotiation_round_id
   join public.total_loss_communications response on response.id=j.response_communication_id and response.status='confirmed'
   where b.entitled and b.resolved_at is null and b.current_task='insurer_response_received'
     and j.status='completed' and j.current_run_id is not null
     and not exists(select 1 from public.total_loss_communications successor where successor.case_id=b.case_id and successor.supersedes_communication_id=response.id and successor.status='confirmed')
     and public.total_loss_customer_report_access_for_user_internal(b.case_id,j.source_report_version_id,b.owner_user_id)
  union all
  select b.case_id,b.delivery_email,'case_closed',b.case_id,b.resolved_at,b.follow_up
   from base b where b.current_task='resolved' and b.resolved_at is not null
 )
 select m.case_id,m.delivery_email,m.key,m.entity,m.since+make_interval(secs=>a.delay_seconds),a.category
 from milestones m join public.communication_automations a on a.template_key=m.key and a.enabled
 where m.since is not null and m.entity is not null and (a.category='transactional' or m.follow_up)
  and not exists(select 1 from public.communication_suppressions s
   where s.recipient_hash=encode(extensions.digest(m.delivery_email,'sha256'),'hex')
    and (s.reason in ('bounce','complaint') or a.category='follow_up'));
$$;

create function public.communication_worker(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 j public.communication_deliveries%rowtype; c record; s public.communication_settings%rowtype;
 n integer; at_time timestamptz:=statement_timestamp(); lease uuid; allowed jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then
  raise exception using errcode='22023',message='Invalid communication request.'; end if;
 if p_action='plan' then
  return jsonb_build_object('mode',(select mode from public.communication_settings),'counts',coalesce((
   select jsonb_agg(x) from (select template_key,count(*) from public.communication_candidates_internal() candidate
    where eligible_at<=at_time and eligible_at>at_time-interval '48 hours'
     and not exists(select 1 from public.communication_deliveries d where d.source_key=candidate.template_key||'/'||candidate.case_id||'/'||candidate.entity_id) group by template_key) x),'[]'::jsonb));
 elsif p_action='event' then
  insert into public.communication_events(event_id,provider_message_id,event_type,occurred_at)
   values(p_payload->>'event_id',p_payload->>'provider_message_id',p_payload->>'event_type',(p_payload->>'occurred_at')::timestamptz)
   on conflict do nothing;
  if p_payload->>'event_type' in ('email.bounced','email.complained') and p_payload->>'recipient_hash' ~ '^[0-9a-f]{64}$' then
   insert into public.communication_suppressions(recipient_hash,reason)
    values(p_payload->>'recipient_hash',case when p_payload->>'event_type'='email.complained' then 'complaint' else 'bounce' end)
    on conflict(recipient_hash) do update set reason=excluded.reason;
  end if;
  return 'true';
 elsif p_action='unsubscribe' then
  insert into public.communication_suppressions(recipient_hash,reason)
   select recipient_hash,'opt_out' from public.communication_deliveries
   where unsubscribe_token=p_payload->>'token' and category='follow_up' and source='lifecycle'
   on conflict do nothing;
  return 'true';
 elsif p_action='record_auth' then
  insert into public.communication_deliveries(source,source_key,template_key,category,status,provider_message_id,recipient_hash,template_version,accepted_at)
   values('auth',p_payload->>'source_key',p_payload->>'template_key','transactional','accepted',p_payload->>'provider_message_id',p_payload->>'recipient_hash',p_payload->>'template_version',at_time)
   on conflict(source_key) do nothing;
  return 'true';
 elsif p_action='begin_test' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('communication_test'),pg_catalog.hashtext(p_payload->>'recipient_hash'));
  select * into j from public.communication_deliveries where source_key=p_payload->>'source_key' for update;
  if found then
   if j.source<>'test' or j.template_key is distinct from p_payload->>'template_key' or j.prepared_provider is distinct from p_payload->>'provider' then return null; end if;
   if j.status='accepted' then return to_jsonb(j); end if;
   if j.first_attempt_at<=at_time-interval '23 hours' or j.attempts>=8 or j.lease_expires_at>at_time then return null; end if;
  else
   if (select count(*) from public.communication_deliveries where source='test' and recipient_hash=p_payload->>'recipient_hash' and created_at>at_time-interval '1 hour')>=5 then return null; end if;
   insert into public.communication_deliveries(source,source_key,template_key,category,recipient_hash,prepared_provider,template_version)
    values('test',p_payload->>'source_key',p_payload->>'template_key','transactional',p_payload->>'recipient_hash',p_payload->>'provider',p_payload->>'template_version') returning * into j;
  end if;
  update public.communication_deliveries set status='sending',lease_token=(p_payload->>'lease_token')::uuid,
   lease_expires_at=at_time+interval '2 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,at_time) where id=j.id returning * into j;
  return to_jsonb(j);
 elsif p_action='finish_test' then
  update public.communication_deliveries set status='accepted',accepted_at=at_time,provider_message_id=p_payload->>'provider_message_id',lease_token=null,lease_expires_at=null
   where source='test' and source_key=p_payload->>'source_key' and status='sending' and lease_token=(p_payload->>'lease_token')::uuid and lease_expires_at>at_time;
  return to_jsonb(found);
 end if;
 select * into s from public.communication_settings for share;
 if p_action in ('discover','lease','prepare') and s.mode<>'live' then return null; end if;
 if p_action='discover' then
  -- Pending mail is reconciled against current pointers and consent every pass.
  update public.communication_deliveries d set status=case when d.prepared_payload is null then 'cancelled' else 'review' end,
    lease_token=null,lease_expires_at=null,error_code='EMAIL_NO_LONGER_CURRENT'
   where d.source='lifecycle' and (d.status='queued' or (d.status='sending' and d.lease_expires_at<=at_time))
    and (d.expires_at<=at_time or not exists(select 1 from public.communication_candidates_internal(d.case_id) x
      where x.template_key=d.template_key and x.entity_id=d.entity_id and x.recipient_email=d.recipient_email));
  allowed=p_payload->'recipients';
  insert into public.communication_deliveries(source,source_key,template_key,case_id,entity_id,recipient_email,recipient_hash,category,due_at,expires_at)
   select 'lifecycle',x.template_key||'/'||x.case_id||'/'||x.entity_id,x.template_key,x.case_id,x.entity_id,x.recipient_email,
    encode(extensions.digest(x.recipient_email,'sha256'),'hex'),x.category,x.eligible_at,x.eligible_at+interval '48 hours'
   from public.communication_candidates_internal() x
   where x.eligible_at<=at_time and x.eligible_at>at_time-interval '48 hours'
    and (allowed is null or allowed ? x.recipient_email)
   order by x.eligible_at,x.case_id limit 200 on conflict(source_key) do nothing;
  get diagnostics n=row_count; return jsonb_build_object('queued',n);
 elsif p_action='lease' then
  lease=(p_payload->>'lease_token')::uuid;
  if lease is null then raise exception using errcode='22023',message='Lease required.'; end if;
  allowed=p_payload->'recipients';
  update public.communication_deliveries d set status='review',lease_token=null,lease_expires_at=null,error_code='EMAIL_RETRY_WINDOW_EXPIRED'
   where d.source='lifecycle' and (d.status='queued' or (d.status='sending' and d.lease_expires_at<=at_time))
    and (d.attempts>=8 or d.first_attempt_at<=at_time-interval '23 hours');
  for j in select d.* from public.communication_deliveries d
   where d.source='lifecycle' and d.due_at<=at_time and d.expires_at>at_time and d.attempts<8
    and (d.status='queued' or (d.status='sending' and d.lease_expires_at<=at_time))
    and (allowed is null or allowed ? d.recipient_email)
   order by case when d.category='transactional' then 0 else 1 end,d.due_at,d.id limit 20 for update skip locked
  loop
   if not exists(select 1 from public.communication_candidates_internal(j.case_id) x
      where x.template_key=j.template_key and x.entity_id=j.entity_id and x.recipient_email=j.recipient_email and x.eligible_at<=at_time) then
    update public.communication_deliveries set status=case when j.prepared_payload is null then 'cancelled' else 'review' end,
      lease_token=null,lease_expires_at=null,error_code='EMAIL_NO_LONGER_CURRENT' where id=j.id; continue;
   end if;
   -- Serialize the recipient cap across independent workers and multiple cases.
   if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('communication_recipient'),pg_catalog.hashtext(j.recipient_hash)) then continue; end if;
   if j.category='follow_up' and (
    exists(select 1 from public.communication_deliveries d where d.id<>j.id and d.recipient_hash=j.recipient_hash
      and (d.status='sending' or (d.status='accepted' and d.accepted_at>at_time-interval '24 hours')))
    or (select count(*) from public.communication_deliveries d where d.id<>j.id and d.recipient_hash=j.recipient_hash
      and d.category='follow_up' and d.status='accepted' and d.accepted_at>at_time-interval '7 days')>=3
   ) then continue; end if;
   update public.communication_deliveries set status='sending',lease_token=lease,lease_expires_at=at_time+interval '2 minutes',
    attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,at_time) where id=j.id returning * into j;
   return to_jsonb(j);
  end loop;
  return null;
 elsif p_action in ('prepare','finish','fail') then
  select * into j from public.communication_deliveries where id=(p_payload->>'id')::uuid for update;
  if not found or j.status<>'sending' or j.lease_token is distinct from (p_payload->>'lease_token')::uuid
    or j.lease_expires_at<=at_time then return null; end if;
  if p_action='prepare' then
   if not exists(select 1 from public.communication_candidates_internal(j.case_id) x
     where x.template_key=j.template_key and x.entity_id=j.entity_id and x.recipient_email=j.recipient_email and x.eligible_at<=at_time) then
    update public.communication_deliveries set status=case when j.prepared_payload is null then 'cancelled' else 'review' end,
      lease_token=null,lease_expires_at=null,error_code='EMAIL_NO_LONGER_CURRENT' where id=j.id;
    return null;
   end if;
   if j.prepared_payload is null then
    if jsonb_typeof(p_payload->'prepared_payload') is distinct from 'object' then raise exception using errcode='22023',message='Prepared message required.'; end if;
    update public.communication_deliveries set prepared_payload=p_payload->'prepared_payload',prepared_provider=p_payload->>'provider',
      template_version=p_payload->>'template_version' where id=j.id returning * into j;
   end if;
   return to_jsonb(j);
  elsif p_action='finish' then
   update public.communication_deliveries set status='accepted',accepted_at=at_time,provider_message_id=p_payload->>'provider_message_id',
     lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  else
   update public.communication_deliveries set status=case when p_payload->'requires_review'='true'::jsonb or attempts>=8 then 'review' else 'queued' end,
    due_at=at_time+make_interval(secs=>least(3600,60*power(2,j.attempts-1)::integer)),
    lease_token=null,lease_expires_at=null,error_code=p_payload->>'error_code' where id=j.id;
  end if;
  return 'true';
 end if;
 raise exception using errcode='22023',message='Unknown communication operation.';
end;
$$;

create function public.communication_staff_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.communication_settings%rowtype; a public.communication_automations%rowtype; target_mode text;
begin
 perform public.staff_admin_require_access();
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and deleted_at is null) then raise exception using errcode='42501',message='Verified staff access required.'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096 then
  raise exception using errcode='22023',message='Invalid communication request.'; end if;
 if p_action='overview' then
  return jsonb_build_object('settings',(select to_jsonb(s) from public.communication_settings s),
   'automations',(select jsonb_agg(automation_row order by automation_row.template_key) from public.communication_automations automation_row),
   'activity',coalesce((select jsonb_agg(x) from (
    select d.id,d.source,d.template_key,d.status,d.attempts,d.created_at,d.accepted_at,d.error_code,
     (select e.event_type from public.communication_events e where e.provider_message_id=d.provider_message_id
       order by case when e.event_type in ('email.complained','email.bounced','email.failed','email.suppressed') then 0
         when e.event_type='email.delivered' then 1 else 2 end,e.occurred_at desc limit 1) as delivery_status
    from public.communication_deliveries d order by d.created_at desc limit 100
   ) x),'[]'::jsonb),
   'partner_activity',coalesce((select jsonb_agg(x) from (
    select j.id,'partner'::text as source,j.payload->>'kind' as template_key,j.status,j.attempts,j.created_at,j.finished_at as accepted_at,j.error_code,
     (select e.event_type from public.communication_events e where e.provider_message_id=j.provider_message_id
       order by case when e.event_type in ('email.complained','email.bounced','email.failed','email.suppressed') then 0 when e.event_type='email.delivered' then 1 else 2 end,e.occurred_at desc limit 1) as delivery_status
    from public.referral_partner_jobs j where j.kind='email' order by j.created_at desc limit 50
   ) x),'[]'::jsonb),
   'preview_activity',coalesce((select jsonb_agg(x) from (
    select d.id,'legacy_preview'::text as source,d.kind as template_key,d.status,d.attempt_count as attempts,d.created_at,d.sent_at as accepted_at,d.last_error_code as error_code
    from public.total_loss_preview_emails d order by d.created_at desc limit 50
   ) x),'[]'::jsonb),
   'suppression_count',(select count(*) from public.communication_suppressions));
 elsif p_action='settings' then
  target_mode=p_payload->>'mode';
  if target_mode is null or target_mode not in ('disabled','dry_run','live') then raise exception using errcode='22023',message='Invalid mode.'; end if;
  select * into settings from public.communication_settings for update;
  if settings.revision is distinct from (p_payload->>'revision')::bigint then raise exception using errcode='40001',message='Settings changed. Reload and retry.'; end if;
  update public.communication_settings set mode=target_mode,
    enrolled_after=case when target_mode='live' and activated_at is null then statement_timestamp() when target_mode<>'disabled' then coalesce(enrolled_after,statement_timestamp()) else enrolled_after end,
    activated_at=case when target_mode='live' then coalesce(activated_at,statement_timestamp()) else activated_at end,
    revision=revision+1,updated_at=statement_timestamp();
 elsif p_action='automation' then
  select * into a from public.communication_automations where template_key=p_payload->>'template_key' for update;
  if not found or a.revision is distinct from (p_payload->>'revision')::bigint then raise exception using errcode='40001',message='Automation changed. Reload and retry.'; end if;
  if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' or jsonb_typeof(p_payload->'delay_seconds') is distinct from 'number'
    or (a.category='follow_up' and (p_payload->>'delay_seconds')::integer<86400) then raise exception using errcode='22023',message='Invalid automation settings.'; end if;
  update public.communication_automations set enabled=(p_payload->>'enabled')::boolean,
    delay_seconds=(p_payload->>'delay_seconds')::integer,revision=revision+1 where template_key=a.template_key;
 elsif p_action='plan' then
  return public.communication_worker('plan');
 elsif p_action='test_access' then
  -- A test destination is always the current verified staff identity, never input.
  return jsonb_build_object('email',(select lower(btrim(email)) from auth.users where id=auth.uid()));
 else raise exception using errcode='22023',message='Unknown communication action.';
 end if;
 insert into public.communication_admin_events(actor_user_id,action,changes) values(auth.uid(),p_action,p_payload);
 return public.communication_staff_operation('overview');
end;
$$;

create function public.dispatch_communications()
returns bigint language plpgsql security definer set search_path='' as $$
declare api_origin text; dispatch_secret text; request_id bigint;
begin
 if not exists(select 1 from public.communication_settings where mode='live') then return null; end if;
 select decrypted_secret into api_origin from vault.decrypted_secrets where name='venfour_email_api_origin';
 select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name='venfour_email_dispatch_secret';
 if api_origin is null or dispatch_secret is null or api_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
  or length(dispatch_secret) not between 32 and 512 or dispatch_secret ~ '[[:space:][:cntrl:]]' then return null; end if;
 select net.http_post(url:=api_origin||'/internal/v1/communications/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||dispatch_secret),
  body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end;
$$;
revoke all on function public.communication_candidates_internal(uuid),public.communication_worker(text,jsonb),
 public.communication_staff_operation(text,jsonb),public.dispatch_communications() from public,anon,authenticated,service_role;
grant execute on function public.communication_worker(text,jsonb) to service_role;
grant execute on function public.communication_staff_operation(text,jsonb) to authenticated;
select cron.schedule('venfour-communications','* * * * *','select public.dispatch_communications();');
-- Operators activate the scheduler deliberately, independently of app deployment.
select cron.alter_job((select jobid from cron.job where jobname='venfour-communications'),active:=false);
