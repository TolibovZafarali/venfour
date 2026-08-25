alter table public.total_loss_case_details
add column report_upload_recovery_required boolean
generated always as (
  report_upload_has_backup
  and report_upload_phase in ('ready', 'recovering')
) stored not null;

comment on column public.total_loss_case_details.report_upload_recovery_required is
  'Owner-visible recovery gate derived from private report-upload coordination state without exposing the backup or phase fields.';

grant select (report_upload_recovery_required)
on public.total_loss_case_details to authenticated;
