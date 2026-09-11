begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is((select mode from communication_settings),'disabled','migration defaults to disabled');
select ok((select enrolled_after is null from communication_settings),'no historical enrollment');
select ok(not (select active from cron.job where jobname='venfour-communications'),'scheduler starts inactive');
select is((select count(*)::int from communication_deliveries),0,'migration creates no deliveries');
select ok(not has_table_privilege('authenticated','public.communication_deliveries','SELECT'),'browser cannot read recipients or prepared messages');
select ok(not has_table_privilege('service_role','public.communication_deliveries','SELECT'),'service uses narrow functions');
select ok(not has_function_privilege('authenticated','public.communication_worker(text,jsonb)','EXECUTE'),'worker is private');
select ok(not has_function_privilege('service_role','public.communication_staff_operation(text,jsonb)','EXECUTE'),'staff actions require caller identity');

insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('a1000000-0000-4000-8000-000000000001','communications@example.test',statement_timestamp(),false),
 ('a1000000-0000-4000-8000-000000000002','other-communications@example.test',statement_timestamp(),false),
 ('a1000000-0000-4000-8000-000000000003','guest-communications@example.test',null,true);
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,last_activity_at) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','total_loss','draft',statement_timestamp()-interval '2 days',statement_timestamp()-interval '25 hours'),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','total_loss','draft',statement_timestamp()-interval '5 days',statement_timestamp()-interval '25 hours'),
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','total_loss','draft',statement_timestamp()-interval '2 days',statement_timestamp()-interval '25 hours');
insert into public.total_loss_case_contacts(case_id,full_name,email,service_terms_version,service_terms_acknowledged_at,
 privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at)
 select ac.id,'Fictional Email Customer',u.email,'2026-08-23',statement_timestamp(),'2026-08-23',statement_timestamp(),true,statement_timestamp()
 from public.appraisal_cases ac join auth.users u on u.id=ac.user_id where ac.id::text like 'a2000000-%';
update public.appraisal_cases set last_activity_at=statement_timestamp()-interval '25 hours' where id::text like 'a2000000-%';
select is((select count(*)::int from communication_candidates_internal()),0,'disabled enrollment excludes all cases');
select is(communication_worker('discover'),null::jsonb,'disabled discovery is inert');
update communication_settings set enrolled_after=statement_timestamp()-interval '3 days',mode='dry_run';
select is((select count(*)::int from communication_candidates_internal()),1,'verified recent owner eligible; historical and anonymous excluded');
select is(communication_worker('plan')->'counts'->0->>'template_key','intake_reminder','dry run observes real intake stage');
select is(communication_worker('discover'),null::jsonb,'dry run writes no jobs');
select is((select count(*)::int from communication_deliveries),0,'dry run has no delivery side effects');

update communication_settings set mode='live';
select is(communication_worker('discover','{"recipients":["different@example.test"]}')->>'queued','0','test allowlist does not redirect recipients');
select is(communication_worker('discover')->>'queued','1','live discovery queues eligible case');
select is(communication_worker('discover')->>'queued','0','discovery is idempotent');
select is((select count(*)::int from communication_deliveries),1,'one logical delivery');
select is(communication_worker('plan')->'counts','[]'::jsonb,'accepted or queued logical messages are not counted again');
create temp table leases(value jsonb);
insert into leases select communication_worker('lease','{"lease_token":"a3000000-0000-4000-8000-000000000001"}');
select is((select value->>'status' from leases),'sending','job leased');
select is(communication_worker('lease','{"lease_token":"a3000000-0000-4000-8000-000000000002"}'),null::jsonb,'concurrent worker cannot lease in-flight job');
select is(communication_worker('finish',jsonb_build_object('id',(select value->>'id' from leases),'lease_token','a3000000-0000-4000-8000-000000000002','provider_message_id','wrong')),null::jsonb,'wrong lease cannot acknowledge');
update total_loss_case_contacts set operational_follow_up_allowed=false where case_id='a2000000-0000-4000-8000-000000000001';
select is(communication_worker('prepare',jsonb_build_object('id',(select value->>'id' from leases),'lease_token','a3000000-0000-4000-8000-000000000001','provider','resend','prepared_payload','{"to":["communications@example.test"]}'::jsonb)),null::jsonb,'withdrawn consent cancels before send');
select is((select status from communication_deliveries where id=(select (value->>'id')::uuid from leases)),'cancelled','cancelled state durable');
update total_loss_case_contacts set operational_follow_up_allowed=true where case_id='a2000000-0000-4000-8000-000000000001';
select is(communication_worker('discover')->>'queued','0','reconsent does not recreate same reminder');
select is((select user_id::text from appraisal_cases where id='a2000000-0000-4000-8000-000000000001'),'a1000000-0000-4000-8000-000000000001','email never changes case owner');

