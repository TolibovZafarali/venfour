-- Invitation-only referral partner onboarding, with separately authorized managers.
create table public.referral_partner_managers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default statement_timestamp()
);
create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 200),
  contact_email text not null check (contact_email=lower(btrim(contact_email)) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and char_length(contact_email)<=320),
  user_id uuid references auth.users(id),
  state text not null default 'MO' check (state ~ '^[A-Z]{2}$'),
  commission_amount_minor_units integer not null check (commission_amount_minor_units between 1 and 100000000),
  currency text not null default 'USD' check (currency='USD'),
  legal_business_name text, address_line1 text, address_line2 text, city text, postal_code text,
  country text not null default 'US' check (country='US'), contact_name text, contact_title text,
  status text not null default 'onboarding' check (status in ('onboarding','awaiting_approval','active')),
  revision integer not null default 1 check (revision>0), current_agreement_id uuid,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(), activated_at timestamptz
);
create index referral_partners_contact_idx on public.referral_partners(contact_email);
create index referral_partners_user_idx on public.referral_partners(user_id);
create table public.referral_partner_templates (
  id uuid primary key default gen_random_uuid(), title text not null,
  sections jsonb not null, status text not null default 'draft' check (status in ('draft','published')),
  revision integer not null default 1, version integer unique,
  created_by_user_id uuid not null references auth.users(id),
  published_by_user_id uuid references auth.users(id), published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check ((status='published')=(version is not null and published_at is not null and published_by_user_id is not null))
);
create table public.referral_partner_invitations (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.referral_partners(id),
  contact_email text not null, status text not null default 'pending' check (status in ('pending','revoked','accepted')),
  expires_at timestamptz not null default statement_timestamp()+interval '7 days',
  created_by_user_id uuid not null references auth.users(id), accepted_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default statement_timestamp(), accepted_at timestamptz, revoked_at timestamptz
);
create unique index referral_partner_pending_invite_idx on public.referral_partner_invitations(partner_id) where status='pending';
create table public.referral_partner_agreements (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.referral_partners(id),
  template_id uuid not null references public.referral_partner_templates(id),
  snapshot jsonb not null, agreement_digest text not null check (agreement_digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'prepared' check (status in ('prepared','partner_signed','countersigned','superseded')),
  revision integer not null default 1, partner_signature jsonb, manager_signature jsonb,
  document_status text not null default 'not_requested' check (document_status in ('not_requested','queued','processing','ready','failed')),
  document_job_id uuid, document_sha256 text, document_byte_size bigint, document_ready_at timestamptz,
  storage_bucket text not null default 'partner-agreements' check (storage_bucket='partner-agreements'),
  storage_object_path text not null,
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check ((status in ('partner_signed','countersigned') and partner_signature is not null) or (status='prepared' and partner_signature is null) or status='superseded'),
  check ((status='countersigned')=(manager_signature is not null)),
  check (storage_object_path='partners/'||partner_id::text||'/agreements/'||id::text||'/signed.pdf'),
  check (document_status<>'ready' or (document_sha256 ~ '^[0-9a-f]{64}$' and document_byte_size between 1 and 10485760 and document_ready_at is not null))
);
alter table public.referral_partners add constraint referral_partners_agreement_fk foreign key(current_agreement_id) references public.referral_partner_agreements(id);
create table public.referral_partner_signatures (
  id uuid primary key default gen_random_uuid(), agreement_id uuid not null references public.referral_partner_agreements(id),
  role text not null check(role in ('partner','manager')), user_id uuid not null references auth.users(id),
  signature jsonb not null, agreement_digest text not null, signed_at timestamptz not null,
  unique(agreement_id,role)
);
alter table public.referral_partner_signatures enable row level security;
revoke all on public.referral_partner_signatures from public,anon,authenticated,service_role;
create table public.referral_partner_events (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.referral_partners(id),
  event_type text not null, actor_user_id uuid references auth.users(id), agreement_id uuid references public.referral_partner_agreements(id),
  metadata jsonb not null default '{}', created_at timestamptz not null default statement_timestamp()
);
create table public.referral_partner_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('document','email')),
  partner_id uuid not null references public.referral_partners(id), agreement_id uuid references public.referral_partner_agreements(id),
  invitation_id uuid references public.referral_partner_invitations(id),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','review','canceled')),
  payload jsonb not null, attempts integer not null default 0,
  lease_token uuid, lease_expires_at timestamptz, first_attempt_at timestamptz,
  available_at timestamptz not null default statement_timestamp(),
  prepared_provider text, prepared_payload jsonb, provider_message_id text,
  error_code text, result jsonb, created_at timestamptz not null default statement_timestamp(), finished_at timestamptz
);
alter table public.referral_partner_agreements add constraint referral_partner_agreement_job_fk foreign key(document_job_id) references public.referral_partner_jobs(id);
create index referral_partner_jobs_due_idx on public.referral_partner_jobs(kind,available_at) where status in ('queued','failed','processing');
create table public.referral_partner_requests (
  actor_user_id uuid not null references auth.users(id), request_id uuid not null,
  action text not null, payload_digest text not null, response jsonb not null,
  created_at timestamptz not null default statement_timestamp(), primary key(actor_user_id,request_id)
);

alter table public.referral_partner_managers enable row level security;
alter table public.referral_partners enable row level security;
alter table public.referral_partner_templates enable row level security;
alter table public.referral_partner_invitations enable row level security;
alter table public.referral_partner_agreements enable row level security;
alter table public.referral_partner_events enable row level security;
alter table public.referral_partner_jobs enable row level security;
alter table public.referral_partner_requests enable row level security;
revoke all on public.referral_partner_managers,public.referral_partners,public.referral_partner_templates,
  public.referral_partner_invitations,public.referral_partner_agreements,public.referral_partner_events,
  public.referral_partner_jobs,public.referral_partner_requests from public,anon,authenticated,service_role;
