begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(78);

select ok(
  to_regclass('public.total_loss_case_contacts') is not null
    and to_regclass('public.total_loss_case_identity_claims') is not null
    and to_regclass('public.total_loss_report_extractions') is not null,
  'guest contact, opaque claim, and private extraction tables exist'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.total_loss_case_contacts'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.total_loss_case_identity_claims'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.total_loss_report_extractions'::regclass),
  'every guest identity and extraction table has RLS enabled'
);

select ok(
  to_regprocedure(
    'public.save_total_loss_contact_and_begin_claim(uuid,text,text,text,text,boolean)'
  ) is not null
    and to_regprocedure(
      'public.save_total_loss_contact_details_and_begin_claim(uuid,text,text,text,text,text,text,boolean)'
    ) is not null
    and to_regprocedure('public.complete_total_loss_case_claim(uuid)') is not null
    and to_regprocedure(
      'public.confirm_total_loss_intake(uuid,timestamp with time zone)'
    ) is not null
    and to_regprocedure(
      'public.get_owned_total_loss_report_storage_locator(uuid)'
    ) is not null,
  'guest contact, claim, confirmation, and storage-locator RPCs have stable signatures'
);

select ok(
  to_regprocedure(
    'public.persist_total_loss_report_extraction(uuid,uuid,bigint,text,text,numeric,text,jsonb)'
  ) is not null
    and to_regprocedure(
      'public.get_total_loss_report_extraction(uuid,uuid,bigint)'
    ) is not null,
  'trusted extraction persistence and retrieval RPCs have stable signatures'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.save_total_loss_contact_and_begin_claim(uuid,text,text,text,text,boolean)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.complete_total_loss_case_claim(uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.save_total_loss_contact_details_and_begin_claim(uuid,text,text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.confirm_total_loss_intake(uuid,timestamptz)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.save_total_loss_contact_and_begin_claim(uuid,text,text,text,text,boolean)',
      'EXECUTE'
    ),
  'only authenticated identities receive the customer guest-lifecycle RPCs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.persist_total_loss_report_extraction(uuid,uuid,bigint,text,text,numeric,text,jsonb)',
    'EXECUTE'
  )
    and has_function_privilege(
      'service_role',
      'public.get_total_loss_report_extraction(uuid,uuid,bigint)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.get_total_loss_report_extraction(uuid,uuid,bigint)',
      'EXECUTE'
    ),
  'only service_role receives the extraction cache RPC surface'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.total_loss_case_identity_claims',
    'SELECT'
  )
    and not has_table_privilege(
      'service_role',
      'public.total_loss_case_identity_claims',
      'SELECT'
    )
    and not has_table_privilege(
      'service_role',
      'public.total_loss_report_extractions',
      'SELECT'
    ),
  'opaque capabilities and extraction payloads have no direct table surface'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.total_loss_case_details',
    'intake_completed_at',
    'INSERT'
  )
    and not has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'intake_completed_at',
      'UPDATE'
    ),
  'browser clients cannot author the intake completion timestamp'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.total_loss_case_details',
    'report_storage_owner_id',
    'INSERT'
  )
    and not has_column_privilege(
      'authenticated',
      'public.total_loss_case_details',
      'report_storage_owner_id',
      'UPDATE'
    ),
  'browser clients can supply the trigger-validated storage owner only during insert'
);

insert into auth.users (
  id,
  email,
  email_confirmed_at,
  is_anonymous
)
values
  ('91111111-1111-4111-8111-111111111111', null, null, true),
  ('92222222-2222-4222-8222-222222222222', null, null, true),
  ('93333333-3333-4333-8333-333333333333', 'claim-owner@example.test', statement_timestamp(), false),
  ('94444444-4444-4444-8444-444444444444', 'wrong-owner@example.test', statement_timestamp(), false),
  ('95555555-5555-4555-8555-555555555555', 'staff@example.test', statement_timestamp(), false);

insert into public.staff_members (user_id)
values ('95555555-5555-4555-8555-555555555555');

set local role anon;

select throws_ok(
  $$select public.get_or_create_total_loss_draft()$$,
  '42501',
  null,
  'unauthenticated anon cannot resolve or create a Total-Loss draft'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '91111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.get_or_create_total_loss_draft()$$,
  'an authenticated Supabase anonymous identity can resolve a secure Total-Loss draft'
);

select is(
  (
    select count(*)
    from public.appraisal_cases
    where user_id = '91111111-1111-4111-8111-111111111111'
      and service_type = 'total_loss'
      and status = 'draft'
  ),
  1::bigint,
  'the anonymous resolver creates exactly one owned draft'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (user_id, service_type)
    values (
      '91111111-1111-4111-8111-111111111111',
      'total_loss'
    )
  $$,
  '42501',
  null,
  'an anonymous identity cannot bypass the locked Total-Loss draft resolver with direct inserts'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (user_id, service_type)
    values (
      '91111111-1111-4111-8111-111111111111',
      'diminished_value'
    )
  $$,
  '42501',
  null,
  'an anonymous Auth identity cannot enter the flagged Diminished Value workflow'
);

