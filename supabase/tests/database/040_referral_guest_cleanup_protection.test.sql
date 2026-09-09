begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous,created_at,updated_at,last_sign_in_at)
select ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=10 then 'cleanup-manager@example.test' end,
 case when n=10 then statement_timestamp()-interval '50 days' end,n<>10,
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,11) n;
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set created_at=statement_timestamp()-interval '50 days',updated_at=statement_timestamp()-interval '50 days'
where id::text like 'fa100000-%';
alter table public.profiles enable trigger profiles_set_updated_at;
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,updated_at,last_activity_at)
select ('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'total_loss','draft',
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,9) n;
insert into public.total_loss_case_details(case_id,intake_mode,report_storage_owner_id,created_at,updated_at)
select ('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'report',
 ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,9) n;
insert into storage.objects(bucket_id,name,metadata,created_at,updated_at)
select 'case-files','fa100000-0000-4000-8000-'||lpad(n::text,12,'0')||'/fa200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/valuation-report.pdf',
 '{"mimetype":"application/pdf","size":24}',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,9) n;

-- Create a fictional signed partner; activation generates its referral link.
insert into public.staff_members(user_id) values('fa100000-0000-4000-8000-000000000010');
insert into public.referral_partner_managers(user_id) values('fa100000-0000-4000-8000-000000000010');
insert into public.referral_partner_templates(id,title,sections,status,version,created_by_user_id,published_by_user_id,published_at)
values('fa600000-0000-4000-8000-000000000001','Fictional rehearsal agreement','[{"heading":"Fixture","body":"Synthetic rehearsal only."}]',
 'published',(select coalesce(max(version),0)+1 from public.referral_partner_templates),'fa100000-0000-4000-8000-000000000010','fa100000-0000-4000-8000-000000000010',statement_timestamp());
insert into public.referral_partners(id,business_name,contact_email,user_id,commission_amount_minor_units,created_by_user_id)
values('fa600000-0000-4000-8000-000000000002','Fictional Rehearsal Partner','rehearsal-permanent@example.test',
 'fa100000-0000-4000-8000-000000000010',4500,'fa100000-0000-4000-8000-000000000010');
insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,status,partner_signature,manager_signature,storage_object_path)
values('fa600000-0000-4000-8000-000000000003','fa600000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000001',
 '{"commission_amount_minor_units":4500,"currency":"USD"}',repeat('e',64),'countersigned',
 '{"typed_legal_name":"Fictional Partner"}','{"typed_legal_name":"Fictional Manager"}',
 'partners/fa600000-0000-4000-8000-000000000002/agreements/fa600000-0000-4000-8000-000000000003/signed.pdf');
update public.referral_partners set current_agreement_id='fa600000-0000-4000-8000-000000000003',status='active',
 activated_at=statement_timestamp(),revision=revision+1 where id='fa600000-0000-4000-8000-000000000002';