-- A new eligible case exercises immutable preparation and retry fencing.
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,last_activity_at)
 values('a2000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','total_loss','draft',statement_timestamp()-interval '2 days',statement_timestamp()-interval '25 hours');
insert into public.total_loss_case_contacts(case_id,full_name,email,service_terms_version,service_terms_acknowledged_at,privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at)
 values('a2000000-0000-4000-8000-000000000004','Fictional Email Customer','communications@example.test','2026-08-23',statement_timestamp(),'2026-08-23',statement_timestamp(),true,statement_timestamp());
update public.appraisal_cases set last_activity_at=statement_timestamp()-interval '25 hours' where id='a2000000-0000-4000-8000-000000000004';
select is(communication_worker('discover')->>'queued','1','new case has separate logical milestone');
truncate leases;
insert into leases select communication_worker('lease','{"lease_token":"a3000000-0000-4000-8000-000000000003"}');
select is(communication_worker('prepare',jsonb_build_object('id',(select value->>'id' from leases),'lease_token','a3000000-0000-4000-8000-000000000003','provider','resend','template_version','v1','prepared_payload','{"to":["communications@example.test"],"text":"frozen"}'::jsonb))->'prepared_payload'->>'text','frozen','first payload frozen');
select is(communication_worker('prepare',jsonb_build_object('id',(select value->>'id' from leases),'lease_token','a3000000-0000-4000-8000-000000000003','provider','resend','template_version','v2','prepared_payload','{"text":"changed"}'::jsonb))->'prepared_payload'->>'text','frozen','retry cannot change payload');
select is(communication_worker('fail',jsonb_build_object('id',(select value->>'id' from leases),'lease_token','a3000000-0000-4000-8000-000000000003','error_code','EMAIL_PROVIDER_UNCERTAIN','requires_review',false)),'true'::jsonb,'ambiguous failure recorded safely');
select ok((select due_at>statement_timestamp() from communication_deliveries where id=(select (value->>'id')::uuid from leases)),'retry backs off');
update communication_deliveries set first_attempt_at=statement_timestamp()-interval '24 hours',due_at=statement_timestamp()-interval '1 minute' where id=(select (value->>'id')::uuid from leases);
select is(communication_worker('lease','{"lease_token":"a3000000-0000-4000-8000-000000000004"}'),null::jsonb,'never retry outside provider dedupe window');
select is((select status from communication_deliveries where id=(select (value->>'id')::uuid from leases)),'review','uncertain delivery held for review');

-- Caps apply across cases and include recent transactional acceptance.
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,last_activity_at)
 values('a2000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001','total_loss','draft',statement_timestamp()-interval '2 days',statement_timestamp()-interval '25 hours');
insert into public.total_loss_case_contacts(case_id,full_name,email,service_terms_version,service_terms_acknowledged_at,privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at)
 values('a2000000-0000-4000-8000-000000000005','Fictional Email Customer','communications@example.test','2026-08-23',statement_timestamp(),'2026-08-23',statement_timestamp(),true,statement_timestamp());
update public.appraisal_cases set last_activity_at=statement_timestamp()-interval '25 hours' where id='a2000000-0000-4000-8000-000000000005';
select is(communication_worker('discover')->>'queued','1','another case shares recipient limits');
select communication_worker('record_auth',jsonb_build_object('source_key','auth/cap','template_key','auth_sign_in','provider_message_id','cap-auth','recipient_hash',encode(digest('communications@example.test','sha256'),'hex'),'template_version','v1'));
select is(communication_worker('lease',jsonb_build_object('lease_token',gen_random_uuid())),null::jsonb,'recent transactional email defers optional mail');
update communication_deliveries set accepted_at=statement_timestamp()-interval '8 days' where source_key='auth/cap';
insert into communication_deliveries(source,source_key,template_key,category,recipient_hash,status,accepted_at)
 select 'lifecycle','cap/'||n,'intake_reminder','follow_up',encode(digest('communications@example.test','sha256'),'hex'),'accepted',statement_timestamp()-make_interval(days=>n)
 from generate_series(2,4) n;
