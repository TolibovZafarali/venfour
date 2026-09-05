-- Keep exact closure replay ahead of terminal-state conflict handling.
alter function public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)
  rename to confirm_total_loss_case_resolution_internal;
revoke execute on function public.confirm_total_loss_case_resolution_internal(uuid,uuid,text,bigint,uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;

do $resolution_conflicts$
declare
  definition text;
  previous_guard text := $guard$  if workflow_row.resolution_code is not null or workflow_row.resolved_at is not null
    or workflow_row.revision<>expected_workflow_revision$guard$;
  replacement_guard text := $guard$  if workflow_row.resolution_code is not null or workflow_row.resolved_at is not null then
    raise exception using errcode='55000',
      message='This case has already been closed. Review its saved outcome.',
      detail='CASE_ALREADY_RESOLVED';
  end if;
  if workflow_row.revision<>expected_workflow_revision$guard$;
begin
  select pg_get_functiondef(
    'public.confirm_total_loss_case_resolution_internal(uuid,uuid,text,bigint,uuid,uuid,bigint,text)'::regprocedure
  ) into definition;
  if position(previous_guard in definition)=0
    or (select count(*) from regexp_matches(definition,$pattern$errcode='40001'$pattern$,'g'))<>2 then
    raise exception 'The case-resolution conflict contract changed.';
  end if;
  definition:=replace(definition,previous_guard,replacement_guard);
  definition:=replace(definition,$state$errcode='40001'$state$,$state$errcode='55000'$state$);
  execute definition;
end;
$resolution_conflicts$;

-- Finish deferred checks inside the protected call so transient failures leave
-- no partial closure and cannot enter the database transport's retry loop.
create function public.confirm_total_loss_case_resolution(
  requested_case_id uuid,requested_client_request_id uuid,requested_resolution_code text,
  expected_workflow_revision bigint,requested_decision_id uuid default null,requested_offer_id uuid default null,
  requested_amount_minor_units bigint default null,requested_currency text default null
) returns jsonb language plpgsql volatile security definer
  set search_path=''
  set default_transaction_isolation='read committed'
  set statement_timeout='2s'
as $$
declare resolution_result jsonb;
begin
  resolution_result:=public.confirm_total_loss_case_resolution_internal($1,$2,$3,$4,$5,$6,$7,$8);
  set constraints all immediate;
  return resolution_result;
exception when serialization_failure or deadlock_detected then
  raise exception using errcode='PVR01',message='Case resolution temporarily conflicted. Please try again.';
end;
$$;
revoke execute on function public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)
  from public,anon,service_role;
grant execute on function public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)
  to authenticated;

notify pgrst,'reload schema';
