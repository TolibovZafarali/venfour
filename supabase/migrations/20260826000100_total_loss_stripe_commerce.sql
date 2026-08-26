-- Additive Stripe commerce execution and entitlement fulfillment for Total Loss.

alter table public.commerce_orders
add column provider_livemode boolean,
add column purchaser_email text,
add constraint commerce_orders_purchaser_email_safe
  check (
    purchaser_email is null
    or (
      char_length(purchaser_email) between 3 and 320
      and purchaser_email = lower(btrim(purchaser_email))
      and purchaser_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and purchaser_email !~ '[[:cntrl:]]'
      and purchaser_email !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  );

comment on column public.commerce_orders.provider_livemode is
  'Frozen Stripe environment for this order; null is retained only for pre-Milestone-3 foundation fixtures.';
comment on column public.commerce_orders.purchaser_email is
  'Frozen verified purchaser email used for provider contract validation; null is retained only for pre-Milestone-3 foundation fixtures.';

alter table public.checkout_attempts
add column provider_livemode boolean,
add column request_chain_id uuid,
add column attempt_generation integer not null default 1;

update public.checkout_attempts
set request_chain_id = client_request_id
where request_chain_id is null;

alter table public.checkout_attempts
alter column request_chain_id set not null,
add constraint checkout_attempts_generation_positive
  check (attempt_generation >= 1),
add constraint checkout_attempts_request_generation_key
  unique (order_id, request_chain_id, attempt_generation);

comment on column public.checkout_attempts.provider_livemode is
  'Frozen Stripe environment copied from the logical order.';
comment on column public.checkout_attempts.request_chain_id is
  'Stable client request identity across controlled replacement attempts.';
comment on column public.checkout_attempts.attempt_generation is
  'One-based generation within a client request chain; every generation has its own Stripe idempotency key derived from the attempt ID.';

create function public.default_total_loss_checkout_request_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.request_chain_id is null then
    new.request_chain_id := new.client_request_id;
  end if;
  return new;
end;
$$;

comment on function public.default_total_loss_checkout_request_chain() is
  'Trigger-only backward-compatibility default mapping legacy direct attempt inserts to a first-generation request chain.';

revoke execute on function public.default_total_loss_checkout_request_chain()
  from public, anon, authenticated, service_role;

create trigger checkout_attempts_default_request_chain
before insert on public.checkout_attempts
for each row execute function public.default_total_loss_checkout_request_chain();

drop trigger commerce_orders_protect_identity on public.commerce_orders;
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
  'payment_provider',
  'external_price_identifier',
  'provider_livemode',
  'purchaser_email',
  'terms_version',
  'refund_policy_version',
  'created_at'
);

drop trigger checkout_attempts_protect_identity on public.checkout_attempts;
create trigger checkout_attempts_protect_identity
before update on public.checkout_attempts
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'order_id',
  'client_request_id',
  'request_chain_id',
  'attempt_generation',
  'payment_provider',
  'provider_livemode',
  'amount_minor_units',
  'currency',
  'created_at'
);

create function public.protect_total_loss_checkout_attempt_terminal_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('complete', 'expired', 'failed')
    and (
      new.status is distinct from old.status
      or new.external_checkout_session_id is distinct from old.external_checkout_session_id
      or new.external_payment_intent_id is distinct from old.external_payment_intent_id
      or new.external_customer_id is distinct from old.external_customer_id
      or new.expires_at is distinct from old.expires_at
      or new.finished_at is distinct from old.finished_at
      or new.failure_code is distinct from old.failure_code
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Terminal Checkout attempt is immutable.';
  end if;
  return new;
end;
$$;

comment on function public.protect_total_loss_checkout_attempt_terminal_state() is
  'Trigger-only defense preventing stale observations from reopening or rewriting a terminal Checkout attempt.';

revoke execute on function public.protect_total_loss_checkout_attempt_terminal_state()
  from public, anon, authenticated, service_role;

create trigger checkout_attempts_protect_terminal_state
before update on public.checkout_attempts
for each row execute function public.protect_total_loss_checkout_attempt_terminal_state();

create table public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  external_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  api_version text,
  payload_sha256 text not null,
  payload_size integer not null,
  provider_created_at timestamptz not null,
  status text not null default 'processing',
  attempt_count integer not null default 1,
  processing_token uuid,
  processing_started_at timestamptz,
  case_id uuid references public.appraisal_cases (id) on delete restrict,
  order_id uuid,
  failure_code text,
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint stripe_webhook_events_external_event_key
    unique (external_event_id),
  constraint stripe_webhook_events_order_case_fkey
    foreign key (order_id, case_id)
    references public.commerce_orders (id, case_id)
    on delete restrict,
  constraint stripe_webhook_events_external_event_safe
    check (char_length(external_event_id) between 1 and 255),
  constraint stripe_webhook_events_type_safe
    check (event_type ~ '^[a-z][a-z0-9_.]{0,127}$'),
  constraint stripe_webhook_events_api_version_safe
    check (
      api_version is null
      or char_length(api_version) between 1 and 63
    ),
  constraint stripe_webhook_events_digest_valid
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint stripe_webhook_events_payload_size_valid
    check (payload_size between 1 and 262144),
  constraint stripe_webhook_events_status_valid
    check (status in ('processing', 'processed', 'ignored', 'failed')),
  constraint stripe_webhook_events_attempt_count_positive
    check (attempt_count >= 1),
  constraint stripe_webhook_events_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint stripe_webhook_events_case_order_complete
    check ((case_id is null) = (order_id is null)),
  constraint stripe_webhook_events_state_complete
    check (
      (
        status = 'processing'
        and processing_token is not null
        and processing_started_at is not null
        and processed_at is null
        and failure_code is null
      )
      or (
        status in ('processed', 'ignored')
        and processing_token is null
        and processing_started_at is null
        and processed_at is not null
        and failure_code is null
      )
      or (
        status = 'failed'
        and processing_token is null
        and processing_started_at is null
        and processed_at is not null
        and failure_code is not null
      )
    )
);

comment on table public.stripe_webhook_events is
  'Bounded Stripe webhook deduplication and processing audit. Raw webhook payloads are never stored.';
comment on column public.stripe_webhook_events.payload_sha256 is
  'SHA-256 digest of the exact signature-verified raw body.';

create index stripe_webhook_events_status_updated_idx
  on public.stripe_webhook_events (status, updated_at);
create index stripe_webhook_events_order_received_idx
  on public.stripe_webhook_events (order_id, received_at desc)
  where order_id is not null;

create trigger stripe_webhook_events_set_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_updated_at();

create trigger stripe_webhook_events_protect_identity
before update on public.stripe_webhook_events
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'external_event_id',
  'event_type',
  'livemode',
  'api_version',
  'payload_sha256',
  'payload_size',
  'provider_created_at',
  'received_at'
);

create table public.commerce_refund_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  order_id uuid not null,
  payment_transaction_id uuid not null,
  client_request_id uuid not null,
  payment_provider text not null default 'stripe',
  provider_livemode boolean not null,
  external_refund_id text,
  external_balance_transaction_id text,
  external_failure_balance_transaction_id text,
  refund_transaction_id uuid references public.payment_transactions (id) on delete restrict,
  refund_reversal_transaction_id uuid references public.payment_transactions (id) on delete restrict,
  access_policy text not null,
  reason_code text not null,
  amount_minor_units bigint not null,
  currency text not null,
  status text not null default 'creating',
  provider_status text,
  failure_code text,
  provider_occurred_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  constraint commerce_refund_requests_id_case_key
    unique (id, case_id),
  constraint commerce_refund_requests_order_request_key
    unique (order_id, client_request_id),
  constraint commerce_refund_requests_payment_identity_fkey
    foreign key (
      payment_transaction_id,
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
    ) on delete restrict,
  constraint commerce_refund_requests_order_amount_fkey
    foreign key (order_id, case_id, amount_minor_units, currency)
    references public.commerce_orders (id, case_id, amount_minor_units, currency)
    on delete restrict,
  constraint commerce_refund_requests_provider_safe
    check (payment_provider = 'stripe'),
  constraint commerce_refund_requests_external_refund_safe
    check (
      external_refund_id is null
      or char_length(external_refund_id) between 1 and 255
    ),
  constraint commerce_refund_requests_balance_ids_safe
    check (
      (
        external_balance_transaction_id is null
        or external_balance_transaction_id ~ '^txn_[A-Za-z0-9_]{1,250}$'
      )
      and (
        external_failure_balance_transaction_id is null
        or external_failure_balance_transaction_id ~ '^txn_[A-Za-z0-9_]{1,250}$'
      )
    ),
  constraint commerce_refund_requests_access_policy_valid
    check (access_policy in ('retain', 'revoke')),
  constraint commerce_refund_requests_reason_safe
    check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint commerce_refund_requests_amount_positive
    check (amount_minor_units > 0),
  constraint commerce_refund_requests_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint commerce_refund_requests_status_valid
    check (status in ('creating', 'pending', 'succeeded', 'failed', 'canceled')),
  constraint commerce_refund_requests_provider_status_valid
    check (
      provider_status is null
      or provider_status in (
        'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
      )
    ),
  constraint commerce_refund_requests_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint commerce_refund_requests_state_complete
    check (
      (
        status = 'creating'
        and external_refund_id is null
        and provider_occurred_at is null
        and finished_at is null
        and provider_status is null
        and failure_code is null
        and external_balance_transaction_id is null
        and external_failure_balance_transaction_id is null
        and refund_transaction_id is null
        and refund_reversal_transaction_id is null
      )
      or (
        status = 'pending'
        and external_refund_id is not null
        and provider_occurred_at is not null
        and finished_at is null
        and provider_status in ('pending', 'requires_action')
        and failure_code is null
        and external_failure_balance_transaction_id is null
        and refund_transaction_id is null
        and refund_reversal_transaction_id is null
      )
      or (
        status = 'succeeded'
        and external_refund_id is not null
        and provider_occurred_at is not null
        and finished_at is not null
        and provider_status = 'succeeded'
        and failure_code is null
        and external_balance_transaction_id is not null
        and external_failure_balance_transaction_id is null
        and refund_transaction_id is not null
        and refund_reversal_transaction_id is null
      )
      or (
        status in ('failed', 'canceled')
        and provider_occurred_at is not null
        and finished_at is not null
        and provider_status = status
        and failure_code is not null
        and (
          (
            external_balance_transaction_id is null
            and external_failure_balance_transaction_id is null
            and refund_transaction_id is null
            and refund_reversal_transaction_id is null
          )
          or (
            external_balance_transaction_id is not null
            and external_failure_balance_transaction_id is not null
            and refund_transaction_id is not null
            and refund_reversal_transaction_id is not null
          )
        )
      )
    )
);

comment on table public.commerce_refund_requests is
  'Server-only idempotent full-refund operation state; successful material movements are separately immutable payment transactions.';

create unique index commerce_refund_requests_provider_object_key
  on public.commerce_refund_requests (payment_provider, external_refund_id)
  where external_refund_id is not null;
create unique index commerce_refund_requests_balance_transaction_key
  on public.commerce_refund_requests (
    payment_provider,
    external_balance_transaction_id
  ) where external_balance_transaction_id is not null;
create unique index commerce_refund_requests_failure_balance_transaction_key
  on public.commerce_refund_requests (
    payment_provider,
    external_failure_balance_transaction_id
  ) where external_failure_balance_transaction_id is not null;
create unique index commerce_refund_requests_one_active_payment_idx
  on public.commerce_refund_requests (payment_transaction_id)
  where status in ('creating', 'pending');

create trigger commerce_refund_requests_set_updated_at
before update on public.commerce_refund_requests
for each row execute function public.set_updated_at();

create trigger commerce_refund_requests_protect_identity
before update on public.commerce_refund_requests
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'order_id',
  'payment_transaction_id',
  'client_request_id',
  'payment_provider',
  'provider_livemode',
  'access_policy',
  'reason_code',
  'amount_minor_units',
  'currency',
  'created_at'
);

create function public.protect_total_loss_refund_financial_facts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.external_balance_transaction_id is not null
    and (
      new.external_balance_transaction_id is distinct from old.external_balance_transaction_id
      or new.refund_transaction_id is distinct from old.refund_transaction_id
    )
  then
    raise exception using errcode = '55000', message = 'Refund financial evidence is immutable.';
  end if;

  if old.external_failure_balance_transaction_id is not null
    and (
      new.external_failure_balance_transaction_id is distinct from old.external_failure_balance_transaction_id
      or new.refund_reversal_transaction_id is distinct from old.refund_reversal_transaction_id
    )
  then
    raise exception using errcode = '55000', message = 'Refund reversal evidence is immutable.';
  end if;

  return new;
end;
$$;

comment on function public.protect_total_loss_refund_financial_facts() is
  'Trigger-only guard freezing Stripe refund and failure balance-transaction evidence once recorded.';

revoke execute on function public.protect_total_loss_refund_financial_facts()
  from public, anon, authenticated, service_role;

create trigger commerce_refund_requests_protect_financial_facts
before update on public.commerce_refund_requests
for each row execute function public.protect_total_loss_refund_financial_facts();

create table public.commerce_disputes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  order_id uuid not null,
  payment_transaction_id uuid not null,
  payment_provider text not null default 'stripe',
  provider_livemode boolean not null,
  external_dispute_id text not null,
  latest_external_event_id text not null,
  status text not null,
  amount_minor_units bigint not null,
  currency text not null,
  prior_order_status public.commerce_order_status not null,
  prior_entitlement_status public.case_entitlement_status,
  prior_entitlement_reason_code text,
  provider_occurred_at timestamptz not null,
  funds_withdrawn_external_event_id text,
  funds_withdrawn_occurred_at timestamptz,
  funds_withdrawn_transaction_id uuid references public.payment_transactions (id) on delete restrict,
  funds_reinstated_external_event_id text,
  funds_reinstated_occurred_at timestamptz,
  funds_reinstated_transaction_id uuid references public.payment_transactions (id) on delete restrict,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint commerce_disputes_id_case_key
    unique (id, case_id),
  constraint commerce_disputes_provider_object_key
    unique (payment_provider, external_dispute_id),
  constraint commerce_disputes_payment_identity_fkey
    foreign key (
      payment_transaction_id,
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
    ) on delete restrict,
  constraint commerce_disputes_order_currency_fkey
    foreign key (order_id, case_id, currency)
    references public.commerce_orders (id, case_id, currency)
    on delete restrict,
  constraint commerce_disputes_provider_safe
    check (payment_provider = 'stripe'),
  constraint commerce_disputes_external_ids_safe
    check (
      char_length(external_dispute_id) between 1 and 240
      and char_length(latest_external_event_id) between 1 and 255
      and (
        funds_withdrawn_external_event_id is null
        or char_length(funds_withdrawn_external_event_id) between 1 and 255
      )
      and (
        funds_reinstated_external_event_id is null
        or char_length(funds_reinstated_external_event_id) between 1 and 255
      )
    ),
  constraint commerce_disputes_status_valid
    check (status in ('active', 'won', 'lost')),
  constraint commerce_disputes_amount_positive
    check (amount_minor_units > 0),
  constraint commerce_disputes_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint commerce_disputes_prior_reason_safe
    check (
      prior_entitlement_reason_code is null
      or prior_entitlement_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint commerce_disputes_state_complete
    check (
      (status = 'active' and opened_at is not null and closed_at is null)
      or (status in ('won', 'lost') and closed_at is not null)
    ),
  constraint commerce_disputes_funds_withdrawn_complete
    check (
      (funds_withdrawn_external_event_id is null)
        = (funds_withdrawn_occurred_at is null)
      and (funds_withdrawn_external_event_id is null)
        = (funds_withdrawn_transaction_id is null)
    ),
  constraint commerce_disputes_funds_reinstated_complete
    check (
      (funds_reinstated_external_event_id is null)
        = (funds_reinstated_occurred_at is null)
      and (
        funds_reinstated_transaction_id is null
        or funds_reinstated_external_event_id is not null
      )
    )
);

comment on table public.commerce_disputes is
  'Server-only current Stripe dispute projection with immutable financial movements retained in payment_transactions and every provider event retained by digest.';

create unique index commerce_disputes_latest_event_key
  on public.commerce_disputes (payment_provider, latest_external_event_id);
create unique index commerce_disputes_withdrawn_event_key
  on public.commerce_disputes (payment_provider, funds_withdrawn_external_event_id)
  where funds_withdrawn_external_event_id is not null;
create unique index commerce_disputes_reinstated_event_key
  on public.commerce_disputes (payment_provider, funds_reinstated_external_event_id)
  where funds_reinstated_external_event_id is not null;
create index commerce_disputes_order_status_idx
  on public.commerce_disputes (order_id, status, updated_at desc);

create trigger commerce_disputes_set_updated_at
before update on public.commerce_disputes
for each row execute function public.set_updated_at();

create trigger commerce_disputes_protect_identity
before update on public.commerce_disputes
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'order_id',
  'payment_transaction_id',
  'payment_provider',
  'provider_livemode',
  'external_dispute_id',
  'amount_minor_units',
  'currency',
  'prior_order_status',
  'prior_entitlement_status',
  'prior_entitlement_reason_code',
  'created_at'
);