reset role;

create temporary table guest_first_state as
select
  appraisal_case.id as case_id,
  null::uuid as claim_id,
  null::bigint as initial_revision,
  null::uuid as initial_input_id,
  null::uuid as job_id,
  null::bigint as staff_total_loss_count
from public.appraisal_cases as appraisal_case
where appraisal_case.user_id = '91111111-1111-4111-8111-111111111111'
  and appraisal_case.service_type = 'total_loss'
  and appraisal_case.status = 'draft';

grant select on guest_first_state to authenticated, service_role;

insert into public.appraisal_cases (id, user_id, service_type)
values (
  '9a222222-2222-4222-8222-222222222222',
  '92222222-2222-4222-8222-222222222222',
  'total_loss'
);

set local role authenticated;
set local request.jwt.claim.sub = '91111111-1111-4111-8111-111111111111';

select is(
  (
    select count(*)
    from public.appraisal_cases
    where id = '9a222222-2222-4222-8222-222222222222'
  ),
  0::bigint,
  'one guest cannot read another guest case'
);

select throws_ok(
  $$
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      report_storage_owner_id
    )
    select
      case_id,
      'manual',
      '92222222-2222-4222-8222-222222222222'
    from guest_first_state
  $$,
  '42501',
  'The report storage namespace is server-owned.',
  'the trigger rejects a browser-supplied storage owner outside the owned parent'
);

select lives_ok(
  $$
    insert into public.total_loss_case_details (
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
      report_storage_owner_id
    )
    select
      case_id,
      'manual',
      null,
      2021,
      'Honda',
      'Accord',
      'EX-L',
      42000,
      '60601',
      '2026-08-20',
      'Example Mutual',
      null,
      '91111111-1111-4111-8111-111111111111'
    from guest_first_state
  $$,
  'the guest can save a complete manual input without a report or insurer offer'
);

select throws_ok(
  $$
    update public.total_loss_case_details
    set intake_completed_at = statement_timestamp()
    where case_id = (select case_id from guest_first_state)
  $$,
  '42501',
  null,
  'the guest cannot forge intake completion with a client timestamp'
);

select results_eq(
  $$
    select
      email,
      email_verified_at is null,
      service_terms_version,
      privacy_notice_version,
      operational_follow_up_allowed,
      claim_id is not null,
      claim_expires_at > statement_timestamp()
    from public.save_total_loss_contact_and_begin_claim(
      (select case_id from guest_first_state),
      '  Guest   Customer  ',
      ' Claim-Owner@Example.Test ',
      '2026-08-23',
      '2026-08-23',
      false
    )
  $$,
  $$
    values (
      'claim-owner@example.test'::text,
      true,
      '2026-08-23'::text,
      '2026-08-23'::text,
      false,
      true,
      true
    )
  $$,
  'contact save normalizes input, database-stamps legal facts, preserves optional false, and leaves email unverified'
);

select results_eq(
  $$
    select
      first_name,
      last_name,
      full_name,
      email,
      phone_number,
      operational_follow_up_allowed,
      claim_id is not null
    from public.save_total_loss_contact_details_and_begin_claim(
      (select case_id from guest_first_state),
      ' Guest ',
      ' Customer ',
      ' Claim-Owner@Example.Test ',
      ' (312)  555-0182 ',
      '2026-08-23',
      '2026-08-23',
      false
    )
  $$,
  $$
    values (
      'Guest'::text,
      'Customer'::text,
      'Guest Customer'::text,
      'claim-owner@example.test'::text,
      '(312) 555-0182'::text,
      false,
      true
    )
  $$,
  'split contact save normalizes required names and optional phone without changing follow-up consent'
);

select results_eq(
  $$
    select
      first_name,
      last_name,
      full_name,
      email,
      phone_number,
      email_verified_at is null
    from public.total_loss_case_contacts
  $$,
  $$
    values (
      'Guest'::text,
      'Customer'::text,
      'Guest Customer'::text,
      'claim-owner@example.test'::text,
      '(312) 555-0182'::text,
      true
    )
  $$,
  'the guest can resume only their case-scoped contact projection'
);

reset role;

update guest_first_state as state
set
  claim_id = identity_claim.id,
  initial_revision = details.analysis_input_revision,
  initial_input_id = details.analysis_input_id
from public.total_loss_case_identity_claims as identity_claim
join public.total_loss_case_details as details
  on details.case_id = identity_claim.case_id
where identity_claim.case_id = state.case_id
  and identity_claim.claimed_at is null
  and identity_claim.revoked_at is null;

insert into storage.objects (bucket_id, name, user_metadata)
select
  'case-files',
  '91111111-1111-4111-8111-111111111111/' || state.case_id::text
    || '/valuation-report.pdf',
  '{"uploadId":"90000000-0000-4000-8000-000000000001"}'::jsonb
