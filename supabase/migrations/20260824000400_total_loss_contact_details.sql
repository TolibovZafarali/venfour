alter table public.total_loss_case_contacts
  add column first_name text,
  add column last_name text,
  add column phone_number text,
  add constraint total_loss_case_contacts_first_name_safe
    check (
      first_name is null
      or (
        char_length(first_name) between 1 and 100
        and first_name = regexp_replace(btrim(first_name), '[[:space:]]+', ' ', 'g')
        and first_name !~ '[[:cntrl:]]'
        and first_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
      )
    ),
  add constraint total_loss_case_contacts_last_name_safe
    check (
      last_name is null
      or (
        char_length(last_name) between 1 and 100
        and last_name = regexp_replace(btrim(last_name), '[[:space:]]+', ' ', 'g')
        and last_name !~ '[[:cntrl:]]'
        and last_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
      )
    ),
  add constraint total_loss_case_contacts_phone_number_safe
    check (
      phone_number is null
      or (
        char_length(phone_number) between 1 and 50
        and phone_number = regexp_replace(btrim(phone_number), '[[:space:]]+', ' ', 'g')
        and phone_number !~ '[[:cntrl:]]'
        and phone_number !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
      )
    );

comment on column public.total_loss_case_contacts.first_name is
  'Customer-entered given name for this Total-Loss case. Null only for contacts saved before split-name capture was introduced.';
comment on column public.total_loss_case_contacts.last_name is
  'Customer-entered family name for this Total-Loss case. Null only for contacts saved before split-name capture was introduced.';
comment on column public.total_loss_case_contacts.phone_number is
  'Optional customer-entered phone number for this Total-Loss case. Its presence does not change the separately recorded optional follow-up preference.';

create type public.total_loss_contact_details_claim_begin_result as (
  case_id uuid,
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone_number text,
  email_verified_at timestamptz,
  service_terms_version text,
  service_terms_acknowledged_at timestamptz,
  privacy_notice_version text,
  privacy_notice_acknowledged_at timestamptz,
  operational_follow_up_allowed boolean,
  operational_follow_up_updated_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  claim_id uuid,
  claim_expires_at timestamptz
);

revoke all on type public.total_loss_contact_details_claim_begin_result from public;
revoke all on type public.total_loss_contact_details_claim_begin_result from anon;
grant usage on type public.total_loss_contact_details_claim_begin_result
  to authenticated, service_role;

create function public.save_total_loss_contact_details_and_begin_claim(
  case_id uuid,
  first_name text,
  last_name text,
  email text,
  phone_number text,
  service_terms_version text,
  privacy_notice_version text,
  operational_follow_up_allowed boolean
)
returns setof public.total_loss_contact_details_claim_begin_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_first_name text := regexp_replace(
    btrim(coalesce($2, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_last_name text := regexp_replace(
    btrim(coalesce($3, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_full_name text;
  normalized_phone_number text := nullif(
    regexp_replace(btrim(coalesce($5, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  legacy_result public.total_loss_case_claim_begin_result;
  contact_row public.total_loss_case_contacts%rowtype;
  result_row public.total_loss_contact_details_claim_begin_result;
begin
  if char_length(normalized_first_name) not between 1 and 100
    or normalized_first_name ~ '[[:cntrl:]]'
    or normalized_first_name ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe first name between 1 and 100 characters is required.';
  end if;

  if char_length(normalized_last_name) not between 1 and 100
    or normalized_last_name ~ '[[:cntrl:]]'
    or normalized_last_name ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe last name between 1 and 100 characters is required.';
  end if;

  normalized_full_name := normalized_first_name || ' ' || normalized_last_name;
  if char_length(normalized_full_name) > 200 then
    raise exception using
      errcode = '22023',
      message = 'The combined name must be 200 characters or fewer.';
  end if;

  if normalized_phone_number is not null
    and (
      char_length(normalized_phone_number) > 50
      or normalized_phone_number ~ '[[:cntrl:]]'
      or normalized_phone_number ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'A safe phone number with 50 characters or fewer is required.';
  end if;

  select legacy.*
  into strict legacy_result
  from public.save_total_loss_contact_and_begin_claim(
    $1,
    normalized_full_name,
    $4,
    $6,
    $7,
    $8
  ) as legacy;

  update public.total_loss_case_contacts as contact
  set
    first_name = normalized_first_name,
    last_name = normalized_last_name,
    phone_number = normalized_phone_number
  where contact.case_id = $1
  returning * into strict contact_row;

  result_row.case_id := contact_row.case_id;
  result_row.first_name := contact_row.first_name;
  result_row.last_name := contact_row.last_name;
  result_row.full_name := contact_row.full_name;
  result_row.email := contact_row.email;
  result_row.phone_number := contact_row.phone_number;
  result_row.email_verified_at := contact_row.email_verified_at;
  result_row.service_terms_version := contact_row.service_terms_version;
  result_row.service_terms_acknowledged_at :=
    contact_row.service_terms_acknowledged_at;
  result_row.privacy_notice_version := contact_row.privacy_notice_version;
  result_row.privacy_notice_acknowledged_at :=
    contact_row.privacy_notice_acknowledged_at;
  result_row.operational_follow_up_allowed :=
    contact_row.operational_follow_up_allowed;
  result_row.operational_follow_up_updated_at :=
    contact_row.operational_follow_up_updated_at;
  result_row.created_at := contact_row.created_at;
  result_row.updated_at := contact_row.updated_at;
  result_row.claim_id := legacy_result.claim_id;
  result_row.claim_expires_at := legacy_result.claim_expires_at;
  return next result_row;
end;
$$;

comment on function public.save_total_loss_contact_details_and_begin_claim(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) is
  'Saves split customer name, optional phone, normalized email, database-timestamped legal facts, and returns an opaque expiring claim through the existing identity boundary.';

revoke all on function public.save_total_loss_contact_details_and_begin_claim(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) from public, anon;
grant execute on function public.save_total_loss_contact_details_and_begin_claim(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) to authenticated, service_role;
