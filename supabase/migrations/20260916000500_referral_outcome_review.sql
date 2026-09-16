-- Manager evidence review; decisions and commission posting share one transaction.
create table public.referral_outcome_reviews (
 id uuid primary key,
 attribution_id uuid not null references public.referral_case_attributions(id),
 reviewer_id uuid not null references auth.users(id),
 revision integer not null check(revision>0),
 decision text not null check(decision in ('approved','needs_evidence','ineligible')),
 notes text not null check(length(btrim(notes)) between 20 and 2000),
 request jsonb not null,
 source jsonb not null,
 award_id uuid references public.referral_commission_entries(id),
 reviewed_at timestamptz not null default statement_timestamp(),
 unique(attribution_id,revision),
 check((decision='approved')=(award_id is not null))
);
alter table public.referral_outcome_reviews enable row level security;
revoke all on public.referral_outcome_reviews from public,anon,authenticated,service_role;
create trigger referral_outcome_reviews_immutable before update or delete on public.referral_outcome_reviews
 for each row execute function public.referral_attribution_protect_internal();

create function public.referral_outcome_source_internal(p_attribution_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('case_id',a.case_id,'agreement_digest',a.agreement_digest,'attributed_at',a.bound_at,
   'paid_at',c.purchased_at,'payment_status',o.status,'refund_policy_version',o.refund_policy_version,
   'payment_held',c.order_id is null or public.referral_commission_payment_held_internal(c.order_id),
   'program_enabled',coalesce(public.referral_earnings_enabled_internal(a.partner_id) and g.status='countersigned'
     and g.snapshot->'commission_policy'=(select ag.snapshot->'commission_policy' from public.referral_partner_agreements ag join public.referral_partners p on p.current_agreement_id=ag.id where p.id=a.partner_id)
     and exists(select 1 from public.referral_partner_templates t where t.id=g.template_id and t.status='published' and not t.release_hold),false),
   'workflow', (select jsonb_build_object('phase',w.phase,'task',w.current_task,'resolution',w.resolution_code,'revision',w.revision) from public.total_loss_claim_workflows w where w.case_id=a.case_id),
   'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',coalesce(d.original_filename,d.document_kind),
      'kind',d.document_kind,'digest',d.content_digest,'sealed_at',d.sealed_at,'media_type',d.media_type) order by d.created_at,d.id)
      from public.total_loss_claim_documents d where d.case_id=a.case_id and d.status='ready' and d.sealed_at is not null
      and d.storage_bucket_id is not null and d.content_digest is not null),'[]'::jsonb),
   'revision',(select count(*) from public.referral_outcome_reviews r where r.attribution_id=a.id),
   'recorded',exists(select 1 from public.referral_commission_entries e where e.attribution_id=a.id))
 from public.referral_case_attributions a left join public.referral_purchase_conversions c on c.attribution_id=a.id
 left join public.commerce_orders o on o.id=c.order_id join public.referral_partner_agreements g on g.id=a.agreement_id
 where a.id=p_attribution_id;
$$;

