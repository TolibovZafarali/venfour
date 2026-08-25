begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local storage.allow_delete_query = 'true';

select plan(166);

select ok(
  to_regtype('public.total_loss_intake_mode') is not null,
  'total_loss_intake_mode exists'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_intake_mode'::regtype
  ),
  array['report', 'manual']::text[],
  'total_loss_intake_mode has the intended values'
);

select ok(
  to_regtype('public.total_loss_report_upload_lease') is not null,
  'the report-upload lease return type exists'
);

select is(
  (
    select array_agg(attribute.attname::text order by attribute.attnum)
    from pg_type as composite_type
    join pg_attribute as attribute
      on attribute.attrelid = composite_type.typrelid
    where composite_type.oid = 'public.total_loss_report_upload_lease'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  array[
    'upload_id',
    'expires_at',
    'details_updated_at',
    'report_original_filename',
    'report_uploaded_at',
    'recovery_required'
  ]::text[],
  'the report-upload lease exposes only its typed coordination result'
);

select ok(
  to_regtype('public.total_loss_case_details_public') is not null,
  'the public report-metadata return type exists'
);

select is(
  (
    select array_agg(attribute.attname::text order by attribute.attnum)
    from pg_type as composite_type
    join pg_attribute as attribute
      on attribute.attrelid = composite_type.typrelid
    where composite_type.oid = 'public.total_loss_case_details_public'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  array[
    'case_id',
    'intake_mode',
    'vin',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
    'vehicle_trim',
    'mileage_at_loss',
    'postal_code',
    'date_of_loss',
    'insurer_name',
    'insurer_vehicle_valuation',
    'report_original_filename',
    'report_uploaded_at',
    'intake_completed_at',
    'created_at',
    'updated_at'
  ]::text[],
  'finalize and cancel return only the public details projection'
);

select has_table(
  'public',
  'total_loss_case_details',
  'total_loss_case_details table exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.total_loss_case_details'::regclass
  ),
  'total_loss_case_details has row-level security enabled'
);

select is(
  (
    select array_agg(column_info.column_name::text order by column_info.ordinal_position)
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
  ),
  array[
    'case_id',
    'intake_mode',
    'vin',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
    'vehicle_trim',
    'mileage_at_loss',
    'postal_code',
    'date_of_loss',
    'insurer_name',
    'insurer_vehicle_valuation',
    'report_original_filename',
    'report_uploaded_at',
    'report_upload_id',
    'report_upload_expires_at',
    'report_upload_details_updated_at',
    'report_upload_phase',
    'report_upload_has_backup',
    'report_last_upload_id',
    'report_last_cancelled_upload_id',
    'intake_completed_at',
    'created_at',
    'updated_at',
    'report_storage_owner_id',
    'vehicle_condition',
    'vehicle_options_packages',
    'report_provider_name',
    'report_extraction_status',
    'report_extraction_confidence',
    'report_extracted_at',
    'report_extraction_source_upload_id',
    'report_extraction_input_revision',
    'analysis_input_revision',
    'analysis_input_id',
    'report_facts_confirmed_at',
    'prior_title_status',
    'existing_damage_description',
    'report_upload_recovery_required',
    'vehicle_configuration'
  ]::text[],
  'the details table contains the public intake fields and internal upload coordination fields'
);

select is(
  (
    select array_agg(column_info.udt_name::text order by column_info.ordinal_position)
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
  ),
  array[
    'uuid',
    'total_loss_intake_mode',
    'text',
    'int2',
    'text',
    'text',
    'text',
    'int4',
    'text',
    'date',
    'text',
    'numeric',
    'text',
    'timestamptz',
    'uuid',
    'timestamptz',
    'timestamptz',
    'text',
    'bool',
    'uuid',
    'uuid',
    'timestamptz',
    'timestamptz',
    'timestamptz',
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'numeric',
    'timestamptz',
    'uuid',
    'int8',
    'int8',
    'uuid',
    'timestamptz',
    'text',
    'text',
    'bool',
    'jsonb'
  ]::text[],
  'all details and lease columns use the intended PostgreSQL types'
);

select is(
  (
    select column_info.is_generated || '|' || column_info.generation_expression
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
      and column_info.column_name = 'report_upload_recovery_required'
  ),
  'ALWAYS|(report_upload_id IS NOT NULL)',
  'the owner-visible recovery gate is generated only from private in-flight upload state'
);

select is(
  (
    select format('%s,%s', column_info.numeric_precision, column_info.numeric_scale)
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
      and column_info.column_name = 'insurer_vehicle_valuation'
  ),
  '12,2',
  'insurer vehicle valuation uses numeric(12,2)'
);

select col_is_pk(
  'public',
  'total_loss_case_details',
  'case_id',
  'case_id is the one-to-one primary key'
);

select fk_ok(
  'public',
  'total_loss_case_details',
  'case_id',
  'public',
  'appraisal_cases',
  'id',
  'case_id references appraisal_cases.id'
);

select ok(
  (
    select foreign_key.confdeltype = 'c'
    from pg_constraint as foreign_key
    where foreign_key.conrelid = 'public.total_loss_case_details'::regclass
      and foreign_key.contype = 'f'
      and foreign_key.conname = 'total_loss_case_details_case_id_fkey'
  ),
  'details are removed when the parent case is removed'
);

select ok(
  (
    select column_info.is_nullable = 'NO'
      and column_info.column_default like '%statement_timestamp%'
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
      and column_info.column_name = 'created_at'
  ),
  'created_at is a required server-generated timestamp'
);

select ok(
  (
    select column_info.is_nullable = 'NO'
      and column_info.column_default like '%statement_timestamp%'
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
      and column_info.column_name = 'updated_at'
  ),
  'updated_at is a required server-generated timestamp'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.total_loss_case_details'::regclass
      and trigger.tgname = 'total_loss_case_details_set_updated_at'
      and not trigger.tgisinternal
  ),
  'the details table has a server timestamp trigger'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.total_loss_case_details'::regclass
      and constraint_info.conname = 'total_loss_case_details_mileage_nonnegative'
      and constraint_info.contype = 'c'
  ),
  'the details table constrains mileage to nonnegative values'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.total_loss_case_details'::regclass
      and constraint_info.conname = 'total_loss_case_details_valuation_positive'
      and constraint_info.contype = 'c'
  ),
  'the details table constrains insurer valuation to positive values'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.total_loss_case_details'::regclass
      and constraint_info.conname = 'total_loss_case_details_report_upload_lease_complete'
      and constraint_info.contype = 'c'
  ),
  'the details table requires complete internal lease state'
);

