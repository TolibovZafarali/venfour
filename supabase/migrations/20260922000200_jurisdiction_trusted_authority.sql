-- Empty, restricted authority infrastructure. No enrollment or operating approval.
create extension if not exists pg_jsonschema with schema extensions;
create schema jurisdiction_private;
revoke all on schema jurisdiction_private from public,anon,authenticated,service_role;
create role jurisdiction_publisher nologin noinherit;
create role jurisdiction_attestor nologin noinherit;

-- PostgreSQL gives a non-superuser role creator ADMIN TRUE, SET FALSE,
-- INHERIT FALSE membership, granted by the bootstrap superuser. Preserve that
-- platform administration; reject every other path, including paths through
-- the database owner. This is a dormant-release audit, not enrollment policy.
create function jurisdiction_private.release_role_violations() returns table(violation text)
language sql stable set search_path='' as $$
 with recursive edges as (
  select a.*,r.rolname role_name,m.rolname member_name,g.rolname grantor_name
  from pg_catalog.pg_auth_members a
  join pg_catalog.pg_roles r on r.oid=a.roleid
  join pg_catalog.pg_roles m on m.oid=a.member
  join pg_catalog.pg_roles g on g.oid=a.grantor
 ), protected(oid,path) as (
  select oid,array[oid] from pg_catalog.pg_roles
  where rolname in ('jurisdiction_publisher','jurisdiction_attestor','postgres','supabase_admin','cli_login_postgres')
  union all
  select e.member,p.path||e.member from protected p join edges e on e.roleid=p.oid
  where not e.member=any(p.path)
 ), accepted_edges as (
  select * from edges where grantor_name='supabase_admin' and (
   (role_name in ('jurisdiction_publisher','jurisdiction_attestor')
    and member_name='postgres' and admin_option and not inherit_option and not set_option)
   or (role_name='postgres' and member_name='cli_login_postgres'
    and not admin_option and not inherit_option and set_option))
 )
 select distinct 'unexpected membership: '||e.role_name||' <- '||e.member_name
  ||' granted by '||e.grantor_name||' admin='||e.admin_option
  ||' inherit='||e.inherit_option||' set='||e.set_option
 from protected p join edges e on e.roleid=p.oid
 where not exists(select 1 from accepted_edges a where a.oid=e.oid)
 union all
 select 'unexpected superuser: '||rolname from pg_catalog.pg_roles
 where rolsuper and not (rolname='supabase_admin' and oid=10)
 union all
 select 'invalid restricted role: '||name
 from (values ('jurisdiction_publisher'),('jurisdiction_attestor')) required(name)
 left join pg_catalog.pg_roles r on r.rolname=required.name
 where r.oid is null or r.rolcanlogin or r.rolsuper or r.rolcreaterole
  or r.rolcreatedb or r.rolbypassrls or r.rolinherit or r.rolreplication
 union all
 select 'invalid database administrator: postgres' where not exists(
  select 1 from pg_catalog.pg_roles r join pg_catalog.pg_class c on c.relowner=r.oid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where r.rolname='postgres' and r.rolcanlogin and not r.rolsuper
   and r.rolcreaterole and r.rolcreatedb and r.rolbypassrls and r.rolinherit
   and n.nspname='public' and c.relname='appraisal_cases')
 union all
 select 'invalid platform administrator: supabase_admin' where not exists(
  select 1 from pg_catalog.pg_roles where oid=10 and rolname='supabase_admin'
   and rolsuper and rolcanlogin and rolcreaterole and rolcreatedb and rolbypassrls)
 union all
 select 'invalid temporary administrative login: cli_login_postgres'
 from pg_catalog.pg_roles r where r.rolname='cli_login_postgres' and (
  r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolbypassrls or r.rolinherit
  or r.rolreplication or r.rolvaliduntil is null
  or r.rolvaliduntil>current_timestamp+interval '1 hour'
  or not exists(select 1 from accepted_edges e where e.member=r.oid and e.role_name='postgres'))
$$;
revoke all on function jurisdiction_private.release_role_violations() from public,anon,authenticated,service_role;
do $$ declare failures text; begin
 select string_agg(violation,E'\n' order by violation) into failures
 from jurisdiction_private.release_role_violations();
 if failures is not null then raise exception 'Unsafe jurisdiction release role graph: %',failures; end if;
end $$;

