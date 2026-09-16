reset role;
select ok(not has_table_privilege('authenticated','public.referral_commission_entries','SELECT') and not has_table_privilege('service_role','public.referral_commission_entries','INSERT'),'accounting tables are private');
select ok(not has_function_privilege('authenticated','public.referral_commission_worker(text,jsonb)','EXECUTE'),'browser cannot create awards or mark payments');
select ok(not has_function_privilege('authenticated','public.referral_partner_before_earnings_internal(text,jsonb)','EXECUTE'),'prior wrapper is private');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,earned_month_minor}','0','purchase alone creates no earnings');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{items,0,status}','unverified','unverified referral has no award');
select throws_ok($$select public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000002"}')$$,'42501',null,'cross-partner earnings denied');
select throws_ok($$select public.referral_partner_operation('staff_earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'partner cannot use manager earnings route');
select throws_ok($$select public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001","balance":90000}')$$,'22023',null,'unknown accounting fields denied');
select throws_ok($$select public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001","page":null}')$$,'22023',null,'null pagination denied');
reset role;
-- Sealed, fictional case documents for the trusted-writer contract.
insert into public.total_loss_claim_documents(id,case_id,document_kind,storage_bucket_id,storage_object_name,media_type,byte_size,content_digest,status,sealed_at)
select ('f8700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(value->>'id')::uuid,'insurer_evidence','test-evidence','earnings-fixture-'||n||'.pdf','application/pdf',100,repeat('c',64),'ready',statement_timestamp()
from attribution_fixture cross join generate_series(1,3) n where key='finance_case';
insert into attribution_fixture(key,value)
select 'outcome',jsonb_build_object('case_id',a.case_id,'partner_id',a.partner_id,'attribution_id',a.id,'agreement_digest',a.agreement_digest,
 'policy_id','verified-outcome-tiers-v1','service','total_loss','attributed_at',a.bound_at,'paid_at',c.purchased_at,'service_started_at',c.purchased_at,
 'baseline_communicated_at',a.bound_at-interval '1 day','accepted_at',statement_timestamp(),'verified_at',statement_timestamp(),
 'reviewer_id','f8100000-0000-4000-8000-000000000001','baseline_document_id','f8700000-0000-4000-8000-000000000001',
 'final_document_id','f8700000-0000-4000-8000-000000000002','acceptance_document_id','f8700000-0000-4000-8000-000000000003',
 'baseline_vehicle_value_minor',2000000,'final_vehicle_value_minor',2150000,'latest_written_baseline_confirmed',true,
 'equivalent_vehicle_components_confirmed',true,'process_completed',true,'insurer_evidence_verified',true,'final_acceptance_verified',true,
 'outcome_guarantee_eligible',false,'automatic_refund_due',false,'relevant_dispute_open',false,'refund','none','regulated_partner',false,'compliance_approval_id',null)
from public.referral_case_attributions a join public.referral_purchase_conversions c on c.attribution_id=a.id where a.case_id=(select (value->>'id')::uuid from attribution_fixture where key='finance_case');
insert into attribution_fixture(key,value) select 'award',jsonb_build_object('partner_id',value->>'partner_id','outcome',value,'sequence',1,
 'month',to_char((value->>'verified_at')::timestamptz at time zone 'America/Chicago','YYYY-MM'),'amount_minor',5000,
 'eligible_at',greatest((value->>'verified_at')::timestamptz,(value->>'paid_at')::timestamptz+interval '720 hours')) from attribution_fixture where key='outcome';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.referral_commission_worker('record',(select value||'{"sequence":2}'::jsonb from attribution_fixture where key='award'))$$,'40001',null,'stale sequence cannot skip the serialized ordinal');
select throws_ok($$select public.referral_commission_worker('record',(select value||'{"amount_minor":7500}'::jsonb from attribution_fixture where key='award'))$$,'22023',null,'first award cannot receive the tenth-case rate');
select throws_ok($$select public.referral_commission_worker('record',(select jsonb_set(value,'{outcome,agreement_digest}',to_jsonb(repeat('d',64))) from attribution_fixture where key='award'))$$,'22023',null,'award must match immutable agreement digest');
select throws_ok($$select public.referral_commission_worker('record',(select jsonb_set(value,'{outcome,baseline_document_id}','"f8700000-0000-4000-8000-000000000009"') from attribution_fixture where key='award'))$$,'22023',null,'nonexistent evidence cannot support award');
insert into attribution_fixture values('awarded',public.referral_commission_worker('record',(select value from attribution_fixture where key='award')));
select is(public.referral_commission_worker('record',(select value from attribution_fixture where key='award')),(select value from attribution_fixture where key='awarded'),'exact award replay is idempotent');
select throws_ok($$select public.referral_commission_worker('record',(select jsonb_set(value,'{outcome,final_vehicle_value_minor}','2200000') from attribution_fixture where key='award'))$$,'40001',null,'changed review cannot overwrite an award');
reset role;
select is((select count(*) from public.referral_commission_entries where partner_id='f8200000-0000-4000-8000-000000000001'),1::bigint,'one durable award');
select throws_ok($$update public.referral_commission_entries set amount_minor=7500$$,'55000',null,'award cannot be rewritten');
select throws_ok($$delete from public.referral_commission_entries$$,'55000',null,'award cannot be deleted');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,earned_month_minor}','5000','verified award increments earnings by fifty dollars');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,awaiting_payout_minor}','5000','unpaid award remains awaiting payout');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{items,0,status}','waiting','thirty-day waiting period is explicit');
select is((select array_agg(k order by k) from jsonb_object_keys(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>'{items,0}') k),array['amount_minor','eligible_at','paid_at','reference','status','verified_at']::text[],'projection excludes case, evidence, reviewer and payment reference');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_earnings_fixture','evt_earnings_dispute_active','charge.dispute.created','active',9900,'USD',statement_timestamp());
reset role;
select is((select status from public.referral_commission_rows_internal('f8200000-0000-4000-8000-000000000001')),'held','authoritative dispute holds unpaid commission immediately');
set local role service_role;
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_earnings_fixture','evt_earnings_dispute_won','charge.dispute.closed','won',9900,'USD',statement_timestamp()+interval '1 second');
reset role;
select is((select status from public.referral_commission_rows_internal('f8200000-0000-4000-8000-000000000001')),'waiting','resolved dispute retains the original waiting period');
reset role;
insert into attribution_fixture(key,value) select 'event',jsonb_build_object('partner_id','f8200000-0000-4000-8000-000000000001','entry_id',value->>'id','request_id',gen_random_uuid(),'reviewer_id','f8100000-0000-4000-8000-000000000001','expected_revision',0,'kind','hold','reason','Fictional review') from attribution_fixture where key='awarded';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.referral_commission_worker('event',(select value||'{"kind":"paid","payment_reference":"fixture-payment"}'::jsonb from attribution_fixture where key='event'))$$,'55000',null,'waiting commission cannot be marked paid');
select is(public.referral_commission_worker('event',(select value from attribution_fixture where key='event'))->>'revision','1','hold is appended');
select is(public.referral_commission_worker('event',(select value from attribution_fixture where key='event'))->>'revision','1','hold replay retains same revision');
select throws_ok($$select public.referral_commission_worker('event',(select value||jsonb_build_object('request_id',gen_random_uuid(),'kind','release') from attribution_fixture where key='event'))$$,'40001',null,'stale review cannot release hold');
reset role;
select is((select status from public.referral_commission_rows_internal('f8200000-0000-4000-8000-000000000001')),'held','hold retains award');
set local role service_role;
select public.referral_commission_worker('event',(select value||jsonb_build_object('request_id',gen_random_uuid(),'kind','release','expected_revision',1) from attribution_fixture where key='event'));
reset role;
select is((select status from public.referral_commission_rows_internal('f8200000-0000-4000-8000-000000000001')),'waiting','release does not skip waiting period');
set local role service_role;
select public.referral_commission_worker('event',(select value||jsonb_build_object('request_id',gen_random_uuid(),'kind','reverse','expected_revision',2) from attribution_fixture where key='event'));
reset role;
select is((select status from public.referral_commission_rows_internal('f8200000-0000-4000-8000-000000000001')),'reversed','reversal preserves original award');
select throws_ok($$delete from public.referral_commission_events$$,'55000',null,'adjustment history cannot be deleted');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,earned_month_minor}','0','reversed award is removed from net earnings');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,verified_month_count}','1','reversal never renumbers marginal tiers');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select is(public.referral_partner_operation('staff_earnings','{"partner_id":"f8200000-0000-4000-8000-000000000003"}')->>'availability','not_enabled','unconfigured agreement is not treated as a zero balance');
select is(public.referral_partner_operation('staff_earnings','{"partner_id":"f8200000-0000-4000-8000-000000000003"}')->'summary','null'::jsonb,'disabled program exposes no monetary totals');
reset role;
delete from public.referral_partner_managers where user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.referral_partner_operation('staff_earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')$$,'42501',null,'revoked manager cannot read earnings with the same token');
reset role;
select * from finish();
rollback;
