reset role;
select ok(not has_table_privilege('authenticated','public.referral_outcome_reviews','SELECT'),'review history is private');
select ok(not has_function_privilege('authenticated','public.referral_outcome_worker(jsonb)','EXECUTE'),'browser cannot invoke review worker');
select ok(not has_function_privilege('authenticated','public.referral_outcome_source_internal(uuid)','EXECUTE'),'source helper is private');
insert into attribution_fixture(key,value) select 'review_request',jsonb_build_object('partner_id',value->>'partner_id','attribution_id',value->>'attribution_id','request_id',gen_random_uuid(),
 'decision','needs_evidence','notes','Please retain the acceptance and refund review documents.','facts','{}'::jsonb,
 'source_digest',public.total_loss_canonical_jsonb_digest(public.referral_outcome_source_internal((value->>'attribution_id')::uuid))) from attribution_fixture where key='outcome';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.referral_partner_operation('outcome_queue','{"partner_id":"f8200000-0000-4000-8000-000000000001","page":1}')$$,'42501',null,'partner cannot read private review queue');
select throws_ok($$select public.referral_partner_operation('outcome_document',(select value||jsonb_build_object('document_id','f8700000-0000-4000-8000-000000000001') from attribution_fixture where key='review_request'))$$,'42501',null,'partner cannot download review evidence');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select is(public.referral_partner_operation('outcome_queue','{"partner_id":"f8200000-0000-4000-8000-000000000001","page":1}')->>'total','2','manager queue includes submitted referral');
select throws_ok($$select public.referral_partner_operation('outcome_get',(select value||jsonb_build_object('partner_id','f8200000-0000-4000-8000-000000000003') from attribution_fixture where key='review_request'))$$,'42501',null,'reference must belong to selected partner');
select is(public.referral_partner_operation('outcome_get',(select value from attribution_fixture where key='review_request'))#>>'{source,program_enabled}','true','review uses retained policy');
select is(jsonb_array_length(public.referral_partner_operation('outcome_get',(select value from attribution_fixture where key='review_request'))#>'{source,documents}'),3,'sealed case documents are available');
select is(public.referral_partner_operation('outcome_document',(select value||jsonb_build_object('document_id','f8700000-0000-4000-8000-000000000001') from attribution_fixture where key='review_request'))->>'digest',repeat('c',64),'private download includes integrity digest');
select is(public.referral_partner_operation('outcome_document',(select value||jsonb_build_object('document_id',gen_random_uuid()) from attribution_fixture where key='review_request')),null::jsonb,'unrelated document unavailable');
insert into attribution_fixture values('prepared_review',public.referral_partner_operation('outcome_prepare',(select value from attribution_fixture where key='review_request')));
reset role;
insert into attribution_fixture(key,value) select 'review_work',jsonb_build_object('request',r.value,'reviewer_id',c.value->>'reviewer_id','verified_at',c.value->>'verified_at','award',null)
 from attribution_fixture r cross join attribution_fixture c where r.key='review_request' and c.key='prepared_review';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.referral_outcome_worker((select value from attribution_fixture where key='review_work'))->>'revision','1','missing-evidence decision retained');
select is(public.referral_outcome_worker((select value from attribution_fixture where key='review_work'))->>'revision','1','decision retry is idempotent');
select throws_ok($$select public.referral_outcome_worker((select jsonb_set(value,'{request,notes}','"A changed explanation conflicts with the same request."') from attribution_fixture where key='review_work'))$$,'40001',null,'changed duplicate request rejected');
reset role;
select is((select count(*) from public.referral_commission_entries),0::bigint,'missing evidence does not create earnings');
select throws_ok($$update public.referral_outcome_reviews set notes='A replacement review note cannot rewrite history.'$$,'55000',null,'review cannot be overwritten');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('outcome_prepare',(select value from attribution_fixture where key='review_request'))#>>'{result,revision}','1','lost response recovers original decision');
select throws_ok($$select public.referral_partner_operation('outcome_prepare',(select value||jsonb_build_object('request_id',gen_random_uuid()) from attribution_fixture where key='review_request'))$$,'40001',null,'stale reviewer cannot decide again');
reset role;
insert into attribution_fixture(key,value) select 'approve_request',r.value||jsonb_build_object('request_id',gen_random_uuid(),'decision','approved','notes','Insurer evidence and retained review establish all qualifying facts.',
 'source_digest',public.total_loss_canonical_jsonb_digest(public.referral_outcome_source_internal((r.value->>'attribution_id')::uuid)),
 'facts',o.value||jsonb_build_object('review_document_id','f8700000-0000-4000-8000-000000000001'))
 from attribution_fixture r cross join attribution_fixture o where r.key='review_request' and o.key='outcome';
insert into attribution_fixture(key,value) select 'approve_work',jsonb_build_object('request',r.value,'reviewer_id',o.value->>'reviewer_id','verified_at',o.value->>'verified_at','award',a.value)
 from attribution_fixture r cross join attribution_fixture o cross join attribution_fixture a where r.key='approve_request' and o.key='outcome' and a.key='award';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.referral_outcome_worker((select jsonb_set(value,'{request,facts,review_document_id}',to_jsonb(gen_random_uuid()::text)) from attribution_fixture where key='approve_work'))$$,'22023',null,'nonretained supporting record rejected');
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
 (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
 'dp_review_fixture','evt_review_dispute_active','charge.dispute.created','active',9900,'USD',statement_timestamp());
select throws_ok($$select public.referral_outcome_worker((select value from attribution_fixture where key='approve_work'))$$,'40001',null,'payment dispute arriving during review prevents approval');
reset role;
select is((select count(*) from public.referral_commission_entries),0::bigint,'failed approval leaves no commission');
select is((select count(*) from public.referral_outcome_reviews),1::bigint,'failed approval leaves no decision');
set local role service_role;
select public.record_total_loss_dispute((select (value->>'case_id')::uuid from attribution_fixture where key='checkout'),
 (select (value->>'order_id')::uuid from attribution_fixture where key='checkout'),(select (value->>'payment_transaction_id')::uuid from attribution_fixture where key='paid'),
 'dp_review_fixture','evt_review_dispute_won','charge.dispute.closed','won',9900,'USD',statement_timestamp()+interval '1 second');
select is(public.referral_outcome_worker((select value from attribution_fixture where key='approve_work'))->>'decision','approved','approval posts commission transactionally');
select is(public.referral_outcome_worker((select value from attribution_fixture where key='approve_work'))->>'revision','2','approval retry preserves sequence');
reset role;
select is((select count(*) from public.referral_commission_entries),1::bigint,'only one commission posted');
select is((select count(*) from public.referral_outcome_reviews),2::bigint,'earlier evidence request preserved after approval');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.referral_partner_operation('outcome_get',(select value from attribution_fixture where key='review_request'))#>>'{source,recorded}','true','approved review is read only');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select is(public.referral_partner_operation('earnings','{"partner_id":"f8200000-0000-4000-8000-000000000001"}')#>>'{summary,earned_month_minor}','5000','business earnings reflect reviewed approval');
reset role;
delete from public.referral_partner_managers where user_id='f8100000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.referral_outcome_worker((select value from attribution_fixture where key='approve_work'))$$,'42501',null,'revoked manager cannot replay private decision');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.referral_partner_operation('outcome_queue','{"partner_id":"f8200000-0000-4000-8000-000000000001","page":1}')$$,'42501',null,'revocation blocks queue with same token');
reset role;
select * from finish();
rollback;