alter function public.referral_partner_operation(text,jsonb) rename to referral_partner_before_outcomes_internal;
revoke all on function public.referral_partner_before_outcomes_internal(text,jsonb) from public,anon,authenticated,service_role;
create function public.referral_partner_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); pid uuid; aid uuid; src jsonb; history jsonb; prior public.referral_outcome_reviews%rowtype; pg integer;
begin
 if p_action is null or p_action not in ('outcome_queue','outcome_get','outcome_prepare','outcome_document') then
   return public.referral_partner_before_outcomes_internal(p_action,p_payload);
 end if;
 if not public.referral_partner_is_manager_internal(actor) or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
   raise exception using errcode='42501',message='Verified partner manager required.'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16384 then
   raise exception using errcode='22023',message='Invalid review request.'; end if;
 pid=(p_payload->>'partner_id')::uuid;
 if not exists(select 1 from public.referral_partners where id=pid) then raise exception using errcode='P0002',message='Partner unavailable.'; end if;
 if p_action='outcome_queue' then
   pg=(p_payload->>'page')::integer;
   if pg is null or pg not between 1 and 100000 then raise exception using errcode='22023',message='Invalid page.'; end if;
   return jsonb_build_object('total',(select count(*) from public.referral_case_attributions where partner_id=pid and submitted_at is not null),'items',coalesce((
    select jsonb_agg(q.item order by q.submitted_at desc,q.id) from (
     select a.id,a.submitted_at,jsonb_build_object('id',a.id,'submitted_at',a.submitted_at,'paid_at',c.purchased_at,
       'decision',case when exists(select 1 from public.referral_commission_entries e where e.attribution_id=a.id) then 'approved' else coalesce((select r.decision from public.referral_outcome_reviews r where r.attribution_id=a.id order by revision desc limit 1),'unreviewed') end,
       'document_count',(select count(*) from public.total_loss_claim_documents d where d.case_id=a.case_id and d.status='ready' and d.sealed_at is not null),
       'payment_held',c.order_id is null or public.referral_commission_payment_held_internal(c.order_id)) item
     from public.referral_case_attributions a left join public.referral_purchase_conversions c on c.attribution_id=a.id
     where a.partner_id=pid and a.submitted_at is not null order by a.submitted_at desc,a.id limit 25 offset (pg-1)*25) q),'[]'::jsonb));
 end if;
 aid=(p_payload->>'attribution_id')::uuid;
 if not exists(select 1 from public.referral_case_attributions where id=aid and partner_id=pid) then
   raise exception using errcode='42501',message='Referral unavailable.'; end if;
 if p_action='outcome_document' then
   return (select jsonb_build_object('bucket',d.storage_bucket_id,'path',d.storage_object_name,'digest',d.content_digest,'size',d.byte_size,'media_type',d.media_type)
     from public.total_loss_claim_documents d join public.referral_case_attributions a on a.case_id=d.case_id
     where a.id=aid and d.id=(p_payload->>'document_id')::uuid and d.status='ready' and d.sealed_at is not null);
 end if;
 src=public.referral_outcome_source_internal(aid);
 if p_action='outcome_prepare' then
   select * into prior from public.referral_outcome_reviews where id=(p_payload->>'request_id')::uuid;
   if found then
     if prior.reviewer_id<>actor or prior.request<>p_payload then raise exception using errcode='40001',message='Request conflicts with retained review.'; end if;
     return jsonb_build_object('result',jsonb_build_object('decision',prior.decision,'revision',prior.revision,'award_id',prior.award_id));
   end if;
   if p_payload->>'source_digest' is distinct from public.total_loss_canonical_jsonb_digest(src) or (src->>'recorded')::boolean then
     raise exception using errcode='40001',message='Review changed. Reload the evidence.'; end if;
   return jsonb_build_object('source',src,'reviewer_id',actor,'verified_at',statement_timestamp());
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('decision',r.decision,'notes',r.notes,'reviewer_id',r.reviewer_id,'reviewed_at',r.reviewed_at,'revision',r.revision,'facts',r.request->'facts') order by r.revision desc),'[]'::jsonb)
 into history from public.referral_outcome_reviews r where r.attribution_id=aid;
 return jsonb_build_object('source',src,'source_digest',public.total_loss_canonical_jsonb_digest(src),'history',history);
end;
$$;

