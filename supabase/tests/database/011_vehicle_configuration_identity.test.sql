begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

select has_function(
  'public',
  'vehicle_configuration_is_valid',
  array['jsonb'],
  'the reusable vehicle-configuration validator exists'
);

select ok(
  (
    select procedure.provolatile = 'i'
      and procedure.proisstrict
      and not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.vehicle_configuration_is_valid(jsonb)'::regprocedure
  ),
  'the validator is immutable, strict, invoker-rights, and pins an empty search path'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid =
      'public.vehicle_configuration_is_valid(jsonb)'::regprocedure
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.vehicle_configuration_is_valid(jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.vehicle_configuration_is_valid(jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.vehicle_configuration_is_valid(jsonb)',
      'EXECUTE'
    ),
  'only table-writing roles can execute the validator'
);

select is(
  (
    select concat_ws(
      '|',
      column_info.udt_name,
      column_info.is_nullable,
      coalesce(column_info.column_default, '')
    )
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'total_loss_case_details'
      and column_info.column_name = 'vehicle_configuration'
  ),
  'jsonb|YES|',
  'total-loss vehicle configuration is nullable JSONB without a browser-independent default'
);

select is(
  (
    select concat_ws(
      '|',
      column_info.udt_name,
      column_info.is_nullable,
      coalesce(column_info.column_default, '')
    )
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'diminished_value_case_details'
      and column_info.column_name = 'vehicle_configuration'
  ),
  'jsonb|YES|',
  'diminished-value vehicle configuration is nullable JSONB without a browser-independent default'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid =
      'public.total_loss_case_details'::regclass
      and constraint_info.conname =
        'total_loss_case_details_vehicle_configuration_valid'
      and constraint_info.contype = 'c'
  ),
  'total-loss details enforce the reusable vehicle-configuration validator'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid =
      'public.diminished_value_case_details'::regclass
      and constraint_info.conname =
        'diminished_value_case_details_vehicle_configuration_valid'
      and constraint_info.contype = 'c'
  ),
  'diminished-value details enforce the reusable vehicle-configuration validator'
);

select ok(
  (
    select count(*) = 2
      and bool_and(constraint_info.convalidated)
    from pg_constraint as constraint_info
    where constraint_info.conrelid in (
      'public.total_loss_case_details'::regclass,
      'public.diminished_value_case_details'::regclass
    )
      and constraint_info.conname in (
        'total_loss_case_details_vehicle_configuration_identity_complete',
        'diminished_value_case_details_vehicle_config_identity_complete'
      )
      and constraint_info.contype = 'c'
  ),
  'both detail tables require a complete vehicle identity behind provider configuration'
);

select ok(
  (
    select 'vehicle_configuration' = any(procedure.proargnames)
    from pg_proc as procedure
    where procedure.oid =
      'public.get_submitted_diminished_value_case(uuid)'::regprocedure
  ),
  'the staff diminished-value detail projection retains provider vehicle identity'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.total_loss_case_details',
    'vehicle_configuration',
    'SELECT'
  )
    and has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'vehicle_configuration',
      'INSERT'
    )
    and has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'vehicle_configuration',
      'UPDATE'
    ),
  'authenticated customers can read and write total-loss configuration identity'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.diminished_value_case_details',
    'vehicle_configuration',
    'SELECT'
  )
    and has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'vehicle_configuration',
      'INSERT'
    )
    and has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'vehicle_configuration',
      'UPDATE'
    ),
  'authenticated customers can read and write diminished-value configuration identity'
);

select ok(
  public.vehicle_configuration_is_valid(
    '{
      "source": "marketcheck.v2",
      "field": "trim",
      "values": ["Long Range", "Long Range Battery"]
    }'::jsonb
  ),
  'a normalized provider alias set is valid'
);

select ok(
  public.vehicle_configuration_is_valid(
    jsonb_build_object(
      'source', repeat('a', 50),
      'field', 'version',
      'values', (
        select jsonb_agg(
          case
            when value_number = 1 then repeat('A', 200)
            else 'Version ' || value_number::text
          end
          order by value_number
        )
        from generate_series(1, 20) as value_number
      )
    )
  ),
  'the documented provider, value-length, and alias-count boundaries are accepted'
);