create table jurisdiction_private.review_keys (
  key_id text primary key,
  secret bytea not null check(octet_length(secret)>=32),
  key_digest text generated always as (encode(extensions.digest(secret,'sha256'),'hex')) stored unique,
  created_at timestamptz not null default clock_timestamp()
);
create table public.jurisdiction_authority_config (
  revision bigint primary key check(revision>=0),
  canonical_json text not null,
  digest text generated always as (encode(extensions.digest(canonical_json,'sha256'),'hex')) stored,
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null default session_user
);
create table public.jurisdiction_authority_publications (
  epoch bigint primary key references public.jurisdiction_delivery_authority(revision) deferrable initially deferred,
  request_id uuid not null unique,
  canonical_json text not null,
  artifact_digest text not null unique check(artifact_digest ~ '^[0-9a-f]{64}$'),
  signatures jsonb not null,
  publisher text not null,
  published_at timestamptz not null default clock_timestamp(),
  result jsonb not null
);
create table public.jurisdiction_attestations (
  sequence bigint generated always as identity primary key,
  kind text not null check(kind in ('credential','document')),
  id text not null,
  revision bigint not null check(revision>0),
  request_id uuid not null unique,
  canonical_json text not null,
  signature text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(kind,id,revision)
);
create table public.jurisdiction_document_acceptances (
  sequence bigint generated always as identity primary key,
  request_id uuid not null unique,
  customer_id uuid not null references auth.users(id),
  case_id uuid not null references public.appraisal_cases(id),
  order_id uuid not null references public.commerce_orders(id),
  document_sequence bigint not null references public.jurisdiction_attestations(sequence),
  accepted_at timestamptz not null default clock_timestamp(),
  auth_role text not null,
  auth_session_id text not null
);
do $$ declare t text; begin
 foreach t in array array['jurisdiction_authority_config','jurisdiction_authority_publications','jurisdiction_attestations','jurisdiction_document_acceptances'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role,jurisdiction_publisher,jurisdiction_attestor',t);
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_jurisdiction_history_update()',t||'_immutable',t);
 end loop;
end $$;
revoke all on jurisdiction_private.review_keys from public,anon,authenticated,service_role,jurisdiction_publisher,jurisdiction_attestor;
alter table jurisdiction_private.review_keys enable row level security;
create trigger jurisdiction_keys_immutable before update or delete on jurisdiction_private.review_keys
 for each row execute function public.prevent_jurisdiction_history_update();

-- Match the offline UTF-8 canonical serializer; whitespace/key-order variants
-- cannot enter the publication log as a different compiled artifact.
create function public.jurisdiction_canonical_internal(value jsonb) returns text
language plpgsql immutable set search_path='' as $$ declare result text; begin
 case jsonb_typeof(value)
 when 'object' then
  select '{'||coalesce(string_agg(to_json(e.key)::text||':'||public.jurisdiction_canonical_internal(e.value),',' order by e.key collate "C"),'')||'}'
   into result from jsonb_each(value) e;
 when 'array' then
  select '['||coalesce(string_agg(public.jurisdiction_canonical_internal(e.value),',' order by e.ordinality),'')||']'
   into result from jsonb_array_elements(value) with ordinality e;
 else result:=value::text;
 end case;
 return result;
end $$;

create function public.jurisdiction_hold_all_internal(reason text) returns void
language plpgsql security definer set search_path='' as $$ declare c record; begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 for c in select case_id from public.jurisdiction_delivery_cases where state='released' loop
  perform public.jurisdiction_delivery_hold_internal(c.case_id,array[reason]);
 end loop;
end $$;
create function public.jurisdiction_config_schema_internal() returns json language sql immutable set search_path='' as $schema$ select $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"schema_version":{"enum":["2"]},"revision":{"type":"integer","minimum":0},"authorized_reviewers":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"key_id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"key_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},"valid_from":{"type":"string","format":"date-time","pattern":"Z$"},"valid_until":{"type":"string","format":"date-time","pattern":"Z$"}},"required":["id","key_id","key_digest","valid_from","valid_until"],"additionalProperties":false},"uniqueItems":true},"attestation_writers":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"key_id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"key_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},"valid_from":{"type":"string","format":"date-time","pattern":"Z$"},"valid_until":{"type":"string","format":"date-time","pattern":"Z$"}},"required":["id","key_id","key_digest","valid_from","valid_until"],"additionalProperties":false},"uniqueItems":true},"publishers":{"type":"array","items":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"uniqueItems":true}},"required":["schema_version","revision","authorized_reviewers","attestation_writers","publishers"],"additionalProperties":false}$json$::json; $schema$;
create function public.jurisdiction_config_validate_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg jsonb:=new.canonical_json::jsonb; item jsonb; ids text[]:='{}'; keys text[]:='{}';
begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 if extensions.jsonb_matches_schema(public.jurisdiction_config_schema_internal(),cfg) is not true or new.canonical_json<>public.jurisdiction_canonical_internal(cfg) then raise exception 'Invalid authority configuration schema'; end if;
 if new.revision<>coalesce((select max(revision)+1 from public.jurisdiction_authority_config),0)
  or cfg->>'schema_version'<>'2' or (cfg->>'revision')::bigint<>new.revision
  or jsonb_typeof(cfg->'authorized_reviewers')<>'array' or jsonb_typeof(cfg->'attestation_writers')<>'array'
  or jsonb_typeof(cfg->'publishers')<>'array' or (select count(*) from jsonb_object_keys(cfg))<>5 then
  raise exception 'Invalid authority configuration';
 end if;
 for item in select value from jsonb_array_elements((cfg->'authorized_reviewers')||(cfg->'attestation_writers')) loop
  if item->>'id'=any(ids) or item->>'key_id'=any(keys) or nullif(item->>'id','') is null
   or not (item->>'valid_until')::timestamptz>(item->>'valid_from')::timestamptz
   or not exists(select 1 from jurisdiction_private.review_keys k where k.key_id=item->>'key_id' and k.key_digest=item->>'key_digest') then
   raise exception 'Invalid independent authority identity';
  end if;
  ids:=array_append(ids,item->>'id'); keys:=array_append(keys,item->>'key_id');
 end loop;
 perform public.jurisdiction_hold_all_internal('REVIEWER_AUTHORITY_CHANGED');
 return new;
end $$;
create trigger jurisdiction_config_validate before insert on public.jurisdiction_authority_config
 for each row execute function public.jurisdiction_config_validate_internal();

