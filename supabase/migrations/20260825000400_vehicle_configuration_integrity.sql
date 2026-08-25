alter table public.total_loss_case_details
add constraint total_loss_case_details_vehicle_configuration_identity_complete
  check (
    vehicle_configuration is null
    or (
      vehicle_year is not null
      and nullif(btrim(vehicle_make), '') is not null
      and nullif(btrim(vehicle_model), '') is not null
      and nullif(btrim(vehicle_trim), '') is not null
    )
  ) not valid;

alter table public.total_loss_case_details
validate constraint
  total_loss_case_details_vehicle_configuration_identity_complete;

alter table public.diminished_value_case_details
add constraint diminished_value_case_details_vehicle_config_identity_complete
  check (
    vehicle_configuration is null
    or (
      vehicle_year is not null
      and nullif(btrim(vehicle_make), '') is not null
      and nullif(btrim(vehicle_model), '') is not null
      and nullif(btrim(vehicle_trim), '') is not null
    )
  ) not valid;

alter table public.diminished_value_case_details
validate constraint
  diminished_value_case_details_vehicle_config_identity_complete;

create or replace function public.set_total_loss_case_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  customer_input_changed boolean;
begin
  if (
    new.intake_mode = 'report'
    and new.intake_mode is distinct from old.intake_mode
  )
    or new.report_last_upload_id is distinct from old.report_last_upload_id
  then
    new.vehicle_configuration := null;
  elsif row(
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model
  ) is distinct from row(
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model
  )
    and new.vehicle_configuration is not distinct from old.vehicle_configuration
  then
    new.vehicle_configuration := null;
  end if;

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
  'Invalidates stale provider vehicle identity, then advances customer-visible and opaque analysis fences for material claim-input changes, clears prior confirmation and stale extraction metadata after customer-input changes, and keeps lease/extraction coordination version-neutral.';

create or replace function public.set_diminished_value_case_details_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model
  ) is distinct from row(
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model
  )
    and new.vehicle_configuration is not distinct from old.vehicle_configuration
  then
    new.vehicle_configuration := null;
  end if;

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
  'Invalidates stale provider vehicle identity, then advances the server revision and updated_at only for customer-visible material changes.';

drop function public.get_submitted_diminished_value_case(uuid);

create function public.get_submitted_diminished_value_case(
  requested_case_id uuid
)
returns table (
  case_id uuid,
  owner_user_id uuid,
  service_type public.appraisal_service_type,
  status public.appraisal_case_status,
  draft_step text,
  accident_state text,
  accident_date date,
  repair_status text,
  vehicle_entry_method text,
  vin text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  vehicle_configuration jsonb,
  mileage_at_accident integer,
  current_mileage integer,
  other_party_at_fault text,
  at_fault_insurer text,
  repair_cost numeric(12, 2),
  repair_facility text,
  structural_damage text,
  airbag_deployment text,
  major_repair_details text,
  full_name text,
  email text,
  phone text,
  preferred_contact_method text,
  availability text,
  notes text,
  submitted_at timestamptz,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    details.case_id,
    appraisal_case.user_id as owner_user_id,
    appraisal_case.service_type,
    appraisal_case.status,
    details.draft_step,
    details.accident_state,
    details.accident_date,
    details.repair_status,
    details.vehicle_entry_method,
    details.vin,
    details.vehicle_year,
    details.vehicle_make,
    details.vehicle_model,
    details.vehicle_trim,
    details.vehicle_configuration,
    details.mileage_at_accident,
    details.current_mileage,
    details.other_party_at_fault,
    details.at_fault_insurer,
    details.repair_cost,
    details.repair_facility,
    details.structural_damage,
    details.airbag_deployment,
    details.major_repair_details,
    details.full_name,
    details.email,
    details.phone,
    details.preferred_contact_method,
    details.availability,
    details.notes,
    details.submitted_at,
    details.revision,
    details.created_at,
    details.updated_at
  from public.diminished_value_case_details as details
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
  where (select public.is_venfour_staff())
    and details.case_id = $1
    and appraisal_case.service_type = 'diminished_value'
    and appraisal_case.status = 'submitted'
    and details.submitted_at is not null;
$$;

comment on function public.get_submitted_diminished_value_case(uuid) is
  'Returns complete immutable submitted DV intake data, including retained provider vehicle identity, to authorized staff and no row for unavailable cases.';

revoke execute on function public.get_submitted_diminished_value_case(uuid)
from public;
revoke execute on function public.get_submitted_diminished_value_case(uuid)
from anon;
grant execute on function public.get_submitted_diminished_value_case(uuid)
to authenticated;
revoke execute on function public.get_submitted_diminished_value_case(uuid)
from service_role;
