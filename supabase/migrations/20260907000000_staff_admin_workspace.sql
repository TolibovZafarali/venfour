-- Read-only founder operations, with explicit projections and database staff gating.
create function public.staff_admin_require_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members member
    join auth.users identity on identity.id = member.user_id
    where member.user_id = (select auth.uid())
      and not coalesce(identity.is_anonymous, false)
  ) then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
end;
$$;

create function public.staff_admin_facts(variadic entries text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', entries[n], 'value', entries[n+1]) order by n), '[]'::jsonb)
  from generate_series(1, cardinality(entries), 2) n;
$$;

create function public.staff_admin_row(
  row_id text, case_id uuid, customer_id uuid, title text, subtitle text, summary text,
  status text, kind text, identity text, verified boolean, case_count integer,
  attention_reasons text[], created_at timestamptz, updated_at timestamptz,
  facts jsonb default '[]', sections jsonb default '[]'
) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id',row_id,'caseId',case_id,'customerId',customer_id,'title',title,'subtitle',subtitle,
    'summary',summary,'status',status,'kind',kind,'identity',identity,'verified',verified,
    'caseCount',case_count,'attentionReasons',coalesce(to_jsonb(array_remove(attention_reasons,null)),'[]'),
    'createdAt',created_at,'updatedAt',updated_at,'facts',facts,'sections',sections
  );
$$;

create view public.staff_admin_case_index_internal as
select operation.*,
  workflow.phase::text as workflow_phase, workflow.current_task,
  workflow.current_package_job_id, workflow.current_report_version_id,
  workflow.current_response_analysis_job_id, workflow.resolution_code, workflow.resolved_at,
  workflow.revision as workflow_revision,
  coalesce(workflow.current_task, operation.case_stage::text) as current_status,
  operation.case_status <> 'closed' and workflow.resolved_at is null as is_active,
  greatest(operation.last_activity_at, workflow.updated_at,
    package.updated_at, response.updated_at, finance.updated_at, event.created_at) as activity_at,
  array_remove(array[
    case when workflow.case_id is null and operation.case_stage in ('analysis_failed','needs_attention')
      then coalesce(operation.analysis_failure_code, operation.case_stage::text) end,
    case when workflow.case_id is null and operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp() then 'REPORT_UPLOAD_EXPIRED' end,
    case when workflow.case_id is null and operation.intake_mode = 'report'
      and operation.report_last_upload_id is not null and operation.report_upload_id is null
      and not operation.canonical_report_available then 'REPORT_UPLOAD_INCOMPLETE' end,
    case when workflow.resolved_at is null and package.status in ('failed','retryable_failed','review_required','new_evidence_required')
      then coalesce(package.failure_code, 'PACKAGE_' || upper(package.status)) end,
    case when workflow.resolved_at is null and response.status in ('retryable_failed','terminal_failed','unsupported')
      then coalesce(response.failure_code, 'RESPONSE_' || upper(response.status)) end,
    case when workflow.resolved_at is null and (package.status='waiting_human_review' or exists (
      select 1 from public.total_loss_release_reviews review
      left join public.total_loss_report_versions version on version.id = review.report_version_id
      where review.case_id = operation.case_id and review.status in ('queued','in_review')
        and (review.report_version_id = workflow.current_report_version_id
          or version.package_job_id = workflow.current_package_job_id)
    )) then 'REPORT_REVIEW_HOLD' end,
    case when exists (
      select 1 from public.commerce_refund_requests refund
      where refund.case_id = operation.case_id and refund.status in ('failed','canceled')
        and not exists (select 1 from public.commerce_refund_requests successor
          where successor.order_id = refund.order_id and successor.reason_code = refund.reason_code
            and successor.created_at > refund.created_at and successor.status not in ('failed','canceled'))
    ) then 'REFUND_FAILED' end,
    case when exists (select 1 from public.commerce_disputes dispute
      where dispute.case_id = operation.case_id and dispute.status = 'active') then 'ACTIVE_PAYMENT_DISPUTE' end
  ]::text[], null) as attention_reasons
