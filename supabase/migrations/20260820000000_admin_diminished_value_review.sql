create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default statement_timestamp()
);

comment on table public.staff_members is
  'Database-enforced authorization records for the minimal internal Venfour review surface.';
comment on column public.staff_members.user_id is
  'The authorized staff identity. Membership is granted and revoked only through trusted administrative access.';

alter table public.staff_members enable row level security;

revoke all on table public.staff_members from public;
revoke all on table public.staff_members from anon;
revoke all on table public.staff_members from authenticated;
revoke all on table public.staff_members from service_role;
grant select, insert, delete on table public.staff_members to service_role;

create function public.is_venfour_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members as staff_member
    where staff_member.user_id = (select auth.uid())
  );
$$;

comment on function public.is_venfour_staff() is
  'Reports whether the current authenticated identity has an active database-managed staff membership.';

revoke execute on function public.is_venfour_staff() from public;
revoke execute on function public.is_venfour_staff() from anon;
grant execute on function public.is_venfour_staff() to authenticated;
revoke execute on function public.is_venfour_staff() from service_role;

create function public.authorize_staff_diminished_value_document_read(
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
    from public.staff_members as staff_member
    join public.appraisal_cases as appraisal_case
      on appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'submitted'
    join public.diminished_value_case_details as details
      on details.case_id = appraisal_case.id
      and details.submitted_at is not null
    where staff_member.user_id = (select auth.uid())
      and storage.foldername($1) = array[
        appraisal_case.user_id::text,
        appraisal_case.id::text,
        'diminished-value'
      ]::text[]
      and storage.filename($1) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|heic|heif)$'
  );
$$;

comment on function public.authorize_staff_diminished_value_document_read(text) is
  'Allows staff reads only for canonical private documents belonging to submitted diminished-value cases.';

revoke execute on function public.authorize_staff_diminished_value_document_read(text) from public;
revoke execute on function public.authorize_staff_diminished_value_document_read(text) from anon;
grant execute on function public.authorize_staff_diminished_value_document_read(text) to authenticated;
revoke execute on function public.authorize_staff_diminished_value_document_read(text) from service_role;

create index diminished_value_case_details_submitted_queue_idx
  on public.diminished_value_case_details (submitted_at desc, case_id)
  where submitted_at is not null;

create policy "Staff can read submitted diminished-value cases"
on public.appraisal_cases
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and service_type = 'diminished_value'
  and status = 'submitted'
);

comment on policy "Staff can read submitted diminished-value cases"
on public.appraisal_cases is
  'Adds only submitted diminished-value parents to an authorized staff identity without changing existing customer visibility.';

create policy "Staff can read submitted diminished-value details"
on public.diminished_value_case_details
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and submitted_at is not null
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = diminished_value_case_details.case_id
      and appraisal_case.service_type = 'diminished_value'
      and appraisal_case.status = 'submitted'
  )
);

comment on policy "Staff can read submitted diminished-value details"
on public.diminished_value_case_details is
  'Allows authorized staff to read complete intake data only after an authoritative diminished-value submission.';

create policy "Staff can read submitted diminished-value documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'case-files'
  and public.authorize_staff_diminished_value_document_read(name)
);

comment on policy "Staff can read submitted diminished-value documents"
on storage.objects is
  'Adds read-only staff visibility for exact canonical document paths below submitted diminished-value cases.';

create function public.list_submitted_diminished_value_cases()
returns table (
  case_id uuid,
  owner_user_id uuid,
  service_type public.appraisal_service_type,
  status public.appraisal_case_status,
  submitted_at timestamptz,
  full_name text,
  email text,
  phone text,
  preferred_contact_method text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  accident_date date,
  at_fault_insurer text,
  document_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    appraisal_case.id as case_id,
    appraisal_case.user_id as owner_user_id,
    appraisal_case.service_type,
    appraisal_case.status,
    details.submitted_at,
    details.full_name,
    details.email,
    details.phone,
    details.preferred_contact_method,
    details.vehicle_year,
    details.vehicle_make,
    details.vehicle_model,
    details.accident_date,
    details.at_fault_insurer,
    (
      select count(*)
      from storage.objects as stored_object
      where stored_object.bucket_id = 'case-files'
        and storage.foldername(stored_object.name) = array[
          appraisal_case.user_id::text,
          appraisal_case.id::text,
          'diminished-value'
        ]::text[]
        and storage.filename(stored_object.name) ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|heic|heif)$'
    ) as document_count
  from public.diminished_value_case_details as details
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
  where (select public.is_venfour_staff())
    and appraisal_case.service_type = 'diminished_value'
    and appraisal_case.status = 'submitted'
    and details.submitted_at is not null
  order by details.submitted_at desc, appraisal_case.id desc;
$$;

comment on function public.list_submitted_diminished_value_cases() is
  'Returns the newest-first read-only staff queue with document counts restricted to canonical submitted DV objects.';

revoke execute on function public.list_submitted_diminished_value_cases() from public;
revoke execute on function public.list_submitted_diminished_value_cases() from anon;
grant execute on function public.list_submitted_diminished_value_cases() to authenticated;
revoke execute on function public.list_submitted_diminished_value_cases() from service_role;

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
  'Returns complete immutable submitted DV intake data to authorized staff and no row for unavailable cases.';

revoke execute on function public.get_submitted_diminished_value_case(uuid) from public;
revoke execute on function public.get_submitted_diminished_value_case(uuid) from anon;
grant execute on function public.get_submitted_diminished_value_case(uuid) to authenticated;
revoke execute on function public.get_submitted_diminished_value_case(uuid) from service_role;
