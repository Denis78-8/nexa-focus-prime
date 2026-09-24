-- NEXA Cloud Supabase migration plan
-- READ FIRST:
-- 1) This file does not apply itself. Run the PRECHECK and each migration block
--    manually, in order, only after reviewing the returned checks.
-- 2) Do not wrap all blocks in one transaction: migration 20260924110000 adds
--    an enum value and may need a commit boundary before later use.
-- 3) Migration bodies below are copied verbatim from the three local files.

-- BEGIN PRECHECK
do $precheck$
declare
  _name text;
  _count bigint;
  _applied boolean;
  _labels text[];
  _guard text;
begin
  foreach _name in array array[
    'profiles', 'user_roles', 'projects', 'project_members', 'tasks',
    'task_time_entries', 'task_history', 'task_comments'
  ] loop
    if to_regclass(format('public.%I', _name)) is null then
      raise notice 'PRECHECK table public.%: NOT FOUND', _name;
    else
      raise notice 'PRECHECK table public.%: FOUND', _name;
      if _name in ('profiles', 'user_roles', 'projects', 'tasks') then
        execute format('select count(*) from public.%I', _name) into _count;
        raise notice 'PRECHECK row count public.%: %', _name, _count;
      end if;
    end if;
  end loop;

  foreach _name in array array[
    'touch_updated_at()', 'ensure_my_profile(text)', 'can_access_project(uuid,uuid)',
    'can_manage_project(uuid,uuid)', 'can_edit_task(uuid,uuid)',
    'task_transition(uuid,text,text,text)', '_close_running_entry(uuid)'
  ] loop
    raise notice 'PRECHECK function public.%: %', _name,
      to_regprocedure('public.' || _name) is not null;
  end loop;

  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'PRECHECK migration history: supabase_migrations.schema_migrations NOT FOUND; verify migration 20260924081430 from the schema below.';
  else
    execute 'select exists (select 1 from supabase_migrations.schema_migrations where version::text = $1)'
      into _applied using '20260924081430';
    raise notice 'PRECHECK migration 20260924081430 recorded as applied: %', _applied;
  end if;

  select array_agg(e.enumlabel::text order by e.enumsortorder)
    into _labels
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'task_status';
  raise notice 'PRECHECK task_status labels: %', coalesce(_labels::text, 'NOT FOUND');
  raise notice 'PRECHECK task_status matches 20260924081430 (todo,in_progress,waiting,done): %',
    coalesce(_labels = array['todo','in_progress','waiting','done']::text[], false);
  raise notice 'PRECHECK one_running_entry_per_task_user index: %',
    to_regclass('public.one_running_entry_per_task_user') is not null;
  if to_regprocedure('public.tasks_guard()') is not null then
    select pg_get_functiondef(to_regprocedure('public.tasks_guard()')) into _guard;
    raise notice 'PRECHECK tasks_guard checks assignee project access: %',
      position('new.assignee_id' in _guard) > 0
      and position('public.can_access_project' in _guard) > 0;
  else
    raise notice 'PRECHECK tasks_guard: NOT FOUND';
  end if;

  if to_regclass('auth.users') is not null then
    execute 'select exists (select 1 from auth.users where lower(email) = $1)'
      into _applied using 'denis.savinov@nexa.ru';
    raise notice 'PRECHECK owner email denis.savinov@nexa.ru: Auth user %',
      case when _applied then 'FOUND' else 'NOT FOUND' end;
    execute 'select exists (select 1 from auth.users where lower(email) = $1 and email_confirmed_at is not null)'
      into _applied using 'denis.savinov@nexa.ru';
    raise notice 'PRECHECK owner email confirmation: %',
      case when _applied then 'CONFIRMED' else 'NOT CONFIRMED or user not found' end;
  else
    raise notice 'PRECHECK auth.users: NOT FOUND';
  end if;
end
$precheck$;
-- END PRECHECK

