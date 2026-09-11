begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('f8100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'referral-attribution-'||n||'@example.test',case when n=6 then null else statement_timestamp() end,n in (5,8)
from generate_series(1,12) n;
insert into public.staff_members(user_id) values('f8100000-0000-4000-8000-000000000001'),('f8100000-0000-4000-8000-000000000002');
insert into public.referral_partner_managers(user_id) values('f8100000-0000-4000-8000-000000000001');
insert into public.referral_partner_templates(id,title,sections,status,version,created_by_user_id,published_by_user_id,published_at)
values('f8300000-0000-4000-8000-000000000001','Isolated attribution fixture','[{"heading":"Fixture","body":"Fictional test wording only."}]',
  'published',(select coalesce(max(version),0)+1 from public.referral_partner_templates),
  'f8100000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001',statement_timestamp());
insert into public.referral_partners(id,business_name,contact_email,user_id,commission_amount_minor_units,created_by_user_id)
select ('f8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture Partner '||n,'referral-attribution-'||(n+2)||'@example.test',
  ('f8100000-0000-4000-8000-'||lpad((n+2)::text,12,'0'))::uuid,3000,'f8100000-0000-4000-8000-000000000001'
from generate_series(1,3) n;
insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,status,partner_signature,manager_signature,storage_object_path)
select ('f8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'f8300000-0000-4000-8000-000000000001','{"commission_amount_minor_units":4500,"currency":"USD"}',repeat(n::text,64),
  'countersigned','{"typed_legal_name":"Fixture Partner"}','{"typed_legal_name":"Fixture Manager"}',
  'partners/f8200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/agreements/f8400000-0000-4000-8000-'||lpad(n::text,12,'0')||'/signed.pdf'
from generate_series(1,2) n;
insert into public.referral_partner_links(partner_id,created_at) values('f8200000-0000-4000-8000-000000000001','2020-01-01');
update public.referral_partners set current_agreement_id=('f8400000-0000-4000-8000-'||right(id::text,12))::uuid,status='active',activated_at=statement_timestamp()
where id in ('f8200000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002');
create temporary table attribution_fixture(key text primary key,value jsonb) on commit drop;
grant all on attribution_fixture to authenticated,service_role;
insert into attribution_fixture select 'link'||right(partner_id::text,1),to_jsonb(l) from public.referral_partner_links l
where partner_id in ('f8200000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002');
select is((select count(*) from public.referral_partner_links where partner_id in ('f8200000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002')),2::bigint,'activation creates one stable link and preserves an existing link');
select ok((select bool_and(code ~ '^[0-9a-f]{48}$') from public.referral_partner_links),'links use 192-bit random opaque codes');
select is((select count(*) from public.referral_partner_links where partner_id='f8200000-0000-4000-8000-000000000003'),0::bigint,'onboarding does not enable a referral link');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.referral_partner_links'::regclass,'public.referral_case_attributions'::regclass,'public.referral_order_attributions'::regclass,'public.referral_purchase_conversions'::regclass)),'all attribution tables have RLS');
select ok(not has_table_privilege('authenticated','public.referral_case_attributions','SELECT') and not has_table_privilege('service_role','public.referral_case_attributions','INSERT'),'raw attribution facts cannot be read or assigned directly by API roles');
select ok(not has_function_privilege('authenticated','public.get_or_create_total_loss_draft_internal(text)','EXECUTE') and has_function_privilege('authenticated','public.get_or_create_referred_total_loss_draft(text)','EXECUTE') and not has_function_privilege('anon','public.get_or_create_referred_total_loss_draft(text)','EXECUTE'),'only authenticated identities can use the public referred draft boundary');
select ok(not has_function_privilege('authenticated','public.referral_partner_onboarding_operation_internal(text,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.fulfill_total_loss_checkout_without_referral_internal(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamp with time zone)','EXECUTE'),'internal wrappers cannot bypass attribution or authorization');

set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000005',true);
insert into attribution_fixture values('anon_case',to_jsonb(public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link1'))));
select is(public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link2'))::text,
  (select jsonb_populate_record(null::public.appraisal_cases,value)::text from attribution_fixture where key='anon_case'),'replay through a competing link resumes the exact existing draft');
reset role;
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')),1::bigint,'competing referral calls keep one attribution');
select results_eq($$select partner_id,agreement_id,agreement_digest,commission_amount_minor_units,currency from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')$$,
  $$values ('f8200000-0000-4000-8000-000000000001'::uuid,'f8400000-0000-4000-8000-000000000001'::uuid,repeat('1',64),4500,'USD'::text)$$,'first new-case binding freezes the signed agreement commission, not mutable partner fields');
select ok((select submitted_at is null from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')),'an unsubmitted draft is not a submitted lead');
select is((select count(*) from public.referral_case_attributions where link_id=(select (value->>'id')::uuid from attribution_fixture where key='link1')),1::bigint,'an old link has no expiry cutoff');
select throws_ok($$update public.referral_case_attributions set partner_id='f8200000-0000-4000-8000-000000000002' where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')$$,'55000',null,'attribution cannot be replaced');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000007',true);
insert into attribution_fixture values('existing_case',to_jsonb(public.get_or_create_total_loss_draft()));
select is((public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link1'))).id,
  (select (value->>'id')::uuid from attribution_fixture where key='existing_case'),'existing ordinary draft resumes without a duplicate');
reset role;
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='existing_case')),0::bigint,'resuming never retrofits attribution');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000010',true);
insert into attribution_fixture values('invalid_case',to_jsonb(public.get_or_create_referred_total_loss_draft('not-a-referral-code')));
reset role;
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='invalid_case')),0::bigint,'malformed referral does not block ordinary draft creation');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
insert into attribution_fixture values('pause_request',jsonb_build_object('partner_id','f8200000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),'expected_revision',1,'enabled',false));
insert into attribution_fixture values('pause_response',public.referral_partner_operation('link_state',(select value from attribution_fixture where key='pause_request')));
select is((select value#>>'{link,status}' from attribution_fixture where key='pause_response'),'paused','manager can pause future referrals');
select is(public.referral_partner_operation('link_state',(select value from attribution_fixture where key='pause_request')),(select value from attribution_fixture where key='pause_response'),'exact manager replay preserves revision and audit');
select throws_ok($$select public.referral_partner_operation('link_state',(select value||jsonb_build_object('request_id',gen_random_uuid(),'enabled',true) from attribution_fixture where key='pause_request'))$$,'40001',null,'stale link revision cannot change state');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000011',true);
insert into attribution_fixture values('paused_case',to_jsonb(public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link1'))));
reset role;
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='paused_case')),0::bigint,'paused link creates an ordinary unattributed draft');
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')),1::bigint,'pausing retains historical attribution');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select is(public.referral_partner_operation('link_state',jsonb_build_object('partner_id','f8200000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),'expected_revision',2,'enabled',true))#>>'{link,code}',(select value->>'code' from attribution_fixture where key='link1'),'resuming preserves the stable shared URL');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,submitted_count}','0','partner sees no rows until contact submission');
select throws_ok($$select public.referral_partner_operation('referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000002"}')$$,'42501',null,'partner cannot read another business referrals');
select throws_ok($$select public.referral_partner_operation('staff_referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'owning a partner never grants manager endpoint access');
select throws_ok($$select public.referral_partner_operation('referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000001","page_size":101}')$$,'22023',null,'pagination is bounded');
select throws_ok($$select public.referral_partner_operation('referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000001","email":"injected@example.test"}')$$,'22023',null,'unknown projection fields are rejected');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'unverified identity cannot read partner tracking');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.referral_partner_operation('staff_referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'ordinary staff cannot read referral tracking');
reset role;
delete from public.referral_partner_managers where user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.referral_partner_operation('link_state',(select value from attribution_fixture where key='pause_request'))$$,'42501',null,'revoked manager cannot replay a previously successful mutation');
select throws_ok($$select public.referral_partner_operation('staff_referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'same-token permission revocation blocks fresh reads');
reset role;
insert into public.referral_partner_managers(user_id) values('f8100000-0000-4000-8000-000000000001');
delete from public.staff_members where user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.referral_partner_operation('staff_referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'staff membership revocation independently removes manager access');
reset role;
insert into public.staff_members(user_id) values('f8100000-0000-4000-8000-000000000001');
insert into public.total_loss_case_details(case_id,intake_mode) select (value->>'id')::uuid,'manual' from attribution_fixture where key='anon_case';
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.save_total_loss_contact_details_and_begin_claim((select (value->>'id')::uuid from attribution_fixture where key='anon_case'),'Fixture','Buyer','referral-attribution-5@example.test',null,'2026-08-23','2026-08-23',false)$$,'42501',null,'wrong owner cannot submit someone else referral');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.save_total_loss_contact_details_and_begin_claim((select (value->>'id')::uuid from attribution_fixture where key='anon_case'),'Fixture','Buyer','invalid',null,'2026-08-23','2026-08-23',false)$$,'22023',null,'failed contact save creates no lead');
reset role;
select ok((select submitted_at is null from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')),'failed save preserves hidden draft state');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000005',true);
select lives_ok($$select public.save_total_loss_contact_details_and_begin_claim((select (value->>'id')::uuid from attribution_fixture where key='anon_case'),'Fixture','Buyer','referral-attribution-5@example.test',null,'2026-08-23','2026-08-23',false)$$,'successful existing contact boundary submits the referral');
reset role;
insert into attribution_fixture select 'submitted_at',to_jsonb(submitted_at) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case');
set local role authenticated;
select lives_ok($$select public.save_total_loss_contact_details_and_begin_claim((select (value->>'id')::uuid from attribution_fixture where key='anon_case'),'Fixture','Buyer','referral-attribution-5@example.test',null,'2026-08-23','2026-08-23',false)$$,'contact retry remains valid');
reset role;
select is((select to_jsonb(submitted_at) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='anon_case')),(select value from attribution_fixture where key='submitted_at'),'contact retry does not rewrite submitted timestamp');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
insert into attribution_fixture values('list',public.referral_partner_operation('referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000001"}'));
select is((select value->>'total' from attribution_fixture where key='list'),'1','submitted lead appears exactly once');
select is((select value#>>'{items,0,status}' from attribution_fixture where key='list'),'submitted','new submitted lead has no invented purchase');
select is((select array_agg(k order by k) from attribution_fixture f cross join lateral jsonb_object_keys(f.value#>'{items,0}') k where f.key='list'),array['id','purchased_at','status','submitted_at']::text[],'tracking rows contain only opaque reference, dates and status');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000008',true);
insert into attribution_fixture values('cleanup_case',to_jsonb(public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link1'))));
reset role;
select lives_ok($$delete from public.appraisal_cases where id=(select (value->>'id')::uuid from attribution_fixture where key='cleanup_case')$$,'unsubmitted draft cleanup can cascade attribution');
select is((select count(*) from public.referral_case_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='cleanup_case')),0::bigint,'draft cleanup leaves no dangling referral');

create function pg_temp.prepare_referral_commerce_case(
  requested_case_id uuid,
  requested_owner_id uuid,
  requested_email text
)
returns void
language plpgsql
as $$
declare
  review_report_id uuid := gen_random_uuid();
  details_input_id uuid := gen_random_uuid();
  analysis_job_id uuid := gen_random_uuid();
  analysis_run_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  digest_value text := replace(requested_case_id::text, '-', '')
    || replace(requested_case_id::text, '-', '');
begin
  update public.appraisal_cases set status='check_complete' where id=requested_case_id and user_id=requested_owner_id;

  insert into public.total_loss_case_details (
    case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
    vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
    insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
    analysis_input_id
  ) values (
    requested_case_id, 'manual', '1HGCM82633A004352', 2022, 'Honda',
    'Accord', 'EX-L', 32000, '60601', '2026-08-20', 'Example Insurance',
    18000, statement_timestamp(), 1, details_input_id
  );

  insert into public.total_loss_case_contacts (
    case_id, full_name, email, service_terms_version,
    service_terms_acknowledged_at, privacy_notice_version,
    privacy_notice_acknowledged_at, operational_follow_up_allowed,
    operational_follow_up_updated_at
  ) values (
    requested_case_id, 'Commerce Customer', requested_email, '2026-08-23',
    statement_timestamp(), '2026-08-23', statement_timestamp(), false,
    statement_timestamp()
  );

  insert into public.total_loss_analysis_jobs (
    id, case_id, source_report_upload_id, source_details_updated_at, status,
    attempt_count, processing_token, processing_expires_at, run_id,
    failure_code, retryable, finished_at, source_intake_mode,
    source_analysis_input_revision, source_analysis_input_id
  ) values (
    analysis_job_id, requested_case_id, null, statement_timestamp(),
    'completed', 1, gen_random_uuid(), null, analysis_run_id, null, null,
    statement_timestamp(), 'manual', 1, details_input_id
  );

  insert into public.analysis_runs (
    id, job_id, case_id, artifact, request_digest,
    analysis_run_schema_version, analysis_version,
    discrepancy_analysis_version, comparable_scoring_version
  ) values (
    analysis_run_id, analysis_job_id, requested_case_id,
    jsonb_build_object(
      'runId', analysis_run_id::text,
      'result', jsonb_build_object(
        'discrepancyResult', jsonb_build_object(
          'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
        )
      )
    ), digest_value,
    '4', '4', '1', '1'
  );

  insert into public.total_loss_preliminary_snapshots (
    id, case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
    source_intake_mode, source_report_upload_id,
    source_analysis_input_revision, source_analysis_input_id,
    preliminary_classification, insurer_valuation_minor_units,
    supported_range_low_minor_units, supported_range_median_minor_units,
    supported_range_high_minor_units, currency, analysis_run_schema_version,
    analysis_version, discrepancy_analysis_version,
    comparable_scoring_version, presentation_schema_version,
    snapshot_schema_version, source_references, snapshot, snapshot_digest
  ) values (
    snapshot_id, requested_case_id, analysis_job_id, analysis_run_id,
    requested_owner_id, 'manual', null, 1, details_input_id,
    'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
    'USD', '4', '4', '1', '1', '1', '1',
    jsonb_build_object('analysisRun', analysis_run_id::text),
    jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
    digest_value
  );

  insert into public.total_loss_claim_workflows (
    case_id, preliminary_snapshot_id, phase, current_task
  ) values (requested_case_id, snapshot_id, 'review', 'secure_claim');
  -- New checkout fixtures include a stored, validated full-review report.
  insert into public.total_loss_full_review_reports(
    id,case_id,source_run_id,source_input_id,storage_owner_id,storage_object_name,
    original_filename,document_sha256,byte_size,status,extraction,readiness,extracted_at)
  values (review_report_id,requested_case_id,analysis_run_id,details_input_id,requested_owner_id,
    requested_owner_id::text || '/' || requested_case_id::text || '/review-reports/' || review_report_id::text || '.pdf',
    'fixture.pdf',repeat('a',64),123,'ready',jsonb_build_object('documentSha256',repeat('a',64)),
    '{"stage":"full_review","ready":true,"issues":[]}'::jsonb,statement_timestamp());
  insert into storage.objects(bucket_id,name,metadata) select storage_bucket,storage_object_name,
    '{"mimetype":"application/pdf","size":123}'::jsonb from public.total_loss_full_review_reports where id=review_report_id;

end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000009',true);
insert into attribution_fixture values('finance_case',to_jsonb(public.get_or_create_referred_total_loss_draft((select value->>'code' from attribution_fixture where key='link1'))));
reset role;
select pg_temp.prepare_referral_commerce_case((select (value->>'id')::uuid from attribution_fixture where key='finance_case'),'f8100000-0000-4000-8000-000000000009','referral-attribution-9@example.test');
set local role service_role;
insert into attribution_fixture select 'checkout',to_jsonb(r) from public.reserve_total_loss_checkout(
  (select (value->>'id')::uuid from attribution_fixture where key='finance_case'),'f8100000-0000-4000-8000-000000000009',
  'f8500000-0000-4000-8000-000000000001','total_loss_package','1','price_referral_fixture',9900,'USD','terms-1','refund-1',false) r;
reset role;
select is((select count(*) from public.referral_order_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),1::bigint,'checkout freezes one attribution on the logical order');
select is((select a.commission_amount_minor_units from public.referral_order_attributions o join public.referral_case_attributions a on a.id=o.attribution_id where o.case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),4500,'order preserves the signed commission snapshot');
set local role service_role;
select lives_ok($$select public.reserve_total_loss_checkout((select (value->>'id')::uuid from attribution_fixture where key='finance_case'),'f8100000-0000-4000-8000-000000000009','f8500000-0000-4000-8000-000000000001','total_loss_package','1','price_referral_fixture',9900,'USD','terms-1','refund-1',false)$$,'checkout reservation replay remains valid');
reset role;
select is((select count(*) from public.referral_order_attributions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),1::bigint,'reservation replay does not duplicate order attribution');
insert into attribution_fixture values('paid_at',to_jsonb(statement_timestamp()));
create function pg_temp.fulfill_referral_fixture(p_duplicate boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb; c jsonb=(select value from attribution_fixture where key='checkout');
 suffix text=case when p_duplicate then 'duplicate' else 'first' end;
 attempt uuid=case when p_duplicate then 'f8500000-0000-4000-8000-000000000003'::uuid else (c->>'checkout_attempt_id')::uuid end;
 lease uuid=case when p_duplicate then 'f8600000-0000-4000-8000-000000000002'::uuid else 'f8600000-0000-4000-8000-000000000001'::uuid end;
begin
 select to_jsonb(x) into r from public.fulfill_total_loss_checkout_payment(
  (c->>'case_id')::uuid,(c->>'order_id')::uuid,attempt,'cs_referral_'||suffix,'pi_referral_'||suffix,'evt_referral_'||suffix,lease,
  'price_referral_fixture',1,9900,'USD',false,(select (value#>>'{}')::timestamptz from attribution_fixture where key='paid_at')) x;
 return r;
end;
$$;
set local role service_role;
select throws_ok($$select pg_temp.fulfill_referral_fixture()$$,'55000',null,'purchase conversion requires a claimed signed webhook');
select public.claim_stripe_webhook_event('evt_referral_first','checkout.session.completed',false,null,repeat('a',64),500,
  (select (value#>>'{}')::timestamptz from attribution_fixture where key='paid_at'),'f8600000-0000-4000-8000-000000000001');
insert into attribution_fixture values('paid',pg_temp.fulfill_referral_fixture());
select is((select value->>'outcome' from attribution_fixture where key='paid'),'fulfilled','verified fulfillment succeeds with referral conversion');
select is(pg_temp.fulfill_referral_fixture()->>'outcome','already_fulfilled','exact payment replay remains idempotent');
reset role;
select is((select count(*) from public.referral_purchase_conversions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),1::bigint,'payment replay records one historical conversion');
select is((select payment_transaction_id from public.referral_purchase_conversions where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),'conversion points to immutable first successful payment evidence');
select throws_ok($$update public.referral_purchase_conversions set purchased_at=statement_timestamp() where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')$$,'55000',null,'historical conversion cannot be rewritten');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')->'summary',
  '{"submitted_count":2,"purchased_count":1,"refunded_count":0,"under_review_count":0}'::jsonb,'submitted and historical purchase counts reflect actual events');
select is(public.referral_partner_operation('referral_list','{"partner_id":"f8200000-0000-4000-8000-000000000001","page":2,"page_size":1}')->>'total','2','pagination retains exact total');
set local role service_role;
insert into attribution_fixture select 'refund',to_jsonb(r) from public.reserve_total_loss_refund(
  (select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),'f8500000-0000-4000-8000-000000000002','FIXTURE_REFUND','retain') r;
select public.record_total_loss_refund_result((select (value->>'refund_request_id')::uuid from attribution_fixture where key='refund'),
  're_referral_fixture','evt_referral_refund','txn_referral_refund',null,'succeeded',statement_timestamp(),null);
set local role authenticated;
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')->'summary',
  '{"submitted_count":2,"purchased_count":1,"refunded_count":1,"under_review_count":0}'::jsonb,'full refund changes current state while retaining the historical purchase count');
reset role;
select is((select status::text from public.case_entitlements where case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case')),'refunded_access_retained','retained report access does not erase refunded referral status');
set local role service_role;
select public.record_total_loss_refund_result((select (value->>'refund_request_id')::uuid from attribution_fixture where key='refund'),
  're_referral_fixture','evt_referral_refund_reversal','txn_referral_refund','txn_referral_refund_reversal','failed',statement_timestamp()+interval '1 second','REFUND_FAILED');
set local role authenticated;
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,refunded_count}','0','authoritative refund reversal restores current purchase status');
set local role service_role;
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_referral_fixture','evt_referral_dispute_active','charge.dispute.created','active',9900,'USD',statement_timestamp());
set local role authenticated;
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')->'summary',
  '{"submitted_count":2,"purchased_count":1,"refunded_count":0,"under_review_count":1}'::jsonb,'adverse dispute appears under review without erasing the purchase');
set local role service_role;
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_referral_fixture','evt_referral_dispute_won','charge.dispute.closed','won',9900,'USD',statement_timestamp()+interval '1 second');
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_referral_fixture','evt_referral_dispute_stale','charge.dispute.updated','active',9900,'USD',statement_timestamp()-interval '1 second');
set local role authenticated;
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,under_review_count}','0','a favorable dispute and later stale event preserve the current paid projection');
reset role;
insert into public.checkout_attempts(id,case_id,order_id,client_request_id,request_chain_id,attempt_generation,payment_provider,provider_livemode,status,amount_minor_units,currency)
select 'f8500000-0000-4000-8000-000000000003',(value->>'case_id')::uuid,(value->>'order_id')::uuid,'f8500000-0000-4000-8000-000000000003','f8500000-0000-4000-8000-000000000003',1,'stripe',false,'creating',9900,'USD'
from attribution_fixture where key='checkout';
set local role service_role;
select public.claim_stripe_webhook_event('evt_referral_duplicate','checkout.session.completed',false,null,repeat('b',64),500,
  (select (value#>>'{}')::timestamptz from attribution_fixture where key='paid_at'),'f8600000-0000-4000-8000-000000000002');
select is(pg_temp.fulfill_referral_fixture(true)->>'outcome','duplicate_payment','second successful charge remains explicit duplicate payment');
reset role;
select is((select count(*) from public.payment_transactions where order_id=(select (value->>'order_id')::uuid from attribution_fixture where key='checkout') and transaction_kind='payment'),2::bigint,'both successful charges retain material financial evidence');
select is((select count(*) from public.referral_purchase_conversions where order_id=(select (value->>'order_id')::uuid from attribution_fixture where key='checkout')),1::bigint,'duplicate charge does not create another conversion');
select is((select payment_transaction_id from public.referral_purchase_conversions where order_id=(select (value->>'order_id')::uuid from attribution_fixture where key='checkout')),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),'duplicate charge never changes original conversion identity');
set local role authenticated;
select is(public.referral_partner_operation('referral_summary','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,purchased_count}','1','partner purchase count does not inflate from duplicate charges');
reset role;
select * from finish();
rollback;
