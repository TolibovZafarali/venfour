begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('a7160002-7000-4000-8000-000000000001','proposal-manager@example.test',statement_timestamp(),false),
 ('a7160003-7000-4000-8000-000000000001','proposal-other@example.test',statement_timestamp(),false);
insert into public.staff_members(user_id) values ('a7160002-7000-4000-8000-000000000001');
insert into public.referral_partner_managers(user_id) values ('a7160002-7000-4000-8000-000000000001');
select is((select status from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001'),'draft','proposal is draft');
select ok((select release_hold and version is null and published_at is null from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001'),'proposal has no published version');
select is((select jsonb_array_length(sections) from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001'),16,'complete agreement retained');
select ok(not exists(select 1 from referral_partner_agreements where template_id='a7160001-7000-4000-8000-000000000001'),'no agreement or signature prepared from draft');
select throws_ok($$update referral_partner_templates set release_hold=false where id='a7160001-7000-4000-8000-000000000001'$$,'55000',null,'hold cannot be cleared through a row update');
select throws_ok($$update referral_partner_templates set commission_policy=null where id='a7160001-7000-4000-8000-000000000001'$$,'55000',null,'policy cannot be stripped to publish as legacy');
select throws_ok($$delete from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001'$$,'55000',null,'held proposal is retained');
set local role authenticated;
select set_config('request.jwt.claim.sub','a7160003-7000-4000-8000-000000000001',true);
select throws_ok($$select public.referral_partner_operation('template_list')$$,'42501',null,'nonmanager cannot read drafts');
select throws_ok($$select * from public.referral_partner_templates$$,'42501',null,'direct template access denied');
select set_config('request.jwt.claim.sub','a7160002-7000-4000-8000-000000000001',true);
select ok(exists(select 1 from jsonb_array_elements(public.referral_partner_operation('template_list')->'items') t where t->>'id'='a7160001-7000-4000-8000-000000000001' and t->>'release_hold'='true'),'manager sees release hold through existing API');
select throws_ok($$select public.referral_partner_operation('template_publish','{"template_id":"a7160001-7000-4000-8000-000000000001","request_id":"a7160004-7000-4000-8000-000000000001","expected_revision":1}')$$,'55000',null,'publish API fails closed');
select lives_ok($$select public.referral_partner_operation('template_save',jsonb_build_object('template_id','a7160001-7000-4000-8000-000000000001','request_id','a7160005-7000-4000-8000-000000000001','expected_revision',1,'title','Reviewed draft title','sections',jsonb_build_array(jsonb_build_object('heading','Draft section','body','Reviewed wording'))))$$,'manager can edit the held draft');
reset role;
select ok((select release_hold and status='draft' and revision=2 from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001'),'editing preserves hold and draft status');
insert into public.referral_partners(id,business_name,contact_email,commission_amount_minor_units,created_by_user_id)
 values('a7160006-7000-4000-8000-000000000001','Example','proposal-other@example.test',5000,'a7160002-7000-4000-8000-000000000001');
select throws_ok($$insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,storage_object_path)
 values('a7160007-7000-4000-8000-000000000001','a7160006-7000-4000-8000-000000000001','a7160001-7000-4000-8000-000000000001','{}',repeat('a',64),'partners/a7160006-7000-4000-8000-000000000001/agreements/a7160007-7000-4000-8000-000000000001/signed.pdf')$$,'55000',null,'even privileged agreement preparation cannot bypass proposal hold');
-- A separately released policy is frozen by the insertion boundary, not the browser.
insert into public.referral_partner_templates(id,title,sections,commission_policy,created_by_user_id)
select 'a7160008-7000-4000-8000-000000000001',title,sections,commission_policy,'a7160002-7000-4000-8000-000000000001'
 from referral_partner_templates where id='a7160001-7000-4000-8000-000000000001';
insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,storage_object_path)
 values('a7160009-7000-4000-8000-000000000001','a7160006-7000-4000-8000-000000000001','a7160008-7000-4000-8000-000000000001','{"business_name":"Frozen example"}',repeat('a',64),'partners/a7160006-7000-4000-8000-000000000001/agreements/a7160009-7000-4000-8000-000000000001/signed.pdf');
select ok((select snapshot#>>'{commission_policy,id}'='verified-outcome-tiers-v1' and agreement_digest=public.total_loss_canonical_jsonb_digest(snapshot)
 from referral_partner_agreements where id='a7160009-7000-4000-8000-000000000001'),'structured policy is inside the immutable signed digest');
select * from finish();
rollback;
