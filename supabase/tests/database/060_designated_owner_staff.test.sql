begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

select has_function('public', 'bootstrap_designated_owner_staff', array[]::text[],
  'the designated-owner bootstrap function exists');
select ok(not exists (
  select 1 from pg_proc procedure,
    lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) permission
  where procedure.oid = 'public.bootstrap_designated_owner_staff()'::regprocedure
    and permission.grantee = 0 and permission.privilege_type = 'EXECUTE'
), 'PUBLIC cannot execute the bootstrap function');
select ok(not has_function_privilege('anon', 'public.bootstrap_designated_owner_staff()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.bootstrap_designated_owner_staff()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.bootstrap_designated_owner_staff()', 'EXECUTE'),
  'application roles cannot directly execute the bootstrap function');

insert into auth.users (id, email, email_confirmed_at, is_anonymous, raw_user_meta_data, raw_app_meta_data)
values ('60100000-0000-4000-8000-000000000001', 'owner-spoof@example.test', statement_timestamp(), false,
  '{"email":"zafar@venfour.com","staff":true,"role":"admin"}',
  '{"email":"zafar@venfour.com","staff":true,"role":"admin"}');
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000001'),
  0::bigint, 'metadata containing the designated address does not grant membership');

set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000001","role":"authenticated","email":"zafar@venfour.com","email_verified":true,"is_anonymous":false,"app_metadata":{"staff":true,"role":"admin"}}';
select is(public.is_venfour_staff(), false, 'a forged owner email in JWT claims does not grant staff access');
select throws_ok($$select public.staff_admin_overview()$$, '42501', 'Staff access required.',
  'a forged owner identity cannot read the admin overview');
select throws_ok($$insert into public.staff_members(user_id) values ('60100000-0000-4000-8000-000000000001')$$,
  '42501', 'permission denied for table staff_members', 'an authenticated customer cannot self-grant membership');
reset role;

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000002', 'ZAFAR@VENFOUR.COM', statement_timestamp(), false);
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000002'),
  1::bigint, 'verified owner creation grants membership with case-insensitive email matching');
create temporary table designated_owner_grant_snapshot as
  select granted_at from public.staff_members where user_id = '60100000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000002","role":"authenticated","email":"ZAFAR@VENFOUR.COM","is_anonymous":false}';
select is(public.is_venfour_staff(), true, 'the verified owner passes the existing staff RPC');
select lives_ok($$select public.staff_admin_overview()$$, 'the verified owner can read the real admin overview');
reset role;

update auth.users set email = 'zafar@venfour.com', email_confirmed_at = statement_timestamp(),
  is_anonymous = false, deleted_at = null, last_sign_in_at = statement_timestamp()
where id = '60100000-0000-4000-8000-000000000002';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000002'),
  1::bigint, 'repeated qualifying updates do not duplicate membership');
select is((select granted_at from public.staff_members where user_id = '60100000-0000-4000-8000-000000000002'),
  (select granted_at from designated_owner_grant_snapshot), 'repeated qualifying updates preserve the original grant timestamp');
update auth.users set email = 'created-owner@example.test' where id = '60100000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.is_venfour_staff(), true, 'existing staff membership remains bound to the user ID after email changes');
reset role;

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000003', 'zafar@venfour.com', null, false);
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000003'),
  0::bigint, 'an unconfirmed designated address receives no membership');
set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000003';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000003","role":"authenticated","email":"zafar@venfour.com","email_verified":true,"is_anonymous":false}';
select is(public.is_venfour_staff(), false, 'a verified-email JWT claim cannot replace database email confirmation');
reset role;
update auth.users set email_confirmed_at = statement_timestamp() where id = '60100000-0000-4000-8000-000000000003';
set local role authenticated;
select is(public.is_venfour_staff(), true, 'confirming the designated address activates existing staff authorization');
reset role;
update auth.users set email = 'confirmed-owner@example.test' where id = '60100000-0000-4000-8000-000000000003';

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000004', 'zafar@venfour.com', statement_timestamp(), true);
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000004'),
  0::bigint, 'an anonymous account receives no membership even with the confirmed address');
