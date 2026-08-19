begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

select ok(
  to_regtype('public.appraisal_service_type') is not null,
  'appraisal_service_type exists'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.appraisal_service_type'::regtype
  ),
  array['total_loss', 'diminished_value']::text[],
  'appraisal_service_type has the intended values'
);

select ok(
  to_regtype('public.appraisal_case_status') is not null,
  'appraisal_case_status exists'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.appraisal_case_status'::regtype
  ),
  array[
    'draft',
    'submitted',
    'checking',
    'check_complete',
    'payment_pending',
    'paid',
    'completed',
    'closed'
  ]::text[],
  'appraisal_case_status has the intended workflow values'
);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'appraisal_cases', 'appraisal_cases table exists');

select ok(
  (select relation.relrowsecurity from pg_class as relation where relation.oid = 'public.profiles'::regclass),
  'profiles has row-level security enabled'
);

select ok(
  (select relation.relrowsecurity from pg_class as relation where relation.oid = 'public.appraisal_cases'::regclass),
  'appraisal_cases has row-level security enabled'
);

select has_index(
  'public',
  'appraisal_cases',
  'appraisal_cases_user_activity_idx',
  'cases are indexed by owner and recent activity'
);

select ok(
  (
    select column_info.column_default like '%draft%'
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'appraisal_cases'
      and column_info.column_name = 'status'
  ),
  'new cases default to draft status'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
  'authenticated users may update display_name'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'authenticated users may not update profile ownership'
);

select ok(
  has_column_privilege('authenticated', 'public.appraisal_cases', 'status', 'SELECT'),
  'authenticated users may read case status'
);

select ok(
  not has_column_privilege('authenticated', 'public.appraisal_cases', 'status', 'INSERT'),
  'authenticated users may not provide case status during insert'
);

select ok(
  not has_column_privilege('authenticated', 'public.appraisal_cases', 'status', 'UPDATE'),
  'authenticated users may not update case status'
);

select ok(
  has_column_privilege('authenticated', 'public.appraisal_cases', 'user_id', 'INSERT'),
  'authenticated users may provide their owner ID when creating a case'
);

select ok(
  has_column_privilege('authenticated', 'public.appraisal_cases', 'service_type', 'INSERT'),
  'authenticated users may provide service type when creating a case'
);

select ok(
  has_column_privilege('authenticated', 'public.appraisal_cases', 'last_activity_at', 'UPDATE'),
  'authenticated users may update case activity'
);

select ok(
  not has_column_privilege('authenticated', 'public.appraisal_cases', 'user_id', 'UPDATE'),
  'authenticated users may not transfer case ownership'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous clients cannot read profiles'
);

select ok(
  not has_table_privilege('anon', 'public.appraisal_cases', 'SELECT'),
  'anonymous clients cannot read appraisal cases'
);

select ok(
  has_column_privilege('service_role', 'public.appraisal_cases', 'status', 'UPDATE'),
  'the trusted service role may perform future status transitions'
);

select ok(
  exists (select 1 from storage.buckets where id = 'case-files'),
  'case-files storage bucket exists'
);

select ok(
  (select not bucket.public from storage.buckets as bucket where bucket.id = 'case-files'),
  'case-files storage bucket is private'
);

select is(
  (select bucket.file_size_limit from storage.buckets as bucket where bucket.id = 'case-files'),
  52428800::bigint,
  'case-files storage bucket has a 50 MiB limit'
);

select is(
  (select bucket.allowed_mime_types from storage.buckets as bucket where bucket.id = 'case-files'),
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]::text[],
  'case-files storage bucket accepts supported private case documents'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = 'public.touch_appraisal_case(uuid)'::regprocedure
  ),
  'touch_appraisal_case is SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = 'public.handle_new_user()'::regprocedure
  ),
  'the auth user trigger is SECURITY DEFINER'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.set_updated_at()'::regprocedure,
      'public.handle_new_user()'::regprocedure,
      'public.touch_appraisal_case(uuid)'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE privilege on any application function'
);

select ok(
  not has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.touch_appraisal_case(uuid)', 'EXECUTE'),
  'anon has no EXECUTE privilege on any application function'
);

select ok(
  not has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'authenticated clients cannot call trigger-only functions'
);

select ok(
  has_function_privilege('authenticated', 'public.touch_appraisal_case(uuid)', 'EXECUTE'),
  'authenticated clients may execute touch_appraisal_case'
);

select ok(
  has_function_privilege('service_role', 'public.touch_appraisal_case(uuid)', 'EXECUTE'),
  'the trusted service role may execute touch_appraisal_case'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.profiles'::regclass
      and trigger.tgname = 'profiles_set_updated_at'
      and not trigger.tgisinternal
  ),
  'profiles has a server timestamp trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.appraisal_cases'::regclass
      and trigger.tgname = 'appraisal_cases_set_updated_at'
      and not trigger.tgisinternal
  ),
  'appraisal_cases has a server timestamp trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'auth.users'::regclass
      and trigger.tgname = 'on_auth_user_created'
      and not trigger.tgisinternal
  ),
  'new auth users receive an application profile'
);

select * from finish();
rollback;
