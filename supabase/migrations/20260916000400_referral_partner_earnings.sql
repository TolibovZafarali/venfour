-- Private, append-only commission accounting. No payment transfer capability.
create table public.referral_commission_entries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.referral_partners(id),
  attribution_id uuid not null unique references public.referral_case_attributions(id),
  order_id uuid not null references public.referral_purchase_conversions(order_id),
  agreement_id uuid not null references public.referral_partner_agreements(id),
  reviewer_id uuid not null references auth.users(id),
  outcome jsonb not null check (jsonb_typeof(outcome)='object'),
  outcome_digest text not null check (outcome_digest ~ '^[0-9a-f]{64}$'),
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  sequence integer not null check (sequence>0),
  amount_minor integer not null check (amount_minor in (5000,7500)),
  verified_at timestamptz not null,
  eligible_at timestamptz not null check (eligible_at>=verified_at),
  created_at timestamptz not null default statement_timestamp(),
  unique(partner_id,month,sequence)
);
create table public.referral_commission_events (
  id uuid primary key,
  entry_id uuid not null references public.referral_commission_entries(id),
  revision integer not null check (revision>0),
  kind text not null check (kind in ('hold','release','reverse','paid','recovery_review')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  reviewer_id uuid not null references auth.users(id),
  payment_reference text check (length(btrim(payment_reference)) between 1 and 200),
  created_at timestamptz not null default statement_timestamp(),
  unique(entry_id,revision),
  check ((kind='paid')=(payment_reference is not null))
);
create unique index referral_commission_once_paid on public.referral_commission_events(entry_id) where kind='paid';
alter table public.referral_commission_entries enable row level security;
alter table public.referral_commission_events enable row level security;
revoke all on public.referral_commission_entries,public.referral_commission_events from public,anon,authenticated,service_role;
create trigger referral_commission_entries_immutable before update or delete on public.referral_commission_entries
  for each row execute function public.referral_attribution_protect_internal();
create trigger referral_commission_events_immutable before update or delete on public.referral_commission_events
  for each row execute function public.referral_attribution_protect_internal();

create function public.referral_earnings_enabled_internal(p_partner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.referral_partners p join public.referral_partner_agreements a on a.id=p.current_agreement_id
   join public.referral_partner_templates t on t.id=a.template_id
   where p.id=p_partner_id and a.partner_id=p.id and a.status='countersigned' and p.status='active' and t.status='published' and not t.release_hold
     and a.snapshot->'commission_policy'='{"id":"verified-outcome-tiers-v1","eligible_service":"total_loss","threshold_exclusive_minor_units":100000,"first_tier_count":9,"first_tier_minor_units":5000,"next_tier_minor_units":7500,"timezone":"America/Chicago","payment_hold_days":30,"payout_day":15}'::jsonb);
$$;

create function public.referral_commission_payment_held_internal(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.commerce_orders o where o.id=p_order_id and o.status='paid')
   or not exists(select 1 from public.case_entitlements e where e.order_id=p_order_id and e.status='active')
   or exists(select 1 from public.commerce_refund_requests r where r.order_id=p_order_id and r.status not in ('failed','canceled'));
$$;

-- Authoritative payment changes pause accounting immediately, before a manual review.
create function public.referral_commission_rows_internal(p_partner_id uuid)
returns table(reference uuid,amount_minor integer,verified_at timestamptz,eligible_at timestamptz,status text,paid_at timestamptz,month text)
language sql stable security definer set search_path='' as $$
 select e.attribution_id,e.amount_minor,e.verified_at,e.eligible_at,
   case when paid.created_at is not null then
     case when latest.kind='recovery_review' or public.referral_commission_payment_held_internal(e.order_id) then 'recovery_review' else 'paid' end
   when latest.kind='reverse' then 'reversed'
   when latest.kind='hold' or public.referral_commission_payment_held_internal(e.order_id) then 'held'
   when e.eligible_at>statement_timestamp() then 'waiting' else 'ready' end,
   paid.created_at,e.month
 from public.referral_commission_entries e join public.commerce_orders o on o.id=e.order_id
 left join lateral (select v.* from public.referral_commission_events v where v.entry_id=e.id order by revision desc limit 1) latest on true
 left join public.referral_commission_events paid on paid.entry_id=e.id and paid.kind='paid'
 where e.partner_id=p_partner_id;
$$;

-- This service-only adapter consumes trusted reviewer facts after deterministic Python validation.
-- It is not an outcome-verification endpoint and cannot be called by a browser identity.
create function public.referral_commission_worker(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 partner_uuid uuid=(p_payload->>'partner_id')::uuid; p public.referral_partners%rowtype;
 a public.referral_case_attributions%rowtype; g public.referral_partner_agreements%rowtype;
 c public.referral_purchase_conversions%rowtype; e public.referral_commission_entries%rowtype;
 prior public.referral_commission_events%rowtype; v jsonb=p_payload->'outcome'; n integer; rev integer;
 m text; verified timestamptz; reviewer uuid; kind text; digest text; item_status text;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='Private accounting service required.'; end if;
 select * into p from public.referral_partners where id=partner_uuid for update;
 if not found then raise exception using errcode='P0002',message='Partner unavailable.'; end if;
 if p_action='context' then
   return jsonb_build_object('enabled',public.referral_earnings_enabled_internal(partner_uuid),'recorded_at',statement_timestamp(),
     'entries',coalesce((select jsonb_agg(jsonb_build_object('outcome',x.outcome,'month',x.month,'sequence',x.sequence,'amount_minor',x.amount_minor,'eligible_at',x.eligible_at) order by x.verified_at,x.sequence) from public.referral_commission_entries x where x.partner_id=partner_uuid),'[]'::jsonb));
 elsif p_action='record' then
   reviewer=(v->>'reviewer_id')::uuid;
   if not public.referral_partner_is_manager_internal(reviewer) then raise exception using errcode='42501',message='Authorized reviewer required.'; end if;
   digest=public.total_loss_canonical_jsonb_digest(v);
   select * into e from public.referral_commission_entries where attribution_id=(v->>'attribution_id')::uuid;
   if found then
     if e.partner_id<>partner_uuid or e.outcome_digest<>digest then raise exception using errcode='40001',message='Verification conflicts with retained history.'; end if;
     return jsonb_build_object('id',e.id,'amount_minor',e.amount_minor);
   end if;
   if not public.referral_earnings_enabled_internal(partner_uuid) then raise exception using errcode='55000',message='Commission program is not enabled.'; end if;
   select * into a from public.referral_case_attributions where id=(v->>'attribution_id')::uuid and partner_id=partner_uuid;
   select * into g from public.referral_partner_agreements where id=a.agreement_id and partner_id=partner_uuid;
   select * into c from public.referral_purchase_conversions where attribution_id=a.id;
   if a.id is null or c.order_id is null or g.status is distinct from 'countersigned'
     or g.snapshot->'commission_policy' is distinct from '{"id":"verified-outcome-tiers-v1","eligible_service":"total_loss","threshold_exclusive_minor_units":100000,"first_tier_count":9,"first_tier_minor_units":5000,"next_tier_minor_units":7500,"timezone":"America/Chicago","payment_hold_days":30,"payout_day":15}'::jsonb
     or exists(select 1 from public.referral_partner_templates t where t.id=g.template_id and (t.release_hold or t.status<>'published'))
     or v->>'policy_id' is distinct from 'verified-outcome-tiers-v1'
     or v->>'partner_id' is distinct from partner_uuid::text
     or v->>'case_id' is distinct from a.case_id::text
     or v->>'agreement_digest' is distinct from a.agreement_digest or g.agreement_digest<>a.agreement_digest
     or (v->>'paid_at')::timestamptz is distinct from c.purchased_at
     or (v->>'attributed_at')::timestamptz is distinct from a.bound_at then
     raise exception using errcode='22023',message='Verification must match retained attribution and payment.';
   end if;
   if public.referral_commission_payment_held_internal(c.order_id) then
     raise exception using errcode='55000',message='Payment needs review.'; end if;
   -- Retained evidence must exist on this case; its interpretation remains an authorized review.
   if exists(select 1 from unnest(array[v->>'baseline_document_id',v->>'final_document_id',v->>'acceptance_document_id']) doc
       where not exists(select 1 from public.total_loss_claim_documents d where d.id=doc::uuid and d.case_id=a.case_id and d.sealed_at is not null)) then
     raise exception using errcode='22023',message='Retained case evidence required.'; end if;
   verified=(v->>'verified_at')::timestamptz; m=to_char(verified at time zone 'America/Chicago','YYYY-MM');
   select count(*)+1 into n from public.referral_commission_entries where partner_id=partner_uuid and month=m;
   if verified is null or verified>statement_timestamp() or verified<statement_timestamp()-interval '5 minutes'
     or exists(select 1 from public.referral_commission_entries where partner_id=partner_uuid and verified_at>verified)
     or (p_payload->>'sequence')::integer is distinct from n then
     raise exception using errcode='40001',message='Accounting changed. Recalculate using current context.'; end if;
   if p_payload->>'month' is distinct from m or (p_payload->>'amount_minor')::integer is distinct from (case when n<=9 then 5000 else 7500 end)
     or (p_payload->>'eligible_at')::timestamptz is distinct from greatest(verified,c.purchased_at+interval '720 hours') then
     raise exception using errcode='22023',message='Invalid calculated commission.'; end if;
   insert into public.referral_commission_entries(partner_id,attribution_id,order_id,agreement_id,reviewer_id,outcome,outcome_digest,month,sequence,amount_minor,verified_at,eligible_at)
     values(partner_uuid,a.id,c.order_id,g.id,reviewer,v,digest,m,n,(p_payload->>'amount_minor')::integer,verified,(p_payload->>'eligible_at')::timestamptz) returning * into e;
   return jsonb_build_object('id',e.id,'amount_minor',e.amount_minor);
 elsif p_action='event' then
   reviewer=(p_payload->>'reviewer_id')::uuid; kind=p_payload->>'kind';
   if not public.referral_partner_is_manager_internal(reviewer) then raise exception using errcode='42501',message='Authorized reviewer required.'; end if;
   select * into e from public.referral_commission_entries where id=(p_payload->>'entry_id')::uuid and partner_id=partner_uuid for update;
   if not found then raise exception using errcode='P0002',message='Commission unavailable.'; end if;
   select * into prior from public.referral_commission_events where id=(p_payload->>'request_id')::uuid;
   if found then
     if prior.entry_id<>e.id or prior.kind is distinct from kind or prior.reviewer_id<>reviewer
       or prior.reason is distinct from p_payload->>'reason' or prior.payment_reference is distinct from p_payload->>'payment_reference'
       or prior.revision is distinct from (p_payload->>'expected_revision')::integer+1 then
       raise exception using errcode='40001',message='Request conflicts with retained event.'; end if;
     return jsonb_build_object('revision',prior.revision);
   end if;
   select count(*) into rev from public.referral_commission_events where entry_id=e.id;
   if (p_payload->>'expected_revision')::integer is distinct from rev then raise exception using errcode='40001',message='Commission changed.'; end if;
   select r.status into item_status from public.referral_commission_rows_internal(partner_uuid) r where r.reference=e.attribution_id;
   if kind not in ('hold','release','reverse','paid','recovery_review') or kind is null
     or item_status='reversed'
     or (item_status in ('paid','recovery_review') and kind<>'recovery_review')
     or (kind='recovery_review' and item_status not in ('paid','recovery_review'))
     or (kind='paid' and item_status<>'ready') then
     raise exception using errcode='55000',message='Accounting transition unavailable.'; end if;
   insert into public.referral_commission_events(id,entry_id,revision,kind,reason,reviewer_id,payment_reference)
     values((p_payload->>'request_id')::uuid,e.id,rev+1,kind,p_payload->>'reason',reviewer,p_payload->>'payment_reference');
   return jsonb_build_object('revision',rev+1);
 end if;
 raise exception using errcode='22023',message='Unknown accounting operation.';
end;
$$;

alter function public.referral_partner_operation(text,jsonb) rename to referral_partner_before_earnings_internal;
revoke all on function public.referral_partner_before_earnings_internal(text,jsonb) from public,anon,authenticated,service_role;
create function public.referral_partner_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); partner_uuid uuid; pg integer; size integer; enabled boolean; period text; totals jsonb; items jsonb; total bigint;
begin
 if p_action is null or p_action not in ('earnings','staff_earnings') then return public.referral_partner_before_earnings_internal(p_action,p_payload); end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096
   or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('partner_id','page','page_size')) then
   raise exception using errcode='22023',message='Invalid earnings request.'; end if;
 if not exists(select 1 from auth.users u where u.id=actor and not coalesce(u.is_anonymous,false) and u.email_confirmed_at is not null)
   or (p_action='staff_earnings' and not public.referral_partner_is_manager_internal(actor)) then
   raise exception using errcode='42501',message='Verified authorized account required.'; end if;
 partner_uuid=(p_payload->>'partner_id')::uuid;
 if not exists(select 1 from public.referral_partners p where p.id=partner_uuid and (p_action='staff_earnings' or p.user_id=actor)) then
   raise exception using errcode='42501',message='Partner unavailable.'; end if;
 if (p_payload ? 'page' and (p_payload->>'page' !~ '^[1-9][0-9]{0,5}$' or jsonb_typeof(p_payload->'page')<>'number'))
   or (p_payload ? 'page_size' and (p_payload->>'page_size' !~ '^[1-9][0-9]{0,2}$' or jsonb_typeof(p_payload->'page_size')<>'number')) then
   raise exception using errcode='22023',message='Invalid earnings pagination.'; end if;
 pg=coalesce((p_payload->>'page')::integer,1); size=coalesce((p_payload->>'page_size')::integer,25);
 if pg not between 1 and 100000 or size not between 1 and 100 then raise exception using errcode='22023',message='Invalid earnings pagination.'; end if;
 enabled=public.referral_earnings_enabled_internal(partner_uuid) or exists(select 1 from public.referral_commission_entries where partner_id=partner_uuid);
 period=to_char(statement_timestamp() at time zone 'America/Chicago','YYYY-MM');
 if enabled then
   select jsonb_build_object('earned_month_minor',coalesce(sum(amount_minor) filter(where month=period and status<>'reversed'),0),
     'awaiting_payout_minor',coalesce(sum(amount_minor) filter(where paid_at is null and status<>'reversed'),0),
     'held_minor',coalesce(sum(amount_minor) filter(where status='held'),0),
     'paid_minor',coalesce(sum(amount_minor) filter(where paid_at is not null),0),
     'verified_month_count',count(*) filter(where month=period)) into totals from public.referral_commission_rows_internal(partner_uuid);
 end if;
 select count(*) into total from public.referral_case_attributions where partner_id=partner_uuid and submitted_at is not null;
 select coalesce(jsonb_agg(q.item order by q.submitted_at desc,q.id),'[]'::jsonb) into items from (
   select a.id,a.submitted_at,jsonb_build_object('reference',a.id,'amount_minor',r.amount_minor,'verified_at',r.verified_at,'eligible_at',r.eligible_at,
      'status',case when not enabled then 'not_enabled' else coalesce(r.status,'unverified') end,'paid_at',r.paid_at) item
   from public.referral_case_attributions a left join public.referral_commission_rows_internal(partner_uuid) r on r.reference=a.id
   where a.partner_id=partner_uuid and a.submitted_at is not null order by a.submitted_at desc,a.id limit size offset (pg-1)*size) q;
 return jsonb_build_object('availability',case when enabled then 'enabled' else 'not_enabled' end,'currency','USD','period',period,'as_of',statement_timestamp(),
    'summary',totals,'items',items,'total',total,'page',pg,'page_size',size);
end;
$$;
revoke all on function public.referral_commission_payment_held_internal(uuid),public.referral_earnings_enabled_internal(uuid),public.referral_commission_rows_internal(uuid),public.referral_commission_worker(text,jsonb),public.referral_partner_operation(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.referral_partner_operation(text,jsonb) to authenticated;
grant execute on function public.referral_commission_worker(text,jsonb) to service_role;
