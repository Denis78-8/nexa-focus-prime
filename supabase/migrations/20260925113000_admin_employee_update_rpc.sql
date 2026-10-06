-- Atomic Admin Panel employee updates with per-field permission checks.
-- RLS remains enabled; this SECURITY DEFINER RPC exposes only this operation.
create or replace function public.update_admin_employee(
  _user_id uuid,
  _full_name text,
  _position text,
  _department text,
  _phone text,
  _location text,
  _access_level smallint,
  _role public.app_role,
  _is_vip boolean,
  _is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _actor uuid := auth.uid();
  _actor_is_owner boolean;
  _target_is_owner boolean;
  _current_profile public.profiles%rowtype;
  _current_role public.app_role;
begin
  if _actor is null or not public.is_active_user(_actor) then
    raise exception 'Требуется активная сессия';
  end if;
  if not public.has_permission('admin.access') then
    raise exception 'Недостаточно прав для Admin Panel';
  end if;
  if _user_id is null or _role is null or _full_name is null or length(trim(_full_name)) < 2 then
    raise exception 'Некорректные данные сотрудника';
  end if;
  if _access_level not between 1 and 5 then
    raise exception 'Уровень доступа должен быть от 1 до 5';
  end if;

  select * into _current_profile
  from public.profiles
  where id = _user_id
  for update;
  if not found then
    raise exception 'Профиль сотрудника не найден';
  end if;

  select ur.role into _current_role
  from public.user_roles ur
  where ur.user_id = _user_id
  order by case ur.role::text
    when 'director' then 1
    when 'admin' then 2
    when 'manager' then 3
    else 4
  end
  limit 1;
  _current_role := coalesce(_current_role, 'employee'::public.app_role);

  _actor_is_owner := exists(select 1 from public.nexa_owners where user_id = _actor);
  _target_is_owner := exists(select 1 from public.nexa_owners where user_id = _user_id);

  if _current_profile.full_name is distinct from trim(_full_name)
     or _current_profile.position is distinct from nullif(trim(_position), '')
     or _current_profile.department is distinct from nullif(trim(_department), '')
     or _current_profile.phone is distinct from nullif(trim(_phone), '')
     or _current_profile.location is distinct from nullif(trim(_location), '') then
    if not public.has_permission('profiles.write') then
      raise exception 'Недостаточно прав: требуется profiles.write';
    end if;
  end if;
  if _current_role is distinct from _role and not public.has_permission('roles.manage') then
    raise exception 'Недостаточно прав: требуется roles.manage';
  end if;
  if _current_profile.access_level is distinct from _access_level
     and not public.has_permission('access_levels.manage') then
    raise exception 'Недостаточно прав: требуется access_levels.manage';
  end if;
  if _current_profile.is_vip is distinct from _is_vip
     and not public.has_permission('vip.manage') then
    raise exception 'Недостаточно прав: требуется vip.manage';
  end if;
  if _current_profile.is_active is distinct from _is_active
     and not public.has_permission('employees.manage') then
    raise exception 'Недостаточно прав: требуется employees.manage';
  end if;

  if _target_is_owner and (
    _is_active is distinct from true
    or _role is distinct from 'admin'::public.app_role
    or _access_level is distinct from 5::smallint
    or _is_vip is distinct from true
  ) then
    raise exception 'Профиль владельца NEXA должен сохранять active=true, role=admin, access_level=5 и is_vip=true';
  end if;
  if not _actor_is_owner and (
    _target_is_owner
    or _current_role in ('admin'::public.app_role, 'director'::public.app_role)
    or _role in ('admin'::public.app_role, 'director'::public.app_role)
    or (_user_id = _actor and not _is_active)
  ) then
    raise exception 'Изменять владельца, администратора, руководителя или блокировать собственный доступ может только владелец NEXA';
  end if;
  -- Access levels change only by the owner directly or via an owner-approved
  -- access request (review_access_level_request).
  if not _actor_is_owner and _current_profile.access_level is distinct from _access_level then
    raise exception 'Уровень доступа меняет только владелец NEXA или одобренная им заявка';
  end if;

  update public.profiles
  set full_name = trim(_full_name),
      position = nullif(trim(_position), ''),
      department = nullif(trim(_department), ''),
      phone = nullif(trim(_phone), ''),
      location = nullif(trim(_location), ''),
      access_level = _access_level,
      is_vip = _is_vip,
      is_active = _is_active,
      updated_at = now()
  where id = _user_id;

  if _current_role is distinct from _role then
    delete from public.user_roles where user_id = _user_id;
    insert into public.user_roles(user_id, role) values (_user_id, _role);
  end if;

  return jsonb_build_object('ok', true, 'user_id', _user_id);
end;
$$;

revoke all on function public.update_admin_employee(uuid, text, text, text, text, text, smallint, public.app_role, boolean, boolean) from public, anon;
grant execute on function public.update_admin_employee(uuid, text, text, text, text, text, smallint, public.app_role, boolean, boolean) to authenticated;