select ok(
  has_type_privilege('authenticated', 'public.total_loss_intake_mode', 'USAGE'),
  'authenticated clients may use the intake enum'
);

select ok(
  has_type_privilege('authenticated', 'public.total_loss_report_upload_lease', 'USAGE'),
  'authenticated clients may consume typed lease results'
);

select ok(
  has_type_privilege('authenticated', 'public.total_loss_case_details_public', 'USAGE'),
  'authenticated clients may consume public details RPC results'
);

select ok(
  not has_table_privilege('anon', 'public.total_loss_case_details', 'SELECT'),
  'anonymous clients cannot select total-loss details'
);

select ok(
  not has_table_privilege('anon', 'public.total_loss_case_details', 'INSERT')
    and not has_table_privilege('anon', 'public.total_loss_case_details', 'UPDATE')
    and not has_table_privilege('anon', 'public.total_loss_case_details', 'DELETE'),
  'anonymous clients cannot mutate total-loss details'
);

select ok(
  (
    select bool_and(
      has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        public_column.column_name,
        'SELECT'
      )
    )
    from unnest(array[
      'case_id',
      'intake_mode',
      'vin',
      'vehicle_year',
      'vehicle_make',
      'vehicle_model',
      'vehicle_trim',
      'mileage_at_loss',
      'postal_code',
      'date_of_loss',
      'insurer_name',
      'insurer_vehicle_valuation',
      'prior_title_status',
      'vehicle_condition',
      'existing_damage_description',
      'vehicle_options_packages',
      'report_original_filename',
      'report_uploaded_at',
      'report_upload_recovery_required',
      'intake_completed_at',
      'created_at',
      'updated_at'
    ]) as public_column(column_name)
  ),
  'authenticated clients may select every public details field'
);

select ok(
  (
    select bool_and(
      not has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        internal_column.column_name,
        'SELECT'
      )
    )
    from unnest(array[
      'report_upload_id',
      'report_upload_expires_at',
      'report_upload_details_updated_at',
      'report_upload_phase',
      'report_upload_has_backup',
      'report_last_upload_id',
      'report_last_cancelled_upload_id'
    ]) as internal_column(column_name)
  ),
  'authenticated table reads cannot expose internal lease state'
);

select ok(
  (
    select bool_and(
      has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        insert_column.column_name,
        'INSERT'
      )
    )
    from unnest(array[
      'case_id',
      'intake_mode',
      'vin',
      'vehicle_year',
      'vehicle_make',
      'vehicle_model',
      'vehicle_trim',
      'mileage_at_loss',
      'postal_code',
      'date_of_loss',
      'insurer_name',
      'insurer_vehicle_valuation',
      'prior_title_status',
      'vehicle_condition',
      'existing_damage_description',
      'vehicle_options_packages'
    ]) as insert_column(column_name)
  ),
  'authenticated clients may insert only customer-entered intake fields'
);

select ok(
  (
    select bool_and(
      not has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        report_column.column_name,
        'INSERT'
      )
    )
    from unnest(array[
      'report_original_filename',
      'report_uploaded_at',
      'report_upload_id',
      'report_upload_expires_at',
      'report_upload_details_updated_at',
      'report_upload_phase',
      'report_upload_has_backup',
      'report_upload_recovery_required',
      'report_last_upload_id',
      'report_last_cancelled_upload_id',
      'intake_completed_at',
      'report_facts_confirmed_at',
      'analysis_input_revision',
      'analysis_input_id'
    ]) as report_column(column_name)
  ),
  'authenticated clients cannot directly insert report metadata or internal lease state'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.total_loss_case_details',
    'created_at',
    'INSERT'
  )
    and not has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'updated_at',
      'INSERT'
    ),
  'authenticated clients cannot provide audit timestamps during insert'
);

select ok(
  (
    select bool_and(
      has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        update_column.column_name,
        'UPDATE'
      )
    )
    from unnest(array[
      'intake_mode',
      'vin',
      'vehicle_year',
      'vehicle_make',
      'vehicle_model',
      'vehicle_trim',
      'mileage_at_loss',
      'postal_code',
      'date_of_loss',
      'insurer_name',
      'insurer_vehicle_valuation',
      'prior_title_status',
      'vehicle_condition',
      'existing_damage_description',
      'vehicle_options_packages'
    ]) as update_column(column_name)
  ),
  'authenticated clients may update customer-entered intake fields'
);

