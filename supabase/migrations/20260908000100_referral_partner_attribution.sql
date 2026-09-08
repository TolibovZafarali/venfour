-- Stable referral links and case-scoped attribution, separate from commissions and payouts.
create table public.referral_partner_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null unique references public.referral_partners(id),
  code text not null unique default encode(extensions.gen_random_bytes(24),'hex') check (code ~ '^[0-9a-f]{48}$'),
  status text not null default 'active' check (status in ('active','paused')),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(id,partner_id)
);
create table public.referral_case_attributions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.appraisal_cases(id) on delete cascade,
  partner_id uuid not null references public.referral_partners(id),
  link_id uuid not null,
  agreement_id uuid not null references public.referral_partner_agreements(id),
  agreement_digest text not null check (agreement_digest ~ '^[0-9a-f]{64}$'),
  commission_amount_minor_units integer not null check (commission_amount_minor_units between 1 and 100000000),
  currency text not null check (currency='USD'),
  bound_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  unique(id,case_id),
  foreign key(link_id,partner_id) references public.referral_partner_links(id,partner_id),
  check (submitted_at is null or submitted_at>=bound_at)
);
create index referral_case_attributions_partner_submitted_idx
  on public.referral_case_attributions(partner_id,submitted_at desc,id) where submitted_at is not null;
create table public.referral_order_attributions (
  order_id uuid primary key,
  case_id uuid not null,
  attribution_id uuid not null,
  frozen_at timestamptz not null default statement_timestamp(),
  foreign key(order_id,case_id) references public.commerce_orders(id,case_id),
  foreign key(attribution_id,case_id) references public.referral_case_attributions(id,case_id),
  unique(order_id,case_id,attribution_id)
);
create table public.referral_purchase_conversions (
  order_id uuid primary key,
  case_id uuid not null,
  attribution_id uuid not null,
  payment_transaction_id uuid not null unique,
  purchased_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key(order_id,case_id,attribution_id) references public.referral_order_attributions(order_id,case_id,attribution_id),
  foreign key(payment_transaction_id,case_id) references public.payment_transactions(id,case_id)
);
alter table public.referral_partner_links enable row level security;
alter table public.referral_case_attributions enable row level security;
alter table public.referral_order_attributions enable row level security;
alter table public.referral_purchase_conversions enable row level security;
revoke all on public.referral_partner_links,public.referral_case_attributions,
  public.referral_order_attributions,public.referral_purchase_conversions from public,anon,authenticated,service_role;

create function public.referral_attribution_protect_internal()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='referral_case_attributions' then
    if tg_op='DELETE' then
      if old.submitted_at is null and not exists(select 1 from public.appraisal_cases c where c.id=old.case_id) then return old; end if;
    elsif (to_jsonb(new)-'submitted_at')=(to_jsonb(old)-'submitted_at')
      and (old.submitted_at is null or new.submitted_at is not distinct from old.submitted_at) then return new;
    end if;
  elsif tg_table_name='referral_partner_links' and tg_op='UPDATE' then
    if new.id=old.id and new.partner_id=old.partner_id and new.code=old.code and new.created_at=old.created_at
      and new.revision=old.revision+1 then return new; end if;
  end if;
  raise exception using errcode='55000',message='Referral history is immutable.';
end;
$$;
create trigger referral_case_attributions_protect before update or delete on public.referral_case_attributions
  for each row execute function public.referral_attribution_protect_internal();
create trigger referral_partner_links_protect before update or delete on public.referral_partner_links
  for each row execute function public.referral_attribution_protect_internal();
create trigger referral_order_attributions_protect before update or delete on public.referral_order_attributions
  for each row execute function public.referral_attribution_protect_internal();
create trigger referral_purchase_conversions_protect before update or delete on public.referral_purchase_conversions
  for each row execute function public.referral_attribution_protect_internal();

