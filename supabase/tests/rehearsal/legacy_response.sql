-- A published paid report, sent request, correction chain and unfinished upload
-- already exist at the hosted cutoff; the backlog must backfill their lineage.
do $$
declare
  c uuid := (select id from rehearsal.identities where name='paid_case');
  owner_id uuid := (select id from rehearsal.identities where name='paid_owner');
  report_id uuid := (select current_report_version_id from public.total_loss_claim_workflows where case_id=c);
  round_id uuid := 'e9700000-0000-4000-8000-000000000001';
  draft_id uuid := 'e9700000-0000-4000-8000-000000000002';
  message_id uuid := 'e9700000-0000-4000-8000-000000000003';
  outbound_id uuid := 'e9700000-0000-4000-8000-000000000004';
  response_id uuid := 'e9700000-0000-4000-8000-000000000005';
  correction_id uuid := 'e9700000-0000-4000-8000-000000000006';
  document_id uuid := 'e9700000-0000-4000-8000-000000000007';
  pending_id uuid := 'e9700000-0000-4000-8000-000000000008';
begin
  insert into public.total_loss_negotiation_rounds(id,case_id,round_number,status) values(round_id,c,1,'response_received');
  insert into public.total_loss_message_drafts(id,case_id,negotiation_round_id,report_version_id,purpose,recipient,subject,body)
  values(draft_id,c,round_id,report_id,'initial_reconsideration','adjuster@example.test','Synthetic review','Please review this fictional report.');
  insert into public.total_loss_message_versions(id,case_id,message_draft_id,negotiation_round_id,report_version_id,
    version_number,message_state,purpose,recipient,subject,body,message_digest,sent_at)
  values(message_id,c,draft_id,round_id,report_id,1,'customer_reported_sent','initial_reconsideration',
    'adjuster@example.test','Synthetic review','Please review this fictional report.',repeat('9',64),statement_timestamp()-interval '2 days');
  insert into public.total_loss_communications(id,case_id,negotiation_round_id,direction,channel,communication_type,status,
    original_content,occurred_at,confirmed_at,message_version_id)
  values(outbound_id,c,round_id,'outbound','email','initial_reconsideration_request','confirmed','Synthetic request',
    statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',message_id);
  update public.total_loss_negotiation_rounds set originating_communication_id=outbound_id,revision=revision+1 where id=round_id;
  insert into public.total_loss_communications(id,case_id,negotiation_round_id,direction,channel,communication_type,status,
    original_content,occurred_at,confirmed_at,supersedes_communication_id)
  values(response_id,c,round_id,'inbound','pasted_message','insurer_response','confirmed','Synthetic initial response',
    statement_timestamp()-interval '1 day',statement_timestamp()-interval '1 day',null),
    (correction_id,c,round_id,'inbound','uploaded_document','insurer_response','draft','Synthetic correction',
    null,null,response_id);
  insert into public.total_loss_claim_documents(id,case_id,document_kind,storage_bucket_id,storage_object_name,
    original_filename,media_type,byte_size,content_digest,status,sealed_at,created_by_user_id,created_at)
  values(document_id,c,'insurer_response','case-files',owner_id||'/'||c||'/insurer-responses/'||document_id||'.pdf',
    'response.pdf','application/pdf',24,repeat('a',64),'ready',statement_timestamp(),owner_id,statement_timestamp()-interval '1 day'),
    (pending_id,c,'insurer_response','case-files',owner_id||'/'||c||'/insurer-responses/'||pending_id||'.pdf',
    'unfinished.pdf','application/pdf',24,repeat('b',64),'pending',null,owner_id,statement_timestamp()-interval '1 day');
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
  select storage_bucket_id,storage_object_name,jsonb_build_object('mimetype',media_type,'size',byte_size),
    jsonb_build_object('clientRequestId',id,'originalName',original_filename,'contentDigest',content_digest)
  from public.total_loss_claim_documents where id in (document_id,pending_id);
  insert into public.total_loss_communication_documents(case_id,communication_id,document_id,display_order)
  values(c,correction_id,document_id,1);
  update public.total_loss_communications set status='confirmed',occurred_at=statement_timestamp(),confirmed_at=statement_timestamp()
  where id=correction_id;
  update public.total_loss_claim_workflows set phase='negotiation',current_task='insurer_response_received',
    current_negotiation_round_id=round_id,revision=revision+1 where case_id=c;
end;
$$;
