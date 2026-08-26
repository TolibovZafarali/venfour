create type public.total_loss_claim_phase as enum (
  'review',
  'initial_request',
  'negotiation',
  'resolution'
);

create type public.commerce_order_status as enum (
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'disputed',
  'void'
);

create type public.case_entitlement_status as enum (
  'active',
  'refunded_access_retained',
  'suspended',
  'revoked'
);

create type public.total_loss_communication_direction as enum (
  'inbound',
  'outbound'
);

create type public.total_loss_communication_channel as enum (
  'email',
  'uploaded_document',
  'pasted_message',
  'phone'
);

comment on type public.total_loss_claim_phase is
  'Stable customer-facing phases for the paid total-loss claim workflow.';
comment on type public.commerce_order_status is
  'Provider-neutral lifecycle of a one-time commerce order.';
comment on type public.case_entitlement_status is
  'Access state kept separate from payment and appraisal-case state.';
comment on type public.total_loss_communication_direction is
  'Whether a preserved claim communication was received or sent by the customer.';
comment on type public.total_loss_communication_channel is
  'Supported source channels for preserved claim communications.';

create function public.is_permanent_total_loss_case_owner(requested_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and not public.current_auth_user_is_anonymous()
    and exists (
      select 1
      from public.appraisal_cases as appraisal_case
      where appraisal_case.id = $1
        and appraisal_case.user_id = (select auth.uid())
        and appraisal_case.service_type = 'total_loss'
    );
$$;

comment on function public.is_permanent_total_loss_case_owner(uuid) is
  'Checks current Total-Loss case ownership while denying anonymous Auth identities.';

revoke execute on function public.is_permanent_total_loss_case_owner(uuid) from public;
revoke execute on function public.is_permanent_total_loss_case_owner(uuid) from anon;
grant execute on function public.is_permanent_total_loss_case_owner(uuid) to authenticated;
revoke execute on function public.is_permanent_total_loss_case_owner(uuid) from service_role;

create function public.reject_total_loss_immutable_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I records are immutable.', tg_table_name);
end;
$$;

comment on function public.reject_total_loss_immutable_record() is
  'Trigger-only guard for immutable paid-workflow evidence and audit rows.';

revoke execute on function public.reject_total_loss_immutable_record() from public;
revoke execute on function public.reject_total_loss_immutable_record() from anon;
revoke execute on function public.reject_total_loss_immutable_record() from authenticated;
revoke execute on function public.reject_total_loss_immutable_record() from service_role;

create function public.protect_total_loss_terminal_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(old) ->> 'status') = any (tg_argv) then
    raise exception using
      errcode = '55000',
      message = format('Terminal %I records are immutable.', tg_table_name);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.protect_total_loss_terminal_record() is
  'Trigger-only guard that freezes rows after a table-specific terminal status.';

revoke execute on function public.protect_total_loss_terminal_record() from public;
revoke execute on function public.protect_total_loss_terminal_record() from anon;
revoke execute on function public.protect_total_loss_terminal_record() from authenticated;
revoke execute on function public.protect_total_loss_terminal_record() from service_role;