select ok(
  (
    select bool_and(
      not has_column_privilege(
        'authenticated',
        'public.total_loss_case_details',
        report_column.column_name,
        'UPDATE'
      )
    )
    from unnest(array[
      'report_original_filename',
      'report_uploaded_at',
      'report_upload_id',
      'report_upload_expires_at',
      'report_upload_details_updated_at',
      'report_upload_phase',
      'report_upload_has_backup',
      'report_upload_recovery_required',
      'report_last_upload_id',
      'report_last_cancelled_upload_id',
      'intake_completed_at',
      'report_facts_confirmed_at',
      'analysis_input_revision',
      'analysis_input_id'
    ]) as report_column(column_name)
  ),
  'authenticated clients cannot directly update report metadata or internal lease state'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.total_loss_case_details',
    'case_id',
    'UPDATE'
  )
    and not has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'created_at',
      'UPDATE'
    )
    and not has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'updated_at',
      'UPDATE'
    ),
  'authenticated clients cannot move details or update audit timestamps'
);

select ok(
  not has_table_privilege('authenticated', 'public.total_loss_case_details', 'DELETE'),
  'authenticated clients have no details delete API'
);

select ok(
  has_table_privilege('service_role', 'public.total_loss_case_details', 'SELECT')
    and has_table_privilege('service_role', 'public.total_loss_case_details', 'INSERT')
    and has_table_privilege('service_role', 'public.total_loss_case_details', 'UPDATE')
    and has_table_privilege('service_role', 'public.total_loss_case_details', 'DELETE'),
  'the trusted service role can manage all total-loss details fields'
);

select ok(
  has_column_privilege('authenticated', 'public.appraisal_cases', 'id', 'INSERT'),
  'authenticated clients may insert a reserved stable case ID'
);

select ok(
  not has_column_privilege('authenticated', 'public.appraisal_cases', 'status', 'INSERT')
    and not has_column_privilege('authenticated', 'public.appraisal_cases', 'status', 'UPDATE'),
  'stable IDs do not expose browser-controlled status transitions'
);

select ok(
  to_regprocedure(
    'public.acquire_total_loss_report_upload(uuid,timestamp with time zone,uuid)'
  ) is not null
    and to_regprocedure(
      'public.reclaim_total_loss_report_upload(uuid,timestamp with time zone,uuid)'
    ) is not null
    and to_regprocedure(
      'public.renew_total_loss_report_upload(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)'
    ) is not null
    and to_regprocedure(
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamp with time zone)'
    ) is not null
    and to_regprocedure(
      'public.cancel_total_loss_report_upload(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.authorize_total_loss_report_storage_write(text,jsonb)'
    ) is not null
    and to_regprocedure(
      'public.authorize_total_loss_report_backup_delete(text,jsonb)'
    ) is not null,
  'all report-upload RPC and storage authorization functions exist'
);

select ok(
  (
    select bool_and(procedure.prosecdef)
    from pg_proc as procedure
    where procedure.oid in (
      'public.acquire_total_loss_report_upload(uuid,timestamptz,uuid)'::regprocedure,
      'public.reclaim_total_loss_report_upload(uuid,timestamptz,uuid)'::regprocedure,
      'public.renew_total_loss_report_upload(uuid,uuid)'::regprocedure,
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)'::regprocedure,
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)'::regprocedure,
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.cancel_total_loss_report_upload(uuid,uuid)'::regprocedure,
      'public.authorize_total_loss_report_storage_write(text,jsonb)'::regprocedure,
      'public.authorize_total_loss_report_backup_delete(text,jsonb)'::regprocedure
    )
  ),
  'report-upload RPCs use SECURITY DEFINER for their narrow ownership checks'
);

select ok(
  (
    select bool_and(
      procedure.proretset
        and procedure.prorettype = 'public.total_loss_case_details_public'::regtype
    )
    from pg_proc as procedure
    where procedure.oid in (
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.cancel_total_loss_report_upload(uuid,uuid)'::regprocedure
    )
  ),
  'finalize and cancel return only the public details composite'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.acquire_total_loss_report_upload(uuid,timestamptz,uuid)'::regprocedure,
      'public.reclaim_total_loss_report_upload(uuid,timestamptz,uuid)'::regprocedure,
      'public.renew_total_loss_report_upload(uuid,uuid)'::regprocedure,
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)'::regprocedure,
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)'::regprocedure,
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.cancel_total_loss_report_upload(uuid,uuid)'::regprocedure,
      'public.authorize_total_loss_report_storage_write(text,jsonb)'::regprocedure,
      'public.authorize_total_loss_report_backup_delete(text,jsonb)'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE privilege on report-upload functions'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.acquire_total_loss_report_upload(uuid,timestamptz,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.reclaim_total_loss_report_upload(uuid,timestamptz,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.renew_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.cancel_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.authorize_total_loss_report_storage_write(text,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.authorize_total_loss_report_backup_delete(text,jsonb)',
      'EXECUTE'
    ),
  'anonymous clients cannot execute report-upload functions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.acquire_total_loss_report_upload(uuid,timestamptz,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.reclaim_total_loss_report_upload(uuid,timestamptz,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.renew_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.cancel_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.authorize_total_loss_report_storage_write(text,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.authorize_total_loss_report_backup_delete(text,jsonb)',
      'EXECUTE'
    ),
  'authenticated clients may execute only the typed report-upload surface'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.acquire_total_loss_report_upload(uuid,timestamptz,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'service_role',
      'public.reclaim_total_loss_report_upload(uuid,timestamptz,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.renew_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.mark_total_loss_report_upload_ready(uuid,uuid,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.complete_total_loss_report_upload_recovery(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.finalize_total_loss_report_upload(uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.cancel_total_loss_report_upload(uuid,uuid)',
      'EXECUTE'
    ),
  'the trusted service role may execute the report-upload lifecycle'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_total_loss_case_details_updated_at()',
    'EXECUTE'
  ),
  'authenticated clients cannot call the details timestamp trigger directly'
);