grant select,insert,delete on public.referral_partner_managers to service_role;

create function public.referral_partner_is_manager_internal(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_members s join public.referral_partner_managers m using(user_id)
    join auth.users u on u.id=m.user_id where u.id=p_user_id and not coalesce(u.is_anonymous,false)
      and u.email_confirmed_at is not null and u.email is not null);
$$;
create function public.referral_partner_detail_internal(p_partner_id uuid,p_manager boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('partner',to_jsonb(p),
  'invitations',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.referral_partner_invitations i where i.partner_id=p.id),'[]'::jsonb),
  'agreements',coalesce((select jsonb_agg((to_jsonb(a)-'document_job_id') || jsonb_build_object('deliveries',
    coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'error_code',j.error_code,
      'created_at',j.created_at,'finished_at',j.finished_at,'kind',j.payload->>'kind') order by j.created_at desc)
      from public.referral_partner_jobs j where j.agreement_id=a.id and j.kind='email'),'[]'::jsonb)) order by a.created_at desc)
    from public.referral_partner_agreements a where a.partner_id=p.id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.referral_partner_events e where e.partner_id=p.id),'[]'::jsonb),
  'invitation_deliveries',case when p_manager then coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'invitation_id',j.invitation_id,
    'status',j.status,'attempts',j.attempts,'error_code',j.error_code,'created_at',j.created_at,'finished_at',j.finished_at) order by j.created_at desc)
    from public.referral_partner_jobs j where j.partner_id=p.id and j.invitation_id is not null),'[]'::jsonb) else '[]'::jsonb end)
 from public.referral_partners p where p.id=p_partner_id;
$$;
create function public.referral_partner_text_internal(p_payload jsonb,p_key text,p_max integer,p_required boolean default true)
returns text language plpgsql immutable set search_path='' as $$
declare v text;
begin
 if p_payload->p_key is null or p_payload->p_key='null'::jsonb then
  if p_required then raise exception using errcode='22023',message='Required field missing: '||p_key; end if;
  return null;
 end if;
 if jsonb_typeof(p_payload->p_key)<>'string' then raise exception using errcode='22023',message='Invalid field: '||p_key; end if;
 v=btrim(p_payload->>p_key);
 if char_length(v)>p_max or (p_required and char_length(v)=0) or v ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
  raise exception using errcode='22023',message='Invalid field: '||p_key;
 end if;
 return nullif(v,'');