from public.total_loss_case_operations_internal operation
left join public.total_loss_claim_workflows workflow on workflow.case_id = operation.case_id
left join public.total_loss_package_jobs package on package.id = workflow.current_package_job_id
left join public.total_loss_insurer_response_analysis_jobs response on response.id = workflow.current_response_analysis_job_id
left join lateral (
  select max(changed.updated_at) as updated_at from (
    select updated_at from public.commerce_orders where case_id = operation.case_id
    union all select updated_at from public.commerce_refund_requests where case_id = operation.case_id
    union all select updated_at from public.commerce_disputes where case_id = operation.case_id
  ) changed
) finance on true
left join lateral (select max(created_at) as created_at from public.total_loss_workflow_events
  where case_id = operation.case_id) event on true
where operation.service_type = 'total_loss';

create function public.staff_admin_rows_internal(
  requested_resource text, include_details boolean default true, requested_record_id text default null
)
returns table (
  id text, case_id uuid, customer_id uuid, status text, kind text, identity text,
  verified boolean, has_cases boolean, attention boolean, active boolean,
  search_text text, created_at timestamptz, updated_at timestamptz, payload jsonb
) language plpgsql stable security definer set search_path = '' as $$
begin
  if requested_resource = 'cases' then
    return query select c.case_id::text, c.case_id, c.owner_user_id, c.current_status,
      'total_loss'::text, case when c.owner_is_anonymous then 'guest' else 'account' end,
      c.verified_email is not null, true, cardinality(c.attention_reasons)>0, c.is_active,
      concat_ws(' ', c.case_id, c.owner_user_id, c.customer_full_name, c.contact_full_name,
        c.verified_email, c.contact_email, c.vehicle_year,c.vehicle_make,c.vehicle_model,c.vehicle_trim,c.vin),
      c.case_created_at, c.activity_at,
      public.staff_admin_row(c.case_id::text,c.case_id,c.owner_user_id,
        coalesce(c.customer_full_name,c.contact_full_name,c.verified_email,c.contact_email,'Unnamed customer'),
        coalesce(c.verified_email,c.contact_email), nullif(concat_ws(' ',c.vehicle_year,c.vehicle_make,c.vehicle_model,c.vehicle_trim),''),
        c.current_status,'total_loss',case when c.owner_is_anonymous then 'guest' else 'account' end,
        c.verified_email is not null,null,c.attention_reasons,c.case_created_at,c.activity_at,
        public.staff_admin_facts('Initial stage',c.case_stage::text,'Workflow phase',c.workflow_phase,
          'Current task',c.current_task,'Case status',c.case_status::text,'Verified account email',c.verified_email,
          'Entered contact name',c.contact_full_name,'Entered contact email',c.contact_email,
          'Entered email verified',c.contact_email_verified::text,'Identity claimed at',c.identity_claimed_at::text,
          'Follow-up allowed',c.operational_follow_up_allowed::text,'Resolution',c.resolution_code),
        jsonb_build_array(jsonb_build_object('title','Recorded milestones','facts',
          public.staff_admin_facts('Case created',c.case_created_at::text,'Intake completed',c.intake_completed_at::text,
            'Report uploaded',c.report_uploaded_at::text,'Report facts confirmed',c.report_facts_confirmed_at::text,
            'Initial analysis finished',c.analysis_job_finished_at::text,'Case resolved',c.resolved_at::text)),
          jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
            'Case ID',c.case_id::text,'Account ID',c.owner_user_id::text,'Workflow revision',c.workflow_revision::text,
            'Current package job ID',c.current_package_job_id::text,'Current report version ID',c.current_report_version_id::text,
            'Current response analysis job ID',c.current_response_analysis_job_id::text))))
    from public.staff_admin_case_index_internal c
    where requested_record_id is null or c.case_id::text=requested_record_id;
  elsif requested_resource = 'customers' then
    return query select u.id::text, null::uuid, u.id,
      case when u.email_confirmed_at is not null then 'verified' else 'unverified' end,
      case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
      case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
      u.email_confirmed_at is not null, cases.case_count > 0, false, false,
      concat_ws(' ',u.id,case when p.full_name_confirmed_at is not null then p.display_name end,u.email), u.created_at, greatest(u.updated_at,p.updated_at,cases.updated_at,u.created_at),
      public.staff_admin_row(u.id::text,null,u.id,
        coalesce(case when p.full_name_confirmed_at is not null then nullif(btrim(p.display_name),'') end,u.email,'Guest identity'),
        u.email, cases.case_count::text || ' total-loss cases',
        case when u.email_confirmed_at is not null then 'verified' else 'unverified' end,
        case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
        case when coalesce(u.is_anonymous,false) then 'guest' else 'account' end,
        u.email_confirmed_at is not null,cases.case_count,'{}',u.created_at,greatest(u.updated_at,p.updated_at,cases.updated_at,u.created_at),
        public.staff_admin_facts('Confirmed name',case when p.full_name_confirmed_at is not null then p.display_name end,
          'Name confirmed at',p.full_name_confirmed_at::text,'Account email',u.email,
          'Email verified at',u.email_confirmed_at::text,'Follow-up allowed',p.operational_follow_up_allowed::text,
          'Follow-up preference recorded',p.operational_follow_up_updated_at::text,'Total-loss cases',cases.case_count::text),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Account ID',u.id::text,'Account created',u.created_at::text,'Profile updated',p.updated_at::text))))
    from auth.users u left join public.profiles p on p.id=u.id
    cross join lateral (select count(*)::integer case_count,max(c.last_activity_at) updated_at
      from public.appraisal_cases c where c.user_id=u.id and c.service_type='total_loss') cases
    where (not coalesce(u.is_anonymous,false) or cases.case_count>0)
      and (requested_record_id is null or u.id::text=requested_record_id);
  elsif requested_resource = 'reports' then
    return query
    select 'upload:' || coalesce(c.report_last_upload_id,c.case_id)::text, c.case_id,c.owner_user_id,
      case when c.canonical_report_available then 'uploaded' when c.report_upload_id is not null then 'uploading' else 'unavailable' end,
      'uploaded'::text,case when c.owner_is_anonymous then 'guest' else 'account' end,
      c.verified_email is not null,true,not c.canonical_report_available,false,
      concat_ws(' ',c.case_id,c.report_original_filename,c.customer_full_name,c.contact_full_name,c.contact_email,c.verified_email),
      coalesce(c.report_uploaded_at,c.details_created_at,c.case_created_at),coalesce(c.details_updated_at,c.case_updated_at),
      public.staff_admin_row('upload:' || coalesce(c.report_last_upload_id,c.case_id)::text,c.case_id,c.owner_user_id,
        coalesce(c.report_original_filename,'Valuation report source'),coalesce(c.customer_full_name,c.contact_full_name),
        'Uploaded valuation source',case when c.canonical_report_available then 'uploaded' when c.report_upload_id is not null then 'uploading' else 'unavailable' end,
        'uploaded',case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,null,
        case when c.canonical_report_available then '{}'::text[] else array['REPORT_SOURCE_UNAVAILABLE'] end,
        coalesce(c.report_uploaded_at,c.details_created_at,c.case_created_at),coalesce(c.details_updated_at,c.case_updated_at),
        public.staff_admin_facts('Source','Customer upload','Provider',c.report_provider_name,'Extraction status',c.report_extraction_status,
          'Uploaded at',c.report_uploaded_at::text,'Facts confirmed at',c.report_facts_confirmed_at::text,
          'Upload expires at',c.report_upload_expires_at::text),jsonb_build_array(jsonb_build_object('title','Technical details','facts',
          public.staff_admin_facts('Upload ID',c.report_last_upload_id::text,'Storage owner ID',c.report_storage_owner_id::text,
            'Storage object',c.report_storage_object_path,'Input revision',c.analysis_input_revision::text)) ))
    from public.staff_admin_case_index_internal c
    where (c.report_last_upload_id is not null or c.report_upload_id is not null or c.report_original_filename is not null)
      and (requested_record_id is null or 'upload:' || coalesce(c.report_last_upload_id,c.case_id)::text=requested_record_id)
    union all
    select d.id::text,d.case_id,c.owner_user_id,d.status,'uploaded'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,d.status='failed',false,
      concat_ws(' ',d.id,d.case_id,d.original_filename,d.document_kind,c.customer_full_name,c.contact_email,c.verified_email),d.created_at,d.updated_at,
      public.staff_admin_row(d.id::text,d.case_id,c.owner_user_id,coalesce(d.original_filename,'Uploaded document'),
        coalesce(c.customer_full_name,c.contact_full_name),d.document_kind,d.status,'uploaded',
        case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,null,
        case when d.status='failed' then array[d.failure_code] else '{}'::text[] end,d.created_at,d.updated_at,
        public.staff_admin_facts('Document kind',d.document_kind,'Media type',d.media_type,'Bytes',d.byte_size::text,
          'Sealed at',d.sealed_at::text,'Failure',d.failure_code,'Upload expires at',d.insurer_response_upload_expires_at::text),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Document ID',d.id::text,'Storage bucket',d.storage_bucket_id,'Storage object',d.storage_object_name))))
    from public.total_loss_claim_documents d join public.staff_admin_case_index_internal c on c.case_id=d.case_id
    where d.document_kind='insurer_response' and (requested_record_id is null or d.id::text=requested_record_id)
      and not exists (select 1 from public.total_loss_report_versions v where v.document_id=d.id)
    union all
    select v.id::text,v.case_id,c.owner_user_id,v.status,'generated'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,
      holds.review_count>0,false,
      concat_ws(' ',v.id,v.case_id,d.original_filename,v.version_number,c.customer_full_name,c.contact_email,c.verified_email),v.created_at,v.updated_at,
      public.staff_admin_row(v.id::text,v.case_id,c.owner_user_id,'Valuation report · version ' || v.version_number,
        coalesce(c.customer_full_name,c.contact_full_name),d.original_filename,v.status,'generated',
        case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,null,
        case when holds.review_count>0 then array['REPORT_REVIEW_HOLD'] else '{}'::text[] end,v.created_at,v.updated_at,
        public.staff_admin_facts('Version',v.version_number::text,'Generated at',v.generated_at::text,
          'Published at',v.published_at::text,'Current version',(series.current_report_version_id=v.id)::text,
          'Current published version',(series.current_published_report_version_id=v.id)::text,
          'Superseded',exists(select 1 from public.total_loss_report_versions successor where successor.supersedes_report_version_id=v.id)::text,
          'Failure',v.failure_code,'PDF bytes',v.pdf_byte_size::text),
        holds.rows || jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Version ID',v.id::text,'Series ID',v.report_series_id::text,'Document ID',v.document_id::text,
          'Supersedes version ID',v.supersedes_report_version_id::text,'Package job ID',v.package_job_id::text,
          'Renderer version',v.renderer_version,'Template version',v.template_version,'Schema version',v.schema_version))))
    from public.total_loss_report_versions v join public.staff_admin_case_index_internal c on c.case_id=v.case_id
    join public.total_loss_report_series series on series.id=v.report_series_id
    left join public.total_loss_claim_documents d on d.id=v.document_id
    cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('title','Release review','facts',public.staff_admin_facts(
      'Review ID',review.id::text,'Status',review.status,'Decision',review.decision,'Due at',review.due_at::text,
      'Resolved at',review.resolved_at::text)) order by review.created_at desc,review.id desc) filter (where include_details),'[]') rows, count(*) review_count
      from public.total_loss_release_reviews review where review.report_version_id=v.id and review.status in ('queued','in_review')) holds
    where requested_record_id is null or v.id::text=requested_record_id;
  elsif requested_resource = 'processing' then
    return query
    select j.id::text,j.case_id,c.owner_user_id,j.status::text,'initial_analysis'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,
      j.id=c.analysis_job_id and c.current_task is null and j.status='failed',
      j.id=c.analysis_job_id and c.current_task is null and j.status='processing',
      concat_ws(' ',j.id,j.case_id,j.failure_code,c.customer_full_name,c.contact_email,c.verified_email),j.created_at,j.updated_at,
      public.staff_admin_row(j.id::text,j.case_id,c.owner_user_id,'Initial analysis',coalesce(c.customer_full_name,c.contact_full_name),
        'Valuation screening',j.status::text,'initial_analysis',case when c.owner_is_anonymous then 'guest' else 'account' end,
        c.verified_email is not null,null,case when j.id=c.analysis_job_id and c.current_task is null and j.status='failed'
          then array[j.failure_code] else '{}'::text[] end,j.created_at,j.updated_at,
        public.staff_admin_facts('Attempts',j.attempt_count::text,'Failure',j.failure_code,'Retryable',j.retryable::text,
          'Processing expires at',j.processing_expires_at::text,'Finished at',j.finished_at::text,
          'Current',(j.id=c.analysis_job_id and c.current_task is null)::text),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Job ID',j.id::text,'Analysis run ID',j.run_id::text,'Input ID',j.source_analysis_input_id::text,
          'Input revision',j.source_analysis_input_revision::text,'Source upload ID',j.source_report_upload_id::text))))
    from public.total_loss_analysis_jobs j join public.staff_admin_case_index_internal c on c.case_id=j.case_id
    where requested_record_id is null or j.id::text=requested_record_id
    union all
    select j.id::text,j.case_id,c.owner_user_id,j.status,'paid_package'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,
      j.id=c.current_package_job_id and c.resolved_at is null and j.status in ('failed','retryable_failed','review_required','new_evidence_required','waiting_human_review'),
      j.id=c.current_package_job_id and c.resolved_at is null and j.status in ('queued','processing','source_frozen','assessment_ready','report_generating','waiting_ai_review'),
      concat_ws(' ',j.id,j.case_id,j.failure_code,c.customer_full_name,c.contact_email,c.verified_email),j.created_at,j.updated_at,
      public.staff_admin_row(j.id::text,j.case_id,c.owner_user_id,'Paid package',coalesce(c.customer_full_name,c.contact_full_name),
        'Report preparation and review',j.status,'paid_package',case when c.owner_is_anonymous then 'guest' else 'account' end,
        c.verified_email is not null,null,case when j.id=c.current_package_job_id and c.resolved_at is null
          and j.status in ('failed','retryable_failed','review_required','new_evidence_required','waiting_human_review')
          then array[coalesce(j.failure_code,'REPORT_REVIEW_HOLD')] else '{}'::text[] end,j.created_at,j.updated_at,
        public.staff_admin_facts('Attempts',j.attempt_count::text,'Failure',j.failure_code,'Retryable',j.retryable::text,
          'Processing expires at',j.processing_expires_at::text,'Started at',j.started_at::text,'Finished at',j.finished_at::text,
          'Current',coalesce(j.id=c.current_package_job_id,false)::text),
        children.rows || jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Job ID',j.id::text,'Entitlement ID',j.entitlement_id::text,'Supersedes job ID',j.supersedes_package_job_id::text))))
    from public.total_loss_package_jobs j join public.staff_admin_case_index_internal c on c.case_id=j.case_id
    cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('title','Work item · ' || work.work_type,'facts',
      public.staff_admin_facts('Work item ID',work.id::text,'Status',work.status,'Attempts',work.attempt_count::text,
        'Dispatch attempts',work.dispatch_attempt_count::text,'Failure',work.last_error_code,'Retryable',work.retryable::text,
        'Next attempt at',work.next_attempt_at::text,'Processing expires at',work.processing_expires_at::text,
        'Dispatch expires at',work.dispatch_expires_at::text,'Completed at',work.completed_at::text,'Failed at',work.failed_at::text))
      order by work.created_at,work.id),'[]') rows from public.workflow_work_items work where include_details and work.package_job_id=j.id) children
    where requested_record_id is null or j.id::text=requested_record_id
    union all
    select j.id::text,j.case_id,c.owner_user_id,j.status,'insurer_response'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,
      j.id=c.current_response_analysis_job_id and c.resolved_at is null and j.status in ('retryable_failed','terminal_failed','unsupported'),
      j.id=c.current_response_analysis_job_id and c.resolved_at is null and j.status in ('pending','processing'),
      concat_ws(' ',j.id,j.case_id,j.failure_code,c.customer_full_name,c.contact_email,c.verified_email),j.created_at,j.updated_at,
      public.staff_admin_row(j.id::text,j.case_id,c.owner_user_id,'Insurer response',coalesce(c.customer_full_name,c.contact_full_name),
        'Response analysis',j.status,'insurer_response',case when c.owner_is_anonymous then 'guest' else 'account' end,
        c.verified_email is not null,null,case when j.id=c.current_response_analysis_job_id and c.resolved_at is null
          and j.status in ('retryable_failed','terminal_failed','unsupported') then array[j.failure_code] else '{}'::text[] end,j.created_at,j.updated_at,
        public.staff_admin_facts('Attempts',j.attempt_count::text,'Failure',j.failure_code,'Retryable',j.retryable::text,
          'Next attempt at',j.next_attempt_at::text,'Processing expires at',j.processing_expires_at::text,'Completed at',j.completed_at::text,
          'Failed at',j.failed_at::text,'Superseded at',j.superseded_at::text,'Current',coalesce(j.id=c.current_response_analysis_job_id,false)::text),
        jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Job ID',j.id::text,'Response ID',j.response_communication_id::text,'Round ID',j.negotiation_round_id::text,
          'Source report version ID',j.source_report_version_id::text,'Current run ID',j.current_run_id::text))))
    from public.total_loss_insurer_response_analysis_jobs j join public.staff_admin_case_index_internal c on c.case_id=j.case_id
    where requested_record_id is null or j.id::text=requested_record_id;
  elsif requested_resource = 'payments' then
    return query select o.id::text,o.case_id,c.owner_user_id,o.status::text,'order'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,
      cardinality(billing_attention.reasons)>0,
      false,concat_ws(' ',o.id,o.case_id,o.purchaser_email,o.product_identifier,c.customer_full_name,c.contact_email,c.verified_email),o.created_at,greatest(o.updated_at,entitlement.updated_at,child_activity.updated_at),
      public.staff_admin_row(o.id::text,o.case_id,c.owner_user_id,'Order ' || left(o.id::text,8),
        coalesce(c.customer_full_name,c.contact_full_name),o.product_identifier,o.status::text,'order',
        case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,null,
        billing_attention.reasons,
        o.created_at,greatest(o.updated_at,entitlement.updated_at,child_activity.updated_at),
        public.staff_admin_facts('Amount',o.currency || ' ' || o.amount_minor_units || ' minor units','Currency',o.currency,
          'Mode',case when o.provider_livemode is true then 'Live' when o.provider_livemode is false then 'Test' else 'Not recorded' end,
          'Purchaser email',o.purchaser_email,'Paid at',o.paid_at::text,'Refunded at',o.refunded_at::text,
          'Access status',entitlement.status::text,'Access reason',entitlement.reason_code,'Access revoked at',entitlement.revoked_at::text),
        ledger.rows || jsonb_build_array(jsonb_build_object('title','Technical details','facts',public.staff_admin_facts(
          'Order ID',o.id::text,'Entitlement ID',entitlement.id::text,'Product version',o.product_version,
          'Terms version',o.terms_version,'Refund policy version',o.refund_policy_version))))
    from public.commerce_orders o join public.staff_admin_case_index_internal c on c.case_id=o.case_id
    left join public.case_entitlements entitlement on entitlement.order_id=o.id
    cross join lateral (select array_remove(array[
      case when exists (select 1 from public.commerce_disputes d where d.order_id=o.id and d.status='active')
        then 'ACTIVE_PAYMENT_DISPUTE' end,
      case when exists (select 1 from public.commerce_refund_requests r
        where r.order_id=o.id and r.status in ('failed','canceled') and not exists (
          select 1 from public.commerce_refund_requests successor where successor.order_id=r.order_id
            and successor.reason_code=r.reason_code and successor.created_at>r.created_at
            and successor.status not in ('failed','canceled'))) then 'REFUND_FAILED' end
    ]::text[],null) reasons) billing_attention
    cross join lateral (select max(changed.updated_at) updated_at from (
      select a.updated_at from public.checkout_attempts a where a.order_id=o.id
      union all select t.recorded_at from public.payment_transactions t where t.order_id=o.id
      union all select r.updated_at from public.commerce_refund_requests r where r.order_id=o.id
      union all select d.updated_at from public.commerce_disputes d where d.order_id=o.id
    ) changed) child_activity
    cross join lateral (select coalesce(jsonb_agg(record.section order by record.at desc,record.id desc),'[]') rows, max(record.at) updated_at from (
      select a.updated_at at,a.id,jsonb_build_object('title','Checkout attempt','facts',public.staff_admin_facts(
        'Attempt ID',a.id::text,'Status',a.status,'Amount',a.currency || ' ' || a.amount_minor_units || ' minor units',
        'Mode',case when a.provider_livemode is true then 'Live' when a.provider_livemode is false then 'Test' else 'Not recorded' end,
        'Failure',a.failure_code,'Created at',a.created_at::text,'Expires at',a.expires_at::text,'Finished at',a.finished_at::text)) section
      from public.checkout_attempts a where a.order_id=o.id
      union all select t.recorded_at,t.id,jsonb_build_object('title','Transaction · ' || t.transaction_kind,'facts',public.staff_admin_facts(
        'Transaction ID',t.id::text,'Kind',t.transaction_kind,'Amount',t.currency || ' ' || t.amount_minor_units || ' minor units',
        'Related transaction ID',t.related_transaction_id::text,'Provider occurred at',t.provider_occurred_at::text,'Recorded at',t.recorded_at::text))
      from public.payment_transactions t where t.order_id=o.id
      union all select r.updated_at,r.id,jsonb_build_object('title','Refund request','facts',public.staff_admin_facts(
        'Refund ID',r.id::text,'Status',r.status,'Provider status',r.provider_status,
        'Mode',case when r.provider_livemode then 'Live' else 'Test' end,'Amount',r.currency || ' ' || r.amount_minor_units || ' minor units',
        'Reason',r.reason_code,'Failure',r.failure_code,'Access policy',r.access_policy,
        'Refund transaction ID',r.refund_transaction_id::text,'Refund reversal transaction ID',r.refund_reversal_transaction_id::text,
        'Created at',r.created_at::text,'Finished at',r.finished_at::text))
      from public.commerce_refund_requests r where r.order_id=o.id
      union all select d.updated_at,d.id,jsonb_build_object('title','Payment dispute','facts',public.staff_admin_facts(
        'Dispute ID',d.id::text,'Status',d.status,'Mode',case when d.provider_livemode then 'Live' else 'Test' end,
        'Amount',d.currency || ' ' || d.amount_minor_units || ' minor units','Opened at',d.opened_at::text,'Closed at',d.closed_at::text,
        'Funds withdrawn at',d.funds_withdrawn_occurred_at::text,'Funds reinstated at',d.funds_reinstated_occurred_at::text))
      from public.commerce_disputes d where d.order_id=o.id
    ) record where include_details) ledger
    where requested_record_id is null or o.id::text=requested_record_id;
  elsif requested_resource = 'activity' then
    return query select e.id::text,e.case_id,c.owner_user_id,e.event_type,'workflow_event'::text,
      case when c.owner_is_anonymous then 'guest' else 'account' end,c.verified_email is not null,true,false,false,
      concat_ws(' ',e.id,e.case_id,e.event_type,e.actor_type,c.customer_full_name,c.contact_email,c.verified_email),e.created_at,e.created_at,
      public.staff_admin_row(e.id::text,e.case_id,c.owner_user_id,e.event_type,coalesce(c.customer_full_name,c.contact_full_name),
        e.actor_type,e.event_type,'workflow_event',case when c.owner_is_anonymous then 'guest' else 'account' end,
        c.verified_email is not null,null,'{}',e.created_at,e.created_at,
        public.staff_admin_facts('Event',e.event_type,'Actor category',e.actor_type,'Recorded at',e.created_at::text,
          'Associated entity',e.associated_entity_type),jsonb_build_array(jsonb_build_object('title','Technical details','facts',
          public.staff_admin_facts('Event ID',e.id::text,'Actor account ID',e.actor_user_id::text,
            'Associated entity ID',e.associated_entity_id::text))))
    from public.total_loss_workflow_events e join public.staff_admin_case_index_internal c on c.case_id=e.case_id
    where requested_record_id is null or e.id::text=requested_record_id;
  else
    raise exception using errcode='22023',message='Unknown staff resource.';
  end if;