create function public.jurisdiction_authority_schema_internal() returns json
language sql immutable set search_path='' as $schema$ select $json${"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:venfour:reviewed-authority:1","type":"object","properties":{"schema_version":{"enum":["reviewed-authority-1"]},"revision":{"type":"integer","minimum":1},"previous_epoch":{"type":"integer","minimum":0},"previous_digest":{"anyOf":[{"type":"string","pattern":"^[0-9a-f]{64}$"},{"type":"null"}]},"reviewer_revision":{"type":"integer","minimum":1},"reviewer_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},"prepared_at":{"type":"string","format":"date-time","pattern":"Z$"},"request_id":{"type":"string","format":"uuid"},"publisher":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"release":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"operation":{"enum":["publish","revoke"]},"reviews":{"type":"array","items":{"type":"object","properties":{"reviewer":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"approved_at":{"type":"string","format":"date-time","pattern":"Z$"},"evidence":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["reviewer","approved_at","evidence"],"additionalProperties":false},"minItems":2,"maxItems":2,"uniqueItems":true},"rules":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"version":{"type":"integer","minimum":1},"jurisdictions":{"type":"array","items":{"enum":["AK","AL","AR","AZ","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"]},"minItems":1,"uniqueItems":true},"capability":{"enum":["case_specific_preview","customer_reconsideration_draft","insurer_response_coaching","market_evidence_report","personalized_valuation","referral_compensation","referral_marketing"]},"claim_type":{"enum":["first_party","third_party"]},"policy_use":{"enum":["commercial","personal"]},"provider_role":{"enum":["appraiser","expert","licensed_adjuster","referral_partner","umpire","valuation_service"]},"required_facts":{"type":"array","items":{"enum":["assigned_credential_ref","claim_type","customer_residence","garaging_at_loss","loss_date","loss_location","policy_delivered","policy_end","policy_issued","policy_start","policy_use","provider_location","provider_role","settlement_date","vehicle_registration"]},"uniqueItems":true},"conditions":{"type":"array","items":{"type":"object","properties":{"field":{"enum":["assigned_credential_ref","claim_type","customer_residence","garaging_at_loss","loss_date","loss_location","policy_delivered","policy_end","policy_issued","policy_start","policy_use","provider_location","provider_role","settlement_date","vehicle_registration"]},"equals":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["field","equals"],"additionalProperties":false},"uniqueItems":true},"determination":{"enum":["permitted","limited","prohibited","not_applicable","unresolved"]},"limitations":{"type":"array","items":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"maxItems":0},"credential_policy":{"enum":["required","reviewed_not_required"]},"credentials":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"type":{"enum":["company_license","individual_license","provider_relationship","entity_registration"]},"jurisdiction":{"enum":["AK","AL","AR","AZ","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"]},"holder":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"provider":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"}},"required":["id","type","jurisdiction","holder","provider"],"additionalProperties":false},"uniqueItems":true},"terms_policy":{"enum":["required","reviewed_not_required"]},"documents":{"type":"array","items":{"type":"object","properties":{"type":{"enum":["terms","privacy","refund","scope","jurisdiction_disclosure"]},"version":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"digest":{"type":"string","pattern":"^[0-9a-f]{64}$"}},"required":["type","version","digest"],"additionalProperties":false},"uniqueItems":true},"date_anchor":{"enum":["service_date","loss_date","policy_end","policy_start","settlement_date"]},"effective_from":{"type":"string","format":"date","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},"effective_until":{"anyOf":[{"type":"string","format":"date","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},{"type":"null"}]},"review_due_at":{"type":"string","format":"date-time","pattern":"Z$"},"revocation":{"anyOf":[{"type":"object","properties":{"at":{"type":"string","format":"date-time","pattern":"Z$"},"by":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"reference":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["at","by","reference"],"additionalProperties":false},{"type":"null"}]},"sources":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"kind":{"enum":["primary"]},"url":{"type":"string","format":"uri","pattern":"^https://"},"locator":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"document_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},"retained_evidence":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["id","kind","url","locator","document_digest","retained_evidence"],"additionalProperties":false},"minItems":1,"uniqueItems":true},"reviews":{"type":"array","items":{"type":"object","properties":{"reviewer":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"approved_at":{"type":"string","format":"date-time","pattern":"Z$"},"evidence":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["reviewer","approved_at","evidence"],"additionalProperties":false},"minItems":2,"maxItems":2,"uniqueItems":true}},"required":["id","version","jurisdictions","capability","claim_type","policy_use","provider_role","required_facts","conditions","determination","limitations","credential_policy","credentials","terms_policy","documents","date_anchor","effective_from","effective_until","review_due_at","revocation","sources","reviews"],"additionalProperties":false},"minItems":1,"maxItems":512}},"required":["schema_version","revision","previous_epoch","previous_digest","reviewer_revision","reviewer_digest","prepared_at","request_id","publisher","release","operation","reviews","rules"],"additionalProperties":false}$json$::json; $schema$;

create function public.jurisdiction_attestation_schema_internal() returns json
language sql immutable set search_path='' as $schema$ select $json${"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:venfour:authority-attestation:1","oneOf":[{"type":"object","properties":{"schema_version":{"enum":["authority-attestation-1"]},"revision":{"type":"integer","minimum":1},"config_revision":{"type":"integer","minimum":1},"writer":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"request_id":{"type":"string","format":"uuid"},"kind":{"enum":["credential"]},"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"type":{"enum":["company_license","individual_license","provider_relationship","entity_registration"]},"jurisdiction":{"enum":["AK","AL","AR","AZ","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"]},"holder":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"provider":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"capabilities":{"type":"array","items":{"enum":["case_specific_preview","customer_reconsideration_draft","insurer_response_coaching","market_evidence_report","personalized_valuation","referral_compensation","referral_marketing"]},"minItems":1,"uniqueItems":true},"identifier_reference":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"issuing_authority":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"valid_from":{"type":"string","format":"date-time","pattern":"Z$"},"expires_at":{"type":"string","format":"date-time","pattern":"Z$"},"verified_at":{"type":"string","format":"date-time","pattern":"Z$"},"evidence":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"status":{"enum":["verified","revoked","suspended"]},"status_reference":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"}},"required":["schema_version","revision","config_revision","writer","request_id","kind","id","type","jurisdiction","holder","provider","capabilities","identifier_reference","issuing_authority","valid_from","expires_at","verified_at","evidence","status","status_reference"],"additionalProperties":false},{"type":"object","properties":{"schema_version":{"enum":["authority-attestation-1"]},"revision":{"type":"integer","minimum":1},"config_revision":{"type":"integer","minimum":1},"writer":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"request_id":{"type":"string","format":"uuid"},"kind":{"enum":["document"]},"id":{"enum":["terms","privacy","refund","scope","jurisdiction_disclosure"]},"type":{"enum":["terms","privacy","refund","scope","jurisdiction_disclosure"]},"version":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},"digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},"status":{"enum":["current","withdrawn"]},"evidence":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\x00-\\x1f]+$"},"verified_at":{"type":"string","format":"date-time","pattern":"Z$"}},"required":["schema_version","revision","config_revision","writer","request_id","kind","id","type","version","digest","status","evidence","verified_at"],"additionalProperties":false}]}$json$::json; $schema$;