create function public.protect_total_loss_dispute_fund_facts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.funds_withdrawn_external_event_id is not null
    and (
      new.funds_withdrawn_external_event_id is distinct from old.funds_withdrawn_external_event_id
      or new.funds_withdrawn_occurred_at is distinct from old.funds_withdrawn_occurred_at
      or new.funds_withdrawn_transaction_id is distinct from old.funds_withdrawn_transaction_id
    )
  then
    raise exception using errcode = '55000', message = 'Dispute funds-withdrawn evidence is immutable.';
  end if;

  if old.funds_reinstated_external_event_id is not null
    and (
      new.funds_reinstated_external_event_id is distinct from old.funds_reinstated_external_event_id
      or new.funds_reinstated_occurred_at is distinct from old.funds_reinstated_occurred_at
      or (
        old.funds_reinstated_transaction_id is not null
        and new.funds_reinstated_transaction_id is distinct from old.funds_reinstated_transaction_id
      )
    )
  then
    raise exception using errcode = '55000', message = 'Dispute funds-reinstated evidence is immutable.';
  end if;

  return new;
end;
$$;

comment on function public.protect_total_loss_dispute_fund_facts() is
  'Trigger-only guard freezing each signed Stripe funds movement while allowing a deferred reversal link when reinstatement arrives first.';

revoke execute on function public.protect_total_loss_dispute_fund_facts()
  from public, anon, authenticated, service_role;

create trigger commerce_disputes_protect_fund_facts
before update on public.commerce_disputes
for each row execute function public.protect_total_loss_dispute_fund_facts();

alter table public.stripe_webhook_events enable row level security;
alter table public.commerce_refund_requests enable row level security;
alter table public.commerce_disputes enable row level security;

revoke all on table
  public.stripe_webhook_events,
  public.commerce_refund_requests,
  public.commerce_disputes
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.stripe_webhook_events,
  public.commerce_refund_requests,
  public.commerce_disputes
to service_role;

create type public.total_loss_checkout_reservation_result as (
  state text,
  case_id uuid,
  order_id uuid,
  order_status text,
  purchaser_user_id uuid,
  checkout_attempt_id uuid,
  client_request_id uuid,
  attempt_generation integer,
  attempt_status text,
  external_checkout_session_id text,
  external_payment_intent_id text,
  amount_minor_units bigint,
  currency text,
  external_price_identifier text,
  provider_livemode boolean,
  expires_at timestamptz,
  purchaser_email text,
  entitlement_status text
);

create type public.total_loss_checkout_preflight_result as (
  case_id uuid,
  purchaser_user_id uuid,
  purchaser_email text,
  preliminary_snapshot_id uuid,
  workflow_revision bigint,
  checkout_available boolean,
  has_pending_order boolean
);

create type public.total_loss_checkout_reconciliation_result as (
  outcome text,
  case_id uuid,
  order_id uuid,
  checkout_attempt_id uuid,
  order_status text,
  attempt_status text,
  entitlement_status text
);

create type public.total_loss_checkout_fulfillment_result as (
  outcome text,
  case_id uuid,
  order_id uuid,
  order_status text,
  checkout_attempt_id uuid,
  payment_transaction_id uuid,
  entitlement_id uuid,
  entitlement_status text
);

create type public.stripe_webhook_claim_result as (
  state text,
  webhook_event_id uuid,
  processing_token uuid,
  status text,
  attempt_count integer
);

create type public.stripe_webhook_finalize_result as (
  webhook_event_id uuid,
  status text,
  attempt_count integer
);

create type public.total_loss_stripe_context_result as (
  case_id uuid,
  order_id uuid,
  checkout_attempt_id uuid,
  payment_transaction_id uuid,
  purchaser_user_id uuid,
  purchaser_email text,
  preliminary_snapshot_id uuid,
  product_identifier text,
  product_version text,
  external_price_identifier text,
  amount_minor_units bigint,
  currency text,
  provider_livemode boolean,
  external_checkout_session_id text,
  external_payment_intent_id text,
  checkout_attempt_status text,
  order_status text,
  entitlement_id uuid,
  entitlement_status text
);

create type public.total_loss_refund_reservation_result as (
  state text,
  case_id uuid,
  order_id uuid,
  payment_transaction_id uuid,
  refund_request_id uuid,
  refund_status text,
  provider_status text,
  external_refund_id text,
  external_payment_intent_id text,
  amount_minor_units bigint,
  currency text,
  provider_livemode boolean,
  access_policy text,
  refund_transaction_id uuid,
  refund_reversal_transaction_id uuid,
  order_status text,
  entitlement_status text
);

create type public.total_loss_refund_result as (
  outcome text,
  case_id uuid,
  order_id uuid,
  refund_request_id uuid,
  refund_status text,
  provider_status text,
  refund_transaction_id uuid,
  refund_reversal_transaction_id uuid,
  order_status text,
  entitlement_status text
);

create type public.total_loss_dispute_result as (
  outcome text,
  case_id uuid,
  order_id uuid,
  dispute_id uuid,
  dispute_status text,
  financial_transaction_id uuid,
  order_status text,
  entitlement_status text
);

revoke all on type
  public.total_loss_checkout_reservation_result,
  public.total_loss_checkout_preflight_result,
  public.total_loss_checkout_reconciliation_result,
  public.total_loss_checkout_fulfillment_result,
  public.stripe_webhook_claim_result,
  public.stripe_webhook_finalize_result,
  public.total_loss_stripe_context_result,
  public.total_loss_refund_reservation_result,
  public.total_loss_refund_result,
  public.total_loss_dispute_result
from public, anon, authenticated;

grant usage on type
  public.total_loss_checkout_reservation_result,
  public.total_loss_checkout_preflight_result,
  public.total_loss_checkout_reconciliation_result,
  public.total_loss_checkout_fulfillment_result,
  public.stripe_webhook_claim_result,
  public.stripe_webhook_finalize_result,
  public.total_loss_stripe_context_result,
  public.total_loss_refund_reservation_result,
  public.total_loss_refund_result,
  public.total_loss_dispute_result
to service_role;

create function public.project_total_loss_order_coverage_internal(
  requested_order_id uuid,
  requested_recorded_at timestamptz
)
returns table (
  order_status text,
  entitlement_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_case_id uuid;
  order_row public.commerce_orders%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  latest_refund public.commerce_refund_requests%rowtype;
  payment_count integer;
  clean_payment_count integer;
  refunded_payment_count integer;
  adverse_dispute_count integer;
  unrefunded_adverse_payment_count integer;
  target_order_status public.commerce_order_status;
  target_entitlement_status public.case_entitlement_status;
  target_refunded_at timestamptz;
  target_reason_code text;
begin
  if requested_order_id is null or requested_recorded_at is null then
    raise exception using
      errcode = '22023',
      message = 'Order coverage projection input is invalid.';
  end if;

  select commerce_order.case_id
  into locked_case_id
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id;

  if not found then
    raise exception using errcode = '22023', message = 'Order coverage context is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(locked_case_id::text)
  );

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = locked_case_id
  for update;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.order_id = requested_order_id
    and entitlement.case_id = locked_case_id
  for update;

  if order_row.id is null
    or order_row.payment_provider <> 'stripe'
    or order_row.paid_at is null
    or entitlement_row.id is null
  then
    raise exception using errcode = '55000', message = 'Order coverage context is inconsistent.';
  end if;

  with payment_coverage as (
    select
      payment_transaction.id,
      exists (
        select 1
        from public.commerce_refund_requests as refund_request
        where refund_request.payment_transaction_id = payment_transaction.id
          and refund_request.order_id = requested_order_id
          and refund_request.status = 'succeeded'
          and refund_request.refund_transaction_id is not null
          and refund_request.refund_reversal_transaction_id is null
      ) as is_refunded,
      exists (
        select 1
        from public.commerce_disputes as dispute
        where dispute.payment_transaction_id = payment_transaction.id
          and dispute.order_id = requested_order_id
          and dispute.status in ('active', 'lost')
      ) as has_adverse_dispute
    from public.payment_transactions as payment_transaction
    where payment_transaction.order_id = requested_order_id
      and payment_transaction.case_id = locked_case_id
      and payment_transaction.payment_provider = 'stripe'
      and payment_transaction.transaction_kind = 'payment'
  )
  select
    count(*)::integer,
    count(*) filter (
      where not payment_coverage.is_refunded
        and not payment_coverage.has_adverse_dispute
    )::integer,
    count(*) filter (where payment_coverage.is_refunded)::integer,
    count(*) filter (where payment_coverage.has_adverse_dispute)::integer,
    count(*) filter (
      where not payment_coverage.is_refunded
        and payment_coverage.has_adverse_dispute
    )::integer
  into
    payment_count,
    clean_payment_count,
    refunded_payment_count,
    adverse_dispute_count,
    unrefunded_adverse_payment_count
  from payment_coverage;

  if payment_count = 0 then
    raise exception using errcode = '55000', message = 'Paid order has no successful payment evidence.';
  elsif clean_payment_count > 0 then
    target_order_status := 'paid';
    target_entitlement_status := 'active';
    target_refunded_at := null;
    target_reason_code := null;
  elsif refunded_payment_count = payment_count then
    select refund_request.*
    into latest_refund
    from public.commerce_refund_requests as refund_request
    where refund_request.order_id = requested_order_id
      and refund_request.status = 'succeeded'
      and refund_request.refund_transaction_id is not null
      and refund_request.refund_reversal_transaction_id is null
    order by
      refund_request.provider_occurred_at desc,
      refund_request.created_at desc,
      refund_request.id desc
    limit 1;

    if latest_refund.id is null then
      raise exception using errcode = '55000', message = 'Refunded coverage lacks material refund evidence.';
    end if;

    target_order_status := 'refunded';
    target_refunded_at := latest_refund.provider_occurred_at;
    if adverse_dispute_count > 0 then
      target_entitlement_status := 'suspended';
      target_reason_code := 'STRIPE_DISPUTE';
    elsif latest_refund.access_policy = 'retain' then
      target_entitlement_status := 'refunded_access_retained';
      target_reason_code := latest_refund.reason_code;
    else
      target_entitlement_status := 'revoked';
      target_reason_code := latest_refund.reason_code;
    end if;
  elsif unrefunded_adverse_payment_count > 0 then
    target_order_status := 'disputed';
    target_entitlement_status := 'suspended';
    target_refunded_at := null;
    target_reason_code := 'STRIPE_DISPUTE';
  else
    raise exception using errcode = '55000', message = 'Order coverage cannot be projected deterministically.';
  end if;

  if order_row.status is distinct from target_order_status
    or order_row.refunded_at is distinct from target_refunded_at
  then
    update public.commerce_orders
    set
      status = target_order_status,
      refunded_at = target_refunded_at
    where id = order_row.id
    returning * into order_row;
  end if;

  if entitlement_row.status is distinct from target_entitlement_status
    or entitlement_row.reason_code is distinct from target_reason_code
    or (
      target_entitlement_status = 'revoked'
      and entitlement_row.revoked_at is null
    )
    or (
      target_entitlement_status <> 'revoked'
      and entitlement_row.revoked_at is not null
    )
  then
    update public.case_entitlements
    set
      status = target_entitlement_status,
      status_changed_at = requested_recorded_at,
      revoked_at = case
        when target_entitlement_status = 'revoked'
          then coalesce(revoked_at, requested_recorded_at)
        else null
      end,
      reason_code = target_reason_code
    where id = entitlement_row.id
    returning * into entitlement_row;
  end if;

  return query select order_row.status::text, entitlement_row.status::text;
end;
$$;

comment on function public.project_total_loss_order_coverage_internal(uuid, timestamptz) is
  'Internal aggregate projection across every successful Stripe payment, effective full refund, and adverse dispute for one logical order.';

