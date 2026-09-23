-- Product facts are separate from operating permissions and monetary decisions.
create function public.get_case_product_facts(requested_case_id uuid, requested_staff boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if requested_staff then
    perform public.staff_admin_require_access();
  elsif not exists(select 1 from public.appraisal_cases where id=requested_case_id and user_id=(select auth.uid())) then
    raise exception using errcode='42501',message='Case access required.';
  end if;
  result := public.get_jurisdiction_context(requested_case_id);
  if result is null then raise exception using errcode='42501',message='Case access required.'; end if;
  if requested_staff then
    result := result || jsonb_build_object('delivery',coalesce((select jsonb_build_object(
      'state',state,'reasons',reasons,'authority_revision',authority_revision,'valid_until',valid_until)
      from public.jurisdiction_delivery_cases where case_id=requested_case_id),
      '{"state":"unenrolled","reasons":["EXISTING_EXPOSURE_UNREVIEWED"]}'::jsonb));
  end if;
  return result;
end $$;
revoke all on function public.get_case_product_facts(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_case_product_facts(uuid,boolean) to authenticated;

-- Capture once per report version, so a retry never substitutes newer customer facts.
create table public.total_loss_report_product_facts (
  report_version_id uuid primary key references public.total_loss_report_versions(id),
  context jsonb not null,
  captured_at timestamptz not null default statement_timestamp()
);
alter table public.total_loss_report_product_facts enable row level security;
revoke all on public.total_loss_report_product_facts from public,anon,authenticated,service_role;
create trigger report_product_facts_immutable before update or delete on public.total_loss_report_product_facts
for each row execute function public.prevent_jurisdiction_history_update();

create function public.capture_report_product_facts(requested_report_version_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare report_case uuid; result jsonb;
begin
  select case_id into report_case from public.total_loss_report_versions where id=requested_report_version_id;
  if report_case is null then raise exception using errcode='22023',message='Report version required.'; end if;
  perform public.jurisdiction_delivery_lock_internal(report_case);
  perform 1 from public.appraisal_cases where id=report_case for update;
  perform 1 from public.total_loss_report_versions where id=requested_report_version_id for update;
  select context into result from public.total_loss_report_product_facts where report_version_id=requested_report_version_id;
  if result is not null then return result; end if;
  if exists(select 1 from public.total_loss_report_versions where id=requested_report_version_id and status<>'draft') then
    raise exception using errcode='55000',message='Historical report facts cannot be backfilled.';
  end if;
  result := public.get_jurisdiction_context(report_case);
  insert into public.total_loss_report_product_facts(report_version_id,context) values(requested_report_version_id,result);
  return result;
end $$;
revoke all on function public.capture_report_product_facts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.capture_report_product_facts(uuid) to service_role;

create function public.validate_report_product_facts_internal()
returns trigger language plpgsql security definer set search_path='' as $$
declare captured jsonb; product jsonb;
begin
  if new.report->'identity'->>'templateVersion'='5' then
    product := new.report->'productContext';
    select context into captured from public.total_loss_report_product_facts where report_version_id=new.id;
    if captured is null or product->>'case_id' is distinct from new.case_id::text
      or product->'facts' is distinct from captured->'facts'
      or product->'facts_revision' is distinct from captured->'revision'
      or product->'loss_date' is distinct from captured->'date_of_loss' then
      raise exception using errcode='22023',message='Report product facts do not match captured history.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_report_product_facts_internal() from public,anon,authenticated,service_role;
create trigger report_product_facts_match before insert or update of report on public.total_loss_report_versions
for each row execute function public.validate_report_product_facts_internal();