update auth.users set is_anonymous = false where id = '60100000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000004';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000004","role":"authenticated","email":"zafar@venfour.com","is_anonymous":false}';
select is(public.is_venfour_staff(), true, 'upgrading the verified owner from anonymous to permanent grants access');
reset role;
update auth.users set email = 'upgraded-owner@example.test' where id = '60100000-0000-4000-8000-000000000004';

insert into auth.users (id, email, email_confirmed_at, is_anonymous, deleted_at)
values ('60100000-0000-4000-8000-000000000005', 'zafar@venfour.com', statement_timestamp(), false, statement_timestamp());
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000005'),
  0::bigint, 'a soft-deleted owner receives no membership');
update auth.users set email_confirmed_at = statement_timestamp() where id = '60100000-0000-4000-8000-000000000005';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000005'),
  0::bigint, 'confirmation updates cannot grant access while the owner remains soft-deleted');
update auth.users set deleted_at = null where id = '60100000-0000-4000-8000-000000000005';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000005'),
  1::bigint, 'restoring a verified permanent owner grants membership');
update auth.users set email = 'restored-owner@example.test' where id = '60100000-0000-4000-8000-000000000005';

select throws_ok($$insert into auth.users (id, email, email_confirmed_at, is_anonymous)
  values ('60100000-0000-4000-8000-000000000006', 'zafar@venfour.com', statement_timestamp(), null)$$,
  '23502', null, 'the auth schema rejects an unknown anonymous flag');
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000006'),
  0::bigint, 'a rejected unknown identity cannot leave a staff grant');

insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
  ('60100000-0000-4000-8000-000000000007', 'zafar+admin@venfour.com', statement_timestamp(), false),
  ('60100000-0000-4000-8000-000000000008', 'zafar@venfour.com.example.test', statement_timestamp(), false),
  ('60100000-0000-4000-8000-000000000009', 'zafar@sub.venfour.com', statement_timestamp(), false),
  ('60100000-0000-4000-8000-000000000010', 'zafar2@venfour.com', statement_timestamp(), false),
  ('60100000-0000-4000-8000-000000000011', ' zafar@venfour.com ', statement_timestamp(), false);
select is((select count(*) from public.staff_members where user_id in (
  '60100000-0000-4000-8000-000000000007', '60100000-0000-4000-8000-000000000008',
  '60100000-0000-4000-8000-000000000009', '60100000-0000-4000-8000-000000000010',
  '60100000-0000-4000-8000-000000000011')),
  0::bigint, 'plus aliases, lookalike domains, other mailboxes and surrounding spaces never qualify');

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000012', 'manual-staff@example.test', statement_timestamp(), false);
insert into public.staff_members (user_id, granted_at)
values ('60100000-0000-4000-8000-000000000012', '2020-01-01 00:00:00+00');
update auth.users set email = 'zafar@venfour.com' where id = '60100000-0000-4000-8000-000000000012';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000012'),
  1::bigint, 'a preexisting manual grant survives owner qualification without duplication');
select is((select granted_at from public.staff_members where user_id = '60100000-0000-4000-8000-000000000012'),
  '2020-01-01 00:00:00+00'::timestamptz, 'owner qualification preserves an existing manual grant timestamp');

set local role service_role;
select lives_ok($$delete from public.staff_members where user_id = '60100000-0000-4000-8000-000000000012'$$,
  'trusted administrative access can explicitly revoke the designated owner');
reset role;
update auth.users set last_sign_in_at = statement_timestamp(), updated_at = statement_timestamp()
where id = '60100000-0000-4000-8000-000000000012';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000012'),
  0::bigint, 'ordinary sign-in updates cannot undo trusted revocation');
update auth.users set email = email, email_confirmed_at = statement_timestamp(), is_anonymous = false,
  deleted_at = null, banned_until = null, raw_user_meta_data = '{"staff":true}'
where id = '60100000-0000-4000-8000-000000000012';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000012'),
  0::bigint, 'unchanged qualifying identity updates cannot undo trusted revocation');
set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000012';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000012","role":"authenticated","email":"zafar@venfour.com","is_anonymous":false}';
select is(public.is_venfour_staff(), false, 'the revoked owner fails the existing staff RPC');
select throws_ok($$select public.staff_admin_overview()$$, '42501', 'Staff access required.',
  'the revoked owner cannot read the admin overview');