-- BEGIN MIGRATION 20260924093000_pause_only_callers_timer.sql
-- Pausing is a per-user timer action. Moving a task to waiting or completing it
-- remains task-wide and closes every open interval.
create or replace function public._close_running_entry_for_user(_task_id uuid, _user_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare _e record; _dur int := 0; _entry_duration int;
begin
  for _e in
    select * from public.task_time_entries
    where task_id = _task_id and user_id = _user_id and ended_at is null
    for update
  loop
    _entry_duration := greatest(0, extract(epoch from (now() - _e.started_at))::int);
    _dur := _dur + _entry_duration;
    update public.task_time_entries
    set ended_at = now(), duration_seconds = _entry_duration
    where id = _e.id;
  end loop;
  if _dur > 0 then
    update public.tasks set spent_seconds = spent_seconds + _dur where id = _task_id;
  end if;
  return _dur;
end $$;
revoke execute on function public._close_running_entry_for_user(uuid, uuid) from public, anon, authenticated;

create or replace function public.recalc_parent_progress(_parent uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare _total int; _done int;
begin
  if _parent is null then return; end if;
  select count(*), count(*) filter (where status = 'done')
    into _total, _done
  from public.tasks
  where parent_task_id = _parent;
  update public.tasks
  set progress = case when _total = 0 then 0 else round(_done * 100.0 / _total)::smallint end
  where id = _parent
    and progress is distinct from case when _total = 0 then 0 else round(_done * 100.0 / _total)::smallint end;
end $$;

create or replace function public.task_transition(_task_id uuid, _action text, _session_id text default null, _report text default null)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare _t public.tasks; _uid uuid := auth.uid(); _next public.task_status; _running boolean; _open int;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  select * into _t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Задача не найдена'; end if;
  if not public.can_edit_task(_task_id, _uid) then raise exception 'Нет прав на изменение задачи'; end if;
  if _session_id is null or length(_session_id) < 8 then raise exception 'Нужна текущая сессия'; end if;

  select exists (select 1 from public.task_time_entries where task_id = _task_id and user_id = _uid and ended_at is null) into _running;
  perform set_config('nexa.lifecycle', 'on', true);
  perform set_config('nexa.session', _session_id, true);

  case _action
    when 'start' then
      if _t.status <> 'todo' then raise exception 'Начать можно только новую задачу'; end if;
      _next := 'in_progress';
    when 'pause' then
      if _t.status <> 'in_progress' or not _running then raise exception 'Таймер не запущен'; end if;
      _next := 'in_progress';
    when 'resume' then
      if _t.status not in ('in_progress', 'waiting') then raise exception 'Возобновить можно задачу в работе или в ожидании'; end if;
      if _running then raise exception 'Таймер уже запущен'; end if;
      _next := 'in_progress';
    when 'wait' then
      if _t.status <> 'in_progress' then raise exception 'В ожидание можно перевести только задачу в работе'; end if;
      _next := 'waiting';
    when 'complete' then
      if _t.status not in ('in_progress', 'waiting') then raise exception 'Завершить можно задачу в работе или в ожидании'; end if;
      if _report is null or length(trim(_report)) < 3 then raise exception 'Для завершения нужен отчёт'; end if;
      select count(*) into _open from public.tasks where parent_task_id = _task_id and status <> 'done';
      if _open > 0 then raise exception 'Сначала завершите подзадачи (открыто: %)', _open; end if;
      _next := 'done';
    when 'reopen' then
      if _t.status <> 'done' then raise exception 'Переоткрыть можно только завершённую задачу'; end if;
      _next := 'in_progress';
    else raise exception 'Неизвестное действие: %', _action;
  end case;

  if _action in ('start', 'resume') then
    insert into public.task_time_entries(task_id, user_id, session_id) values (_task_id, _uid, _session_id);
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_started', _session_id);
  elsif _action in ('pause', 'wait', 'complete') then
    if _action = 'pause' then
      perform public._close_running_entry_for_user(_task_id, _uid);
    else
      perform public._close_running_entry(_task_id);
    end if;
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_stopped', _session_id);
  end if;

  update public.tasks set
    status = _next,
    assignee_id = coalesce(assignee_id, case when _action = 'start' then _uid end),
    started_at = coalesce(started_at, case when _action = 'start' then now() end),
    completed_at = case when _next = 'done' then now() else null end,
    completion_report = case when _next = 'done' then trim(_report) when _action = 'reopen' then null else completion_report end,
    progress = case when _next = 'done' then 100 when _action = 'reopen' then 0 else progress end
  where id = _task_id returning * into _t;

  if _next = 'done' then
    insert into public.task_history(task_id, actor_id, action, session_id, new_value) values (_task_id, _uid, 'completed_with_report', _session_id, jsonb_build_object('report', trim(_report)));
  elsif _action = 'reopen' then
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'reopened', _session_id);
  end if;
  perform set_config('nexa.lifecycle', '', true);
  return _t;
end $$;
revoke execute on function public.task_transition(uuid, text, text, text) from public, anon;
grant execute on function public.task_transition(uuid, text, text, text) to authenticated;

-- END MIGRATION 20260924093000_pause_only_callers_timer.sql

-- BEGIN POSTCHECK 20260924093000_pause_only_callers_timer
do $postcheck_0930$
declare
  _ok boolean;
  _found boolean;
  _confirmed boolean;
begin
  raise notice 'POSTCHECK 09:30 _close_running_entry_for_user: %',
    to_regprocedure('public._close_running_entry_for_user(uuid,uuid)') is not null;
  raise notice 'POSTCHECK 09:30 recalc_parent_progress: %',
    to_regprocedure('public.recalc_parent_progress(uuid)') is not null;
  raise notice 'POSTCHECK 09:30 task_transition: %',
    to_regprocedure('public.task_transition(uuid,text,text,text)') is not null;
  raise notice 'POSTCHECK 09:30 task_transition executable by authenticated: %',
    has_function_privilege('authenticated', 'public.task_transition(uuid,text,text,text)', 'EXECUTE');
  raise notice 'POSTCHECK 09:30 task RLS enabled: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.tasks')), false);
  if to_regclass('public.nexa_owners') is null then
    raise notice 'POSTCHECK 09:30 owner mapping: not created yet (expected before 11:00 migration)';
  else
    execute 'select exists (select 1 from public.nexa_owners o join auth.users u on u.id = o.user_id where lower(u.email) = $1)'
      into _ok using 'denis.savinov@nexa.ru';
    raise notice 'POSTCHECK 09:30 owner mapping exists: %', _ok;
  end if;
  if to_regclass('public.permissions') is null then
    raise notice 'POSTCHECK 09:30 permissions: table not created yet (expected before 11:00 migration)';
  else
    execute 'select exists (select 1 from public.permissions where key = $1)'
      into _ok using 'tasks.write';
    raise notice 'POSTCHECK 09:30 tasks.write permission exists: %', _ok;
  end if;
