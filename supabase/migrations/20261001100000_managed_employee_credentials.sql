-- Managed employee credentials: accounts are created only from the NEXA Admin
-- Panel with a system-generated temporary password that must be changed on
-- first sign-in. Passwords themselves live only in Supabase Auth; this table
-- stores lifecycle state, never a password or hash.
create table if not exists public.employee_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  must_change_password boolean not null default true,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  changed_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  constraint employee_credentials_expiry_after_issue check (expires_at > issued_at),
  constraint employee_credentials_change_state check (must_change_password or changed_at is not null)
);

alter table public.employee_credentials enable row level security;
revoke all on public.employee_credentials from anon, authenticated;
grant all on public.employee_credentials to service_role;

-- A pending mandatory password change (expired or not) makes the account
-- inactive for every RLS policy and permission check that relies on
-- is_active_user, so the workspace cannot be reached by URL or direct API.
-- Users without a credential row (all pre-existing accounts) are unaffected.
create or replace function public.is_active_user(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (_user_id = auth.uid() or pg_trigger_depth() > 0)
    and exists (select 1 from public.profiles p where p.id = _user_id and p.is_active)
    and not exists (
      select 1 from public.employee_credentials c
      where c.user_id = _user_id and c.must_change_password
    )
$$;

-- Returns the caller's own credential requirement only (auth.uid()).
-- No row (every legacy account, including the owner) means no forced change:
-- must_change_password = false, expires_at = null.
create or replace function public.get_my_credential_state()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _uid uuid := auth.uid(); _c public.employee_credentials;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  select * into _c from public.employee_credentials where user_id = _uid;
  return jsonb_build_object(
    'must_change_password', coalesce(_c.must_change_password, false),
    'expired', coalesce(_c.must_change_password and _c.expires_at <= now(), false),
    'expires_at', _c.expires_at
  );
end;
$$;

revoke execute on function public.get_my_credential_state() from public, anon;
grant execute on function public.get_my_credential_state() to authenticated;

-- Self-service profile creation is removed: profiles are created only by the
-- Admin Panel. A self-registered Auth user therefore never gets a profile,
-- role or workspace access. Existing profiles are returned as before.
create or replace function public.ensure_my_profile(_full_name text default null)
returns public.profiles language plpgsql security definer set search_path = public, pg_temp as $$
declare _uid uuid := auth.uid(); _p public.profiles;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  select * into _p from public.profiles where id = _uid;
  if not found then raise exception 'Учётная запись не создана администратором NEXA'; end if;
  if not _p.is_active then raise exception 'Учётная запись отключена'; end if;
  insert into public.user_roles(user_id, role)
  select _uid, 'employee'::public.app_role
  where not exists (select 1 from public.user_roles where user_id = _uid);
  update public.profiles set invitation_status = 'accepted'
  where id = _uid and invitation_status in ('sent', 'not_invited')
  returning * into _p;
  if not found then select * into _p from public.profiles where id = _uid; end if;
  return _p;
end $$;
revoke execute on function public.ensure_my_profile(text) from public, anon;
grant execute on function public.ensure_my_profile(text) to authenticated;

-- Make the new table and RPC visible to the API immediately.
notify pgrst, 'reload schema';