create function public.jurisdiction_validate_reviews_internal(reviews jsonb, cfg jsonb, at_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; identity jsonb; begin
 if jsonb_array_length(reviews)<>2 or reviews->0->>'reviewer'=reviews->1->>'reviewer' then raise exception 'Two independent reviews required'; end if;
 for r in select value from jsonb_array_elements(reviews) loop
  select value into identity from jsonb_array_elements(cfg->'authorized_reviewers') where value->>'id'=r->>'reviewer';
  if (identity is not null and (identity->>'valid_from')::timestamptz<=(r->>'approved_at')::timestamptz
    and (r->>'approved_at')::timestamptz<=at_time and at_time<(identity->>'valid_until')::timestamptz) is not true then
   raise exception 'Reviewer authority unavailable';
  end if;
 end loop;
end $$;
create function public.jurisdiction_publication_validate_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb:=new.canonical_json::jsonb; cfg public.jurisdiction_authority_config;
 head public.jurisdiction_delivery_authority; old jsonb; r jsonb; other jsonb; review jsonb; identity jsonb;
 signature jsonb; key_secret bytea; now_at timestamptz:=clock_timestamp(); expected text;
begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 select * into cfg from public.jurisdiction_authority_config order by revision desc limit 1;
 select * into head from public.jurisdiction_delivery_authority order by revision desc limit 1;
 if extensions.jsonb_matches_schema(public.jurisdiction_authority_schema_internal(),a) is not true or new.canonical_json<>public.jurisdiction_canonical_internal(a) then raise exception 'Invalid reviewed artifact schema'; end if;
 if (new.publisher=session_user and new.publisher=a->>'publisher'
   and pg_has_role(session_user,'jurisdiction_publisher','member')
   and cfg.canonical_json::jsonb->'publishers' ? session_user::text) is not true then raise exception using errcode='42501',message='Restricted publication identity required'; end if;
 if (new.epoch=coalesce(head.revision,0)+1 and (a->>'revision')::bigint=new.epoch
   and (a->>'previous_epoch')::bigint=coalesce(head.revision,0)
   and (a->>'previous_digest') is not distinct from head.registry_digest
   and (a->>'reviewer_revision')::bigint=cfg.revision and a->>'reviewer_digest'=cfg.digest) is not true then
  raise exception using errcode='40001',message='Stale authority or reviewer configuration';
 end if;
 if new.artifact_digest<>encode(extensions.digest(new.canonical_json,'sha256'),'hex')
  or new.request_id<>(a->>'request_id')::uuid or (a->>'prepared_at')::timestamptz>now_at
  or jsonb_typeof(new.signatures)<>'array' or jsonb_array_length(new.signatures)<>2 then raise exception 'Invalid artifact digest or envelope'; end if;
 perform public.jurisdiction_validate_reviews_internal(a->'reviews',cfg.canonical_json::jsonb,now_at);
 for review in select value from jsonb_array_elements(a->'reviews') loop
  select value into identity from jsonb_array_elements(cfg.canonical_json::jsonb->'authorized_reviewers') where value->>'id'=review->>'reviewer';
  select value into signature from jsonb_array_elements(new.signatures) where value->>'reviewer'=review->>'reviewer';
  select secret into key_secret from jurisdiction_private.review_keys where key_id=identity->>'key_id';
  expected:=encode(extensions.hmac(convert_to('venfour-authority-v1'||chr(10)||new.canonical_json,'UTF8'),key_secret,'sha256'),'hex');
  if (signature->>'signature'=expected) is not true then raise exception using errcode='42501',message='Independent review signature required'; end if;
 end loop;
 for r in select value from jsonb_array_elements(a->'rules') loop
  perform public.jurisdiction_validate_reviews_internal(r->'reviews',cfg.canonical_json::jsonb,now_at);
  if (select array_agg(value->>'reviewer' order by value->>'reviewer') from jsonb_array_elements(r->'reviews'))
     is distinct from (select array_agg(value->>'reviewer' order by value->>'reviewer') from jsonb_array_elements(a->'reviews'))
   or exists(select 1 from jsonb_array_elements((a->'reviews')||(r->'reviews')) v where (v->>'approved_at')::timestamptz>(a->>'prepared_at')::timestamptz)
   or (r->>'review_due_at')::timestamptz<=now_at
   or (r->>'date_anchor'='service_date' and (r->>'effective_from')::date>=((r->>'review_due_at')::timestamptz at time zone 'UTC')::date)
   or (r->>'effective_until' is not null and (r->>'effective_until')::date<=(r->>'effective_from')::date)
   or ((r->>'credential_policy'='required')<>(jsonb_array_length(r->'credentials')>0))
   or ((r->>'terms_policy'='required')<>(jsonb_array_length(r->'documents')>0))
   or (r->>'determination'='limited' and jsonb_array_length((r->'conditions')||(r->'credentials')||(r->'documents'))=0)
   or (select count(*)<>count(distinct value->>'type') from jsonb_array_elements(r->'documents'))
   or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(r->'credentials')) then raise exception 'Invalid reviewed rule requirements or dates'; end if;
  if r->'revocation'<>'null'::jsonb and (
    not exists(select 1 from jsonb_array_elements(a->'reviews') v where v->>'reviewer'=r->'revocation'->>'by')
    or (r->'revocation'->>'at')::timestamptz>(a->>'prepared_at')::timestamptz
    or exists(select 1 from jsonb_array_elements(r->'reviews') v where (v->>'approved_at')::timestamptz>(r->'revocation'->>'at')::timestamptz)) then raise exception 'Invalid revocation'; end if;
  for other in select value from jsonb_array_elements(a->'rules') where value->>'id'<>r->>'id' loop
   if other->>'capability'=r->>'capability' and other->>'claim_type'=r->>'claim_type'
    and other->>'policy_use'=r->>'policy_use' and other->>'provider_role'=r->>'provider_role'
    and (other->'jurisdictions') @> (r->'jurisdictions') and (r->'jurisdictions') @> (other->'jurisdictions')
    and (other->>'date_anchor'<>r->>'date_anchor' or
     greatest(other->>'effective_from',r->>'effective_from')<least(coalesce(other->>'effective_until','9999-12-31'),coalesce(r->>'effective_until','9999-12-31'))) then raise exception 'Overlapping rules'; end if;
  end loop;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(a->'rules')) then raise exception 'Duplicate rule identity'; end if;
 if a->>'operation'='revoke' and not exists(select 1 from jsonb_array_elements(a->'rules') rule_value where rule_value->'revocation'<>'null'::jsonb) then raise exception 'Revoked rule required'; end if;
 select canonical_json::jsonb into old from public.jurisdiction_authority_publications where epoch=head.revision;
 for other in select value from jsonb_array_elements(old->'rules') loop
  select value into r from jsonb_array_elements(a->'rules') where value->>'id'=other->>'id';
  if r is null or (r<>other and (r->>'version')::bigint<=(other->>'version')::bigint) then raise exception 'Rule history must be retained with increasing versions'; end if;
 end loop;
 new.published_at:=clock_timestamp();
 new.result:=jsonb_build_object('epoch',new.epoch,'artifact_digest',new.artifact_digest,'request_id',new.request_id,'result','published');
 return new;