reset role;
update auth.users set email = 'revoked-owner@example.test' where id = '60100000-0000-4000-8000-000000000012';

insert into auth.users (id, email, email_confirmed_at, is_anonymous, banned_until)
values ('60100000-0000-4000-8000-000000000013', 'zafar@venfour.com', statement_timestamp(), false,
  statement_timestamp() + interval '1 day');
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000013'),
  0::bigint, 'an actively banned verified owner receives no membership');
update auth.users set email_confirmed_at = statement_timestamp() where id = '60100000-0000-4000-8000-000000000013';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000013'),
  0::bigint, 'confirmation updates cannot grant membership during an active ban');
update auth.users set banned_until = null where id = '60100000-0000-4000-8000-000000000013';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000013'),
  1::bigint, 'explicitly clearing an active ban grants the otherwise qualified owner');
update auth.users set email = 'unbanned-owner@example.test' where id = '60100000-0000-4000-8000-000000000013';

insert into auth.users (id, email, email_confirmed_at, is_anonymous, banned_until)
values ('60100000-0000-4000-8000-000000000014', 'zafar@venfour.com', statement_timestamp(), false,
  '2000-01-01 00:00:00+00');
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000014'),
  1::bigint, 'an expired ban does not prevent verified owner creation from qualifying');
update auth.users set email = 'expired-ban-owner@example.test' where id = '60100000-0000-4000-8000-000000000014';

insert into auth.users (id, email, email_confirmed_at, is_anonymous, banned_until)
values ('60100000-0000-4000-8000-000000000015', 'zafar@venfour.com', statement_timestamp(), false,
  statement_timestamp() + interval '20 milliseconds');
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000015'),
  0::bigint, 'a briefly active ban prevents membership at creation');
select pg_sleep(0.03);
select ok((select banned_until <= statement_timestamp() from auth.users where id = '60100000-0000-4000-8000-000000000015'),
  'the short-lived ban has expired before the sign-in update');
update auth.users set last_sign_in_at = statement_timestamp(), updated_at = statement_timestamp()
where id = '60100000-0000-4000-8000-000000000015';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000015'),
  0::bigint, 'a routine sign-in after ban expiry does not silently grant membership');
update auth.users set email = 'routine-sign-in-owner@example.test' where id = '60100000-0000-4000-8000-000000000015';

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000016', 'zafar@venfour.com', statement_timestamp(), false);
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000016'),
  1::bigint, 'a verified owner account is granted before account deletion');
delete from auth.users where id = '60100000-0000-4000-8000-000000000016';
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000016'),
  0::bigint, 'deleting the owner account removes its UUID-bound grant');
insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('60100000-0000-4000-8000-000000000017', 'zafar@venfour.com', statement_timestamp(), false);
select is((select count(*) from public.staff_members where user_id = '60100000-0000-4000-8000-000000000017'),
  1::bigint, 'recreating the verified designated account grants its new user ID');
set local role authenticated;
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000016';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000016","role":"authenticated","email":"zafar@venfour.com","is_anonymous":false}';
select is(public.is_venfour_staff(), false, 'a retained JWT subject for the deleted owner cannot inherit the new grant');
set local request.jwt.claim.sub = '60100000-0000-4000-8000-000000000017';
set local request.jwt.claims = '{"sub":"60100000-0000-4000-8000-000000000017","role":"authenticated","email":"zafar@venfour.com","is_anonymous":false}';
select is(public.is_venfour_staff(), true, 'the recreated verified owner passes the staff RPC');
select lives_ok($$select public.staff_admin_overview()$$, 'the recreated owner can read the admin overview');
reset role;

select is((select granted_at from public.staff_members where user_id = '60100000-0000-4000-8000-000000000002'),
  (select granted_at from designated_owner_grant_snapshot), 'unrelated identity changes preserve earlier UUID-bound grants');
select ok(not has_table_privilege('authenticated', 'public.staff_members', 'INSERT')
  and not has_table_privilege('anon', 'public.staff_members', 'INSERT'),
  'bootstrap behavior does not expand direct customer membership privileges');

select * from finish();
rollback;
