begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(20);
select ok(not has_function_privilege('anon','public.get_case_product_facts(uuid,boolean)','EXECUTE'),'signed-out product reads denied');
select ok(has_function_privilege('authenticated','public.get_case_product_facts(uuid,boolean)','EXECUTE'),'authenticated product read seam available');
select ok(not has_function_privilege('authenticated','public.capture_report_product_facts(uuid)','EXECUTE'),'customers cannot capture worker report facts');
select ok(has_function_privilege('service_role','public.capture_report_product_facts(uuid)','EXECUTE'),'report worker capture is service-only');
select ok(not has_table_privilege('service_role','public.total_loss_report_product_facts','INSERT,UPDATE,DELETE'),'workers cannot bypass capture RPC');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_report_product_facts'::regclass),'captured facts have RLS');
insert into auth.users(id,email,is_anonymous,email_confirmed_at) values
('58111111-1111-4111-8111-111111111111','product-owner@example.test',true,null),
('58222222-2222-4222-8222-222222222222','product-staff@example.test',false,now());
insert into public.appraisal_cases(id,user_id,service_type,status) values
('58a11111-1111-4111-8111-111111111111','58111111-1111-4111-8111-111111111111','total_loss','draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','58111111-1111-4111-8111-111111111111',true);
select is(public.get_case_product_facts('58a11111-1111-4111-8111-111111111111')->>'revision','0','owned guest intake has explicit unknown facts');
select ok(not (public.get_case_product_facts('58a11111-1111-4111-8111-111111111111') ? 'delivery'),'customer read does not expose internal authority');
select throws_ok($$select public.get_case_product_facts('58a11111-1111-4111-8111-111111111111',true)$$,'42501','Staff access required.','staff flag is not an authorization bypass');
select is(public.append_case_jurisdiction_facts('58a11111-1111-4111-8111-111111111111',0,'{"schema_version":"1","assertions":[{"field":"vehicle_registration","value":"US-MO","provenance":"customer","reference":"confirmed","recorded_at":"2026-09-22T00:00:00Z"}]}'),1::bigint,'existing version RPC saves confirmed product facts');
select is(public.get_case_product_facts('58a11111-1111-4111-8111-111111111111')->>'revision','1','product projection reads persisted revision');
select throws_ok($$select public.append_case_jurisdiction_facts('58a11111-1111-4111-8111-111111111111',0,'{"schema_version":"1","assertions":[]}')$$,'40001','Jurisdiction facts changed.','stale update cannot overwrite facts');
select set_config('request.jwt.claim.sub','58222222-2222-4222-8222-222222222222',true);
select throws_ok($$select public.get_case_product_facts('58a11111-1111-4111-8111-111111111111')$$,'42501','Case access required.','another customer cannot read facts');
select throws_ok($$select public.get_case_product_facts('58a11111-1111-4111-8111-111111111111',true)$$,'42501','Staff access required.','ordinary authenticated identity is not staff');
reset role;
insert into public.staff_members(user_id) values('58222222-2222-4222-8222-222222222222');
set local role authenticated;
select is(public.get_case_product_facts('58a11111-1111-4111-8111-111111111111',true)->>'revision','1','existing staff role can inspect facts');
select is(public.get_case_product_facts('58a11111-1111-4111-8111-111111111111',true)->'delivery'->>'state','unenrolled','unenrolled status is explicit');
select is(public.get_case_product_facts('58a11111-1111-4111-8111-111111111111',true)->'delivery'->'reasons','["EXISTING_EXPOSURE_UNREVIEWED"]'::jsonb,'unenrolled is not approved');
select throws_ok($$select public.get_case_product_facts('58a22222-2222-4222-8222-222222222222',true)$$,'42501','Case access required.','missing cases do not invent a product context');
reset role;
select is((select count(*) from public.jurisdiction_delivery_cases),0::bigint,'product facts do not enroll or release a case');
select is((select count(*) from public.jurisdiction_delivery_authority),0::bigint,'product facts do not publish authority');
select * from finish();
rollback;
