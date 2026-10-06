-- Revokes every Auth session of one user (refresh tokens are removed with
-- their sessions by the auth schema's ON DELETE CASCADE). Used only by the
-- admin-reissue-temporary-password edge function through the service role:
-- the Auth Admin API has no "sign out user by id" call. Access tokens that
-- were already issued expire on their own; until then is_active_user()
-- blocks them because the account is back under a mandatory password change.
create or replace function public.revoke_user_sessions(_user_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare _deleted integer;
begin
  if _user_id is null then raise exception 'Не указан пользователь'; end if;
  delete from auth.sessions where user_id = _user_id;
  get diagnostics _deleted = row_count;
  return _deleted;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
