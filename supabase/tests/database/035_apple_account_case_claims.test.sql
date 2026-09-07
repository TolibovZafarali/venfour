begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

insert into auth.users (id, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data)
values
  ('35000000-0000-4000-8000-000000000001', null, null, true, '{"provider":"anonymous"}', '{}'),
  ('35000000-0000-4000-8000-000000000002', null, null, true, '{"provider":"anonymous"}', '{}'),
  ('35000000-0000-4000-8000-000000000003', 'apple-owner@example.test', statement_timestamp(), false, '{"provider":"email","providers":["email","apple"]}', '{"sub":"apple-owner-subject","email_verified":true}'),
  ('35000000-0000-4000-8000-000000000004', 'apple-owner@privaterelay.appleid.com', statement_timestamp(), false, '{"provider":"apple","providers":["apple"]}', '{"sub":"apple-relay-subject","email_verified":true,"custom_claims":{"is_private_email":true}}');

select is((select count(*) from public.profiles where id in (
  '35000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000004'
)), 2::bigint, 'Apple and linked-provider users each receive one UUID-keyed profile');
select is((select count(*) from public.profiles where id in (
  '35000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000004'
) and display_name is null), 2::bigint, 'profile creation does not require Apple name metadata');

insert into public.appraisal_cases (id, user_id, service_type) values
  ('35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001', 'total_loss'),
  ('35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000002', 'total_loss');
insert into public.total_loss_case_details (case_id, intake_mode) values
  ('35000000-0000-4000-8000-000000000011', 'manual'),
  ('35000000-0000-4000-8000-000000000012', 'manual');
create temporary table apple_claims (case_id uuid, claim_id uuid);
grant all on apple_claims to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000001';
insert into apple_claims
select case_id, claim_id from public.save_total_loss_contact_details_and_begin_claim(
  '35000000-0000-4000-8000-000000000011', 'Customer', 'Entered', 'apple-owner@example.test', null, '2026-08-23', '2026-08-23', false
);
set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000002';
insert into apple_claims
select case_id, claim_id from public.save_total_loss_contact_details_and_begin_claim(
  '35000000-0000-4000-8000-000000000012', 'Relay', 'Customer', 'apple-owner@privaterelay.appleid.com', null, '2026-08-23', '2026-08-23', false
);

set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000004';
select throws_ok($$select * from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000011')
)$$, '42501', 'The Total-Loss case claim is unavailable.', 'a relay email cannot claim a case bound to a different contact email');

set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000001';
select is((select count(*) from public.appraisal_cases where id = '35000000-0000-4000-8000-000000000011'), 1::bigint, 'failed Apple claiming leaves the guest owner access intact');

set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000003';
select results_eq($$select outcome, owner_user_id, ownership_transferred from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000011')
)$$, $$values ('claimed'::text, '35000000-0000-4000-8000-000000000003'::uuid, true)$$, 'an existing email-and-Apple account receives its email-matched guest case');
select is((select count(*) from public.appraisal_cases where id = '35000000-0000-4000-8000-000000000011'), 1::bigint, 'the matched Apple account can read its transferred case through RLS');
select is((select count(*) from public.total_loss_case_details where case_id = '35000000-0000-4000-8000-000000000011'), 1::bigint, 'transferred case details remain accessible to the Apple account');
select results_eq($$select outcome, ownership_transferred from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000011')
)$$, $$values ('already_claimed'::text, false)$$, 'returning Apple claim replay is idempotent');
select throws_ok($$select * from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000012')
)$$, '42501', 'The Total-Loss case claim is unavailable.', 'the real-email account cannot claim another relay-bound case');

set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000004';
select results_eq($$select outcome, contact_email, ownership_transferred from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000012')
)$$, $$values ('claimed'::text, 'apple-owner@privaterelay.appleid.com'::text, true)$$, 'Hide My Email can claim a guest case bound to the same verified relay email');
select is((select count(*) from public.appraisal_cases where id = '35000000-0000-4000-8000-000000000012'), 1::bigint, 'the relay account can read its transferred case through RLS');
select results_eq($$select outcome, ownership_transferred from public.complete_total_loss_case_claim_with_context(
  (select claim_id from apple_claims where case_id = '35000000-0000-4000-8000-000000000012')
)$$, $$values ('already_claimed'::text, false)$$, 'relay account claim replay is idempotent');

set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000001';
select is((select count(*) from public.appraisal_cases where id = '35000000-0000-4000-8000-000000000011'), 0::bigint, 'the former guest loses case access after transfer');
set local request.jwt.claim.sub = '35000000-0000-4000-8000-000000000002';
select is((select count(*) from public.appraisal_cases where id = '35000000-0000-4000-8000-000000000012'), 0::bigint, 'the former relay-case guest loses access after transfer');

reset role;
select is((select display_name from public.profiles where id = '35000000-0000-4000-8000-000000000003'), 'Customer Entered', 'claiming uses the separately collected customer name');
select is((select display_name from public.profiles where id = '35000000-0000-4000-8000-000000000004'), 'Relay Customer', 'relay identity metadata does not replace the intake name');
select is((select count(*) from public.profiles where id in (
  '35000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000004'
)), 2::bigint, 'claiming and replay preserve one profile per account');

select * from finish();
rollback;