end $$;
create trigger jurisdiction_publication_validate before insert on public.jurisdiction_authority_publications
 for each row execute function public.jurisdiction_publication_validate_internal();
create function public.publish_jurisdiction_authority(artifact text, artifact_digest text, signatures jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=artifact::jsonb; prior public.jurisdiction_authority_publications; result jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 select * into prior from public.jurisdiction_authority_publications where request_id=(a->>'request_id')::uuid;
 if found then
  if prior.canonical_json<>artifact or prior.artifact_digest<>artifact_digest or prior.signatures<>signatures or prior.publisher<>session_user then
   raise exception 'Publication request conflict';
  end if;
  return prior.result;
 end if;
 insert into public.jurisdiction_authority_publications(epoch,request_id,canonical_json,artifact_digest,signatures,publisher,result)
 values((a->>'revision')::bigint,(a->>'request_id')::uuid,artifact,artifact_digest,signatures,session_user,'{}') returning jurisdiction_authority_publications.result into result;
 insert into public.jurisdiction_delivery_authority(revision,registry_digest) values((a->>'revision')::bigint,artifact_digest);
 return result;
end $$;
-- Every new epoch must have an authenticated artifact in the same transaction.
create function public.jurisdiction_authority_artifact_required_internal() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.jurisdiction_authority_publications p where p.epoch=new.revision and p.artifact_digest=new.registry_digest) then
  raise exception using errcode='42501',message='Reviewed publication required for authority';
 end if;
 return new;
end $$;
create trigger jurisdiction_authority_artifact_required before insert on public.jurisdiction_delivery_authority
 for each row execute function public.jurisdiction_authority_artifact_required_internal();