from guest_first_state as state;

set local role authenticated;
set local request.jwt.claim.sub = '92222222-2222-4222-8222-222222222222';

select is(
  (select count(*) from public.total_loss_case_contacts),
  0::bigint,
  'another anonymous identity cannot read guest contact PII'
);

set local request.jwt.claim.sub = '91111111-1111-4111-8111-111111111111';

update public.total_loss_case_details
set vehicle_trim = null
where case_id = (select case_id from guest_first_state);

select throws_ok(
  $$
    select public.confirm_total_loss_intake(
      (select case_id from guest_first_state),
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = (select case_id from guest_first_state)
      )
    )
  $$,
  '22023',
  'Complete every required vehicle and claim fact before confirmation.',
  'manual confirmation still rejects a missing required vehicle fact'
);

update public.total_loss_case_details
set vehicle_trim = 'EX-L'
where case_id = (select case_id from guest_first_state);

select throws_ok(
  $$
    select public.confirm_total_loss_intake(
      (select case_id from guest_first_state),
      '2000-01-01 00:00:00+00'
    )
  $$,
  '40001',
  'The Total-Loss details changed before confirmation.',
  'confirmation rejects a stale details version'
);

select results_eq(
  $$
    select
      intake_mode::text,
      intake_completed_at is not null,
      report_facts_confirmed_at is null,
      analysis_input_revision > (select initial_revision from guest_first_state),
      analysis_input_id <> (select initial_input_id from guest_first_state),
      insurer_vehicle_valuation is null
    from public.confirm_total_loss_intake(
      (select case_id from guest_first_state),
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = (select case_id from guest_first_state)
      )
    )
  $$,
  $$values ('manual'::text, true, true, true, true, true)$$,
  'manual confirmation validates required facts, keeps offer nullable, database-stamps completion, and rotates both input fences'
);

reset role;
set local role service_role;

select results_eq(
  $$
    select
      outcome::text,
      intake_mode::text,
      source_report_upload_id is null,
      storage_object_path is null,
      input_snapshot ->> 'vehicle_trim',
      input_snapshot ->> 'vehicle_options_packages',
      analysis_input_id is not null
    from public.claim_total_loss_analysis(
      (select case_id from guest_first_state),
      '91111111-1111-4111-8111-111111111111',
      '90000000-0000-4000-8000-000000000002'
    )
  $$,
  $$
    values (
      'claimed'::text,
      'manual'::text,
      true,
      true,
      'EX-L'::text,
      null::text,
      true
    )
  $$,
  'manual intake claims analysis with a bounded confirmed snapshot and no fake report locator'
);

select results_eq(
  $$
    select outcome::text, intake_mode::text, source_report_upload_id is null
    from public.get_total_loss_analysis_status(
      (select case_id from guest_first_state),
      '91111111-1111-4111-8111-111111111111'
    )
  $$,
  $$values ('processing'::text, 'manual'::text, true)$$,
  'manual analysis status is current-source aware'
);

reset role;

update guest_first_state as state
set job_id = analysis_job.id
from public.total_loss_analysis_jobs as analysis_job
where analysis_job.case_id = state.case_id;

select ok(
  (
    select source_intake_mode = 'manual'
      and source_report_upload_id is null
      and source_analysis_input_revision = details.analysis_input_revision
      and source_analysis_input_id = details.analysis_input_id
    from public.total_loss_analysis_jobs as analysis_job
    join public.total_loss_case_details as details
      on details.case_id = analysis_job.case_id
    where analysis_job.id = (select job_id from guest_first_state)
  ),
  'manual jobs persist both current server-owned input fences'
);

set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

select throws_ok(
  $$select public.complete_total_loss_case_claim((select claim_id from guest_first_state))$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'a verified but wrong email cannot take over the guest case'
);

reset role;
update auth.users
set email = 'claim-owner-hold@example.test'
where id = '93333333-3333-4333-8333-333333333333';
update auth.users
set
  email = 'claim-owner@example.test',
  email_confirmed_at = statement_timestamp()
where id = '92222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claim.sub = '92222222-2222-4222-8222-222222222222';

select throws_ok(
  $$select public.complete_total_loss_case_claim((select claim_id from guest_first_state))$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'an anonymous Auth identity cannot consume an exact-email case claim'
);

reset role;
update auth.users
set
  email = null,
  email_confirmed_at = null
where id = '92222222-2222-4222-8222-222222222222';
update auth.users
set email = 'claim-owner@example.test'
where id = '93333333-3333-4333-8333-333333333333';
update auth.users
set email_confirmed_at = null
where id = '93333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = '93333333-3333-4333-8333-333333333333';

select throws_ok(
  $$select public.complete_total_loss_case_claim((select claim_id from guest_first_state))$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'an exact but unverified destination email cannot claim the case'
);

reset role;
update auth.users
set email_confirmed_at = statement_timestamp()
where id = '93333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = '93333333-3333-4333-8333-333333333333';