insert into auth.users (id, email)
values
  ('31111111-1111-4111-8111-111111111111', 'total-loss-user-one@example.test'),
  ('32222222-2222-4222-8222-222222222222', 'total-loss-user-two@example.test');

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status,
  last_activity_at
)
values
  (
    '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '31111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '32222222-2222-4222-8222-222222222222',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '32bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '32222222-2222-4222-8222-222222222222',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '31111111-1111-4111-8111-111111111111',
    'diminished_value',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '32cccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '31111111-1111-4111-8111-111111111111',
    'diminished_value',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    '31111111-1111-4111-8111-111111111111',
    'total_loss',
    'paid',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
    '31111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3fffffff-ffff-4fff-8fff-fffffffffff6',
    '31111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    '31111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    '2000-01-01 00:00:00+00'
  );

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  vehicle_make,
  created_at,
  updated_at
)
values
  (
    '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'manual',
    'Honda',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'report',
    'Toyota',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    'report',
    'Not draft',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  ),
  (
    '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
    'manual',
    'Ford',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    'manual',
    'Subaru',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  );

create temporary table report_upload_tokens (
  label text primary key,
  upload_id uuid not null,
  details_updated_at timestamptz not null
);

grant select, insert, update, delete
on table pg_temp.report_upload_tokens
to authenticated;

set local role anon;

select throws_ok(
  $$
    select case_id, intake_mode
    from public.total_loss_case_details
  $$,
  '42501',
  null,
  'anonymous clients are denied public details at runtime'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null,
      'aaaaaaaa-1000-4000-8000-000000000000'
    )
  $$,
  '42501',
  null,
  'anonymous clients are denied report-upload RPCs at runtime'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      '2000-01-01 00:00:00+00',
      null
    )
  $$,
  '22023',
  null,
  'acquire rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    select *
    from public.renew_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null
    )
  $$,
  '22023',
  null,
  'renew rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null,
      false
    )
  $$,
  '22023',
  null,
  'mark-ready rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    select *
    from public.complete_total_loss_report_upload_recovery(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null
    )
  $$,
  '22023',
  null,
  'recovery rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null,
      'valuation.pdf',
      statement_timestamp()
    )
  $$,
  '22023',
  null,
  'finalize rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null
    )
  $$,
  '22023',
  null,
  'cancel rejects a NULL upload attempt identifier'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (id, user_id, service_type)
    values (
      '34444444-4444-4444-8444-444444444444',
      '31111111-1111-4111-8111-111111111111',
      'total_loss'
    )
  $$,
  '42501',
  null,
  'a customer cannot bypass the locked total-loss draft RPC with a direct insert'
);

reset role;

insert into public.appraisal_cases (id, user_id, service_type)
values (
  '34444444-4444-4444-8444-444444444444',
  '31111111-1111-4111-8111-111111111111',
  'total_loss'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    select id, status::text
    from public.appraisal_cases
    where id = '34444444-4444-4444-8444-444444444444'
  $$,
  $$
    values (
      '34444444-4444-4444-8444-444444444444'::uuid,
      'draft'::text
    )
  $$,
  'the privileged fixture used by details tests receives draft status'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (id, user_id, service_type)
    values (
      '34444444-4444-4444-8444-444444444444',
      '31111111-1111-4111-8111-111111111111',
      'total_loss'
    )
  $$,
  '42501',
  null,
  'a direct retry remains denied at the customer authorization boundary'
);

select results_eq(
  $$
    select count(*)
    from public.appraisal_cases
    where id = '34444444-4444-4444-8444-444444444444'
  $$,
  $$values (1::bigint)$$,
  'a denied direct retry cannot duplicate the privileged fixture'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      created_at
    )
    values (
      '34444444-4444-4444-8444-444444444444',
      'manual',
      '2000-01-01 00:00:00+00'
    )
  $$,
  '42501',
  null,
  'a customer cannot spoof created_at during details creation'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      report_original_filename,
      report_uploaded_at
    )
    values (
      '34444444-4444-4444-8444-444444444444',
      'report',
      'forged.pdf',
      statement_timestamp()
    )
  $$,
  '42501',
  null,
  'a customer cannot directly insert report metadata'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      report_upload_id,
      report_upload_expires_at,
      report_upload_details_updated_at,
      report_upload_phase
    )
    values (
      '34444444-4444-4444-8444-444444444444',
      'report',
      'aaaaaaaa-0000-4000-8000-000000000001',
      statement_timestamp() + interval '30 minutes',
      statement_timestamp(),
      'preparing'
    )
  $$,
  '42501',
  null,
  'a customer cannot forge an internal report-upload lease'
);

select lives_ok(
  $$
    insert into public.total_loss_case_details (case_id, intake_mode)
    values ('34444444-4444-4444-8444-444444444444', 'manual')
  $$,
  'a customer can insert partial details for their own total-loss case'
);

select lives_ok(
  $$
    select
      case_id,
      intake_mode,
      vin,
      vehicle_year,
      vehicle_make,
      vehicle_model,
      vehicle_trim,
      mileage_at_loss,
      postal_code,
      date_of_loss,
      insurer_name,
      insurer_vehicle_valuation,
      report_original_filename,
      report_uploaded_at,
      report_upload_recovery_required,
      intake_completed_at,
      created_at,
      updated_at
    from public.total_loss_case_details
  $$,
  'an authenticated customer can select the public details projection'
);

select throws_ok(
  $$select * from public.total_loss_case_details$$,
  '42501',
  null,
  'an authenticated table wildcard cannot expose internal lease columns'
);

