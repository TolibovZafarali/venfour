begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(35);

select ok(public.jurisdiction_facts_are_valid('{"schema_version":"1","assertions":[]}'), 'empty facts explicitly represent unknown');
select ok(not public.jurisdiction_facts_are_valid('{}'), 'missing envelope rejected');
select ok(not public.jurisdiction_facts_are_valid(null), 'SQL null rejected');
select ok(not public.jurisdiction_facts_are_valid('{"schema_version":1,"assertions":[]}'), 'schema version is typed');
select ok(not public.jurisdiction_facts_are_valid('{"schema_version":"1","assertions":[],"approved":true}'), 'facts cannot carry permissions');
select ok(not has_table_privilege('anon','public.case_jurisdiction_fact_versions','SELECT'), 'signed-out access denied');
select ok(not has_table_privilege('authenticated','public.case_jurisdiction_fact_versions','INSERT'), 'direct customer insertion denied');
select ok(not has_function_privilege('authenticated','public.record_jurisdiction_decision(jsonb,text)','EXECUTE'), 'customer cannot forge decision snapshots');
select ok(not has_function_privilege('authenticated','public.get_jurisdiction_context(uuid,uuid)','EXECUTE'), 'internal context is service only');
select ok(not has_table_privilege('authenticated','public.jurisdiction_decision_snapshots','SELECT'), 'internal decisions private');
select ok(not has_table_privilege('service_role','public.jurisdiction_decision_snapshots','DELETE'), 'ordinary worker cannot erase snapshots');

insert into auth.users(id,email,is_anonymous,email_confirmed_at) values
 ('56111111-1111-4111-8111-111111111111','scope-owner@example.test',false,statement_timestamp()),
 ('56222222-2222-4222-8222-222222222222',null,true,null);
insert into public.appraisal_cases(id,user_id,service_type,status) values
 ('56a11111-1111-4111-8111-111111111111','56111111-1111-4111-8111-111111111111','total_loss','draft'),
 ('56a22222-2222-4222-8222-222222222222','56222222-2222-4222-8222-222222222222','total_loss','draft');

set local role authenticated;
select set_config('request.jwt.claim.sub','56111111-1111-4111-8111-111111111111',true);
select is(public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',0,'{"schema_version":"1","assertions":[]}'),1::bigint,'owner appends optional facts');
select is(public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',0,'{"schema_version":"1","assertions":[]}'),1::bigint,'retry reuses same revision');
select throws_ok($$select public.append_case_jurisdiction_facts('56a22222-2222-4222-8222-222222222222',0,'{"schema_version":"1","assertions":[]}')$$,'42501','Case access required.','wrong owner denied');
select throws_ok($$select public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',1,'{"schema_version":"1","assertions":[{"field":"claim_type","value":"first_party","provenance":"staff","reference":"forged","recorded_at":"2026-09-22T00:00:00Z"}]}')$$,'22023','Invalid customer jurisdiction facts.','customer cannot assert staff provenance');
select throws_ok($$select public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',1,'{"schema_version":"1","assertions":[{"field":"claim_type","value":"both","provenance":"customer","reference":"intake","recorded_at":"2026-09-22T00:00:00Z"}]}')$$,'22023','Invalid customer jurisdiction facts.','invalid claim type rejected');
select is(public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',1,'{"schema_version":"1","assertions":[{"field":"customer_residence","value":"US-MO","provenance":"customer","reference":"intake","recorded_at":"2026-09-22T00:00:00Z"},{"field":"customer_residence","value":"US-IL","provenance":"document","reference":"private-document-id","recorded_at":"2026-09-22T00:00:00Z"}]}'),2::bigint,'conflicting assertions retained without inventing a winner');
select throws_ok($$select public.append_case_jurisdiction_facts('56a11111-1111-4111-8111-111111111111',0,'{"schema_version":"1","assertions":[]}')$$,'40001','Jurisdiction facts changed.','stale update rejected');
select is((select facts from public.case_jurisdiction_fact_versions where revision=1),'{"schema_version":"1","assertions":[]}'::jsonb,'earlier facts unchanged');
select is((select count(*) from public.case_jurisdiction_fact_versions),2::bigint,'owner sees only own versions');
select set_config('request.jwt.claim.sub','56222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.case_jurisdiction_fact_versions),0::bigint,'other owner cannot read facts');
select is(public.append_case_jurisdiction_facts('56a22222-2222-4222-8222-222222222222',0,'{"schema_version":"1","assertions":[]}'),1::bigint,'guest retains existing owned intake convention');
reset role;

select throws_ok($$update public.case_jurisdiction_fact_versions set facts='{"schema_version":"1","assertions":[]}' where revision=2$$,'55000','Jurisdiction history is append-only.','updates rejected even by table owner');
set local role service_role;
select is(public.get_jurisdiction_context('56a11111-1111-4111-8111-111111111111')->>'revision','2','worker sees latest revision');
select is(public.get_jurisdiction_context('56a11111-1111-4111-8111-111111111111','56222222-2222-4222-8222-222222222222'),null::jsonb,'customer boundary checks exact owner before scope observation');
select is(jsonb_array_length(public.get_jurisdiction_context('56a11111-1111-4111-8111-111111111111')->'facts'->'assertions'),2,'worker sees both conflicting sources');
select is(public.get_jurisdiction_reference_case('56a11111-1111-4111-8111-111111111111','work_item'),null::uuid,'unknown work identity does not invent a case');
select is(public.get_jurisdiction_reference_case('56a11111-1111-4111-8111-111111111111','release_review'),null::uuid,'unknown review identity does not invent a case');
select lives_ok($$select public.record_jurisdiction_decision('{"id":"56d11111-1111-4111-8111-111111111111","case_id":"56a11111-1111-4111-8111-111111111111","schema_version":"1","facts_revision":2,"facts":{"schema_version":"1","assertions":[]},"registry_version":"phase-1-empty","proposed_allowed":false}',repeat('a',64))$$,'worker appends held proposal');
select lives_ok($$select public.record_jurisdiction_decision('{"id":"56d11111-1111-4111-8111-111111111111","case_id":"56a11111-1111-4111-8111-111111111111","schema_version":"1","facts_revision":2,"facts":{"schema_version":"1","assertions":[]},"registry_version":"phase-1-empty","proposed_allowed":false}',repeat('a',64))$$,'duplicate snapshot retry is idempotent');
select throws_ok($$select public.record_jurisdiction_decision('{"id":"56d11111-1111-4111-8111-111111111111","case_id":"56a11111-1111-4111-8111-111111111111","schema_version":"1","facts_revision":2,"facts":{"schema_version":"1","assertions":[]},"registry_version":"phase-1-empty","proposed_allowed":true}',repeat('a',64))$$,'22023','Decision identity conflict.','same ID cannot rewrite decision even with same supplied digest');
select is((select count(*) from public.jurisdiction_decision_snapshots),1::bigint,'one immutable snapshot retained');
reset role;
select throws_ok($$update public.jurisdiction_decision_snapshots set content_digest=repeat('b',64)$$,'55000','Jurisdiction history is append-only.','decision updates rejected');
select ok(not (select public from storage.buckets where id='case-deliverables'),'deliverable storage remains private');
select ok((select relrowsecurity from pg_class where oid='public.appraisal_cases'::regclass),'existing case RLS remains enabled');
select * from finish();
rollback;