select results_eq(
  $$
    select
      outcome,
      owner_user_id,
      contact_email,
      email_verified_at is not null,
      claimed_at is not null,
      ownership_transferred
    from public.complete_total_loss_case_claim(
      (select claim_id from guest_first_state)
    )
  $$,
  $$
    values (
      'claimed'::text,
      '93333333-3333-4333-8333-333333333333'::uuid,
      'claim-owner@example.test'::text,
      true,
      true,
      true
    )
  $$,
  'the existing-account collision path atomically transfers the guest case to the exact verified destination'
);

select results_eq(
  $$
    select outcome, ownership_transferred
    from public.complete_total_loss_case_claim(
      (select claim_id from guest_first_state)
    )
  $$,
  $$values ('already_claimed'::text, false)$$,
  'an exact destination replay is idempotent'
);

select throws_ok(
  $$
    select public.save_total_loss_contact_and_begin_claim(
      (select case_id from guest_first_state),
      'Changed Name',
      'claim-owner@example.test',
      '2026-08-23',
      '2026-08-23',
      true
    )
  $$,
  '42501',
  'The Total-Loss draft is unavailable for contact confirmation.',
  'the destination cannot mutate contact and legal facts after analysis submission'
);

select lives_ok(
  $$
    update public.total_loss_case_details
    set vehicle_make = 'Forged after submission'
    where case_id = (select case_id from guest_first_state)
  $$,
  'an RLS-filtered submitted-input update reveals no row-existence error'
);

select is(
  (
    select vehicle_make
    from public.total_loss_case_details
    where case_id = (select case_id from guest_first_state)
  ),
  'Honda'::text,
  'submitted/processing Total-Loss inputs remain immutable to the current owner'
);

select is(
  (
    select count(*)
    from public.appraisal_cases
    where id = (select case_id from guest_first_state)
      and user_id = '93333333-3333-4333-8333-333333333333'
  ),
  1::bigint,
  'the permanent destination immediately owns the transferred case'
);

select results_eq(
  $$
    select email, email_verified_at is not null
    from public.total_loss_case_contacts
  $$,
  $$values ('claim-owner@example.test'::text, true)$$,
  'the transferred owner reads the now-verified case contact'
);

select is(
  (
    select count(*)
    from storage.objects
    where name = '91111111-1111-4111-8111-111111111111/'
      || (select case_id::text from guest_first_state)
      || '/valuation-report.pdf'
  ),
  1::bigint,
  'the destination reads the report object without moving the anonymous namespace'
);

select results_eq(
  $$
    select storage_owner_id, canonical_object_path
    from public.get_owned_total_loss_report_storage_locator(
      (select case_id from guest_first_state)
    )
  $$,
  $$
    select
      '91111111-1111-4111-8111-111111111111'::uuid,
      '91111111-1111-4111-8111-111111111111/'
        || case_id::text || '/valuation-report.pdf'
    from guest_first_state
  $$,
  'the bounded locator preserves the immutable anonymous storage owner after transfer'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

select throws_ok(
  $$select public.complete_total_loss_case_claim((select claim_id from guest_first_state))$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'a consumed claim cannot be replayed by another permanent account'
);

set local request.jwt.claim.sub = '91111111-1111-4111-8111-111111111111';

select is(
  (
    select count(*)
    from public.appraisal_cases
    where id = (select case_id from guest_first_state)
  ),
  0::bigint,
  'the source anonymous JWT immediately loses case access after transfer'
);

select is(
  (
    select count(*)
    from storage.objects
    where name = '91111111-1111-4111-8111-111111111111/'
      || (select case_id::text from guest_first_state)
      || '/valuation-report.pdf'
  ),
  0::bigint,
  'the source anonymous JWT immediately loses storage access after transfer'
);

select throws_ok(
  $$
    select public.save_total_loss_contact_and_begin_claim(
      (select case_id from guest_first_state),
      'Changed Name',
      'claim-owner@example.test',
      '2026-08-23',
      '2026-08-23',
      true
    )
  $$,
  '42501',
  'The Total-Loss draft is unavailable for contact confirmation.',
  'the former guest cannot mutate submitted/processing contact state'
);

reset role;

select is(
  (
    select count(*)
    from public.total_loss_analysis_jobs
    where id = (select job_id from guest_first_state)
      and case_id = (select case_id from guest_first_state)
  ),
  1::bigint,
  'ownership transfer preserves the in-flight analysis job by case ID'
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
  vehicle_condition,
  vehicle_options_packages
)
values (
  '9a222222-2222-4222-8222-222222222222',
  'manual',
  2020,
  'Toyota',
  'Camry',
  'SE',
  50000,
  '60602',
  '2026-08-19',
  'Guest Insurer',
  'Average condition',
  'No material options'
);

insert into public.total_loss_case_contacts (
  case_id,
  full_name,
  email,
  service_terms_version,
  service_terms_acknowledged_at,
  privacy_notice_version,
  privacy_notice_acknowledged_at,
  operational_follow_up_allowed,
  operational_follow_up_updated_at
)
values (
  '9a222222-2222-4222-8222-222222222222',
  'Unclaimed Guest',
  'unclaimed@example.test',
  '2026-08-23',
  statement_timestamp(),
  '2026-08-23',
  statement_timestamp(),
  false,
  statement_timestamp()
);

set local role authenticated;
set local request.jwt.claim.sub = '95555555-5555-4555-8555-555555555555';

select results_eq(
  $$
    select
      owner_is_anonymous,
      contact_full_name,
      contact_email,
      contact_email_verified,
      identity_claimed_at is null
    from public.staff_list_case_operations()
    where case_id = '9a222222-2222-4222-8222-222222222222'
  $$,
  $$
    values (
      true,
      'Unclaimed Guest'::text,
      'unclaimed@example.test'::text,
      false,
      true
    )
  $$,
  'staff projections distinguish an anonymous owner and unverified entered contact'
);

select results_eq(
  $$
    select
      owner_is_anonymous,
      contact_email_verified,
      identity_claimed_at is not null
    from public.staff_get_total_loss_case_operation(
      (select case_id from guest_first_state)
    )
  $$,
  $$values (false, true, true)$$,
  'staff projections distinguish the claimed permanent identity'
);

reset role;

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  expires_at
)
values (
  '9c222222-2222-4222-8222-222222222222',
  '9a222222-2222-4222-8222-222222222222',
  '92222222-2222-4222-8222-222222222222',
  'claim-owner@example.test',
  statement_timestamp() + interval '30 minutes'
);