revoke execute on function public.project_total_loss_order_coverage_internal(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function public.authorize_total_loss_checkout_preflight(
  requested_case_id uuid,
  requested_purchaser_user_id uuid
)
returns setof public.total_loss_checkout_preflight_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    appraisal_case.id,
    appraisal_case.user_id,
    lower(btrim(auth_user.email)),
    workflow.preliminary_snapshot_id,
    workflow.revision,
    (
      not exists (
        select 1
        from public.case_entitlements as entitlement
        where entitlement.case_id = appraisal_case.id
          and entitlement.status <> 'revoked'
      )
      and not exists (
        select 1
        from public.commerce_orders as blocked_order
        where blocked_order.case_id = appraisal_case.id
          and (
            blocked_order.status <> 'pending'
            or blocked_order.purchaser_email is null
          )
      )
      and not exists (
        select 1
        from public.commerce_orders as pending_order
        join public.checkout_attempts as completed_attempt
          on completed_attempt.order_id = pending_order.id
          and completed_attempt.case_id = pending_order.case_id
        where pending_order.case_id = appraisal_case.id
          and pending_order.status = 'pending'
          and completed_attempt.status = 'complete'
      )
    ),
    exists (
      select 1
      from public.commerce_orders as pending_order
      where pending_order.case_id = appraisal_case.id
        and pending_order.status = 'pending'
    )
  from public.appraisal_cases as appraisal_case
  join auth.users as auth_user
    on auth_user.id = appraisal_case.user_id
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = appraisal_case.id
  join public.total_loss_preliminary_snapshots as snapshot
    on snapshot.id = workflow.preliminary_snapshot_id
    and snapshot.case_id = workflow.case_id
  join public.total_loss_case_operations_internal as operation
    on operation.case_id = appraisal_case.id
    and operation.analysis_job_id = snapshot.analysis_job_id
    and operation.analysis_run_id = snapshot.analysis_run_id
    and operation.intake_mode = snapshot.source_intake_mode
    and operation.analysis_input_revision = snapshot.source_analysis_input_revision
    and operation.analysis_input_id is not distinct from snapshot.source_analysis_input_id
    and (
      (
        operation.intake_mode = 'report'
        and operation.report_last_upload_id = snapshot.source_report_upload_id
      )
      or (
        operation.intake_mode = 'manual'
        and snapshot.source_report_upload_id is null
      )
    )
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = requested_purchaser_user_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(auth_user.is_anonymous, false)
    and auth_user.email_confirmed_at is not null
    and nullif(btrim(auth_user.email), '') is not null
    and lower(btrim(auth_user.email)) = contact.email
    and workflow.phase = 'review'
    and workflow.current_task = 'secure_claim'
    and operation.case_stage = 'analysis_complete'
    and snapshot.preliminary_classification = operation.analysis_classification
    and snapshot.preliminary_classification in (
      'MATERIAL_UNDERVALUE_SIGNAL',
      'POTENTIAL_UNDERVALUE'
    );
$$;

comment on function public.authorize_total_loss_checkout_preflight(uuid, uuid) is
  'Service-only owner, verified-identity, current-snapshot, and purchase-boundary authorization performed before any Stripe Price lookup.';

create function public.reserve_total_loss_checkout(
  requested_case_id uuid,
  requested_purchaser_user_id uuid,
  requested_client_request_id uuid,
  configured_product_identifier text,
  configured_product_version text,
  configured_external_price_identifier text,
  configured_amount_minor_units bigint,
  configured_currency text,
  configured_terms_version text,
  configured_refund_policy_version text,
  configured_provider_livemode boolean
)
returns setof public.total_loss_checkout_reservation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  purchaser_email text;
  snapshot_id uuid;
  order_row public.commerce_orders%rowtype;
  attempt_row public.checkout_attempts%rowtype;
  prior_attempt public.checkout_attempts%rowtype;
  entitlement_status_value text;
  result_row public.total_loss_checkout_reservation_result;
  internal_client_request_id uuid;
  next_generation integer;
  entitled_order_id uuid;
begin
  if requested_case_id is null
    or requested_purchaser_user_id is null
    or requested_client_request_id is null
    or configured_provider_livemode is null
    or configured_amount_minor_units is null
    or configured_amount_minor_units <= 0
    or configured_product_identifier is null
    or configured_product_identifier !~ '^[a-z][a-z0-9_-]{0,63}$'
    or configured_product_version is null
    or configured_product_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or configured_external_price_identifier is null
    or configured_external_price_identifier !~ '^price_[A-Za-z0-9_]{1,249}$'
    or configured_currency is null
    or configured_currency !~ '^[A-Z]{3}$'
    or configured_terms_version is null
    or configured_terms_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or configured_refund_policy_version is null
    or configured_refund_policy_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Checkout configuration is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select lower(btrim(auth_user.email)), workflow.preliminary_snapshot_id
  into purchaser_email, snapshot_id
  from public.appraisal_cases as appraisal_case
  join auth.users as auth_user
    on auth_user.id = appraisal_case.user_id
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = appraisal_case.id
  join public.total_loss_preliminary_snapshots as snapshot
    on snapshot.id = workflow.preliminary_snapshot_id
    and snapshot.case_id = workflow.case_id
  join public.total_loss_case_operations_internal as operation
    on operation.case_id = appraisal_case.id
    and operation.analysis_job_id = snapshot.analysis_job_id
    and operation.analysis_run_id = snapshot.analysis_run_id
    and operation.intake_mode = snapshot.source_intake_mode
    and operation.analysis_input_revision = snapshot.source_analysis_input_revision
    and operation.analysis_input_id is not distinct from snapshot.source_analysis_input_id
    and (
      (
        operation.intake_mode = 'report'
        and operation.report_last_upload_id = snapshot.source_report_upload_id
      )
      or (
        operation.intake_mode = 'manual'
        and snapshot.source_report_upload_id is null
      )
    )
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = requested_purchaser_user_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(auth_user.is_anonymous, false)
    and auth_user.email_confirmed_at is not null
    and nullif(btrim(auth_user.email), '') is not null
    and lower(btrim(auth_user.email)) = contact.email
    and workflow.phase = 'review'
    and workflow.current_task = 'secure_claim'
    and operation.case_stage = 'analysis_complete'
    and snapshot.preliminary_classification = operation.analysis_classification
    and snapshot.preliminary_classification in (
      'MATERIAL_UNDERVALUE_SIGNAL',
      'POTENTIAL_UNDERVALUE'
    )
  for update of appraisal_case, workflow;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Case is not eligible for checkout.';
  end if;

  select entitlement.status::text, commerce_order.id
  into entitlement_status_value, entitled_order_id
  from public.case_entitlements as entitlement
  join public.commerce_orders as commerce_order
    on commerce_order.id = entitlement.order_id
  where entitlement.case_id = requested_case_id
    and entitlement.product_identifier = configured_product_identifier
    and entitlement.status <> 'revoked'
  order by entitlement.created_at desc
  limit 1
  for update of commerce_order, entitlement;

  if entitled_order_id is not null then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = entitled_order_id
    for update;
    result_row.state := 'already_fulfilled';
  else
    if exists (
      select 1
      from public.commerce_orders as conflicting_order
      where conflicting_order.case_id = requested_case_id
        and conflicting_order.product_identifier = configured_product_identifier
        and (
          conflicting_order.product_version is distinct from configured_product_version
          or conflicting_order.preliminary_snapshot_id is distinct from snapshot_id
        )
    ) then
      raise exception using
        errcode = '55000',
        message = 'Another logical order already exists for this case and product.';
    end if;

    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.case_id = requested_case_id
      and commerce_order.product_identifier = configured_product_identifier
      and commerce_order.product_version = configured_product_version
      and commerce_order.preliminary_snapshot_id = snapshot_id
    for update;

    if found then
      if order_row.purchaser_user_id is distinct from requested_purchaser_user_id
        or order_row.purchaser_email is distinct from purchaser_email
        or order_row.amount_minor_units is distinct from configured_amount_minor_units
        or order_row.currency is distinct from configured_currency
        or order_row.payment_provider is distinct from 'stripe'
        or order_row.external_price_identifier is distinct from configured_external_price_identifier
        or order_row.provider_livemode is distinct from configured_provider_livemode
        or order_row.terms_version is distinct from configured_terms_version
        or order_row.refund_policy_version is distinct from configured_refund_policy_version
      then
        raise exception using
          errcode = '55000',
          message = 'Existing logical order has a different frozen commercial contract.';
      end if;

      if order_row.status = 'void' then
        result_row.state := 'unavailable';
      elsif order_row.status <> 'pending' then
        result_row.state := 'already_fulfilled';
      end if;
    else
      insert into public.commerce_orders (
        case_id,
        purchaser_user_id,
        purchaser_email,
        preliminary_snapshot_id,
        product_identifier,
        product_version,
        amount_minor_units,
        currency,
        payment_provider,
        external_price_identifier,
        provider_livemode,
        terms_version,
        refund_policy_version
      )
      values (
        requested_case_id,
        requested_purchaser_user_id,
        purchaser_email,
        snapshot_id,
        configured_product_identifier,
        configured_product_version,
        configured_amount_minor_units,
        configured_currency,
        'stripe',
        configured_external_price_identifier,
        configured_provider_livemode,
        configured_terms_version,
        configured_refund_policy_version
      )
      returning * into order_row;
    end if;
  end if;

  if result_row.state in ('already_fulfilled', 'unavailable') then
    result_row.case_id := requested_case_id;
    result_row.order_id := order_row.id;
    result_row.order_status := order_row.status::text;
    result_row.purchaser_user_id := order_row.purchaser_user_id;
    result_row.amount_minor_units := order_row.amount_minor_units;
    result_row.currency := order_row.currency;
    result_row.external_price_identifier := order_row.external_price_identifier;
    result_row.provider_livemode := order_row.provider_livemode;
    result_row.purchaser_email := order_row.purchaser_email;
    result_row.entitlement_status := entitlement_status_value;
    return next result_row;
    return;
  end if;

  select checkout_attempt.*
  into attempt_row
  from public.checkout_attempts as checkout_attempt
  where checkout_attempt.order_id = order_row.id
    and checkout_attempt.status = 'complete'
  order by checkout_attempt.finished_at desc nulls last,
    checkout_attempt.created_at desc,
    checkout_attempt.id desc
  limit 1
  for update;

  if found then
    result_row.state := 'existing';
  else
    select checkout_attempt.*
    into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.order_id = order_row.id
      and checkout_attempt.status in ('creating', 'open')
    for update;

    if found then
      result_row.state := 'existing';
    else
      select checkout_attempt.*
      into prior_attempt
      from public.checkout_attempts as checkout_attempt
      where checkout_attempt.order_id = order_row.id
        and checkout_attempt.request_chain_id = requested_client_request_id
      order by checkout_attempt.attempt_generation desc
      limit 1
      for update;

      next_generation := coalesce(prior_attempt.attempt_generation + 1, 1);
      internal_client_request_id := case
        when next_generation = 1 then requested_client_request_id
        else gen_random_uuid()
      end;

      insert into public.checkout_attempts (
        case_id,
        order_id,
        client_request_id,
        request_chain_id,
        attempt_generation,
        payment_provider,
        provider_livemode,
        status,
        amount_minor_units,
        currency
      )
      values (
        requested_case_id,
        order_row.id,
        internal_client_request_id,
        requested_client_request_id,
        next_generation,
        'stripe',
        configured_provider_livemode,
        'creating',
        configured_amount_minor_units,
        configured_currency
      )
      returning * into attempt_row;

      result_row.state := 'reserved';
    end if;
  end if;

  result_row.case_id := requested_case_id;
  result_row.order_id := order_row.id;
  result_row.order_status := order_row.status::text;
  result_row.purchaser_user_id := order_row.purchaser_user_id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.client_request_id := attempt_row.request_chain_id;
  result_row.attempt_generation := attempt_row.attempt_generation;
  result_row.attempt_status := attempt_row.status;
  result_row.external_checkout_session_id := attempt_row.external_checkout_session_id;
  result_row.external_payment_intent_id := attempt_row.external_payment_intent_id;
  result_row.amount_minor_units := order_row.amount_minor_units;
  result_row.currency := order_row.currency;
  result_row.external_price_identifier := order_row.external_price_identifier;
  result_row.provider_livemode := order_row.provider_livemode;
  result_row.expires_at := attempt_row.expires_at;
  result_row.purchaser_email := order_row.purchaser_email;
  result_row.entitlement_status := entitlement_status_value;
  return next result_row;
end;
$$;

comment on function public.reserve_total_loss_checkout(uuid, uuid, uuid, text, text, text, bigint, text, text, text, boolean) is
  'Service-only atomic purchase eligibility, frozen logical-order creation, and one-active-attempt reservation with controlled replacement generations.';

create function public.attach_total_loss_checkout_session(
  requested_checkout_attempt_id uuid,
  requested_external_checkout_session_id text,
  requested_external_payment_intent_id text,
  requested_external_customer_id text,
  requested_expires_at timestamptz,
  requested_provider_livemode boolean
)
returns setof public.total_loss_checkout_reservation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_case_id uuid;
  attempt_row public.checkout_attempts%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_status_value text;
  result_row public.total_loss_checkout_reservation_result;
begin
  if requested_checkout_attempt_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or (
      requested_external_payment_intent_id is not null
      and char_length(requested_external_payment_intent_id) not between 1 and 255
    )
    or (
      requested_external_customer_id is not null
      and char_length(requested_external_customer_id) not between 1 and 255
    )
    or requested_expires_at is null
    or requested_expires_at <= statement_timestamp()
    or requested_provider_livemode is null
  then
    raise exception using errcode = '22023', message = 'Checkout Session state is invalid.';
  end if;

  select checkout_attempt.case_id
  into locked_case_id
  from public.checkout_attempts as checkout_attempt
  where checkout_attempt.id = requested_checkout_attempt_id;

  if not found then
    raise exception using errcode = '22023', message = 'Checkout attempt is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(locked_case_id::text)
  );

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  join public.checkout_attempts as checkout_attempt
    on checkout_attempt.order_id = commerce_order.id
    and checkout_attempt.case_id = commerce_order.case_id
  where checkout_attempt.id = requested_checkout_attempt_id
    and commerce_order.case_id = locked_case_id
  for update of commerce_order;

  if found then
    select checkout_attempt.*
    into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.id = requested_checkout_attempt_id
      and checkout_attempt.order_id = order_row.id
      and checkout_attempt.case_id = locked_case_id
    for update;
  end if;

  if not found
    or attempt_row.payment_provider <> 'stripe'
    or attempt_row.provider_livemode is distinct from requested_provider_livemode
    or order_row.provider_livemode is distinct from requested_provider_livemode
    or order_row.purchaser_email is null
  then
    raise exception using errcode = '22023', message = 'Checkout attempt is invalid.';
  end if;

  if attempt_row.status = 'creating' then
    update public.checkout_attempts
    set
      external_checkout_session_id = requested_external_checkout_session_id,
      external_payment_intent_id = requested_external_payment_intent_id,
      external_customer_id = requested_external_customer_id,
      status = 'open',
      expires_at = requested_expires_at
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.state := 'attached';
  elsif attempt_row.status = 'open'
    and attempt_row.external_checkout_session_id = requested_external_checkout_session_id
    and attempt_row.external_payment_intent_id is not distinct from requested_external_payment_intent_id
    and attempt_row.external_customer_id is not distinct from requested_external_customer_id
    and attempt_row.expires_at = requested_expires_at
  then
    result_row.state := 'existing';
  else
    raise exception using errcode = '55000', message = 'Checkout Session cannot replace persisted attempt state.';
  end if;

  select entitlement.status::text
  into entitlement_status_value
  from public.case_entitlements as entitlement
  where entitlement.order_id = order_row.id;

  result_row.case_id := order_row.case_id;
  result_row.order_id := order_row.id;
  result_row.order_status := order_row.status::text;
  result_row.purchaser_user_id := order_row.purchaser_user_id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.client_request_id := attempt_row.request_chain_id;
  result_row.attempt_generation := attempt_row.attempt_generation;
  result_row.attempt_status := attempt_row.status;
  result_row.external_checkout_session_id := attempt_row.external_checkout_session_id;
  result_row.external_payment_intent_id := attempt_row.external_payment_intent_id;
  result_row.amount_minor_units := order_row.amount_minor_units;
  result_row.currency := order_row.currency;
  result_row.external_price_identifier := order_row.external_price_identifier;
  result_row.provider_livemode := order_row.provider_livemode;
  result_row.expires_at := attempt_row.expires_at;
  result_row.purchaser_email := order_row.purchaser_email;
  result_row.entitlement_status := entitlement_status_value;
  return next result_row;
end;
$$;

comment on function public.attach_total_loss_checkout_session(uuid, text, text, text, timestamptz, boolean) is
  'Service-only idempotent attachment of authoritative Stripe Checkout identifiers to one reserved attempt.';

create function public.resolve_total_loss_checkout_context(
  requested_order_id uuid,
  requested_checkout_attempt_id uuid
)
returns setof public.total_loss_stripe_context_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    commerce_order.case_id,
    commerce_order.id,
    checkout_attempt.id,
    payment_transaction.id,
    commerce_order.purchaser_user_id,
    commerce_order.purchaser_email,
    commerce_order.preliminary_snapshot_id,
    commerce_order.product_identifier,
    commerce_order.product_version,
    commerce_order.external_price_identifier,
    commerce_order.amount_minor_units,
    commerce_order.currency,
    commerce_order.provider_livemode,
    checkout_attempt.external_checkout_session_id,
    checkout_attempt.external_payment_intent_id,
    checkout_attempt.status,
    commerce_order.status::text,
    entitlement.id,
    entitlement.status::text
  from public.commerce_orders as commerce_order
  join public.checkout_attempts as checkout_attempt
    on checkout_attempt.order_id = commerce_order.id
    and checkout_attempt.case_id = commerce_order.case_id
  left join public.payment_transactions as payment_transaction
    on payment_transaction.checkout_attempt_id = checkout_attempt.id
    and payment_transaction.transaction_kind = 'payment'
  left join public.case_entitlements as entitlement
    on entitlement.order_id = commerce_order.id
  where commerce_order.id = requested_order_id
    and checkout_attempt.id = requested_checkout_attempt_id
    and commerce_order.payment_provider = 'stripe'
    and checkout_attempt.payment_provider = 'stripe'
    and commerce_order.purchaser_email is not null;
$$;

comment on function public.resolve_total_loss_checkout_context(uuid, uuid) is
  'Service-only crash-safe Stripe context lookup by opaque order and attempt identities carried in provider metadata.';

create function public.resolve_total_loss_checkout_context_by_session_id(
  requested_external_checkout_session_id text
)
returns setof public.total_loss_stripe_context_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    commerce_order.case_id,
    commerce_order.id,
    checkout_attempt.id,
    payment_transaction.id,
    commerce_order.purchaser_user_id,
    commerce_order.purchaser_email,
    commerce_order.preliminary_snapshot_id,
    commerce_order.product_identifier,
    commerce_order.product_version,
    commerce_order.external_price_identifier,
    commerce_order.amount_minor_units,
    commerce_order.currency,
    commerce_order.provider_livemode,
    checkout_attempt.external_checkout_session_id,
    checkout_attempt.external_payment_intent_id,
    checkout_attempt.status,
    commerce_order.status::text,
    entitlement.id,
    entitlement.status::text
  from public.checkout_attempts as checkout_attempt
  join public.commerce_orders as commerce_order
    on commerce_order.id = checkout_attempt.order_id
    and commerce_order.case_id = checkout_attempt.case_id
  left join public.payment_transactions as payment_transaction
    on payment_transaction.checkout_attempt_id = checkout_attempt.id
    and payment_transaction.transaction_kind = 'payment'
  left join public.case_entitlements as entitlement
    on entitlement.order_id = commerce_order.id
  where requested_external_checkout_session_id is not null
    and char_length(requested_external_checkout_session_id) between 9 and 255
    and requested_external_checkout_session_id
      ~ '^cs_(test|live)_[A-Za-z0-9_]+$'
    and checkout_attempt.payment_provider = 'stripe'
    and checkout_attempt.external_checkout_session_id
      = requested_external_checkout_session_id
    and commerce_order.payment_provider = 'stripe'
    and commerce_order.purchaser_email is not null;
$$;

comment on function public.resolve_total_loss_checkout_context_by_session_id(text) is
  'Service-only zero-or-one frozen Stripe context lookup for a locally bound Checkout Session when signed event metadata is absent.';

create function public.authorize_total_loss_checkout_reconciliation(
  requested_case_id uuid,
  requested_purchaser_user_id uuid,
  requested_external_checkout_session_id text
)
returns setof public.total_loss_stripe_context_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    commerce_order.case_id,
    commerce_order.id,
    checkout_attempt.id,
    payment_transaction.id,
    commerce_order.purchaser_user_id,
    commerce_order.purchaser_email,
    commerce_order.preliminary_snapshot_id,
    commerce_order.product_identifier,
    commerce_order.product_version,
    commerce_order.external_price_identifier,
    commerce_order.amount_minor_units,
    commerce_order.currency,
    commerce_order.provider_livemode,
    checkout_attempt.external_checkout_session_id,
    checkout_attempt.external_payment_intent_id,
    checkout_attempt.status,
    commerce_order.status::text,
    entitlement.id,
    entitlement.status::text
  from public.commerce_orders as commerce_order
  join public.checkout_attempts as checkout_attempt
    on checkout_attempt.order_id = commerce_order.id
    and checkout_attempt.case_id = commerce_order.case_id
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = commerce_order.case_id
  join auth.users as purchaser
    on purchaser.id = commerce_order.purchaser_user_id
  join public.total_loss_case_contacts as contact
    on contact.case_id = commerce_order.case_id
  left join public.payment_transactions as payment_transaction
    on payment_transaction.checkout_attempt_id = checkout_attempt.id
    and payment_transaction.transaction_kind = 'payment'
  left join public.case_entitlements as entitlement
    on entitlement.order_id = commerce_order.id
  where commerce_order.case_id = requested_case_id
    and commerce_order.purchaser_user_id = requested_purchaser_user_id
    and appraisal_case.user_id = requested_purchaser_user_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(purchaser.is_anonymous, false)
    and purchaser.email_confirmed_at is not null
    and lower(btrim(purchaser.email)) = contact.email
    and commerce_order.purchaser_email = contact.email
    and checkout_attempt.external_checkout_session_id = requested_external_checkout_session_id
    and commerce_order.payment_provider = 'stripe'
    and checkout_attempt.payment_provider = 'stripe';
