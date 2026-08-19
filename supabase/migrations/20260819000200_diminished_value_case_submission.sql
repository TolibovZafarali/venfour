create table public.diminished_value_case_details (
  case_id uuid primary key references public.appraisal_cases (id) on delete cascade,
  draft_step text not null default 'start',
  accident_state text,
  accident_date date,
  repair_status text,
  vehicle_entry_method text not null default 'vin',
  vin text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
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
  revision bigint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint diminished_value_case_details_draft_step_valid
    check (draft_step in ('start', 'vehicle', 'accident-repairs', 'consultation')),
  constraint diminished_value_case_details_accident_state_valid
    check (
      accident_state is null
      or accident_state in (
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
        'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
        'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
        'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
        'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
        'WY'
      )
    ),
  constraint diminished_value_case_details_repair_status_valid
    check (
      repair_status is null
      or repair_status in ('complete', 'in-progress', 'not-started', 'not-sure')
    ),
  constraint diminished_value_case_details_vehicle_entry_method_valid
    check (vehicle_entry_method in ('vin', 'details')),
  constraint diminished_value_case_details_vin_valid
    check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  constraint diminished_value_case_details_vehicle_year_valid
    check (vehicle_year is null or vehicle_year between 1981 and 2100),
  constraint diminished_value_case_details_vehicle_make_bounded
    check (vehicle_make is null or char_length(vehicle_make) <= 100),
  constraint diminished_value_case_details_vehicle_model_bounded
    check (vehicle_model is null or char_length(vehicle_model) <= 100),
  constraint diminished_value_case_details_vehicle_trim_bounded
    check (vehicle_trim is null or char_length(vehicle_trim) <= 100),
  constraint diminished_value_case_details_mileage_at_accident_valid
    check (mileage_at_accident is null or mileage_at_accident >= 0),
  constraint diminished_value_case_details_current_mileage_valid
    check (current_mileage is null or current_mileage >= 0),
  constraint diminished_value_case_details_other_party_at_fault_valid
    check (
      other_party_at_fault is null
      or other_party_at_fault in ('yes', 'no', 'not-sure')
    ),
  constraint diminished_value_case_details_at_fault_insurer_bounded
    check (at_fault_insurer is null or char_length(at_fault_insurer) <= 200),
  constraint diminished_value_case_details_repair_cost_valid
    check (repair_cost is null or repair_cost >= 0),
  constraint diminished_value_case_details_repair_facility_bounded
    check (repair_facility is null or char_length(repair_facility) <= 200),
  constraint diminished_value_case_details_structural_damage_valid
    check (
      structural_damage is null
      or structural_damage in ('yes', 'no', 'not-sure')
    ),
  constraint diminished_value_case_details_airbag_deployment_valid
    check (
      airbag_deployment is null
      or airbag_deployment in ('yes', 'no', 'not-sure')
    ),
  constraint diminished_value_case_details_major_repair_details_bounded
    check (major_repair_details is null or char_length(major_repair_details) <= 5000),
  constraint diminished_value_case_details_full_name_bounded
    check (full_name is null or char_length(full_name) <= 200),
  constraint diminished_value_case_details_email_bounded
    check (email is null or char_length(email) <= 254),
  constraint diminished_value_case_details_phone_bounded
    check (phone is null or char_length(phone) <= 50),
  constraint diminished_value_case_details_preferred_contact_method_valid
    check (
      preferred_contact_method is null
      or preferred_contact_method in ('email', 'phone')
    ),
  constraint diminished_value_case_details_availability_bounded
    check (availability is null or char_length(availability) <= 2000),
  constraint diminished_value_case_details_notes_bounded
    check (notes is null or char_length(notes) <= 5000),
  constraint diminished_value_case_details_revision_valid
    check (revision >= 0)
);

comment on table public.diminished_value_case_details is
  'One-to-one customer intake and authoritative submission data for a diminished-value appraisal case.';
comment on column public.diminished_value_case_details.case_id is
  'The provider-neutral parent case identifier. The parent remains authoritative for ownership, service type, status, and activity.';
comment on column public.diminished_value_case_details.draft_step is
  'The last editable intake step. Submitted completion is represented only by submitted_at and the parent case status.';
comment on column public.diminished_value_case_details.submitted_at is
  'Database-generated time at which Venfour durably received the review request; browser roles cannot write it.';
comment on column public.diminished_value_case_details.revision is
  'Server-incremented optimistic-concurrency version for material draft changes and submission.';

create function public.set_diminished_value_case_details_version()
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
  'Trigger-only function that advances the server revision and updated_at only for customer-visible material changes.';

revoke execute on function public.set_diminished_value_case_details_version() from public;
revoke execute on function public.set_diminished_value_case_details_version() from anon;
revoke execute on function public.set_diminished_value_case_details_version() from authenticated;
revoke execute on function public.set_diminished_value_case_details_version() from service_role;

create trigger diminished_value_case_details_set_version
before update on public.diminished_value_case_details
for each row execute function public.set_diminished_value_case_details_version();