create table public.total_loss_preliminary_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  analysis_job_id uuid not null,
  analysis_run_id uuid not null references public.analysis_runs (id) on delete restrict,
  owner_user_id_at_snapshot uuid not null,
  source_intake_mode public.total_loss_intake_mode not null,
  source_report_upload_id uuid,
  source_analysis_input_revision bigint not null,
  source_analysis_input_id uuid,
  preliminary_classification text not null,
  insurer_valuation_minor_units bigint,
  supported_range_low_minor_units bigint,
  supported_range_median_minor_units bigint,
  supported_range_high_minor_units bigint,
  currency text not null,
  analysis_run_schema_version text not null,
  analysis_version text not null,
  discrepancy_analysis_version text not null,
  comparable_scoring_version text not null,
  presentation_schema_version text not null,
  snapshot_schema_version text not null,
  source_references jsonb not null,
  snapshot jsonb not null,
  snapshot_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_preliminary_snapshots_id_case_key
    unique (id, case_id),
  constraint total_loss_preliminary_snapshots_case_run_key
    unique (case_id, analysis_run_id),
  constraint total_loss_preliminary_snapshots_run_identity_fkey
    foreign key (analysis_run_id, analysis_job_id, case_id)
    references public.total_loss_analysis_jobs (run_id, id, case_id)
    on delete restrict,
  constraint total_loss_preliminary_snapshots_source_complete
    check (
      (source_intake_mode = 'report' and source_report_upload_id is not null)
      or (source_intake_mode = 'manual' and source_report_upload_id is null)
    ),
  constraint total_loss_preliminary_snapshots_revision_positive
    check (source_analysis_input_revision >= 1),
  constraint total_loss_preliminary_snapshots_classification_safe
    check (preliminary_classification ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint total_loss_preliminary_snapshots_insurer_value_positive
    check (
      insurer_valuation_minor_units is null
      or insurer_valuation_minor_units > 0
    ),
  constraint total_loss_preliminary_snapshots_range_complete
    check (
      (
        supported_range_low_minor_units is null
        and supported_range_median_minor_units is null
        and supported_range_high_minor_units is null
      )
      or (
        supported_range_low_minor_units > 0
        and supported_range_median_minor_units >= supported_range_low_minor_units
        and supported_range_high_minor_units >= supported_range_median_minor_units
      )
    ),
  constraint total_loss_preliminary_snapshots_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint total_loss_preliminary_snapshots_versions_safe
    check (
      analysis_run_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and analysis_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and discrepancy_analysis_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and comparable_scoring_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and presentation_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and snapshot_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_preliminary_snapshots_references_object
    check (
      jsonb_typeof(source_references) = 'object'
      and pg_column_size(source_references) <= 65536
    ),
  constraint total_loss_preliminary_snapshots_snapshot_object
    check (
      jsonb_typeof(snapshot) = 'object'
      and pg_column_size(snapshot) <= 1048576
    ),
  constraint total_loss_preliminary_snapshots_digest_valid
    check (snapshot_digest ~ '^[0-9a-f]{64}$')
);

comment on table public.total_loss_preliminary_snapshots is
  'Immutable freeze of the exact preliminary analysis and presentation selected for continuation.';
comment on column public.total_loss_preliminary_snapshots.owner_user_id_at_snapshot is
  'Historical owner value only; current case ownership remains the authorization source.';
comment on column public.total_loss_preliminary_snapshots.snapshot is
  'Bounded immutable customer-result projection, not a replacement for the authoritative analysis artifact.';

create index total_loss_preliminary_snapshots_case_created_idx
  on public.total_loss_preliminary_snapshots (case_id, created_at desc);

create function public.validate_total_loss_preliminary_snapshot_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.id = new.analysis_job_id
      and analysis_job.run_id = new.analysis_run_id
      and analysis_job.case_id = new.case_id
  ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.id = new.analysis_job_id
      and analysis_job.run_id = new.analysis_run_id
      and analysis_job.case_id = new.case_id
      and analysis_job.source_intake_mode = new.source_intake_mode
      and analysis_job.source_report_upload_id is not distinct from
        new.source_report_upload_id
      and analysis_job.source_analysis_input_revision =
        new.source_analysis_input_revision
      and analysis_job.source_analysis_input_id is not distinct from
        new.source_analysis_input_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Preliminary snapshot source identity must match its analysis job.';
  end if;

  return new;
end;
$$;

comment on function public.validate_total_loss_preliminary_snapshot_source() is
  'Trigger-only guard that binds frozen source fields to the referenced analysis job, including nullable identities.';

revoke execute on function public.validate_total_loss_preliminary_snapshot_source() from public;
revoke execute on function public.validate_total_loss_preliminary_snapshot_source() from anon;
revoke execute on function public.validate_total_loss_preliminary_snapshot_source() from authenticated;
revoke execute on function public.validate_total_loss_preliminary_snapshot_source() from service_role;

create trigger total_loss_preliminary_snapshots_validate_source
before insert on public.total_loss_preliminary_snapshots
for each row execute function public.validate_total_loss_preliminary_snapshot_source();

create trigger total_loss_preliminary_snapshots_reject_mutation
before update or delete on public.total_loss_preliminary_snapshots
for each row execute function public.reject_total_loss_immutable_record();

create table public.total_loss_claim_workflows (
  case_id uuid primary key references public.appraisal_cases (id) on delete restrict,
  preliminary_snapshot_id uuid not null unique,
  phase public.total_loss_claim_phase not null default 'review',
  current_task text not null,
  revision bigint not null default 1,
  resolution_code text,
  resolved_at timestamptz,
  current_package_job_id uuid,
  current_report_version_id uuid,
  current_negotiation_round_id uuid,
  current_offer_id uuid,
  current_recommendation_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_claim_workflows_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint total_loss_claim_workflows_task_safe
    check (current_task ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint total_loss_claim_workflows_revision_positive
    check (revision >= 1),
  constraint total_loss_claim_workflows_resolution_code_safe
    check (
      resolution_code is null
      or resolution_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_claim_workflows_resolution_complete
    check ((resolution_code is null) = (resolved_at is null))
);

comment on table public.total_loss_claim_workflows is
  'Dedicated post-Continue workflow authority kept separate from appraisal_cases.status.';
comment on column public.total_loss_claim_workflows.current_task is
  'Evolvable machine task code; later trusted mutations advance it using revision fencing.';

create index total_loss_claim_workflows_phase_task_idx
  on public.total_loss_claim_workflows (phase, current_task, updated_at);

create trigger total_loss_claim_workflows_set_updated_at
before update on public.total_loss_claim_workflows
for each row execute function public.set_updated_at();

create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  purchaser_user_id uuid not null references auth.users (id) on delete restrict,
  preliminary_snapshot_id uuid not null,
  product_identifier text not null,
  product_version text not null,
  amount_minor_units bigint not null,
  currency text not null,
  payment_provider text,
  external_price_identifier text,
  status public.commerce_order_status not null default 'pending',
  terms_version text not null,
  refund_policy_version text not null,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint commerce_orders_id_case_key
    unique (id, case_id),
  constraint commerce_orders_id_case_amount_key
    unique (id, case_id, amount_minor_units, currency),
  constraint commerce_orders_id_case_currency_key
    unique (id, case_id, currency),
  constraint commerce_orders_entitlement_identity_key
    unique (
      id,
      case_id,
      preliminary_snapshot_id,
      product_identifier,
      product_version
    ),
  constraint commerce_orders_logical_order_key
    unique (
      case_id,
      product_identifier,
      product_version,
      preliminary_snapshot_id
    ),
  constraint commerce_orders_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint commerce_orders_product_safe
    check (
      product_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
      and product_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint commerce_orders_amount_positive
    check (amount_minor_units > 0),
  constraint commerce_orders_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint commerce_orders_provider_fields_safe
    check (
      (payment_provider is null) = (external_price_identifier is null)
      and (
        payment_provider is null
        or (
          payment_provider ~ '^[a-z][a-z0-9_-]{0,31}$'
          and char_length(external_price_identifier) between 1 and 255
        )
      )
    ),
  constraint commerce_orders_policy_versions_safe
    check (
      terms_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and refund_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint commerce_orders_state_complete
    check (
      (status = 'pending' and paid_at is null and refunded_at is null)
      or (status = 'paid' and paid_at is not null and refunded_at is null)
      or (
        status in ('partially_refunded', 'disputed')
        and paid_at is not null
        and refunded_at is null
      )
      or (status = 'refunded' and paid_at is not null and refunded_at is not null)
      or (status = 'void' and paid_at is null and refunded_at is null)
    )
);

comment on table public.commerce_orders is
  'Provider-neutral commercial intent; provider identifiers stay server-only.';

create index commerce_orders_case_status_created_idx
  on public.commerce_orders (case_id, status, created_at desc);
create index commerce_orders_purchaser_created_idx
  on public.commerce_orders (purchaser_user_id, created_at desc);

create trigger commerce_orders_set_updated_at
before update on public.commerce_orders
for each row execute function public.set_updated_at();

create table public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  order_id uuid not null,
  client_request_id uuid not null,
  payment_provider text not null,
  external_checkout_session_id text,
  external_payment_intent_id text,
  external_customer_id text,
  status text not null default 'creating',
  amount_minor_units bigint not null,
  currency text not null,
  expires_at timestamptz,
  finished_at timestamptz,
  failure_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint checkout_attempts_id_case_key
    unique (id, case_id),
  constraint checkout_attempts_order_request_key
    unique (order_id, client_request_id),
  constraint checkout_attempts_id_case_order_key
    unique (id, case_id, order_id),
  constraint checkout_attempts_payment_identity_key
    unique (id, case_id, order_id, payment_provider),
  constraint checkout_attempts_order_amount_fkey
    foreign key (order_id, case_id, amount_minor_units, currency)
    references public.commerce_orders (id, case_id, amount_minor_units, currency)
    on delete restrict,
  constraint checkout_attempts_provider_safe
    check (payment_provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint checkout_attempts_external_ids_safe
    check (
      (external_checkout_session_id is null or char_length(external_checkout_session_id) between 1 and 255)
      and (external_payment_intent_id is null or char_length(external_payment_intent_id) between 1 and 255)
      and (external_customer_id is null or char_length(external_customer_id) between 1 and 255)
    ),
  constraint checkout_attempts_status_valid
    check (status in ('creating', 'open', 'complete', 'expired', 'failed')),
  constraint checkout_attempts_amount_positive
    check (amount_minor_units > 0),
  constraint checkout_attempts_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint checkout_attempts_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint checkout_attempts_state_complete
    check (
      (
        status = 'creating'
        and finished_at is null
        and failure_code is null
      )
      or (
        status = 'open'
        and external_checkout_session_id is not null
        and expires_at is not null
        and finished_at is null
        and failure_code is null
      )
      or (
        status = 'complete'
        and external_checkout_session_id is not null
        and external_payment_intent_id is not null
        and finished_at is not null
        and failure_code is null
      )
      or (
        status = 'expired'
        and external_checkout_session_id is not null
        and finished_at is not null
        and failure_code is null
      )
      or (
        status = 'failed'
        and finished_at is not null
        and failure_code is not null
      )
    )
);

comment on table public.checkout_attempts is
  'Idempotent server-owned attempts to create and observe a hosted checkout.';
comment on column public.checkout_attempts.external_customer_id is
  'Provider customer references are intentionally not unique because one customer may retry.';

create unique index checkout_attempts_provider_session_key
  on public.checkout_attempts (payment_provider, external_checkout_session_id)
  where external_checkout_session_id is not null;
create unique index checkout_attempts_provider_intent_key
  on public.checkout_attempts (payment_provider, external_payment_intent_id)
  where external_payment_intent_id is not null;
create unique index checkout_attempts_one_open_per_order_idx
  on public.checkout_attempts (order_id)
  where status in ('creating', 'open');
create index checkout_attempts_order_created_idx
  on public.checkout_attempts (order_id, created_at desc);

create trigger checkout_attempts_set_updated_at
before update on public.checkout_attempts
for each row execute function public.set_updated_at();

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  order_id uuid not null,
  checkout_attempt_id uuid,
  related_transaction_id uuid,
  payment_provider text not null,
  transaction_kind text not null,
  external_object_id text not null,
  external_event_id text,
  amount_minor_units bigint not null,
  currency text not null,
  provider_occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint payment_transactions_id_case_key
    unique (id, case_id),
  constraint payment_transactions_lineage_identity_key
    unique (id, case_id, order_id, payment_provider, currency),
  constraint payment_transactions_order_currency_fkey
    foreign key (order_id, case_id, currency)
    references public.commerce_orders (id, case_id, currency)
    on delete restrict,
  constraint payment_transactions_checkout_identity_fkey
    foreign key (checkout_attempt_id, case_id, order_id, payment_provider)
    references public.checkout_attempts (
      id,
      case_id,
      order_id,
      payment_provider
    )
    on delete restrict,
  constraint payment_transactions_related_case_fkey
    foreign key (
      related_transaction_id,
      case_id,
      order_id,
      payment_provider,
      currency
    ) references public.payment_transactions (
      id,
      case_id,
      order_id,
      payment_provider,
      currency
    )
    on delete restrict,
  constraint payment_transactions_provider_safe
    check (payment_provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint payment_transactions_kind_valid
    check (
      transaction_kind in (
        'payment',
        'refund',
        'dispute',
        'dispute_reversal',
        'chargeback',
        'adjustment'
      )
    ),
  constraint payment_transactions_external_ids_safe
    check (
      char_length(external_object_id) between 1 and 255
      and (external_event_id is null or char_length(external_event_id) between 1 and 255)
    ),
  constraint payment_transactions_amount_positive
    check (amount_minor_units > 0),
  constraint payment_transactions_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint payment_transactions_metadata_object
    check (
      jsonb_typeof(metadata) = 'object'
      and pg_column_size(metadata) <= 65536
    ),
  constraint payment_transactions_no_self_relation
    check (related_transaction_id is distinct from id)
);

comment on table public.payment_transactions is
  'Immutable material financial movements, deduplicated by provider objects and events.';

create unique index payment_transactions_provider_object_key
  on public.payment_transactions (payment_provider, external_object_id);
create unique index payment_transactions_provider_event_key
  on public.payment_transactions (payment_provider, external_event_id)
  where external_event_id is not null;
create index payment_transactions_order_occurred_idx
  on public.payment_transactions (order_id, provider_occurred_at desc);

create trigger payment_transactions_reject_mutation
before update or delete on public.payment_transactions
for each row execute function public.reject_total_loss_immutable_record();

create table public.case_entitlements (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  order_id uuid not null,
  preliminary_snapshot_id uuid not null,
  product_identifier text not null,
  product_version text not null,
  status public.case_entitlement_status not null default 'active',
  granted_at timestamptz not null default statement_timestamp(),
  status_changed_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  reason_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint case_entitlements_id_case_key
    unique (id, case_id),
  constraint case_entitlements_package_identity_key
    unique (id, case_id, preliminary_snapshot_id),
  constraint case_entitlements_order_key
    unique (order_id),
  constraint case_entitlements_order_identity_fkey
    foreign key (
      order_id,
      case_id,
      preliminary_snapshot_id,
      product_identifier,
      product_version
    ) references public.commerce_orders (
      id,
      case_id,
      preliminary_snapshot_id,
      product_identifier,
      product_version
    ) on delete restrict,
  constraint case_entitlements_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint case_entitlements_product_safe
    check (
      product_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
      and product_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint case_entitlements_reason_code_safe
    check (
      reason_code is null
      or reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint case_entitlements_state_complete
    check (
      (status = 'revoked' and revoked_at is not null and reason_code is not null)
      or (status <> 'revoked' and revoked_at is null)
    )
);

comment on table public.case_entitlements is
  'Case access entitlement independent of order and payment status.';

create unique index case_entitlements_one_nonrevoked_product_idx
  on public.case_entitlements (case_id, product_identifier)
  where status <> 'revoked';
create index case_entitlements_case_status_idx
  on public.case_entitlements (case_id, status, status_changed_at desc);

create trigger case_entitlements_set_updated_at
before update on public.case_entitlements
for each row execute function public.set_updated_at();

create table public.total_loss_package_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  entitlement_id uuid not null,
  preliminary_snapshot_id uuid not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  processing_token uuid,
  processing_expires_at timestamptz,
  failure_code text,
  retryable boolean,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_package_jobs_id_case_key
    unique (id, case_id),
  constraint total_loss_package_jobs_snapshot_identity_key
    unique (id, case_id, preliminary_snapshot_id),
  constraint total_loss_package_jobs_entitlement_snapshot_key
    unique (entitlement_id, preliminary_snapshot_id),
  constraint total_loss_package_jobs_entitlement_identity_fkey
    foreign key (entitlement_id, case_id, preliminary_snapshot_id)
    references public.case_entitlements (id, case_id, preliminary_snapshot_id)
    on delete restrict,
  constraint total_loss_package_jobs_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint total_loss_package_jobs_status_valid
    check (
      status in (
        'queued',
        'processing',
        'waiting_ai_review',
        'waiting_human_review',
        'ready',
        'not_supportable',
        'failed'
      )
    ),
  constraint total_loss_package_jobs_attempt_count_valid
    check (attempt_count >= 0),
  constraint total_loss_package_jobs_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_package_jobs_state_complete
    check (
      (
        status = 'queued'
        and attempt_count = 0
        and processing_token is null
        and processing_expires_at is null
        and failure_code is null
        and retryable is null
        and started_at is null
        and finished_at is null
      )
      or (
        status = 'processing'
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is not null
        and failure_code is null
        and retryable is null
        and started_at is not null
        and finished_at is null
      )
      or (
        status in ('waiting_ai_review', 'waiting_human_review')
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and failure_code is null
        and retryable is null
        and started_at is not null
        and finished_at is null
      )
      or (
        status in ('ready', 'not_supportable')
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and failure_code is null
        and retryable is null
        and started_at is not null
        and finished_at is not null
      )
      or (
        status = 'failed'
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and failure_code is not null
        and retryable is not null
        and started_at is not null
        and finished_at is not null
      )
    )
);

comment on table public.total_loss_package_jobs is
  'Durable service-owned coordination for paid Total-Loss package finalization.';
comment on column public.total_loss_package_jobs.processing_token is
  'Opaque trusted-worker lease token; never exposed through customer policies.';

create unique index total_loss_package_jobs_one_processing_per_case_idx
  on public.total_loss_package_jobs (case_id)
  where status = 'processing';
create index total_loss_package_jobs_status_lease_idx
  on public.total_loss_package_jobs (status, processing_expires_at, created_at);
create index total_loss_package_jobs_case_created_idx
  on public.total_loss_package_jobs (case_id, created_at desc);

create trigger total_loss_package_jobs_set_updated_at
before update on public.total_loss_package_jobs
for each row execute function public.set_updated_at();

create table public.total_loss_final_assessments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  package_job_id uuid not null,
  preliminary_snapshot_id uuid not null,
  version_number integer not null,
  supersedes_assessment_id uuid,
  conclusion_code text not null,
  currency text not null,
  supported_range_low_minor_units bigint,
  supported_range_median_minor_units bigint,
  supported_range_high_minor_units bigint,
  findings jsonb not null,
  limitations jsonb not null,
  reason_codes jsonb not null,
  preliminary_to_final_comparison jsonb not null,
  assessment jsonb not null,
  methodology_version text not null,
  schema_version text not null,
  assessment_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_final_assessments_id_case_key
    unique (id, case_id),
  constraint total_loss_final_assessments_lineage_identity_key
    unique (id, case_id, preliminary_snapshot_id),
  constraint total_loss_final_assessments_case_version_key
    unique (case_id, preliminary_snapshot_id, version_number),
  constraint total_loss_final_assessments_job_identity_fkey
    foreign key (package_job_id, case_id, preliminary_snapshot_id)
    references public.total_loss_package_jobs (id, case_id, preliminary_snapshot_id)
    on delete restrict,
  constraint total_loss_final_assessments_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint total_loss_final_assessments_supersedes_fkey
    foreign key (supersedes_assessment_id, case_id, preliminary_snapshot_id)
    references public.total_loss_final_assessments (
      id,
      case_id,
      preliminary_snapshot_id
    ) on delete restrict,
  constraint total_loss_final_assessments_version_positive
    check (version_number >= 1),
  constraint total_loss_final_assessments_conclusion_safe
    check (conclusion_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint total_loss_final_assessments_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint total_loss_final_assessments_range_complete
    check (
      (
        supported_range_low_minor_units is null
        and supported_range_median_minor_units is null
        and supported_range_high_minor_units is null
      )
      or (
        supported_range_low_minor_units > 0
        and supported_range_median_minor_units >= supported_range_low_minor_units
        and supported_range_high_minor_units >= supported_range_median_minor_units
      )
    ),
  constraint total_loss_final_assessments_structured_fields_valid
    check (
      jsonb_typeof(findings) = 'array'
      and jsonb_typeof(limitations) = 'array'
      and jsonb_typeof(reason_codes) = 'array'
      and jsonb_typeof(preliminary_to_final_comparison) = 'object'
      and jsonb_typeof(assessment) = 'object'
      and pg_column_size(findings) <= 262144
      and pg_column_size(limitations) <= 262144
      and pg_column_size(reason_codes) <= 65536
      and pg_column_size(preliminary_to_final_comparison) <= 262144
      and pg_column_size(assessment) <= 1048576
    ),
  constraint total_loss_final_assessments_versions_safe
    check (
      methodology_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_final_assessments_digest_valid
    check (assessment_digest ~ '^[0-9a-f]{64}$'),
  constraint total_loss_final_assessments_no_self_supersession
    check (supersedes_assessment_id is distinct from id)
);

comment on table public.total_loss_final_assessments is
  'Immutable versioned paid assessment derived from a frozen preliminary result without rerunning it.';

create index total_loss_final_assessments_case_created_idx
  on public.total_loss_final_assessments (case_id, created_at desc);

create trigger total_loss_final_assessments_reject_mutation
before update or delete on public.total_loss_final_assessments
for each row execute function public.reject_total_loss_immutable_record();

create table public.total_loss_report_series (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.total_loss_claim_workflows (case_id) on delete restrict,
  product_identifier text not null,
  report_kind text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_report_series_id_case_key
    unique (id, case_id),
  constraint total_loss_report_series_logical_key
    unique (case_id, product_identifier, report_kind),
  constraint total_loss_report_series_codes_safe
    check (
      product_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
      and report_kind ~ '^[a-z][a-z0-9_-]{0,63}$'
    )
);

comment on table public.total_loss_report_series is
  'Stable identity grouping immutable professional report versions for one case deliverable.';

create index total_loss_report_series_case_created_idx
  on public.total_loss_report_series (case_id, created_at desc);

create table public.total_loss_claim_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  document_kind text not null,
  storage_bucket_id text,
  storage_object_name text,
  original_filename text,
  media_type text,
  byte_size bigint,
  content_digest text,
  status text not null default 'pending',
  failure_code text,
  created_by_user_id uuid,
  sealed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_claim_documents_id_case_key
    unique (id, case_id),
  constraint total_loss_claim_documents_storage_object_key
    unique (storage_bucket_id, storage_object_name),
  constraint total_loss_claim_documents_kind_safe
    check (document_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_claim_documents_storage_complete
    check (
      (storage_bucket_id is null and storage_object_name is null)
      or (
        storage_bucket_id ~ '^[a-z0-9][a-z0-9_-]{0,62}$'
        and char_length(storage_object_name) between 1 and 1024
        and storage_object_name !~ '(^/|//|(^|/)\.\.(/|$)|[[:cntrl:]])'
      )
    ),
  constraint total_loss_claim_documents_filename_safe
    check (
      original_filename is null
      or (
        char_length(original_filename) between 1 and 255
        and position('/' in original_filename) = 0
        and position(chr(92) in original_filename) = 0
        and original_filename !~ '[[:cntrl:]]'
      )
    ),
  constraint total_loss_claim_documents_media_type_safe
    check (
      media_type is null
      or media_type ~ '^[a-z0-9][a-z0-9.+-]{0,63}/[a-z0-9][a-z0-9.+-]{0,63}$'
    ),
  constraint total_loss_claim_documents_byte_size_valid
    check (byte_size is null or byte_size between 0 and 52428800),
  constraint total_loss_claim_documents_digest_valid
    check (
      content_digest is null
      or content_digest ~ '^[0-9a-f]{64}$'
    ),
  constraint total_loss_claim_documents_status_valid
    check (status in ('pending', 'ready', 'failed')),
  constraint total_loss_claim_documents_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_claim_documents_state_complete
    check (
      (
        status = 'pending'
        and sealed_at is null
        and failure_code is null
      )
      or (
        status = 'ready'
        and storage_bucket_id is not null
        and storage_object_name is not null
        and media_type is not null
        and byte_size is not null
        and content_digest is not null
        and sealed_at is not null
        and failure_code is null
      )
      or (
        status = 'failed'
        and sealed_at is null
        and failure_code is not null
      )
    )
);

comment on table public.total_loss_claim_documents is
  'Metadata for future generated deliverables and preserved claim communications; no Storage authorization is added here.';

create index total_loss_claim_documents_case_kind_created_idx
  on public.total_loss_claim_documents (case_id, document_kind, created_at desc);
create index total_loss_claim_documents_status_created_idx
  on public.total_loss_claim_documents (status, created_at);

create trigger total_loss_claim_documents_set_updated_at
before update on public.total_loss_claim_documents
for each row execute function public.set_updated_at();
create trigger total_loss_claim_documents_protect_terminal
before update or delete on public.total_loss_claim_documents
for each row execute function public.protect_total_loss_terminal_record('ready', 'failed');

create table public.total_loss_report_versions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  report_series_id uuid not null,
  version_number integer not null,
  final_assessment_id uuid not null,
  preliminary_snapshot_id uuid not null,
  document_id uuid,
  renderer_version text not null,
  template_version text not null,
  schema_version text not null,
  report jsonb not null,
  report_digest text not null,
  status text not null default 'draft',
  published_at timestamptz,
  supersedes_report_version_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_report_versions_id_case_key
    unique (id, case_id),
  constraint total_loss_report_versions_assessment_identity_key
    unique (id, case_id, final_assessment_id),
  constraint total_loss_report_versions_lineage_identity_key
    unique (id, case_id, report_series_id),
  constraint total_loss_report_versions_series_version_key
    unique (report_series_id, version_number),
  constraint total_loss_report_versions_series_case_fkey
    foreign key (report_series_id, case_id)
    references public.total_loss_report_series (id, case_id)
    on delete restrict,
  constraint total_loss_report_versions_assessment_case_fkey
    foreign key (final_assessment_id, case_id, preliminary_snapshot_id)
    references public.total_loss_final_assessments (
      id,
      case_id,
      preliminary_snapshot_id
    )
    on delete restrict,
  constraint total_loss_report_versions_snapshot_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint total_loss_report_versions_document_case_fkey
    foreign key (document_id, case_id)
    references public.total_loss_claim_documents (id, case_id)
    on delete restrict,
  constraint total_loss_report_versions_supersedes_fkey
    foreign key (supersedes_report_version_id, case_id, report_series_id)
    references public.total_loss_report_versions (id, case_id, report_series_id)
    on delete restrict,
  constraint total_loss_report_versions_number_positive
    check (version_number >= 1),
  constraint total_loss_report_versions_versions_safe
    check (
      renderer_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and template_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_report_versions_report_object
    check (
      jsonb_typeof(report) = 'object'
      and pg_column_size(report) <= 1048576
    ),
  constraint total_loss_report_versions_digest_valid
    check (report_digest ~ '^[0-9a-f]{64}$'),
  constraint total_loss_report_versions_status_valid
    check (status in ('draft', 'reviewing', 'published')),
  constraint total_loss_report_versions_publication_complete
    check (
      (status = 'published' and document_id is not null and published_at is not null)
      or (status <> 'published' and published_at is null)
    ),
  constraint total_loss_report_versions_no_self_supersession
    check (supersedes_report_version_id is distinct from id)
);

comment on table public.total_loss_report_versions is
  'Versioned structured source for professional deliverables; published rows are immutable.';

create index total_loss_report_versions_case_status_created_idx
  on public.total_loss_report_versions (case_id, status, created_at desc);
create index total_loss_report_versions_published_idx
  on public.total_loss_report_versions (case_id, published_at desc)
  where status = 'published';

create function public.validate_total_loss_published_report_document()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published'
    and not exists (
      select 1
      from public.total_loss_claim_documents as document
      where document.id = new.document_id
        and document.case_id = new.case_id
        and document.status = 'ready'
        and document.sealed_at is not null
    ) then
    raise exception using
      errcode = '23514',
      message = 'Published reports require a ready sealed document.';
  end if;

  return new;
end;
$$;

comment on function public.validate_total_loss_published_report_document() is
  'Trigger-only guard that prevents publishing a report against pending or failed document metadata.';

revoke execute on function public.validate_total_loss_published_report_document() from public;
revoke execute on function public.validate_total_loss_published_report_document() from anon;
revoke execute on function public.validate_total_loss_published_report_document() from authenticated;
revoke execute on function public.validate_total_loss_published_report_document() from service_role;

create trigger total_loss_report_versions_require_ready_document
before insert or update on public.total_loss_report_versions
for each row execute function public.validate_total_loss_published_report_document();

create trigger total_loss_report_versions_set_updated_at
before update on public.total_loss_report_versions
for each row execute function public.set_updated_at();
create trigger total_loss_report_versions_protect_published
before update or delete on public.total_loss_report_versions
for each row execute function public.protect_total_loss_terminal_record('published');

create table public.total_loss_ai_review_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  final_assessment_id uuid not null,
  report_version_id uuid,
  provider_identifier text not null,
  model_identifier text not null,
  prompt_version text not null,
  schema_version text not null,
  input_digest text not null,
  output_digest text,
  review_result jsonb,
  recommendation text,
  confidence text,
  status text not null default 'queued',
  usage_metadata jsonb,
  failure_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_ai_review_runs_id_case_key
    unique (id, case_id),
  constraint total_loss_ai_review_runs_assessment_case_fkey
    foreign key (final_assessment_id, case_id)
    references public.total_loss_final_assessments (id, case_id)
    on delete restrict,
  constraint total_loss_ai_review_runs_report_assessment_fkey
    foreign key (report_version_id, case_id, final_assessment_id)
    references public.total_loss_report_versions (id, case_id, final_assessment_id)
    on delete restrict,
  constraint total_loss_ai_review_runs_identifiers_safe
    check (
      provider_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
      and char_length(model_identifier) between 1 and 255
      and prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_ai_review_runs_input_digest_valid
    check (input_digest ~ '^[0-9a-f]{64}$'),
  constraint total_loss_ai_review_runs_output_digest_valid
    check (
      output_digest is null
      or output_digest ~ '^[0-9a-f]{64}$'
    ),
  constraint total_loss_ai_review_runs_result_object
    check (
      review_result is null
      or (
        jsonb_typeof(review_result) = 'object'
        and pg_column_size(review_result) <= 262144
      )
    ),
  constraint total_loss_ai_review_runs_recommendation_valid
    check (recommendation is null or recommendation in ('PASS', 'HUMAN_REVIEW')),
  constraint total_loss_ai_review_runs_confidence_valid
    check (confidence is null or confidence in ('HIGH', 'MEDIUM', 'LOW')),
  constraint total_loss_ai_review_runs_status_valid
    check (
      status in ('queued', 'processing', 'completed', 'failed', 'refused', 'timed_out')
    ),
  constraint total_loss_ai_review_runs_usage_object
    check (
      usage_metadata is null
      or (
        jsonb_typeof(usage_metadata) = 'object'
        and pg_column_size(usage_metadata) <= 65536
      )
    ),
  constraint total_loss_ai_review_runs_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_ai_review_runs_state_complete
    check (
      (
        status = 'queued'
        and output_digest is null
        and review_result is null
        and recommendation is null
        and confidence is null
        and failure_code is null
        and started_at is null
        and completed_at is null
      )
      or (
        status = 'processing'
        and output_digest is null
        and review_result is null
        and recommendation is null
        and confidence is null
        and failure_code is null
        and started_at is not null
        and completed_at is null
      )
      or (
        status = 'completed'
        and output_digest is not null
        and review_result is not null
        and recommendation is not null
        and confidence is not null
        and failure_code is null
        and started_at is not null
        and completed_at is not null
      )
      or (
        status in ('failed', 'refused', 'timed_out')
        and output_digest is null
        and review_result is null
        and recommendation is null
        and confidence is null
        and failure_code is not null
        and started_at is not null
        and completed_at is not null
      )
    )
);

comment on table public.total_loss_ai_review_runs is
  'Independent release-audit lifecycle with model failures kept separate from completed review decisions.';
comment on column public.total_loss_ai_review_runs.review_result is
  'Structured terminal review output; it becomes immutable with the terminal run.';

create index total_loss_ai_review_runs_case_created_idx
  on public.total_loss_ai_review_runs (case_id, created_at desc);
create index total_loss_ai_review_runs_status_created_idx
  on public.total_loss_ai_review_runs (status, created_at);

create function public.protect_total_loss_ai_review_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'AI review runs cannot be deleted.';
  end if;

  if row(
    new.id,
    new.case_id,
    new.final_assessment_id,
    new.report_version_id,
    new.provider_identifier,
    new.model_identifier,
    new.prompt_version,
    new.schema_version,
    new.input_digest,
    new.created_at
  ) is distinct from row(
    old.id,
    old.case_id,
    old.final_assessment_id,
    old.report_version_id,
    old.provider_identifier,
    old.model_identifier,
    old.prompt_version,
    old.schema_version,
    old.input_digest,
    old.created_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'AI review input identity is immutable.';
  end if;

  if old.status in ('completed', 'failed', 'refused', 'timed_out') then
    raise exception using
      errcode = '55000',
      message = 'Terminal AI review runs are immutable.';
  end if;

  return new;
end;
$$;

comment on function public.protect_total_loss_ai_review_run() is
  'Trigger-only guard that permits lifecycle completion while freezing AI inputs and terminal output.';

revoke execute on function public.protect_total_loss_ai_review_run() from public;
revoke execute on function public.protect_total_loss_ai_review_run() from anon;
revoke execute on function public.protect_total_loss_ai_review_run() from authenticated;
revoke execute on function public.protect_total_loss_ai_review_run() from service_role;

create trigger total_loss_ai_review_runs_protect_history
before update or delete on public.total_loss_ai_review_runs
for each row execute function public.protect_total_loss_ai_review_run();
create trigger total_loss_ai_review_runs_set_updated_at
before update on public.total_loss_ai_review_runs
for each row execute function public.set_updated_at();

create table public.total_loss_release_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  ai_review_run_id uuid not null unique,
  status text not null default 'queued',
  assigned_staff_user_id uuid references public.staff_members (user_id) on delete set null,
  decision text,
  rationale text,
  resolved_by_user_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_release_reviews_id_case_key
    unique (id, case_id),
  constraint total_loss_release_reviews_ai_case_fkey
    foreign key (ai_review_run_id, case_id)
    references public.total_loss_ai_review_runs (id, case_id)
    on delete restrict,
  constraint total_loss_release_reviews_status_valid
    check (status in ('queued', 'in_review', 'resolved', 'cancelled')),
  constraint total_loss_release_reviews_decision_valid
    check (
      decision is null
      or decision in ('approved', 'revision_requested', 'not_supportable')
    ),
  constraint total_loss_release_reviews_rationale_safe
    check (rationale is null or char_length(rationale) between 1 and 10000),
  constraint total_loss_release_reviews_state_complete
    check (
      (
        status in ('queued', 'in_review')
        and decision is null
        and resolved_by_user_id is null
        and resolved_at is null
      )
      or (
        status = 'resolved'
        and decision is not null
        and rationale is not null
        and resolved_by_user_id is not null
        and resolved_at is not null
      )
      or (
        status = 'cancelled'
        and decision is null
        and resolved_by_user_id is not null
        and resolved_at is not null
      )
    )
);

comment on table public.total_loss_release_reviews is
  'Staff-authorized exception queue for AI review outcomes that cannot be released automatically.';
comment on column public.total_loss_release_reviews.resolved_by_user_id is
  'Historical resolver UUID retained even after staff access is revoked.';

create index total_loss_release_reviews_queue_idx
  on public.total_loss_release_reviews (status, due_at, created_at);
create index total_loss_release_reviews_assignee_idx
  on public.total_loss_release_reviews (assigned_staff_user_id, status, due_at);

create trigger total_loss_release_reviews_set_updated_at
before update on public.total_loss_release_reviews
for each row execute function public.set_updated_at();
create trigger total_loss_release_reviews_protect_terminal
before update or delete on public.total_loss_release_reviews
for each row execute function public.protect_total_loss_terminal_record('resolved', 'cancelled');

create table public.total_loss_education_progress (
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  report_version_id uuid not null,
  step_identifier text not null,
  viewed_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (case_id, report_version_id, step_identifier),
  constraint total_loss_education_progress_report_case_fkey
    foreign key (report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id)
    on delete restrict,
  constraint total_loss_education_progress_step_safe
    check (step_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_education_progress_state_valid
    check (
      not (completed_at is not null and skipped_at is not null)
      and (completed_at is null or viewed_at is not null)
      and (skipped_at is null or viewed_at is not null)
      and (completed_at is null or completed_at >= viewed_at)
      and (skipped_at is null or skipped_at >= viewed_at)
    )
);

comment on table public.total_loss_education_progress is
  'Server-owned progress markers for the future guided post-payment education sequence.';

create index total_loss_education_progress_case_updated_idx
  on public.total_loss_education_progress (case_id, updated_at desc);

create trigger total_loss_education_progress_set_updated_at
before update on public.total_loss_education_progress
for each row execute function public.set_updated_at();

create table public.total_loss_negotiation_rounds (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.total_loss_claim_workflows (case_id) on delete restrict,
  round_number integer not null,
  status text not null default 'open',
  originating_communication_id uuid,
  revision bigint not null default 1,
  opened_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_negotiation_rounds_id_case_key
    unique (id, case_id),
  constraint total_loss_negotiation_rounds_case_number_key
    unique (case_id, round_number),
  constraint total_loss_negotiation_rounds_number_positive
    check (round_number >= 1),
  constraint total_loss_negotiation_rounds_status_valid
    check (
      status in (
        'open',
        'waiting_for_insurer',
        'response_received',
        'preparing_follow_up',
        'closed'
      )
    ),
  constraint total_loss_negotiation_rounds_revision_positive
    check (revision >= 1),
  constraint total_loss_negotiation_rounds_closed_complete
    check ((status = 'closed') = (closed_at is not null))
);

comment on table public.total_loss_negotiation_rounds is
  'Repeated, positive-numbered negotiation rounds with at most one open round per case.';

create unique index total_loss_negotiation_rounds_one_open_idx
  on public.total_loss_negotiation_rounds (case_id)
  where status <> 'closed';
create index total_loss_negotiation_rounds_case_opened_idx
  on public.total_loss_negotiation_rounds (case_id, opened_at desc);

create trigger total_loss_negotiation_rounds_set_updated_at
before update on public.total_loss_negotiation_rounds
for each row execute function public.set_updated_at();
create trigger total_loss_negotiation_rounds_protect_closed
before update or delete on public.total_loss_negotiation_rounds
for each row execute function public.protect_total_loss_terminal_record('closed');

create table public.total_loss_message_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.total_loss_claim_workflows (case_id) on delete restrict,
  negotiation_round_id uuid,
  report_version_id uuid,
  purpose text not null,
  recipient text,
  subject text not null default '',
  body text not null default '',
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_message_drafts_id_case_key
    unique (id, case_id),
  constraint total_loss_message_drafts_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_message_drafts_report_case_fkey
    foreign key (report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id)
    on delete restrict,
  constraint total_loss_message_drafts_purpose_safe
    check (purpose ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_message_drafts_content_safe
    check (
      (recipient is null or char_length(recipient) between 1 and 320)
      and char_length(subject) <= 998
      and char_length(body) <= 50000
    ),
  constraint total_loss_message_drafts_revision_positive
    check (revision >= 1)
);

comment on table public.total_loss_message_drafts is
  'Current editable communication draft; historical prepared/sent content lives in message versions.';

create unique index total_loss_message_drafts_one_current_idx
  on public.total_loss_message_drafts (
    case_id,
    purpose,
    coalesce(negotiation_round_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index total_loss_message_drafts_case_updated_idx
  on public.total_loss_message_drafts (case_id, updated_at desc);

create trigger total_loss_message_drafts_set_updated_at
before update on public.total_loss_message_drafts
for each row execute function public.set_updated_at();

create table public.total_loss_message_versions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  message_draft_id uuid not null,
  negotiation_round_id uuid,
  report_version_id uuid,
  version_number integer not null,
  message_state text not null,
  purpose text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  message_digest text not null,
  supersedes_message_version_id uuid,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_message_versions_id_case_key
    unique (id, case_id),
  constraint total_loss_message_versions_lineage_identity_key
    unique (id, case_id, message_draft_id),
  constraint total_loss_message_versions_draft_version_key
    unique (message_draft_id, version_number),
  constraint total_loss_message_versions_draft_case_fkey
    foreign key (message_draft_id, case_id)
    references public.total_loss_message_drafts (id, case_id)
    on delete restrict,
  constraint total_loss_message_versions_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_message_versions_report_case_fkey
    foreign key (report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id)
    on delete restrict,
  constraint total_loss_message_versions_supersedes_fkey
    foreign key (supersedes_message_version_id, case_id, message_draft_id)
    references public.total_loss_message_versions (id, case_id, message_draft_id)
    on delete restrict,
  constraint total_loss_message_versions_number_positive
    check (version_number >= 1),
  constraint total_loss_message_versions_state_valid
    check (message_state in ('prepared', 'customer_reported_sent')),
  constraint total_loss_message_versions_purpose_safe
    check (purpose ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_message_versions_content_safe
    check (
      char_length(recipient) between 1 and 320
      and char_length(subject) between 1 and 998
      and char_length(body) between 1 and 50000
    ),
  constraint total_loss_message_versions_digest_valid
    check (message_digest ~ '^[0-9a-f]{64}$'),
  constraint total_loss_message_versions_sent_complete
    check (
      (message_state = 'customer_reported_sent') = (sent_at is not null)
    ),
  constraint total_loss_message_versions_no_self_supersession
    check (supersedes_message_version_id is distinct from id)
);

comment on table public.total_loss_message_versions is
  'Immutable exact snapshots of prepared or customer-reported-sent claim messages.';

create index total_loss_message_versions_case_created_idx
  on public.total_loss_message_versions (case_id, created_at desc);

create trigger total_loss_message_versions_reject_mutation
before update or delete on public.total_loss_message_versions
for each row execute function public.reject_total_loss_immutable_record();

create table public.total_loss_communications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.total_loss_claim_workflows (case_id) on delete restrict,
  negotiation_round_id uuid,
  direction public.total_loss_communication_direction not null,
  channel public.total_loss_communication_channel not null,
  communication_type text not null,
  status text not null default 'draft',
  sender text,
  recipient text,
  subject text,
  original_content text,
  occurred_at timestamptz,
  confirmed_at timestamptz,
  recorded_by_user_id uuid,
  message_version_id uuid,
  supersedes_communication_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_communications_id_case_key
    unique (id, case_id),
  constraint total_loss_communications_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_communications_message_case_fkey
    foreign key (message_version_id, case_id)
    references public.total_loss_message_versions (id, case_id)
    on delete restrict,
  constraint total_loss_communications_supersedes_case_fkey
    foreign key (supersedes_communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_communications_type_safe
    check (communication_type ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_communications_status_valid
    check (status in ('draft', 'confirmed')),
  constraint total_loss_communications_addresses_safe
    check (
      (sender is null or char_length(sender) between 1 and 320)
      and (recipient is null or char_length(recipient) between 1 and 320)
      and (subject is null or char_length(subject) between 1 and 998)
      and (original_content is null or char_length(original_content) between 1 and 100000)
    ),
  constraint total_loss_communications_confirmation_complete
    check (
      (
        status = 'draft'
        and confirmed_at is null
      )
      or (
        status = 'confirmed'
        and occurred_at is not null
        and confirmed_at is not null
      )
    ),
  constraint total_loss_communications_outbound_message_valid
    check (direction = 'inbound' or channel <> 'email' or message_version_id is not null),
  constraint total_loss_communications_no_self_supersession
    check (supersedes_communication_id is distinct from id)
);

comment on table public.total_loss_communications is
  'Original inbound/outbound communication record; confirmed content is immutable.';

create index total_loss_communications_case_occurred_idx
  on public.total_loss_communications (case_id, occurred_at desc, created_at desc);
create index total_loss_communications_round_created_idx
  on public.total_loss_communications (negotiation_round_id, created_at desc);

create trigger total_loss_communications_set_updated_at
before update on public.total_loss_communications
for each row execute function public.set_updated_at();
create trigger total_loss_communications_protect_confirmed
before update or delete on public.total_loss_communications
for each row execute function public.protect_total_loss_terminal_record('confirmed');

alter table public.total_loss_negotiation_rounds
add constraint total_loss_negotiation_rounds_origin_case_fkey
foreign key (originating_communication_id, case_id)
references public.total_loss_communications (id, case_id)
on delete restrict
deferrable initially deferred;

create table public.total_loss_communication_documents (
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  communication_id uuid not null,
  document_id uuid not null,
  display_order integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  primary key (communication_id, document_id),
  constraint total_loss_communication_documents_communication_case_fkey
    foreign key (communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_communication_documents_document_case_fkey
    foreign key (document_id, case_id)
    references public.total_loss_claim_documents (id, case_id)
    on delete restrict,
  constraint total_loss_communication_documents_order_valid
    check (display_order >= 0)
);

comment on table public.total_loss_communication_documents is
  'Same-case attachment links that become immutable with a confirmed communication.';

create index total_loss_communication_documents_case_created_idx
  on public.total_loss_communication_documents (case_id, created_at desc);

create function public.protect_confirmed_total_loss_communication_documents()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
    and exists (
      select 1
      from public.total_loss_communications as communication
      where communication.id = old.communication_id
        and communication.status = 'confirmed'
    ) then
    raise exception using
      errcode = '55000',
      message = 'Confirmed communication attachments are immutable.';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and exists (
      select 1
      from public.total_loss_communications as communication
      where communication.id = new.communication_id
        and communication.status = 'confirmed'
    ) then
    raise exception using
      errcode = '55000',
      message = 'Confirmed communication attachments are immutable.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.protect_confirmed_total_loss_communication_documents() is
  'Trigger-only guard preventing attachment changes after communication confirmation.';

revoke execute on function public.protect_confirmed_total_loss_communication_documents() from public;
revoke execute on function public.protect_confirmed_total_loss_communication_documents() from anon;
revoke execute on function public.protect_confirmed_total_loss_communication_documents() from authenticated;
revoke execute on function public.protect_confirmed_total_loss_communication_documents() from service_role;

create trigger total_loss_communication_documents_protect_confirmed
before insert or update or delete on public.total_loss_communication_documents
for each row execute function public.protect_confirmed_total_loss_communication_documents();

create table public.total_loss_fact_assertions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  source_communication_id uuid,
  source_document_id uuid,
  source_assessment_id uuid,
  fact_type text not null,
  fact_value jsonb not null,
  source_locator jsonb not null default '{}'::jsonb,
  extraction_method text not null,
  confidence numeric(5, 4),
  status text not null default 'proposed',
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  supersedes_fact_assertion_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_fact_assertions_id_case_key
    unique (id, case_id),
  constraint total_loss_fact_assertions_lineage_identity_key
    unique (id, case_id, fact_type),
  constraint total_loss_fact_assertions_communication_case_fkey
    foreign key (source_communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_fact_assertions_document_case_fkey
    foreign key (source_document_id, case_id)
    references public.total_loss_claim_documents (id, case_id)
    on delete restrict,
  constraint total_loss_fact_assertions_assessment_case_fkey
    foreign key (source_assessment_id, case_id)
    references public.total_loss_final_assessments (id, case_id)
    on delete restrict,
  constraint total_loss_fact_assertions_supersedes_fkey
    foreign key (supersedes_fact_assertion_id, case_id, fact_type)
    references public.total_loss_fact_assertions (id, case_id, fact_type)
    on delete restrict,
  constraint total_loss_fact_assertions_one_source
    check (
      num_nonnulls(
        source_communication_id,
        source_document_id,
        source_assessment_id
      ) = 1
    ),
  constraint total_loss_fact_assertions_type_safe
    check (fact_type ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_fact_assertions_value_valid
    check (
      jsonb_typeof(fact_value) <> 'null'
      and pg_column_size(fact_value) <= 65536
    ),
  constraint total_loss_fact_assertions_locator_object
    check (
      jsonb_typeof(source_locator) = 'object'
      and pg_column_size(source_locator) <= 65536
    ),
  constraint total_loss_fact_assertions_method_safe
    check (extraction_method ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_fact_assertions_confidence_valid
    check (confidence is null or confidence between 0 and 1),
  constraint total_loss_fact_assertions_status_valid
    check (status in ('proposed', 'confirmed', 'rejected')),
  constraint total_loss_fact_assertions_confirmation_complete
    check (
      (
        status = 'proposed'
        and confirmed_by_user_id is null
        and confirmed_at is null
      )
      or (
        status in ('confirmed', 'rejected')
        and confirmed_by_user_id is not null
        and confirmed_at is not null
      )
    ),
  constraint total_loss_fact_assertions_no_self_supersession
    check (supersedes_fact_assertion_id is distinct from id)
);

comment on table public.total_loss_fact_assertions is
  'Source-grounded typed facts with confidence, confirmation, and immutable terminal history.';

create index total_loss_fact_assertions_case_status_created_idx
  on public.total_loss_fact_assertions (case_id, status, created_at desc);
create index total_loss_fact_assertions_source_communication_idx
  on public.total_loss_fact_assertions (source_communication_id)
  where source_communication_id is not null;

create trigger total_loss_fact_assertions_set_updated_at
before update on public.total_loss_fact_assertions
for each row execute function public.set_updated_at();
create trigger total_loss_fact_assertions_protect_terminal
before update or delete on public.total_loss_fact_assertions
for each row execute function public.protect_total_loss_terminal_record('confirmed', 'rejected');

create table public.total_loss_offers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  negotiation_round_id uuid not null,
  source_communication_id uuid not null,
  source_fact_assertion_id uuid,
  amount_minor_units bigint not null,
  currency text not null,
  offer_kind text not null,
  status text not null default 'recorded',
  received_at timestamptz not null,
  decided_at timestamptz,
  decision_recorded_by_user_id uuid,
  supersedes_offer_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_offers_id_case_key
    unique (id, case_id),
  constraint total_loss_offers_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_offers_communication_case_fkey
    foreign key (source_communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_offers_fact_case_fkey
    foreign key (source_fact_assertion_id, case_id)
    references public.total_loss_fact_assertions (id, case_id)
    on delete restrict,
  constraint total_loss_offers_supersedes_case_fkey
    foreign key (supersedes_offer_id, case_id)
    references public.total_loss_offers (id, case_id)
    on delete restrict,
  constraint total_loss_offers_amount_positive
    check (amount_minor_units > 0),
  constraint total_loss_offers_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint total_loss_offers_kind_safe
    check (offer_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_offers_status_valid
    check (status in ('recorded', 'accepted', 'rejected', 'superseded')),
  constraint total_loss_offers_decision_complete
    check (
      (
        status = 'recorded'
        and decided_at is null
        and decision_recorded_by_user_id is null
      )
      or (
        status in ('accepted', 'rejected', 'superseded')
        and decided_at is not null
        and decision_recorded_by_user_id is not null
      )
    ),
  constraint total_loss_offers_no_self_supersession
    check (supersedes_offer_id is distinct from id)
);

comment on table public.total_loss_offers is
  'Integer-minor-unit insurer offers preserved across repeated negotiation rounds.';

create index total_loss_offers_case_received_idx
  on public.total_loss_offers (case_id, received_at desc);
create index total_loss_offers_round_created_idx
  on public.total_loss_offers (negotiation_round_id, created_at desc);

create trigger total_loss_offers_set_updated_at
before update on public.total_loss_offers
for each row execute function public.set_updated_at();
create trigger total_loss_offers_protect_terminal
before update or delete on public.total_loss_offers
for each row execute function public.protect_total_loss_terminal_record(
  'accepted',
  'rejected',
  'superseded'
);

create table public.total_loss_recommendations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  negotiation_round_id uuid not null,
  version_number integer not null,
  recommendation_type text not null,
  recommendation jsonb not null,
  evidence_references jsonb not null,
  generation_method text not null,
  provider_identifier text,
  model_identifier text,
  status text not null default 'draft',
  recommendation_digest text not null,
  supersedes_recommendation_id uuid,
  created_by_user_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_recommendations_id_case_key
    unique (id, case_id),
  constraint total_loss_recommendations_lineage_identity_key
    unique (id, case_id, negotiation_round_id),
  constraint total_loss_recommendations_round_version_key
    unique (negotiation_round_id, version_number),
  constraint total_loss_recommendations_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_recommendations_supersedes_fkey
    foreign key (supersedes_recommendation_id, case_id, negotiation_round_id)
    references public.total_loss_recommendations (id, case_id, negotiation_round_id)
    on delete restrict,
  constraint total_loss_recommendations_version_positive
    check (version_number >= 1),
  constraint total_loss_recommendations_type_safe
    check (recommendation_type ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint total_loss_recommendations_payload_valid
    check (
      jsonb_typeof(recommendation) = 'object'
      and jsonb_typeof(evidence_references) = 'array'
      and pg_column_size(recommendation) <= 262144
      and pg_column_size(evidence_references) <= 262144
    ),
  constraint total_loss_recommendations_generation_safe
    check (
      generation_method ~ '^[a-z][a-z0-9_-]{0,63}$'
      and (provider_identifier is null) = (model_identifier is null)
      and (
        provider_identifier is null
        or (
          provider_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
          and char_length(model_identifier) between 1 and 255
        )
      )
    ),
  constraint total_loss_recommendations_status_valid
    check (status in ('draft', 'published')),
  constraint total_loss_recommendations_digest_valid
    check (recommendation_digest ~ '^[0-9a-f]{64}$'),
  constraint total_loss_recommendations_publication_complete
    check ((status = 'published') = (published_at is not null)),
  constraint total_loss_recommendations_no_self_supersession
    check (supersedes_recommendation_id is distinct from id)
);

comment on table public.total_loss_recommendations is
  'Versioned evidence-linked recommendations; published versions are immutable.';

create index total_loss_recommendations_case_created_idx
  on public.total_loss_recommendations (case_id, created_at desc);

create trigger total_loss_recommendations_set_updated_at
before update on public.total_loss_recommendations
for each row execute function public.set_updated_at();
create trigger total_loss_recommendations_protect_published
before update or delete on public.total_loss_recommendations
for each row execute function public.protect_total_loss_terminal_record('published');

create table public.total_loss_workflow_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.total_loss_claim_workflows (case_id) on delete restrict,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid,
  associated_entity_type text,
  associated_entity_id uuid,
  client_request_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_workflow_events_type_safe
    check (event_type ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  constraint total_loss_workflow_events_actor_type_valid
    check (actor_type in ('system', 'customer', 'staff', 'provider')),
  constraint total_loss_workflow_events_actor_complete
    check (
      (actor_type in ('customer', 'staff') and actor_user_id is not null)
      or (actor_type in ('system', 'provider') and actor_user_id is null)
    ),
  constraint total_loss_workflow_events_entity_complete
    check (
      (associated_entity_type is null and associated_entity_id is null)
      or (
        associated_entity_type ~ '^[a-z][a-z0-9_.-]{0,127}$'
        and associated_entity_id is not null
      )
    ),
  constraint total_loss_workflow_events_details_object
    check (
      jsonb_typeof(details) = 'object'
      and pg_column_size(details) <= 65536
    )
);

comment on table public.total_loss_workflow_events is
  'Append-only post-Continue audit events with optional client idempotency identity.';
comment on column public.total_loss_workflow_events.details is
  'Bounded non-sensitive event metadata; raw provider payloads and message bodies do not belong here.';

create unique index total_loss_workflow_events_client_request_key
  on public.total_loss_workflow_events (case_id, client_request_id)
  where client_request_id is not null;
create index total_loss_workflow_events_case_created_idx
  on public.total_loss_workflow_events (case_id, created_at desc);
create index total_loss_workflow_events_type_created_idx
  on public.total_loss_workflow_events (event_type, created_at desc);

create trigger total_loss_workflow_events_reject_mutation
before update or delete on public.total_loss_workflow_events
for each row execute function public.reject_total_loss_immutable_record();

alter table public.total_loss_claim_workflows
add constraint total_loss_claim_workflows_current_package_fkey
foreign key (current_package_job_id, case_id)
references public.total_loss_package_jobs (id, case_id)
on delete restrict
deferrable initially deferred,
add constraint total_loss_claim_workflows_current_report_fkey
foreign key (current_report_version_id, case_id)
references public.total_loss_report_versions (id, case_id)
on delete restrict
deferrable initially deferred,
add constraint total_loss_claim_workflows_current_round_fkey
foreign key (current_negotiation_round_id, case_id)
references public.total_loss_negotiation_rounds (id, case_id)
on delete restrict
deferrable initially deferred,
add constraint total_loss_claim_workflows_current_offer_fkey
foreign key (current_offer_id, case_id)
references public.total_loss_offers (id, case_id)
on delete restrict
deferrable initially deferred,
add constraint total_loss_claim_workflows_current_recommendation_fkey
foreign key (current_recommendation_id, case_id)
references public.total_loss_recommendations (id, case_id)
on delete restrict
deferrable initially deferred;

create function public.protect_total_loss_stable_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  column_name text;
begin
  foreach column_name in array tg_argv loop
    if (to_jsonb(new) -> column_name) is distinct from
      (to_jsonb(old) -> column_name) then
      raise exception using
        errcode = '55000',
        message = format('%I.%I is immutable.', tg_table_name, column_name);
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.protect_total_loss_stable_columns() is
  'Trigger-only guard for stable identity and lineage columns on otherwise mutable records.';

revoke execute on function public.protect_total_loss_stable_columns() from public;
revoke execute on function public.protect_total_loss_stable_columns() from anon;
revoke execute on function public.protect_total_loss_stable_columns() from authenticated;
revoke execute on function public.protect_total_loss_stable_columns() from service_role;

create function public.require_total_loss_revision_increment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception using
      errcode = '40001',
      message = format('%I revision must advance by exactly one.', tg_table_name);
  end if;

  return new;
end;
$$;

comment on function public.require_total_loss_revision_increment() is
  'Trigger-only optimistic-write fence for mutable post-Continue records.';

revoke execute on function public.require_total_loss_revision_increment() from public;
revoke execute on function public.require_total_loss_revision_increment() from anon;
revoke execute on function public.require_total_loss_revision_increment() from authenticated;
revoke execute on function public.require_total_loss_revision_increment() from service_role;

create trigger total_loss_claim_workflows_protect_identity
before update on public.total_loss_claim_workflows
for each row execute function public.protect_total_loss_stable_columns(
  'case_id',
  'preliminary_snapshot_id',
  'created_at'
);
create trigger total_loss_claim_workflows_require_revision
before update on public.total_loss_claim_workflows
for each row execute function public.require_total_loss_revision_increment();

create trigger commerce_orders_protect_identity
before update on public.commerce_orders
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'purchaser_user_id',
  'preliminary_snapshot_id',
  'product_identifier',
  'product_version',
  'amount_minor_units',
  'currency',
  'terms_version',
  'refund_policy_version',
  'created_at'
);

create trigger checkout_attempts_protect_identity
before update on public.checkout_attempts
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'order_id',
  'client_request_id',
  'payment_provider',
  'amount_minor_units',
  'currency',
  'created_at'
);

create trigger case_entitlements_protect_identity
before update on public.case_entitlements
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'order_id',
  'preliminary_snapshot_id',
  'product_identifier',
  'product_version',
  'granted_at',
  'created_at'
);

create trigger total_loss_package_jobs_protect_identity
before update on public.total_loss_package_jobs
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'entitlement_id',
  'preliminary_snapshot_id',
  'created_at'
);

create trigger total_loss_claim_documents_protect_identity
before update on public.total_loss_claim_documents
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'document_kind',
  'created_by_user_id',
  'created_at'
);

create trigger total_loss_report_versions_protect_identity
before update on public.total_loss_report_versions
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'report_series_id',
  'version_number',
  'final_assessment_id',
  'preliminary_snapshot_id',
  'supersedes_report_version_id',
  'created_at'
);

create trigger total_loss_release_reviews_protect_identity
before update on public.total_loss_release_reviews
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'ai_review_run_id',
  'created_at'
);

create trigger total_loss_education_progress_protect_identity
before update on public.total_loss_education_progress
for each row execute function public.protect_total_loss_stable_columns(
  'case_id',
  'report_version_id',
  'step_identifier',
  'created_at'
);

create trigger total_loss_negotiation_rounds_protect_identity
before update on public.total_loss_negotiation_rounds
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'round_number',
  'opened_at',
  'created_at'
);
create trigger total_loss_negotiation_rounds_require_revision
before update on public.total_loss_negotiation_rounds
for each row execute function public.require_total_loss_revision_increment();

create trigger total_loss_message_drafts_protect_identity
before update on public.total_loss_message_drafts
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'negotiation_round_id',
  'purpose',
  'created_at'
);
create trigger total_loss_message_drafts_require_revision
before update on public.total_loss_message_drafts
for each row execute function public.require_total_loss_revision_increment();

create trigger total_loss_communications_protect_identity
before update on public.total_loss_communications
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'created_at'
);

create trigger total_loss_fact_assertions_protect_identity
before update on public.total_loss_fact_assertions
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'source_communication_id',
  'source_document_id',
  'source_assessment_id',
  'fact_type',
  'supersedes_fact_assertion_id',
  'created_at'
);

create trigger total_loss_offers_protect_identity
before update on public.total_loss_offers
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'negotiation_round_id',
  'source_communication_id',
  'source_fact_assertion_id',
  'amount_minor_units',
  'currency',
  'offer_kind',
  'received_at',
  'supersedes_offer_id',
  'created_at'
);

create trigger total_loss_recommendations_protect_identity
before update on public.total_loss_recommendations
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'negotiation_round_id',
  'version_number',
  'recommendation_type',
  'generation_method',
  'provider_identifier',
  'model_identifier',
  'supersedes_recommendation_id',
  'created_at'
);

alter table public.total_loss_preliminary_snapshots enable row level security;
alter table public.total_loss_claim_workflows enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.checkout_attempts enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.case_entitlements enable row level security;
alter table public.total_loss_package_jobs enable row level security;
alter table public.total_loss_final_assessments enable row level security;
alter table public.total_loss_report_series enable row level security;
alter table public.total_loss_claim_documents enable row level security;
alter table public.total_loss_report_versions enable row level security;
alter table public.total_loss_ai_review_runs enable row level security;
alter table public.total_loss_release_reviews enable row level security;
alter table public.total_loss_education_progress enable row level security;
alter table public.total_loss_negotiation_rounds enable row level security;
alter table public.total_loss_message_drafts enable row level security;
alter table public.total_loss_message_versions enable row level security;
alter table public.total_loss_communications enable row level security;
alter table public.total_loss_communication_documents enable row level security;
alter table public.total_loss_fact_assertions enable row level security;
alter table public.total_loss_offers enable row level security;
alter table public.total_loss_recommendations enable row level security;
alter table public.total_loss_workflow_events enable row level security;

revoke all on table
  public.total_loss_preliminary_snapshots,
  public.total_loss_claim_workflows,
  public.commerce_orders,
  public.checkout_attempts,
  public.payment_transactions,
  public.case_entitlements,
  public.total_loss_package_jobs,
  public.total_loss_final_assessments,
  public.total_loss_report_series,
  public.total_loss_claim_documents,
  public.total_loss_report_versions,
  public.total_loss_ai_review_runs,
  public.total_loss_release_reviews,
  public.total_loss_education_progress,
  public.total_loss_negotiation_rounds,
  public.total_loss_message_drafts,
  public.total_loss_message_versions,
  public.total_loss_communications,
  public.total_loss_communication_documents,
  public.total_loss_fact_assertions,
  public.total_loss_offers,
  public.total_loss_recommendations,
  public.total_loss_workflow_events
from public, anon, authenticated, service_role;

grant select, insert on table
  public.total_loss_preliminary_snapshots,
  public.payment_transactions,
  public.total_loss_final_assessments,
  public.total_loss_report_series,
  public.total_loss_message_versions,
  public.total_loss_workflow_events
to service_role;

grant select, insert, update on table
  public.total_loss_claim_workflows,
  public.commerce_orders,
  public.checkout_attempts,
  public.case_entitlements,
  public.total_loss_package_jobs,
  public.total_loss_claim_documents,
  public.total_loss_report_versions,
  public.total_loss_ai_review_runs,
  public.total_loss_release_reviews,
  public.total_loss_education_progress,
  public.total_loss_negotiation_rounds,
  public.total_loss_message_drafts,
  public.total_loss_communications,
  public.total_loss_fact_assertions,
  public.total_loss_offers,
  public.total_loss_recommendations
to service_role;

grant select, insert, update, delete on table
  public.total_loss_communication_documents
to service_role;

grant select on table
  public.total_loss_claim_workflows,
  public.case_entitlements,
  public.total_loss_report_series,
  public.total_loss_claim_documents,
  public.total_loss_report_versions,
  public.total_loss_education_progress,
  public.total_loss_negotiation_rounds,
  public.total_loss_message_drafts,
  public.total_loss_message_versions,
  public.total_loss_communications,
  public.total_loss_communication_documents,
  public.total_loss_fact_assertions,
  public.total_loss_offers,
  public.total_loss_recommendations
to authenticated;

grant select on table
  public.total_loss_preliminary_snapshots,
  public.total_loss_final_assessments,
  public.total_loss_ai_review_runs,
  public.total_loss_release_reviews
to authenticated;

revoke all on type public.total_loss_claim_phase from public, anon, authenticated, service_role;
revoke all on type public.commerce_order_status from public, anon, authenticated, service_role;
revoke all on type public.case_entitlement_status from public, anon, authenticated, service_role;
revoke all on type public.total_loss_communication_direction from public, anon, authenticated, service_role;
revoke all on type public.total_loss_communication_channel from public, anon, authenticated, service_role;

grant usage on type
  public.total_loss_claim_phase,
  public.case_entitlement_status,
  public.total_loss_communication_direction,
  public.total_loss_communication_channel
to authenticated;

grant usage on type
  public.total_loss_claim_phase,
  public.commerce_order_status,
  public.case_entitlement_status,
  public.total_loss_communication_direction,
  public.total_loss_communication_channel
to service_role;

create policy "Permanent owners can read their claim workflow"
on public.total_loss_claim_workflows
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their case entitlements"
on public.case_entitlements
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their report series"
on public.total_loss_report_series
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their ready claim documents"
on public.total_loss_claim_documents
for select
to authenticated
using (
  status = 'ready'
  and (select public.is_permanent_total_loss_case_owner(case_id))
);

create policy "Permanent owners can read their published reports"
on public.total_loss_report_versions
for select
to authenticated
using (
  status = 'published'
  and (select public.is_permanent_total_loss_case_owner(case_id))
);

create policy "Permanent owners can read their education progress"
on public.total_loss_education_progress
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their negotiation rounds"
on public.total_loss_negotiation_rounds
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their message drafts"
on public.total_loss_message_drafts
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their message versions"
on public.total_loss_message_versions
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their confirmed communications"
on public.total_loss_communications
for select
to authenticated
using (
  status = 'confirmed'
  and (select public.is_permanent_total_loss_case_owner(case_id))
);

create policy "Permanent owners can read their confirmed communication documents"
on public.total_loss_communication_documents
for select
to authenticated
using (
  (select public.is_permanent_total_loss_case_owner(case_id))
  and exists (
    select 1
    from public.total_loss_communications as communication
    where communication.id = total_loss_communication_documents.communication_id
      and communication.case_id = total_loss_communication_documents.case_id
      and communication.status = 'confirmed'
  )
);

create policy "Permanent owners can read their confirmed facts"
on public.total_loss_fact_assertions
for select
to authenticated
using (
  status = 'confirmed'
  and (select public.is_permanent_total_loss_case_owner(case_id))
);

create policy "Permanent owners can read their recorded offers"
on public.total_loss_offers
for select
to authenticated
using ((select public.is_permanent_total_loss_case_owner(case_id)));

create policy "Permanent owners can read their published recommendations"
on public.total_loss_recommendations
for select
to authenticated
using (
  status = 'published'
  and (select public.is_permanent_total_loss_case_owner(case_id))
);

create policy "Staff can read post-Continue preliminary snapshots"
on public.total_loss_preliminary_snapshots
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

create policy "Staff can read post-Continue final assessments"
on public.total_loss_final_assessments
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

create policy "Staff can read post-Continue claim documents"
on public.total_loss_claim_documents
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

create policy "Staff can read post-Continue report versions"
on public.total_loss_report_versions
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

create policy "Staff can read post-Continue AI review runs"
on public.total_loss_ai_review_runs
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

create policy "Staff can read post-Continue release reviews"
on public.total_loss_release_reviews
for select
to authenticated
using (
  (select public.is_venfour_staff())
  and not public.current_auth_user_is_anonymous()
);

comment on policy "Permanent owners can read their claim workflow"
on public.total_loss_claim_workflows is
  'Current permanent case ownership is authoritative; anonymous Auth owners are denied.';
comment on policy "Staff can read post-Continue release reviews"
on public.total_loss_release_reviews is
  'Exception-queue visibility is based only on database-managed staff membership.';