select ok(
  (
    select bool_and(
      not public.vehicle_configuration_is_valid(candidate.configuration)
    )
    from (
      values
        ('[]'::jsonb),
        ('{"source":"marketcheck","field":"trim"}'::jsonb),
        ('{"source":"marketcheck","field":"trim","values":["SE"],"extra":true}'::jsonb),
        ('{"source":1,"field":"trim","values":["SE"]}'::jsonb),
        ('{"source":"marketcheck","field":"trim","values":"SE"}'::jsonb)
    ) as candidate(configuration)
  ),
  'non-objects, missing or extra keys, and wrong value types are rejected'
);

select ok(
  (
    select bool_and(
      not public.vehicle_configuration_is_valid(
        jsonb_build_object(
          'source', invalid_source.source,
          'field', 'trim',
          'values', jsonb_build_array('SE')
        )
      )
    )
    from (
      values
        ('MarketCheck'),
        ('.marketcheck'),
        ('market check'),
        ('market/check'),
        (repeat('a', 51))
    ) as invalid_source(source)
  ),
  'provider ids outside the bounded lowercase safe pattern are rejected'
);

select ok(
  (
    select bool_and(
      not public.vehicle_configuration_is_valid(
        jsonb_build_object(
          'source', 'marketcheck',
          'field', invalid_field.field,
          'values', jsonb_build_array('SE')
        )
      )
    )
    from (values ('drivetrain'), ('Trim'), ('')) as invalid_field(field)
  ),
  'only trim and version provider fields are accepted'
);

select ok(
  not public.vehicle_configuration_is_valid(
    '{"source":"marketcheck","field":"trim","values":[]}'::jsonb
  )
    and not public.vehicle_configuration_is_valid(
      jsonb_build_object(
        'source', 'marketcheck',
        'field', 'trim',
        'values', (
          select jsonb_agg('Trim ' || value_number::text)
          from generate_series(1, 21) as value_number
        )
      )
    )
    and not public.vehicle_configuration_is_valid(
      '{"source":"marketcheck","field":"trim","values":[1]}'::jsonb
    ),
  'empty, oversized, and non-string value arrays are rejected'
);

select ok(
  (
    select bool_and(
      not public.vehicle_configuration_is_valid(
        jsonb_build_object(
          'source', 'marketcheck',
          'field', 'trim',
          'values', jsonb_build_array(invalid_value.value)
        )
      )
    )
    from (
      values
        (' Long Range'),
        ('Long Range '),
        ('Long  Range'),
        (E'Long\tRange'),
        (repeat('A', 201))
    ) as invalid_value(value)
  ),
  'unnormalized whitespace and overlong provider values are rejected'
);

select ok(
  (
    select bool_and(
      not public.vehicle_configuration_is_valid(
        jsonb_build_object(
          'source', 'marketcheck',
          'field', 'trim',
          'values', jsonb_build_array(unsafe_value.value)
        )
      )
    )
    from (
      values
        ('Long Range,Long Range Battery'),
        (E'Long\nRange'),
        (U&'Long\202ERange')
    ) as unsafe_value(value)
  ),
  'comma, control, and bidirectional-control provider values are rejected'
);

select ok(
  not public.vehicle_configuration_is_valid(
    '{
      "source": "marketcheck",
      "field": "trim",
      "values": ["Long Range", "long range"]
    }'::jsonb
  ),
  'provider values must be unique case-insensitively'
);

insert into auth.users (id, email)
values (
  '71111111-1111-4111-8111-111111111111',
  'vehicle-configuration-owner@example.test'
);

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status
)
values
  (
    '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '71111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft'
  ),
  (
    '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '71111111-1111-4111-8111-111111111111',
    'diminished_value',
    'draft'
  );

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_loss,
  postal_code,
  date_of_loss,
  insurer_name,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id,
  intake_completed_at,
  report_provider_name,
  report_extraction_status,
  report_extraction_confidence,
  report_extracted_at,
  report_extraction_source_upload_id,
  report_extraction_input_revision,
  report_facts_confirmed_at
)
values (
  '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'report',
  2019,
  'Tesla',
  'Model 3',
  'Long Range AWD',
  50000,
  '63101',
  '2026-08-01',
  'Example Insurer',
  'valuation-report.pdf',
  '2026-08-25 10:00:00+00',
  '7ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  '2026-08-25 10:30:00+00',
  'CCC',
  'confirmed',
  0.9000,
  '2026-08-25 10:15:00+00',
  '7ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  1,
  '2026-08-25 10:30:00+00'
);

