grant insert (report_storage_owner_id)
on table public.total_loss_case_details
to authenticated;

comment on column public.total_loss_case_details.report_storage_owner_id is
  'Immutable UUID namespace snapshot accepted in the browser insert shape, validated and normalized to the owned parent by protect_total_loss_storage_owner(), and never client-updatable.';
