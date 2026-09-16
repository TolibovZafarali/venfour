-- Readable aliases preserve the original link and immutable case attribution.
create function public.referral_slug_valid_internal(value text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(value) between 3 and 63 and value ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
   and value !~ '^[0-9a-f]{48}$' and value not in
   ('admin','api','auth','businesses','earnings','help','invitations','partners','sign-in','start','support','venfour','www'),false);
$$;
create table public.referral_partner_aliases (
 slug text primary key check(public.referral_slug_valid_internal(slug)),
 partner_id uuid not null references public.referral_partners(id) deferrable initially deferred,
 created_at timestamptz not null default statement_timestamp(),
 unique(slug,partner_id)
);
alter table public.referral_partner_aliases enable row level security;
revoke all on public.referral_partner_aliases from public,anon,authenticated,service_role;
create trigger referral_partner_aliases_immutable before update or delete on public.referral_partner_aliases
 for each row execute function public.referral_attribution_protect_internal();
alter table public.referral_partners add column url_slug text;

create function public.referral_assign_slug_internal(pid uuid,business text,city text)
returns text language plpgsql security definer set search_path='' as $$
declare base text; candidate text; suffix text; serial integer=1;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('referral_partner_aliases',0));
 base=btrim(left(regexp_replace(lower(business),'[^a-z0-9]+','-','g'),48),'-');
 if not public.referral_slug_valid_internal(base) then base='business-'||coalesce(nullif(base,''),'partner'); end if;
 candidate=base;
 suffix=btrim(left(regexp_replace(lower(coalesce(city,'')),'[^a-z0-9]+','-','g'),20),'-');
 if exists(select 1 from public.referral_partner_aliases where slug=candidate) and suffix<>'' then
   base=btrim(left(base,41),'-')||'-'||suffix; candidate=base;
 end if;
 while exists(select 1 from public.referral_partner_aliases where slug=candidate) loop
   serial=serial+1; candidate=btrim(left(base,53),'-')||'-'||serial::text;
 end loop;
 insert into public.referral_partner_aliases(slug,partner_id) values(candidate,pid);
 return candidate;
end;
$$;
do $$ declare p record; begin
 for p in select id,business_name,city from public.referral_partners order by created_at,id loop
   update public.referral_partners set url_slug=public.referral_assign_slug_internal(p.id,p.business_name,p.city) where id=p.id;
 end loop;
end $$;
alter table public.referral_partners alter column url_slug set not null;
alter table public.referral_partners add constraint referral_partner_current_alias
 foreign key(url_slug,id) references public.referral_partner_aliases(slug,partner_id) deferrable initially deferred;
create function public.referral_partner_initial_slug_internal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.url_slug=public.referral_assign_slug_internal(new.id,new.business_name,new.city);
 return new;
end;
$$;
create trigger referral_partner_initial_slug before insert on public.referral_partners
 for each row execute function public.referral_partner_initial_slug_internal();

-- Resolve aliases to the existing opaque code. All eligibility, ownership and
-- first-draft rules remain in the original attribution implementation.
create or replace function public.get_or_create_referred_total_loss_draft(p_referral_code text)
returns public.appraisal_cases language sql volatile security definer set search_path='' as $$
 select public.get_or_create_total_loss_draft_internal(coalesce((
   select l.code from public.referral_partner_aliases a join public.referral_partner_links l on l.partner_id=a.partner_id
   where a.slug=p_referral_code),p_referral_code));
$$;
create or replace function public.referral_summary_internal(p_partner_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('link',(select jsonb_build_object('id',l.id,'code',l.code,'slug',p.url_slug,
   'status',l.status,'revision',l.revision,'created_at',l.created_at)
   from public.referral_partner_links l join public.referral_partners p on p.id=l.partner_id where l.partner_id=p_partner_id),
   'summary',(select jsonb_build_object('submitted_count',count(*),'purchased_count',count(*) filter(where r.purchased_at is not null),
     'refunded_count',count(*) filter(where r.status='refunded'),'under_review_count',count(*) filter(where r.status='under_review'))
     from public.referral_tracking_rows_internal(p_partner_id) r));
$$;

alter function public.referral_partner_operation(text,jsonb) rename to referral_partner_before_aliases_internal;
revoke all on function public.referral_partner_before_aliases_internal(text,jsonb) from public,anon,authenticated,service_role;
create function public.referral_partner_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); pid uuid; p public.referral_partners%rowtype; chosen_slug text; request_uuid uuid;
 request_digest text; prior public.referral_partner_requests%rowtype; result jsonb;
