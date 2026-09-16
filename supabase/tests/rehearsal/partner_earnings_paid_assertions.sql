reset role;
insert into attribution_fixture(key,value) select 'event',jsonb_build_object('partner_id','f8200000-0000-4000-8000-000000000001','entry_id',value->>'id','request_id',gen_random_uuid(),'reviewer_id','f8100000-0000-4000-8000-000000000001','expected_revision',0,'kind','paid','reason','Fictional reconciled payment','payment_reference','fixture-transfer-001') from attribution_fixture where key='awarded';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.referral_commission_worker('event',(select value from attribution_fixture where key='event'))->>'revision','1','eligible commission records completed payment');
select is(public.referral_commission_worker('event',(select value from attribution_fixture where key='event'))->>'revision','1','payment replay does not double count');
select throws_ok($$select public.referral_commission_worker('event',(select value||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1) from attribution_fixture where key='event'))$$,'55000',null,'second payment record is denied');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,awaiting_payout_minor}','0','paid award leaves awaiting payout');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,paid_minor}','5000','paid to date increases once');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,earned_month_minor}','5000','payment does not erase earned month');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{items,0,status}','paid','referral shows completed payment');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
  (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
  'dp_earnings_paid','evt_earnings_paid_dispute','charge.dispute.created','active',9900,'USD',statement_timestamp());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{items,0,status}','recovery_review','paid dispute requires review instead of erasing payment');
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,paid_minor}','5000','disputed payment remains in paid history');
reset role;
select * from finish();
rollback;