alter table public.diminished_value_case_details enable row level security;

create policy "Customers can read their own diminished-value details"
on public.diminished_value_case_details
for select
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = diminished_value_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'diminished_value'
  )
);

comment on policy "Customers can read their own diminished-value details"
on public.diminished_value_case_details is
  'A customer can read details only through an owned diminished-value parent, including after submission.';

create policy "Customers can create their own diminished-value details"
on public.diminished_value_case_details
for insert
to authenticated
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = diminished_value_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can create their own diminished-value details"
on public.diminished_value_case_details is
  'A customer can attach intake details only to an owned draft diminished-value case.';

create policy "Customers can update their own diminished-value details"
on public.diminished_value_case_details
for update
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = diminished_value_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'draft'
  )
)
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = diminished_value_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can update their own diminished-value details"
on public.diminished_value_case_details is
  'Customer intake is mutable only while its owned diminished-value parent remains a draft.';

revoke all on table public.diminished_value_case_details from public;
revoke all on table public.diminished_value_case_details from anon;
revoke all on table public.diminished_value_case_details from authenticated;

grant select on table public.diminished_value_case_details to authenticated;
grant insert (
  case_id,
  draft_step,
  accident_state,
  accident_date,
  repair_status,
  vehicle_entry_method,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_accident,
  current_mileage,
  other_party_at_fault,
  at_fault_insurer,
  repair_cost,
  repair_facility,
  structural_damage,
  airbag_deployment,
  major_repair_details,
  full_name,
  email,
  phone,
  preferred_contact_method,
  availability,
  notes
) on public.diminished_value_case_details to authenticated;
grant update (
  draft_step,
  accident_state,
  accident_date,
  repair_status,
  vehicle_entry_method,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_accident,
  current_mileage,
  other_party_at_fault,
  at_fault_insurer,
  repair_cost,
  repair_facility,
  structural_damage,
  airbag_deployment,
  major_repair_details,
  full_name,
  email,
  phone,
  preferred_contact_method,
  availability,
  notes
) on public.diminished_value_case_details to authenticated;
grant select, insert, update, delete on table public.diminished_value_case_details to service_role;

create type public.diminished_value_submission_result as (
  case_id uuid,
  status public.appraisal_case_status,
  submitted_at timestamptz,
  revision bigint
);

comment on type public.diminished_value_submission_result is
  'The authoritative, non-sensitive receipt returned after a diminished-value review request is submitted.';

revoke all on type public.diminished_value_submission_result from public;
revoke all on type public.diminished_value_submission_result from anon;
grant usage on type public.diminished_value_submission_result to authenticated, service_role;

create function public.submit_diminished_value_case(case_id uuid)
returns setof public.diminished_value_submission_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  case_row public.appraisal_cases%rowtype;
  details_row public.diminished_value_case_details%rowtype;
  result_row public.diminished_value_submission_result;
  submission_time timestamptz;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to submit a diminished-value case.';
  end if;

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'diminished_value'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The diminished-value case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.diminished_value_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Complete the required diminished-value intake before submitting.';
  end if;

  if details_row.submitted_at is not null then
    if case_row.status = 'draft' then
      raise exception using
        errcode = '55000',
        message = 'The diminished-value submission state is inconsistent.';
    end if;

    result_row.case_id := details_row.case_id;
    result_row.status := 'submitted';
    result_row.submitted_at := details_row.submitted_at;
    result_row.revision := details_row.revision;
    return next result_row;
    return;
  end if;

  if case_row.status <> 'draft' then
    raise exception using
      errcode = '42501',
      message = 'The diminished-value case is no longer editable.';
  end if;

  if details_row.accident_state is null
    or details_row.accident_date is null
    or details_row.accident_date > current_date
    or details_row.repair_status is null
    or details_row.mileage_at_accident is null
    or details_row.other_party_at_fault is null
    or details_row.structural_damage is null
    or details_row.airbag_deployment is null
    or nullif(btrim(details_row.full_name), '') is null
    or nullif(btrim(details_row.email), '') is null
    or details_row.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or nullif(btrim(details_row.phone), '') is null
    or details_row.preferred_contact_method is null
    or nullif(btrim(details_row.availability), '') is null
    or (
      details_row.vehicle_entry_method = 'vin'
      and details_row.vin is null
    )
    or (
      details_row.vehicle_entry_method = 'details'
      and (
        details_row.vehicle_year is null
        or details_row.vehicle_year > extract(year from current_date)::integer + 1
        or nullif(btrim(details_row.vehicle_make), '') is null
        or nullif(btrim(details_row.vehicle_model), '') is null
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'Complete the required diminished-value intake before submitting.';
  end if;

  submission_time := statement_timestamp();

  update public.diminished_value_case_details as details
  set submitted_at = submission_time
  where details.case_id = $1
  returning details.* into details_row;

  update public.appraisal_cases as appraisal_case
  set
    status = 'submitted',
    last_activity_at = submission_time
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'diminished_value'
    and appraisal_case.status = 'draft'
  returning appraisal_case.* into case_row;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The diminished-value case could not be submitted.';
  end if;

  result_row.case_id := details_row.case_id;
  result_row.status := case_row.status;
  result_row.submitted_at := details_row.submitted_at;
  result_row.revision := details_row.revision;
  return next result_row;
end;
$$;

comment on function public.submit_diminished_value_case(uuid) is
  'Atomically validates and submits one owned diminished-value draft using database time; committed retries return the original receipt.';

revoke execute on function public.submit_diminished_value_case(uuid) from public;
revoke execute on function public.submit_diminished_value_case(uuid) from anon;
grant execute on function public.submit_diminished_value_case(uuid) to authenticated;
revoke execute on function public.submit_diminished_value_case(uuid) from service_role;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif'
]::text[]
where id = 'case-files';

create function public.authorize_diminished_value_document_mutation(
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'draft'
      and storage.foldername($1) = array[
        appraisal_case.user_id::text,
        appraisal_case.id::text,
        'diminished-value'
      ]::text[]
      and storage.filename($1) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|heic|heif)$'
  );