begin
 if p_action is null or p_action not in ('staff_resolve','partner_resolve','slug_update') then
   return public.referral_partner_before_aliases_internal(p_action,p_payload);
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096 then
   raise exception using errcode='22023',message='Invalid link request.'; end if;
 if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null
   and not coalesce(is_anonymous,false) and nullif(btrim(email),'') is not null) then
   raise exception using errcode='42501',message='Verified account required.'; end if;
 if p_action<>'partner_resolve' and not public.referral_partner_is_manager_internal(actor) then
   raise exception using errcode='42501',message='Partner manager access required.'; end if;
 chosen_slug=p_payload->>'slug';
 if not public.referral_slug_valid_internal(chosen_slug) or jsonb_typeof(p_payload->'slug') is distinct from 'string' then
   raise exception using errcode='22023',message='Use 3–63 lowercase letters, numbers and single hyphens, starting with a letter.'; end if;
 if p_action in ('staff_resolve','partner_resolve') then
   if p_payload-array['slug']<>'{}'::jsonb then raise exception using errcode='22023',message='Unexpected link field.'; end if;
   select partner_id into pid from public.referral_partner_aliases where referral_partner_aliases.slug=chosen_slug;
   return public.referral_partner_before_aliases_internal(case when p_action='staff_resolve' then 'staff_get' else 'partner_get' end,jsonb_build_object('partner_id',pid));
 end if;
 if p_payload-array['slug','partner_id','request_id','expected_revision']<>'{}'::jsonb
   or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or (p_payload->>'expected_revision') !~ '^[1-9][0-9]{0,8}$' then
   raise exception using errcode='22023',message='Invalid link revision.'; end if;
 pid=(p_payload->>'partner_id')::uuid; request_uuid=(p_payload->>'request_id')::uuid;
 if request_uuid is null then raise exception using errcode='22023',message='Request ID required.'; end if;
 request_digest=public.total_loss_canonical_jsonb_digest(jsonb_build_object('action',p_action,'payload',p_payload));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||request_uuid::text,0));
 select * into prior from public.referral_partner_requests where actor_user_id=actor and request_id=request_uuid;
 if found then
   if prior.action<>p_action or prior.payload_digest<>request_digest then raise exception using errcode='40001',message='Request ID conflicts with recorded operation.'; end if;
   return prior.response;
 end if;
 select * into p from public.referral_partners where id=pid for update;
 if not found then raise exception using errcode='42501',message='Partner unavailable.'; end if;
 if p.revision<>(p_payload->>'expected_revision')::integer then raise exception using errcode='40001',message='Business changed. Reload before updating the link.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('referral_partner_aliases',0));
 if exists(select 1 from public.referral_partner_aliases a where a.slug=chosen_slug and a.partner_id<>pid) then
   raise exception using errcode='23505',message='This link name is already reserved. Choose another name.'; end if;
 insert into public.referral_partner_aliases(slug,partner_id) values(chosen_slug,pid) on conflict do nothing;
 update public.referral_partners set url_slug=chosen_slug,revision=revision+1,updated_at=statement_timestamp() where id=pid;
 insert into public.referral_partner_events(partner_id,event_type,actor_user_id,metadata)
   values(pid,'partner.link_updated',actor,jsonb_build_object('previous_slug',p.url_slug,'slug',chosen_slug));
 result=public.referral_partner_before_aliases_internal('staff_get',jsonb_build_object('partner_id',pid));
 insert into public.referral_partner_requests(actor_user_id,request_id,action,payload_digest,response)
   values(actor,request_uuid,p_action,request_digest,result);
 return result;
end;
$$;
revoke all on function public.referral_slug_valid_internal(text),public.referral_assign_slug_internal(uuid,text,text),
 public.referral_partner_initial_slug_internal(),public.referral_partner_operation(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.referral_partner_operation(text,jsonb) to authenticated;
