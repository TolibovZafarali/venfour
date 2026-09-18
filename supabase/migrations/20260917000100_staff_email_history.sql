-- Metadata-only staff history for outgoing email. It intentionally omits bodies,
-- provider payloads, tokens, and other email-design controls.
create function public.staff_email_history()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_admin_require_access();
  if not exists(select 1 from auth.users where id=auth.uid()
    and email_confirmed_at is not null and deleted_at is null) then
    raise exception using errcode='42501',message='Verified staff access required.';
  end if;
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(item order by (item->>'createdAt')::timestamptz desc,item->>'id' desc)
    from (
      select jsonb_build_object(
        'id','delivery:' || delivery.id::text,'source',delivery.source,'templateKey',delivery.template_key,
        'recipient',delivery.recipient_email,'subject',null,'status',delivery.status,
        'attempts',case when delivery.source='auth' then null else delivery.attempts end,
        'createdAt',delivery.created_at,'acceptedAt',delivery.accepted_at,
        'deliveryStatus',(select event.event_type from public.communication_events event
          where event.provider_message_id=delivery.provider_message_id
          order by case when event.event_type in ('email.complained','email.bounced','email.failed','email.suppressed') then 0
            when event.event_type='email.delivered' then 1 else 2 end,event.occurred_at desc limit 1),
        'caseId',delivery.case_id) item
      from public.communication_deliveries delivery
      union all
      select jsonb_build_object(
        'id','partner:' || job.id::text,'source','partner','templateKey',job.payload->>'kind',
        'recipient',job.payload->>'recipient_email','subject',null,'status',job.status,
        'attempts',job.attempts,'createdAt',job.created_at,
        'acceptedAt',case when job.status='completed' then job.finished_at end,
        'deliveryStatus',(select event.event_type from public.communication_events event
          where event.provider_message_id=job.provider_message_id
          order by case when event.event_type in ('email.complained','email.bounced','email.failed','email.suppressed') then 0
            when event.event_type='email.delivered' then 1 else 2 end,event.occurred_at desc limit 1),
        'caseId',null) item
      from public.referral_partner_jobs job where job.kind='email'
      union all
      select jsonb_build_object(
        'id','preview:' || preview.id::text,'source','preview','templateKey',preview.kind,
        'recipient',preview.recipient_email,'subject',null,'status',preview.status,
        'attempts',preview.attempt_count,'createdAt',preview.created_at,'acceptedAt',preview.sent_at,
        'deliveryStatus',null,'caseId',preview.case_id) item
      from public.total_loss_preview_emails preview
    ) history
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.staff_email_history() from public, anon, authenticated, service_role;
grant execute on function public.staff_email_history() to authenticated;
comment on function public.staff_email_history() is
  'Staff-only metadata history of outgoing email. It excludes message bodies, provider payloads, and authentication tokens.';