create function public.jurisdiction_attestation_validate_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb:=new.canonical_json::jsonb; cfg public.jurisdiction_authority_config; writer jsonb; secret bytea; begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 select * into cfg from public.jurisdiction_authority_config order by revision desc limit 1;
 if extensions.jsonb_matches_schema(public.jurisdiction_attestation_schema_internal(),a) is not true or new.canonical_json<>public.jurisdiction_canonical_internal(a) then raise exception 'Invalid attestation schema'; end if;
 select value into writer from jsonb_array_elements(cfg.canonical_json::jsonb->'attestation_writers') where value->>'id'=a->>'writer';
 if (pg_has_role(session_user,'jurisdiction_attestor','member') and a->>'writer'=session_user
   and (a->>'config_revision')::bigint=cfg.revision and writer is not null
   and (writer->>'valid_from')::timestamptz<=(a->>'verified_at')::timestamptz
   and (a->>'verified_at')::timestamptz<=clock_timestamp()
   and clock_timestamp()<(writer->>'valid_until')::timestamptz) is not true then raise exception using errcode='42501',message='Authorized attestation writer required'; end if;
 select k.secret into secret from jurisdiction_private.review_keys k where key_id=writer->>'key_id';
 if (new.signature=encode(extensions.hmac(convert_to('venfour-attestation-v1'||chr(10)||new.canonical_json,'UTF8'),secret,'sha256'),'hex')) is not true then raise exception 'Invalid attestation signature'; end if;
 if new.kind<>a->>'kind' or new.id<>a->>'id' or new.revision<>(a->>'revision')::bigint or new.request_id<>(a->>'request_id')::uuid
  or new.revision<>coalesce((select max(revision) from public.jurisdiction_attestations where kind=new.kind and id=new.id),0)+1 then raise exception using errcode='40001',message='Stale attestation revision'; end if;
 if (new.kind='credential' and ((a->>'expires_at')::timestamptz<=(a->>'valid_from')::timestamptz
    or (a->>'status'='verified' and (a->>'expires_at')::timestamptz<=clock_timestamp())))
  or (new.kind='document' and a->>'id'<>a->>'type') then raise exception 'Invalid attestation scope or interval'; end if;
 if new.kind='document' and exists(select 1 from public.jurisdiction_attestations d
  where d.kind='document' and d.id=new.id and d.canonical_json::jsonb->>'version'=a->>'version'
   and d.canonical_json::jsonb->>'digest'<>a->>'digest') then raise exception 'Document versions have immutable digests'; end if;
 new.recorded_at:=clock_timestamp();
 perform public.jurisdiction_hold_all_internal('ATTESTATION_CHANGED');
 return new;
end $$;
create trigger jurisdiction_attestation_validate before insert on public.jurisdiction_attestations
 for each row execute function public.jurisdiction_attestation_validate_internal();
create function public.publish_jurisdiction_attestation(artifact text, signature text) returns bigint
language plpgsql security definer set search_path='' as $$
declare a jsonb:=artifact::jsonb; prior public.jurisdiction_attestations; result bigint; begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 select * into prior from public.jurisdiction_attestations where request_id=(a->>'request_id')::uuid;
 if found then
  if prior.canonical_json<>artifact or prior.signature<>signature or a->>'writer'<>session_user then raise exception 'Attestation request conflict'; end if;
  return prior.sequence;
 end if;
 insert into public.jurisdiction_attestations(kind,id,revision,request_id,canonical_json,signature)
 values(a->>'kind',a->>'id',(a->>'revision')::bigint,(a->>'request_id')::uuid,artifact,signature) returning sequence into result;
 return result;
