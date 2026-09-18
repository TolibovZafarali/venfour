begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,is_anonymous,created_at,updated_at,last_sign_in_at)
select ('ea100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n<>2 then 'release-'||n||'@example.test' end,
 case when n<>2 then statement_timestamp() end,n=2,
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,5) n;
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set created_at=statement_timestamp()-interval '50 days',updated_at=statement_timestamp()-interval '50 days'
where id::text like 'ea100000-%';
alter table public.profiles enable trigger profiles_set_updated_at;
insert into public.staff_members(user_id) values('ea100000-0000-4000-8000-000000000001');
insert into public.referral_partners(id,business_name,contact_email,user_id,commission_amount_minor_units,created_by_user_id)
values('ea300000-0000-4000-8000-000000000001','Fictional Partner','release-4@example.test',
 'ea100000-0000-4000-8000-000000000004',4500,'ea100000-0000-4000-8000-000000000001');
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,updated_at,last_activity_at)
select ('ea200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('ea100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'total_loss','draft',
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,5) n;
insert into public.total_loss_case_details(case_id,intake_mode,intake_completed_at,
 report_last_upload_id,report_original_filename,report_uploaded_at,created_at,updated_at)
select ('ea200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'report',
 case when n in (1,3,4) then statement_timestamp()-interval '50 days' end,
 case when n=2 then 'ea400000-0000-4000-8000-000000000001'::uuid end,
 case when n=2 then 'saved-valuation.pdf' end,
 case when n=2 then statement_timestamp()-interval '50 days' end,
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,5) n;
insert into storage.objects(bucket_id,name,metadata,created_at,updated_at) values
 ('case-files','ea100000-0000-4000-8000-000000000002/ea200000-0000-4000-8000-000000000002/valuation-report.pdf',
 '{"mimetype":"application/pdf","size":24,"reportUploadId":"ea400000-0000-4000-8000-000000000001"}',
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'),
 ('case-files','ea100000-0000-4000-8000-000000000002/unrelated.pdf','{}',statement_timestamp(),statement_timestamp());
select ok(not public.is_abandoned_anonymous_guest_eligible('ea100000-0000-4000-8000-000000000002'),
 'saved source report protects an old unfinished guest from cleanup');

insert into public.communication_deliveries(source,source_key,template_key,category,recipient_email,status,prepared_payload)
values('lifecycle','release/queued','intake_reminder','follow_up','release-3@example.test','queued','{"text":"PRIVATE_BODY"}');
insert into public.communication_deliveries(source,source_key,template_key,category,status,accepted_at)
values('auth','release/auth','auth_sign_in','transactional','accepted',statement_timestamp());
insert into public.referral_partner_jobs(id,kind,partner_id,status,payload,finished_at)
values('ea500000-0000-4000-8000-000000000001','email','ea300000-0000-4000-8000-000000000001','failed',
 '{"kind":"invitation","recipient_email":"release-4@example.test","token":"PRIVATE_TOKEN"}',statement_timestamp());

set local role authenticated;
set local request.jwt.claim.sub='ea100000-0000-4000-8000-000000000003';
select throws_ok($$select public.staff_email_history()$$,'42501','Staff access required.','customer cannot access email history');
select throws_ok($$select public.staff_total_loss_source_report_locator('ea200000-0000-4000-8000-000000000002')$$,
 '42501','Staff access required.','customer cannot locate another user report');
select is((select count(*) from storage.objects where name like 'ea100000-0000-4000-8000-000000000002/%'),0::bigint,
 'ordinary customer cannot read another owner files');

set local request.jwt.claim.sub='ea100000-0000-4000-8000-000000000001';
select is((public.staff_admin_list('customers','ea100000-')->>'total')::int,1,'only a customer with completed intake appears');
select is(public.staff_admin_list('customers','ea100000-')#>>'{items,0,id}',
 'ea100000-0000-4000-8000-000000000003','staff and partner identities are excluded');
select is((public.staff_admin_list('cases','ea200000-')->>'total')::int,3,'early visits and upload-only intake are excluded from cases');
select is((public.staff_admin_list('incomplete_intakes','ea200000-')->>'total')::int,1,'uploaded report is in incomplete intakes');
select is(public.staff_admin_record('incomplete_intakes','ea200000-0000-4000-8000-000000000002')->>'title',
 'saved-valuation.pdf','incomplete intake detail has saved filename');
select is((select filename from public.staff_total_loss_source_report_locator('ea200000-0000-4000-8000-000000000002')),
 'saved-valuation.pdf','staff can locate unfinished source report');
select is((select count(*) from storage.objects where name like 'ea100000-0000-4000-8000-000000000002/%'),1::bigint,
 'staff storage access exposes only the canonical source report');
select ok(public.staff_email_history()::text !~ 'PRIVATE_BODY|PRIVATE_TOKEN|prepared_payload|unsubscribe_token',
 'email history excludes content and credentials');
select is((select item->>'acceptedAt' from jsonb_array_elements(public.staff_email_history()->'items') item
 where item->>'id'='partner:ea500000-0000-4000-8000-000000000001'),null::text,'failed partner job has no false acceptance timestamp');
select is((select item->>'attempts' from jsonb_array_elements(public.staff_email_history()->'items') item
 where item->>'source'='auth'),null::text,'unmeasured auth attempts are not reported as zero');
select ok(not has_function_privilege('anon','public.staff_email_history()','EXECUTE')
 and not has_function_privilege('service_role','public.staff_email_history()','EXECUTE'),'history grants only authenticated staff path');
reset role;
delete from public.staff_members where user_id='ea100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.staff_email_history()$$,'42501','Staff access required.','revocation immediately removes email history access');
select is((select count(*) from storage.objects where name like 'ea100000-0000-4000-8000-000000000002/%'),0::bigint,
 'revocation immediately removes source report access');
reset role;
select * from finish();
rollback;