update public.appraisal_cases
set user_id = '94444444-4444-4444-8444-444444444444'
where id = '9a222222-2222-4222-8222-222222222222';

set local role authenticated;
set local request.jwt.claim.sub = '93333333-3333-4333-8333-333333333333';

select throws_ok(
  $$select public.complete_total_loss_case_claim('9c222222-2222-4222-8222-222222222222')$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'claim completion locks and rejects a case whose source owner changed'
);

reset role;

insert into public.appraisal_cases (id, user_id, service_type)
values (
  '9a222222-2222-4222-8222-222222222223',
  '92222222-2222-4222-8222-222222222222',
  'total_loss'
);

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  created_at,
  expires_at
)
values (
  '9c222222-2222-4222-8222-222222222223',
  '9a222222-2222-4222-8222-222222222223',
  '92222222-2222-4222-8222-222222222222',
  'claim-owner@example.test',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour'
);

set local role authenticated;
set local request.jwt.claim.sub = '93333333-3333-4333-8333-333333333333';

select throws_ok(
  $$select public.complete_total_loss_case_claim('9c222222-2222-4222-8222-222222222223')$$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'expired opaque claims cannot transfer a case'
);

reset role;

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  postal_code,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id
)
values (
  '9a222222-2222-4222-8222-222222222223',
  'report',
  '60604',
  'unparsed-report.pdf',
  statement_timestamp(),
  '90000000-0000-4000-8000-000000000009'
);

insert into public.total_loss_case_contacts (
  case_id,
  full_name,
  email,
  service_terms_version,
  service_terms_acknowledged_at,
  privacy_notice_version,
  privacy_notice_acknowledged_at,
  operational_follow_up_allowed,
  operational_follow_up_updated_at
)
values (
  '9a222222-2222-4222-8222-222222222223',
  'Fallback Guest',
  'fallback@example.test',
  '2026-08-23',
  statement_timestamp(),
  '2026-08-23',
  statement_timestamp(),
  false,
  statement_timestamp()
);

insert into storage.objects (bucket_id, name, user_metadata)
values (
  'case-files',
  '92222222-2222-4222-8222-222222222222/9a222222-2222-4222-8222-222222222223/valuation-report.pdf',
  '{"uploadId":"90000000-0000-4000-8000-000000000009"}'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '92222222-2222-4222-8222-222222222222';

select results_eq(
  $$
    select
      intake_completed_at is not null,
      report_facts_confirmed_at is not null
    from public.confirm_total_loss_intake(
      '9a222222-2222-4222-8222-222222222223',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '9a222222-2222-4222-8222-222222222223'
      )
    )
  $$,
  $$values (true, false)$$,
  'an anonymous owner can confirm a finalized report and market ZIP without pre-reading report facts'
);

reset role;
set local role service_role;