select is(communication_worker('lease',jsonb_build_object('lease_token',gen_random_uuid())),null::jsonb,'three weekly reminders prevent a fourth across cases');
update communication_deliveries set accepted_at=statement_timestamp()-interval '8 days' where source_key='cap/4';
select is(communication_worker('lease',jsonb_build_object('lease_token',gen_random_uuid()))->>'template_key','intake_reminder','eligible reminder resumes when rolling limit permits');

select is(communication_worker('event',jsonb_build_object('event_id','evt-synthetic','provider_message_id','provider-synthetic','event_type','email.bounced','occurred_at',statement_timestamp(),'recipient_hash',encode(digest('communications@example.test','sha256'),'hex'))),'true'::jsonb,'verified bounce event accepted');
select is(communication_worker('event',jsonb_build_object('event_id','evt-synthetic','provider_message_id','provider-synthetic','event_type','email.bounced','occurred_at',statement_timestamp(),'recipient_hash',encode(digest('communications@example.test','sha256'),'hex'))),'true'::jsonb,'duplicate webhook acknowledged');
select is((select count(*)::int from communication_events where event_id='evt-synthetic'),1,'event is stored once');
select is((select count(*)::int from communication_candidates_internal()),0,'bounce suppresses future customer mail');
select is((select reason from communication_suppressions where recipient_hash=encode(digest('communications@example.test','sha256'),'hex')),'bounce','suppression retained without plain email');
select throws_ok($$update communication_events set event_type='email.delivered' where event_id='evt-synthetic'$$,'55000','communication_events records are immutable.','delivery events are immutable');

-- Staff access is checked inside every database operation.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select communication_staff_operation('overview')$$,'42501','Staff access required.','nonstaff cannot inspect metadata');
reset role;
insert into staff_members(user_id) values('a1000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(communication_staff_operation('overview') ? 'automations','staff can inspect controls');
select ok(communication_staff_operation('overview')::text not like '%communications@example.test%','staff activity has no customer addresses');
select ok(communication_staff_operation('overview')::text not like '%frozen%','staff activity has no prepared content');
select throws_ok($$select communication_staff_operation('settings','{"mode":"live","revision":99}')$$,'40001','Settings changed. Reload and retry.','stale settings fenced');
select ok(communication_staff_operation('settings','{"mode":"disabled","revision":1}') ? 'settings','staff can pause');
reset role;
select is((select count(*)::int from communication_admin_events),1,'configuration change audited');
select is(communication_worker('lease','{"lease_token":"a3000000-0000-4000-8000-000000000005"}'),null::jsonb,'pause stops leases');
select is(communication_worker('unsubscribe','{"token":"not-a-real-token"}'),'true'::jsonb,'unknown unsubscribe neutral');

-- Inert unknown recipients and idempotent test delivery reservation.
select is(communication_worker('begin_test',jsonb_build_object('source_key','test/sample','recipient_hash',repeat('a',64),'template_key','auth_sign_in','provider','resend','template_version','v1','lease_token','a3000000-0000-4000-8000-000000000006'))->>'status','sending','test send reserved before provider call');
select is(communication_worker('begin_test',jsonb_build_object('source_key','test/sample','recipient_hash',repeat('a',64),'template_key','auth_sign_in','provider','resend','template_version','v1','lease_token','a3000000-0000-4000-8000-000000000007')),null::jsonb,'concurrent test send fenced');
select is(communication_worker('finish_test',jsonb_build_object('source_key','test/sample','lease_token','a3000000-0000-4000-8000-000000000006','provider_message_id','test-provider')),'true'::jsonb,'test acceptance recorded');
select is(communication_worker('begin_test',jsonb_build_object('source_key','test/sample','recipient_hash',repeat('a',64),'template_key','auth_sign_in','provider','resend','template_version','v1','lease_token','a3000000-0000-4000-8000-000000000007'))->>'status','accepted','test replay returns acceptance without resending');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(communication_staff_operation('settings','{"mode":"live","revision":2}') ? 'settings','first operator activation succeeds');
reset role;
select ok((select enrolled_after=activated_at and enrolled_after>=(select max(created_at) from appraisal_cases where id::text like 'a2000000-%') from communication_settings),'first activation resets boundary beyond pre-existing cases');
select is((select count(*)::int from communication_candidates_internal()),0,'first activation never backfills previous customers');
select * from finish();
rollback;
