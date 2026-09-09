-- These two old guest cases now have distinct immutable/unsubmitted attribution.
insert into public.referral_case_attributions(case_id,partner_id,link_id,agreement_id,agreement_digest,commission_amount_minor_units,currency,
 bound_at,submitted_at)
select ('e9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9600000-0000-4000-8000-000000000002',l.id,
 'e9600000-0000-4000-8000-000000000003',repeat('e',64),4500,'USD',statement_timestamp()-interval '50 days',
 case when n=2 then statement_timestamp()-interval '49 days' end
from public.referral_partner_links l cross join generate_series(2,3) n
where l.partner_id='e9600000-0000-4000-8000-000000000002';