select results_eq(
  $$
    select outcome::text, report_extraction_available
    from public.claim_total_loss_analysis(
      '9a222222-2222-4222-8222-222222222223',
      '92222222-2222-4222-8222-222222222222',
      '90000000-0000-4000-8000-000000000010'
    )
  $$,
  $$values ('claimed'::text, false)$$,
  'report analysis remains runnable from the finalized private report when extraction is deferred'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

select results_eq(
  $$
    select storage_owner_id, canonical_object_path
    from public.get_owned_total_loss_report_storage_locator(
      '9a222222-2222-4222-8222-222222222222'
    )
  $$,
  $$
    values (
      '92222222-2222-4222-8222-222222222222'::uuid,
      '92222222-2222-4222-8222-222222222222/9a222222-2222-4222-8222-222222222222/valuation-report.pdf'::text
    )
  $$,
  'a transferred draft owner receives the original guest report namespace'
);

select lives_ok(
  $$
    select *
    from public.acquire_total_loss_report_upload(
      '9a222222-2222-4222-8222-222222222222',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '9a222222-2222-4222-8222-222222222222'
      ),
      '90000000-0000-4000-8000-000000000007'
    )
  $$,
  'the transferred draft owner can acquire the existing fenced upload protocol'
);

select lives_ok(
  $$
    select *
    from public.mark_total_loss_report_upload_ready(
      '9a222222-2222-4222-8222-222222222222',
      '90000000-0000-4000-8000-000000000007',
      false
    )
  $$,
  'the transferred draft owner can advance the upload lease in the old namespace'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '92222222-2222-4222-8222-222222222222/9a222222-2222-4222-8222-222222222222/valuation-report.pdf',
      '{"uploadId":"90000000-0000-4000-8000-000000000007"}'::jsonb
    )
  $$,
  'Storage RLS lets only the current owner write the token-fenced canonical object at the immutable guest path'
);

select results_eq(
  $$
    select intake_mode::text, report_original_filename
    from public.finalize_total_loss_report_upload(
      '9a222222-2222-4222-8222-222222222222',
      '90000000-0000-4000-8000-000000000007',
      'transfer-report.pdf',
      statement_timestamp()
    )
  $$,
  $$values ('report'::text, 'transfer-report.pdf'::text)$$,
  'the transferred owner finalizes through the unchanged canonical/backup PDF protocol'
);

reset role;
set local role service_role;

select results_eq(
  $$
    select extraction_status, normalized_report is null
    from public.persist_total_loss_report_extraction(
      '9a222222-2222-4222-8222-222222222222',
      '90000000-0000-4000-8000-000000000007',
      (
        select analysis_input_revision
        from public.total_loss_case_details
        where case_id = '9a222222-2222-4222-8222-222222222222'
      ),
      null,
      'failed',
      null,
      '1',
      null
    )
  $$,
  $$values ('failed'::text, true)$$,
  'a generic extraction failure is persisted against the exact current report fence'
);

reset role;

create temporary table report_confirmation_state (
  label text primary key,
  case_id uuid not null,
  intake_completed boolean not null,
  report_facts_confirmed boolean not null,
  analysis_input_revision bigint not null
);

grant insert, select on table pg_temp.report_confirmation_state
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

insert into pg_temp.report_confirmation_state (
  label,
  case_id,
  intake_completed,
  report_facts_confirmed,
  analysis_input_revision
)
select
  'failed-extraction',
  confirmation.case_id,
  confirmation.intake_completed_at is not null,
  confirmation.report_facts_confirmed_at is not null,
  confirmation.analysis_input_revision
from public.confirm_total_loss_intake(
  '9a222222-2222-4222-8222-222222222222',
  (
    select updated_at
    from public.total_loss_case_details
    where case_id = '9a222222-2222-4222-8222-222222222222'
  )
) as confirmation;

reset role;

select results_eq(
  $$
    select
      confirmation.intake_completed,
      confirmation.report_facts_confirmed,
      details.report_extraction_status,
      details.report_extraction_input_revision =
        confirmation.analysis_input_revision
    from pg_temp.report_confirmation_state as confirmation
    join public.total_loss_case_details as details
      using (case_id)
    where confirmation.label = 'failed-extraction'
  $$,
  $$values (true, false, 'failed'::text, false)$$,
  'report intake completion does not customer-confirm or refence a failed extraction cache'
);

set local role service_role;

select results_eq(
  $$
    select
      outcome::text,
      report_extraction_available,
      input_snapshot ->> 'vehicle_trim',
      storage_object_path is not null
    from public.claim_total_loss_analysis(
      '9a222222-2222-4222-8222-222222222222',
      '94444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000008'
    )
  $$,
  $$values ('claimed'::text, false, 'SE'::text, true)$$,
  'report analysis preserves finalized report availability when an unconfirmed extraction failed'
);

reset role;

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status
)
values (
  '9a444444-4444-4444-8444-444444444444',
  '94444444-4444-4444-8444-444444444444',
  'total_loss',
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
  vehicle_condition,
  vehicle_options_packages,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id
)
values (
  '9a444444-4444-4444-8444-444444444444',
  'report',
  2022,
  'Ford',
  'Escape',
  'SEL',
  30000,
  '60603',
  '2026-08-18',
  'Report Insurer',
  'Good condition',
  'Technology package',
  'valuation.pdf',
  statement_timestamp(),
  '90000000-0000-4000-8000-000000000004'
);