$$;

comment on function public.authorize_total_loss_checkout_reconciliation(uuid, uuid, text) is
  'Service-only owner authorization performed before retrieving a browser-supplied Stripe Checkout Session.';

create function public.resolve_total_loss_payment_context(
  requested_external_payment_intent_id text
)
returns setof public.total_loss_stripe_context_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    commerce_order.case_id,
    commerce_order.id,
    checkout_attempt.id,
    payment_transaction.id,
    commerce_order.purchaser_user_id,
    commerce_order.purchaser_email,
    commerce_order.preliminary_snapshot_id,
    commerce_order.product_identifier,
    commerce_order.product_version,
    commerce_order.external_price_identifier,
    commerce_order.amount_minor_units,
    commerce_order.currency,
    commerce_order.provider_livemode,
    checkout_attempt.external_checkout_session_id,
    checkout_attempt.external_payment_intent_id,
    checkout_attempt.status,
    commerce_order.status::text,
    entitlement.id,
    entitlement.status::text
  from public.checkout_attempts as checkout_attempt
  join public.commerce_orders as commerce_order
    on commerce_order.id = checkout_attempt.order_id
    and commerce_order.case_id = checkout_attempt.case_id
  left join public.payment_transactions as payment_transaction
    on payment_transaction.checkout_attempt_id = checkout_attempt.id
    and payment_transaction.transaction_kind = 'payment'
    and payment_transaction.external_object_id = requested_external_payment_intent_id
  left join public.case_entitlements as entitlement
    on entitlement.order_id = commerce_order.id
  where checkout_attempt.payment_provider = 'stripe'
    and checkout_attempt.external_payment_intent_id = requested_external_payment_intent_id
    and commerce_order.purchaser_email is not null;
$$;

comment on function public.resolve_total_loss_payment_context(text) is
  'Service-only Stripe PaymentIntent lookup for authoritative refund and dispute reconciliation.';

create function public.reconcile_total_loss_checkout_attempt(
  requested_case_id uuid,
  requested_purchaser_user_id uuid,
  requested_external_checkout_session_id text,
  requested_session_status text,
  requested_payment_status text,
  requested_external_payment_intent_id text,
  requested_expires_at timestamptz,
  requested_provider_livemode boolean,
  requested_external_price_identifier text,
  requested_quantity integer,
  requested_amount_minor_units bigint,
  requested_currency text
)
returns setof public.total_loss_checkout_reconciliation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempt_row public.checkout_attempts%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_status_value text;
  result_row public.total_loss_checkout_reconciliation_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_case_id is null
    or requested_purchaser_user_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or requested_session_status not in ('open', 'complete', 'expired')
    or requested_payment_status not in ('unpaid', 'paid', 'no_payment_required')
    or (
      requested_external_payment_intent_id is not null
      and char_length(requested_external_payment_intent_id) not between 1 and 255
    )
    or requested_provider_livemode is null
    or requested_external_price_identifier is null
    or requested_quantity <> 1
    or requested_amount_minor_units is null
    or requested_currency is null
  then
    raise exception using errcode = '22023', message = 'Checkout reconciliation is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select checkout_attempt.*
  into attempt_row
  from public.checkout_attempts as checkout_attempt
  join public.commerce_orders as commerce_order
    on commerce_order.id = checkout_attempt.order_id
    and commerce_order.case_id = checkout_attempt.case_id
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = commerce_order.case_id
  join auth.users as purchaser
    on purchaser.id = commerce_order.purchaser_user_id
  join public.total_loss_case_contacts as contact
    on contact.case_id = commerce_order.case_id
  where commerce_order.case_id = requested_case_id
    and commerce_order.purchaser_user_id = requested_purchaser_user_id
    and appraisal_case.user_id = requested_purchaser_user_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(purchaser.is_anonymous, false)
    and purchaser.email_confirmed_at is not null
    and lower(btrim(purchaser.email)) = contact.email
    and checkout_attempt.external_checkout_session_id = requested_external_checkout_session_id
  for update of checkout_attempt, commerce_order;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = attempt_row.order_id
    for update;
  end if;

  if not found then
    raise exception using errcode = '42501', message = 'Checkout Session is not available for this case owner.';
  end if;

  if order_row.payment_provider is distinct from 'stripe'
    or attempt_row.payment_provider is distinct from 'stripe'
    or order_row.provider_livemode is distinct from requested_provider_livemode
    or attempt_row.provider_livemode is distinct from requested_provider_livemode
    or order_row.external_price_identifier is distinct from requested_external_price_identifier
    or order_row.amount_minor_units is distinct from requested_amount_minor_units
    or attempt_row.amount_minor_units is distinct from requested_amount_minor_units
    or order_row.currency is distinct from requested_currency
    or attempt_row.currency is distinct from requested_currency
  then
    raise exception using errcode = '22023', message = 'Stripe Checkout contract does not match the frozen order.';
  end if;

  if requested_session_status = 'complete'
    and requested_payment_status in ('paid', 'no_payment_required')
    and requested_external_payment_intent_id is null
  then
    raise exception using errcode = '22023', message = 'Completed paid Checkout requires a PaymentIntent.';
  end if;

  if attempt_row.status = 'complete'
    and attempt_row.external_payment_intent_id is distinct from requested_external_payment_intent_id
  then
    raise exception using errcode = '55000', message = 'Completed Checkout attempt identity is immutable.';
  elsif attempt_row.status in ('expired', 'failed')
    and attempt_row.external_payment_intent_id is not null
    and requested_external_payment_intent_id is not null
    and attempt_row.external_payment_intent_id is distinct from requested_external_payment_intent_id
  then
    raise exception using errcode = '55000', message = 'Terminal Checkout attempt identity is immutable.';
  end if;

  if order_row.status <> 'pending' then
    result_row.outcome := 'stale';
  elsif attempt_row.status = 'complete' then
    result_row.outcome := 'observed';
  elsif attempt_row.status in ('expired', 'failed') then
    result_row.outcome := 'already_terminal';
  elsif requested_session_status = 'expired' then
    update public.checkout_attempts
    set
      status = 'expired',
      expires_at = coalesce(requested_expires_at, expires_at),
      finished_at = recorded_at
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'observed';
  elsif requested_session_status = 'complete'
    and requested_payment_status in ('paid', 'no_payment_required')
  then
    update public.checkout_attempts
    set
      external_payment_intent_id = requested_external_payment_intent_id,
      status = 'complete',
      expires_at = coalesce(requested_expires_at, expires_at),
      finished_at = recorded_at,
      failure_code = null
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'observed';
  elsif attempt_row.status in ('creating', 'open') then
    if requested_expires_at is null or requested_expires_at <= recorded_at then
      raise exception using errcode = '22023', message = 'Open Checkout requires a future expiry.';
    end if;
    update public.checkout_attempts
    set
      external_payment_intent_id = coalesce(
        requested_external_payment_intent_id,
        external_payment_intent_id
      ),
      status = 'open',
      expires_at = requested_expires_at,
      finished_at = null,
      failure_code = null
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'observed';
  else
    raise exception using errcode = '55000', message = 'Checkout attempt state is unavailable for reconciliation.';
  end if;

  select entitlement.status::text
  into entitlement_status_value
  from public.case_entitlements as entitlement
  where entitlement.order_id = order_row.id;

  result_row.case_id := order_row.case_id;
  result_row.order_id := order_row.id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.order_status := order_row.status::text;
  result_row.attempt_status := attempt_row.status;
  result_row.entitlement_status := entitlement_status_value;
  return next result_row;
end;
$$;

comment on function public.reconcile_total_loss_checkout_attempt(uuid, uuid, text, text, text, text, timestamptz, boolean, text, integer, bigint, text) is
  'Service-only owner-authorized Stripe retrieval reconciliation. It can update attempt observation state but never payment authority or entitlement.';

create function public.recover_total_loss_checkout_attempt(
  requested_case_id uuid,
  requested_order_id uuid,
  requested_checkout_attempt_id uuid,
  requested_purchaser_user_id uuid,
  requested_external_checkout_session_id text,
  requested_external_payment_intent_id text,
  requested_external_customer_id text,
  requested_session_status text,
  requested_payment_status text,
  requested_expires_at timestamptz,
  requested_provider_livemode boolean,
  requested_external_price_identifier text,
  requested_quantity integer,
  requested_amount_minor_units bigint,
  requested_currency text
)
returns setof public.total_loss_checkout_reconciliation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempt_row public.checkout_attempts%rowtype;
  order_row public.commerce_orders%rowtype;
  result_row public.total_loss_checkout_reconciliation_result;
  recorded_at timestamptz := statement_timestamp();
  target_attempt_status text := case
    when requested_session_status = 'expired' then 'expired'
    when requested_payment_status in ('paid', 'no_payment_required')
      then 'complete'
    else 'open'
  end;
begin
  if requested_case_id is null
    or requested_order_id is null
    or requested_checkout_attempt_id is null
    or requested_purchaser_user_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or (
      requested_external_payment_intent_id is not null
      and char_length(requested_external_payment_intent_id) not between 1 and 255
    )
    or (
      requested_external_customer_id is not null
      and char_length(requested_external_customer_id) not between 1 and 255
    )
    or requested_session_status not in ('complete', 'expired')
    or requested_payment_status not in ('unpaid', 'paid', 'no_payment_required')
    or (
      requested_session_status = 'expired'
      and (
        requested_payment_status <> 'unpaid'
        or requested_expires_at > recorded_at + interval '5 minutes'
      )
    )
    or (
      requested_session_status = 'complete'
      and requested_payment_status in ('paid', 'no_payment_required')
      and requested_external_payment_intent_id is null
    )
    or requested_expires_at is null
    or requested_provider_livemode is null
    or requested_external_price_identifier is null
    or requested_external_price_identifier !~ '^price_[A-Za-z0-9_]{1,249}$'
    or requested_quantity <> 1
    or requested_amount_minor_units is null
    or requested_amount_minor_units <= 0
    or requested_currency is null
    or requested_currency !~ '^[A-Z]{3}$'
  then
    raise exception using errcode = '22023', message = 'Checkout recovery is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  perform 1
  from public.appraisal_cases as appraisal_case
  join auth.users as purchaser
    on purchaser.id = appraisal_case.user_id
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = requested_purchaser_user_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(purchaser.is_anonymous, false)
    and purchaser.email_confirmed_at is not null
    and lower(btrim(purchaser.email)) = contact.email
  for update of appraisal_case;

  if not found then
    raise exception using errcode = '42501', message = 'Checkout attempt is not available for this case owner.';
  end if;

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  join public.total_loss_case_contacts as contact
    on contact.case_id = commerce_order.case_id
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = requested_case_id
    and commerce_order.purchaser_user_id = requested_purchaser_user_id
    and commerce_order.purchaser_email = contact.email
  for update of commerce_order;

  if found then
    select checkout_attempt.*
    into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.id = requested_checkout_attempt_id
      and checkout_attempt.order_id = requested_order_id
      and checkout_attempt.case_id = requested_case_id
    for update;
  end if;

  if not found
    or order_row.status <> 'pending'
    or order_row.payment_provider is distinct from 'stripe'
    or attempt_row.payment_provider is distinct from 'stripe'
    or order_row.provider_livemode is distinct from requested_provider_livemode
    or attempt_row.provider_livemode is distinct from requested_provider_livemode
    or order_row.external_price_identifier is distinct from requested_external_price_identifier
    or order_row.amount_minor_units is distinct from requested_amount_minor_units
    or attempt_row.amount_minor_units is distinct from requested_amount_minor_units
    or order_row.currency is distinct from requested_currency
    or attempt_row.currency is distinct from requested_currency
    or exists (
      select 1
      from public.case_entitlements as entitlement
      where entitlement.order_id = requested_order_id
    )
  then
    raise exception using errcode = '55000', message = 'Checkout attempt is not recoverable.';
  end if;

  if attempt_row.status = target_attempt_status then
    if attempt_row.external_checkout_session_id is distinct from requested_external_checkout_session_id
      or attempt_row.external_payment_intent_id is distinct from requested_external_payment_intent_id
      or attempt_row.external_customer_id is distinct from requested_external_customer_id
      or attempt_row.expires_at is distinct from requested_expires_at
    then
      raise exception using errcode = '55000', message = 'Recovered Checkout terminal identity is immutable.';
    end if;
    result_row.outcome := case
      when target_attempt_status in ('complete', 'expired')
        then 'already_terminal'
      else 'already_observed'
    end;
  elsif attempt_row.status in ('creating', 'open') then
    if (
      attempt_row.external_checkout_session_id is not null
      and attempt_row.external_checkout_session_id is distinct from requested_external_checkout_session_id
    ) or (
      attempt_row.external_payment_intent_id is not null
      and attempt_row.external_payment_intent_id is distinct from requested_external_payment_intent_id
    ) or (
      attempt_row.external_customer_id is not null
      and attempt_row.external_customer_id is distinct from requested_external_customer_id
    ) then
      raise exception using errcode = '55000', message = 'Checkout recovery cannot replace provider identity.';
    end if;

    update public.checkout_attempts
    set
      external_checkout_session_id = requested_external_checkout_session_id,
      external_payment_intent_id = requested_external_payment_intent_id,
      external_customer_id = requested_external_customer_id,
      status = target_attempt_status,
      expires_at = requested_expires_at,
      finished_at = case
        when target_attempt_status in ('complete', 'expired') then recorded_at
        else null
      end,
      failure_code = null
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'applied';
  else
    raise exception using errcode = '55000', message = 'Checkout attempt is not recoverable.';
  end if;

  result_row.case_id := order_row.case_id;
  result_row.order_id := order_row.id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.order_status := order_row.status::text;
  result_row.attempt_status := attempt_row.status;
  result_row.entitlement_status := null;
  return next result_row;
end;
$$;

comment on function public.recover_total_loss_checkout_attempt(uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, boolean, text, integer, bigint, text) is
  'Service-only owner-authorized recovery when stable Stripe idempotency returns a complete or expired Session before its identifiers were persisted; it never grants payment authority.';

create function public.fail_total_loss_checkout_attempt_from_webhook(
  requested_order_id uuid,
  requested_checkout_attempt_id uuid,
  requested_external_checkout_session_id text,
  requested_external_event_id text,
  requested_webhook_processing_token uuid,
  requested_failure_code text
)
returns setof public.total_loss_checkout_reconciliation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_case_id uuid;
  attempt_row public.checkout_attempts%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_status_value text;
  result_row public.total_loss_checkout_reconciliation_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_order_id is null
    or requested_checkout_attempt_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or requested_external_event_id is null
    or char_length(requested_external_event_id) not between 1 and 255
    or requested_webhook_processing_token is null
    or requested_failure_code is null
    or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
  then
    raise exception using errcode = '22023', message = 'Checkout failure event is invalid.';
  end if;

  select commerce_order.case_id
  into locked_case_id
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id;

  if not found then
    raise exception using errcode = '22023', message = 'Checkout failure does not match an open payable attempt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(locked_case_id::text)
  );

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = locked_case_id
  for update;

  if found then
    select checkout_attempt.*
    into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.id = requested_checkout_attempt_id
      and checkout_attempt.order_id = requested_order_id
      and checkout_attempt.case_id = locked_case_id
    for update;
  end if;

  if not found
    or attempt_row.payment_provider <> 'stripe'
    or (
      attempt_row.external_checkout_session_id is not null
      and attempt_row.external_checkout_session_id <> requested_external_checkout_session_id
    )
  then
    raise exception using errcode = '22023', message = 'Checkout failure does not match an open payable attempt.';
  end if;

  if not exists (
    select 1
    from public.stripe_webhook_events as webhook_event
    where webhook_event.external_event_id = requested_external_event_id
      and webhook_event.event_type = 'checkout.session.async_payment_failed'
      and webhook_event.livemode = order_row.provider_livemode
      and webhook_event.status = 'processing'
      and webhook_event.processing_token = requested_webhook_processing_token
  ) then
    raise exception using errcode = '55000', message = 'Checkout failure requires its claimed Stripe webhook event.';
  end if;

  if order_row.status <> 'pending' then
    result_row.outcome := 'stale';
  elsif attempt_row.status = 'failed' then
    if attempt_row.external_checkout_session_id is distinct from requested_external_checkout_session_id
      or attempt_row.failure_code is distinct from requested_failure_code
    then
      raise exception using errcode = '55000', message = 'Terminal checkout failure is immutable.';
    end if;
    result_row.outcome := 'already_terminal';
  elsif attempt_row.status in ('creating', 'open') then
    update public.checkout_attempts
    set
      external_checkout_session_id = requested_external_checkout_session_id,
      status = 'failed',
      finished_at = recorded_at,
      failure_code = requested_failure_code
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'applied';
  else
    raise exception using errcode = '55000', message = 'Completed or expired Checkout cannot be failed.';
  end if;

  select entitlement.status::text
  into entitlement_status_value
  from public.case_entitlements as entitlement
  where entitlement.order_id = order_row.id;

  result_row.case_id := order_row.case_id;
  result_row.order_id := order_row.id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.order_status := order_row.status::text;
  result_row.attempt_status := attempt_row.status;
  result_row.entitlement_status := entitlement_status_value;
  return next result_row;
