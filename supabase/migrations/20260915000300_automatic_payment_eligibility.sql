-- Qualifying cases may continue to payment after the automated report checks.
-- Keep historical decisions and all existing evidence and checkout checks.
alter table public.total_loss_payment_approval_settings
  alter column manual_approval_required set default false;

insert into public.total_loss_payment_approval_settings(singleton, manual_approval_required)
values (true, false)
on conflict (singleton) do update set manual_approval_required = false;

notify pgrst, 'reload schema';