insert into public.referral_case_attributions(case_id,partner_id,link_id,agreement_id,agreement_digest,commission_amount_minor_units,currency,bound_at,submitted_at)
select ('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa600000-0000-4000-8000-000000000002',l.id,
 'fa600000-0000-4000-8000-000000000003',repeat('e',64),4500,'USD',statement_timestamp()-interval '50 days',
 case when n in (2,4,5,6,7) then statement_timestamp()-interval '49 days' end
from public.referral_partner_links l cross join generate_series(2,8) n where l.partner_id='fa600000-0000-4000-8000-000000000002';
select ok(public.is_abandoned_anonymous_guest_eligible('fa100000-0000-4000-8000-000000000001'),'ordinary old guest remains eligible');
select ok(public.is_abandoned_anonymous_guest_eligible('fa100000-0000-4000-8000-000000000003'),'unsubmitted referral draft remains eligible');
select ok(not public.is_abandoned_anonymous_guest_eligible('fa100000-0000-4000-8000-000000000002'),'submitted referral excludes an otherwise eligible old guest');
select throws_ok($$update public.referral_case_attributions set submitted_at=null where case_id='fa200000-0000-4000-8000-000000000002'$$,'55000',null,'submission cannot be undone');
select throws_ok($$update public.referral_case_attributions set commission_amount_minor_units=1 where case_id='fa200000-0000-4000-8000-000000000002'$$,'55000',null,'frozen attribution cannot change');
select throws_ok($$delete from public.referral_case_attributions where case_id='fa200000-0000-4000-8000-000000000002'$$,'55000',null,'submitted attribution remains immutable');
select throws_ok($$delete from public.appraisal_cases where id='fa200000-0000-4000-8000-000000000002'$$,'55000',null,'protected case deletion rolls back atomically');
select throws_ok($$delete from auth.users where id='fa100000-0000-4000-8000-000000000002'$$,'55000',null,'protected Auth deletion rolls back atomically');
select is((select count(*) from storage.objects where name like 'fa100000-0000-4000-8000-000000000002/%'),1::bigint,'protected file metadata survives case/user delete rejection');
select ok(exists(select 1 from auth.users where id='fa100000-0000-4000-8000-000000000002') and exists(select 1 from public.appraisal_cases where id='fa200000-0000-4000-8000-000000000002'),'protected identity and case remain intact');

-- Prevent unrelated committed QA candidates from being selected in this rollback test.
update public.anonymous_guest_cleanup_candidates set delete_after=greatest(delete_after,statement_timestamp()+interval '100 years')
where state='grace' and user_id::text not like 'fa100000-%';
insert into public.anonymous_guest_cleanup_runs(id,dry_run,requested_batch_size,status)
values('fa700000-0000-4000-8000-000000000001',false,25,'running');
insert into public.anonymous_guest_cleanup_candidates(user_id,state,first_marked_at,delete_after,eligibility_checked_at,
 snapshot_at,case_ids,storage_prefixes,storage_object_paths,lease_token,lease_expires_at,storage_deletion_started_at,storage_deleted_at)
select ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case n when 5 then 'executing' when 6 then 'storage_retry' when 7 then 'storage_deleted' else 'grace' end,
 statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()-interval '2 days',
 statement_timestamp()-interval '1 day',array[('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid],
 array['fa100000-0000-4000-8000-'||lpad(n::text,12,'0')||'/fa200000-0000-4000-8000-'||lpad(n::text,12,'0')],
 array['fa100000-0000-4000-8000-'||lpad(n::text,12,'0')||'/fa200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/valuation-report.pdf'],
 case when n=5 then 'fa800000-0000-4000-8000-000000000001'::uuid end,
 case when n=5 then statement_timestamp()-interval '1 hour' end,
 case when n in (6,7) then statement_timestamp()-interval '1 hour' end,
 case when n=7 then statement_timestamp()-interval '30 minutes' end
from generate_series(1,7) n where n<>2;
set local role service_role;
select throws_ok($$select public.start_abandoned_anonymous_guest_storage_deletion('fa100000-0000-4000-8000-000000000005','fa800000-0000-4000-8000-000000000001')$$,
 '55000','Submitted referral history prevents anonymous guest cleanup.','a pre-migration lease cannot start deleting protected files');
reset role;
select ok((select storage_deletion_started_at is null from public.anonymous_guest_cleanup_candidates where user_id='fa100000-0000-4000-8000-000000000005'),'rejected storage start has no partial transition');
create temporary table cleanup_referral_claims as select * from public.claim_abandoned_anonymous_guest_cleanup_candidate(
 'fa700000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002');
insert into cleanup_referral_claims select * from public.claim_abandoned_anonymous_guest_cleanup_candidate(
 'fa700000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002');
select results_eq($$select user_id from cleanup_referral_claims order by user_id$$,
 $$values ('fa100000-0000-4000-8000-000000000001'::uuid),('fa100000-0000-4000-8000-000000000003'::uuid)$$,
 'only ordinary and unsubmitted guests are handed to the destructive worker');
select is((select count(*) from public.claim_abandoned_anonymous_guest_cleanup_candidate(
 'fa700000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002')),0::bigint,'protected queued/retried/Auth-only candidates yield no destructive action');
select results_eq($$select state,last_error_code from public.anonymous_guest_cleanup_candidates where user_id::text like 'fa100000-%' and right(user_id::text,1) in ('4','5','6','7') order by user_id$$,
 $$values ('cancelled'::text,'PROTECTED_REFERRAL_HISTORY'::text),('cancelled','PROTECTED_REFERRAL_HISTORY'),('blocked','PROTECTED_REFERRAL_HISTORY'),('blocked','PROTECTED_REFERRAL_HISTORY')$$,
 'unstarted work is cancelled and previously started work is quarantined');
select is((select count(*) from storage.objects where name like 'fa100000-%' and split_part(name,'/',1) not in ('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000003')),7::bigint,'protection discovery has not deleted any protected file');
select throws_ok($$update public.referral_case_attributions set submitted_at=statement_timestamp() where case_id='fa200000-0000-4000-8000-000000000003'$$,
 '55000',null,'submission cannot race an already leased cleanup');

set local role service_role;
select lives_ok($$select public.start_abandoned_anonymous_guest_storage_deletion('fa100000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002')$$,'ordinary storage deletion still starts');
reset role;
set local storage.allow_delete_query='true';
delete from storage.objects where name like 'fa100000-0000-4000-8000-000000000001/%';
set local role service_role;
select lives_ok($$select public.mark_abandoned_anonymous_guest_storage_deleted('fa100000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002')$$,'ordinary storage deletion completes');
reset role;
select lives_ok($$delete from auth.users where id='fa100000-0000-4000-8000-000000000001'$$,'ordinary abandoned Auth and case cascade succeeds');
set local role service_role;
select lives_ok($$select public.complete_abandoned_anonymous_guest_cleanup_candidate('fa100000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000002')$$,'ordinary cleanup completion remains compatible');
reset role;
select is((select state from public.anonymous_guest_cleanup_candidates where user_id='fa100000-0000-4000-8000-000000000001'),'completed','ordinary guest cleanup finishes');
select lives_ok($$delete from public.appraisal_cases where id='fa200000-0000-4000-8000-000000000003'$$,'unsubmitted referral case deletion remains allowed');
select is((select count(*) from public.referral_case_attributions where case_id='fa200000-0000-4000-8000-000000000003'),0::bigint,'unsubmitted attribution cascades without dangling history');
select lives_ok($$delete from public.appraisal_cases where id='fa200000-0000-4000-8000-000000000009'$$,'ordinary case deletion remains allowed');

-- A retained report owner must be protected even after the case changes owner.
update public.appraisal_cases set user_id='fa100000-0000-4000-8000-000000000010' where id='fa200000-0000-4000-8000-000000000002';
select ok(public.anonymous_guest_has_protected_referral('fa100000-0000-4000-8000-000000000002'),'retained report-owner association is protected');
select ok(public.anonymous_guest_has_protected_referral('fa100000-0000-4000-8000-000000000010'),'current owner association is protected');
select ok((select relrowsecurity from pg_class where oid='public.referral_case_attributions'::regclass)
 and (select relrowsecurity from pg_class where oid='public.anonymous_guest_cleanup_candidates'::regclass),'RLS remains enabled');
select ok(not has_function_privilege('anon','public.anonymous_guest_has_protected_referral(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.anonymous_guest_has_protected_referral(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.anonymous_guest_has_protected_referral(uuid)','EXECUTE'),'protection lookup remains private');
select ok(not has_function_privilege('service_role','public.guard_referral_attribution_guest_cleanup()','EXECUTE')
 and not has_function_privilege('authenticated','public.guard_referral_attribution_guest_cleanup()','EXECUTE'),'trigger helper has no callable API grant');
select ok(has_function_privilege('service_role','public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)','EXECUTE'),'bounded service-only cleanup RPC grants are preserved');
select ok(not has_table_privilege('service_role','public.referral_case_attributions','DELETE')
 and not has_table_privilege('authenticated','public.anonymous_guest_cleanup_candidates','UPDATE'),'raw immutable attribution and cleanup state remain inaccessible');
select * from finish();
rollback;
