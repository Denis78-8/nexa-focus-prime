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