insert into public.diminished_value_case_details (
  case_id,
  vehicle_entry_method,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim
)
values (
  '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'details',
  2021,
  'BMW',
  'X5',
  'xDrive40i'
);

create temporary table pg_temp.vehicle_configuration_fences as
select
  details.case_id,
  details.analysis_input_revision,
  details.analysis_input_id,
  details.updated_at
from public.total_loss_case_details as details
where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select set_config(
  'request.jwt.claim.sub',
  '71111111-1111-4111-8111-111111111111',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$
    update public.total_loss_case_details
    set vehicle_configuration = '{
      "source": "marketcheck",
      "field": "trim",
      "values": ["Long Range", "Long Range Battery"]
    }'::jsonb
    where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  'an owner can retain the provider identity behind a total-loss configuration'
);

select lives_ok(
  $$
    update public.diminished_value_case_details
    set vehicle_configuration = '{
      "source": "marketcheck",
      "field": "version",
      "values": ["xDrive40i"]
    }'::jsonb
    where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  $$,
  'an owner can retain the provider identity behind a diminished-value configuration'
);

reset role;

select ok(
  (
    select details.analysis_input_revision = fence.analysis_input_revision + 1
      and details.analysis_input_id is distinct from fence.analysis_input_id
      and details.updated_at >= fence.updated_at
      and details.intake_completed_at is null
      and details.report_facts_confirmed_at is null
      and details.report_extraction_status = 'pending'
      and details.report_extraction_confidence is null
      and details.report_extracted_at is null
      and details.report_extraction_source_upload_id is null
      and details.report_extraction_input_revision is null
      and details.report_provider_name = 'CCC'
    from public.total_loss_case_details as details
    join pg_temp.vehicle_configuration_fences as fence
      on fence.case_id = details.case_id
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'a configuration change advances total-loss fences and clears confirmation and stale extraction state exactly like trim changes'
);

select ok(
  (
    select details.revision = 1
      and details.vehicle_configuration = '{
        "source": "marketcheck",
        "field": "version",
        "values": ["xDrive40i"]
      }'::jsonb
    from public.diminished_value_case_details as details
    where details.case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  'a configuration change advances the diminished-value material revision'
);

select is(
  (
    select array_agg(snapshot_key order by snapshot_key)
    from public.total_loss_case_details as details
    cross join lateral jsonb_object_keys(
      public.build_total_loss_analysis_input_snapshot(details)
    ) as snapshot_key
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  array[
    'analysis_input_id',
    'analysis_input_revision',
    'case_id',
    'date_of_loss',
    'existing_damage_description',
    'insurer_name',
    'insurer_vehicle_valuation',
    'intake_completed_at',
    'intake_mode',
    'mileage_at_loss',
    'postal_code',
    'prior_title_status',
    'report_provider_name',
    'vehicle_condition',
    'vehicle_configuration',
    'vehicle_make',
    'vehicle_model',
    'vehicle_options_packages',
    'vehicle_trim',
    'vehicle_year',
    'vin'
  ]::text[],
  'the analysis snapshot preserves every latest claim field and adds vehicle configuration'
);

select is(
  (
    select
      public.build_total_loss_analysis_input_snapshot(details)
        -> 'vehicle_configuration'
    from public.total_loss_case_details as details
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  '{
    "source": "marketcheck",
    "field": "trim",
    "values": ["Long Range", "Long Range Battery"]
  }'::jsonb,
  'the analysis snapshot retains the exact provider identity rather than the display label'
);

update public.total_loss_case_details
set vehicle_trim = 'Long Range'
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select is(
  (
    select details.vehicle_configuration
    from public.total_loss_case_details as details
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  '{
    "source": "marketcheck",
    "field": "trim",
    "values": ["Long Range", "Long Range Battery"]
  }'::jsonb,
  'a total-loss canonical trim-label refresh preserves the exact provider identity'
);

update public.total_loss_case_details
set vehicle_model = 'Model Y'
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select is(
  (
    select details.vehicle_configuration
    from public.total_loss_case_details as details
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  null::jsonb,
  'changing the total-loss year, make, or model clears stale provider identity'
);

update public.total_loss_case_details
set
  vehicle_model = 'Model 3',
  vehicle_trim = 'Long Range AWD',
  vehicle_configuration = '{
    "source": "marketcheck",
    "field": "trim",
    "values": ["Long Range", "Long Range Battery"]
  }'::jsonb
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

update public.diminished_value_case_details
set vehicle_trim = 'XDrive 40i'
where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select is(
  (
    select details.vehicle_configuration
    from public.diminished_value_case_details as details
    where details.case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  '{
    "source": "marketcheck",
    "field": "version",
    "values": ["xDrive40i"]
  }'::jsonb,
  'a diminished-value canonical trim-label refresh preserves the exact provider identity'
);

update public.diminished_value_case_details
set vehicle_model = 'X6'
where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select is(
  (
    select details.vehicle_configuration
    from public.diminished_value_case_details as details
    where details.case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  null::jsonb,
  'changing the diminished-value year, make, or model clears stale provider identity'
);

update public.diminished_value_case_details
set
  vehicle_model = 'X5',
  vehicle_trim = 'xDrive40i',
  vehicle_configuration = '{
    "source": "marketcheck",
    "field": "version",
    "values": ["xDrive40i"]
  }'::jsonb
where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

update public.total_loss_case_details
set report_last_upload_id = '7ddddddd-dddd-4ddd-8ddd-ddddddddddd4'
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select is(
  (
    select details.vehicle_configuration
    from public.total_loss_case_details as details
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  null::jsonb,
  'adopting a different report upload clears the provider identity from the prior vehicle'
);

update public.total_loss_case_details
set
  intake_mode = 'manual',
  vehicle_configuration = '{
    "source": "marketcheck",
    "field": "trim",
    "values": ["Long Range", "Long Range Battery"]
  }'::jsonb
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

update public.total_loss_case_details
set intake_mode = 'report'
where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select is(
  (
    select details.vehicle_configuration
    from public.total_loss_case_details as details
    where details.case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  null::jsonb,
  'adopting report intake clears provider identity from the manual vehicle selection'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set
      vehicle_make = null,
      vehicle_configuration = '{
        "source": "marketcheck",
        "field": "trim",
        "values": ["Performance"]
      }'::jsonb
    where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '23514',
  null,
  'total-loss provider identity cannot exist behind incomplete vehicle fields'
);

select throws_ok(
  $$
    update public.diminished_value_case_details
    set
      vehicle_make = null,
      vehicle_configuration = '{
        "source": "marketcheck",
        "field": "version",
        "values": ["xDrive40i", "XDrive 40i"]
      }'::jsonb
    where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  $$,
  '23514',
  null,
  'diminished-value provider identity cannot exist behind incomplete vehicle fields'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set vehicle_configuration = '{
      "source": "marketcheck",
      "field": "trim",
      "values": ["Long Range,Long Range Battery"]
    }'::jsonb
    where case_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '23514',
  null,
  'the total-loss table rejects an unsafe provider identity'
);

select throws_ok(
  $$
    update public.diminished_value_case_details
    set vehicle_configuration = '{
      "source": "marketcheck",
      "field": "version",
      "values": ["xDrive40i"],
      "extra": true
    }'::jsonb
    where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  $$,
  '23514',
  null,
  'the diminished-value table rejects an inexact provider identity shape'
);

create temporary table pg_temp.diminished_value_fence as
select revision, updated_at
from public.diminished_value_case_details
where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

update public.diminished_value_case_details
set vehicle_configuration = vehicle_configuration
where case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select ok(
  (
    select details.revision = fence.revision
      and details.updated_at = fence.updated_at
    from public.diminished_value_case_details as details
    cross join pg_temp.diminished_value_fence as fence
    where details.case_id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  'an unchanged diminished-value configuration remains revision-neutral'
);

select * from finish();
rollback;
