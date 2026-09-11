-- Keep report preparation separate from the sealed free-estimate input.
create table public.total_loss_full_review_reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  source_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  source_input_id uuid,
  storage_owner_id uuid not null,
  storage_bucket text not null default 'case-files' check (storage_bucket = 'case-files'),
  storage_object_name text not null,
  original_filename text not null check (length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]]'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  status text not null default 'uploading' check (status in ('uploading','uploaded','extracting','needs_confirmation','ready','report_invalid','extraction_failed')),
  extraction jsonb,
  extracted_at timestamptz,
  readiness jsonb,
  processing_token uuid,
  processing_expires_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(id, case_id),
  unique(storage_bucket, storage_object_name),
  check (storage_object_name = storage_owner_id::text || '/' || case_id::text || '/review-reports/' || id::text || '.pdf'),
  check (status not in ('ready','needs_confirmation') or coalesce((
    extraction is not null and jsonb_typeof(extraction) = 'object'
    and extraction->>'documentSha256' = document_sha256
    and readiness->>'stage' = 'full_review'
  ),false)),
  check (status <> 'ready' or coalesce((readiness->'ready' = 'true'::jsonb and readiness->'issues' = '[]'::jsonb),false))
);
create index total_loss_full_review_reports_case_latest_idx on public.total_loss_full_review_reports(case_id, created_at desc, id desc);
alter table public.total_loss_full_review_reports enable row level security;
revoke all on public.total_loss_full_review_reports from public, anon, authenticated;
grant select on public.total_loss_full_review_reports to service_role;

create function public.full_review_report_guard_internal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if row(new.id,new.case_id,new.source_run_id,new.source_input_id,new.storage_owner_id,new.storage_bucket,
         new.storage_object_name,new.original_filename,new.document_sha256,new.byte_size,new.created_at)
     is distinct from row(old.id,old.case_id,old.source_run_id,old.source_input_id,old.storage_owner_id,old.storage_bucket,
         old.storage_object_name,old.original_filename,old.document_sha256,old.byte_size,old.created_at)
     or (old.extraction is not null and (new.extraction is distinct from old.extraction or new.extracted_at is distinct from old.extracted_at)) then
    raise exception 'FULL_REVIEW_SOURCE_IMMUTABLE';
  end if;
  if exists(select 1 from public.total_loss_checkout_review_reports b where b.report_id=old.id) then
    raise exception 'FULL_REVIEW_REPORT_SEALED';
  end if;
  new.revision := old.revision+1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create table public.total_loss_checkout_review_reports (
  order_id uuid primary key references public.commerce_orders(id),
  case_id uuid not null references public.appraisal_cases(id),
  report_id uuid not null,
  report_revision bigint not null,
  readiness_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(report_id,case_id) references public.total_loss_full_review_reports(id,case_id)
);
alter table public.total_loss_checkout_review_reports enable row level security;
revoke all on public.total_loss_checkout_review_reports from public,anon,authenticated;
grant select on public.total_loss_checkout_review_reports to service_role;
create trigger full_review_report_guard before update on public.total_loss_full_review_reports
  for each row execute function public.full_review_report_guard_internal();