end;
$$;
create function public.referral_partner_enqueue_document_internal(p_agreement_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.referral_partner_agreements%rowtype; j uuid;
begin
 select * into strict a from public.referral_partner_agreements where id=p_agreement_id for update;
 if a.status<>'countersigned' or a.document_status='ready' then raise exception using errcode='55000',message='Document cannot be queued.'; end if;
 insert into public.referral_partner_jobs(kind,partner_id,agreement_id,payload) values('document',a.partner_id,a.id,
  jsonb_build_object('agreement_id',a.id,'partner_id',a.partner_id,'bucket',a.storage_bucket,'object_path',a.storage_object_path,
   'snapshot',a.snapshot,'content_sha256',a.agreement_digest,'agreement_revision',a.revision,
   'partner_signature',a.partner_signature,'manager_signature',a.manager_signature)) returning id into j;
 update public.referral_partner_agreements set document_status='queued',document_job_id=j,updated_at=statement_timestamp() where id=a.id;
 return j;
end;
$$;
create function public.referral_partner_enqueue_copy_internal(p_agreement_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.referral_partner_agreements%rowtype; j uuid;
begin
 select * into strict a from public.referral_partner_agreements where id=p_agreement_id;
 if a.status<>'countersigned' or a.document_status<>'ready' then raise exception using errcode='55000',message='Agreement copy is not ready.'; end if;
 insert into public.referral_partner_jobs(kind,partner_id,agreement_id,payload) values('email',a.partner_id,a.id,
  jsonb_build_object('kind','agreement_copy','agreement_id',a.id,'partner_id',a.partner_id,
   'recipient_email',a.snapshot->>'contact_email','business_name',a.snapshot->>'business_name',
   'bucket',a.storage_bucket,'object_path',a.storage_object_path,'sha256',a.document_sha256,'byte_size',a.document_byte_size)) returning id into j;
 return j;
end;
$$;

create function public.referral_partner_operation(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid=(select auth.uid()); actor_email text; manager boolean; response jsonb; request_uuid uuid; request_digest text;
 prior public.referral_partner_requests%rowtype; p public.referral_partners%rowtype; t public.referral_partner_templates%rowtype;
 i public.referral_partner_invitations%rowtype; a public.referral_partner_agreements%rowtype;
 partner_uuid uuid; template_uuid uuid; agreement_uuid uuid; invitation_uuid uuid; chosen_id uuid; job_uuid uuid;
 expected integer; amount integer; page_number integer; page_size integer; total_count integer; search_text text;
 body jsonb; snapshot_value jsonb; signature_value jsonb; section_value jsonb; allowed_keys text[]; is_read boolean;
 now_at timestamptz=statement_timestamp();
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 then
  raise exception using errcode='22023',message='Invalid referral request.';
 end if;
 select lower(btrim(u.email)) into actor_email from auth.users u where u.id=actor and not coalesce(u.is_anonymous,false) and u.email_confirmed_at is not null;
 manager=actor_email is not null and public.referral_partner_is_manager_internal(actor);
 if p_action='access' then return jsonb_build_object('is_partner_manager',manager,'is_partner',actor_email is not null and exists(select 1 from public.referral_partners x where x.user_id=actor)); end if;
 if actor_email is null then raise exception using errcode='42501',message='Verified account required.'; end if;
 if p_action is null or p_action not in ('staff_list','staff_get','staff_create','staff_edit','template_list','template_save','template_publish',
  'invite','resend','revoke','partner_list','partner_get','invitation_get','invitation_accept','profile_save','agreement_prepare',
  'sign','countersign','document_retry','email_retry','agreement_document','staff_agreement_document') then raise exception using errcode='22023',message='Unknown referral operation.'; end if;
 if p_action in ('staff_list','staff_get','staff_create','staff_edit','template_list','template_save','template_publish','invite','resend','revoke','countersign','document_retry','email_retry','staff_agreement_document') and not manager then
  raise exception using errcode='42501',message='Partner manager access required.';
 end if;
 allowed_keys=case p_action
 when 'staff_list' then array['page','page_size','search','status'] when 'partner_list' then array['page','page_size']
 when 'staff_get' then array['partner_id'] when 'partner_get' then array['partner_id']
 when 'staff_create' then array['request_id','business_name','contact_email','state','commission_amount_minor_units']
 when 'staff_edit' then array['request_id','expected_revision','partner_id','business_name','contact_email','state','commission_amount_minor_units']
 when 'template_list' then array[]::text[]
 when 'template_save' then array['request_id','template_id','expected_revision','title','sections']
 when 'template_publish' then array['request_id','template_id','expected_revision']
 when 'invite' then array['request_id','partner_id','expected_revision'] when 'resend' then array['request_id','partner_id','expected_revision']
 when 'revoke' then array['request_id','partner_id','invitation_id','expected_revision']
 when 'invitation_get' then array['invitation_id'] when 'invitation_accept' then array['request_id','invitation_id']
 when 'profile_save' then array['request_id','partner_id','expected_revision','legal_business_name','address_line1','address_line2','city','state','postal_code','country','contact_name','contact_title']
 when 'agreement_prepare' then array['request_id','partner_id','expected_revision']
 when 'sign' then array['request_id','agreement_id','expected_revision','agreement_digest','typed_legal_name','typed_title','electronic_consent','pdf_email_consent','authority_confirmed']
 when 'countersign' then array['request_id','agreement_id','expected_revision','agreement_digest','typed_legal_name','typed_title','electronic_consent','pdf_email_consent','authority_confirmed']
 when 'document_retry' then array['request_id','agreement_id','expected_revision'] when 'email_retry' then array['request_id','agreement_id','expected_revision']
 when 'agreement_document' then array['agreement_id'] when 'staff_agreement_document' then array['agreement_id'] end;
 if exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed_keys)) then raise exception using errcode='22023',message='Unexpected referral field.'; end if;
 is_read=p_action in ('staff_list','staff_get','template_list','partner_list','partner_get','invitation_get','agreement_document','staff_agreement_document');
 if p_action='sign' and not exists(select 1 from public.referral_partner_agreements x join public.referral_partners y on y.id=x.partner_id where x.id=(p_payload->>'agreement_id')::uuid and y.user_id=actor and y.contact_email=actor_email and x.snapshot->>'contact_email'=actor_email) then raise exception using errcode='42501',message='Signing identity no longer matches the agreement.'; end if;
 if not is_read then
  request_uuid=(p_payload->>'request_id')::uuid;
  if request_uuid is null then raise exception using errcode='22023',message='Request ID required.'; end if;
  request_digest=public.total_loss_canonical_jsonb_digest(jsonb_build_object('action',p_action,'payload',p_payload));
  perform pg_advisory_xact_lock(hashtextextended(actor::text||request_uuid::text,0));
  select * into prior from public.referral_partner_requests where actor_user_id=actor and request_id=request_uuid;
  if found then
   if prior.action<>p_action or prior.payload_digest<>request_digest then raise exception using errcode='40001',message='Request ID conflicts with recorded operation.'; end if;
   return prior.response;
  end if;
 end if;
 if p_action in ('staff_list','partner_list') then
  page_number=coalesce((p_payload->>'page')::integer,1); page_size=coalesce((p_payload->>'page_size')::integer,50);
  search_text=coalesce(public.referral_partner_text_internal(p_payload,'search',200,false),'');
  if page_number not between 1 and 100000 or page_size not between 1 and 100 then raise exception using errcode='22023',message='Invalid pagination.'; end if;
  if p_payload ? 'status' and p_payload->>'status' not in ('onboarding','awaiting_approval','active') then raise exception using errcode='22023',message='Invalid status filter.'; end if;
  select count(*) into total_count from public.referral_partners x where (p_action='staff_list' or x.user_id=actor)
   and (not p_payload ? 'status' or x.status=p_payload->>'status') and (search_text='' or x.business_name ilike '%'||search_text||'%' or x.contact_email ilike '%'||search_text||'%');
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into body from (select x.* from public.referral_partners x
   where (p_action='staff_list' or x.user_id=actor) and (not p_payload ? 'status' or x.status=p_payload->>'status')
   and (search_text='' or x.business_name ilike '%'||search_text||'%' or x.contact_email ilike '%'||search_text||'%')
   order by x.updated_at desc,x.id limit page_size offset (page_number-1)*page_size) q;
  return jsonb_build_object('items',body,'total',total_count,'page',page_number,'page_size',page_size);
 elsif p_action='template_list' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from public.referral_partner_templates x),'[]'::jsonb));
 elsif p_action in ('staff_get','partner_get') then
  partner_uuid=(p_payload->>'partner_id')::uuid;
  if not exists(select 1 from public.referral_partners x where x.id=partner_uuid and (p_action='staff_get' or x.user_id=actor)) then raise exception using errcode='42501',message='Partner unavailable.'; end if;
  return public.referral_partner_detail_internal(partner_uuid,p_action='staff_get');
 elsif p_action in ('agreement_document','staff_agreement_document') then
  select * into a from public.referral_partner_agreements where id=(p_payload->>'agreement_id')::uuid;
  if not found or not ((p_action='staff_agreement_document' and manager) or (p_action='agreement_document' and exists(select 1 from public.referral_partners x where x.id=a.partner_id and x.user_id=actor))) then raise exception using errcode='42501',message='Agreement unavailable.'; end if;
  if a.document_status<>'ready' then raise exception using errcode='55000',message='Agreement document is not ready.'; end if;
  return jsonb_build_object('agreement_id',a.id,'partner_id',a.partner_id,'bucket',a.storage_bucket,'object_path',a.storage_object_path,'sha256',a.document_sha256,'byte_size',a.document_byte_size);
 elsif p_action in ('invitation_get','invitation_accept') then
  select * into i from public.referral_partner_invitations where id=(p_payload->>'invitation_id')::uuid;
  if not found or i.contact_email<>actor_email then raise exception using errcode='42501',message='Invitation unavailable.'; end if;
  select * into p from public.referral_partners where id=i.partner_id for update;
  select * into i from public.referral_partner_invitations where id=(p_payload->>'invitation_id')::uuid for update;
  if p.contact_email<>actor_email or (p.user_id is not null and p.user_id<>actor) then raise exception using errcode='42501',message='Invitation unavailable.'; end if;
  if i.status<>'pending' or i.expires_at<=now_at then raise exception using errcode='55000',message='Invitation is no longer available.'; end if;
  if p_action='invitation_get' then return jsonb_build_object('invitation',to_jsonb(i),'partner',to_jsonb(p)); end if;
  update public.referral_partner_invitations set status='accepted',accepted_by_user_id=actor,accepted_at=now_at where id=i.id;
  update public.referral_partners set user_id=actor,revision=revision+1,updated_at=now_at where id=p.id;
  update public.referral_partner_jobs set status='canceled',lease_token=null,lease_expires_at=null where invitation_id=i.id and status in ('queued','failed','processing');
  insert into public.referral_partner_events(partner_id,event_type,actor_user_id) values(p.id,'invitation.accepted',actor);
  response=public.referral_partner_detail_internal(p.id,false);
 elsif p_action='staff_create' then
  amount=(p_payload->>'commission_amount_minor_units')::integer;
  if amount is null or amount not between 1 and 100000000 then raise exception using errcode='22023',message='Invalid commission amount.'; end if;
  insert into public.referral_partners(business_name,contact_email,state,commission_amount_minor_units,created_by_user_id)
   values(public.referral_partner_text_internal(p_payload,'business_name',200),lower(public.referral_partner_text_internal(p_payload,'contact_email',320)),
    coalesce(public.referral_partner_text_internal(p_payload,'state',2,false),'MO'),amount,actor) returning * into p;
  insert into public.referral_partner_events(partner_id,event_type,actor_user_id) values(p.id,'partner.created',actor);
  response=public.referral_partner_detail_internal(p.id,true);
 elsif p_action in ('template_save','template_publish') then
  template_uuid=(p_payload->>'template_id')::uuid;
  if template_uuid is not null then
   select * into t from public.referral_partner_templates where id=template_uuid for update;
   if not found then raise exception using errcode='42501',message='Template unavailable.'; end if;
   expected=(p_payload->>'expected_revision')::integer;
   if expected is null or t.revision<>expected then raise exception using errcode='40001',message='Template changed. Refresh before continuing.'; end if;
   if t.status<>'draft' then raise exception using errcode='55000',message='Published templates are immutable. Create a new draft.'; end if;
  elsif p_action='template_publish' then raise exception using errcode='22023',message='Template ID required.';
  end if;
  if p_action='template_save' then
   body=p_payload->'sections';
   if body is null or jsonb_typeof(body)<>'array' or jsonb_array_length(body) not between 1 and 40 then raise exception using errcode='22023',message='Template requires 1 to 40 sections.'; end if;
   for section_value in select value from jsonb_array_elements(body) loop
    if jsonb_typeof(section_value)<>'object' or exists(select 1 from jsonb_object_keys(section_value) k where k not in ('heading','body')) then raise exception using errcode='22023',message='Invalid template section.'; end if;
    perform public.referral_partner_text_internal(section_value,'heading',200); perform public.referral_partner_text_internal(section_value,'body',10000);
   end loop;
   if template_uuid is null then
    insert into public.referral_partner_templates(title,sections,created_by_user_id) values(public.referral_partner_text_internal(p_payload,'title',200),body,actor) returning * into t;
   else update public.referral_partner_templates set title=public.referral_partner_text_internal(p_payload,'title',200),sections=body,revision=revision+1,updated_at=now_at where id=template_uuid returning * into t;
   end if;
  else
   perform pg_advisory_xact_lock(hashtextextended('referral_partner_template_publish',0));
   update public.referral_partner_templates set status='published',version=(select coalesce(max(version),0)+1 from public.referral_partner_templates),
    published_by_user_id=actor,published_at=now_at,revision=revision+1,updated_at=now_at where id=template_uuid returning * into t;
  end if;
  response=jsonb_build_object('template',to_jsonb(t));
 elsif p_action in ('sign','countersign','document_retry','email_retry') then
  agreement_uuid=(p_payload->>'agreement_id')::uuid;
  -- Every agreement operation locks the partner first to match profile and preparation writes.
  select partner_id into partner_uuid from public.referral_partner_agreements where id=agreement_uuid;
  select * into p from public.referral_partners where id=partner_uuid for update;
  if not found or (p_action='sign' and p.user_id is distinct from actor) then raise exception using errcode='42501',message='Agreement unavailable.'; end if;
  select * into a from public.referral_partner_agreements where id=agreement_uuid for update;
  expected=(p_payload->>'expected_revision')::integer;
  if expected is null or a.revision<>expected then raise exception using errcode='40001',message='Agreement changed. Refresh before continuing.'; end if;
  if p_action in ('sign','countersign') then
   if p.current_agreement_id is distinct from a.id or a.agreement_digest is distinct from p_payload->>'agreement_digest' then raise exception using errcode='40001',message='Agreement content changed.'; end if;
   if p_payload->'electronic_consent' is distinct from 'true'::jsonb or p_payload->'pdf_email_consent' is distinct from 'true'::jsonb or p_payload->'authority_confirmed' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='All signature confirmations are required.'; end if;
   signature_value=jsonb_build_object('user_id',actor,'typed_legal_name',public.referral_partner_text_internal(p_payload,'typed_legal_name',160),
    'typed_title',case when p_action='sign' then p.contact_title else public.referral_partner_text_internal(p_payload,'typed_title',160) end,
    'verified_email',actor_email,'signed_at',now_at,'electronic_consent',true,'pdf_email_consent',true,'authority_confirmed',true);
   if p_action='sign' then
    if p_payload ? 'typed_title' and public.referral_partner_text_internal(p_payload,'typed_title',160) is distinct from p.contact_title then raise exception using errcode='40001',message='Signer title differs from the issued profile.'; end if;
    if a.status<>'prepared' or p.status<>'onboarding' then raise exception using errcode='55000',message='Agreement cannot be signed in its current state.'; end if;
    insert into public.referral_partner_signatures(agreement_id,role,user_id,signature,agreement_digest,signed_at) values(a.id,'partner',actor,signature_value,a.agreement_digest,now_at);
    update public.referral_partner_agreements set partner_signature=signature_value,status='partner_signed',revision=revision+1,updated_at=now_at where id=a.id;
    update public.referral_partners set status='awaiting_approval',revision=revision+1,updated_at=now_at where id=p.id;
    insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) values(p.id,a.id,'agreement.partner_signed',actor);
   else
    if a.status<>'partner_signed' or p.status<>'awaiting_approval' or p.user_id=actor then raise exception using errcode='55000',message='Agreement cannot be countersigned in its current state.'; end if;
    insert into public.referral_partner_signatures(agreement_id,role,user_id,signature,agreement_digest,signed_at) values(a.id,'manager',actor,signature_value,a.agreement_digest,now_at);
    update public.referral_partner_agreements set manager_signature=signature_value,status='countersigned',revision=revision+1,updated_at=now_at where id=a.id;
    update public.referral_partners set status='active',activated_at=now_at,revision=revision+1,updated_at=now_at where id=p.id;
    perform public.referral_partner_enqueue_document_internal(a.id);
    insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) values(p.id,a.id,'agreement.countersigned',actor),(p.id,a.id,'partner.activated',actor);
   end if;
  elsif p_action='document_retry' then
   if a.document_status<>'failed' then raise exception using errcode='55000',message='Only failed documents can be retried.'; end if;
   perform public.referral_partner_enqueue_document_internal(a.id);
   insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) values(p.id,a.id,'document.retry_requested',actor);
  else
   perform public.referral_partner_enqueue_copy_internal(a.id);
   insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) values(p.id,a.id,'agreement.copy_requested',actor);
  end if;
  response=public.referral_partner_detail_internal(p.id,manager);
 else
  partner_uuid=(p_payload->>'partner_id')::uuid;
  select * into p from public.referral_partners where id=partner_uuid for update;
  if not found or (p_action in ('profile_save','agreement_prepare') and (p.user_id is distinct from actor or p.contact_email<>actor_email)) then raise exception using errcode='42501',message='Partner unavailable.'; end if;
  expected=(p_payload->>'expected_revision')::integer;
  if expected is null or p.revision<>expected then raise exception using errcode='40001',message='Partner changed. Refresh before continuing.'; end if;
  if (p_action='staff_edit' and p.status='active') or (p_action in ('profile_save','agreement_prepare') and p.status<>'onboarding') then raise exception using errcode='55000',message='Signed partner terms cannot be edited.'; end if;
  if p_action='staff_edit' then
   amount=(p_payload->>'commission_amount_minor_units')::integer;
   if amount is null or amount not between 1 and 100000000 then raise exception using errcode='22023',message='Invalid commission amount.'; end if;
   if p.user_id is not null and p_payload ? 'contact_email' and lower(p_payload->>'contact_email')<>p.contact_email then raise exception using errcode='55000',message='Accepted contact email cannot be changed.'; end if;
   if exists(select 1 from public.referral_partner_agreements x where x.partner_id=p.id and x.status in ('prepared','partner_signed')) then
    insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) select p.id,x.id,'agreement.superseded',actor from public.referral_partner_agreements x where x.partner_id=p.id and x.status in ('prepared','partner_signed');
    update public.referral_partner_agreements set status='superseded',revision=revision+1,updated_at=now_at where partner_id=p.id and status in ('prepared','partner_signed');
   end if;
   if p_payload ? 'contact_email' and lower(p_payload->>'contact_email')<>p.contact_email then
    update public.referral_partner_invitations set status='revoked',revoked_at=now_at where partner_id=p.id and status='pending';
    update public.referral_partner_jobs set status='canceled',lease_token=null,lease_expires_at=null where partner_id=p.id and invitation_id is not null and status in ('queued','processing','failed');
   end if;
   update public.referral_partners set business_name=public.referral_partner_text_internal(p_payload,'business_name',200),
    contact_email=case when p_payload ? 'contact_email' then lower(public.referral_partner_text_internal(p_payload,'contact_email',320)) else contact_email end,
    state=public.referral_partner_text_internal(p_payload,'state',2),commission_amount_minor_units=amount,current_agreement_id=null,status='onboarding',
    revision=revision+1,updated_at=now_at where id=p.id;
   insert into public.referral_partner_events(partner_id,event_type,actor_user_id) values(p.id,'partner.edited',actor);
  elsif p_action in ('invite','resend','revoke') then
   if p.user_id is not null or p.status<>'onboarding' then raise exception using errcode='55000',message='An accepted partner cannot be invited or revoked.'; end if;
   if p_action='revoke' then
    invitation_uuid=(p_payload->>'invitation_id')::uuid;
    update public.referral_partner_invitations set status='revoked',revoked_at=now_at where id=invitation_uuid and partner_id=p.id and status='pending';
    if not found then raise exception using errcode='55000',message='Pending invitation unavailable.'; end if;
    update public.referral_partner_jobs set status='canceled',lease_token=null,lease_expires_at=null where invitation_id=invitation_uuid and status in ('queued','processing','failed');
   else
    if not exists(select 1 from public.referral_partner_templates x where x.status='published') then raise exception using errcode='55000',message='Publish an agreement template before inviting partners.'; end if;
    if p_action='invite' and exists(select 1 from public.referral_partner_invitations x where x.partner_id=p.id and x.status='pending' and x.expires_at>now_at) then raise exception using errcode='55000',message='A pending invitation already exists.'; end if;
    update public.referral_partner_invitations set status='revoked',revoked_at=now_at where partner_id=p.id and status='pending';
    update public.referral_partner_jobs set status='canceled',lease_token=null,lease_expires_at=null where partner_id=p.id and invitation_id is not null and status in ('queued','processing','failed');
    insert into public.referral_partner_invitations(partner_id,contact_email,created_by_user_id) values(p.id,p.contact_email,actor) returning * into i;
    insert into public.referral_partner_jobs(kind,partner_id,invitation_id,payload) values('email',p.id,i.id,
     jsonb_build_object('kind','invitation','invitation_id',i.id,'partner_id',p.id,'recipient_email',i.contact_email,'business_name',p.business_name,'expires_at',i.expires_at));
   end if;
   update public.referral_partners set revision=revision+1,updated_at=now_at where id=p.id;
   insert into public.referral_partner_events(partner_id,event_type,actor_user_id) values(p.id,'invitation.'||p_action,actor);
  elsif p_action='profile_save' then
   if p_payload->>'country' is distinct from 'US' then raise exception using errcode='22023',message='US business address required.'; end if;
   update public.referral_partner_agreements set status='superseded',revision=revision+1,updated_at=now_at where partner_id=p.id and status='prepared';
   update public.referral_partners set legal_business_name=public.referral_partner_text_internal(p_payload,'legal_business_name',200),
    address_line1=public.referral_partner_text_internal(p_payload,'address_line1',200),address_line2=public.referral_partner_text_internal(p_payload,'address_line2',200,false),
    city=public.referral_partner_text_internal(p_payload,'city',100),state=public.referral_partner_text_internal(p_payload,'state',2),
    postal_code=public.referral_partner_text_internal(p_payload,'postal_code',10),country='US',
    contact_name=public.referral_partner_text_internal(p_payload,'contact_name',160),contact_title=public.referral_partner_text_internal(p_payload,'contact_title',160),
    current_agreement_id=null,revision=revision+1,updated_at=now_at where id=p.id;
   insert into public.referral_partner_events(partner_id,event_type,actor_user_id) values(p.id,'partner.profile_saved',actor);
  elsif p_action='agreement_prepare' then
   if p.legal_business_name is null or p.address_line1 is null or p.city is null or p.postal_code is null or p.contact_name is null or p.contact_title is null then raise exception using errcode='55000',message='Complete the business profile before preparing the agreement.'; end if;
   if p.current_agreement_id is not null then response=public.referral_partner_detail_internal(p.id,false);
   else
    select * into t from public.referral_partner_templates where status='published' order by version desc limit 1;
    if not found then raise exception using errcode='55000',message='No published agreement template is available.'; end if;
    agreement_uuid=gen_random_uuid();
    snapshot_value=jsonb_build_object('template_id',t.id,'template_version',t.version,'title',t.title,'sections',t.sections,
      'business_name',p.business_name,'legal_business_name',p.legal_business_name,'contact_email',p.contact_email,
      'address_line1',p.address_line1,'address_line2',p.address_line2,'city',p.city,'state',p.state,'postal_code',p.postal_code,'country',p.country,
      'contact_name',p.contact_name,'contact_title',p.contact_title,'commission_amount_minor_units',p.commission_amount_minor_units,'currency','USD',
      'signing_statement','Your signature records acceptance of this exact agreement. Venfour will review and countersign before activating the referral partner account.');
    insert into public.referral_partner_agreements(id,partner_id,template_id,snapshot,agreement_digest,storage_object_path)
     values(agreement_uuid,p.id,t.id,snapshot_value,public.total_loss_canonical_jsonb_digest(snapshot_value),'partners/'||p.id::text||'/agreements/'||agreement_uuid::text||'/signed.pdf');
    update public.referral_partners set current_agreement_id=agreement_uuid,revision=revision+1,updated_at=now_at where id=p.id;
    insert into public.referral_partner_events(partner_id,agreement_id,event_type,actor_user_id) values(p.id,agreement_uuid,'agreement.prepared',actor);
   end if;
  end if;
  response=public.referral_partner_detail_internal(p.id,manager);
 end if;
 insert into public.referral_partner_requests(actor_user_id,request_id,action,payload_digest,response) values(actor,request_uuid,p_action,request_digest,response);
 return response;