end;
$$;

comment on function public.fail_total_loss_checkout_attempt_from_webhook(uuid, uuid, text, text, uuid, text) is
  'Service-only signed-event transition from creating/open to failed, with idempotent terminal replay and a no-op stale result after order fulfillment.';

create function public.expire_total_loss_checkout_attempt_from_webhook(
  requested_order_id uuid,
  requested_checkout_attempt_id uuid,
  requested_external_checkout_session_id text,
  requested_external_event_id text,
  requested_webhook_processing_token uuid,
  requested_expires_at timestamptz
)
returns setof public.total_loss_checkout_reconciliation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_case_id uuid;
  attempt_row public.checkout_attempts%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_status_value text;
  result_row public.total_loss_checkout_reconciliation_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_order_id is null
    or requested_checkout_attempt_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or requested_external_event_id is null
    or char_length(requested_external_event_id) not between 1 and 255
    or requested_webhook_processing_token is null
    or requested_expires_at is null
    or requested_expires_at > recorded_at + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'Checkout expiration event is invalid.';
  end if;

  select commerce_order.case_id
  into locked_case_id
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id;

  if not found then
    raise exception using errcode = '22023', message = 'Checkout expiration does not match an open payable attempt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(locked_case_id::text)
  );

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = locked_case_id
  for update;

  if found then
    select checkout_attempt.*
    into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.id = requested_checkout_attempt_id
      and checkout_attempt.order_id = requested_order_id
      and checkout_attempt.case_id = locked_case_id
    for update;
  end if;

  if not found
    or attempt_row.payment_provider <> 'stripe'
    or (
      attempt_row.external_checkout_session_id is not null
      and attempt_row.external_checkout_session_id <> requested_external_checkout_session_id
    )
  then
    raise exception using errcode = '22023', message = 'Checkout expiration does not match an open payable attempt.';
  end if;

  if not exists (
    select 1
    from public.stripe_webhook_events as webhook_event
    where webhook_event.external_event_id = requested_external_event_id
      and webhook_event.event_type = 'checkout.session.expired'
      and webhook_event.livemode = order_row.provider_livemode
      and webhook_event.status = 'processing'
      and webhook_event.processing_token = requested_webhook_processing_token
  ) then
    raise exception using errcode = '55000', message = 'Checkout expiration requires its claimed Stripe webhook event.';
  end if;

  if order_row.status <> 'pending' then
    result_row.outcome := 'stale';
  elsif attempt_row.status = 'expired' then
    if attempt_row.external_checkout_session_id is distinct from requested_external_checkout_session_id
      or attempt_row.expires_at is distinct from requested_expires_at
    then
      raise exception using errcode = '55000', message = 'Terminal checkout expiration is immutable.';
    end if;
    result_row.outcome := 'already_terminal';
  elsif attempt_row.status in ('creating', 'open') then
    update public.checkout_attempts
    set
      external_checkout_session_id = requested_external_checkout_session_id,
      status = 'expired',
      expires_at = requested_expires_at,
      finished_at = recorded_at,
      failure_code = null
    where id = attempt_row.id
    returning * into attempt_row;
    result_row.outcome := 'applied';
  else
    raise exception using errcode = '55000', message = 'Completed or failed Checkout cannot expire.';
  end if;

  select entitlement.status::text
  into entitlement_status_value
  from public.case_entitlements as entitlement
  where entitlement.order_id = order_row.id;

  result_row.case_id := order_row.case_id;
  result_row.order_id := order_row.id;
  result_row.checkout_attempt_id := attempt_row.id;
  result_row.order_status := order_row.status::text;
  result_row.attempt_status := attempt_row.status;
  result_row.entitlement_status := entitlement_status_value;
  return next result_row;
end;
$$;

comment on function public.expire_total_loss_checkout_attempt_from_webhook(uuid, uuid, text, text, uuid, timestamptz) is
  'Service-only signed-event expiration, including attachment-race recovery, idempotent replay, and a no-op stale result after order fulfillment.';

create function public.fulfill_total_loss_checkout_payment(
  requested_case_id uuid,
  requested_order_id uuid,
  requested_checkout_attempt_id uuid,
  requested_external_checkout_session_id text,
  requested_external_payment_intent_id text,
  requested_external_event_id text,
  requested_webhook_processing_token uuid,
  requested_external_price_identifier text,
  requested_quantity integer,
  requested_amount_minor_units bigint,
  requested_currency text,
  requested_provider_livemode boolean,
  requested_provider_occurred_at timestamptz
)
returns setof public.total_loss_checkout_fulfillment_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders%rowtype;
  attempt_row public.checkout_attempts%rowtype;
  payment_row public.payment_transactions%rowtype;
  prior_payment public.payment_transactions%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  result_row public.total_loss_checkout_fulfillment_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_case_id is null
    or requested_order_id is null
    or requested_checkout_attempt_id is null
    or requested_external_checkout_session_id is null
    or char_length(requested_external_checkout_session_id) not between 1 and 255
    or requested_external_payment_intent_id is null
    or char_length(requested_external_payment_intent_id) not between 1 and 255
    or requested_external_event_id is null
    or char_length(requested_external_event_id) not between 1 and 255
    or requested_webhook_processing_token is null
    or requested_external_price_identifier is null
    or requested_quantity <> 1
    or requested_amount_minor_units is null
    or requested_currency is null
    or requested_provider_livemode is null
    or requested_provider_occurred_at is null
    or requested_provider_occurred_at > recorded_at + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'Stripe fulfillment is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select checkout_attempt.*
  into attempt_row
  from public.commerce_orders as commerce_order
  join public.checkout_attempts as checkout_attempt
    on checkout_attempt.order_id = commerce_order.id
    and checkout_attempt.case_id = commerce_order.case_id
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = requested_case_id
    and checkout_attempt.id = requested_checkout_attempt_id
  for update of commerce_order, checkout_attempt;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = requested_order_id
    for update;
  end if;

  if not found
    or order_row.payment_provider is distinct from 'stripe'
    or order_row.purchaser_email is null
    or attempt_row.payment_provider is distinct from 'stripe'
    or order_row.provider_livemode is distinct from requested_provider_livemode
    or attempt_row.provider_livemode is distinct from requested_provider_livemode
    or order_row.external_price_identifier is distinct from requested_external_price_identifier
    or order_row.amount_minor_units is distinct from requested_amount_minor_units
    or attempt_row.amount_minor_units is distinct from requested_amount_minor_units
    or order_row.currency is distinct from requested_currency
    or attempt_row.currency is distinct from requested_currency
    or (
      attempt_row.external_checkout_session_id is not null
      and attempt_row.external_checkout_session_id <> requested_external_checkout_session_id
    )
    or (
      attempt_row.external_payment_intent_id is not null
      and attempt_row.external_payment_intent_id <> requested_external_payment_intent_id
    )
  then
    raise exception using errcode = '22023', message = 'Stripe payment does not match the frozen order and attempt.';
  end if;

  if attempt_row.status in ('expired', 'failed') then
    raise exception using errcode = '55000', message = 'Terminal Checkout attempt cannot be fulfilled.';
  end if;

  if not exists (
    select 1
    from public.stripe_webhook_events as webhook_event
    where webhook_event.external_event_id = requested_external_event_id
      and webhook_event.livemode = requested_provider_livemode
      and webhook_event.status = 'processing'
      and webhook_event.processing_token = requested_webhook_processing_token
      and webhook_event.event_type in (
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded'
      )
  ) then
    raise exception using errcode = '55000', message = 'Stripe payment fulfillment requires a claimed webhook event.';
  end if;

  select payment_transaction.*
  into payment_row
  from public.payment_transactions as payment_transaction
  where payment_transaction.payment_provider = 'stripe'
    and payment_transaction.external_object_id = requested_external_payment_intent_id;

  if found then
    if payment_row.case_id <> requested_case_id
      or payment_row.order_id <> requested_order_id
      or payment_row.checkout_attempt_id <> requested_checkout_attempt_id
      or payment_row.transaction_kind <> 'payment'
    then
      raise exception using errcode = '55000', message = 'Stripe PaymentIntent is already bound to another purchase.';
    end if;

    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = requested_order_id;

    result_row.outcome := case
      when exists (
        select 1
        from public.payment_transactions as other_payment
        where other_payment.order_id = requested_order_id
          and other_payment.transaction_kind = 'payment'
          and other_payment.id <> payment_row.id
      ) then 'duplicate_payment'
      else 'already_fulfilled'
    end;
    result_row.case_id := requested_case_id;
    result_row.order_id := requested_order_id;
    result_row.order_status := order_row.status::text;
    result_row.checkout_attempt_id := requested_checkout_attempt_id;
    result_row.payment_transaction_id := payment_row.id;
    result_row.entitlement_id := entitlement_row.id;
    result_row.entitlement_status := entitlement_row.status::text;
    return next result_row;
    return;
  end if;

  select payment_transaction.*
  into prior_payment
  from public.payment_transactions as payment_transaction
  where payment_transaction.order_id = requested_order_id
    and payment_transaction.transaction_kind = 'payment'
  order by payment_transaction.recorded_at
  limit 1
  for share;

  if prior_payment.id is null then
    if order_row.status <> 'pending' then
      raise exception using errcode = '55000', message = 'Logical order is not payable.';
    end if;

    select workflow.*
    into workflow_row
    from public.total_loss_claim_workflows as workflow
    where workflow.case_id = requested_case_id
    for update;

    if not found
      or workflow_row.preliminary_snapshot_id is distinct from order_row.preliminary_snapshot_id
      or workflow_row.phase <> 'review'
      or workflow_row.current_task <> 'secure_claim'
    then
      raise exception using errcode = '55000', message = 'Checkout fulfillment workflow boundary is unavailable.';
    end if;
  end if;

  update public.checkout_attempts
  set
    external_checkout_session_id = requested_external_checkout_session_id,
    external_payment_intent_id = requested_external_payment_intent_id,
    status = 'complete',
    finished_at = coalesce(finished_at, recorded_at),
    failure_code = null
  where id = requested_checkout_attempt_id
  returning * into attempt_row;

  insert into public.payment_transactions (
    case_id,
    order_id,
    checkout_attempt_id,
    payment_provider,
    transaction_kind,
    external_object_id,
    external_event_id,
    amount_minor_units,
    currency,
    provider_occurred_at,
    metadata
  )
  values (
    requested_case_id,
    requested_order_id,
    requested_checkout_attempt_id,
    'stripe',
    'payment',
    requested_external_payment_intent_id,
    requested_external_event_id,
    requested_amount_minor_units,
    requested_currency,
    requested_provider_occurred_at,
    jsonb_build_object('source', 'stripe_webhook')
  )
  returning * into payment_row;

  if prior_payment.id is not null then
    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = requested_order_id;

    result_row.outcome := 'duplicate_payment';
    result_row.case_id := requested_case_id;
    result_row.order_id := requested_order_id;
    result_row.order_status := order_row.status::text;
    result_row.checkout_attempt_id := requested_checkout_attempt_id;
    result_row.payment_transaction_id := payment_row.id;
    result_row.entitlement_id := entitlement_row.id;
    result_row.entitlement_status := entitlement_row.status::text;
    return next result_row;
    return;
  end if;

  update public.commerce_orders
  set
    status = 'paid',
    paid_at = requested_provider_occurred_at
  where id = requested_order_id
  returning * into order_row;

  insert into public.case_entitlements (
    case_id,
    order_id,
    preliminary_snapshot_id,
    product_identifier,
    product_version,
    status,
    granted_at,
    status_changed_at
  )
  values (
    requested_case_id,
    requested_order_id,
    order_row.preliminary_snapshot_id,
    order_row.product_identifier,
    order_row.product_version,
    'active',
    requested_provider_occurred_at,
    recorded_at
  )
  returning * into entitlement_row;

  update public.total_loss_claim_workflows
  set
    current_task = 'purchase_complete',
    revision = revision + 1
  where case_id = requested_case_id
    and phase = 'review'
    and current_task = 'secure_claim';

  if not found then
    raise exception using errcode = '55000', message = 'Checkout fulfillment workflow boundary changed.';
  end if;

  result_row.outcome := 'fulfilled';
  result_row.case_id := requested_case_id;
  result_row.order_id := requested_order_id;
  result_row.order_status := order_row.status::text;
  result_row.checkout_attempt_id := requested_checkout_attempt_id;
  result_row.payment_transaction_id := payment_row.id;
  result_row.entitlement_id := entitlement_row.id;
  result_row.entitlement_status := entitlement_row.status::text;
  return next result_row;
end;
$$;

comment on function public.fulfill_total_loss_checkout_payment(uuid, uuid, uuid, text, text, text, uuid, text, integer, bigint, text, boolean, timestamptz) is
  'Service-only webhook-gated atomic payment recording, logical-order payment, one-entitlement grant, and truthful purchase-complete workflow transition.';

create function public.claim_stripe_webhook_event(
  requested_external_event_id text,
  requested_event_type text,
  requested_livemode boolean,
  requested_api_version text,
  requested_payload_sha256 text,
  requested_payload_size integer,
  requested_provider_created_at timestamptz,
  requested_processing_token uuid
)
returns setof public.stripe_webhook_claim_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_row public.stripe_webhook_events%rowtype;
  result_row public.stripe_webhook_claim_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_external_event_id is null
    or char_length(requested_external_event_id) not between 1 and 255
    or requested_event_type is null
    or requested_event_type !~ '^[a-z][a-z0-9_.]{0,127}$'
    or requested_livemode is null
    or (
      requested_api_version is not null
      and char_length(requested_api_version) not between 1 and 63
    )
    or requested_payload_sha256 is null
    or requested_payload_sha256 !~ '^[0-9a-f]{64}$'
    or requested_payload_size is null
    or requested_payload_size not between 1 and 262144
    or requested_provider_created_at is null
    or requested_provider_created_at > recorded_at + interval '5 minutes'
    or requested_processing_token is null
  then
    raise exception using errcode = '22023', message = 'Stripe webhook audit input is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('stripe_webhook_event'),
    pg_catalog.hashtext(requested_external_event_id)
  );

  select webhook_event.*
  into event_row
  from public.stripe_webhook_events as webhook_event
  where webhook_event.external_event_id = requested_external_event_id
  for update;

  if not found then
    insert into public.stripe_webhook_events (
      external_event_id,
      event_type,
      livemode,
      api_version,
      payload_sha256,
      payload_size,
      provider_created_at,
      status,
      attempt_count,
      processing_token,
      processing_started_at
    )
    values (
      requested_external_event_id,
      requested_event_type,
      requested_livemode,
      requested_api_version,
      requested_payload_sha256,
      requested_payload_size,
      requested_provider_created_at,
      'processing',
      1,
      requested_processing_token,
      recorded_at
    )
    returning * into event_row;
    result_row.state := 'claimed';
  else
    if event_row.event_type is distinct from requested_event_type
      or event_row.livemode is distinct from requested_livemode
      or event_row.api_version is distinct from requested_api_version
      or event_row.payload_sha256 is distinct from requested_payload_sha256
      or event_row.payload_size is distinct from requested_payload_size
      or event_row.provider_created_at is distinct from requested_provider_created_at
    then
      raise exception using errcode = '55000', message = 'Stripe event ID was reused with different signed content.';
    end if;

    if event_row.status in ('processed', 'ignored') then
      result_row.state := event_row.status;
    elsif event_row.status = 'processing'
      and event_row.processing_started_at > recorded_at - interval '5 minutes'
      and event_row.processing_token = requested_processing_token
    then
      result_row.state := 'claimed';
    elsif event_row.status = 'processing'
      and event_row.processing_started_at > recorded_at - interval '5 minutes'
    then
      result_row.state := 'in_progress';
    else
      update public.stripe_webhook_events
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        processing_token = requested_processing_token,
        processing_started_at = recorded_at,
        failure_code = null,
        processed_at = null
      where id = event_row.id
      returning * into event_row;
      result_row.state := 'claimed';
    end if;
  end if;

  result_row.webhook_event_id := event_row.id;
  result_row.processing_token := case
    when result_row.state = 'claimed' then event_row.processing_token
    else null
  end;
  result_row.status := event_row.status;
  result_row.attempt_count := event_row.attempt_count;
  return next result_row;
end;
$$;

comment on function public.claim_stripe_webhook_event(text, text, boolean, text, text, integer, timestamptz, uuid) is
  'Service-only bounded Stripe event deduplication with signed-body collision detection, retryable failures, and a processing lease.';

create function public.finalize_stripe_webhook_event(
  requested_webhook_event_id uuid,
  requested_processing_token uuid,
  requested_outcome text,
  requested_case_id uuid,
  requested_order_id uuid,
  requested_failure_code text
)
returns setof public.stripe_webhook_finalize_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_row public.stripe_webhook_events%rowtype;
  result_row public.stripe_webhook_finalize_result;
  recorded_at timestamptz := statement_timestamp();