create function public.get_total_loss_full_review_context(requested_case_id uuid, requested_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('case_id',c.id,'user_id',c.user_id,'input',public.build_total_loss_analysis_input_snapshot(d),
    'source_run_id',j.run_id,'source_input_id',j.source_analysis_input_id,'artifact',a.artifact,
    'report', (select to_jsonb(r) from public.total_loss_full_review_reports r
      where r.case_id=c.id and r.source_run_id=j.run_id order by r.created_at desc,r.id desc limit 1),
    'existing_report',case when d.intake_mode='report' then jsonb_build_object(
      'storage_bucket','case-files','storage_object_name',d.report_storage_owner_id::text || '/' || c.id::text || '/valuation-report.pdf',
      'storage_owner_id',d.report_storage_owner_id,'original_filename',d.report_original_filename,
      'extraction',(select e.normalized_report from public.total_loss_report_extractions e
        where e.case_id=c.id and e.report_upload_id=d.report_last_upload_id
        and e.analysis_input_revision=d.analysis_input_revision limit 1)) else null end,
    'locked',exists(select 1 from public.commerce_orders o where o.case_id=c.id and o.status <> 'void'))
  from public.appraisal_cases c join public.total_loss_case_details d on d.case_id=c.id
  join public.total_loss_analysis_jobs j on j.case_id=c.id and j.status='completed'
    and j.source_analysis_input_revision=d.analysis_input_revision and j.source_analysis_input_id is not distinct from d.analysis_input_id
  join public.analysis_runs a on a.id=j.run_id
  where c.id=requested_case_id and c.user_id=requested_user_id and c.service_type='total_loss'
  order by j.created_at desc limit 1;
$$;

create function public.begin_total_loss_full_review_report(requested_case_id uuid, requested_user_id uuid,
  requested_report_id uuid, requested_filename text, requested_sha256 text, requested_byte_size bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; r public.total_loss_full_review_reports;
begin
  perform 1 from public.appraisal_cases where id=requested_case_id and user_id=requested_user_id for update;
  ctx := public.get_total_loss_full_review_context(requested_case_id,requested_user_id);
  if ctx is null then raise exception 'FULL_REVIEW_NOT_FOUND'; end if;
  if (ctx->>'locked')::boolean then raise exception 'FULL_REVIEW_LOCKED'; end if;
  if exists(select 1 from public.total_loss_full_review_reports where case_id=requested_case_id
      and status='extracting' and processing_expires_at>clock_timestamp()) then raise exception 'FULL_REVIEW_BUSY'; end if;
  insert into public.total_loss_full_review_reports(id,case_id,source_run_id,source_input_id,storage_owner_id,
    storage_object_name,original_filename,document_sha256,byte_size)
  values(requested_report_id,requested_case_id,(ctx->>'source_run_id')::uuid,(ctx->>'source_input_id')::uuid,requested_user_id,
    requested_user_id::text || '/' || requested_case_id::text || '/review-reports/' || requested_report_id::text || '.pdf',
    requested_filename,requested_sha256,requested_byte_size) returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.transition_total_loss_full_review_report(requested_case_id uuid, requested_user_id uuid,
  requested_report_id uuid, expected_revision bigint, requested_status text, requested_token uuid,
  requested_extraction jsonb, requested_readiness jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; r public.total_loss_full_review_reports;
begin
  perform 1 from public.appraisal_cases where id=requested_case_id and user_id=requested_user_id for update;
  ctx := public.get_total_loss_full_review_context(requested_case_id,requested_user_id);
  if ctx is null then raise exception 'FULL_REVIEW_NOT_FOUND'; end if;
  if (ctx->>'locked')::boolean then raise exception 'FULL_REVIEW_LOCKED'; end if;
  if ctx->'report'->>'id' is distinct from requested_report_id::text then raise exception 'FULL_REVIEW_STALE'; end if;
  select * into strict r from public.total_loss_full_review_reports where id=requested_report_id for update;
  if r.revision<>expected_revision then raise exception 'FULL_REVIEW_STALE'; end if;
  if requested_status='uploaded' and r.status<>'uploading'
     or requested_status='extracting' and (r.status not in ('uploaded','extraction_failed','extracting')
         or r.status='extracting' and r.processing_expires_at>clock_timestamp())
     or requested_status in ('ready','needs_confirmation','report_invalid','extraction_failed')
        and (r.status not in ('extracting','needs_confirmation')
            or r.status='extracting' and (r.processing_token is distinct from requested_token or r.processing_expires_at<=clock_timestamp()))
     or requested_status not in ('uploaded','extracting','ready','needs_confirmation','report_invalid','extraction_failed') then
    raise exception 'FULL_REVIEW_TRANSITION_INVALID';
  end if;
  if requested_status='extracting' and requested_token is null then raise exception 'FULL_REVIEW_TOKEN_REQUIRED'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=r.storage_bucket and o.name=r.storage_object_name
     and (o.metadata->>'size')::bigint=r.byte_size) then raise exception 'FULL_REVIEW_FILE_REQUIRED'; end if;
  update public.total_loss_full_review_reports set status=requested_status,
    extraction=coalesce(requested_extraction,extraction),readiness=coalesce(requested_readiness,readiness),
    extracted_at=case when extraction is null and requested_extraction is not null then clock_timestamp() else extracted_at end,
    processing_token=case when requested_status='extracting' then requested_token else null end,
    processing_expires_at=case when requested_status='extracting' then clock_timestamp()+interval '10 minutes' else null end
  where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.total_loss_full_review_ready(requested_case_id uuid, requested_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((ctx->'report'->>'status'='ready'
    and ctx->'report'->'readiness'->'ready'='true'::jsonb
    and exists(select 1 from storage.objects o where o.bucket_id=ctx->'report'->>'storage_bucket'
      and o.name=ctx->'report'->>'storage_object_name'
      and (o.metadata->>'size')::bigint=(ctx->'report'->>'byte_size')::bigint)),false)
  from (select public.get_total_loss_full_review_context(requested_case_id,requested_user_id) ctx) s;
$$;

alter function public.authorize_total_loss_checkout_preflight(uuid,uuid) rename to authorize_total_loss_checkout_before_report_internal;
create function public.authorize_total_loss_checkout_preflight(requested_case_id uuid,requested_purchaser_user_id uuid)
returns setof public.total_loss_checkout_preflight_result language plpgsql stable security definer set search_path='' as $$
declare r public.total_loss_checkout_preflight_result;
begin
  for r in select * from public.authorize_total_loss_checkout_before_report_internal($1,$2) loop
    r.checkout_available := r.checkout_available and (r.has_pending_order or public.total_loss_full_review_ready($1,$2));
    return next r;
  end loop;
end;
$$;
alter function public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)
  rename to reserve_total_loss_checkout_before_report_internal;
create function public.reserve_total_loss_checkout(requested_case_id uuid,requested_purchaser_user_id uuid,requested_client_request_id uuid,
 configured_product_identifier text,configured_product_version text,configured_external_price_identifier text,
 configured_amount_minor_units bigint,configured_currency text,configured_terms_version text,
 configured_refund_policy_version text,configured_provider_livemode boolean)
returns setof public.total_loss_checkout_reservation_result language plpgsql security definer set search_path='' as $$
declare r public.total_loss_checkout_reservation_result; ctx jsonb; existing_order boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_case_identity_transition'), pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.appraisal_cases where id=requested_case_id and user_id=requested_purchaser_user_id for update;
  select exists(select 1 from public.commerce_orders where case_id=requested_case_id and status<>'void') into existing_order;
  if not existing_order and not public.total_loss_full_review_ready($1,$2) then raise exception 'FULL_REVIEW_REPORT_REQUIRED'; end if;
  select * into strict r from public.reserve_total_loss_checkout_before_report_internal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
  if r.state='reserved' and not existing_order then
    ctx := public.get_total_loss_full_review_context($1,$2);
    insert into public.total_loss_checkout_review_reports(order_id,case_id,report_id,report_revision,readiness_snapshot)
      values(r.order_id,r.case_id,(ctx->'report'->>'id')::uuid,(ctx->'report'->>'revision')::bigint,ctx->'report'->'readiness');
  end if;
  return next r;
end;
$$;

revoke all on function public.full_review_report_guard_internal() from public,anon,authenticated,service_role;
revoke all on function public.authorize_total_loss_checkout_before_report_internal(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reserve_total_loss_checkout_before_report_internal(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean) from public,anon,authenticated,service_role;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('get_total_loss_full_review_context','begin_total_loss_full_review_report','transition_total_loss_full_review_report','total_loss_full_review_ready',
     'authorize_total_loss_checkout_preflight','reserve_total_loss_checkout') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

-- Existing namespace update permissions must not permit replacing review evidence.
create policy "Full review report inserts are server owned" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'case-files' or name !~ '^[^/]+/[^/]+/review-reports/');
create policy "Full review report updates are server owned" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'case-files' or name !~ '^[^/]+/[^/]+/review-reports/')
  with check (bucket_id <> 'case-files' or name !~ '^[^/]+/[^/]+/review-reports/');
create policy "Full review report deletes are server owned" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'case-files' or name !~ '^[^/]+/[^/]+/review-reports/');

