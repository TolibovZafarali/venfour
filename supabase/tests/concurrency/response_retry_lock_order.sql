-- Run with a local database administrator for the second dblink session.
-- Both sessions use a nonexistent case identity and leave all product rows unchanged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
do $$
begin
  if exists (select 1 from public.appraisal_cases
    where id='c9000000-0000-4000-8000-000000000099') then
    raise exception 'The concurrency test case identity must be unused';
  end if;
end;
$$;
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('output_retry_lock_order',
  'dbname=' || current_database() || ' user=postgres application_name=output_retry_lock_order');
select extensions.dblink_exec('output_retry_lock_order',
  $remote$set request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001'$remote$);
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response_analysis'),
  pg_catalog.hashtext('c9000000-0000-4000-8000-000000000099'));
select extensions.dblink_send_query('output_retry_lock_order',$remote$
  select public.retry_total_loss_insurer_response_analysis(
    'c9000000-0000-4000-8000-000000000099','c9000000-0000-4000-8000-000000000098',1)
$remote$);
do $$
declare waiting boolean; iteration integer;
begin
  for iteration in 1..100 loop
    perform pg_catalog.pg_stat_clear_snapshot();
    select exists(select 1 from pg_catalog.pg_stat_activity
      where application_name='output_retry_lock_order'
        and wait_event_type='Lock' and wait_event='advisory') into waiting;
    exit when waiting;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  if not waiting then raise exception 'Retry did not reach the expected concurrent analysis lock wait'; end if;
end;
$$;
select ok(pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),
  pg_catalog.hashtext('c9000000-0000-4000-8000-000000000099')),
  'concurrent Retry waits on the worker analysis lock before taking the response or workflow lock');
select extensions.dblink_cancel_query('output_retry_lock_order');
select * from extensions.dblink_get_result('output_retry_lock_order',false) as canceled(result jsonb);
select extensions.dblink_disconnect('output_retry_lock_order');

select * from finish();
rollback;