end;
$$;

create function public.referral_partner_worker(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 j public.referral_partner_jobs%rowtype; a public.referral_partner_agreements%rowtype; i public.referral_partner_invitations%rowtype;
 lease uuid; expected_kind text; now_at timestamptz=statement_timestamp(); object_row storage.objects%rowtype;
 size_value bigint; digest_value text; provider_value text; error_value text; job_id_value uuid; scope_partner uuid;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16000000 then raise exception using errcode='22023',message='Invalid worker request.'; end if;
 if p_action is null or p_action not in ('lease_document','lease_email','prepare_email','finish_document','fail_document','finish_email','fail_email') then raise exception using errcode='22023',message='Unknown worker operation.'; end if;
 lease=(p_payload->>'lease_token')::uuid;
 if lease is null then raise exception using errcode='22023',message='Lease token required.'; end if;
 expected_kind=case when p_action like '%document' then 'document' else 'email' end;
 if p_action in ('lease_document','lease_email') then
  scope_partner=(p_payload->>'partner_id')::uuid;
  -- Retired invitations and exhausted leases cannot cause indefinite retries.
  update public.referral_partner_jobs x set status='canceled',lease_token=null,lease_expires_at=null
   where (scope_partner is null or x.partner_id=scope_partner) and x.kind='email' and x.invitation_id is not null and x.status in ('queued','failed','processing')
    and not exists(select 1 from public.referral_partner_invitations y where y.id=x.invitation_id and y.status='pending' and y.expires_at>now_at);
  update public.referral_partner_jobs x set status='review',error_code='RETRY_LIMIT_REACHED',lease_token=null,lease_expires_at=null
   where (scope_partner is null or x.partner_id=scope_partner) and x.kind=expected_kind and (x.status in ('queued','failed') or (x.status='processing' and x.lease_expires_at<=now_at))
    and (x.attempts>=5 or (x.kind='email' and x.first_attempt_at is not null and x.first_attempt_at<=now_at-interval '23 hours'));
  update public.referral_partner_agreements x set document_status='failed',updated_at=now_at
   where (scope_partner is null or x.partner_id=scope_partner) and x.document_status in ('queued','processing') and exists(select 1 from public.referral_partner_jobs y where y.id=x.document_job_id and y.status='review');
  select * into j from public.referral_partner_jobs x where (scope_partner is null or x.partner_id=scope_partner) and x.kind=expected_kind and x.available_at<=now_at
   and (x.status in ('queued','failed') or (x.status='processing' and x.lease_expires_at<=now_at)) and x.attempts<5
   and (x.kind<>'document' or exists(select 1 from public.referral_partner_agreements y where y.id=x.agreement_id and y.document_job_id=x.id and y.status='countersigned' and y.document_status<>'ready'))
   order by x.available_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  update public.referral_partner_jobs set status='processing',lease_token=lease,lease_expires_at=now_at+interval '5 minutes',
    first_attempt_at=coalesce(first_attempt_at,now_at),attempts=attempts+1,error_code=null where id=j.id returning * into j;
  if j.kind='document' then update public.referral_partner_agreements set document_status='processing',updated_at=now_at where id=j.agreement_id and document_job_id=j.id; end if;
  return to_jsonb(j);
 end if;
 job_id_value=(p_payload->>'job_id')::uuid;
 select * into j from public.referral_partner_jobs where id=job_id_value for update;
 if not found or j.kind<>expected_kind or j.status<>'processing' or j.lease_token is distinct from lease or j.lease_expires_at<=now_at then raise exception using errcode='40001',message='Worker lease is no longer current.'; end if;
 if j.kind='document' then
  select * into a from public.referral_partner_agreements where id=j.agreement_id for update;
  if not found or a.document_job_id is distinct from j.id or a.status<>'countersigned' or a.document_status='ready' then raise exception using errcode='40001',message='Document job is no longer current.'; end if;
 elsif j.invitation_id is not null then
  select * into i from public.referral_partner_invitations where id=j.invitation_id;
  if not found or i.status<>'pending' or i.expires_at<=now_at then raise exception using errcode='40001',message='Invitation delivery is no longer current.'; end if;
 end if;
 if p_action='prepare_email' then
  provider_value=p_payload->>'provider';
  if provider_value not in ('resend','mailpit') or p_payload->'payload' is null or jsonb_typeof(p_payload->'payload')<>'object' then raise exception using errcode='22023',message='Invalid prepared email.'; end if;
  if j.prepared_payload is null then
   update public.referral_partner_jobs set prepared_provider=provider_value,prepared_payload=p_payload->'payload' where id=j.id returning * into j;
  end if;
  return jsonb_build_object('prepared_provider',j.prepared_provider,'prepared_payload',j.prepared_payload);
 elsif p_action='finish_document' then
  size_value=(p_payload->>'byte_size')::bigint; digest_value=p_payload->>'sha256';
  if size_value is null or size_value not between 1 and 10485760 or digest_value is null or digest_value !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='Invalid document result.'; end if;
  select * into object_row from storage.objects where bucket_id=a.storage_bucket and name=a.storage_object_path for update;
  if not found or object_row.metadata->>'mimetype' is distinct from 'application/pdf'
    or jsonb_typeof(object_row.metadata->'size') is distinct from 'number' or (object_row.metadata->>'size')::bigint<>size_value then
   raise exception using errcode='55000',message='Stored agreement PDF does not match completion metadata.';
  end if;
  update public.referral_partner_agreements set document_status='ready',document_sha256=digest_value,document_byte_size=size_value,document_ready_at=now_at,updated_at=now_at where id=a.id;
  update public.referral_partner_jobs set status='completed',result=jsonb_build_object('sha256',digest_value,'byte_size',size_value),finished_at=now_at,lease_token=null,lease_expires_at=null where id=j.id;
  perform public.referral_partner_enqueue_copy_internal(a.id);
  insert into public.referral_partner_events(partner_id,agreement_id,event_type,metadata) values(a.partner_id,a.id,'document.ready',jsonb_build_object('sha256',digest_value,'byte_size',size_value));
  return jsonb_build_object('status','completed','agreement_id',a.id);
 elsif p_action='finish_email' then
  if j.prepared_payload is null then raise exception using errcode='55000',message='Email must be prepared before completion.'; end if;
  update public.referral_partner_jobs set status='completed',provider_message_id=public.referral_partner_text_internal(p_payload,'provider_message_id',255),finished_at=now_at,lease_token=null,lease_expires_at=null where id=j.id;
  insert into public.referral_partner_events(partner_id,agreement_id,event_type,metadata) values(j.partner_id,j.agreement_id,'email.accepted',jsonb_build_object('job_id',j.id,'kind',j.payload->>'kind'));
  return jsonb_build_object('status','completed');
 else
  error_value=public.referral_partner_text_internal(p_payload,'error_code',80);
  if error_value !~ '^[A-Z][A-Z0-9_]{0,79}$' then raise exception using errcode='22023',message='Invalid error code.'; end if;
  update public.referral_partner_jobs set status=case when p_payload->'requires_review'='true'::jsonb or attempts>=5 then 'review' else 'failed' end,
    error_code=error_value,available_at=now_at+interval '5 minutes',lease_token=null,lease_expires_at=null where id=j.id returning * into j;
  if j.kind='document' then update public.referral_partner_agreements set document_status='failed',updated_at=now_at where id=a.id; end if;
  return jsonb_build_object('status',j.status);
 end if;
end;
$$;

-- Published wording, signed evidence, and finished originals are never overwritten.
create function public.referral_partner_protect_history_internal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name in ('referral_partner_events','referral_partner_requests','referral_partner_signatures') then raise exception using errcode='55000',message='Referral history is immutable.'; end if;
 if tg_table_name='referral_partner_templates' and old.status='published' then raise exception using errcode='55000',message='Published templates are immutable.'; end if;
 if tg_table_name='referral_partner_agreements' then
  if tg_op='DELETE' then raise exception using errcode='55000',message='Agreement history cannot be deleted.'; end if;
  if (new.partner_signature is not null and not exists(select 1 from public.referral_partner_signatures z where z.agreement_id=new.id and z.role='partner' and z.signature=new.partner_signature and z.agreement_digest=new.agreement_digest)) or (new.manager_signature is not null and not exists(select 1 from public.referral_partner_signatures z where z.agreement_id=new.id and z.role='manager' and z.signature=new.manager_signature and z.agreement_digest=new.agreement_digest)) or new.snapshot is distinct from old.snapshot or new.agreement_digest is distinct from old.agreement_digest or new.partner_id<>old.partner_id or new.template_id<>old.template_id
   or new.storage_bucket<>old.storage_bucket or new.storage_object_path<>old.storage_object_path
   or (old.partner_signature is not null and new.partner_signature is distinct from old.partner_signature)
   or (old.manager_signature is not null and new.manager_signature is distinct from old.manager_signature)
   or (old.document_status='ready' and (new.document_status<>'ready' or new.document_sha256 is distinct from old.document_sha256 or new.document_byte_size is distinct from old.document_byte_size or new.document_ready_at is distinct from old.document_ready_at)) then
   raise exception using errcode='55000',message='Agreement evidence is immutable.';
  end if;
 end if;
 if tg_table_name='referral_partner_jobs' then
  if tg_op='DELETE' or new.payload is distinct from old.payload or new.kind<>old.kind or new.partner_id<>old.partner_id
    or new.agreement_id is distinct from old.agreement_id or new.invitation_id is distinct from old.invitation_id
    or (old.prepared_payload is not null and (new.prepared_payload is distinct from old.prepared_payload or new.prepared_provider is distinct from old.prepared_provider))
    or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at) then
   raise exception using errcode='55000',message='Job inputs and prepared deliveries are immutable.';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger referral_partner_signature_history before update or delete on public.referral_partner_signatures for each row execute function public.referral_partner_protect_history_internal();