begin
  if requested_webhook_event_id is null
    or requested_processing_token is null
    or requested_outcome not in ('processed', 'ignored', 'failed')
    or ((requested_case_id is null) <> (requested_order_id is null))
    or (
      requested_outcome = 'failed'
      and (
        requested_failure_code is null
        or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
      )
    )
    or (requested_outcome <> 'failed' and requested_failure_code is not null)
  then
    raise exception using errcode = '22023', message = 'Stripe webhook outcome is invalid.';
  end if;

  select webhook_event.*
  into event_row
  from public.stripe_webhook_events as webhook_event
  where webhook_event.id = requested_webhook_event_id
  for update;

  if not found
    or event_row.status <> 'processing'
    or event_row.processing_token is distinct from requested_processing_token
  then
    raise exception using errcode = '55000', message = 'Stripe webhook processing lease is invalid.';
  end if;

  update public.stripe_webhook_events
  set
    status = requested_outcome,
    processing_token = null,
    processing_started_at = null,
    case_id = requested_case_id,
    order_id = requested_order_id,
    failure_code = requested_failure_code,
    processed_at = recorded_at
  where id = event_row.id
  returning * into event_row;

  result_row.webhook_event_id := event_row.id;
  result_row.status := event_row.status;
  result_row.attempt_count := event_row.attempt_count;
  return next result_row;
end;
$$;

comment on function public.finalize_stripe_webhook_event(uuid, uuid, text, uuid, uuid, text) is
  'Service-only lease-fenced webhook finalization; failed events remain reclaimable without changing their immutable signed-body identity.';

create function public.reserve_total_loss_refund(
  requested_case_id uuid,
  requested_order_id uuid,
  requested_payment_transaction_id uuid,
  requested_client_request_id uuid,
  requested_reason_code text,
  requested_access_policy text
)
returns setof public.total_loss_refund_reservation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  refund_row public.commerce_refund_requests%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  result_row public.total_loss_refund_reservation_result;
begin
  if requested_case_id is null
    or requested_order_id is null
    or requested_payment_transaction_id is null
    or requested_client_request_id is null
    or requested_reason_code is null
    or requested_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_access_policy not in ('retain', 'revoke')
  then
    raise exception using errcode = '22023', message = 'Refund request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select payment_transaction.*
  into payment_row
  from public.commerce_orders as commerce_order
  join public.payment_transactions as payment_transaction
    on payment_transaction.order_id = commerce_order.id
    and payment_transaction.case_id = commerce_order.case_id
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = requested_case_id
    and payment_transaction.id = requested_payment_transaction_id
    and payment_transaction.payment_provider = 'stripe'
    and payment_transaction.transaction_kind = 'payment'
    and payment_transaction.amount_minor_units = commerce_order.amount_minor_units
    and payment_transaction.currency = commerce_order.currency
  for update of commerce_order;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = requested_order_id
    for update;
  end if;

  if not found
    or order_row.payment_provider is distinct from 'stripe'
    or order_row.provider_livemode is null
  then
    raise exception using errcode = '22023', message = 'Refund payment context is invalid.';
  end if;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.order_id = requested_order_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Paid order entitlement is missing.';
  end if;

  select refund_request.*
  into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.order_id = requested_order_id
    and refund_request.client_request_id = requested_client_request_id
  for update;

  if found then
    if refund_row.case_id <> requested_case_id
      or refund_row.payment_transaction_id <> requested_payment_transaction_id
      or refund_row.payment_provider <> 'stripe'
      or refund_row.provider_livemode is distinct from order_row.provider_livemode
      or refund_row.amount_minor_units <> order_row.amount_minor_units
      or refund_row.currency <> order_row.currency
      or refund_row.reason_code <> requested_reason_code
      or refund_row.access_policy <> requested_access_policy
    then
      raise exception using errcode = '55000', message = 'Refund request ID was reused with different instructions.';
    end if;
    result_row.state := case
      when refund_row.status = 'succeeded' then 'already_succeeded'
      when refund_row.status = 'creating'
        and refund_row.external_refund_id is null then 'reserved'
      else 'existing'
    end;
    result_row.case_id := refund_row.case_id;
    result_row.order_id := refund_row.order_id;
    result_row.payment_transaction_id := refund_row.payment_transaction_id;
    result_row.refund_request_id := refund_row.id;
    result_row.refund_status := refund_row.status;
    result_row.provider_status := refund_row.provider_status;
    result_row.external_refund_id := refund_row.external_refund_id;
    result_row.external_payment_intent_id := payment_row.external_object_id;
    result_row.amount_minor_units := refund_row.amount_minor_units;
    result_row.currency := refund_row.currency;
    result_row.provider_livemode := refund_row.provider_livemode;
    result_row.access_policy := refund_row.access_policy;
    result_row.refund_transaction_id := refund_row.refund_transaction_id;
    result_row.refund_reversal_transaction_id := refund_row.refund_reversal_transaction_id;
    result_row.order_status := order_row.status::text;
    result_row.entitlement_status := entitlement_row.status::text;
    return next result_row;
    return;
  end if;

  if exists (
    select 1
    from public.commerce_refund_requests as material_refund
    where material_refund.payment_transaction_id = requested_payment_transaction_id
      and material_refund.order_id = requested_order_id
      and material_refund.status = 'succeeded'
      and material_refund.refund_transaction_id is not null
      and material_refund.refund_reversal_transaction_id is null
  ) then
    raise exception using errcode = '55000', message = 'Payment already has an effective full refund.';
  end if;

  select refund_request.*
  into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.payment_transaction_id = requested_payment_transaction_id
    and refund_request.status in ('creating', 'pending')
  for update;

  if found then
    if refund_row.reason_code <> requested_reason_code
      or refund_row.access_policy <> requested_access_policy
    then
      raise exception using errcode = '55000', message = 'Active refund has different instructions.';
    end if;
    result_row.state := 'existing';
  else
    if order_row.status not in ('paid', 'disputed') then
      raise exception using errcode = '55000', message = 'Only a paid or disputed order can be refunded.';
    end if;

    if (order_row.status = 'paid' and entitlement_row.status <> 'active')
      or (
        order_row.status = 'disputed'
        and (
          entitlement_row.status <> 'suspended'
          or entitlement_row.reason_code is distinct from 'STRIPE_DISPUTE'
        )
      )
    then
      raise exception using errcode = '55000', message = 'Refund entitlement projection is inconsistent.';
    end if;

    insert into public.commerce_refund_requests (
      case_id,
      order_id,
      payment_transaction_id,
      client_request_id,
      payment_provider,
      provider_livemode,
      access_policy,
      reason_code,
      amount_minor_units,
      currency
    )
    values (
      requested_case_id,
      requested_order_id,
      requested_payment_transaction_id,
      requested_client_request_id,
      'stripe',
      order_row.provider_livemode,
      requested_access_policy,
      requested_reason_code,
      order_row.amount_minor_units,
      order_row.currency
    )
    returning * into refund_row;
    result_row.state := 'reserved';
  end if;

  result_row.case_id := refund_row.case_id;
  result_row.order_id := refund_row.order_id;
  result_row.payment_transaction_id := refund_row.payment_transaction_id;
  result_row.refund_request_id := refund_row.id;
  result_row.refund_status := refund_row.status;
  result_row.provider_status := refund_row.provider_status;
  result_row.external_refund_id := refund_row.external_refund_id;
  result_row.external_payment_intent_id := payment_row.external_object_id;
  result_row.amount_minor_units := refund_row.amount_minor_units;
  result_row.currency := refund_row.currency;
  result_row.provider_livemode := refund_row.provider_livemode;
  result_row.access_policy := refund_row.access_policy;
  result_row.refund_transaction_id := refund_row.refund_transaction_id;
  result_row.refund_reversal_transaction_id := refund_row.refund_reversal_transaction_id;
  result_row.order_status := order_row.status::text;
  result_row.entitlement_status := entitlement_row.status::text;
  return next result_row;
end;
$$;

comment on function public.reserve_total_loss_refund(uuid, uuid, uuid, uuid, text, text) is
  'Service-only full-refund reservation with stable provider idempotency identity and explicit retain-or-revoke access policy.';

create function public.record_total_loss_refund_result(
  requested_refund_request_id uuid,
  requested_external_refund_id text,
  requested_external_event_id text,
  requested_provider_status text,
  requested_provider_occurred_at timestamptz,
  requested_failure_code text
)
returns setof public.total_loss_refund_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  refund_row public.commerce_refund_requests%rowtype;
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  transaction_row public.payment_transactions%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  result_row public.total_loss_refund_result;
  recorded_at timestamptz := statement_timestamp();
  local_refund_status text := case
    when requested_provider_status = 'requires_action' then 'pending'
    else requested_provider_status
  end;
begin
  if requested_refund_request_id is null
    or requested_provider_status not in (
      'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
    )
    or (
      requested_external_refund_id is not null
      and char_length(requested_external_refund_id) not between 1 and 255
    )
    or (
      requested_external_event_id is not null
      and char_length(requested_external_event_id) not between 1 and 255
    )
    or requested_provider_occurred_at is null
    or requested_provider_occurred_at > recorded_at + interval '5 minutes'
    or (
      requested_provider_status in ('pending', 'requires_action', 'succeeded')
      and requested_external_refund_id is null
    )
    or (
      requested_provider_status in ('pending', 'requires_action', 'succeeded')
      and requested_failure_code is not null
    )
    or (
      requested_provider_status in ('failed', 'canceled')
      and (
        requested_failure_code is null
        or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
      )
    )
  then
    raise exception using errcode = '22023', message = 'Stripe refund result is invalid.';
  end if;

  select refund_request.*
  into refund_row
  from public.commerce_refund_requests as refund_request
  join public.commerce_orders as commerce_order
    on commerce_order.id = refund_request.order_id
    and commerce_order.case_id = refund_request.case_id
  join public.payment_transactions as payment_transaction
    on payment_transaction.id = refund_request.payment_transaction_id
    and payment_transaction.order_id = refund_request.order_id
    and payment_transaction.case_id = refund_request.case_id
  where refund_request.id = requested_refund_request_id
  for update of refund_request, commerce_order;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = refund_row.order_id
    for update;

    select payment_transaction.*
    into payment_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.id = refund_row.payment_transaction_id;
  end if;

  if not found then
    raise exception using errcode = '22023', message = 'Refund request does not exist.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(refund_row.case_id::text)
  );

  if refund_row.external_refund_id is not null
    and refund_row.external_refund_id is distinct from requested_external_refund_id
  then
    raise exception using errcode = '55000', message = 'Refund provider identity is immutable.';
  end if;

  if refund_row.status = 'succeeded' then
    if refund_row.external_refund_id is distinct from requested_external_refund_id then
      raise exception using errcode = '55000', message = 'Successful refund provider identity is immutable.';
    end if;
    select payment_transaction.*
    into transaction_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.payment_provider = 'stripe'
      and payment_transaction.external_object_id = requested_external_refund_id;
    select entitlement.* into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = refund_row.order_id;
    if requested_provider_status = 'succeeded' then
      result_row.outcome := 'already_succeeded';
    elsif requested_provider_occurred_at <= refund_row.provider_occurred_at then
      result_row.outcome := 'stale';
    else
      raise exception using errcode = '55000', message = 'Successful refund cannot regress to another provider status.';
    end if;
  elsif refund_row.status in ('failed', 'canceled') then
    if refund_row.external_refund_id is distinct from requested_external_refund_id then
      raise exception using errcode = '55000', message = 'Terminal refund provider identity is immutable.';
    end if;
    select entitlement.* into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = refund_row.order_id;
    if requested_provider_occurred_at <= refund_row.provider_occurred_at then
      result_row.outcome := 'stale';
    elsif requested_provider_status = refund_row.provider_status
      and requested_failure_code = refund_row.failure_code
    then
      result_row.outcome := 'already_' || refund_row.status;
    else
      raise exception using errcode = '55000', message = 'Terminal refund status cannot be rewritten.';
    end if;
  elsif requested_provider_status in ('pending', 'requires_action') then
    if refund_row.status = 'pending'
      and requested_provider_occurred_at <= refund_row.provider_occurred_at
    then
      result_row.outcome := 'stale';
    else
      update public.commerce_refund_requests
      set
        external_refund_id = requested_external_refund_id,
        status = 'pending',
        provider_status = requested_provider_status,
        provider_occurred_at = requested_provider_occurred_at
      where id = refund_row.id
      returning * into refund_row;
      result_row.outcome := 'pending';
    end if;
  elsif requested_provider_status in ('failed', 'canceled') then
    update public.commerce_refund_requests
    set
      external_refund_id = requested_external_refund_id,
      status = local_refund_status,
      provider_status = requested_provider_status,
      provider_occurred_at = requested_provider_occurred_at,
      finished_at = recorded_at,
      failure_code = requested_failure_code
    where id = refund_row.id
    returning * into refund_row;
    result_row.outcome := requested_provider_status;
  else
    if order_row.status <> 'paid' then
      raise exception using errcode = '55000', message = 'Refund cannot finalize from the current order state.';
    end if;

    select payment_transaction.*
    into transaction_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.payment_provider = 'stripe'
      and payment_transaction.external_object_id = requested_external_refund_id;

    if found then
      if transaction_row.related_transaction_id <> payment_row.id
        or transaction_row.transaction_kind <> 'refund'
      then
        raise exception using errcode = '55000', message = 'Stripe refund is already bound to another payment.';
      end if;
    else
      insert into public.payment_transactions (
        case_id,
        order_id,
        checkout_attempt_id,
        related_transaction_id,
        payment_provider,
        transaction_kind,
        external_object_id,
        external_event_id,
        amount_minor_units,
        currency,
        provider_occurred_at,
        metadata
      )
      values (
        refund_row.case_id,
        refund_row.order_id,
        payment_row.checkout_attempt_id,
        payment_row.id,
        'stripe',
        'refund',
        requested_external_refund_id,
        requested_external_event_id,
        refund_row.amount_minor_units,
        refund_row.currency,
        requested_provider_occurred_at,
        jsonb_build_object(
          'access_policy', refund_row.access_policy,
          'reason_code', refund_row.reason_code
        )
      )
      returning * into transaction_row;
    end if;

    update public.commerce_orders
    set
      status = 'refunded',
      refunded_at = requested_provider_occurred_at
    where id = refund_row.order_id
    returning * into order_row;

    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = refund_row.order_id
    for update;

    if not found then
      raise exception using errcode = '55000', message = 'Paid order entitlement is missing.';
    end if;

    if refund_row.access_policy = 'retain' then
      update public.case_entitlements
      set
        status = 'refunded_access_retained',
        status_changed_at = recorded_at,
        revoked_at = null,
        reason_code = refund_row.reason_code
      where id = entitlement_row.id
      returning * into entitlement_row;
    else
      update public.case_entitlements
      set
        status = 'revoked',
        status_changed_at = recorded_at,
        revoked_at = recorded_at,
        reason_code = refund_row.reason_code
      where id = entitlement_row.id
      returning * into entitlement_row;
    end if;

    update public.commerce_refund_requests
    set
      external_refund_id = requested_external_refund_id,
      status = 'succeeded',
      provider_status = 'succeeded',
      provider_occurred_at = requested_provider_occurred_at,
      finished_at = recorded_at,
      failure_code = null
    where id = refund_row.id
    returning * into refund_row;
    result_row.outcome := 'succeeded';
  end if;

  if entitlement_row.id is null then
    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = refund_row.order_id;
  end if;

  result_row.case_id := refund_row.case_id;
  result_row.order_id := refund_row.order_id;
  result_row.refund_request_id := refund_row.id;
  result_row.refund_status := refund_row.status;
  result_row.provider_status := refund_row.provider_status;
  result_row.refund_transaction_id := transaction_row.id;
  result_row.order_status := order_row.status::text;
  result_row.entitlement_status := entitlement_row.status::text;
  return next result_row;
end;
$$;

comment on function public.record_total_loss_refund_result(uuid, text, text, text, timestamptz, text) is
  'Service-only authoritative Stripe refund projection; material refunds are immutable and entitlement access policy remains explicit.';

drop function public.record_total_loss_refund_result(
  uuid, text, text, text, timestamptz, text
);

create function public.record_total_loss_refund_result(
  requested_refund_request_id uuid,
  requested_external_refund_id text,
  requested_external_event_id text,
  requested_external_balance_transaction_id text,
  requested_external_failure_balance_transaction_id text,
  requested_provider_status text,
  requested_provider_occurred_at timestamptz,
  requested_failure_code text
)
returns setof public.total_loss_refund_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_case_id uuid;
  refund_row public.commerce_refund_requests%rowtype;
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  transaction_row public.payment_transactions%rowtype;
  reversal_row public.payment_transactions%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  result_row public.total_loss_refund_result;
  recorded_at timestamptz := statement_timestamp();
  has_unfavorable_dispute boolean := false;
  has_later_successful_refund boolean := false;
  local_refund_status text := case
    when requested_provider_status = 'requires_action' then 'pending'
    else requested_provider_status
  end;