insert into public.total_loss_case_contacts (
  case_id,
  full_name,
  email,
  service_terms_version,
  service_terms_acknowledged_at,
  privacy_notice_version,
  privacy_notice_acknowledged_at,
  operational_follow_up_allowed,
  operational_follow_up_updated_at
)
values (
  '9a444444-4444-4444-8444-444444444444',
  'Report Customer',
  'wrong-owner@example.test',
  '2026-08-23',
  statement_timestamp(),
  '2026-08-23',
  statement_timestamp(),
  false,
  statement_timestamp()
);

insert into storage.objects (bucket_id, name, user_metadata)
values (
  'case-files',
  '94444444-4444-4444-8444-444444444444/9a444444-4444-4444-8444-444444444444/valuation-report.pdf',
  '{"uploadId":"90000000-0000-4000-8000-000000000004"}'::jsonb
);

set local role service_role;

select results_eq(
  $$
    select
      case_id,
      extraction_status,
      provider_name,
      normalized_report ->> 'provider'
    from public.persist_total_loss_report_extraction(
      '9a444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000004',
      (
        select analysis_input_revision
        from public.total_loss_case_details
        where case_id = '9a444444-4444-4444-8444-444444444444'
      ),
      'Generic Valuation Provider',
      'needs_confirmation',
      0.9200,
      '1',
      '{"provider":"generic","comparables":[]}'::jsonb
    )
  $$,
  $$
    values (
      '9a444444-4444-4444-8444-444444444444'::uuid,
      'needs_confirmation'::text,
      'Generic Valuation Provider'::text,
      'generic'::text
    )
  $$,
  'service role persists a bounded provider-neutral extraction for the exact current report source'
);

select is(
  (
    select count(*)
    from public.get_total_loss_report_extraction(
      '9a444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000004',
      (
        select analysis_input_revision
        from public.total_loss_case_details
        where case_id = '9a444444-4444-4444-8444-444444444444'
      )
    )
  ),
  1::bigint,
  'service role retrieves extraction only through the current upload/revision fence'
);

select throws_ok(
  $$
    select public.persist_total_loss_report_extraction(
      '9a444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000004',
      999,
      'Stale Provider',
      'confirmed',
      1,
      '1',
      '{}'::jsonb
    )
  $$,
  '55000',
  'The report extraction source is no longer current.',
  'stale extraction persistence is rejected'
);

reset role;
update public.total_loss_report_extractions
set analysis_input_id = '90000000-0000-4000-8000-000000000099'
where case_id = '9a444444-4444-4444-8444-444444444444';

set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

select lives_ok(
  $$
    select * from public.confirm_total_loss_intake(
      '9a444444-4444-4444-8444-444444444444',
      (
        select updated_at
        from public.total_loss_case_details
        where case_id = '9a444444-4444-4444-8444-444444444444'
      )
    )
  $$,
  'report confirmation ignores a mismatched unconfirmed cache and defers to the finalized report'
);

reset role;
update public.total_loss_report_extractions as extraction
set
  analysis_input_revision = details.analysis_input_revision,
  analysis_input_id = details.analysis_input_id
from public.total_loss_case_details as details
where extraction.case_id = details.case_id
  and extraction.case_id = '9a444444-4444-4444-8444-444444444444';

set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

insert into pg_temp.report_confirmation_state (
  label,
  case_id,
  intake_completed,
  report_facts_confirmed,
  analysis_input_revision
)
select
  'confirmed-extraction',
  confirmation.case_id,
  confirmation.intake_completed_at is not null,
  confirmation.report_facts_confirmed_at is not null,
  confirmation.analysis_input_revision
from public.confirm_total_loss_intake(
  '9a444444-4444-4444-8444-444444444444',
  (
    select updated_at
    from public.total_loss_case_details
    where case_id = '9a444444-4444-4444-8444-444444444444'
  )
) as confirmation;

reset role;

select results_eq(
  $$
    select
      confirmation.intake_completed,
      confirmation.report_facts_confirmed,
      details.report_extraction_status,
      details.report_extraction_input_revision =
        confirmation.analysis_input_revision
    from pg_temp.report_confirmation_state as confirmation
    join public.total_loss_case_details as details
      using (case_id)
    where confirmation.label = 'confirmed-extraction'
  $$,
  $$values (true, false, 'needs_confirmation'::text, false)$$,
  'report confirmation leaves unreviewed extraction metadata unconfirmed and does not re-fence it as customer-approved'
);

set local role service_role;

select results_eq(
  $$
    select extraction_status, normalized_report ->> 'provider'
    from public.get_total_loss_report_extraction(
      '9a444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000004',
      (
        select analysis_input_revision
        from public.total_loss_case_details
        where case_id = '9a444444-4444-4444-8444-444444444444'
      )
    )
  $$,
  $$values ('needs_confirmation'::text, 'generic'::text)$$,
  'the unreviewed cache remains retrievable to trusted services but is not promoted for analysis reuse'
);

