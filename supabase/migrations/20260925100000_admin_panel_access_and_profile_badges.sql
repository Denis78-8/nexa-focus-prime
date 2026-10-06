-- Level 5 grants entry to Admin Panel only. Sensitive write permissions remain separate.
insert into public.access_level_permissions(access_level, permission_key)
select 5, p.key
from public.permissions p
where p.key in ('admin.access', 'employees.read', 'profiles.private.read')
on conflict (access_level, permission_key) do nothing;

-- Admin data is returned only for an active authenticated user with admin.access.
-- The security-definer function avoids requiring a service-role key for read-only panel data.
create or replace function public.get_admin_panel_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null or not public.is_active_user(_uid) then
    raise exception 'Учётная запись не активна';
  end if;
  if not public.has_permission_for(_uid, 'admin.access') then
    raise exception 'Недостаточно прав для Admin Panel';
  end if;
  if not public.has_permission_for(_uid, 'employees.read')
     or not public.has_permission_for(_uid, 'profiles.private.read') then
    raise exception 'Недостаточно прав для просмотра профилей сотрудников';
  end if;

  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.full_name)
      from (
        select id, full_name, email, position, department, phone, location, presence,
               access_level, is_vip, is_active, mailbox_status, invitation_status, created_at
        from public.profiles
      ) p
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.user_roles r
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.key) from public.permissions p
    ), '[]'::jsonb),
    'rolePermissions', coalesce((
      select jsonb_agg(to_jsonb(rp)) from public.role_permissions rp
    ), '[]'::jsonb),
    'levelPermissions', coalesce((
      select jsonb_agg(to_jsonb(alp)) from public.access_level_permissions alp
    ), '[]'::jsonb),
    'owners', coalesce((
      select jsonb_agg(to_jsonb(o)) from public.nexa_owners o
    ), '[]'::jsonb),
    'mailboxes', case when public.has_permission_for(_uid, 'mailboxes.read') then coalesce((
      select jsonb_agg(to_jsonb(m))
      from (
        select id, user_id, email, local_part, domain, status, provider, is_primary,
               created_at, updated_at, disabled_at
        from public.corporate_mailboxes
      ) m
    ), '[]'::jsonb) else '[]'::jsonb end,
    'mailboxesAllowed', public.has_permission_for(_uid, 'mailboxes.read')
      or public.has_permission_for(_uid, 'mailboxes.manage'),
    'capabilities', jsonb_build_object(
      'employeesManage', public.has_permission_for(_uid, 'employees.manage'),
      'rolesManage', public.has_permission_for(_uid, 'roles.manage'),
      'accessLevelsManage', public.has_permission_for(_uid, 'access_levels.manage'),
      'vipManage', public.has_permission_for(_uid, 'vip.manage'),
      'systemManage', public.has_permission_for(_uid, 'system.manage'),
      'mailboxesRead', public.has_permission_for(_uid, 'mailboxes.read'),
      'mailboxesManage', public.has_permission_for(_uid, 'mailboxes.manage')
    ),
    'credentialManagementAllowed', exists (
      select 1 from public.nexa_owners o where o.user_id = _uid
    )
  );
end;
$$;

revoke all on function public.get_admin_panel_data() from public, anon;
grant execute on function public.get_admin_panel_data() to authenticated;

-- A user can read only their own VIP/access flags and role for UI badges.
create or replace function public.get_my_nexa_access_flags()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'is_vip', p.is_vip,
    'is_active', p.is_active,
    'access_level', p.access_level,
    'role', coalesce((
      select ur.role::text
      from public.user_roles ur
      where ur.user_id = p.id
      order by (ur.role::text = 'director') desc
      limit 1
    ), 'employee'),
    'is_director', exists (
      select 1 from public.user_roles ur
      where ur.user_id = p.id and ur.role::text = 'director'
    ) or lower(trim(coalesce(p.position, ''))) = 'директор'
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

revoke all on function public.get_my_nexa_access_flags() from public, anon;
grant execute on function public.get_my_nexa_access_flags() to authenticated;