begin
  if requested_refund_request_id is null
    or requested_provider_status not in (
      'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
    )
    or (
      requested_external_refund_id is not null
      and char_length(requested_external_refund_id) not between 1 and 255
    )
    or (
      requested_external_event_id is not null
      and char_length(requested_external_event_id) not between 1 and 255
    )
    or (
      requested_external_balance_transaction_id is not null
      and requested_external_balance_transaction_id !~ '^txn_[A-Za-z0-9_]{1,250}$'
    )
    or (
      requested_external_failure_balance_transaction_id is not null
      and requested_external_failure_balance_transaction_id !~ '^txn_[A-Za-z0-9_]{1,250}$'
    )
    or requested_provider_occurred_at is null
    or requested_provider_occurred_at > recorded_at + interval '5 minutes'
    or (
      requested_provider_status in ('pending', 'requires_action')
      and (
        requested_external_refund_id is null
        or requested_external_failure_balance_transaction_id is not null
        or requested_failure_code is not null
      )
    )
    or (
      requested_provider_status = 'succeeded'
      and (
        requested_external_refund_id is null
        or requested_external_balance_transaction_id is null
        or requested_external_failure_balance_transaction_id is not null
        or requested_failure_code is not null
      )
    )
    or (
      requested_provider_status in ('failed', 'canceled')
      and (
        requested_failure_code is null
        or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
        or (
          requested_external_balance_transaction_id is not null
          and requested_external_refund_id is null
        )
        or (
          (requested_external_balance_transaction_id is null)
          <> (requested_external_failure_balance_transaction_id is null)
        )
      )
    )
  then
    raise exception using errcode = '22023', message = 'Stripe refund result is invalid.';
  end if;

  select refund_request.case_id
  into locked_case_id
  from public.commerce_refund_requests as refund_request
  where refund_request.id = requested_refund_request_id;

  if not found then
    raise exception using errcode = '22023', message = 'Refund request does not exist.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(locked_case_id::text)
  );

  select refund_request.*
  into refund_row
  from public.commerce_refund_requests as refund_request
  join public.commerce_orders as commerce_order
    on commerce_order.id = refund_request.order_id
    and commerce_order.case_id = refund_request.case_id
  join public.payment_transactions as payment_transaction
    on payment_transaction.id = refund_request.payment_transaction_id
    and payment_transaction.order_id = refund_request.order_id
    and payment_transaction.case_id = refund_request.case_id
    and payment_transaction.payment_provider = refund_request.payment_provider
    and payment_transaction.currency = refund_request.currency
  where refund_request.id = requested_refund_request_id
    and refund_request.case_id = locked_case_id
  for update of refund_request, commerce_order;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = refund_row.order_id
    for update;

    select payment_transaction.*
    into payment_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.id = refund_row.payment_transaction_id;

    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = refund_row.order_id
    for update;
  end if;

  if not found
    or refund_row.case_id <> locked_case_id
    or refund_row.payment_provider <> 'stripe'
    or refund_row.provider_livemode is distinct from order_row.provider_livemode
    or payment_row.transaction_kind <> 'payment'
    or payment_row.amount_minor_units <> refund_row.amount_minor_units
    or payment_row.currency <> refund_row.currency
    or entitlement_row.id is null
  then
    raise exception using errcode = '55000', message = 'Refund request context changed before it was locked.';
  end if;

  if refund_row.external_refund_id is not null
    and requested_external_refund_id is not null
    and refund_row.external_refund_id is distinct from requested_external_refund_id
  then
    raise exception using errcode = '55000', message = 'Refund provider identity is immutable.';
  end if;

  if refund_row.external_balance_transaction_id is not null
    and requested_external_balance_transaction_id is not null
    and refund_row.external_balance_transaction_id is distinct from requested_external_balance_transaction_id
  then
    raise exception using errcode = '55000', message = 'Refund balance transaction identity is immutable.';
  end if;

  if refund_row.external_failure_balance_transaction_id is not null
    and requested_external_failure_balance_transaction_id is not null
    and refund_row.external_failure_balance_transaction_id is distinct from requested_external_failure_balance_transaction_id
  then
    raise exception using errcode = '55000', message = 'Refund failure balance transaction identity is immutable.';
  end if;

  if refund_row.refund_transaction_id is not null then
    select payment_transaction.*
    into transaction_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.id = refund_row.refund_transaction_id;

    if not found
      or transaction_row.case_id <> refund_row.case_id
      or transaction_row.order_id <> refund_row.order_id
      or transaction_row.related_transaction_id <> payment_row.id
      or transaction_row.transaction_kind <> 'refund'
      or transaction_row.external_object_id <> refund_row.external_balance_transaction_id
      or transaction_row.amount_minor_units <> refund_row.amount_minor_units
      or transaction_row.currency <> refund_row.currency
    then
      raise exception using errcode = '55000', message = 'Refund financial evidence is inconsistent.';
    end if;
  end if;

  if refund_row.refund_reversal_transaction_id is not null then
    select payment_transaction.*
    into reversal_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.id = refund_row.refund_reversal_transaction_id;

    if not found
      or reversal_row.case_id <> refund_row.case_id
      or reversal_row.order_id <> refund_row.order_id
      or reversal_row.related_transaction_id <> refund_row.refund_transaction_id
      or reversal_row.transaction_kind <> 'adjustment'
      or reversal_row.external_object_id <> refund_row.external_failure_balance_transaction_id
      or reversal_row.amount_minor_units <> refund_row.amount_minor_units
      or reversal_row.currency <> refund_row.currency
    then
      raise exception using errcode = '55000', message = 'Refund reversal evidence is inconsistent.';
    end if;
  end if;

  if refund_row.status in ('failed', 'canceled') then
    if requested_provider_status = refund_row.provider_status
      and requested_failure_code = refund_row.failure_code
      and requested_external_refund_id is not distinct from refund_row.external_refund_id
      and requested_external_balance_transaction_id is not distinct from refund_row.external_balance_transaction_id
      and requested_external_failure_balance_transaction_id is not distinct from refund_row.external_failure_balance_transaction_id
    then
      result_row.outcome := 'already_' || refund_row.status;
    elsif requested_provider_occurred_at < refund_row.provider_occurred_at then
      result_row.outcome := 'stale';
    elsif requested_provider_status in ('pending', 'requires_action', 'succeeded') then
      result_row.outcome := 'stale';
    else
      raise exception using errcode = '55000', message = 'Terminal refund status cannot be rewritten.';
    end if;
  elsif refund_row.status = 'succeeded' then
    if requested_provider_status = 'succeeded' then
      if requested_external_balance_transaction_id is distinct from refund_row.external_balance_transaction_id then
        raise exception using errcode = '55000', message = 'Successful refund balance identity is immutable.';
      end if;
      result_row.outcome := 'already_succeeded';
    elsif requested_provider_occurred_at < refund_row.provider_occurred_at then
      result_row.outcome := 'stale';
    elsif requested_provider_status in ('failed', 'canceled') then
      if requested_external_refund_id is distinct from refund_row.external_refund_id
        or requested_external_balance_transaction_id is distinct from refund_row.external_balance_transaction_id
        or requested_external_failure_balance_transaction_id is null
      then
        raise exception using errcode = '55000', message = 'Refund reversal provider evidence is incomplete.';
      end if;

      select payment_transaction.*
      into reversal_row
      from public.payment_transactions as payment_transaction
      where payment_transaction.payment_provider = 'stripe'
        and payment_transaction.external_object_id = requested_external_failure_balance_transaction_id;

      if found then
        if reversal_row.related_transaction_id <> transaction_row.id
          or reversal_row.transaction_kind <> 'adjustment'
          or reversal_row.amount_minor_units <> refund_row.amount_minor_units
          or reversal_row.currency <> refund_row.currency
        then
          raise exception using errcode = '55000', message = 'Stripe refund reversal is already bound to another movement.';
        end if;
      else
        insert into public.payment_transactions (
          case_id,
          order_id,
          checkout_attempt_id,
          related_transaction_id,
          payment_provider,
          transaction_kind,
          external_object_id,
          external_event_id,
          amount_minor_units,
          currency,
          provider_occurred_at,
          metadata
        ) values (
          refund_row.case_id,
          refund_row.order_id,
          payment_row.checkout_attempt_id,
          transaction_row.id,
          'stripe',
          'adjustment',
          requested_external_failure_balance_transaction_id,
          requested_external_event_id,
          refund_row.amount_minor_units,
          refund_row.currency,
          requested_provider_occurred_at,
          jsonb_build_object(
            'external_refund_id', refund_row.external_refund_id,
            'funds_movement', 'refund_reversal'
          )
        ) returning * into reversal_row;
      end if;

      update public.commerce_refund_requests
      set
        status = local_refund_status,
        provider_status = requested_provider_status,
        external_failure_balance_transaction_id = requested_external_failure_balance_transaction_id,
        refund_reversal_transaction_id = reversal_row.id,
        provider_occurred_at = requested_provider_occurred_at,
        finished_at = recorded_at,
        failure_code = requested_failure_code
      where id = refund_row.id
      returning * into refund_row;

      result_row.outcome := requested_provider_status;
    elsif requested_provider_status in ('pending', 'requires_action') then
      result_row.outcome := 'stale';
    else
      raise exception using errcode = '55000', message = 'Successful refund cannot transition to that provider status.';
    end if;
  elsif requested_provider_status in ('pending', 'requires_action') then
    if refund_row.status = 'pending'
      and requested_provider_occurred_at < refund_row.provider_occurred_at
    then
      result_row.outcome := 'stale';
    else
      update public.commerce_refund_requests
      set
        external_refund_id = coalesce(requested_external_refund_id, external_refund_id),
        external_balance_transaction_id = coalesce(
          requested_external_balance_transaction_id,
          external_balance_transaction_id
        ),
        status = 'pending',
        provider_status = requested_provider_status,
        provider_occurred_at = requested_provider_occurred_at
      where id = refund_row.id
      returning * into refund_row;
      result_row.outcome := 'pending';
    end if;
  elsif requested_provider_status in ('failed', 'canceled') then
    if refund_row.provider_occurred_at is not null
      and requested_provider_occurred_at < refund_row.provider_occurred_at
    then
      result_row.outcome := 'stale';
    else
      if refund_row.external_balance_transaction_id is not null
        and requested_external_balance_transaction_id is null
      then
        raise exception using errcode = '55000', message = 'Refund reversal provider evidence is incomplete.';
      end if;

      if requested_external_balance_transaction_id is not null then
        select payment_transaction.*
        into transaction_row
        from public.payment_transactions as payment_transaction
        where payment_transaction.payment_provider = 'stripe'
          and payment_transaction.external_object_id = requested_external_balance_transaction_id;

        if found then
          if transaction_row.related_transaction_id <> payment_row.id
            or transaction_row.transaction_kind <> 'refund'
          then
            raise exception using errcode = '55000', message = 'Stripe refund movement is already bound to another payment.';
          end if;
        else
          insert into public.payment_transactions (
            case_id, order_id, checkout_attempt_id, related_transaction_id,
            payment_provider, transaction_kind, external_object_id,
            external_event_id, amount_minor_units, currency,
            provider_occurred_at, metadata
          ) values (
            refund_row.case_id, refund_row.order_id,
            payment_row.checkout_attempt_id, payment_row.id,
            'stripe', 'refund', requested_external_balance_transaction_id,
            null, refund_row.amount_minor_units, refund_row.currency,
            requested_provider_occurred_at,
            jsonb_build_object(
              'external_refund_id', requested_external_refund_id,
              'observed_with_terminal_failure', true
            )
          ) returning * into transaction_row;
        end if;

        select payment_transaction.*
        into reversal_row
        from public.payment_transactions as payment_transaction
        where payment_transaction.payment_provider = 'stripe'
          and payment_transaction.external_object_id = requested_external_failure_balance_transaction_id;

        if found then
          if reversal_row.related_transaction_id <> transaction_row.id
            or reversal_row.transaction_kind <> 'adjustment'
          then
            raise exception using errcode = '55000', message = 'Stripe refund reversal is already bound to another movement.';
          end if;
        else
          insert into public.payment_transactions (
            case_id, order_id, checkout_attempt_id, related_transaction_id,
            payment_provider, transaction_kind, external_object_id,
            external_event_id, amount_minor_units, currency,
            provider_occurred_at, metadata
          ) values (
            refund_row.case_id, refund_row.order_id,
            payment_row.checkout_attempt_id, transaction_row.id,
            'stripe', 'adjustment',
            requested_external_failure_balance_transaction_id,
            requested_external_event_id, refund_row.amount_minor_units,
            refund_row.currency, requested_provider_occurred_at,
            jsonb_build_object(
              'external_refund_id', requested_external_refund_id,
              'funds_movement', 'refund_reversal'
            )
          ) returning * into reversal_row;
        end if;
      end if;

      update public.commerce_refund_requests
      set
        external_refund_id = coalesce(requested_external_refund_id, external_refund_id),
        external_balance_transaction_id = requested_external_balance_transaction_id,
        external_failure_balance_transaction_id = requested_external_failure_balance_transaction_id,
        refund_transaction_id = transaction_row.id,
        refund_reversal_transaction_id = reversal_row.id,
        status = local_refund_status,
        provider_status = requested_provider_status,
        provider_occurred_at = requested_provider_occurred_at,
        finished_at = recorded_at,
        failure_code = requested_failure_code
      where id = refund_row.id
      returning * into refund_row;
      result_row.outcome := requested_provider_status;
    end if;
  else
    if order_row.status not in ('paid', 'disputed') then
      raise exception using errcode = '55000', message = 'Refund cannot finalize from the current order state.';
    end if;

    select exists (
      select 1
      from public.commerce_disputes as dispute
      where dispute.order_id = refund_row.order_id
        and dispute.status in ('active', 'lost')
    ) into has_unfavorable_dispute;

    if (order_row.status = 'paid' and entitlement_row.status <> 'active')
      or (
        order_row.status = 'disputed'
        and (
          not has_unfavorable_dispute
          or entitlement_row.status <> 'suspended'
          or entitlement_row.reason_code is distinct from 'STRIPE_DISPUTE'
        )
      )
    then
      raise exception using errcode = '55000', message = 'Refund entitlement projection is inconsistent.';
    end if;

    select payment_transaction.*
    into transaction_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.payment_provider = 'stripe'
      and payment_transaction.external_object_id = requested_external_balance_transaction_id;

    if found then
      if transaction_row.related_transaction_id <> payment_row.id
        or transaction_row.transaction_kind <> 'refund'
        or transaction_row.amount_minor_units <> refund_row.amount_minor_units
        or transaction_row.currency <> refund_row.currency
      then
        raise exception using errcode = '55000', message = 'Stripe refund movement is already bound to another payment.';
      end if;
    else
      insert into public.payment_transactions (
        case_id,
        order_id,
        checkout_attempt_id,
        related_transaction_id,
        payment_provider,
        transaction_kind,
        external_object_id,
        external_event_id,
        amount_minor_units,
        currency,
        provider_occurred_at,
        metadata
      ) values (
        refund_row.case_id,
        refund_row.order_id,
        payment_row.checkout_attempt_id,
        payment_row.id,
        'stripe',
        'refund',
        requested_external_balance_transaction_id,
        requested_external_event_id,
        refund_row.amount_minor_units,
        refund_row.currency,
        requested_provider_occurred_at,
        jsonb_build_object(
          'external_refund_id', requested_external_refund_id,
          'access_policy', refund_row.access_policy,
          'reason_code', refund_row.reason_code
        )
      ) returning * into transaction_row;
    end if;

    update public.commerce_refund_requests
    set
      external_refund_id = requested_external_refund_id,
      external_balance_transaction_id = requested_external_balance_transaction_id,
      refund_transaction_id = transaction_row.id,
      status = 'succeeded',
      provider_status = 'succeeded',
      provider_occurred_at = requested_provider_occurred_at,
      finished_at = recorded_at,
      failure_code = null
    where id = refund_row.id
    returning * into refund_row;
    result_row.outcome := 'succeeded';
  end if;

  select coverage.order_status, coverage.entitlement_status
  into result_row.order_status, result_row.entitlement_status
  from public.project_total_loss_order_coverage_internal(
    refund_row.order_id,
    recorded_at
  ) as coverage;

  if refund_row.status in ('failed', 'canceled')
    and result_row.outcome in (
      'already_failed', 'already_canceled', 'stale'
    )
    and result_row.order_status = 'refunded'
  then
    select exists (
      select 1
      from public.commerce_refund_requests as later_refund
      where later_refund.order_id = refund_row.order_id
        and later_refund.id <> refund_row.id
        and later_refund.status = 'succeeded'
        and later_refund.refund_transaction_id is not null
    ) into has_later_successful_refund;

    if has_later_successful_refund then
      result_row.outcome := 'stale';
    end if;
  end if;

  result_row.case_id := refund_row.case_id;
  result_row.order_id := refund_row.order_id;
  result_row.refund_request_id := refund_row.id;
  result_row.refund_status := refund_row.status;
  result_row.provider_status := refund_row.provider_status;
  result_row.refund_transaction_id := refund_row.refund_transaction_id;
  result_row.refund_reversal_transaction_id := refund_row.refund_reversal_transaction_id;
  return next result_row;