select results_eq(
  $$
    select
      outcome::text,
      intake_mode::text,
      storage_owner_id,
      storage_object_path,
      report_extraction_available
    from public.claim_total_loss_analysis(
      '9a444444-4444-4444-8444-444444444444',
      '94444444-4444-4444-8444-444444444444',
      '90000000-0000-4000-8000-000000000005'
    )
  $$,
  $$
    values (
      'claimed'::text,
      'report'::text,
      '94444444-4444-4444-8444-444444444444'::uuid,
      '94444444-4444-4444-8444-444444444444/9a444444-4444-4444-8444-444444444444/valuation-report.pdf'::text,
      false
    )
  $$,
  'report analysis retains the immutable locator while unreviewed extraction data remains unavailable'
);

select results_eq(
  $$
    select outcome::text, source_report_upload_id, storage_bucket
    from public.get_total_loss_analysis_status(
      '9a444444-4444-4444-8444-444444444444',
      '94444444-4444-4444-8444-444444444444'
    )
  $$,
  $$
    values (
      'processing'::text,
      '90000000-0000-4000-8000-000000000004'::uuid,
      'case-files'::text
    )
  $$,
  'report status remains fenced to the finalized upload and exposes only the bounded locator'
);

reset role;

update guest_first_state
set staff_total_loss_count = (
  select count(*)
  from public.appraisal_cases
  where service_type = 'total_loss'
);

set local role authenticated;
set local request.jwt.claim.sub = '94444444-4444-4444-8444-444444444444';

select lives_ok(
  $$
    insert into public.appraisal_cases (
      id,
      user_id,
      service_type
    )
    values (
      '9d444444-4444-4444-8444-444444444444',
      '94444444-4444-4444-8444-444444444444',
      'diminished_value'
    )
  $$,
  'a permanent authenticated customer retains the Diminished Value create contract'
);

select ok(
  public.authorize_diminished_value_document_mutation(
    '94444444-4444-4444-8444-444444444444/9d444444-4444-4444-8444-444444444444/diminished-value/90000000-0000-4000-8000-000000000006.pdf'
  ),
  'the exact Diminished Value draft document authorizer is unchanged'
);

set local request.jwt.claim.sub = '95555555-5555-4555-8555-555555555555';

select is(
  (select count(*) from public.staff_list_case_operations()),
  (select staff_total_loss_count from guest_first_state),
  'database-backed staff membership still authorizes the Total-Loss operations list'
);

reset role;
delete from public.staff_members
where user_id = '95555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '95555555-5555-4555-8555-555555555555';

select is(
  (select count(*) from public.staff_list_case_operations()),
  0::bigint,
  'same-token staff revocation remains immediate'
);

reset role;

select ok(
  (
    select id = '93333333-3333-4333-8333-333333333333'
      and display_name = 'Guest Customer'
      and full_name_confirmed_at is not null
    from public.profiles
    where id = '93333333-3333-4333-8333-333333333333'
  ),
  'claim completion safely fills an otherwise unconfirmed permanent profile'
);

select ok(
  (
    select report_storage_owner_id = '91111111-1111-4111-8111-111111111111'
    from public.total_loss_case_details
    where case_id = (select case_id from guest_first_state)
  ),
  'case ownership transfer cannot rewrite the authoritative report storage namespace'
);

select ok(
  (
    select status = 'checking'
    from public.appraisal_cases
    where id = (select case_id from guest_first_state)
  ),
  'identity claim preserves the in-flight case lifecycle state'
);

select ok(
  (
    select count(*) = 2
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid in (
      'public.save_total_loss_contact_and_begin_claim(uuid,text,text,text,text,boolean)'::regprocedure,
      'public.complete_total_loss_case_claim(uuid)'::regprocedure
    )
  ),
  'identity lifecycle RPCs are SECURITY DEFINER with an empty search path'
);

select ok(
  (
    select count(*) = 3
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid in (
      'public.confirm_total_loss_intake(uuid,timestamptz)'::regprocedure,
      'public.persist_total_loss_report_extraction(uuid,uuid,bigint,text,text,numeric,text,jsonb)'::regprocedure,
      'public.get_total_loss_report_extraction(uuid,uuid,bigint)'::regprocedure
    )
  ),
  'confirmation and extraction RPCs are SECURITY DEFINER with an empty search path'
);

select ok(
  (
    select count(*) = 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'total_loss_analysis_jobs'
      and indexname = 'total_loss_analysis_jobs_manual_source_key'
  ),
  'manual analysis has a dedicated current-revision idempotency key'
);

select ok(
  (
    select count(*) = 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'total_loss_analysis_jobs'
      and indexname = 'total_loss_analysis_jobs_case_source_key'
      and indexdef ilike '%source_analysis_input_revision%'
      and indexdef ilike '%where (source_intake_mode = ''report''%'
  ),
  'report analysis keys idempotency to the finalized upload and current input revision'
);

select * from finish();
rollback;