select is(
  (
    select count(*)
    from public.total_loss_case_details
    where case_id = '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  0::bigint,
  'a customer cannot select another account details row'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set
      report_original_filename = 'forged.pdf',
      report_uploaded_at = statement_timestamp()
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a customer cannot directly update report metadata'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set report_upload_phase = 'ready'
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a customer cannot directly update internal lease state'
);

select lives_ok(
  $$
    update public.total_loss_case_details
    set
      vin = '1HGCM82633A004352',
      vehicle_make = 'Honda Motor',
      mileage_at_loss = 120000,
      insurer_vehicle_valuation = 12450.25
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  'a customer can update mutable intake fields on their own details'
);

select ok(
  (
    select created_at = '2000-01-01 00:00:00+00'::timestamptz
      and updated_at > created_at
    from public.total_loss_case_details
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'an intake update advances only updated_at with database time'
);

select results_eq(
  $$
    select insurer_vehicle_valuation, intake_completed_at
    from public.total_loss_case_details
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$
    values (12450.25::numeric(12,2), null::timestamptz)
  $$,
  'valuation precision persists while the browser cannot author the intake completion marker'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set mileage_at_loss = -1
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '23514',
  null,
  'negative mileage is rejected'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set insurer_vehicle_valuation = 0
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '23514',
  null,
  'a non-positive insurer valuation is rejected'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set updated_at = '2000-01-01 00:00:00+00'
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a customer cannot spoof updated_at'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a customer cannot reattach details to another case'
);

select throws_ok(
  $$
    delete from public.total_loss_case_details
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a customer cannot delete their own details through the browser API'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (case_id, intake_mode)
    values ('32bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'report')
  $$,
  '42501',
  null,
  'a customer cannot attach details to another customer case'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (case_id, intake_mode)
    values ('32cccccc-cccc-4ccc-8ccc-ccccccccccc3', 'manual')
  $$,
  '23503',
  'A Total-Loss parent case is required.',
  'a customer cannot attach total-loss details to a diminished-value case'
);

set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';

select is(
  (
    select count(*)
    from public.total_loss_case_details
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  0::bigint,
  'another customer cannot see the first customer details'
);

select results_eq(
  $$
    with changed as (
      update public.total_loss_case_details
      set vehicle_make = 'Not Honda'
      where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'a cross-customer update is safely reduced to no rows'
);

reset role;

select is(
  (
    select vehicle_make
    from public.total_loss_case_details
    where case_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'Honda Motor',
  'a cross-customer update cannot alter the first customer details'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      null,
      'aaaaaaaa-1000-4000-8000-000000000010'
    )
  $$,
  '42501',
  null,
  'a customer cannot acquire an upload lease for another account case'
);

select throws_ok(
  $$
    select *
    from public.reclaim_total_loss_report_upload(
      '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      '2000-01-01 00:00:00+00',
      'aaaaaaaa-1000-4000-8000-000000000019'
    )
  $$,
  '42501',
  null,
  'a customer cannot reclaim another account report upload'
);

select throws_ok(
  $$
    select *
    from public.reclaim_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000020'
    )
  $$,
  '55000',
  null,
  'an owner cannot use recovery reclaim when no upload lease is active'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      null,
      'aaaaaaaa-1000-4000-8000-000000000011'
    )
  $$,
  '42501',
  null,
  'a customer cannot acquire an upload lease for a wrong-service case'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
      '2000-01-01 00:00:00+00',
      'aaaaaaaa-1000-4000-8000-000000000012'
    )
  $$,
  '42501',
  null,
  'a customer cannot acquire an upload lease for a non-draft case'
);

select throws_ok(
  $$
    select *
    from public.renew_total_loss_report_upload(
      '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'aaaaaaaa-1000-4000-8000-000000000013'
    )
  $$,
  '42501',
  null,
  'renew cannot reach another account case'
);

select throws_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      'aaaaaaaa-1000-4000-8000-000000000014',
      false
    )
  $$,
  '42501',
  null,
  'mark-ready cannot reach a wrong-service case'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'aaaaaaaa-1000-4000-8000-000000000015',
      'forged.pdf',
      statement_timestamp()
    )
  $$,
  '42501',
  null,
  'finalize cannot reach another account case'
);

select throws_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      'aaaaaaaa-1000-4000-8000-000000000016'
    )
  $$,
  '42501',
  null,
  'cancel cannot reach a wrong-service case'
);

select lives_ok(
  $$
    insert into pg_temp.report_upload_tokens (
      label,
      upload_id,
      details_updated_at
    )
    select
      'new-details',
      lease.upload_id,
      lease.details_updated_at
    from public.acquire_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      null,
      'aaaaaaaa-1000-4000-8000-000000000001'
    ) as lease
  $$,
  'NULL acquisition atomically creates missing report details and a lease'
);

reset role;

select ok(
  (
    select details.intake_mode = 'report'
      and details.report_upload_id = token.upload_id
      and details.report_upload_details_updated_at = details.updated_at
      and details.report_upload_phase = 'preparing'
      and not details.report_upload_has_backup
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'new-details'
    where details.case_id = '3fffffff-ffff-4fff-8fff-fffffffffff6'
  ),
  'NULL acquisition persists one report-mode details row with a preparing lease'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      null,
      'aaaaaaaa-1000-4000-8000-000000000001'
    )
  $$,
  'retrying a lost NULL acquisition with the reserved token is idempotent'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      null,
      'aaaaaaaa-1000-4000-8000-000000000002'
    )
  $$,
  '40001',
  null,
  'NULL acquisition with a different token cannot replace existing details'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'new-details'
      ),
      false
    )
  $$,
  'a new report without prior metadata can be marked ready without a backup'
);

