begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(23);
select is((select count(*)::integer from jurisdiction_private.release_role_violations()),0,'verified platform creator memberships pass without removal');
select is((select count(*)::integer from pg_auth_members a
 join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor
 where r.rolname in ('jurisdiction_publisher','jurisdiction_attestor') and m.rolname='postgres'
 and g.rolname='supabase_admin' and a.admin_option and not a.inherit_option and not a.set_option),2,'both roles retain exact PostgreSQL creator administration');
select ok(not exists(select 1 from pg_roles r cross join (values ('jurisdiction_publisher'),('jurisdiction_attestor')) target(name)
 where r.rolname in ('anon','authenticated','authenticator','service_role','supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','supabase_functions_admin')
 and (pg_has_role(r.oid,target.name,'MEMBER') or pg_has_role(r.oid,target.name,'SET') or pg_has_role(r.oid,target.name,'USAGE'))),'application and managed runtime roles have no restricted membership, set, or inherited access');
select ok(not exists(select 1 from pg_roles r where r.rolname not in ('postgres','supabase_admin','jurisdiction_publisher')
 and has_function_privilege(r.oid,'public.publish_jurisdiction_authority(text,text,jsonb)','EXECUTE')),'publisher execution is confined to its role and infrastructure owners');
select ok(not exists(select 1 from pg_roles r where r.rolname not in ('postgres','supabase_admin','jurisdiction_attestor')
 and has_function_privilege(r.oid,'public.publish_jurisdiction_attestation(text,text)','EXECUTE')),'attestation execution is confined to its role and infrastructure owners');
select ok(not exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','authenticator','service_role','supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','supabase_functions_admin','jurisdiction_publisher','jurisdiction_attestor')
 and (has_table_privilege(r.oid,'jurisdiction_private.review_keys','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 or has_table_privilege(r.oid,'public.jurisdiction_authority_config','INSERT,UPDATE,DELETE,TRUNCATE')
 or has_schema_privilege(r.oid,'jurisdiction_private','CREATE,USAGE'))),'runtime and publisher roles cannot read or provision review keys or change trust configuration');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'jurisdiction_%_internal' or p.proname in ('publish_jurisdiction_authority','publish_jurisdiction_attestation','accept_jurisdiction_document'))
 and (p.proowner<>'postgres'::regrole or not coalesce(p.proconfig @> array['search_path=""'],false))),'authority routines retain trusted ownership and empty search paths');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='jurisdiction_private' or n.nspname='public' and c.relname in ('jurisdiction_authority_config','jurisdiction_authority_publications','jurisdiction_attestations','jurisdiction_document_acceptances'))
 and c.relkind='r' and (not c.relrowsecurity or c.relowner<>'postgres'::regrole)),'authority tables retain RLS and database-owner ownership');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 where (n.nspname='jurisdiction_private' or n.nspname='public' and c.relname in ('jurisdiction_authority_config','jurisdiction_authority_publications','jurisdiction_attestations','jurisdiction_document_acceptances'))
 and c.relkind='r' and a.grantee<>c.relowner),'no unexpected direct table grants, including PUBLIC or future ordinary roles');
select ok(not exists(select 1 from pg_namespace n
 cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
 where n.nspname='jurisdiction_private' and a.grantee<>n.nspowner),'private schema has no non-owner grants');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where n.nspname='public' and p.proname like 'jurisdiction_%_internal' and a.grantee<>p.proowner),'internal authority routines cannot be called through an unexpected grant');
grant jurisdiction_publisher to service_role with set true, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'service-role direct publisher SET path fails');
revoke jurisdiction_publisher from service_role;
grant jurisdiction_attestor to authenticated with set true, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'authenticated direct attestor SET path fails');
revoke jurisdiction_attestor from authenticated;
grant jurisdiction_publisher to authenticated with admin true, set false, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'authenticated ADMIN without SET or INHERIT fails');
revoke jurisdiction_publisher from authenticated;
grant jurisdiction_attestor to service_role with admin true, set false, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'service-role ADMIN without SET or INHERIT fails');
revoke jurisdiction_attestor from service_role;
create role release_ordinary_login login;
create role release_intermediate nologin;
grant jurisdiction_publisher to release_ordinary_login with set true, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'ordinary login direct publisher membership fails');
revoke jurisdiction_publisher from release_ordinary_login;
grant jurisdiction_attestor to release_intermediate with admin true, set false, inherit false;
grant release_intermediate to release_ordinary_login with set true;
select ok(exists(select 1 from jurisdiction_private.release_role_violations() where violation like '%release_ordinary_login%'),'transitive ordinary login administration fails');
grant release_intermediate to service_role with set true;
select ok(exists(select 1 from jurisdiction_private.release_role_violations() where violation like '%service_role%'),'transitive application administration fails');
revoke release_intermediate from service_role,release_ordinary_login;
revoke jurisdiction_attestor from release_intermediate;
grant jurisdiction_publisher to anon with set false, inherit true;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'inherited application execution without SET fails');
revoke jurisdiction_publisher from anon;
grant jurisdiction_attestor to authenticator with set false, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'even dormant unexpected API membership fails');
revoke jurisdiction_attestor from authenticator;
create role release_ordinary_creator login createrole;
grant jurisdiction_publisher to release_ordinary_creator with admin true, set false, inherit false;
select ok(exists(select 1 from jurisdiction_private.release_role_violations()),'CREATEROLE does not exempt an administrative path');
revoke jurisdiction_publisher from release_ordinary_creator;
select ok(not has_function_privilege('service_role','jurisdiction_private.release_role_violations()','EXECUTE'),'application cannot execute the release audit');
select is((select count(*)::integer from jurisdiction_private.release_role_violations()),0,'removing negative fixtures restores exact platform boundary');
select * from finish();
rollback;
