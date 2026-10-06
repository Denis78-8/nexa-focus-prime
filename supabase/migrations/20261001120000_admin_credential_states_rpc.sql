-- Admin Panel reads employee credential lifecycle (never passwords) through a
-- permission-checked RPC instead of a service-role query, so loading the panel
-- does not depend on the service-role secret. employee_credentials itself
-- stays closed to anon/authenticated.
create or replace function public.get_employee_credential_states()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'admin.access') then
    raise exception 'Недостаточно прав для Admin Panel';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', c.user_id,
      'must_change_password', c.must_change_password,
      'expires_at', c.expires_at,
      'changed_at', c.changed_at
    ))
    from public.employee_credentials c
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_employee_credential_states() from public, anon;
grant execute on function public.get_employee_credential_states() to authenticated;

notify pgrst, 'reload schema';