$$;

comment on function public.authorize_diminished_value_document_mutation(text) is
  'Restricts private DV documents to an exact owned draft namespace and canonical UUID filename. The shared bucket retains its portable 50 MiB server cap because Storage metadata.size is not guaranteed at RLS admission; the DV client applies the stricter 10 MiB limit.';

revoke execute on function public.authorize_diminished_value_document_mutation(text) from public;
revoke execute on function public.authorize_diminished_value_document_mutation(text) from anon;
grant execute on function public.authorize_diminished_value_document_mutation(text) to authenticated;
revoke execute on function public.authorize_diminished_value_document_mutation(text) from service_role;

drop policy if exists "Customers can add files for their own cases" on storage.objects;
drop policy if exists "Customers can update files for their own cases" on storage.objects;
drop policy if exists "Customers can delete files for their own cases" on storage.objects;

create policy "Customers can add files for their own cases"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
  and (
    exists (
      select 1
      from public.appraisal_cases as appraisal_case
      where appraisal_case.id::text = lower((storage.foldername(name))[2])
        and appraisal_case.user_id = (select auth.uid())
        and appraisal_case.service_type = 'total_loss'
    )
    or (
      public.authorize_diminished_value_document_mutation(name)
      and jsonb_typeof(user_metadata) = 'object'
      and char_length(user_metadata ->> 'originalName') between 1 and 255
      and user_metadata ->> 'originalName' = regexp_replace(
        btrim(user_metadata ->> 'originalName'),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and user_metadata ->> 'originalName' ~* '\.(pdf|jpe?g|png|heic|heif)$'
      and (
        (
          storage.filename(name) ~ '\.pdf$'
          and user_metadata ->> 'originalName' ~* '\.pdf$'
        )
        or (
          storage.filename(name) ~ '\.jpg$'
          and user_metadata ->> 'originalName' ~* '\.jpe?g$'
        )
        or (
          storage.filename(name) ~ '\.png$'
          and user_metadata ->> 'originalName' ~* '\.png$'
        )
        or (
          storage.filename(name) ~ '\.heic$'
          and user_metadata ->> 'originalName' ~* '\.heic$'
        )
        or (
          storage.filename(name) ~ '\.heif$'
          and user_metadata ->> 'originalName' ~* '\.heif$'
        )
      )
      and position('/' in user_metadata ->> 'originalName') = 0
      and position(chr(92) in user_metadata ->> 'originalName') = 0
      and user_metadata ->> 'originalName' !~ '[[:cntrl:]]'
      and user_metadata ->> 'originalName' !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  )
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or public.authorize_total_loss_report_storage_write(name, user_metadata)
  )
);

comment on policy "Customers can add files for their own cases" on storage.objects is
  'Preserves owned total-loss file inserts and its reserved report protocol while limiting DV documents to safe metadata and an exact owned draft namespace.';

create policy "Customers can update files for their own cases"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
  )
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or storage.allow_only_operation('storage.object.upload_update')
  )
)
with check (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
  )
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or (
      storage.allow_only_operation('storage.object.upload_update')
      and public.authorize_total_loss_report_storage_write(name, user_metadata)
    )
  )
);

comment on policy "Customers can update files for their own cases" on storage.objects is
  'Preserves the existing total-loss update protocol and denies every DV object update or move; DV replacement uses draft-only delete plus insert.';

create policy "Customers can delete files for their own cases"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
  and (
    exists (
      select 1
      from public.appraisal_cases as appraisal_case
      where appraisal_case.id::text = lower((storage.foldername(name))[2])
        and appraisal_case.user_id = (select auth.uid())
        and appraisal_case.service_type = 'total_loss'
    )
    or public.authorize_diminished_value_document_mutation(name)
  )
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) = 'valuation-report-backup.pdf'
      and public.authorize_total_loss_report_backup_delete(name, user_metadata)
    )
  )
);

comment on policy "Customers can delete files for their own cases" on storage.objects is
  'Preserves total-loss deletion behavior while allowing exact owned DV documents to be removed only before submission.';
