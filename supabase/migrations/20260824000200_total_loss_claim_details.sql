alter table public.total_loss_case_details
add column prior_title_status text,
add column existing_damage_description text,
add constraint total_loss_case_details_prior_title_status_valid
  check (
    prior_title_status is null
    or prior_title_status in ('No', 'Yes', 'Not sure')
  ),
add constraint total_loss_case_details_existing_damage_safe
  check (
    existing_damage_description is null
    or (
      char_length(btrim(existing_damage_description)) between 1 and 2000
      and existing_damage_description = regexp_replace(
        btrim(existing_damage_description),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and existing_damage_description !~ '[[:cntrl:]]'
      and existing_damage_description !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  );

comment on column public.total_loss_case_details.prior_title_status is
  'Customer-confirmed answer for prior branded, rebuilt, or salvage title history.';
comment on column public.total_loss_case_details.existing_damage_description is
  'Brief customer description required only when the selected pre-loss condition reports existing damage or mechanical issues.';

grant select (
  prior_title_status,
  existing_damage_description
) on public.total_loss_case_details to authenticated;

grant insert (
  prior_title_status,
  existing_damage_description
) on public.total_loss_case_details to authenticated;

grant update (
  prior_title_status,
  existing_damage_description
) on public.total_loss_case_details to authenticated;

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
  'Advances customer-visible and opaque analysis fences for material claim-input changes, clears prior confirmation and stale extraction metadata after customer-input changes, and keeps lease/extraction coordination version-neutral.';

create function public.validate_total_loss_claim_facts_on_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.intake_completed_at is null then
    return new;
  end if;

  if new.prior_title_status is null
    or new.prior_title_status not in ('No', 'Yes', 'Not sure')
    or new.vehicle_condition is null
    or new.vehicle_condition not in (
      'No significant damage or mechanical issues',
      'Some existing cosmetic damage',
      'Significant damage or mechanical issues'
    )
    or (
      new.vehicle_condition in (
        'Some existing cosmetic damage',
        'Significant damage or mechanical issues'
      )
      and nullif(btrim(new.existing_damage_description), '') is null
    )
    or (
      new.vehicle_condition = 'No significant damage or mechanical issues'
      and new.existing_damage_description is not null
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Complete the required vehicle history and pre-loss condition facts before confirmation.';
  end if;

  return new;
end;
$$;

comment on function public.validate_total_loss_claim_facts_on_confirmation() is
  'Requires the bounded title-history and conditional pre-loss damage facts whenever a Total-Loss intake is confirmed.';

revoke execute on function public.validate_total_loss_claim_facts_on_confirmation() from public;
revoke execute on function public.validate_total_loss_claim_facts_on_confirmation() from anon;
revoke execute on function public.validate_total_loss_claim_facts_on_confirmation() from authenticated;
revoke execute on function public.validate_total_loss_claim_facts_on_confirmation() from service_role;

create trigger total_loss_case_details_validate_claim_facts
before update of
  intake_completed_at,
  prior_title_status,
  vehicle_condition,
  existing_damage_description
on public.total_loss_case_details
for each row execute function public.validate_total_loss_claim_facts_on_confirmation();

create or replace function public.total_loss_manual_input_is_complete(
  details public.total_loss_case_details
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    $1.intake_mode = 'manual'
    and $1.intake_completed_at is not null
    and $1.vehicle_year is not null
    and $1.vehicle_year between 1886
      and extract(year from current_date)::integer + 1
    and nullif(btrim($1.vehicle_make), '') is not null
    and nullif(btrim($1.vehicle_model), '') is not null
    and nullif(btrim($1.vehicle_trim), '') is not null
    and $1.mileage_at_loss is not null
    and $1.mileage_at_loss >= 0
    and nullif(btrim($1.postal_code), '') is not null
    and $1.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
    and $1.date_of_loss is not null
    and nullif(btrim($1.insurer_name), '') is not null
    and $1.prior_title_status in ('No', 'Yes', 'Not sure')
    and $1.vehicle_condition in (
      'No significant damage or mechanical issues',
      'Some existing cosmetic damage',
      'Significant damage or mechanical issues'
    )
    and (
      (
        $1.vehicle_condition = 'No significant damage or mechanical issues'
        and $1.existing_damage_description is null
      )
      or (
        $1.vehicle_condition in (
          'Some existing cosmetic damage',
          'Significant damage or mechanical issues'
        )
        and nullif(btrim($1.existing_damage_description), '') is not null
      )
    )
    and nullif(btrim($1.vehicle_options_packages), '') is not null;
$$;

comment on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) is
  'Deterministically validates the confirmed minimum manual analysis inputs; VIN, insurer offer, and major options remain optional, while trim, title history, condition, and any conditionally required damage description are required.';

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
  'Builds the bounded, provider-neutral, customer-confirmed input snapshot returned only through trusted analysis coordination, including title history and conditionally described pre-loss issues.';