create function public.referral_outcome_worker(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb=p_payload->'request'; actor uuid=(p_payload->>'reviewer_id')::uuid;
 aid uuid=(req->>'attribution_id')::uuid; pid uuid=(req->>'partner_id')::uuid; src jsonb; prior public.referral_outcome_reviews%rowtype;
 award jsonb=p_payload->'award'; result jsonb; rev integer; doc text;
begin
 if (select auth.role()) is distinct from 'service_role' or not public.referral_partner_is_manager_internal(actor)
   or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
   raise exception using errcode='42501',message='Private review service and current manager required.'; end if;
 perform 1 from public.referral_partners where id=pid for update;
 perform 1 from public.referral_case_attributions where id=aid and partner_id=pid for update;
 if not found then raise exception using errcode='42501',message='Referral unavailable.'; end if;
 perform 1 from public.commerce_orders where id=(select order_id from public.referral_purchase_conversions where attribution_id=aid) for update;
 perform 1 from public.total_loss_claim_workflows where case_id=(select case_id from public.referral_case_attributions where id=aid) for update;
 select * into prior from public.referral_outcome_reviews where id=(req->>'request_id')::uuid;
 if found then
   if prior.reviewer_id<>actor or prior.request<>req then raise exception using errcode='40001',message='Request conflicts with retained review.'; end if;
   return jsonb_build_object('decision',prior.decision,'revision',prior.revision,'award_id',prior.award_id);
 end if;
 src=public.referral_outcome_source_internal(aid);
 if req->>'source_digest' is distinct from public.total_loss_canonical_jsonb_digest(src) or (src->>'recorded')::boolean then
   raise exception using errcode='40001',message='Review changed. Reload the evidence.'; end if;
 if p_payload->>'verified_at' is null or (p_payload->>'verified_at')::timestamptz not between statement_timestamp()-interval '5 minutes' and statement_timestamp() then
   raise exception using errcode='40001',message='Review expired.'; end if;
 if req->>'decision'='approved' then
   if not (src->>'program_enabled')::boolean or (src->>'payment_held')::boolean then
     raise exception using errcode='55000',message='Program or payment blocked.'; end if;
   foreach doc in array array['baseline_document_id','final_document_id','acceptance_document_id','review_document_id'] loop
     if not exists(select 1 from jsonb_array_elements(src->'documents') d where d->>'id'=req->'facts'->>doc) then
       raise exception using errcode='22023',message='Retained case evidence required.'; end if;
   end loop;
   if award->>'partner_id' is distinct from pid::text or award->'outcome'->>'attribution_id' is distinct from aid::text
     or award->'outcome'->>'reviewer_id' is distinct from actor::text
     or (award->'outcome'->>'verified_at')::timestamptz is distinct from (p_payload->>'verified_at')::timestamptz then
     raise exception using errcode='22023',message='Review and award must match.'; end if;
   if exists(select 1 from unnest(array['baseline_document_id','final_document_id','acceptance_document_id',
     'baseline_vehicle_value_minor','final_vehicle_value_minor','latest_written_baseline_confirmed','equivalent_vehicle_components_confirmed',
     'process_completed','insurer_evidence_verified','final_acceptance_verified']) k
     where award->'outcome'->k is distinct from req->'facts'->k)
     or exists(select 1 from unnest(array['baseline_communicated_at','service_started_at','accepted_at']) k
     where (award->'outcome'->>k)::timestamptz is distinct from (req->'facts'->>k)::timestamptz) then
     raise exception using errcode='22023',message='Award must preserve reviewed facts.'; end if;
   result=public.referral_commission_worker('record',award);
 elsif req->>'decision' not in ('needs_evidence','ineligible') or req->>'decision' is null or award is distinct from 'null'::jsonb then
   raise exception using errcode='22023',message='Invalid review decision.';
 end if;
 rev=(src->>'revision')::integer+1;
 insert into public.referral_outcome_reviews(id,attribution_id,reviewer_id,revision,decision,notes,request,source,award_id,reviewed_at)
 values((req->>'request_id')::uuid,aid,actor,rev,req->>'decision',req->>'notes',req,src,(result->>'id')::uuid,(p_payload->>'verified_at')::timestamptz);
 return jsonb_build_object('decision',req->>'decision','revision',rev,'award_id',result->>'id');
end;
$$;
revoke all on function public.referral_outcome_source_internal(uuid),public.referral_outcome_worker(jsonb),public.referral_partner_operation(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.referral_partner_operation(text,jsonb) to authenticated;
grant execute on function public.referral_outcome_worker(jsonb) to service_role;
