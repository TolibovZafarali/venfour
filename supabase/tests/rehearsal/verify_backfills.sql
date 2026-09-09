do $$
begin
  assert (select started_as_guest from public.total_loss_analysis_jobs where id='e9400000-0000-4000-8000-000000000005'),
    'Processing guest origin was not backfilled';
  assert not exists(select 1 from public.total_loss_analysis_jobs where status='completed' and started_as_guest),
    'Historical completed jobs were incorrectly marked as guest jobs';
  assert (select count(*) from public.total_loss_insurer_response_analysis_jobs
    where response_communication_id='e9700000-0000-4000-8000-000000000006')=1,
    'Latest legacy response did not acquire exactly one analysis job';
  assert not exists(select 1 from public.total_loss_insurer_response_analysis_jobs
    where response_communication_id='e9700000-0000-4000-8000-000000000005'),
    'Superseded response was incorrectly enqueued';
  assert (select w.current_response_analysis_job_id=j.id and w.revision=b.revision+1
    from public.total_loss_claim_workflows w join rehearsal.baseline_workflows b using(case_id)
    join public.total_loss_insurer_response_analysis_jobs j on j.case_id=w.case_id
    where w.case_id=(select id from rehearsal.identities where name='paid_case')),
    'Workflow pointer/revision backfill is not atomic and exact';
  assert (select insurer_response_upload_expires_at=created_at+interval '30 minutes'
    from public.total_loss_claim_documents where id='e9700000-0000-4000-8000-000000000008'),
    'Legacy pending upload expiry was not preserved';
  assert (select insurer_response_upload_expires_at is null
    from public.total_loss_claim_documents where id='e9700000-0000-4000-8000-000000000007'),
    'A ready response was incorrectly assigned a new upload lease';
  assert (select count(*) from public.total_loss_insurer_response_upload_sources
    where document_id in ('e9700000-0000-4000-8000-000000000007','e9700000-0000-4000-8000-000000000008'))=2,
    'Upload provenance backfill missed a ready/pending legacy document';
  assert (select count(*) from public.referral_partner_links where partner_id='e9600000-0000-4000-8000-000000000002')=1,
    'Active signed partner link backfill did not run';
  assert (select count(*) from public.referral_case_attributions where case_id in
    ('e9200000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000003'))=2,
    'New cleanup protection changed attribution history';
  assert public.anonymous_guest_has_protected_referral('e9100000-0000-4000-8000-000000000002'),
    'Submitted referral is unprotected';
  assert not public.is_abandoned_anonymous_guest_eligible('e9100000-0000-4000-8000-000000000002'),
    'Submitted referral remains cleanup eligible';
  assert public.is_abandoned_anonymous_guest_eligible('e9100000-0000-4000-8000-000000000001'),
    'Ordinary abandoned guest was incorrectly protected';
  assert public.is_abandoned_anonymous_guest_eligible('e9100000-0000-4000-8000-000000000003'),
    'Unsubmitted referral draft was incorrectly protected';
  assert not exists(select 1 from public.total_loss_analysis_report_evidence),
    'Migration fabricated missing historical normalized evidence';
  assert not exists(select 1 from public.market_request_attempts)
    and not exists(select 1 from public.total_loss_market_search_progress),
    'Schema installation created provider work or retained checkpoints';
  assert not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (not i.indisvalid or not i.indisready)),
    'Invalid/unready application index';
  assert not exists(select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and not c.convalidated), 'Unvalidated application constraint';
  assert not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity), 'Application table without RLS';
end;
$$;