end
$postcheck_0930$;
-- END POSTCHECK 20260924093000_pause_only_callers_timer

-- BEGIN MIGRATION 20260924110000_admin_rbac_profiles.sql
-- NEXA administration: explicit permissions and profile state.
alter type public.app_role add value if not exists 'director';

alter table public.profiles
  add column if not exists access_level smallint not null default 2 check (access_level between 1 and 5),
  add column if not exists is_vip boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists mailbox_status text not null default 'pending' check (mailbox_status in ('pending', 'provisioned', 'failed')),
  add column if not exists invitation_status text not null default 'not_invited' check (invitation_status in ('not_invited', 'sent', 'accepted', 'failed'));

create table if not exists public.permissions (
  key text primary key,
  description text not null
);
create table if not exists public.role_permissions (
  role text not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);
create table if not exists public.access_level_permissions (
  access_level smallint not null check (access_level between 1 and 5),
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (access_level, permission_key)
);
create table if not exists public.nexa_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

-- Bootstrap only the confirmed Supabase identity supplied by the project owner.
-- Matching a profile display name is deliberately never sufficient.
insert into public.nexa_owners(user_id)
select id from auth.users
where lower(email) = 'denis.savinov@nexa.ru' and email_confirmed_at is not null
on conflict (user_id) do nothing;

insert into public.profiles(id, full_name, email, access_level, is_vip)
select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)), u.email, 5, true
from auth.users u join public.nexa_owners o on o.user_id = u.id
on conflict (id) do update set access_level = 5, is_vip = true;
insert into public.user_roles(user_id, role)
select user_id, 'admin'::public.app_role from public.nexa_owners
on conflict (user_id, role) do nothing;

