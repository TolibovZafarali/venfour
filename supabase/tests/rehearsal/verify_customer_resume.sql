-- Exercise records committed at the production cutoff, not newly seeded cases.
begin;
set local search_path=public,extensions;
select plan(10);
select set_config('request.jwt.claim.sub',(select id::text from rehearsal.identities where name='paid_owner'),true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('rehearsal.paid_case',(select id::text from rehearsal.identities where name='paid_case'),true);
select set_config('rehearsal.free_case',(select id::text from rehearsal.identities where name='free_case'),true);
select set_config('rehearsal.free_run',(select id::text from public.analysis_runs
  where case_id=current_setting('rehearsal.free_case')::uuid),true);
set local role authenticated;
select ok((select state='secured' and entitlement_status='active' and commerce_order_status='paid'
  and payment_status='succeeded' and not checkout_available
  from public.resolve_total_loss_case_claim(current_setting('rehearsal.paid_case')::uuid)),
  'migrated paid case resumes using its existing payment and entitlement');
select is((select next_task from public.resolve_total_loss_case_claim(current_setting('rehearsal.paid_case')::uuid)),
  'insurer_response_reviewing','legacy response resumes the backfilled analysis job');
select is((select count(*) from public.get_total_loss_customer_reports(current_setting('rehearsal.paid_case')::uuid,null)),
  1::bigint,'existing paid report remains accessible');
select ok((select not (report->'marketEvidence' ? 'higherPricedComparableListings')
  and not (report->'marketEvidence' ? 'marketSearchContext')
  from public.get_total_loss_customer_reports(current_setting('rehearsal.paid_case')::uuid,null)),
  'legacy report does not acquire invented supporting listings');
select ok((select state='secured' and workflow_phase is null and not checkout_available
  from public.resolve_total_loss_case_claim(current_setting('rehearsal.free_case')::uuid)),
  'completed free case keeps its existing resume contract');
select is((select count(*) from public.list_owned_case_operations()
  where case_id in (current_setting('rehearsal.free_case')::uuid,current_setting('rehearsal.paid_case')::uuid)),
  2::bigint,'customer history includes both migrated cases');
reset role;
set local role service_role;
select ok(public.get_owned_analysis_run(current_setting('rehearsal.free_run')::uuid,
  current_setting('request.jwt.claim.sub')::uuid) is not null,'free valuation artifact remains available to its owner');
select is(public.get_owned_analysis_run(current_setting('rehearsal.free_run')::uuid,
  'e9100000-0000-4000-8000-000000000004'),null::jsonb,'free valuation artifact remains hidden from another owner');
reset role;
set local role authenticated;
select throws_ok($$select public.confirm_total_loss_case_resolution(current_setting('rehearsal.paid_case')::uuid,
  'e9800000-0000-4000-8000-000000000001','RESOLVED_WITH_INSURER',
  (select workflow_revision from public.resolve_total_loss_case_claim(current_setting('rehearsal.paid_case')::uuid)))$$,
  '55000','Wait for the current insurer response review before closing this case.',
  'migrated pending response retains its resolution guard');
select is((select count(*) from public.get_total_loss_customer_reports(current_setting('rehearsal.paid_case')::uuid,null)),
  1::bigint,'rejected closure preserves historical report access');
select * from finish();
rollback;