end;
$$;

create function public.staff_admin_list(
  resource text, search text default '', filters jsonb default '{}', sort text default 'updated',
  page integer default 1, page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; filter_key text; filter_value jsonb;
begin
  perform public.staff_admin_require_access();
  if resource is null or resource not in ('cases','customers','reports','processing','payments','activity')
    or search is null or char_length(search)>200 or sort is null or sort not in ('updated','created')
    or page is null or page<1 or page>1000000 or page_size is null or page_size<1 or page_size>100
    or filters is null or jsonb_typeof(filters)<>'object' or pg_column_size(filters)>4096 then
    raise exception using errcode='22023',message='Invalid staff list arguments.';
  end if;
  for filter_key,filter_value in select key,value from jsonb_each(filters) loop
    if filter_key not in ('caseId','customerId','status','kind','identity','verified','hasCases','attention','active')
      or jsonb_typeof(filter_value)<>'string' then
      raise exception using errcode='22023',message='Invalid staff list filter.';
    end if;
    if (filter_key in ('verified','hasCases','attention','active') and filters->>filter_key not in ('true','false'))
      or (filter_key='identity' and filters->>filter_key not in ('account','guest'))
      or (filter_key in ('status','kind') and filters->>filter_key !~ '^[A-Za-z0-9_.-]{1,100}$') then
      raise exception using errcode='22023',message='Invalid staff list filter value.';
    end if;
    if filter_key in ('caseId','customerId') then
      begin perform (filters->>filter_key)::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='22023',message='Invalid staff identity filter.';
      end;
    end if;
  end loop;
  with matching as materialized (
    select row.* from public.staff_admin_rows_internal(resource,false) row
    where (search='' or strpos(lower(row.search_text),lower(btrim(search)))>0)
      and (not filters?'caseId' or row.case_id=(filters->>'caseId')::uuid)
      and (not filters?'customerId' or row.customer_id=(filters->>'customerId')::uuid)
      and (not filters?'status' or row.status=filters->>'status')
      and (not filters?'kind' or row.kind=filters->>'kind')
      and (case when resource='customers' then row.identity=coalesce(filters->>'identity','account')
        else not filters?'identity' or row.identity=filters->>'identity' end)
      and (not filters?'verified' or row.verified=(filters->>'verified')::boolean)
      and (not filters?'hasCases' or row.has_cases=(filters->>'hasCases')::boolean)
      and (not filters?'attention' or row.attention=(filters->>'attention')::boolean)
      and (not filters?'active' or row.active=(filters->>'active')::boolean)
  ), selected as (
    select row.* from matching row order by
      case when sort='created' then row.created_at else row.updated_at end desc,row.id desc
    limit page_size offset ((page::bigint-1)*page_size)
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_set(selected.payload,'{sections}','[]') order by
      case when sort='created' then selected.created_at else selected.updated_at end desc,selected.id desc) from selected),'[]'),
    'total',(select count(*) from matching),'page',page,'pageSize',page_size,'asOf',statement_timestamp()) into result;
  return result;