end $$;
create function public.accept_jurisdiction_document(requested_case_id uuid,requested_order_id uuid,
 requested_document_sequence bigint,requested_digest text,requested_request_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare doc public.jurisdiction_attestations; prior public.jurisdiction_document_acceptances; result bigint; begin
 perform pg_catalog.pg_advisory_xact_lock(726104,1);
 if (auth.uid() is not null and auth.role()='authenticated' and nullif(auth.jwt()->>'session_id','') is not null
  and exists(select 1 from auth.users where id=auth.uid() and not coalesce(is_anonymous,true) and email_confirmed_at is not null and deleted_at is null)
  and exists(select 1 from public.appraisal_cases c join public.commerce_orders o on o.case_id=c.id
    where c.id=requested_case_id and c.user_id=auth.uid() and o.id=requested_order_id)) is not true then raise exception using errcode='42501',message='Authenticated case and order owner required'; end if;
 select * into doc from public.jurisdiction_attestations where sequence=requested_document_sequence and kind='document';
 if doc.sequence is null or doc.canonical_json::jsonb->>'digest'<>requested_digest or requested_digest is null then raise exception 'Exact document digest required'; end if;
 select * into prior from public.jurisdiction_document_acceptances where request_id=requested_request_id;
 if found then
  if prior.customer_id<>auth.uid() or prior.case_id<>requested_case_id or prior.order_id<>requested_order_id or prior.document_sequence<>requested_document_sequence then raise exception 'Acceptance request conflict'; end if;
  return prior.sequence;
 end if;
 if doc.canonical_json::jsonb->>'status'<>'current' or exists(select 1 from public.jurisdiction_attestations where kind='document' and id=doc.id and revision>doc.revision) then raise exception 'Document version is no longer current'; end if;
 insert into public.jurisdiction_document_acceptances(request_id,customer_id,case_id,order_id,document_sequence,auth_role,auth_session_id)
 values(requested_request_id,auth.uid(),requested_case_id,requested_order_id,doc.sequence,auth.role(),auth.jwt()->>'session_id') returning sequence into result;
 perform public.jurisdiction_delivery_hold_internal(requested_case_id,array['TERMS_ACCEPTANCE_CHANGED']);
 return result;
end $$;

create function public.jurisdiction_authority_bundle_internal(requested_case_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 with cfg as (select * from public.jurisdiction_authority_config order by revision desc limit 1),
 head as (select * from public.jurisdiction_delivery_authority order by revision desc limit 1),
 latest as (select distinct on (kind,id) * from public.jurisdiction_attestations order by kind,id,revision desc),
 target as (select c.id,c.user_id,d.order_id from public.appraisal_cases c left join public.jurisdiction_delivery_cases d on d.case_id=c.id where c.id=requested_case_id)
 select jsonb_build_object('authority_context',jsonb_build_object('epoch',coalesce((select revision from head),0),
   'registry_digest',(select registry_digest from head),'config_revision',(select revision from cfg),
   'attestation_revision',coalesce((select max(sequence) from public.jurisdiction_attestations),0),
   'acceptance_revision',coalesce((select max(sequence) from public.jurisdiction_document_acceptances where case_id=requested_case_id),0)),
  'artifact',(select canonical_json from public.jurisdiction_authority_publications where epoch=(select revision from head)),
  'config',(select canonical_json::jsonb from cfg),
  'credentials',coalesce((select jsonb_agg(canonical_json::jsonb order by id) from latest where kind='credential'),'[]'),
  'documents',coalesce((select jsonb_agg(canonical_json::jsonb order by id) from latest where kind='document'),'[]'),
  'acceptances',coalesce((select jsonb_agg(jsonb_build_object('customer_id',a.customer_id,'case_id',a.case_id,'order_id',a.order_id,
    'type',d.canonical_json::jsonb->>'type','version',d.canonical_json::jsonb->>'version','digest',d.canonical_json::jsonb->>'digest','accepted_at',a.accepted_at))
    from public.jurisdiction_document_acceptances a join public.jurisdiction_attestations d on d.sequence=a.document_sequence where a.case_id=requested_case_id),'[]'),
  'case_id',requested_case_id,'customer_id',(select user_id from target),'order_id',(select order_id from target));
$$;
create or replace function public.get_paid_delivery_review_context(requested_case_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 perform public.jurisdiction_delivery_lock_internal(requested_case_id);
 return jsonb_build_object('context',public.get_jurisdiction_context(requested_case_id),
  'authority_revision',(select max(revision) from public.jurisdiction_delivery_authority),
  'authority_bundle',public.jurisdiction_authority_bundle_internal(requested_case_id));
end $$;

-- Independently recompute scope and requirements; a service-role snapshot alone
-- cannot manufacture a release. All callers retain existing evidence gates.
create function public.jurisdiction_authority_allows_internal(requested_case_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare bundle jsonb:=public.jurisdiction_authority_bundle_internal(requested_case_id);
 context jsonb:=public.get_jurisdiction_context(requested_case_id); artifact jsonb; facts jsonb; values_by_field jsonb;
 candidates jsonb; r jsonb; cap text; matches jsonb; item jsonb; cred jsonb; doc jsonb; anchor date;
 now_at timestamptz:=clock_timestamp();
begin
 if bundle->>'artifact' is null then return false; end if;
 artifact:=(bundle->>'artifact')::jsonb;
 if (artifact->>'reviewer_revision')::bigint<>(bundle->'config'->>'revision')::bigint
  or artifact->>'reviewer_digest'<>encode(extensions.digest((select canonical_json from public.jurisdiction_authority_config order by revision desc limit 1),'sha256'),'hex') then return false; end if;
 begin
  perform public.jurisdiction_validate_reviews_internal(artifact->'reviews',bundle->'config',now_at);
 exception when others then return false; end;
 facts:=context->'facts'->'assertions';
 if context->>'date_of_loss' is not null then facts:=facts||jsonb_build_array(jsonb_build_object('field','loss_date','value',context->>'date_of_loss')); end if;
 if exists(select 1 from jsonb_array_elements(facts) f where f->>'value' is not null group by f->>'field' having count(distinct f->>'value')>1) then return false; end if;
 select coalesce(jsonb_object_agg(f->>'field',f->>'value'),'{}') into values_by_field from jsonb_array_elements(facts) f where f->>'value' is not null;
 if values_by_field->>'policy_start'>values_by_field->>'policy_end' then return false; end if;
 select coalesce(jsonb_agg(v order by v),'[]') into candidates from (
  select distinct substring(value from 4) v from jsonb_each_text(values_by_field) where key=any(array['customer_residence','garaging_at_loss','vehicle_registration','policy_issued','policy_delivered','loss_location','provider_location'])
 ) q;
 if candidates='[]'::jsonb or exists(select 1 from jsonb_each_text(values_by_field) where key=any(array['customer_residence','garaging_at_loss','vehicle_registration','policy_issued','policy_delivered','loss_location','provider_location']) and value!~'^US-[A-Z]{2}$') then return false; end if;
 foreach cap in array array['market_evidence_report','personalized_valuation','customer_reconsideration_draft','insurer_response_coaching'] loop
  matches:='[]';
  for r in select value from jsonb_array_elements(artifact->'rules') loop
   if r->>'capability'<>cap or not ((r->'jurisdictions') @> candidates and candidates @> (r->'jurisdictions'))
    or (r->>'claim_type'=values_by_field->>'claim_type' and r->>'policy_use'=values_by_field->>'policy_use' and r->>'provider_role'=values_by_field->>'provider_role') is not true then continue; end if;
   anchor:=case when r->>'date_anchor'='service_date' then (now_at at time zone 'UTC')::date else (values_by_field->>(r->>'date_anchor'))::date end;
   if anchor is null then return false; end if;
   if anchor<(r->>'effective_from')::date or (r->>'effective_until' is not null and anchor>=(r->>'effective_until')::date) then continue; end if;
   if r->'revocation'<>'null'::jsonb or (r->>'review_due_at')::timestamptz<=now_at then return false; end if;
   if r->>'determination' not in ('permitted','limited') then return false; end if;
   if exists(select 1 from jsonb_array_elements_text(r->'required_facts') f where values_by_field->>f is null)
    or exists(select 1 from jsonb_array_elements(r->'conditions') c where values_by_field->>(c->>'field') is distinct from c->>'equals') then return false; end if;
   for item in select value from jsonb_array_elements(r->'credentials') loop
    select value into cred from jsonb_array_elements(bundle->'credentials') c where c->>'id'=item->>'id';
    if (cred @> item and cred->>'status'='verified' and cred->'capabilities' ? cap
      and cred->>'id'=values_by_field->>'assigned_credential_ref'
      and cred->>'config_revision'=bundle->'config'->>'revision'
      and (cred->>'valid_from')::timestamptz<=now_at and (cred->>'expires_at')::timestamptz>now_at
      and (cred->>'verified_at')::timestamptz<=now_at) is not true then return false; end if;
   end loop;
   for item in select value from jsonb_array_elements(r->'documents') loop
    select value into doc from jsonb_array_elements(bundle->'documents') d where d->>'type'=item->>'type';
    if (doc @> item and doc->>'status'='current' and doc->>'config_revision'=bundle->'config'->>'revision' and exists(select 1 from jsonb_array_elements(bundle->'acceptances') a
      where a @> item and a->>'case_id'=requested_case_id::text and a->>'order_id'=bundle->>'order_id'
      and a->>'customer_id'=bundle->>'customer_id' and (a->>'accepted_at')::timestamptz<=now_at)) is not true then return false; end if;
   end loop;
   matches:=matches||jsonb_build_array(r);
  end loop;
  if jsonb_array_length(matches)<>1 then return false; end if;
 end loop;
 return true;
end $$;
create or replace function public.jurisdiction_delivery_is_open_internal(requested_case_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select not exists(select 1 from public.jurisdiction_delivery_cases c where c.case_id=requested_case_id
  and (c.state<>'released' or c.valid_until<=clock_timestamp()
   or c.authority_revision is distinct from (select max(revision) from public.jurisdiction_delivery_authority)
   or (select s.snapshot->'delivery_context' from public.jurisdiction_decision_snapshots s where s.id=c.snapshot_id) is distinct from public.get_jurisdiction_context(c.case_id)
   or (select s.snapshot->'authority_context' from public.jurisdiction_decision_snapshots s where s.id=c.snapshot_id) is distinct from public.jurisdiction_authority_bundle_internal(c.case_id)->'authority_context'
   or not public.jurisdiction_authority_allows_internal(c.case_id)));
$$;
-- Add a requirement before the original release branch. Cancellation and refund
-- code are unchanged. This also stops direct service-role recovery bypasses.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('public.resolve_paid_delivery(uuid,uuid,text,uuid,uuid,timestamptz)'::regprocedure);
 needle:='and s.snapshot->''delivery_context''=public.get_jurisdiction_context(c.case_id)';
 if position(needle in definition)=0 then raise exception 'Unexpected recovery contract'; end if;
 definition:=replace(definition,'perform public.jurisdiction_delivery_lock_internal(requested_case_id);','perform public.jurisdiction_delivery_lock_internal(requested_case_id); perform public.check_paid_delivery(requested_case_id);');
 definition:=replace(definition,needle,needle||E'\n      and s.snapshot->''authority_context''=public.jurisdiction_authority_bundle_internal(c.case_id)->''authority_context''\n      and public.jurisdiction_authority_allows_internal(c.case_id)');
 execute definition;
end $$;

-- Empty trust roots: key provisioning and role membership require separate owner
-- administration. Neither app roles nor the new release roles can change them.
insert into public.jurisdiction_authority_config(revision,canonical_json) values(0,
 '{"attestation_writers":[],"authorized_reviewers":[],"publishers":[],"revision":0,"schema_version":"2"}');
do $$ declare f record; begin
 for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'jurisdiction_%_internal' or p.proname in ('publish_jurisdiction_authority','publish_jurisdiction_attestation','accept_jurisdiction_document')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,jurisdiction_publisher,jurisdiction_attestor',f.identity);
 end loop;
end $$;
grant execute on function public.publish_jurisdiction_authority(text,text,jsonb) to jurisdiction_publisher;
grant execute on function public.publish_jurisdiction_attestation(text,text) to jurisdiction_attestor;
grant execute on function public.accept_jurisdiction_document(uuid,uuid,bigint,text,uuid) to authenticated;