end;
$$;

comment on function public.record_total_loss_refund_result(uuid, text, text, text, text, text, timestamptz, text) is
  'Service-only Stripe refund lifecycle projection with immutable balance movements, authoritative success reversal, and dispute-aware entitlement state.';

create function public.record_total_loss_dispute(
  requested_case_id uuid,
  requested_order_id uuid,
  requested_payment_transaction_id uuid,
  requested_external_dispute_id text,
  requested_external_event_id text,
  requested_event_type text,
  requested_dispute_status text,
  requested_amount_minor_units bigint,
  requested_currency text,
  requested_provider_occurred_at timestamptz
)
returns setof public.total_loss_dispute_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  dispute_row public.commerce_disputes%rowtype;
  baseline_row public.commerce_disputes%rowtype;
  debit_row public.payment_transactions%rowtype;
  reversal_row public.payment_transactions%rowtype;
  result_row public.total_loss_dispute_result;
  recorded_at timestamptz := statement_timestamp();
  is_new boolean := false;
  status_outcome text;
  status_applied boolean := false;
  movement_applied boolean := false;
  movement_duplicate boolean := false;
  requested_financial_transaction_id uuid;
begin
  if requested_case_id is null
    or requested_order_id is null
    or requested_payment_transaction_id is null
    or requested_external_dispute_id is null
    or char_length(requested_external_dispute_id) not between 1 and 240
    or requested_external_event_id is null
    or char_length(requested_external_event_id) not between 1 and 255
    or requested_event_type not in (
      'charge.dispute.created',
      'charge.dispute.updated',
      'charge.dispute.closed',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated'
    )
    or requested_dispute_status not in ('active', 'won', 'lost')
    or requested_amount_minor_units is null
    or requested_amount_minor_units <= 0
    or requested_currency is null
    or requested_currency !~ '^[A-Z]{3}$'
    or requested_provider_occurred_at is null
    or requested_provider_occurred_at > recorded_at + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'Stripe dispute input is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select payment_transaction.*
  into payment_row
  from public.commerce_orders as commerce_order
  join public.payment_transactions as payment_transaction
    on payment_transaction.order_id = commerce_order.id
    and payment_transaction.case_id = commerce_order.case_id
  where commerce_order.id = requested_order_id
    and commerce_order.case_id = requested_case_id
    and payment_transaction.id = requested_payment_transaction_id
    and payment_transaction.payment_provider = 'stripe'
    and payment_transaction.transaction_kind = 'payment'
  for update of commerce_order;

  if found then
    select commerce_order.*
    into order_row
    from public.commerce_orders as commerce_order
    where commerce_order.id = requested_order_id
    for update;
  end if;

  if not found
    or order_row.provider_livemode is null
    or payment_row.currency is distinct from requested_currency
  then
    raise exception using errcode = '22023', message = 'Stripe dispute payment context is invalid.';
  end if;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.order_id = requested_order_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Paid order entitlement is missing.';
  end if;

  select dispute.*
  into dispute_row
  from public.commerce_disputes as dispute
  where dispute.payment_provider = 'stripe'
    and dispute.external_dispute_id = requested_external_dispute_id
  for update;

  if found then
    if dispute_row.case_id <> requested_case_id
      or dispute_row.order_id <> requested_order_id
      or dispute_row.payment_transaction_id <> requested_payment_transaction_id
      or dispute_row.provider_livemode is distinct from order_row.provider_livemode
      or dispute_row.amount_minor_units <> requested_amount_minor_units
      or dispute_row.currency <> requested_currency
    then
      raise exception using errcode = '55000', message = 'Stripe dispute is already bound to another payment.';
    end if;

    if dispute_row.latest_external_event_id = requested_external_event_id then
      status_outcome := 'duplicate';
    elsif requested_provider_occurred_at < dispute_row.provider_occurred_at
      or dispute_row.status = 'won'
      or (
        dispute_row.status = 'lost'
        and requested_dispute_status <> 'won'
      )
      or (
        dispute_row.status = 'active'
        and requested_dispute_status = 'active'
        and requested_provider_occurred_at = dispute_row.provider_occurred_at
      )
    then
      status_outcome := 'stale';
    else
      status_outcome := 'applied';
    end if;
  else
    select sibling_dispute.*
    into baseline_row
    from public.commerce_disputes as sibling_dispute
    where sibling_dispute.order_id = requested_order_id
      and sibling_dispute.status in ('active', 'lost')
    order by sibling_dispute.created_at, sibling_dispute.id
    limit 1
    for share;

    if baseline_row.id is null
      and (
        order_row.status = 'disputed'
        or (
          entitlement_row.status = 'suspended'
          and entitlement_row.reason_code = 'STRIPE_DISPUTE'
        )
      )
    then
      raise exception using errcode = '55000', message = 'Stripe dispute baseline is unavailable.';
    end if;

    insert into public.commerce_disputes (
      case_id,
      order_id,
      payment_transaction_id,
      payment_provider,
      provider_livemode,
      external_dispute_id,
      latest_external_event_id,
      status,
      amount_minor_units,
      currency,
      prior_order_status,
      prior_entitlement_status,
      prior_entitlement_reason_code,
      provider_occurred_at,
      opened_at,
      closed_at
    )
    values (
      requested_case_id,
      requested_order_id,
      requested_payment_transaction_id,
      'stripe',
      order_row.provider_livemode,
      requested_external_dispute_id,
      requested_external_event_id,
      requested_dispute_status,
      requested_amount_minor_units,
      requested_currency,
      case
        when baseline_row.id is not null then baseline_row.prior_order_status
        else order_row.status
      end,
      case
        when baseline_row.id is not null then baseline_row.prior_entitlement_status
        else entitlement_row.status
      end,
      case
        when baseline_row.id is not null then baseline_row.prior_entitlement_reason_code
        else entitlement_row.reason_code
      end,
      requested_provider_occurred_at,
      case when requested_dispute_status = 'active' then requested_provider_occurred_at end,
      case when requested_dispute_status in ('won', 'lost') then requested_provider_occurred_at end
    )
    returning * into dispute_row;
    is_new := true;
    status_outcome := 'applied';
    status_applied := true;
  end if;

  if not is_new and status_outcome = 'applied' then
    update public.commerce_disputes
    set
      latest_external_event_id = requested_external_event_id,
      provider_occurred_at = requested_provider_occurred_at,
      status = requested_dispute_status,
      opened_at = case
        when requested_dispute_status = 'active'
          then coalesce(opened_at, requested_provider_occurred_at)
        else opened_at
      end,
      closed_at = case
        when requested_dispute_status = 'active' then null
        else requested_provider_occurred_at
      end
    where id = dispute_row.id
    returning * into dispute_row;
    status_applied := true;
  end if;

  if requested_event_type = 'charge.dispute.funds_withdrawn' then
    if dispute_row.funds_withdrawn_external_event_id is null then
      insert into public.payment_transactions (
        case_id,
        order_id,
        checkout_attempt_id,
        related_transaction_id,
        payment_provider,
        transaction_kind,
        external_object_id,
        external_event_id,
        amount_minor_units,
        currency,
        provider_occurred_at,
        metadata
      )
      values (
        requested_case_id,
        requested_order_id,
        payment_row.checkout_attempt_id,
        payment_row.id,
        'stripe',
        'dispute',
        requested_external_dispute_id || ':debit',
        requested_external_event_id,
        requested_amount_minor_units,
        requested_currency,
        requested_provider_occurred_at,
        jsonb_build_object(
          'dispute_status', requested_dispute_status,
          'funds_movement', 'withdrawn'
        )
      )
      returning * into debit_row;

      update public.commerce_disputes
      set
        funds_withdrawn_external_event_id = requested_external_event_id,
        funds_withdrawn_occurred_at = requested_provider_occurred_at,
        funds_withdrawn_transaction_id = debit_row.id
      where id = dispute_row.id
      returning * into dispute_row;
      movement_applied := true;
      requested_financial_transaction_id := debit_row.id;
    elsif dispute_row.funds_withdrawn_external_event_id = requested_external_event_id then
      movement_duplicate := true;
    else
      raise exception using errcode = '55000', message = 'Stripe dispute funds-withdrawn identity changed.';
    end if;
  elsif requested_event_type = 'charge.dispute.funds_reinstated' then
    if dispute_row.funds_reinstated_external_event_id is null then
      update public.commerce_disputes
      set
        funds_reinstated_external_event_id = requested_external_event_id,
        funds_reinstated_occurred_at = requested_provider_occurred_at
      where id = dispute_row.id
      returning * into dispute_row;
      movement_applied := true;
    elsif dispute_row.funds_reinstated_external_event_id = requested_external_event_id then
      movement_duplicate := true;
    else
      raise exception using errcode = '55000', message = 'Stripe dispute funds-reinstated identity changed.';
    end if;
  end if;

  if dispute_row.funds_withdrawn_transaction_id is not null
    and dispute_row.funds_reinstated_external_event_id is not null
    and dispute_row.funds_reinstated_transaction_id is null
  then
    select payment_transaction.*
    into debit_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.id = dispute_row.funds_withdrawn_transaction_id;

    insert into public.payment_transactions (
      case_id,
      order_id,
      checkout_attempt_id,
      related_transaction_id,
      payment_provider,
      transaction_kind,
      external_object_id,
      external_event_id,
      amount_minor_units,
      currency,
      provider_occurred_at,
      metadata
    )
    values (
      requested_case_id,
      requested_order_id,
      payment_row.checkout_attempt_id,
      debit_row.id,
      'stripe',
      'dispute_reversal',
      requested_external_dispute_id || ':reversal',
      dispute_row.funds_reinstated_external_event_id,
      requested_amount_minor_units,
      requested_currency,
      dispute_row.funds_reinstated_occurred_at,
      jsonb_build_object(
        'dispute_status', dispute_row.status,
        'funds_movement', 'reinstated'
      )
    )
    returning * into reversal_row;

    update public.commerce_disputes
    set funds_reinstated_transaction_id = reversal_row.id
    where id = dispute_row.id
    returning * into dispute_row;

    if requested_event_type = 'charge.dispute.funds_reinstated' then
      requested_financial_transaction_id := reversal_row.id;
    end if;
  end if;

  select coverage.order_status, coverage.entitlement_status
  into result_row.order_status, result_row.entitlement_status
  from public.project_total_loss_order_coverage_internal(
    requested_order_id,
    recorded_at
  ) as coverage;

  result_row.outcome := case
    when status_applied or movement_applied then 'applied'
    when status_outcome = 'duplicate' or movement_duplicate then 'duplicate'
    else 'stale'
  end;
  result_row.case_id := requested_case_id;
  result_row.order_id := requested_order_id;
  result_row.dispute_id := dispute_row.id;
  result_row.dispute_status := dispute_row.status;
  result_row.financial_transaction_id := requested_financial_transaction_id;
  return next result_row;
end;
$$;

comment on function public.record_total_loss_dispute(uuid, uuid, uuid, text, text, text, text, bigint, text, timestamptz) is
  'Service-only Stripe dispute projection with sibling aggregation, late-win support, and event-specific immutable funds movement evidence.';

alter type public.total_loss_case_claim_resume_result
add attribute checkout_available boolean,
add attribute commerce_order_status text,
add attribute payment_status text,
add attribute entitlement_status text,
add attribute next_task text;

create or replace function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  result_row public.total_loss_case_claim_resume_result;
begin
  if authenticated_user_id is null or requested_case_id is null then
    return;
  end if;

  select auth_user.*
  into authenticated_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id;

  if not found then
    return;
  end if;

  select contact.*
  into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal(requested_case_id)
  then
    return;
  end if;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.case_id = requested_case_id
  order by commerce_order.created_at desc, commerce_order.id desc
  limit 1;

  if order_row.id is not null then
    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = order_row.id;
  end if;

  if coalesce(authenticated_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal(requested_case_id) then
      return;
    end if;
    result_row.state := 'secure_required';
  elsif authenticated_user.email_confirmed_at is not null
    and nullif(btrim(authenticated_user.email), '') is not null
    and lower(btrim(authenticated_user.email)) = contact_row.email
  then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  result_row.case_id := requested_case_id;
  result_row.contact_email := contact_row.email;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := workflow_row.current_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := (
    result_row.state = 'secured'
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'secure_claim'
    and entitlement_row.id is null
    and (
      order_row.id is null
      or (
        order_row.status = 'pending'
        and order_row.purchaser_email is not null
      )
    )
    and not exists (
      select 1
      from public.checkout_attempts as completed_attempt
      where completed_attempt.order_id = order_row.id
        and completed_attempt.status = 'complete'
    )
  );
  if result_row.state = 'secured' then
    result_row.commerce_order_status := order_row.status::text;
    result_row.payment_status := case
      when order_row.id is null then null
      when order_row.status = 'pending' then 'pending'
      when order_row.status = 'paid' then 'succeeded'
      when order_row.status in ('partially_refunded', 'refunded') then 'refunded'
      when order_row.status = 'disputed' then 'disputed'
      else null
    end;
    result_row.entitlement_status := entitlement_row.status::text;
    result_row.next_task := case
      when entitlement_row.status = 'suspended' then 'payment_review'
      when entitlement_row.status = 'revoked' then 'purchase_unavailable'
      when entitlement_row.id is not null then 'purchase_complete'
      when result_row.checkout_available then 'checkout'
      when order_row.status = 'void' then 'purchase_unavailable'
      else workflow_row.current_task
    end;
  else
    result_row.commerce_order_status := null;
    result_row.payment_status := null;
    result_row.entitlement_status := null;
    result_row.next_task := null;
  end if;
  return next result_row;
end;
$$;

comment on function public.resolve_total_loss_case_claim(uuid) is
  'Owner-safe secure/resume projection extended only with provider-neutral commerce and entitlement state; provider identifiers remain private.';

revoke execute on function public.authorize_total_loss_checkout_preflight(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_total_loss_checkout_preflight(uuid, uuid)
  to service_role;

revoke execute on function public.reserve_total_loss_checkout(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.reserve_total_loss_checkout(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, boolean
) to service_role;

revoke execute on function public.attach_total_loss_checkout_session(
  uuid, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.attach_total_loss_checkout_session(
  uuid, text, text, text, timestamptz, boolean
) to service_role;

revoke execute on function public.resolve_total_loss_checkout_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_checkout_context(uuid, uuid)
  to service_role;

revoke execute on function public.resolve_total_loss_checkout_context_by_session_id(text)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_checkout_context_by_session_id(text)
  to service_role;

revoke execute on function public.authorize_total_loss_checkout_reconciliation(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.authorize_total_loss_checkout_reconciliation(
  uuid, uuid, text
) to service_role;

revoke execute on function public.resolve_total_loss_payment_context(text)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_payment_context(text)
  to service_role;

revoke execute on function public.reconcile_total_loss_checkout_attempt(
  uuid, uuid, text, text, text, text, timestamptz, boolean, text, integer, bigint, text
) from public, anon, authenticated;
grant execute on function public.reconcile_total_loss_checkout_attempt(
  uuid, uuid, text, text, text, text, timestamptz, boolean, text, integer, bigint, text
) to service_role;

revoke execute on function public.recover_total_loss_checkout_attempt(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, boolean, text, integer, bigint, text
) from public, anon, authenticated;
grant execute on function public.recover_total_loss_checkout_attempt(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, boolean, text, integer, bigint, text
) to service_role;

revoke execute on function public.fail_total_loss_checkout_attempt_from_webhook(
  uuid, uuid, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.fail_total_loss_checkout_attempt_from_webhook(
  uuid, uuid, text, text, uuid, text
) to service_role;

revoke execute on function public.expire_total_loss_checkout_attempt_from_webhook(
  uuid, uuid, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.expire_total_loss_checkout_attempt_from_webhook(
  uuid, uuid, text, text, uuid, timestamptz
) to service_role;

revoke execute on function public.fulfill_total_loss_checkout_payment(
  uuid, uuid, uuid, text, text, text, uuid, text, integer, bigint, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.fulfill_total_loss_checkout_payment(
  uuid, uuid, uuid, text, text, text, uuid, text, integer, bigint, text, boolean, timestamptz
) to service_role;

revoke execute on function public.claim_stripe_webhook_event(
  text, text, boolean, text, text, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(
  text, text, boolean, text, text, integer, timestamptz, uuid
) to service_role;

revoke execute on function public.finalize_stripe_webhook_event(
  uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.finalize_stripe_webhook_event(
  uuid, uuid, text, uuid, uuid, text
) to service_role;

revoke execute on function public.reserve_total_loss_refund(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.reserve_total_loss_refund(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

revoke execute on function public.record_total_loss_refund_result(
  uuid, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_total_loss_refund_result(
  uuid, text, text, text, text, text, timestamptz, text
) to service_role;

revoke execute on function public.record_total_loss_dispute(
  uuid, uuid, uuid, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_total_loss_dispute(
  uuid, uuid, uuid, text, text, text, text, bigint, text, timestamptz
) to service_role;