create trigger referral_partner_template_history before update or delete on public.referral_partner_templates for each row execute function public.referral_partner_protect_history_internal();
create trigger referral_partner_agreement_history before update or delete on public.referral_partner_agreements for each row execute function public.referral_partner_protect_history_internal();
create trigger referral_partner_event_history before update or delete on public.referral_partner_events for each row execute function public.referral_partner_protect_history_internal();
create trigger referral_partner_request_history before update or delete on public.referral_partner_requests for each row execute function public.referral_partner_protect_history_internal();
create trigger referral_partner_job_history before update or delete on public.referral_partner_jobs for each row execute function public.referral_partner_protect_history_internal();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('partner-agreements','partner-agreements',false,10485760,array['application/pdf']);
create function public.referral_partner_protect_document_internal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id='partner-agreements' and exists(select 1 from public.referral_partner_agreements a
  where a.storage_object_path=old.name and a.storage_bucket=old.bucket_id and a.document_status='ready') then
  raise exception using errcode='55000',message='Sealed agreement documents are immutable.';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger referral_partner_document_history before update or delete on storage.objects for each row execute function public.referral_partner_protect_document_internal();

revoke all on function public.referral_partner_is_manager_internal(uuid),public.referral_partner_detail_internal(uuid,boolean),
 public.referral_partner_text_internal(jsonb,text,integer,boolean),public.referral_partner_enqueue_document_internal(uuid),
 public.referral_partner_enqueue_copy_internal(uuid),public.referral_partner_protect_history_internal(),public.referral_partner_protect_document_internal(),
 public.referral_partner_operation(text,jsonb),public.referral_partner_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.referral_partner_operation(text,jsonb) to authenticated;
