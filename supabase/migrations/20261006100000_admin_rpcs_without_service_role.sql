-- Admin Panel operations without the service-role key on the app server.
-- Every function runs as the signed-in caller (auth.uid()); authorization is
-- decided inside the function from has_permission_for() and the nexa_owners
-- registry, never from a client-supplied flag. Tables keep their existing
-- RLS/grants: anon/authenticated still cannot write them directly.

-- 1. Is the caller an owner? Answers only about auth.uid(), never another id.
create or replace function public.current_user_is_owner()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
    and public.is_active_user(auth.uid())
    and exists (select 1 from public.nexa_owners o where o.user_id = auth.uid())
$$;

-- 2. Permission matrix: owner-only (SEC-002), with the existing guards.
create or replace function public.update_permission_matrix(
  _kind text, _subject text, _permission text, _enabled boolean
)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _level smallint;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if _kind not in ('role', 'level') or _subject is null or _permission is null or _enabled is null then
    raise exception 'Некорректный запрос';
  end if;
  if not public.has_permission_for(_uid, case when _kind = 'role' then 'roles.manage' else 'access_levels.manage' end) then
    raise exception 'Недостаточно прав';
  end if;
  if not exists (select 1 from public.nexa_owners o where o.user_id = _uid) then
    raise exception 'Матрицу прав может изменять только владелец LUNO DIGITAL';
  end if;
  if not exists (select 1 from public.permissions p where p.key = _permission) then
    raise exception 'Неизвестное право';
  end if;

  if _kind = 'role' then
    if _subject = 'admin' then raise exception 'Матрица admin защищена'; end if;
    if _subject not in ('employee', 'manager', 'director') then raise exception 'Неизвестная роль'; end if;
    if _enabled then
      insert into public.role_permissions(role, permission_key) values (_subject, _permission)
      on conflict (role, permission_key) do nothing;
    else
      delete from public.role_permissions where role = _subject and permission_key = _permission;
    end if;
  else
    if _subject !~ '^[1-5]$' then raise exception 'Неизвестный уровень доступа'; end if;
    _level := _subject::smallint;
    if _level = 5 and _permission = 'admin.access' and not _enabled then
      raise exception 'Доступ уровня 5 к Admin Panel обязателен и не может быть отключён';
    end if;
    if _enabled then
      insert into public.access_level_permissions(access_level, permission_key) values (_level, _permission)
      on conflict (access_level, permission_key) do nothing;
    else
      delete from public.access_level_permissions where access_level = _level and permission_key = _permission;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 3. Canonical corporate mail domain (W1). Kept in the database so a direct
