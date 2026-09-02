-- Wake request-billed compute independently of customer traffic. The cron job
-- is intentionally inert until an operator configures both Vault entries.
create function public.dispatch_total_loss_insurer_response_analysis_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_origin text;
  dispatch_secret text;
  request_id bigint;
begin
  select decrypted_secret into api_origin
  from vault.decrypted_secrets
  where name = 'venfour_insurer_response_api_origin';

  select decrypted_secret into dispatch_secret
  from vault.decrypted_secrets
  where name = 'venfour_insurer_response_dispatch_secret';

  if api_origin is null or dispatch_secret is null then
    return null;
  end if;
  if api_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
    or char_length(dispatch_secret) not between 32 and 512
    or dispatch_secret ~ '[[:space:][:cntrl:]]'
  then
    return null;
  end if;
  if not exists (
    select 1
    from public.total_loss_insurer_response_analysis_jobs as job
    join public.total_loss_claim_workflows as workflow
      on workflow.case_id = job.case_id
      and workflow.current_response_analysis_job_id = job.id
    where job.status = 'pending'
      or (
        job.status = 'processing'
        and job.processing_expires_at <= statement_timestamp()
      )
  ) then
    return null;
  end if;

  select net.http_post(
    url := api_origin || '/internal/v1/insurer-response-analysis/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Venfour-Insurer-Response-Dispatch', dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;

comment on function public.dispatch_total_loss_insurer_response_analysis_jobs() is
  'Private Vault-backed wakeup for due response-analysis dispatch; inert until the exact API origin and dispatch secret are configured.';

revoke execute on function public.dispatch_total_loss_insurer_response_analysis_jobs()
  from public, anon, authenticated, service_role;

select cron.schedule(
  'venfour-insurer-response-analysis-dispatch',
  '* * * * *',
  'select public.dispatch_total_loss_insurer_response_analysis_jobs();'
);
