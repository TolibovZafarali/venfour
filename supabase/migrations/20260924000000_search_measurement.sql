-- Optional acquisition measurement is separate from payment authority.
create table public.case_acquisition (
  case_id uuid primary key references public.appraisal_cases(id) on delete cascade,
  attribution jsonb,
  advertising_allowed boolean not null default false,
  consent_updated_at timestamptz not null default statement_timestamp(),
  captured_at timestamptz not null default statement_timestamp()
);
alter table public.case_acquisition enable row level security;
revoke all on public.case_acquisition from public, anon, authenticated;

create table public.case_measurement_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  event_name text not null check (event_name in ('review_started','valuation_report_uploaded','review_eligible','checkout_started')),
  occurred_at timestamptz not null default statement_timestamp(),
  unique(case_id, event_name)
);
alter table public.case_measurement_events enable row level security;
revoke all on public.case_measurement_events from public, anon, authenticated;

create function public.save_case_acquisition(p_case_id uuid, p_attribution jsonb, p_advertising_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; v text; existing jsonb; first_paid boolean; incoming_paid boolean;
begin
  if auth.uid() is null or not exists(select 1 from public.appraisal_cases where id=p_case_id and user_id=auth.uid() and service_type='total_loss') then
    raise exception 'Case unavailable' using errcode='42501';
  end if;
  if p_advertising_allowed is null then raise exception 'Consent required' using errcode='22023'; end if;
  if not p_advertising_allowed then
    insert into public.case_acquisition(case_id,advertising_allowed) values(p_case_id,false)
    on conflict(case_id) do update set attribution=null, advertising_allowed=false, consent_updated_at=statement_timestamp();
    return;
  end if;
  if p_attribution is not null then
    if jsonb_typeof(p_attribution)<>'object' or pg_column_size(p_attribution)>4096 then raise exception 'Invalid attribution' using errcode='22023'; end if;
    for k,v in select key,value #>> '{}' from jsonb_each(p_attribution) loop
      if jsonb_typeof(p_attribution->k)<>'string' then raise exception 'Invalid attribution' using errcode='22023'; end if;
      if k in ('gclid','gbraid','wbraid') then
        if length(v) not between 1 and 256 or v !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid click identifier' using errcode='22023'; end if;
      elsif k in ('utm_source','utm_medium','utm_campaign','utm_term','utm_content') then
        if length(v) not between 1 and 120 or v !~ '^[A-Za-z0-9 _.,+~-]+$' then raise exception 'Invalid campaign value' using errcode='22023'; end if;
      elsif k='landing_page' then
        if v not in ('/','/total-loss-review','/start') then raise exception 'Invalid landing page' using errcode='22023'; end if;
      elsif k='captured_at' then
        if length(v)>35 or v::timestamptz>statement_timestamp()+interval '5 minutes' or v::timestamptz<statement_timestamp()-interval '30 days' then raise exception 'Expired attribution' using errcode='22023'; end if;
      else raise exception 'Unknown attribution field' using errcode='22023';
      end if;
    end loop;
    if not (p_attribution ?& array['landing_page','captured_at']) then raise exception 'Incomplete attribution' using errcode='22023'; end if;
  end if;
  -- Serializes with other attribution requests without modifying the case.
  perform 1 from public.appraisal_cases where id=p_case_id for update;
  select attribution into existing from public.case_acquisition where case_id=p_case_id;
  first_paid := coalesce(existing ?| array['gclid','gbraid','wbraid'] or lower(existing->>'utm_medium') in ('cpc','ppc','paidsearch'),false);
  incoming_paid := coalesce(p_attribution ?| array['gclid','gbraid','wbraid'] or lower(p_attribution->>'utm_medium') in ('cpc','ppc','paidsearch'),false);
  if existing is not null and (first_paid or not incoming_paid) then p_attribution := existing; end if;
  -- Acquisition cannot be replaced after payment. Withdrawal above always works.
  if exists(select 1 from public.payment_transactions where case_id=p_case_id and transaction_kind='payment') then p_attribution:=existing; end if;
  insert into public.case_acquisition(case_id,attribution,advertising_allowed) values(p_case_id,p_attribution,true)
  on conflict(case_id) do update set attribution=excluded.attribution, advertising_allowed=true,consent_updated_at=statement_timestamp();
end $$;
revoke all on function public.save_case_acquisition(uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_case_acquisition(uuid,jsonb,boolean) to authenticated;

create function public.record_case_measurement(p_case_id uuid,p_event_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.appraisal_cases where id=p_case_id and user_id=auth.uid() and service_type='total_loss') then
    raise exception 'Case unavailable' using errcode='42501';
  end if;
  if p_event_name not in ('review_started','valuation_report_uploaded','review_eligible','checkout_started') or p_event_name is null then
    raise exception 'Invalid event' using errcode='22023';
  end if;
  insert into public.case_measurement_events(case_id,event_name) values(p_case_id,p_event_name) on conflict do nothing;
end $$;
revoke all on function public.record_case_measurement(uuid,text) from public,anon;
grant execute on function public.record_case_measurement(uuid,text) to authenticated;

-- One event per immutable financial movement, even if the browser never returns.
-- No trigger or new write participates in payment or refund processing.
create view public.financial_measurement_events as
select t.id as event_id,t.case_id,t.order_id as transaction_id,
  case when t.transaction_kind='payment' then 'purchase_completed' else 'refund_issued' end as event_name,
  t.provider_occurred_at as occurred_at,t.amount_minor_units,t.currency,a.attribution,a.advertising_allowed,
  o.provider_livemode
from public.payment_transactions t
join public.commerce_orders o on o.id=t.order_id
left join public.case_acquisition a on a.case_id=t.case_id
where t.payment_provider='stripe' and t.currency='USD' and (
  t.transaction_kind='payment' or (t.transaction_kind='refund' and exists(
    select 1 from public.commerce_refund_requests r where r.refund_transaction_id=t.id and r.status='succeeded' and r.refund_reversal_transaction_id is null
  ))
);
revoke all on public.financial_measurement_events from public,anon,authenticated;
grant select on public.financial_measurement_events,public.case_acquisition,public.case_measurement_events to service_role;

create function public.get_case_measurement(p_case_id uuid,p_include_email boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.appraisal_cases where id=p_case_id and user_id=auth.uid() and service_type='total_loss') then
    raise exception 'Case unavailable' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'event_id',e.event_id,'event_name',e.event_name,'timestamp',e.occurred_at,
    'transaction_id',e.transaction_id,'value',e.amount_minor_units::numeric/100,'currency',e.currency,
    'live',e.provider_livemode,'attribution',e.attribution,
    'email',case when p_include_email and e.advertising_allowed and e.event_name='purchase_completed' then o.purchaser_email else null end
  ) order by e.occurred_at,e.event_id) from public.financial_measurement_events e
  join public.commerce_orders o on o.id=e.transaction_id
  where e.case_id=p_case_id and o.purchaser_user_id=auth.uid()),'[]'::jsonb);
end $$;
revoke all on function public.get_case_measurement(uuid,boolean) from public,anon;
grant execute on function public.get_case_measurement(uuid,boolean) to authenticated;