select lives_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'new-details'
      )
    )
  $$,
  'an initial ready upload can be cancelled when no prior report needs recovery'
);

select lives_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'new-details'
      )
    )
  $$,
  'retrying the same cancellation token is idempotent'
);

reset role;

select ok(
  (
    select details.report_upload_id is null
      and details.report_upload_expires_at is null
      and details.report_upload_details_updated_at is null
      and details.report_upload_phase is null
      and not details.report_upload_has_backup
      and details.report_last_cancelled_upload_id = token.upload_id
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'new-details'
    where details.case_id = '3fffffff-ffff-4fff-8fff-fffffffffff6'
  ),
  'cancellation records its idempotency token and clears the complete lease'
);

update public.appraisal_cases
set status = 'paid'
where id = '3fffffff-ffff-4fff-8fff-fffffffffff6';

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '3fffffff-ffff-4fff-8fff-fffffffffff6',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'new-details'
      )
    )
  $$,
  'a committed cancellation retry remains idempotent after parent status changes'
);

reset role;

update public.appraisal_cases
set status = 'draft'
where id = '3fffffff-ffff-4fff-8fff-fffffffffff6';

select is(
  (
    select status::text
    from public.appraisal_cases
    where id = '3fffffff-ffff-4fff-8fff-fffffffffff6'
  ),
  'draft',
  'NULL acquisition and cancellation leave the parent status in draft'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '31111111-1111-4111-8111-111111111111/3fffffff-ffff-4fff-8fff-fffffffffff6/valuation-report-backup.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'new-details'
  $$,
  '42501',
  null,
  'a cancelled token cannot write a reserved report object'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      null,
      'aaaaaaaa-1000-4000-8000-000000000003'
    )
  $$,
  '40001',
  null,
  'NULL acquisition cannot overwrite an existing details row'
);

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      '1999-01-01 00:00:00+00',
      'aaaaaaaa-1000-4000-8000-000000000004'
    )
  $$,
  '40001',
  null,
  'acquisition rejects a stale public details version'
);

select lives_ok(
  $$
    insert into pg_temp.report_upload_tokens (
      label,
      upload_id,
      details_updated_at
    )
    select
      'initial',
      lease.upload_id,
      lease.details_updated_at
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000005'
    ) as lease
  $$,
  'an exact public details version acquires the owned draft lease'
);

reset role;

select ok(
  (
    select details.report_upload_id = token.upload_id
      and details.report_upload_details_updated_at = token.details_updated_at
      and details.updated_at = token.details_updated_at
      and details.report_upload_phase = 'preparing'
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'initial'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'acquisition snapshots the public details version without advancing it'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000006'
    )
  $$,
  '55P03',
  null,
  'a second acquisition cannot replace an unexpired active lease'
);

select throws_ok(
  $$
    select *
    from public.renew_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      'aaaaaaaa-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  null,
  'a stale token cannot renew an active lease'
);

select lives_ok(
  $$
    select *
    from public.renew_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      )
    )
  $$,
  'the exact active token can renew its lease'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'initial'
  $$,
  '42501',
  null,
  'the canonical report path cannot be written during the preparing phase'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf',
      jsonb_build_object(
        'uploadId',
        'aaaaaaaa-0000-4000-8000-000000000003'
      )
    )
  $$,
  '42501',
  null,
  'a reserved backup path rejects metadata for a stale token'
);

select throws_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      'aaaaaaaa-0000-4000-8000-000000000004',
      false
    )
  $$,
  '55000',
  null,
  'a stale token cannot mark another upload ready'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      false
    )
  $$,
  'an initial upload can advance from preparing to ready'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      false
    )
  $$,
  'retrying mark-ready with the same token and backup state is idempotent'
);

reset role;

select ok(
  (
    select details.report_upload_phase = 'ready'
      and not details.report_upload_has_backup
      and details.report_upload_recovery_required
      and details.report_upload_id = token.upload_id
      and details.updated_at = token.details_updated_at
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'initial'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'mark-ready preserves the exact token and public details version'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'valuation.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '55000',
  null,
  'finalization requires a canonical object carrying the active token'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf',
      jsonb_build_object(
        'uploadId',
        'aaaaaaaa-0000-4000-8000-000000000005'
      )
    )
  $$,
  '42501',
  null,
  'the canonical report path rejects a stale storage token'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '32222222-2222-4222-8222-222222222222/3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/valuation-report.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'initial'
  $$,
  '42501',
  null,
  'an active token cannot write into another account report path'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'initial'
  $$,
  'the ready token can write the deterministic private canonical path'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'folder/valuation.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects display filenames containing path separators'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      E'valuation\nreport.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects control characters in display filenames'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      U&'valuation\202Efdp.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects bidirectional override characters in display filenames'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'valuation.txt',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects non-PDF display filenames'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'valuation  report.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects uncollapsed whitespace in display filenames'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      ' valuation.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '22023',
  null,
  'finalization rejects untrimmed display filenames'
);

reset role;

select ok(
  (
    select details.report_original_filename is null
      and details.report_uploaded_at is null
      and details.report_last_upload_id is null
      and details.report_upload_id = token.upload_id
      and details.report_upload_phase = 'ready'
      and details.report_upload_details_updated_at = token.details_updated_at
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'initial'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'unsafe filename rejection preserves report metadata and the active ready lease'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      'aaaaaaaa-0000-4000-8000-000000000006',
      'valuation.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  '55000',
  null,
  'a stale token cannot finalize another upload'
);

select lives_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'valuation.pdf',
      '2026-08-18 12:30:00+00'
    )
  $$,
  'the exact token atomically finalizes report metadata'
);

