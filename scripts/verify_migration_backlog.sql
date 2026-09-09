-- Read-only postflight for the reviewed 63-migration release.
-- Run as the database migration owner while application writers remain paused.
\set ON_ERROR_STOP on
begin read only;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$
declare
  expected_versions text[] := array['20260818000000','20260818000100','20260819000000','20260819000100','20260819000200','20260820000000','20260823000000','20260823000100','20260823000200','20260823000300','20260823000400','20260823000500','20260824000000','20260824000100','20260824000150','20260824000200','20260824000300','20260824000400','20260825000000','20260825000100','20260825000200','20260825000300','20260825000400','20260825000500','20260826000000','20260826000100','20260826000200','20260826000300','20260829000000','20260829000100','20260829000200','20260830000100','20260901000000','20260901000100','20260901000200','20260901000300','20260901000400','20260901000500','20260902000100','20260902000200','20260902000300','20260902000400','20260902000500','20260902000600','20260902000700','20260903000000','20260903000100','20260904000000','20260904000100','20260904000200','20260904000300','20260904000400','20260905000000','20260905000100','20260905000200','20260905000300','20260907000000','20260908000000','20260908000100','20260909000100','20260909000200','20260909000300','20260909000400'];
  signature text;
  role_name text;
  relation_name text;
begin
  assert (select array_agg(version order by version) from supabase_migrations.schema_migrations)
    = expected_versions, 'Migration history differs from the reviewed sequence';
  assert not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
    'An application table lacks RLS';
  assert not exists(select 1 from pg_index i join pg_class c on c.oid=i.indrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (not i.indisvalid or not i.indisready)),
    'Invalid or unready application index';
  assert not exists(select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and not c.convalidated), 'Unvalidated application constraint';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'),
    'Disabled application trigger';

  foreach relation_name in array array[
    'market_request_accounts','market_request_cases','market_request_attempts',
    'total_loss_market_search_progress','referral_case_attributions','referral_order_attributions','referral_purchase_conversions'
  ] loop
    assert to_regclass('public.'||relation_name) is not null, 'Required table missing: '||relation_name;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      assert not has_table_privilege(role_name,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        'Private table is directly exposed: '||relation_name||' to '||role_name;
    end loop;
  end loop;

  foreach signature in array array[
    'public.reserve_market_request_attempt(jsonb)', 'public.get_market_request_usage(jsonb)',
    'public.record_market_request_account_state(jsonb)',
    'public.get_case_market_search_progress(uuid,uuid,uuid,text,integer)',
    'public.save_case_market_search_progress(uuid,uuid,uuid,text,jsonb,integer)',
    'public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)',
    'public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)'
  ] loop
    assert to_regprocedure(signature) is not null, 'Required RPC missing: '||signature;
    assert has_function_privilege('service_role',signature,'EXECUTE')
      and not has_function_privilege('anon',signature,'EXECUTE')
      and not has_function_privilege('authenticated',signature,'EXECUTE'), 'Service RPC grants differ: '||signature;
  end loop;
  foreach signature in array array[
    'public.anonymous_guest_has_protected_referral(uuid)',
    'public.guard_referral_attribution_guest_cleanup()',
    'public.is_abandoned_anonymous_guest_eligible(uuid,timestamp with time zone)',
    'public.total_loss_customer_report_projection_internal(uuid)'
  ] loop
    assert to_regprocedure(signature) is not null, 'Required private function missing: '||signature;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      assert not has_function_privilege(role_name,signature,'EXECUTE'), 'Private helper exposed: '||signature;
    end loop;
  end loop;
  assert (select count(*)=2 from pg_trigger where tgrelid='public.referral_case_attributions'::regclass
    and tgname in ('referral_case_attributions_guard_guest_cleanup','referral_case_attributions_protect')
    and tgenabled='O'), 'Referral protection triggers missing';
  assert position('anonymous_guest_has_protected_referral' in
    pg_get_functiondef('public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)'::regprocedure))>0
    and position('anonymous_guest_has_protected_referral' in
    pg_get_functiondef('public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)'::regprocedure))>0,
    'Cleanup boundary is missing referral protection';
  assert not exists(select 1 from auth.users u where public.anonymous_guest_has_protected_referral(u.id)
    and public.is_abandoned_anonymous_guest_eligible(u.id)), 'Protected referral is cleanup eligible';
  assert not exists(select 1 from public.total_loss_claim_workflows w
    where w.current_task in ('insurer_response_received','insurer_response_reviewing')
      and (w.current_response_analysis_job_id is null or not exists(
        select 1 from public.total_loss_insurer_response_analysis_jobs j
        where j.id=w.current_response_analysis_job_id and j.case_id=w.case_id))),
    'Response workflow has no matching analysis job';
  assert not exists(select 1 from public.total_loss_claim_documents d
    where d.document_kind='insurer_response' and d.status='pending' and d.insurer_response_upload_expires_at is null),
    'Pending response upload has no expiry';
  assert not exists(select 1 from public.referral_partners p
    join public.referral_partner_agreements a on a.id=p.current_agreement_id and a.partner_id=p.id
    where p.status='active' and a.status='countersigned'
    and not exists(select 1 from public.referral_partner_links l where l.partner_id=p.id)),
    'Active signed referral partner lacks its link';
  assert position('higherPricedComparableListings' in
    pg_get_functiondef('public.total_loss_customer_report_projection_internal(uuid)'::regprocedure))>0,
    'Supporting-listing projection is missing';
  assert has_function_privilege('authenticated','public.resolve_total_loss_case_claim(uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.staff_admin_overview()','EXECUTE')
    and not has_function_privilege('anon','public.staff_admin_overview()','EXECUTE'), 'Customer/staff RPC grant mismatch';
  assert (select relrowsecurity from pg_class where oid='storage.objects'::regclass), 'Storage RLS is disabled';
end;
$$;
select 'PASS: reviewed migration history, catalog, grants and backfills' as result;
-- These are operational observations, not mutations. Investigate pre-existing
-- started protection conflicts before re-enabling cleanup; never auto-delete them.
select state, count(*) as protected_cleanup_candidates,
  count(*) filter(where storage_deletion_started_at is not null) as started_before_protection
from public.anonymous_guest_cleanup_candidates c
where public.anonymous_guest_has_protected_referral(c.user_id) group by state order by state;
select count(*) as request_ledger_rows from public.market_request_attempts;
select count(*) as search_checkpoint_rows from public.total_loss_market_search_progress;
select jobname,active,schedule from cron.job where jobname like 'venfour-%' order by jobname;
select tablename,policyname,roles,cmd from pg_policies
where schemaname='storage' order by tablename,policyname;
rollback;
