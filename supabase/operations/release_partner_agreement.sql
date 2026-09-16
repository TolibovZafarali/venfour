-- Run with psql -v manager_user_id=<verified owner UUID>.
-- Owner-authorized release of the unchanged September 16 agreement and policy.
begin;
select set_config('request.jwt.claim.sub', :'manager_user_id', true);
do $$
declare
 actor uuid := current_setting('request.jwt.claim.sub')::uuid;
 proposal public.referral_partner_templates%rowtype;
 released public.referral_partner_templates%rowtype;
begin
 if not exists(select 1 from auth.users u join public.staff_members s on s.user_id=u.id
   join public.referral_partner_managers m on m.user_id=u.id
   where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,true)
   and u.deleted_at is null) then
  raise exception 'A verified staff partner manager must authorize publication.';
 end if;
 select * into strict proposal from public.referral_partner_templates
  where id='a7160001-7000-4000-8000-000000000001' for update;
 if proposal.status<>'draft' or not proposal.release_hold or proposal.revision<>1
   or md5(jsonb_build_object('title',proposal.title,'sections',proposal.sections,
     'commission_policy',proposal.commission_policy)::text)<>'2dc14df5dd7ce45522b20d375b2aecc2' then
  raise exception 'The reviewed agreement has changed; release stopped.';
 end if;
 select * into released from public.referral_partner_templates
  where id='a7160001-7000-4000-8000-000000000002' for update;
 if found then
  if released.title<>proposal.title or released.sections<>proposal.sections
    or released.commission_policy is distinct from proposal.commission_policy
    or released.release_hold or released.created_by_user_id<>actor
    or released.status<>'published' then
   raise exception 'Existing release does not match the authorized agreement.';
  end if;
  perform set_config('venfour.partner_release_required','false',true);
 else
  insert into public.referral_partner_templates(id,title,sections,commission_policy,created_by_user_id)
   values('a7160001-7000-4000-8000-000000000002',proposal.title,proposal.sections,proposal.commission_policy,actor);
  perform set_config('venfour.partner_release_required','true',true);
 end if;
end;
$$;
set local role authenticated;
select public.referral_partner_operation('template_publish',jsonb_build_object(
 'template_id','a7160001-7000-4000-8000-000000000002',
 'request_id','a7160010-7000-4000-8000-000000000002','expected_revision',1))#>>'{template,status}' as release_status
 where current_setting('venfour.partner_release_required')='true';
reset role;
commit;