-- RPC call cannot choose another domain. One row; readable only through the
-- SECURITY DEFINER functions below (RLS on, no grants to anon/authenticated).
-- Seeded from the domain already used by existing mailboxes, otherwise the
-- app default 'nexa.ru' (same default as NEXA_MAIL_DOMAIN). Existing rows
-- are never changed by this migration.
create table if not exists public.corporate_mail_settings (
  singleton boolean primary key default true check (singleton),
  domain text not null check (
    char_length(domain) <= 253
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  updated_at timestamptz not null default now()
);
alter table public.corporate_mail_settings enable row level security;
revoke all on public.corporate_mail_settings from public, anon, authenticated;
grant all on public.corporate_mail_settings to service_role;

insert into public.corporate_mail_settings(singleton, domain)
select true, coalesce(
  (select m.domain from public.corporate_mailboxes m group by m.domain order by count(*) desc, m.domain limit 1),
  'nexa.ru'
)
on conflict (singleton) do nothing;

create or replace function public.corporate_mail_domain()
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.domain from public.corporate_mail_settings s where s.singleton
$$;

-- 4. Corporate address suggestion. The local part is derived from the full
-- name by the app (transliteration); here only a free suffix is chosen on the
-- canonical domain. Returns just the proposed address, no profile data.
create or replace function public.suggest_corporate_email(_local_part text, _for_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _domain text := public.corporate_mail_domain();
  _marker text;
  _candidate text;
  _email text;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'mailboxes.manage') then raise exception 'Недостаточно прав'; end if;
  if _domain is null then raise exception 'Домен корпоративной почты не настроен'; end if;
  if _local_part is null or char_length(_local_part) > 64
     or _local_part !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
    raise exception 'Имя нельзя безопасно преобразовать в адрес корпоративной почты';
  end if;

  for _suffix in 1..10000 loop
    _marker := case when _suffix = 1 then '' else _suffix::text end;
    _candidate := left(_local_part, 64 - char_length(_marker)) || _marker;
    _email := _candidate || '@' || _domain;
    if not exists (select 1 from public.corporate_mailboxes m where lower(m.email) = _email)
       and not exists (
         select 1 from public.profiles p
         where lower(p.email) = _email and (_for_user is null or p.id <> _for_user)
       ) then
      return jsonb_build_object('email', _email, 'localPart', _candidate, 'domain', _domain);
    end if;
  end loop;
  raise exception 'Не удалось подобрать свободный адрес корпоративной почты';
end;
$$;

-- 5a. Reservation target: the name the address is derived from.
create or replace function public.get_mailbox_reservation_target(_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _profile record;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'mailboxes.manage') then raise exception 'Недостаточно прав'; end if;
  select p.full_name, p.is_active into _profile from public.profiles p where p.id = _user_id;
  if not found then raise exception 'Сотрудник не найден'; end if;
  return jsonb_build_object('fullName', _profile.full_name, 'isActive', _profile.is_active);
end;
$$;

-- 5b. Reserve: re-checks everything, inserts a pending primary mailbox and its
-- audit event in one transaction (B2). Concurrent requests are serialized by
-- the unique email and one-primary-per-user indexes; the loser gets an error
-- and leaves neither a row nor an audit event.
create or replace function public.reserve_corporate_mailbox(_user_id uuid, _email text, _local_part text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _active boolean;
  _expected jsonb;
  _row public.corporate_mailboxes;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'mailboxes.manage') then raise exception 'Недостаточно прав'; end if;
  select p.is_active into _active from public.profiles p where p.id = _user_id;
  if not found then raise exception 'Сотрудник не найден'; end if;
  if not _active then raise exception 'Нельзя зарезервировать адрес для отключённого сотрудника'; end if;

  _expected := public.suggest_corporate_email(_local_part, _user_id);
  if _expected ->> 'email' is distinct from lower(_email) then
    raise exception 'Предложение уже изменилось. Обновите адрес: %', _expected ->> 'email';
  end if;
  if exists (select 1 from public.corporate_mailboxes m where m.user_id = _user_id and m.is_primary) then
    raise exception 'У сотрудника уже есть основной корпоративный адрес';
  end if;

  insert into public.corporate_mailboxes(
    user_id, email, local_part, domain, status, provider, provider_user_id, is_primary, created_by, metadata
  ) values (
    _user_id, _expected ->> 'email', _expected ->> 'localPart', _expected ->> 'domain', 'pending', null, null, true, _uid,
    jsonb_build_object('provisioning', 'not_started')
  ) returning * into _row;

  insert into public.mailbox_audit_events(mailbox_id, action, actor_user_id, target_user_id, metadata)
  values (_row.id, 'mailbox_created', _uid, _row.user_id,
          jsonb_build_object('status', 'pending', 'reservationOnly', true, 'realMailboxCreated', false));

  return jsonb_build_object(
    'id', _row.id, 'user_id', _row.user_id, 'email', _row.email, 'local_part', _row.local_part,
    'domain', _row.domain, 'status', _row.status, 'provider', _row.provider,
    'is_primary', _row.is_primary, 'created_at', _row.created_at
  );
end;
$$;

-- 5c. Record a failed provisioning attempt once (B1). Activation is not
-- accepted here: until a real provider exists, activation will be added as a
-- server-side (Cloud) step, so a mailboxes.manage user cannot mark a mailbox
-- active through this RPC. Only the reserving caller, only while not_started.
create or replace function public.finish_corporate_mailbox_provisioning(_mailbox_id uuid, _result text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _row public.corporate_mailboxes;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'mailboxes.manage') then raise exception 'Недостаточно прав'; end if;
  if _result = 'active' then raise exception 'Активация почтового ящика через этот запрос недоступна'; end if;
  if _result is null or _result not in ('provider_not_configured', 'provider_error') then
    raise exception 'Некорректный запрос';
  end if;
  select * into _row from public.corporate_mailboxes m
  where m.id = _mailbox_id and m.created_by = _uid and m.status = 'pending'
    and m.metadata ->> 'provisioning' = 'not_started'
  for update;
  if not found then raise exception 'Резервирование не найдено или уже завершено'; end if;

  insert into public.mailbox_audit_events(mailbox_id, action, actor_user_id, target_user_id, metadata)
  values (_row.id, 'mailbox_provision_failed', _uid, _row.user_id,
          jsonb_build_object('code', _result, 'realMailboxCreated', false));
  if _result = 'provider_error' then
    update public.corporate_mailboxes
      set status = 'error', metadata = jsonb_build_object('provisioning', 'error')
      where id = _row.id;
  else
    update public.corporate_mailboxes
      set metadata = jsonb_build_object('provisioning', 'provider_not_configured')
      where id = _row.id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 6. Health check: confirms the database answers; reveals no data.
create or replace function public.get_system_status()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.has_permission_for(_uid, 'system.manage') then raise exception 'Недостаточно прав'; end if;
  perform 1 from public.profiles limit 1;
  return jsonb_build_object('database', 'ok');
end;
$$;

do $$
declare _fn text;
begin
  foreach _fn in array array[
    'public.current_user_is_owner()',
    'public.update_permission_matrix(text, text, text, boolean)',
    'public.suggest_corporate_email(text, uuid)',
    'public.get_mailbox_reservation_target(uuid)',
    'public.reserve_corporate_mailbox(uuid, text, text)',
    'public.finish_corporate_mailbox_provisioning(uuid, text)',
    'public.get_system_status()'
  ] loop
    execute format('revoke execute on function %s from public, anon', _fn);
    execute format('grant execute on function %s to authenticated', _fn);
  end loop;
end $$;

-- Internal helper: callable only from the functions above (they run as owner).
revoke execute on function public.corporate_mail_domain() from public, anon, authenticated;

notify pgrst, 'reload schema';