insert into public.permissions(key, description) values
  ('profiles.read_public', 'Читать основные поля доступных профилей'),
  ('profiles.read_all', 'Читать список всех публичных профилей'),
  ('profiles.private.read', 'Читать email, телефон и служебные поля профилей'),
  ('profiles.write', 'Изменять разрешённые поля профиля'),
  ('tasks.read', 'Читать задачи доступных проектов'),
  ('tasks.write', 'Создавать и изменять задачи доступных проектов'),
  ('tasks.assign', 'Назначать задачи участникам проектов'),
  ('projects.read_all', 'Читать проекты без членства'),
  ('projects.write', 'Создавать проекты и управлять участниками'),
  ('reports.read', 'Читать отчёты'),
  ('employees.read', 'Просматривать административный список сотрудников'),
  ('employees.manage', 'Создавать, редактировать и деактивировать сотрудников'),
  ('roles.manage', 'Управлять ролями и матрицей разрешений'),
  ('access_levels.manage', 'Управлять матрицей уровней доступа'),
  ('vip.manage', 'Назначать и снимать VIP статус'),
  ('system.manage', 'Просматривать состояние системы'),
  ('admin.access', 'Открывать NEXA Admin Panel'),
  ('tasks.write_all', 'Изменять задачи во всех проектах')
on conflict (key) do update set description = excluded.description;

-- Role and access level are independent grants. Sensitive admin permissions
-- are role-only and can never be obtained by increasing access_level.
insert into public.role_permissions(role, permission_key)
select 'employee', key from public.permissions
where key in ('profiles.read_public', 'profiles.write', 'tasks.read', 'tasks.write')
on conflict do nothing;
insert into public.role_permissions(role, permission_key)
select 'manager', key from public.permissions
where key in ('profiles.read_public', 'profiles.private.read', 'profiles.read_all', 'profiles.write', 'tasks.read', 'tasks.write', 'tasks.assign', 'projects.read_all', 'projects.write', 'reports.read', 'employees.read')
on conflict do nothing;
insert into public.role_permissions(role, permission_key)
select 'director', key from public.permissions
where key in ('profiles.read_public', 'profiles.private.read', 'profiles.read_all', 'profiles.write', 'tasks.read', 'tasks.write', 'tasks.assign', 'projects.read_all', 'projects.write', 'reports.read', 'employees.read')
on conflict do nothing;
insert into public.role_permissions(role, permission_key)
select 'admin', key from public.permissions on conflict do nothing;

insert into public.access_level_permissions(access_level, permission_key) values
  (1, 'profiles.read_public'), (1, 'tasks.read'),
  (2, 'profiles.read_public'), (2, 'tasks.read'), (2, 'tasks.write'),
  (3, 'profiles.read_public'), (3, 'tasks.read'), (3, 'tasks.write'), (3, 'tasks.assign'), (3, 'projects.read_all'),
  (4, 'profiles.read_public'), (4, 'profiles.private.read'), (4, 'tasks.read'), (4, 'tasks.write'), (4, 'tasks.assign'), (4, 'projects.read_all'), (4, 'projects.write'), (4, 'reports.read'),
  (5, 'profiles.read_public'), (5, 'profiles.private.read'), (5, 'profiles.write'), (5, 'tasks.read'), (5, 'tasks.write'), (5, 'tasks.assign'), (5, 'projects.read_all'), (5, 'projects.write'), (5, 'reports.read')
on conflict do nothing;

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.access_level_permissions enable row level security;
alter table public.nexa_owners enable row level security;
revoke all on public.permissions, public.role_permissions, public.access_level_permissions, public.nexa_owners from anon, authenticated;
grant all on public.permissions, public.role_permissions, public.access_level_permissions, public.nexa_owners to service_role;

