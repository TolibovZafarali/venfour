create type public.appraisal_service_type as enum (
  'total_loss',
  'diminished_value'
);

create type public.appraisal_case_status as enum (
  'draft',
  'checking',
  'check_complete',
  'payment_pending',
  'paid',
  'completed',
  'closed'
);

comment on type public.appraisal_service_type is
  'The supported appraisal workflows. Detailed workflow data belongs outside the base case record.';
comment on type public.appraisal_case_status is
  'Server-controlled appraisal workflow state; browser clients have read-only access.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

comment on table public.profiles is
  'Application-level customer profile data. Authentication identity remains authoritative in auth.users.';
comment on column public.profiles.id is
  'The auth.users identifier. RLS restricts customers to their own profile row.';

create table public.appraisal_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  service_type public.appraisal_service_type not null,
  status public.appraisal_case_status not null default 'draft',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_activity_at timestamptz not null default statement_timestamp()
);

comment on table public.appraisal_cases is
  'Provider-neutral parent records for customer appraisal workflows. Analysis-run identifiers remain separate.';
comment on column public.appraisal_cases.user_id is
  'The owning auth.users identifier. RLS and storage policies enforce this ownership boundary.';
comment on column public.appraisal_cases.status is
  'Read-only to authenticated browser clients. Trusted backend and payment workflows own status transitions.';

create index appraisal_cases_user_activity_idx
  on public.appraisal_cases (user_id, last_activity_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger-only function that maintains server-generated updated_at values.';

revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;
revoke execute on function public.set_updated_at() from service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger appraisal_cases_set_updated_at
before update on public.appraisal_cases
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger-only function that creates the application profile corresponding to a new auth user.';

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.handle_new_user() from service_role;

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.appraisal_cases enable row level security;

create policy "Customers can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

comment on policy "Customers can read their own profile" on public.profiles is
  'A customer can read only the profile whose primary key matches the authenticated user ID.';

create policy "Customers can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

comment on policy "Customers can update their own profile" on public.profiles is
  'A customer can update only their own profile; column grants limit the writable data to display_name.';

create policy "Customers can read their own cases"
on public.appraisal_cases
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on policy "Customers can read their own cases" on public.appraisal_cases is
  'A case is visible only when its owner matches the authenticated user ID.';

create policy "Customers can create their own cases"
on public.appraisal_cases
for insert
to authenticated
with check ((select auth.uid()) = user_id);

comment on policy "Customers can create their own cases" on public.appraisal_cases is
  'A browser client can create a case only for itself; column grants force the database-default draft status.';

create policy "Customers can update activity on their own cases"
on public.appraisal_cases
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

comment on policy "Customers can update activity on their own cases" on public.appraisal_cases is
  'Ownership is checked before and after updates; column grants expose only last_activity_at to browser clients.';

revoke all on table public.profiles from public;
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

revoke all on table public.appraisal_cases from public;
revoke all on table public.appraisal_cases from anon;
revoke all on table public.appraisal_cases from authenticated;
grant select on table public.appraisal_cases to authenticated;
grant insert (user_id, service_type) on table public.appraisal_cases to authenticated;
grant update (last_activity_at) on table public.appraisal_cases to authenticated;
grant select, insert, update, delete on table public.appraisal_cases to service_role;

revoke all on type public.appraisal_service_type from public;
revoke all on type public.appraisal_service_type from anon;
grant usage on type public.appraisal_service_type to authenticated, service_role;

revoke all on type public.appraisal_case_status from public;
revoke all on type public.appraisal_case_status from anon;
grant usage on type public.appraisal_case_status to authenticated, service_role;

create function public.touch_appraisal_case(case_id uuid)
returns public.appraisal_cases
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.appraisal_cases as appraisal_case
  set last_activity_at = statement_timestamp()
  where appraisal_case.id = $1
    and appraisal_case.user_id = (select auth.uid())
  returning appraisal_case.*;
$$;

comment on function public.touch_appraisal_case(uuid) is
  'Updates an owned case using database time. SECURITY INVOKER preserves the caller RLS and column-grant boundary.';

revoke execute on function public.touch_appraisal_case(uuid) from public;
revoke execute on function public.touch_appraisal_case(uuid) from anon;
grant execute on function public.touch_appraisal_case(uuid) to authenticated;
grant execute on function public.touch_appraisal_case(uuid) to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'case-files',
  'case-files',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can read files for their own cases"
on storage.objects
for select
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
);

comment on policy "Customers can read files for their own cases" on storage.objects is
  'Allows reads only below {auth.uid()}/{ownedCaseId}/ in the private case-files bucket.';

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
);

comment on policy "Customers can add files for their own cases" on storage.objects is
  'Allows inserts only below {auth.uid()}/{ownedCaseId}/ after rechecking case ownership.';

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
  )
);

comment on policy "Customers can update files for their own cases" on storage.objects is
  'Checks both the existing and resulting object path so files cannot be moved across ownership boundaries.';

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
);

comment on policy "Customers can delete files for their own cases" on storage.objects is
  'Allows deletion only below {auth.uid()}/{ownedCaseId}/ after rechecking case ownership.';