create function public.full_review_checkout_binding_guard_internal() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'FULL_REVIEW_CHECKOUT_BINDING_IMMUTABLE'; end $$;
create trigger full_review_checkout_binding_guard before update or delete on public.total_loss_checkout_review_reports
  for each row execute function public.full_review_checkout_binding_guard_internal();
revoke all on function public.full_review_checkout_binding_guard_internal() from public,anon,authenticated,service_role;

create function public.authorize_full_review_report_upload(object_name text, object_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.total_loss_full_review_reports r join public.appraisal_cases c on c.id=r.case_id
    where r.storage_object_name=object_name and r.storage_owner_id=(select auth.uid()) and c.user_id=(select auth.uid())
      and r.status='uploading' and r.created_at>statement_timestamp()-interval '1 hour'
      and object_metadata->>'mimetype'='application/pdf'
      and object_metadata->>'size'=r.byte_size::text
      and not exists(select 1 from public.commerce_orders o where o.case_id=r.case_id and o.status<>'void'));
$$;
revoke all on function public.authorize_full_review_report_upload(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.authorize_full_review_report_upload(text,jsonb) to authenticated;
drop policy "Full review report inserts are server owned" on storage.objects;
create policy "Full review report inserts require a prepared upload" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'case-files' or name !~ '^[^/]+/[^/]+/review-reports/' or public.authorize_full_review_report_upload(name,metadata));
create policy "Owners can upload prepared full review reports" on storage.objects for insert to authenticated
  with check (bucket_id='case-files' and public.authorize_full_review_report_upload(name,metadata));