create or replace function public.is_active_user(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (_user_id = auth.uid() or pg_trigger_depth() > 0)
    and exists (select 1 from public.profiles p where p.id = _user_id and p.is_active)
$$;

create or replace function public.has_permission_for(_user_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user(_user_id) and (
    exists (
      select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role = ur.role::text
      where ur.user_id = _user_id and rp.permission_key = _permission
    )
    or exists (
      select 1 from public.profiles p
      join public.access_level_permissions alp on alp.access_level = p.access_level
      where p.id = _user_id and alp.permission_key = _permission
    )
    or exists (select 1 from public.nexa_owners o where o.user_id = _user_id)
  )
$$;

create or replace function public.has_permission(_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission_for(auth.uid(), _permission)
$$;

create or replace function public.can_view_profile(_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user(auth.uid()) and (
    _profile_id = auth.uid()
    or public.has_permission_for(auth.uid(), 'profiles.read_all')
    or exists (
      select 1 from public.project_members mine
      join public.project_members target on target.project_id = mine.project_id
      where mine.user_id = auth.uid() and target.user_id = _profile_id
    )
  )
$$;

create or replace function public.can_access_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- Trigger calls may check a different assignee; direct RPC callers may only
  -- probe access for their own immutable auth UUID.
  select (_user_id = auth.uid() or pg_trigger_depth() > 0)
    and public.is_active_user(_user_id) and (
    public.has_permission_for(_user_id, 'projects.read_all')
    or exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id)
  )
$$;

create or replace function public.can_manage_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _user_id = auth.uid() and public.is_active_user(_user_id) and (
    public.has_permission_for(_user_id, 'projects.write')
    or exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id and m.role = 'lead')
  )
$$;

create or replace function public.can_edit_task(_task_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _user_id = auth.uid() and public.is_active_user(_user_id) and public.has_permission_for(_user_id, 'tasks.write') and exists (
    select 1 from public.tasks t where t.id = _task_id
      and public.can_access_project(t.project_id, _user_id)
      and (t.assignee_id = _user_id or t.created_by = _user_id or public.can_manage_project(t.project_id, _user_id))
  )
$$;

revoke execute on function public.is_active_user(uuid) from public, anon;
revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.has_permission_for(uuid, text) from public, anon, authenticated;
revoke execute on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_access_project(uuid, uuid) to authenticated;
grant execute on function public.can_manage_project(uuid, uuid) to authenticated;
grant execute on function public.can_edit_task(uuid, uuid) to authenticated;

-- Remove the unsafe "first registrant becomes admin" bootstrap. New accounts
-- start as employees; a trusted owner/administrator must grant elevated roles.
create or replace function public.ensure_my_profile(_full_name text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _p public.profiles; _email text;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if exists (select 1 from public.profiles where id = _uid and not is_active) then
    raise exception 'Учётная запись отключена';
  end if;
  _email := coalesce(auth.jwt() ->> 'email', '');
  insert into public.profiles(id, full_name, email)
  values (_uid, coalesce(nullif(trim(_full_name), ''), split_part(_email, '@', 1)), _email)
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role)
  select _uid, 'employee'::public.app_role
  where not exists (select 1 from public.user_roles where user_id = _uid);
  update public.profiles set invitation_status = 'accepted'
  where id = _uid and invitation_status in ('sent', 'not_invited');
  select * into _p from public.profiles where id = _uid;
  return _p;
end $$;
revoke execute on function public.ensure_my_profile(text) from public, anon;
grant execute on function public.ensure_my_profile(text) to authenticated;

-- Column privileges prevent direct API reads of email/phone/location and
-- prevent self-promotion through access_level/is_vip/is_active or email edits.
drop policy if exists "Profiles visible to signed-in users" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile, admins any" on public.profiles;
create policy "Read permitted profiles" on public.profiles for select to authenticated
  using (public.can_view_profile(id));
create policy "Update own public profile" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user(auth.uid()) and public.has_permission('profiles.write'))
  with check (id = auth.uid() and public.is_active_user(auth.uid()) and public.has_permission('profiles.write'));
revoke select, insert, update, delete on public.profiles from authenticated;
grant select (id, full_name, position, department, avatar_url, presence, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, position, department, phone, location, avatar_url, presence) on public.profiles to authenticated;

drop policy if exists "Users read own roles, admins read all" on public.user_roles;
drop policy if exists "Admins manage roles" on public.user_roles;
create policy "Read own role or permitted role list" on public.user_roles for select to authenticated
  using (public.is_active_user(auth.uid()) and (user_id = auth.uid() or public.has_permission('roles.manage')));
revoke insert, update, delete on public.user_roles from authenticated;

drop policy if exists "Read accessible projects" on public.projects;
drop policy if exists "Admins/managers create projects" on public.projects;
drop policy if exists "Project managers update" on public.projects;
drop policy if exists "Owners delete projects" on public.projects;
create policy "Read accessible projects" on public.projects for select to authenticated
  using (public.can_access_project(id, auth.uid()));
create policy "Permitted users create projects" on public.projects for insert to authenticated
  with check (owner_id = auth.uid() and public.is_active_user(auth.uid()) and public.has_permission('projects.write'));
create policy "Project managers update" on public.projects for update to authenticated
  using (public.can_manage_project(id, auth.uid())) with check (public.can_manage_project(id, auth.uid()));
create policy "Project managers delete" on public.projects for delete to authenticated
  using (public.can_manage_project(id, auth.uid()));

drop policy if exists "Read members of accessible projects" on public.project_members;
drop policy if exists "Project managers manage members" on public.project_members;
create policy "Read members of accessible projects" on public.project_members for select to authenticated
  using (public.can_access_project(project_id, auth.uid()));
create policy "Project managers manage members" on public.project_members for all to authenticated
  using (public.can_manage_project(project_id, auth.uid())) with check (public.can_manage_project(project_id, auth.uid()));

drop policy if exists "Read tasks of accessible projects" on public.tasks;
drop policy if exists "Members create tasks" on public.tasks;
drop policy if exists "Editors update tasks" on public.tasks;
drop policy if exists "Managers delete tasks" on public.tasks;
create policy "Read tasks of accessible projects" on public.tasks for select to authenticated
  using (public.can_access_project(project_id, auth.uid()));
create policy "Members create tasks" on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and public.can_access_project(project_id, auth.uid()) and public.has_permission('tasks.write'));
create policy "Editors update tasks" on public.tasks for update to authenticated
  using (public.can_edit_task(id, auth.uid())) with check (public.can_edit_task(id, auth.uid()));
create policy "Managers delete tasks" on public.tasks for delete to authenticated
  using (public.can_edit_task(id, auth.uid()) and (created_by = auth.uid() or public.can_manage_project(project_id, auth.uid())));

drop policy if exists "Read time of accessible tasks" on public.task_time_entries;
create policy "Read time of accessible tasks" on public.task_time_entries for select to authenticated
  using (public.can_access_project((select project_id from public.tasks where id = task_id), auth.uid()));
drop policy if exists "Read history of accessible tasks" on public.task_history;
create policy "Read history of accessible tasks" on public.task_history for select to authenticated
  using (public.can_access_project((select project_id from public.tasks where id = task_id), auth.uid()));
drop policy if exists "Read comments of accessible tasks" on public.task_comments;
create policy "Read comments of accessible tasks" on public.task_comments for select to authenticated
  using (public.can_access_project((select project_id from public.tasks where id = task_id), auth.uid()));
drop policy if exists "Write comments on accessible tasks" on public.task_comments;
create policy "Write comments on accessible tasks" on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_project((select project_id from public.tasks where id = task_id), auth.uid()));
drop policy if exists "Authors edit own comments" on public.task_comments;
create policy "Authors edit own comments" on public.task_comments for update to authenticated
  using (author_id = auth.uid() and public.is_active_user(auth.uid()));
