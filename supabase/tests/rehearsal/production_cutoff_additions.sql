-- Synthetic records that are valid before the pending migration sequence.
insert into auth.users(id,email,email_confirmed_at,is_anonymous,created_at,updated_at,last_sign_in_at)
select ('e9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=4 then 'rehearsal-permanent@example.test' end,
  case when n=4 then statement_timestamp()-interval '50 days' end,n<>4,
  statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,6) n;
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set created_at=statement_timestamp()-interval '50 days',updated_at=statement_timestamp()-interval '50 days'
where id::text like 'e9100000-%';
alter table public.profiles enable trigger profiles_set_updated_at;
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,updated_at,last_activity_at)
select ('e9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'total_loss',
  case when n=5 then 'checking'::public.appraisal_case_status else 'draft'::public.appraisal_case_status end,
  statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,6) n;
insert into public.total_loss_case_details(case_id,intake_mode,report_storage_owner_id,created_at,updated_at)
select ('e9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'report',
  ('e9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,4) n;
insert into storage.objects(bucket_id,name,metadata,created_at,updated_at)
select 'case-files','e9100000-0000-4000-8000-'||lpad(n::text,12,'0')||'/e9200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/valuation-report.pdf',
  '{"mimetype":"application/pdf","size":24}',statement_timestamp()-interval '50 days',statement_timestamp()-interval '50 days'
from generate_series(1,4) n;
-- A processing guest analysis exercises the preview-return backfill.
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,
 mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,intake_completed_at,analysis_input_revision,analysis_input_id)
values('e9200000-0000-4000-8000-000000000005','manual',2022,'Honda','Accord','EX-L',32000,'60601','2026-08-20',
 'Rehearsal Insurance',18000,statement_timestamp(),1,'e9300000-0000-4000-8000-000000000005');
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,processing_token,processing_expires_at,
 source_intake_mode,source_analysis_input_revision,source_analysis_input_id)
values('e9400000-0000-4000-8000-000000000005','e9200000-0000-4000-8000-000000000005',statement_timestamp(),
 'processing','e9500000-0000-4000-8000-000000000005',statement_timestamp()+interval '2 hours','manual',1,'e9300000-0000-4000-8000-000000000005');
-- Old queued work must be protected even when its lease predates the fix.
insert into public.anonymous_guest_cleanup_candidates(user_id,state,first_marked_at,delete_after,eligibility_checked_at)
select ('e9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'grace',
 statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()-interval '2 days'
from generate_series(1,3) n;
