-- Keep purchase identity projections neutral when the current permanent
-- account no longer matches the saved contact email. Ownership, transfer,
-- payment, and fulfillment decisions remain unchanged.

create or replace function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  order_row public.commerce_orders%rowtype;
  attempt_row public.checkout_attempts%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  result_row public.total_loss_case_claim_resume_result;
  safe_task text;
  next_state text;
  fulfillment_state text;
  fulfillment_retryable boolean := false;
  optional_skipped boolean := false;
  result_completed boolean := false;
  insurer_review_completed boolean := false;
  valuation_completed boolean := false;
  report_completed boolean := false;
  what_next_completed boolean := false;
  entitled_report boolean := false;
begin
  if authenticated_user_id is null or requested_case_id is null then return; end if;
  select auth_user.* into authenticated_user
  from auth.users as auth_user where auth_user.id = authenticated_user_id;
  if not found then return; end if;

  select contact.* into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';
  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal(requested_case_id)
  then return; end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.case_id = requested_case_id
  order by commerce_order.created_at desc, commerce_order.id desc limit 1;
  if order_row.id is not null then
    select checkout_attempt.* into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.order_id = order_row.id
    order by checkout_attempt.created_at desc, checkout_attempt.id desc limit 1;
    select entitlement.* into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = order_row.id;
  end if;
  if workflow_row.current_package_job_id is not null then
    select * into package_row from public.total_loss_package_jobs
    where id = workflow_row.current_package_job_id
      and case_id = requested_case_id;
  end if;
  if workflow_row.current_report_version_id is not null then
    select * into report_row from public.total_loss_report_versions
    where id = workflow_row.current_report_version_id
      and case_id = requested_case_id;
  end if;

  if coalesce(authenticated_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal(requested_case_id) then
      return;
    end if;
    result_row.state := 'secure_required';
  elsif authenticated_user.email_confirmed_at is not null
    and nullif(btrim(authenticated_user.email), '') is not null
    and lower(btrim(authenticated_user.email)) = contact_row.email then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  safe_task := case
    when workflow_row.current_task in (
      'report_generation_queued', 'report_generating', 'report_review_queued',
      'report_reviewing', 'refund_pending', 'report_revision_required',
      'finalizing', 'purchase_complete', 'package_queued'
    ) then 'finalizing'
    when workflow_row.current_task in ('exception_review', 'report_failed')
      then 'exception_review'
    when workflow_row.current_task in ('report_ready', 'prepare_request')
      then workflow_row.current_task
    when workflow_row.current_task = 'no_dispute_resolved' then 'no_dispute_supported'
    when workflow_row.current_task = 'awaiting_insurer_response'
      then 'awaiting_insurer_response'
    else workflow_row.current_task
  end;

  entitled_report := result_row.state = 'secured'
    and report_row.id is not null
    and public.total_loss_customer_report_access_internal(
      requested_case_id, report_row.id
    );

  if entitled_report then
    select
      bool_or(progress.skipped_at is not null)
        filter (where progress.step_identifier in ('insurer_review', 'valuation', 'report', 'what_next')),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'result'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'insurer_review'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'valuation'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'report'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'what_next')
    into optional_skipped, result_completed, insurer_review_completed,
      valuation_completed, report_completed, what_next_completed
    from public.total_loss_education_progress as progress
    where progress.case_id = requested_case_id
      and progress.report_version_id = report_row.id;
    optional_skipped := coalesce(optional_skipped, false);
    result_completed := coalesce(result_completed, false);
    insurer_review_completed := coalesce(insurer_review_completed, false);
    valuation_completed := coalesce(valuation_completed, false);
    report_completed := coalesce(report_completed, false);
    what_next_completed := coalesce(what_next_completed, false);
  end if;

  fulfillment_state := case
    when workflow_row.case_id is null then 'not_started'
    when entitlement_row.status in ('suspended', 'revoked')
      then 'needs_attention'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'refund_pending'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and order_row.id is not null then 'payment_pending'
    when safe_task = 'finalizing' then 'finalizing'
    when safe_task = 'exception_review' then 'exception_review'
    when safe_task in ('report_ready', 'prepare_request') then 'report_ready'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'secure_claim' then 'not_started'
    else 'needs_attention'
  end;
  fulfillment_retryable := coalesce(package_row.status = 'retryable_failed', false);

  next_state := case
    when result_row.state <> 'secured' then 'secure_claim'
    when workflow_row.case_id is null then null
    when entitlement_row.status in ('suspended', 'revoked') then 'needs_attention'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and attempt_row.status = 'complete'
      then 'checkout_confirmation'
    when entitlement_row.id is null then 'checkout'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'no_dispute'
    when safe_task in ('finalizing', 'exception_review') then 'processing'
    when safe_task not in ('report_ready', 'prepare_request') then 'needs_attention'
    when not entitled_report then 'needs_attention'
    when report_row.report #>> '{executiveConclusion,continuationStatus}'
      <> 'SUPPORTS_CONTINUATION' then 'no_dispute'
    when not result_completed then 'guide_result'
    when safe_task = 'prepare_request' or optional_skipped then 'prepare_request'
    when not insurer_review_completed then 'guide_insurer_review'
    when not valuation_completed then 'guide_valuation'
    when not report_completed then 'guide_report'
    when not what_next_completed then 'guide_what_next'
    else 'prepare_request'
  end;

  result_row.case_id := requested_case_id;
  result_row.contact_email := case
    when result_row.state = 'account_mismatch' then null
    else contact_row.email
  end;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := safe_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := coalesce((
    result_row.state = 'secured'
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'secure_claim'
    and entitlement_row.id is null
    and (
      order_row.id is null
      or (order_row.status = 'pending' and order_row.purchaser_email is not null)
    )
    and not exists (
      select 1 from public.checkout_attempts as completed_attempt
      where completed_attempt.order_id = order_row.id
        and completed_attempt.status = 'complete'
    )
  ), false);
  if result_row.state = 'secured' then
    result_row.commerce_order_status := order_row.status::text;
    result_row.payment_status := case
      when order_row.id is null then null
      when order_row.status = 'pending' then 'pending'
      when order_row.status = 'paid' then 'succeeded'
      when order_row.status in ('partially_refunded', 'refunded') then 'refunded'
      when order_row.status = 'disputed' then 'disputed'
      else null
    end;
    result_row.entitlement_status := entitlement_row.status::text;
    result_row.next_task := case
      when entitlement_row.status = 'suspended' then 'payment_review'
      when entitlement_row.status = 'revoked' then 'purchase_unavailable'
      when entitlement_row.id is not null
        and workflow_row.current_package_job_id is not null then safe_task
      when entitlement_row.id is not null then 'purchase_complete'
      when result_row.checkout_available then 'checkout'
      when order_row.status = 'void' then 'purchase_unavailable'
      else safe_task
    end;
    result_row.commerce_amount_minor_units := order_row.amount_minor_units;
    result_row.commerce_currency := order_row.currency;
    if workflow_row.case_id is null then
      result_row.checkout_available := false;
      result_row.commerce_order_status := null;
      result_row.payment_status := null;
      result_row.entitlement_status := null;
      result_row.next_task := null;
      result_row.commerce_amount_minor_units := null;
      result_row.commerce_currency := null;
      result_row.customer_journey := null;
    else
      result_row.customer_journey := jsonb_build_object(
        'nextState', next_state,
        'fulfillmentState', fulfillment_state,
        'retryable', fulfillment_retryable
      );
      if entitled_report then
        result_row.published_report :=
          public.total_loss_customer_report_projection_internal(report_row.id);
        result_row.education_progress :=
          public.total_loss_customer_education_projection_internal(
            requested_case_id, report_row.id
          );
        result_row.sending_details :=
          public.total_loss_customer_sending_projection_internal(
            requested_case_id, report_row.id
          );
        if report_row.report #>> '{executiveConclusion,continuationStatus}'
            = 'SUPPORTS_CONTINUATION'
        then
          result_row.message_draft :=
            public.total_loss_customer_message_draft_projection_internal(
              requested_case_id, report_row.id
            );
        end if;
      end if;
    end if;
  else
    result_row.commerce_order_status := null;
    result_row.payment_status := null;
    result_row.entitlement_status := null;
    result_row.next_task := null;
    result_row.commerce_amount_minor_units := null;
    result_row.commerce_currency := null;
    result_row.customer_journey := jsonb_build_object(
      'nextState', 'secure_claim',
      'fulfillmentState', 'not_started',
      'retryable', false
    );
  end if;
  return next result_row;