create function public.referral_partner_activate_link_internal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' and exists(select 1 from public.referral_partner_agreements a
      where a.id=new.current_agreement_id and a.partner_id=new.id and a.status='countersigned') then
    insert into public.referral_partner_links(partner_id) values(new.id) on conflict(partner_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger referral_partner_activate_link after insert or update of status,current_agreement_id on public.referral_partners
  for each row execute function public.referral_partner_activate_link_internal();
insert into public.referral_partner_links(partner_id)
  select p.id from public.referral_partners p join public.referral_partner_agreements a
    on a.id=p.current_agreement_id and a.partner_id=p.id and a.status='countersigned'
  where p.status='active' on conflict(partner_id) do nothing;

create function public.get_or_create_total_loss_draft_internal(p_referral_code text)
returns public.appraisal_cases language plpgsql security definer set search_path='' as $$
declare
  actor uuid=(select auth.uid()); c public.appraisal_cases%rowtype;
  l public.referral_partner_links%rowtype; a public.referral_partner_agreements%rowtype;
begin
  if actor is null then raise exception using errcode='42501',message='Authentication is required to prepare a total-loss draft.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('venfour:total-loss-draft:'||actor::text,0));
  select x.* into c from public.appraisal_cases x where x.user_id=actor and x.service_type='total_loss' and x.status='draft'
    order by x.last_activity_at desc,x.created_at desc,x.id desc limit 1 for update;
  if found then return c; end if;
  insert into public.appraisal_cases(user_id,service_type) values(actor,'total_loss') returning * into c;
  -- The link is consulted only after this call created a new draft under the owner lock.
  if p_referral_code is not null and p_referral_code ~ '^[0-9a-f]{48}$' then
    select x.* into l from public.referral_partner_links x where x.code=p_referral_code and x.status='active';
    if found then
      select y.* into a from public.referral_partners p join public.referral_partner_agreements y
        on y.id=p.current_agreement_id and y.partner_id=p.id and y.status='countersigned'
        where p.id=l.partner_id and p.status='active' for share of p,y;
      if found then
        -- Activation locks the partner before its link; use the same order when binding.
        select x.* into l from public.referral_partner_links x where x.id=l.id and x.status='active' for share;
      end if;
      if a.id is not null and l.id is not null then
        insert into public.referral_case_attributions(case_id,partner_id,link_id,agreement_id,agreement_digest,commission_amount_minor_units,currency)
          values(c.id,l.partner_id,l.id,a.id,a.agreement_digest,(a.snapshot->>'commission_amount_minor_units')::integer,a.snapshot->>'currency');
      end if;
    end if;
  end if;
  return c;
end;
$$;
create or replace function public.get_or_create_total_loss_draft()
returns public.appraisal_cases language sql volatile security definer set search_path='' as $$
  select public.get_or_create_total_loss_draft_internal(null);
$$;
create function public.get_or_create_referred_total_loss_draft(p_referral_code text)
returns public.appraisal_cases language sql volatile security definer set search_path='' as $$
  select public.get_or_create_total_loss_draft_internal(p_referral_code);
$$;
revoke all on function public.get_or_create_total_loss_draft_internal(text) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_referred_total_loss_draft(text) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_referred_total_loss_draft(text) to authenticated;

create function public.referral_mark_contact_submitted_internal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.referral_case_attributions set submitted_at=statement_timestamp() where case_id=new.case_id and submitted_at is null;
  return new;
end;
$$;
create trigger referral_contact_submitted after insert on public.total_loss_case_contacts
  for each row execute function public.referral_mark_contact_submitted_internal();

-- Preserve the established commerce contracts and add referral facts in the same transaction.
alter function public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)
  rename to reserve_total_loss_checkout_without_referral_internal;
create function public.reserve_total_loss_checkout(
  requested_case_id uuid,requested_purchaser_user_id uuid,requested_client_request_id uuid,
  configured_product_identifier text,configured_product_version text,configured_external_price_identifier text,
  configured_amount_minor_units bigint,configured_currency text,configured_terms_version text,
  configured_refund_policy_version text,configured_provider_livemode boolean
) returns setof public.total_loss_checkout_reservation_result language plpgsql security definer set search_path='' as $$
declare r public.total_loss_checkout_reservation_result;
begin
  select * into strict r from public.reserve_total_loss_checkout_without_referral_internal(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
  if r.state in ('reserved','existing') then
    insert into public.referral_order_attributions(order_id,case_id,attribution_id)
      select r.order_id,r.case_id,a.id from public.referral_case_attributions a
      where a.case_id=r.case_id and a.submitted_at is not null on conflict(order_id) do nothing;
  end if;
  return next r;
end;
$$;
revoke all on function public.reserve_total_loss_checkout_without_referral_internal(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean) to service_role;

alter function public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamptz)
  rename to fulfill_total_loss_checkout_without_referral_internal;