select lives_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'ignored-on-idempotent-retry.pdf',
      '2026-08-18 12:31:00+00'
    )
  $$,
  'retrying the committed finalization token is idempotent'
);

reset role;

select ok(
  (
    select details.intake_mode = 'report'
      and details.report_original_filename = 'valuation.pdf'
      and details.report_uploaded_at = '2026-08-18 12:30:00+00'::timestamptz
      and details.report_last_upload_id = token.upload_id
      and details.report_upload_id is null
      and details.report_upload_expires_at is null
      and details.report_upload_details_updated_at is null
      and details.report_upload_phase is null
      and not details.report_upload_has_backup
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'initial'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'finalization commits the first metadata once and clears the complete lease'
);

select ok(
  (
    select appraisal_case.status = 'draft'
      and appraisal_case.last_activity_at > '2000-01-01 00:00:00+00'::timestamptz
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'finalization touches parent activity while leaving status in draft'
);

update public.appraisal_cases
set status = 'paid'
where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'initial'
      ),
      'ignored-after-status-change.pdf',
      '2026-08-18 12:32:00+00'
    )
  $$,
  'a committed finalization retry remains idempotent after parent status changes'
);

reset role;

update public.appraisal_cases
set status = 'draft'
where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select is(
  public.authorize_total_loss_report_storage_write(
    '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf',
    (
      select jsonb_build_object('uploadId', token.upload_id::text)
      from pg_temp.report_upload_tokens as token
      where token.label = 'initial'
    )
  ),
  false,
  'a finalized token is stale for future reserved-path writes'
);

select results_eq(
  $$
    with removed as (
      delete from storage.objects
      where bucket_id = 'case-files'
        and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf'
      returning 1
    )
    select count(*) from removed
  $$,
  $$values (0::bigint)$$,
  'a customer cannot directly delete the committed canonical report'
);

set local storage.operation = 'storage.object.move';

select results_eq(
  $$
    with renamed as (
      update storage.objects
      set name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/moved-report.pdf'
      where bucket_id = 'case-files'
        and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf'
      returning 1
    )
    select count(*) from renamed
  $$,
  $$values (0::bigint)$$,
  'a customer cannot bypass canonical deletion by renaming the reserved object'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf'
  ),
  1::bigint,
  'the committed canonical object remains at its deterministic path'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    insert into pg_temp.report_upload_tokens (
      label,
      upload_id,
      details_updated_at
    )
    select
      'replacement',
      lease.upload_id,
      lease.details_updated_at
    from public.acquire_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000007'
    ) as lease
  $$,
  'an exact post-finalization version can acquire a replacement lease'
);

select throws_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement'
      ),
      false
    )
  $$,
  '55000',
  null,
  'replacement cannot become ready until the committed report is backed up'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'replacement'
  $$,
  'the preparing replacement token can write its deterministic backup path'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement'
      ),
      true
    )
  $$,
  'a token-matched backup permits replacement to become ready'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement'
      ),
      true
    )
  $$,
  'replacement mark-ready is idempotent with the same backup state'
);

select is(
  (
    select report_upload_recovery_required
    from public.total_loss_case_details
    where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  true,
  'the owner can read the recovery gate without access to private lease state'
);

select is(
  public.authorize_total_loss_report_storage_write(
    '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf',
    (
      select jsonb_build_object('uploadId', token.upload_id::text)
      from pg_temp.report_upload_tokens as token
      where token.label = 'initial'
    )
  ),
  false,
  'a prior upload token cannot replace the canonical object'
);

set local storage.operation = 'storage.object.upload_update';

select lives_ok(
  $$
    update storage.objects
    set user_metadata = (
      select jsonb_build_object('uploadId', token.upload_id::text)
      from pg_temp.report_upload_tokens as token
      where token.label = 'replacement'
    )
    where bucket_id = 'case-files'
      and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf'
  $$,
  'the ready replacement token can overwrite the deterministic canonical object'
);

select lives_ok(
  $$
    insert into pg_temp.report_upload_tokens (
      label,
      upload_id,
      details_updated_at
    )
    select
      'replacement-recovery',
      lease.upload_id,
      lease.details_updated_at
    from public.reclaim_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000008'
    ) as lease
  $$,
  'an owner can immediately take over an unexpired recoverable replacement'
);

select is(
  (
    select lease.recovery_required
    from public.reclaim_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
      ),
      'aaaaaaaa-1000-4000-8000-000000000008'
    ) as lease
  ),
  true,
  'the takeover token resumes the interrupted replacement in recovery mode'
);

select throws_ok(
  $$
    select *
    from public.renew_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement'
      )
    )
  $$,
  '55000',
  null,
  'the interrupted replacement token loses the lease after recovery takeover'
);

select lives_ok(
  $$
    update storage.objects
    set user_metadata = (
      select jsonb_build_object('uploadId', token.upload_id::text)
      from pg_temp.report_upload_tokens as token
      where token.label = 'replacement-recovery'
    )
    where bucket_id = 'case-files'
      and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf'
  $$,
  'the recovery takeover token can re-fence the retained backup object'
);

select lives_ok(
  $$
    update storage.objects
    set user_metadata = (
      select jsonb_build_object('uploadId', token.upload_id::text)
      from pg_temp.report_upload_tokens as token
      where token.label = 'replacement-recovery'
    )
    where bucket_id = 'case-files'
      and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report.pdf'
  $$,
  'the recovery takeover token can restore and re-fence the canonical report'
);

select lives_ok(
  $$
    select *
    from public.complete_total_loss_report_upload_recovery(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement-recovery'
      )
    )
  $$,
  'the takeover token can complete recovery without waiting for lease expiry'
);

