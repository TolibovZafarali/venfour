-- Seed only after onboarding exists, before attribution's active-link backfill.
insert into public.staff_members(user_id) values('e9100000-0000-4000-8000-000000000004');
insert into public.referral_partner_managers(user_id) values('e9100000-0000-4000-8000-000000000004');
insert into public.referral_partner_templates(id,title,sections,status,version,created_by_user_id,published_by_user_id,published_at)
values('e9600000-0000-4000-8000-000000000001','Fictional rehearsal agreement','[{"heading":"Fixture","body":"Synthetic rehearsal only."}]',
 'published',1,'e9100000-0000-4000-8000-000000000004','e9100000-0000-4000-8000-000000000004',statement_timestamp());
insert into public.referral_partners(id,business_name,contact_email,user_id,commission_amount_minor_units,created_by_user_id)
values('e9600000-0000-4000-8000-000000000002','Fictional Rehearsal Partner','rehearsal-permanent@example.test',
 'e9100000-0000-4000-8000-000000000004',4500,'e9100000-0000-4000-8000-000000000004');
insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,status,partner_signature,manager_signature,storage_object_path)
values('e9600000-0000-4000-8000-000000000003','e9600000-0000-4000-8000-000000000002','e9600000-0000-4000-8000-000000000001',
 '{"commission_amount_minor_units":4500,"currency":"USD"}',repeat('e',64),'countersigned',
 '{"typed_legal_name":"Fictional Partner"}','{"typed_legal_name":"Fictional Manager"}',
 'partners/e9600000-0000-4000-8000-000000000002/agreements/e9600000-0000-4000-8000-000000000003/signed.pdf');
update public.referral_partners set current_agreement_id='e9600000-0000-4000-8000-000000000003',status='active',
 activated_at=statement_timestamp(),revision=revision+1 where id='e9600000-0000-4000-8000-000000000002';