drop policy if exists "Authors delete own comments" on public.task_comments;
create policy "Authors delete own comments" on public.task_comments for delete to authenticated
  using (author_id = auth.uid() and public.is_active_user(auth.uid()));

revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.can_access_project(uuid, uuid) from public, anon;
revoke execute on function public.can_manage_project(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_task(uuid, uuid) from public, anon;
grant execute on function public.can_access_project(uuid, uuid) to authenticated;
grant execute on function public.can_manage_project(uuid, uuid) to authenticated;
grant execute on function public.can_edit_task(uuid, uuid) to authenticated;

-- END MIGRATION 20260924110000_admin_rbac_profiles.sql

-- BEGIN POSTCHECK 20260924110000_admin_rbac_profiles
do $postcheck_1100$
declare
  _name text;
  _ok boolean;
  _found boolean;
  _confirmed boolean;
  _mapped boolean;
  _missing text[];
begin
  foreach _name in array array['permissions','role_permissions','access_level_permissions','nexa_owners'] loop
    raise notice 'POSTCHECK 11:00 table public.%: %', _name,
      to_regclass(format('public.%I', _name)) is not null;
  end loop;
  raise notice 'POSTCHECK 11:00 ensure_my_profile: %',
    to_regprocedure('public.ensure_my_profile(text)') is not null;
  raise notice 'POSTCHECK 11:00 can_edit_task: %',
    to_regprocedure('public.can_edit_task(uuid,uuid)') is not null;
  raise notice 'POSTCHECK 11:00 RLS enabled on profiles: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.profiles')), false);
  raise notice 'POSTCHECK 11:00 RLS enabled on user_roles: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.user_roles')), false);
  raise notice 'POSTCHECK 11:00 RLS enabled on nexa_owners: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.nexa_owners')), false);

  execute 'select exists (select 1 from auth.users where lower(email) = $1)'
    into _found using 'denis.savinov@nexa.ru';
  execute 'select exists (select 1 from auth.users where lower(email) = $1 and email_confirmed_at is not null)'
    into _confirmed using 'denis.savinov@nexa.ru';
  execute 'select exists (select 1 from public.nexa_owners o join auth.users u on u.id = o.user_id where lower(u.email) = $1)'
    into _mapped using 'denis.savinov@nexa.ru';
  raise notice 'POSTCHECK owner email denis.savinov@nexa.ru: Auth user %, email %, owner mapping %',
    case when _found then 'FOUND' else 'NOT FOUND' end,
    case when _confirmed then 'CONFIRMED' else 'NOT CONFIRMED' end,
    case when _mapped then 'PRESENT' else 'NOT PRESENT' end;

  execute 'select array_agg(required.key) from unnest(array[''admin.access'',''employees.manage'',''profiles.private.read'']) as required(key) where not exists (select 1 from public.permissions p where p.key = required.key)'
    into _missing;
  raise notice 'POSTCHECK 11:00 required permission keys missing (empty means OK): %',
    coalesce(_missing::text, 'none');
  raise notice 'POSTCHECK 11:00 authenticated can call has_permission: %',
    has_function_privilege('authenticated', 'public.has_permission(text)', 'EXECUTE');