create function public.get_total_loss_package_review_report(requested_work_item_id uuid, requested_processing_token uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('report',to_jsonb(r),'readiness',b.readiness_snapshot)
  from public.workflow_work_items w join public.total_loss_package_jobs p on p.id=w.package_job_id and p.case_id=w.case_id
  join public.case_entitlements e on e.id=p.entitlement_id and e.case_id=p.case_id
  join public.total_loss_checkout_review_reports b on b.order_id=e.order_id and b.case_id=p.case_id
  join public.total_loss_full_review_reports r on r.id=b.report_id and r.case_id=b.case_id and r.revision=b.report_revision
  where w.id=requested_work_item_id and w.status='processing' and w.processing_token=requested_processing_token
    and w.processing_expires_at>statement_timestamp() and p.processing_token=requested_processing_token
    and p.processing_expires_at>statement_timestamp() and p.status in ('processing','source_frozen')
    and e.status in ('active','refunded_access_retained') and r.status='ready';
$$;
revoke all on function public.get_total_loss_package_review_report(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_total_loss_package_review_report(uuid,uuid) to service_role;

-- New purchases freeze the accepted report alongside the original free source.
-- Legacy paid orders retain their existing immutable source and recovery path.
create function public.full_review_package_source_guard_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare binding public.total_loss_checkout_review_reports; report public.total_loss_full_review_reports; review jsonb;
begin
  select b.* into binding from public.total_loss_checkout_review_reports b
    join public.case_entitlements e on e.order_id=b.order_id and e.case_id=b.case_id
    where e.id=new.entitlement_id and b.case_id=new.case_id;
  review := new.source_snapshot->'fullReview';
  if not found then
    if new.snapshot_schema_version='2' or review is not null then raise exception 'FULL_REVIEW_BINDING_REQUIRED'; end if;
    return new;
  end if;
  select r.* into strict report from public.total_loss_full_review_reports r where r.id=binding.report_id;
  if new.snapshot_schema_version<>'2' or new.source_snapshot->>'schemaVersion' is distinct from '2'
    or review->>'reportId' is distinct from report.id::text
    or review->>'reportRevision' is distinct from binding.report_revision::text
    or report.revision<>binding.report_revision or report.status<>'ready'
    or report.source_run_id<>new.analysis_run_id
    or review->'readiness' is distinct from binding.readiness_snapshot
    or review#>'{extraction,normalizedReport}' is distinct from report.extraction->'normalizedReport'
    or review#>>'{extraction,documentSha256}' is distinct from report.document_sha256
    or review#>>'{sourceDocument,sha256}' is distinct from report.document_sha256
    or review#>>'{sourceDocument,byteSize}' is distinct from report.byte_size::text
    or review#>>'{sourceDocument,uploadId}' is distinct from report.id::text
    or review#>>'{sourceDocument,bucket}' is distinct from report.storage_bucket
    or review#>>'{sourceDocument,objectPath}' is distinct from report.storage_object_name
    or review#>>'{sourceDocument,storageOwnerId}' is distinct from report.storage_owner_id::text
    or review->>'newProviderRequests' is distinct from '0'
    or not exists(select 1 from storage.objects o where o.bucket_id=report.storage_bucket
      and o.name=report.storage_object_name and o.metadata->>'size'=report.byte_size::text) then
    raise exception 'FULL_REVIEW_SOURCE_BINDING_INVALID';
  end if;
  return new;
end $$;
create trigger full_review_package_source_guard before insert on public.total_loss_source_snapshots
  for each row execute function public.full_review_package_source_guard_internal();

create function public.full_review_final_assessment_guard_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare source jsonb; review jsonb;
begin
  select s.source_snapshot into source from public.total_loss_source_snapshots s
    where s.id=new.source_snapshot_id and s.case_id=new.case_id and s.package_job_id=new.package_job_id;
  if source is null and exists(select 1 from public.total_loss_package_jobs p
      join public.case_entitlements e on e.id=p.entitlement_id
      join public.total_loss_checkout_review_reports b on b.order_id=e.order_id
      where p.id=new.package_job_id) then raise exception 'FULL_REVIEW_SOURCE_REQUIRED'; end if;
  review := source->'fullReview';
  if review is not null then
    if new.schema_version<>'2' or new.assessment->>'schemaVersion' is distinct from '2'
      or new.assessment->>'reviewAnalysisArtifactDigest' is distinct from review#>>'{analysis,artifactDigest}'
      or new.assessment->>'reviewRunId' is distinct from review#>>'{analysis,artifact,runId}' then
      raise exception 'FULL_REVIEW_ASSESSMENT_BINDING_INVALID';
    end if;
  elsif new.schema_version='2' then raise exception 'FULL_REVIEW_BINDING_REQUIRED';
  end if;
  return new;
end $$;
create trigger full_review_final_assessment_guard before insert on public.total_loss_final_assessments
  for each row execute function public.full_review_final_assessment_guard_internal();
revoke all on function public.full_review_package_source_guard_internal() from public,anon,authenticated,service_role;
revoke all on function public.full_review_final_assessment_guard_internal() from public,anon,authenticated,service_role;