grant execute on function public.referral_partner_worker(text,jsonb) to service_role;

-- Scheduling stays inert until an operator configures both partner-specific Vault entries.
create function public.dispatch_referral_partner_jobs()
returns bigint language plpgsql security definer set search_path='' as $$
declare api_origin text; dispatch_secret text; request_id bigint;
begin
 select decrypted_secret into api_origin from vault.decrypted_secrets where name='venfour_referral_partner_api_origin';
 select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name='venfour_referral_partner_dispatch_secret';
 if api_origin is null or dispatch_secret is null or api_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
  or char_length(dispatch_secret) not between 32 and 512 or dispatch_secret ~ '[[:space:][:cntrl:]]' then return null; end if;
 if not exists(select 1 from public.referral_partner_jobs j where j.available_at<=statement_timestamp()
  and (j.status in ('queued','failed') or (j.status='processing' and j.lease_expires_at<=statement_timestamp()))) then return null; end if;
 select net.http_post(url:=api_origin||'/internal/v1/referral-partners/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||dispatch_secret),
  body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end;
$$;
revoke all on function public.dispatch_referral_partner_jobs() from public,anon,authenticated,service_role;
select cron.schedule('venfour-referral-partner-delivery','* * * * *','select public.dispatch_referral_partner_jobs();');
