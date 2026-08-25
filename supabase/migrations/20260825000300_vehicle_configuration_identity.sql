create function public.vehicle_configuration_is_valid(configuration jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  source_value text;
  field_value text;
  raw_value text;
  normalized_key text;
  seen_values text[] := array[]::text[];
  value_item jsonb;
  key_count integer;
begin
  if jsonb_typeof(configuration) <> 'object' then
    return false;
  end if;

  select count(*)
  into key_count
  from jsonb_object_keys(configuration);

  if key_count <> 3
    or not configuration ?& array['source', 'field', 'values']::text[]
    or jsonb_typeof(configuration -> 'source') <> 'string'
    or jsonb_typeof(configuration -> 'field') <> 'string'
    or jsonb_typeof(configuration -> 'values') <> 'array'
  then
    return false;
  end if;

  source_value := configuration ->> 'source';
  field_value := configuration ->> 'field';

  if char_length(source_value) not between 1 and 50
    or source_value !~ '^[a-z0-9][a-z0-9._-]{0,49}$'
    or field_value not in ('trim', 'version')
    or jsonb_array_length(configuration -> 'values') not between 1 and 20
  then
    return false;
  end if;

  for value_item in
    select array_value.value
    from jsonb_array_elements(configuration -> 'values') as array_value(value)
  loop
    if jsonb_typeof(value_item) <> 'string' then
      return false;
    end if;

    raw_value := value_item #>> '{}';
    if char_length(raw_value) not between 1 and 200
      or raw_value <> regexp_replace(
        btrim(raw_value),
        '[[:space:]]+',
        ' ',
        'g'
      )
      or raw_value like '%,%'
      or raw_value ~ '[[:cntrl:]]'
      or raw_value ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    then
      return false;
    end if;

    normalized_key := lower(raw_value);
    if normalized_key = any(seen_values) then
      return false;
    end if;
    seen_values := array_append(seen_values, normalized_key);
  end loop;

  return true;
end;
$$;

comment on function public.vehicle_configuration_is_valid(jsonb) is
  'Validates the exact bounded provider identity retained behind a customer-facing vehicle configuration without interpreting provider terms.';

revoke execute on function public.vehicle_configuration_is_valid(jsonb) from public;
revoke execute on function public.vehicle_configuration_is_valid(jsonb) from anon;
grant execute on function public.vehicle_configuration_is_valid(jsonb) to authenticated, service_role;

alter table public.total_loss_case_details
add column vehicle_configuration jsonb,
add constraint total_loss_case_details_vehicle_configuration_valid
  check (
    vehicle_configuration is null
    or public.vehicle_configuration_is_valid(vehicle_configuration)
  );

alter table public.diminished_value_case_details
add column vehicle_configuration jsonb,
add constraint diminished_value_case_details_vehicle_configuration_valid
  check (
    vehicle_configuration is null
    or public.vehicle_configuration_is_valid(vehicle_configuration)
  );

comment on column public.total_loss_case_details.vehicle_configuration is
  'Bounded provider identity for the selected customer-facing vehicle configuration; vehicle_trim remains the canonical display value.';
comment on column public.diminished_value_case_details.vehicle_configuration is
  'Bounded provider identity for the selected customer-facing vehicle configuration; vehicle_trim remains the canonical display value.';

grant select (vehicle_configuration)
on public.total_loss_case_details to authenticated;
grant insert (vehicle_configuration)
on public.total_loss_case_details to authenticated;
grant update (vehicle_configuration)
on public.total_loss_case_details to authenticated;

grant select (vehicle_configuration)
on public.diminished_value_case_details to authenticated;
grant insert (vehicle_configuration)
on public.diminished_value_case_details to authenticated;
grant update (vehicle_configuration)
on public.diminished_value_case_details to authenticated;

create or replace function public.set_total_loss_case_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  customer_input_changed boolean;
begin
  customer_input_changed := row(
    new.intake_mode,
    new.vin,
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model,
    new.vehicle_trim,
    new.vehicle_configuration,
    new.mileage_at_loss,
    new.postal_code,
    new.date_of_loss,
    new.insurer_name,
    new.insurer_vehicle_valuation,
    new.prior_title_status,
    new.vehicle_condition,
    new.existing_damage_description,
    new.vehicle_options_packages,
    new.report_original_filename,
    new.report_uploaded_at,
    new.report_last_upload_id
  ) is distinct from row(
    old.intake_mode,
    old.vin,
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model,
    old.vehicle_trim,
    old.vehicle_configuration,
    old.mileage_at_loss,
    old.postal_code,
    old.date_of_loss,
    old.insurer_name,
    old.insurer_vehicle_valuation,
    old.prior_title_status,
    old.vehicle_condition,
    old.existing_damage_description,
    old.vehicle_options_packages,
    old.report_original_filename,
    old.report_uploaded_at,
    old.report_last_upload_id
  );

  if customer_input_changed
    or row(
      new.intake_completed_at,
      new.report_facts_confirmed_at
    ) is distinct from row(
      old.intake_completed_at,
      old.report_facts_confirmed_at
    )
  then
    new.updated_at := statement_timestamp();
    new.analysis_input_revision := old.analysis_input_revision + 1;
    new.analysis_input_id := gen_random_uuid();

    if customer_input_changed then
      new.intake_completed_at := null;
      new.report_facts_confirmed_at := null;
      new.report_extraction_status := case
        when new.intake_mode = 'report'
          and new.report_last_upload_id is not null
          then 'pending'
        else 'not_requested'
      end;
      new.report_extraction_confidence := null;
      new.report_extracted_at := null;
      new.report_extraction_source_upload_id := null;
      new.report_extraction_input_revision := null;

      if new.intake_mode <> 'report' then
        new.report_provider_name := null;
      end if;
    end if;
  else
    new.updated_at := old.updated_at;
    new.analysis_input_revision := old.analysis_input_revision;
    new.analysis_input_id := old.analysis_input_id;
  end if;

  return new;
end;
$$;

comment on function public.set_total_loss_case_details_updated_at() is
  'Advances customer-visible and opaque analysis fences for material claim-input changes, including provider-backed vehicle identity, clears prior confirmation and stale extraction metadata after customer-input changes, and keeps lease/extraction coordination version-neutral.';

create or replace function public.set_diminished_value_case_details_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.draft_step,
    new.accident_state,
    new.accident_date,
    new.repair_status,
    new.vehicle_entry_method,
    new.vin,
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model,
    new.vehicle_trim,
    new.vehicle_configuration,
    new.mileage_at_accident,
    new.current_mileage,
    new.other_party_at_fault,
    new.at_fault_insurer,
    new.repair_cost,
    new.repair_facility,
    new.structural_damage,
    new.airbag_deployment,
    new.major_repair_details,
    new.full_name,
    new.email,
    new.phone,
    new.preferred_contact_method,
    new.availability,
    new.notes,
    new.submitted_at
  ) is distinct from row(
    old.draft_step,
    old.accident_state,
    old.accident_date,
    old.repair_status,
    old.vehicle_entry_method,
    old.vin,
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model,
    old.vehicle_trim,
    old.vehicle_configuration,
    old.mileage_at_accident,
    old.current_mileage,
    old.other_party_at_fault,
    old.at_fault_insurer,
    old.repair_cost,
    old.repair_facility,
    old.structural_damage,
    old.airbag_deployment,
    old.major_repair_details,
    old.full_name,
    old.email,
    old.phone,
    old.preferred_contact_method,
    old.availability,
    old.notes,
    old.submitted_at
  ) then
    new.revision := old.revision + 1;
    new.updated_at := statement_timestamp();
  else
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  end if;

  return new;
