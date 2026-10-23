-- Bootstrap the designated owner through the existing database staff authority.
create function public.bootstrap_designated_owner_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Existing grants remain tied to the account UUID. Unrelated account updates
  -- must not restore a membership that a trusted administrator has revoked.
  if tg_op = 'UPDATE' then
    if lower(old.email) = 'zafar@venfour.com'
      and old.email_confirmed_at is not null
      and old.is_anonymous is false
      and old.deleted_at is null
      and (old.banned_until is null or old.banned_until <= statement_timestamp()) then
      return new;
    end if;
  end if;

  if lower(new.email) = 'zafar@venfour.com'
    and new.email_confirmed_at is not null
    and new.is_anonymous is false
    and new.deleted_at is null
    and (new.banned_until is null or new.banned_until <= statement_timestamp()) then
    insert into public.staff_members (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.bootstrap_designated_owner_staff() is
  'Grants ordinary UUID-bound staff membership when the designated owner email first becomes verified; later email changes do not revoke the grant.';

revoke all on function public.bootstrap_designated_owner_staff()
  from public, anon, authenticated, service_role;

create trigger auth_users_bootstrap_designated_owner_staff
after insert or update of email, email_confirmed_at, is_anonymous, deleted_at, banned_until
on auth.users
for each row execute function public.bootstrap_designated_owner_staff();

-- Lock matching identities until the migration commits so the existing-account
-- grant cannot race an email or verification change.
insert into public.staff_members (user_id)
select identity.id
from auth.users as identity
where lower(identity.email) = 'zafar@venfour.com'
  and identity.email_confirmed_at is not null
  and identity.is_anonymous is false
  and identity.deleted_at is null
  and (identity.banned_until is null or identity.banned_until <= statement_timestamp())
for update of identity
on conflict (user_id) do nothing;
