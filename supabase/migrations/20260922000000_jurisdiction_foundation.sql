-- Optional facts and private shadow decisions. No operating permissions or gates.
create function public.jurisdiction_facts_are_valid(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare assertion jsonb; field_name text; fact_value text;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object'
     or not payload ?& array['schema_version','assertions']
     or payload->'schema_version' is distinct from '"1"'::jsonb
     or (select count(*) from jsonb_object_keys(payload)) <> 2
     or jsonb_typeof(payload->'assertions') <> 'array'
     or jsonb_array_length(payload->'assertions') > 128 then return false; end if;
  for assertion in select value from jsonb_array_elements(payload->'assertions') loop
    if jsonb_typeof(assertion) <> 'object'
       or not assertion ?& array['field','value','provenance','reference','recorded_at']
       or (select count(*) from jsonb_object_keys(assertion)) <> 5 then return false; end if;
    field_name := assertion->>'field'; fact_value := assertion->>'value';
    if field_name not in ('customer_residence','garaging_at_loss','vehicle_registration',
        'policy_issued','policy_delivered','loss_location','provider_location',
        'loss_date','policy_start','policy_end','settlement_date','claim_type',
        'policy_use','provider_role','assigned_credential_ref')
       or jsonb_typeof(assertion->'field') <> 'string'
       or assertion->>'provenance' not in ('customer','document','staff','legacy_intake')
       or jsonb_typeof(assertion->'provenance') <> 'string'
       or jsonb_typeof(assertion->'reference') <> 'string'
       or length(assertion->>'reference') not between 1 and 512
       or btrim(assertion->>'reference') <> assertion->>'reference'
       or assertion->>'reference' ~ '[[:cntrl:]]'
       or jsonb_typeof(assertion->'recorded_at') <> 'string'
       or assertion->>'recorded_at' !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$'
       or jsonb_typeof(assertion->'value') not in ('string','null') then return false; end if;
    perform (assertion->>'recorded_at')::timestamptz;
    if fact_value is not null then
      if length(fact_value) not between 1 and 512 or btrim(fact_value) <> fact_value
         or fact_value ~ '[[:cntrl:]]' then return false; end if;
      if field_name in ('loss_date','policy_start','policy_end','settlement_date') then
        if fact_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
        perform fact_value::date;
      end if;
      if (field_name='claim_type' and fact_value not in ('first_party','third_party'))
         or (field_name='policy_use' and fact_value not in ('personal','commercial'))
         or (field_name='provider_role' and fact_value not in
           ('valuation_service','licensed_adjuster','appraiser','umpire','expert','referral_partner')) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.case_jurisdiction_fact_versions (
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  revision bigint not null check (revision > 0),
  facts jsonb not null check (public.jurisdiction_facts_are_valid(facts)),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (case_id, revision)
);
create table public.jurisdiction_decision_snapshots (
  id uuid primary key,
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  facts_revision bigint not null check (facts_revision >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'
    and snapshot->>'schema_version'='1' and public.jurisdiction_facts_are_valid(snapshot->'facts')),
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default statement_timestamp()
);

create function public.prevent_jurisdiction_history_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='55000', message='Jurisdiction history is append-only.';
end;
$$;
create trigger case_jurisdiction_facts_immutable before update on public.case_jurisdiction_fact_versions
for each row execute function public.prevent_jurisdiction_history_update();
create trigger jurisdiction_decisions_immutable before update on public.jurisdiction_decision_snapshots
for each row execute function public.prevent_jurisdiction_history_update();

alter table public.case_jurisdiction_fact_versions enable row level security;
alter table public.jurisdiction_decision_snapshots enable row level security;
revoke all on public.case_jurisdiction_fact_versions, public.jurisdiction_decision_snapshots from public, anon, authenticated, service_role;
grant select on public.case_jurisdiction_fact_versions to authenticated;
create policy jurisdiction_facts_owner_read on public.case_jurisdiction_fact_versions
for select to authenticated using (exists (
  select 1 from public.appraisal_cases c where c.id=case_id and c.user_id=(select auth.uid())
));
-- Operational snapshots contain internal review context; customers cannot write/read them.
grant select on public.case_jurisdiction_fact_versions, public.jurisdiction_decision_snapshots to service_role;

create function public.append_case_jurisdiction_facts(requested_case_id uuid, expected_revision bigint, requested_facts jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; latest_facts jsonb;
begin
  perform 1 from public.appraisal_cases c where c.id=requested_case_id
    and c.user_id=(select auth.uid()) and c.service_type='total_loss' for update;
  if not found then raise exception using errcode='42501', message='Case access required.'; end if;
  if not coalesce(public.jurisdiction_facts_are_valid(requested_facts), false)
     or jsonb_array_length(requested_facts->'assertions') > 64
     or exists(select 1 from jsonb_array_elements(requested_facts->'assertions') a
       where a->>'provenance' not in ('customer','document')) then
    raise exception using errcode='22023', message='Invalid customer jurisdiction facts.';
  end if;
  select revision, facts into current_revision, latest_facts from public.case_jurisdiction_fact_versions
    where case_id=requested_case_id order by revision desc limit 1;
  current_revision := coalesce(current_revision,0);
  if expected_revision is null or expected_revision <> current_revision then
    -- A retry of the identical append does not create another revision.
    if expected_revision=current_revision-1 and latest_facts=requested_facts then return current_revision; end if;
    raise exception using errcode='40001', message='Jurisdiction facts changed.';
  end if;
  if latest_facts=requested_facts then return current_revision; end if;
  insert into public.case_jurisdiction_fact_versions(case_id,revision,facts,recorded_by)
    values(requested_case_id,current_revision+1,requested_facts,(select auth.uid()));
  return current_revision+1;
end;
$$;

create function public.get_jurisdiction_context(requested_case_id uuid, requested_user_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('case_id',c.id,'revision',coalesce(f.revision,0),
    'facts',coalesce(f.facts,'{"schema_version":"1","assertions":[]}'::jsonb),
    'date_of_loss',d.date_of_loss,'intake_updated_at',d.updated_at)
  from public.appraisal_cases c
  left join public.total_loss_case_details d on d.case_id=c.id
  left join lateral (select revision,facts from public.case_jurisdiction_fact_versions
    where case_id=c.id order by revision desc limit 1) f on true
  where c.id=requested_case_id and c.service_type='total_loss'
    and (requested_user_id is null or c.user_id=requested_user_id);
$$;

create function public.get_jurisdiction_reference_case(requested_reference_id uuid, requested_kind text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if requested_kind='work_item' then
    return (select case_id from public.workflow_work_items where id=requested_reference_id);
  elsif requested_kind='release_review' then
    return (select case_id from public.total_loss_release_reviews where id=requested_reference_id);
  end if;
  raise exception using errcode='22023', message='Unknown jurisdiction reference kind.';
end;
$$;

create function public.record_jurisdiction_decision(requested_snapshot jsonb, requested_digest text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_digest text;
begin
  if requested_snapshot->>'schema_version' is distinct from '1'
     or not coalesce(public.jurisdiction_facts_are_valid(requested_snapshot->'facts'),false)
     or jsonb_typeof(requested_snapshot->'proposed_allowed') <> 'boolean'
     or requested_snapshot->>'registry_version' is null then
    raise exception using errcode='22023', message='Invalid jurisdiction decision.';
  end if;
  insert into public.jurisdiction_decision_snapshots(id,case_id,facts_revision,snapshot,content_digest)
    values((requested_snapshot->>'id')::uuid,(requested_snapshot->>'case_id')::uuid,
      (requested_snapshot->>'facts_revision')::bigint,requested_snapshot,requested_digest)
    on conflict (id) do nothing;
  select content_digest into previous_digest from public.jurisdiction_decision_snapshots
    where id=(requested_snapshot->>'id')::uuid;
  if previous_digest is distinct from requested_digest or exists (
    select 1 from public.jurisdiction_decision_snapshots
    where id=(requested_snapshot->>'id')::uuid and snapshot <> requested_snapshot
  ) then raise exception using errcode='22023', message='Decision identity conflict.'; end if;
end;
$$;

revoke all on function public.jurisdiction_facts_are_valid(jsonb), public.prevent_jurisdiction_history_update(),
 public.append_case_jurisdiction_facts(uuid,bigint,jsonb), public.get_jurisdiction_context(uuid,uuid),
 public.get_jurisdiction_reference_case(uuid,text), public.record_jurisdiction_decision(jsonb,text)
 from public, anon, authenticated, service_role;
grant execute on function public.jurisdiction_facts_are_valid(jsonb) to authenticated, service_role;
grant execute on function public.append_case_jurisdiction_facts(uuid,bigint,jsonb) to authenticated;
grant execute on function public.get_jurisdiction_context(uuid,uuid), public.get_jurisdiction_reference_case(uuid,text),
 public.record_jurisdiction_decision(jsonb,text) to service_role;