create function public.fulfill_total_loss_checkout_payment(
  requested_case_id uuid,requested_order_id uuid,requested_checkout_attempt_id uuid,
  requested_external_checkout_session_id text,requested_external_payment_intent_id text,
  requested_external_event_id text,requested_webhook_processing_token uuid,
  requested_external_price_identifier text,requested_quantity integer,requested_amount_minor_units bigint,
  requested_currency text,requested_provider_livemode boolean,requested_provider_occurred_at timestamptz
) returns setof public.total_loss_checkout_fulfillment_result language plpgsql security definer set search_path='' as $$
declare r public.total_loss_checkout_fulfillment_result;
begin
  select * into strict r from public.fulfill_total_loss_checkout_without_referral_internal(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
  if r.outcome='fulfilled' then
    insert into public.referral_purchase_conversions(order_id,case_id,attribution_id,payment_transaction_id,purchased_at)
      select r.order_id,r.case_id,a.attribution_id,r.payment_transaction_id,p.provider_occurred_at
      from public.referral_order_attributions a join public.payment_transactions p
        on p.id=r.payment_transaction_id and p.order_id=a.order_id and p.case_id=a.case_id and p.transaction_kind='payment'
      where a.order_id=r.order_id and a.case_id=r.case_id;
  end if;
  return next r;
end;
$$;
revoke all on function public.fulfill_total_loss_checkout_without_referral_internal(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamptz) to service_role;

create function public.referral_tracking_rows_internal(p_partner_id uuid)
returns table(id uuid,submitted_at timestamptz,purchased_at timestamptz,status text)
language sql stable security definer set search_path='' as $$
  select a.id,a.submitted_at,c.purchased_at,case
    when c.order_id is null then 'submitted'
    when o.status='disputed' or e.status='suspended' then 'under_review'
    when o.status in ('refunded','partially_refunded') then 'refunded'
    else 'purchased' end
  from public.referral_case_attributions a left join public.referral_purchase_conversions c on c.attribution_id=a.id
    left join public.commerce_orders o on o.id=c.order_id left join public.case_entitlements e on e.order_id=c.order_id
  where a.partner_id=p_partner_id and a.submitted_at is not null;
$$;
create function public.referral_summary_internal(p_partner_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('link',(select jsonb_build_object('id',l.id,'code',l.code,'status',l.status,'revision',l.revision,'created_at',l.created_at)
    from public.referral_partner_links l where l.partner_id=p_partner_id),
    'summary',(select jsonb_build_object('submitted_count',count(*),'purchased_count',count(*) filter(where r.purchased_at is not null),
      'refunded_count',count(*) filter(where r.status='refunded'),'under_review_count',count(*) filter(where r.status='under_review'))
      from public.referral_tracking_rows_internal(p_partner_id) r));
$$;

alter function public.referral_partner_operation(text,jsonb) rename to referral_partner_onboarding_operation_internal;
revoke all on function public.referral_partner_onboarding_operation_internal(text,jsonb) from public,anon,authenticated,service_role;
create function public.referral_partner_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid=(select auth.uid()); manager boolean; partner_uuid uuid; p public.referral_partners%rowtype;
  l public.referral_partner_links%rowtype; request_uuid uuid; request_digest text;
  prior public.referral_partner_requests%rowtype; result jsonb; rows_json jsonb; count_value bigint;
  page_number integer; page_size integer; allowed_keys text[]; enabled boolean;
begin
  if p_action is null or p_action not in ('referral_summary','referral_list','staff_referral_summary','staff_referral_list','link_state') then
    return public.referral_partner_onboarding_operation_internal(p_action,p_payload);
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then
    raise exception using errcode='22023',message='Invalid referral request.'; end if;
  if not exists(select 1 from auth.users u where u.id=actor and not coalesce(u.is_anonymous,false)
      and u.email_confirmed_at is not null and nullif(btrim(u.email),'') is not null) then
    raise exception using errcode='42501',message='Verified account required.'; end if;
  manager=public.referral_partner_is_manager_internal(actor);
  if p_action in ('staff_referral_summary','staff_referral_list','link_state') and not manager then
    raise exception using errcode='42501',message='Partner manager access required.'; end if;
  allowed_keys=case when p_action='link_state' then array['partner_id','request_id','expected_revision','enabled']
    when p_action in ('referral_list','staff_referral_list') then array['partner_id','page','page_size'] else array['partner_id'] end;
  if exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed_keys)) then
    raise exception using errcode='22023',message='Unexpected referral field.'; end if;
  partner_uuid=(p_payload->>'partner_id')::uuid;
  select x.* into p from public.referral_partners x where x.id=partner_uuid;
  if not found or (p_action in ('referral_summary','referral_list') and p.user_id is distinct from actor) then
    raise exception using errcode='42501',message='Partner unavailable.'; end if;
  if p_action='link_state' then
    if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
      or (p_payload->>'expected_revision') !~ '^[1-9][0-9]{0,8}$' then
      raise exception using errcode='22023',message='Invalid link state.'; end if;
    enabled=(p_payload->>'enabled')::boolean; request_uuid=(p_payload->>'request_id')::uuid;
    if request_uuid is null then raise exception using errcode='22023',message='Request ID required.'; end if;
    request_digest=public.total_loss_canonical_jsonb_digest(jsonb_build_object('action',p_action,'payload',p_payload));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||request_uuid::text,0));
    select * into prior from public.referral_partner_requests where actor_user_id=actor and request_id=request_uuid;
    if found then
      if prior.action<>p_action or prior.payload_digest<>request_digest then
        raise exception using errcode='40001',message='Request ID conflicts with recorded operation.'; end if;
      return prior.response;
    end if;
    select * into l from public.referral_partner_links where partner_id=partner_uuid for update;
    if not found or p.status<>'active' then raise exception using errcode='55000',message='Referral link unavailable.'; end if;
    if l.revision<>(p_payload->>'expected_revision')::integer then raise exception using errcode='40001',message='Referral link changed. Review it again.'; end if;
    update public.referral_partner_links set status=case when enabled then 'active' else 'paused' end,
      revision=revision+1,updated_at=statement_timestamp() where id=l.id;
    insert into public.referral_partner_events(partner_id,event_type,actor_user_id,metadata)
      values(partner_uuid,case when enabled then 'referral_link.resumed' else 'referral_link.paused' end,actor,jsonb_build_object('link_id',l.id));
    result=public.referral_summary_internal(partner_uuid);
    insert into public.referral_partner_requests(actor_user_id,request_id,action,payload_digest,response)
      values(actor,request_uuid,p_action,request_digest,result);
    return result;
  elsif p_action in ('referral_summary','staff_referral_summary') then return public.referral_summary_internal(partner_uuid);
  end if;
  if (p_payload ? 'page' and (jsonb_typeof(p_payload->'page') is distinct from 'number' or (p_payload->>'page') !~ '^[1-9][0-9]{0,5}$'))
    or (p_payload ? 'page_size' and (jsonb_typeof(p_payload->'page_size') is distinct from 'number' or (p_payload->>'page_size') !~ '^[1-9][0-9]{0,2}$')) then
    raise exception using errcode='22023',message='Invalid pagination.'; end if;
  page_number=coalesce((p_payload->>'page')::integer,1); page_size=coalesce((p_payload->>'page_size')::integer,50);
  if page_number not between 1 and 100000 or page_size not between 1 and 100 then
    raise exception using errcode='22023',message='Invalid pagination.'; end if;
  select count(*) into count_value from public.referral_tracking_rows_internal(partner_uuid);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc,q.id),'[]'::jsonb) into rows_json
    from (select r.* from public.referral_tracking_rows_internal(partner_uuid) r order by r.submitted_at desc,r.id
      limit page_size offset (page_number-1)*page_size) q;
  return jsonb_build_object('items',rows_json,'total',count_value,'page',page_number,'page_size',page_size);
end;
$$;
revoke all on function public.referral_partner_operation(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.referral_partner_operation(text,jsonb) to authenticated;
revoke all on function public.referral_attribution_protect_internal(),public.referral_partner_activate_link_internal(),
  public.referral_mark_contact_submitted_internal(),public.referral_tracking_rows_internal(uuid),public.referral_summary_internal(uuid)
  from public,anon,authenticated,service_role;

comment on table public.referral_case_attributions is 'Immutable first referral attached only while creating a new owned draft; unsubmitted draft cleanup may cascade.';
comment on table public.referral_purchase_conversions is 'One historical conversion per logical order, committed with verified payment fulfillment; no earnings or payout calculation.';
comment on function public.get_or_create_referred_total_loss_draft(text) is 'Creates or resumes an owned draft; a valid active referral is attached only to a newly created draft, with no attribution expiry.';