end
$postcheck_1100$;
-- END POSTCHECK 20260924110000_admin_rbac_profiles

-- BEGIN MIGRATION 20260924130000_corporate_mailboxes.sql
-- Corporate mailbox registry. This stores NEXA lifecycle records, not mailbox credentials.
do $$ begin
  create type public.corporate_mailbox_status as enum ('pending', 'active', 'suspended', 'disabled', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mailbox_audit_action as enum ('mailbox_created', 'mailbox_disabled', 'mailbox_enabled', 'mailbox_deleted', 'mailbox_provision_failed');
exception when duplicate_object then null;
end $$;

create table if not exists public.corporate_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  email text not null unique,
  local_part text not null,
  domain text not null,
  status public.corporate_mailbox_status not null default 'pending',
  provider text,
  provider_user_id text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  disabled_at timestamptz,
  metadata jsonb,
  constraint corporate_mailboxes_email_lowercase check (email = lower(email)),
  constraint corporate_mailboxes_email_length check (char_length(email) <= 254),
  constraint corporate_mailboxes_local_part_length check (char_length(local_part) <= 64),
  constraint corporate_mailboxes_domain_length check (char_length(domain) <= 253),
  constraint corporate_mailboxes_local_part_format check (local_part ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'),
  constraint corporate_mailboxes_domain_format check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  constraint corporate_mailboxes_address_parts check (email = local_part || '@' || domain)
);
create unique index if not exists corporate_mailboxes_one_primary_per_user
  on public.corporate_mailboxes(user_id) where is_primary;
create index if not exists corporate_mailboxes_user_created_idx
  on public.corporate_mailboxes(user_id, created_at desc);
create trigger t_corporate_mailboxes_touch before update on public.corporate_mailboxes
  for each row execute function public.touch_updated_at();

create table if not exists public.mailbox_audit_events (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.corporate_mailboxes(id) on delete set null,
  action public.mailbox_audit_action not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid not null,
  created_at timestamptz not null default now(),
  metadata jsonb
);
create index if not exists mailbox_audit_target_created_idx
  on public.mailbox_audit_events(target_user_id, created_at desc);

insert into public.permissions(key, description) values
  ('mailboxes.read', 'Просматривать корпоративные адреса и их статусы'),
  ('mailboxes.manage', 'Резервировать адреса и управлять корпоративными почтовыми ящиками')
on conflict (key) do update set description = excluded.description;
insert into public.role_permissions(role, permission_key)
select 'admin', key from public.permissions where key in ('mailboxes.read', 'mailboxes.manage')
on conflict do nothing;

alter table public.corporate_mailboxes enable row level security;
alter table public.mailbox_audit_events enable row level security;
revoke all on public.corporate_mailboxes, public.mailbox_audit_events from anon, authenticated;
grant select (id, user_id, email, local_part, domain, status, provider, is_primary, created_at, updated_at, disabled_at)
  on public.corporate_mailboxes to authenticated;
grant select on public.mailbox_audit_events to authenticated;
grant all on public.corporate_mailboxes, public.mailbox_audit_events to service_role;

create policy "Read own or permitted corporate mailbox" on public.corporate_mailboxes
  for select to authenticated
  using (public.is_active_user(auth.uid()) and (user_id = auth.uid() or public.has_permission('mailboxes.read')));
create policy "Read permitted mailbox audit" on public.mailbox_audit_events
  for select to authenticated
  using (public.has_permission('mailboxes.read'));

comment on table public.corporate_mailboxes is
  'Provider-neutral mailbox registry. A pending row does not mean a real mailbox exists.';
comment on column public.corporate_mailboxes.metadata is
  'Non-secret provider metadata only. Never store mailbox passwords, tokens, or invitation secrets.';

-- END MIGRATION 20260924130000_corporate_mailboxes.sql

-- BEGIN POSTCHECK 20260924130000_corporate_mailboxes
do $postcheck_1300$
declare
  _missing text[];
  _found boolean;
  _confirmed boolean;
  _mapped boolean;
begin
  raise notice 'POSTCHECK 13:00 corporate_mailboxes: %',
    to_regclass('public.corporate_mailboxes') is not null;
  raise notice 'POSTCHECK 13:00 mailbox_audit_events: %',
    to_regclass('public.mailbox_audit_events') is not null;
  raise notice 'POSTCHECK 13:00 RLS corporate_mailboxes: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.corporate_mailboxes')), false);
  raise notice 'POSTCHECK 13:00 RLS mailbox_audit_events: %',
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.mailbox_audit_events')), false);
  raise notice 'POSTCHECK 13:00 global unique email constraint/index: %',
    exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass('public.corporate_mailboxes')
        and c.contype = 'u' and c.conname = 'corporate_mailboxes_email_key'
    );
  select array_agg(required.key)
    into _missing
  from unnest(array['mailboxes.read','mailboxes.manage']) as required(key)
  where not exists (select 1 from public.permissions p where p.key = required.key);
  raise notice 'POSTCHECK 13:00 mailbox permissions missing (empty means OK): %',
    coalesce(_missing::text, 'none');

  execute 'select exists (select 1 from auth.users where lower(email) = $1)'
    into _found using 'denis.savinov@nexa.ru';
  execute 'select exists (select 1 from auth.users where lower(email) = $1 and email_confirmed_at is not null)'
    into _confirmed using 'denis.savinov@nexa.ru';
  execute 'select exists (select 1 from public.nexa_owners o join auth.users u on u.id = o.user_id where lower(u.email) = $1)'
    into _mapped using 'denis.savinov@nexa.ru';
  raise notice 'POSTCHECK 13:00 owner mapping: Auth user %, email %, owner mapping %',
    case when _found then 'FOUND' else 'NOT FOUND' end,
    case when _confirmed then 'CONFIRMED' else 'NOT CONFIRMED' end,
    case when _mapped then 'PRESENT' else 'NOT PRESENT' end;
end
$postcheck_1300$;
-- END POSTCHECK 20260924130000_corporate_mailboxes

-- BEGIN FINAL CHECK
do $finalcheck$
declare
  _name text;
begin
  foreach _name in array array[
    'profiles', 'user_roles', 'nexa_owners',
    'corporate_mailboxes', 'mailbox_audit_events'
  ] loop
    raise notice 'FINAL CHECK table public.%: %', _name,
      to_regclass(format('public.%I', _name)) is not null;
  end loop;
  raise notice 'FINAL CHECK task_transition: %',
    to_regprocedure('public.task_transition(uuid,text,text,text)') is not null;
  raise notice 'FINAL CHECK can_edit_task: %',
    to_regprocedure('public.can_edit_task(uuid,uuid)') is not null;
end
$finalcheck$;
-- END FINAL CHECK