end;
$$;

comment on function public.set_diminished_value_case_details_version() is
  'Trigger-only function that advances the server revision and updated_at only for customer-visible material changes, including provider-backed vehicle identity.';

create or replace function public.build_total_loss_analysis_input_snapshot(
  details public.total_loss_case_details
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'case_id', $1.case_id,
    'intake_mode', $1.intake_mode,
    'vin', $1.vin,
    'vehicle_year', $1.vehicle_year,
    'vehicle_make', $1.vehicle_make,
    'vehicle_model', $1.vehicle_model,
    'vehicle_trim', $1.vehicle_trim,
    'vehicle_configuration', $1.vehicle_configuration,
    'mileage_at_loss', $1.mileage_at_loss,
    'postal_code', nullif(btrim($1.postal_code), ''),
    'date_of_loss', $1.date_of_loss,
    'insurer_name', $1.insurer_name,
    'insurer_vehicle_valuation', $1.insurer_vehicle_valuation,
    'prior_title_status', $1.prior_title_status,
    'vehicle_condition', $1.vehicle_condition,
    'existing_damage_description', $1.existing_damage_description,
    'vehicle_options_packages', $1.vehicle_options_packages,
    'report_provider_name', $1.report_provider_name,
    'analysis_input_revision', $1.analysis_input_revision,
    'analysis_input_id', $1.analysis_input_id,
    'intake_completed_at', $1.intake_completed_at
  );
$$;

comment on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) is
  'Builds the bounded, provider-neutral, customer-confirmed input snapshot returned only through trusted analysis coordination, including retained provider vehicle identity, title history, and conditionally described pre-loss issues.';