reset role;

select ok(
  (
    select details.report_upload_id = token.upload_id
      and details.report_upload_phase = 'preparing'
      and not details.report_upload_has_backup
      and details.report_upload_recovery_required
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'replacement-recovery'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'completed takeover recovery preserves the new lease for immediate retry'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement-recovery'
      ),
      true
    )
  $$,
  'the recovered lease can immediately begin the replacement again'
);

select lives_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement-recovery'
      ),
      'replacement.pdf',
      '2026-08-18 13:30:00+00'
    )
  $$,
  'a backed-up replacement can finalize with its exact token'
);

select lives_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'replacement-recovery'
      ),
      'ignored-retry.pdf',
      '2026-08-18 13:31:00+00'
    )
  $$,
  'replacement finalization is idempotent for the committed token'
);

reset role;

select ok(
  (
    select details.report_original_filename = 'replacement.pdf'
      and details.report_uploaded_at = '2026-08-18 13:30:00+00'::timestamptz
      and details.report_last_upload_id = token.upload_id
      and details.report_upload_id is null
      and details.report_upload_details_updated_at is null
      and not details.report_upload_has_backup
      and not details.report_upload_recovery_required
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'replacement-recovery'
    where details.case_id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'replacement finalization commits only the first metadata and releases the lease'
);

update storage.objects
set user_metadata = (
  select jsonb_build_object('uploadId', token.upload_id::text)
  from pg_temp.report_upload_tokens as token
  where token.label = 'initial'
)
where bucket_id = 'case-files'
  and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf';

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    with removed as (
      delete from storage.objects
      where bucket_id = 'case-files'
        and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf'
      returning 1
    )
    select count(*) from removed
  $$,
  $$values (0::bigint)$$,
  'a stale finalized token cannot delete a newer replacement backup'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf'
  ),
  1::bigint,
  'the backup remains after a stale-token delete attempt'
);

update storage.objects
set user_metadata = (
  select jsonb_build_object('uploadId', token.upload_id::text)
  from pg_temp.report_upload_tokens as token
  where token.label = 'replacement-recovery'
)
where bucket_id = 'case-files'
  and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf';

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    with removed as (
      delete from storage.objects
      where bucket_id = 'case-files'
        and name = '31111111-1111-4111-8111-111111111111/3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5/valuation-report-backup.pdf'
      returning 1
    )
    select count(*) from removed
  $$,
  $$values (1::bigint)$$,
  'the most recently finalized token can clean up its own backup'
);

reset role;

select is(
  (
    select status::text
    from public.appraisal_cases
    where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
  ),
  'draft',
  'initial and replacement report finalization never advance parent status'
);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    insert into pg_temp.report_upload_tokens (
      label,
      upload_id,
      details_updated_at
    )
    select
      'conflict',
      lease.upload_id,
      lease.details_updated_at
    from public.acquire_total_loss_report_upload(
      '30000000-0000-4000-8000-000000000007',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '30000000-0000-4000-8000-000000000007'
      ),
      'aaaaaaaa-1000-4000-8000-000000000008'
    ) as lease
  $$,
  'a separate owned draft can acquire a lease for concurrency testing'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '30000000-0000-4000-8000-000000000007',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'conflict'
      ),
      false
    )
  $$,
  'the concurrency-test upload can be marked ready'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    select
      'case-files',
      '31111111-1111-4111-8111-111111111111/30000000-0000-4000-8000-000000000007/valuation-report.pdf',
      jsonb_build_object('uploadId', token.upload_id::text)
    from pg_temp.report_upload_tokens as token
    where token.label = 'conflict'
  $$,
  'the concurrency-test upload stores its token-matched canonical object'
);

select lives_ok(
  $$
    update public.total_loss_case_details
    set vehicle_model = 'Outback'
    where case_id = '30000000-0000-4000-8000-000000000007'
  $$,
  'customer-entered details can change while an upload is in flight'
);

select throws_ok(
  $$
    select *
    from public.finalize_total_loss_report_upload(
      '30000000-0000-4000-8000-000000000007',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'conflict'
      ),
      'conflicted.pdf',
      '2026-08-18 14:00:00+00'
    )
  $$,
  '40001',
  null,
  'finalization refuses to overwrite details changed during the upload'
);

select lives_ok(
  $$
    select *
    from public.cancel_total_loss_report_upload(
      '30000000-0000-4000-8000-000000000007',
      (
        select upload_id
        from pg_temp.report_upload_tokens
        where label = 'conflict'
      )
    )
  $$,
  'a conflicted initial upload can release its lease without report metadata'
);

reset role;

select ok(
  (
    select details.report_original_filename is null
      and details.report_uploaded_at is null
      and details.report_upload_id is null
      and details.report_upload_details_updated_at is null
      and details.report_last_cancelled_upload_id = token.upload_id
    from public.total_loss_case_details as details
    join pg_temp.report_upload_tokens as token
      on token.label = 'conflict'
    where details.case_id = '30000000-0000-4000-8000-000000000007'
  ),
  'a conflict preserves public report metadata and clears its cancelled lease'
);

select is(
  (
    select status::text
    from public.appraisal_cases
    where id = '30000000-0000-4000-8000-000000000007'
  ),
  'draft',
  'optimistic upload conflicts leave the parent status in draft'
);

delete from public.appraisal_cases
where id = '34444444-4444-4444-8444-444444444444';

select results_eq(
  $$
    select count(*)
    from public.total_loss_case_details
    where case_id = '34444444-4444-4444-8444-444444444444'
  $$,
  $$values (0::bigint)$$,
  'deleting a parent case cascades to its one-to-one details row'
);

select * from finish();
rollback;