end;
$$;

create or replace function public.renew_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_renewal_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  recorded_at timestamptz := statement_timestamp();
  result_row public.total_loss_case_claim_renewal_result;
begin
  if authenticated_user_id is null or $1 is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext($1::text)
  );

  select auth_user.*
  into authenticated_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id
  for share;

  if not found then
    return;
  end if;

  select contact.*
  into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
  for update of appraisal_case, contact;

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal($1)
  then
    return;
  end if;

  result_row.case_id := $1;
  result_row.contact_email := contact_row.email;

  if not coalesce(authenticated_user.is_anonymous, false) then
    if authenticated_user.email_confirmed_at is not null
      and nullif(btrim(authenticated_user.email), '') is not null
      and lower(btrim(authenticated_user.email)) = contact_row.email
    then
      result_row.state := 'secured';
    else
      result_row.state := 'account_mismatch';
      result_row.contact_email := null;
    end if;
    return next result_row;
    return;
  end if;

  if not public.total_loss_case_identity_transfer_allowed_internal($1) then
    return;
  end if;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = $1
    and identity_claim.purpose = 'post_continue'
    and identity_claim.source_user_id = authenticated_user_id
    and identity_claim.requested_email = contact_row.email
    and identity_claim.claimed_at is null
    and identity_claim.revoked_at is null
    and identity_claim.expires_at > recorded_at
  for update;

  if not found then
    update public.total_loss_case_identity_claims as identity_claim
    set revoked_at = recorded_at
    where identity_claim.case_id = $1
      and identity_claim.purpose = 'post_continue'
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      purpose,
      expires_at
    )
    values (
      $1,
      authenticated_user_id,
      contact_row.email,
      'post_continue',
      recorded_at + interval '30 minutes'
    )
    returning * into claim_row;
  end if;

  result_row.state := 'secure_required';
  result_row.claim_id := claim_row.id;
  result_row.claim_expires_at := claim_row.expires_at;
  return next result_row;
end;
$$;
