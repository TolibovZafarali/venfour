-- Preserve the saved source of an accepted insurer offer separately from its
-- exact record identity. Legacy accepted rows remain immutable; their owner
-- projection derives the source from the exact bound recommendation.
alter table public.total_loss_claim_workflows
  drop constraint total_loss_claim_workflows_customer_resolution_valid,
  add constraint total_loss_claim_workflows_customer_resolution_valid check (
    (case when resolution_code in ('ACCEPTED_VERIFIED_OFFER','RESOLVED_WITH_INSURER','CUSTOMER_STOPPED_PURSUING') then
      phase='resolution' and current_task='resolved'
      and jsonb_typeof(resolution_details)='object'
      and resolution_details ->> 'customerConfirmed'='true'
      and resolution_details ->> 'resolutionCode'=resolution_code
      and (resolution_details ->> 'resolvedAt')::timestamptz=resolved_at
      and resolution_details ->> 'clientRequestId' is not null
      and resolution_details ->> 'requestDigest' ~ '^[0-9a-f]{64}$'
      and resolution_details ->> 'confirmedByUserId' is not null
      and (case when resolution_code='ACCEPTED_VERIFIED_OFFER' then
        resolution_details ->> 'offerId' is not null
        and resolution_details ->> 'decisionId' is not null
        and resolution_details ->> 'recommendationId' is not null
        and resolution_details ->> 'responseId' is not null
        and resolution_details ->> 'amountSource' in
          ('VERIFIED_INSURER_OFFER','CUSTOMER_RECORDED','RESPONSE_TEXT')
        and (resolution_details ->> 'amountMinorUnits')::bigint > 0
        and resolution_details ->> 'currency' ~ '^[A-Z]{3}$'
      when resolution_code='RESOLVED_WITH_INSURER' then
        resolution_details ->> 'offerId' is null
        and resolution_details ->> 'decisionId' is null
        and resolution_details ->> 'recommendationId' is null
        and resolution_details ->> 'responseId' is null
        and ((resolution_details ->> 'amountMinorUnits' is null
          and resolution_details ->> 'currency' is null and resolution_details ->> 'amountSource' is null)
          or ((resolution_details ->> 'amountMinorUnits')::bigint > 0
            and resolution_details ->> 'currency' ~ '^[A-Z]{3}$'
            and resolution_details ->> 'amountSource'='CUSTOMER_REPORTED'))
      else
        resolution_details ->> 'offerId' is null and resolution_details ->> 'decisionId' is null
        and resolution_details ->> 'recommendationId' is null and resolution_details ->> 'responseId' is null
        and resolution_details ->> 'amountMinorUnits' is null and resolution_details ->> 'currency' is null
        and resolution_details ->> 'amountSource' is null
      end)
    else resolution_details is null end) is true
  );

create or replace function public.total_loss_case_resolution_projection_internal(requested_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('code',workflow.resolution_code,'resolvedAt',workflow.resolved_at,
    'customerConfirmed',coalesce((workflow.resolution_details ->> 'customerConfirmed')::boolean,false),
    'clientRequestId',workflow.resolution_details -> 'clientRequestId',
    'offerId',workflow.resolution_details -> 'offerId',
    'amountMinorUnits',workflow.resolution_details -> 'amountMinorUnits',
    'currency',workflow.resolution_details -> 'currency',
    'amountSource',case when workflow.resolution_code='ACCEPTED_VERIFIED_OFFER'
      then recommendation.recommendation #> '{offer,source}'
      else workflow.resolution_details -> 'amountSource' end,
    'recommendationId',workflow.resolution_details -> 'recommendationId',
    'decisionId',workflow.resolution_details -> 'decisionId',
    'responseId',workflow.resolution_details -> 'responseId')
  from public.total_loss_claim_workflows workflow
  left join public.total_loss_recommendations recommendation
    on recommendation.id=(workflow.resolution_details ->> 'recommendationId')::uuid
    and recommendation.case_id=workflow.case_id
    and recommendation.source_offer_id=(workflow.resolution_details ->> 'offerId')::uuid
  where workflow.case_id=$1 and workflow.resolution_code is not null and workflow.resolved_at is not null;
$$;
revoke execute on function public.total_loss_case_resolution_projection_internal(uuid)
  from public,anon,authenticated,service_role;

do $provenance$
declare definition text;
  previous_fragment text := $fragment$'amountSource',case when offer_row.id is not null then 'VERIFIED_INSURER_OFFER'
      when $7 is not null then 'CUSTOMER_REPORTED' else null end,$fragment$;
  replacement_fragment text := $fragment$'amountSource',case when offer_row.id is not null then recommendation_row.recommendation #>> '{offer,source}'
      when $7 is not null then 'CUSTOMER_REPORTED' else null end,$fragment$;
begin
  select pg_get_functiondef(
    'public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)'::regprocedure
  ) into definition;
  if position(previous_fragment in definition)=0 then
    raise exception 'The case-resolution amount-source contract changed.';
  end if;
  execute replace(definition,previous_fragment,replacement_fragment);
end;
$provenance$;

notify pgrst,'reload schema';