end;
$$;

create function public.staff_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return jsonb_build_object('asOf',statement_timestamp(),
    'activeCases',(select count(*) from public.staff_admin_case_index_internal where is_active),
    'attentionCases',(select count(*) from public.staff_admin_case_index_internal where cardinality(attention_reasons)>0),
    'processingJobs',(select count(*) from public.staff_admin_rows_internal('processing',false) where active),
    'registeredAccounts',(select count(*) from auth.users where not coalesce(is_anonymous,false)),
    'attention',public.staff_admin_list('cases','',jsonb_build_object('attention','true'),'updated',1,5)->'items',
    'activity',public.staff_admin_list('activity','','{}','updated',1,8)->'items');
end;
$$;

create function public.staff_admin_customer(requested_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return (select payload from public.staff_admin_rows_internal('customers',true,requested_user_id::text) where customer_id=requested_user_id);
end;
$$;

create function public.staff_admin_case(requested_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  return (select payload from public.staff_admin_rows_internal('cases',true,requested_case_id::text) where case_id=requested_case_id);
end;
$$;

create function public.staff_admin_record(resource text, requested_record_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  if resource is null or resource not in ('reports','processing','payments','activity')
    or requested_record_id is null or char_length(requested_record_id)>512
    or btrim(requested_record_id)='' then
    raise exception using errcode='22023',message='Invalid staff record arguments.';
  end if;
  return (select payload from public.staff_admin_rows_internal(resource,true,requested_record_id)
    where id=requested_record_id);
end;
$$;

revoke all on public.staff_admin_case_index_internal from public, anon, authenticated, service_role;
revoke all on function public.staff_admin_require_access(), public.staff_admin_facts(text[]),
  public.staff_admin_row(text,uuid,uuid,text,text,text,text,text,text,boolean,integer,text[],timestamptz,timestamptz,jsonb,jsonb),
  public.staff_admin_rows_internal(text,boolean,text), public.staff_admin_list(text,text,jsonb,text,integer,integer),
  public.staff_admin_overview(), public.staff_admin_customer(uuid), public.staff_admin_case(uuid), public.staff_admin_record(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_admin_list(text,text,jsonb,text,integer,integer),
  public.staff_admin_overview(), public.staff_admin_customer(uuid), public.staff_admin_case(uuid), public.staff_admin_record(text,text) to authenticated;

comment on function public.staff_admin_list(text,text,jsonb,text,integer,integer) is
  'Permanent-staff-only total-loss operations and account directory, with validated filters, bounded pagination, and explicit safe display fields.';
comment on view public.staff_admin_case_index_internal is
  'Private total-loss operational index; workflow pointers keep historical failures separate from current attention.';

comment on function public.staff_admin_record(text,text) is
  'Permanent-staff-only demand-loaded metadata for one total-loss operational record; lists omit nested detail sections.';
