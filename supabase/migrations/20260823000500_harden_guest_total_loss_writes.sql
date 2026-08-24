-- Keep guest Total-Loss creation behind its idempotent SECURITY DEFINER RPC
-- and limit customer Storage mutations to the two token-fenced report objects.

drop policy if exists "Customers can create their own cases"
on public.appraisal_cases;

create policy "Customers can create their own cases"
on public.appraisal_cases
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and service_type = 'diminished_value'
  and not (select public.current_auth_user_is_anonymous())
);

comment on policy "Customers can create their own cases"
on public.appraisal_cases is
  'Permanent authenticated users can create owned Diminished Value drafts. Total-Loss drafts are created only through the locked get_or_create_total_loss_draft RPC.';

drop policy if exists "Customers can add files for their own cases"
on storage.objects;
drop policy if exists "Customers can update files for their own cases"
on storage.objects;
drop policy if exists "Customers can delete files for their own cases"
on storage.objects;

create policy "Customers can add files for their own cases"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
      and public.authorize_total_loss_report_storage_write(name, user_metadata)
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
      and jsonb_typeof(user_metadata) = 'object'
      and char_length(user_metadata ->> 'originalName') between 1 and 255
      and user_metadata ->> 'originalName' = regexp_replace(
        btrim(user_metadata ->> 'originalName'),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and user_metadata ->> 'originalName' ~* '\.(pdf|jpe?g|png|heic|heif)$'
      and (
        (
          storage.filename(name) ~ '\.pdf$'
          and user_metadata ->> 'originalName' ~* '\.pdf$'
        )
        or (
          storage.filename(name) ~ '\.jpg$'
          and user_metadata ->> 'originalName' ~* '\.jpe?g$'
        )
        or (
          storage.filename(name) ~ '\.png$'
          and user_metadata ->> 'originalName' ~* '\.png$'
        )
        or (
          storage.filename(name) ~ '\.heic$'
          and user_metadata ->> 'originalName' ~* '\.heic$'
        )
        or (
          storage.filename(name) ~ '\.heif$'
          and user_metadata ->> 'originalName' ~* '\.heif$'
        )
      )
      and position('/' in user_metadata ->> 'originalName') = 0
      and position(chr(92) in user_metadata ->> 'originalName') = 0
      and user_metadata ->> 'originalName' !~ '[[:cntrl:]]'
      and user_metadata ->> 'originalName' !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  )
);

comment on policy "Customers can add files for their own cases"
on storage.objects is
  'Total-Loss inserts are restricted to exact token-fenced canonical or backup report objects; Diminished Value retains its exact draft-path and safe-metadata rules.';

create policy "Customers can update files for their own cases"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'case-files'
  and public.authorize_total_loss_storage_namespace(name)
  and cardinality(storage.foldername(name)) = 2
  and storage.filename(name) in (
    'valuation-report.pdf',
    'valuation-report-backup.pdf'
  )
  and storage.allow_only_operation('storage.object.upload_update')
)
with check (
  bucket_id = 'case-files'
  and public.authorize_total_loss_storage_namespace(name)
  and cardinality(storage.foldername(name)) = 2
  and storage.filename(name) in (
    'valuation-report.pdf',
    'valuation-report-backup.pdf'
  )
  and storage.allow_only_operation('storage.object.upload_update')
  and public.authorize_total_loss_report_storage_write(name, user_metadata)
);

comment on policy "Customers can update files for their own cases"
on storage.objects is
  'Total-Loss updates remain exact-operation and upload-token fenced for canonical or backup report objects; Diminished Value updates remain denied.';

create policy "Customers can delete files for their own cases"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and cardinality(storage.foldername(name)) = 2
      and storage.filename(name) = 'valuation-report-backup.pdf'
      and public.authorize_total_loss_report_backup_delete(
        name,
        user_metadata
      )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
    )
  )
);

comment on policy "Customers can delete files for their own cases"
on storage.objects is
  'Total-Loss deletion remains limited to an exact token-fenced backup report; Diminished Value retains exact owned draft-document deletion.';
