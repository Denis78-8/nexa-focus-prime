-- ===== Roles =====
create type public.app_role as enum ('admin', 'manager', 'employee');
create type public.task_status as enum ('todo', 'in_progress', 'paused', 'review', 'done', 'cancelled');
create type public.task_priority as enum ('low', 'medium', 'high', 'critical');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users read own roles, admins read all" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ===== Profiles =====
create table public.profiles (
  id uuid primary key,
  full_name text not null default '',
  email text,
  position text,
  department text,
  phone text,
  location text,
  avatar_url text,
  presence text not null default 'online',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Profiles visible to signed-in users" on public.profiles for select to authenticated using (true);
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users update own profile, admins any" on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ===== Projects =====
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'active',
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant all on public.projects to service_role;
grant all on public.project_members to service_role;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create or replace function public.can_access_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin') or public.has_role(_user_id, 'manager')
    or exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id)
$$;
create or replace function public.can_manage_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin') or public.has_role(_user_id, 'manager')
    or exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id and m.role = 'lead')
$$;

create policy "Read accessible projects" on public.projects for select to authenticated using (public.can_access_project(id, auth.uid()));
create policy "Admins/managers create projects" on public.projects for insert to authenticated
  with check (owner_id = auth.uid() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
create policy "Project managers update" on public.projects for update to authenticated using (public.can_manage_project(id, auth.uid()));
create policy "Admins delete projects" on public.projects for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "Read members of accessible projects" on public.project_members for select to authenticated using (public.can_access_project(project_id, auth.uid()));
create policy "Project managers manage members" on public.project_members for all to authenticated
  using (public.can_manage_project(project_id, auth.uid())) with check (public.can_manage_project(project_id, auth.uid()));

-- ===== Tasks =====
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  assignee_id uuid,
  created_by uuid not null,
  estimated_seconds integer not null default 0 check (estimated_seconds >= 0),
  spent_seconds integer not null default 0 check (spent_seconds >= 0),
  progress smallint not null default 0 check (progress between 0 and 100),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_report text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_task_id is null or parent_task_id <> id)
);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_parent_idx on public.tasks(parent_task_id);
create index tasks_assignee_idx on public.tasks(assignee_id);

create table public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null,
  session_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer
);
create unique index one_running_entry_per_user on public.task_time_entries(user_id) where ended_at is null;
create index time_entries_task_idx on public.task_time_entries(task_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  parent_comment_id uuid references public.task_comments(id) on delete cascade,
  author_id uuid not null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_task_idx on public.task_comments(task_id);

create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  session_id text,
  created_at timestamptz not null default now()
);
create index history_task_idx on public.task_history(task_id, created_at);

grant select, insert, update, delete on public.tasks to authenticated;
grant select on public.task_time_entries to authenticated;
grant select, insert, update, delete on public.task_comments to authenticated;
grant select on public.task_history to authenticated;
grant all on public.tasks, public.task_time_entries, public.task_comments, public.task_history to service_role;
alter table public.tasks enable row level security;
alter table public.task_time_entries enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_history enable row level security;

create or replace function public.can_edit_task(_task_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = _task_id
    and (t.assignee_id = _user_id or t.created_by = _user_id or public.can_manage_project(t.project_id, _user_id)))
$$;

create policy "Read tasks of accessible projects" on public.tasks for select to authenticated using (public.can_access_project(project_id, auth.uid()));
create policy "Members create tasks" on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and public.can_access_project(project_id, auth.uid()));
create policy "Editors update tasks" on public.tasks for update to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid() or public.can_manage_project(project_id, auth.uid()));
create policy "Managers delete tasks" on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_project(project_id, auth.uid()));

create policy "Read time of accessible tasks" on public.task_time_entries for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id, auth.uid())));
create policy "Read history of accessible tasks" on public.task_history for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id, auth.uid())));
create policy "Read comments of accessible tasks" on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id, auth.uid())));
create policy "Write comments on accessible tasks" on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id, auth.uid())));
create policy "Authors edit own comments" on public.task_comments for update to authenticated using (author_id = auth.uid());
create policy "Authors delete own comments" on public.task_comments for delete to authenticated using (author_id = auth.uid());

-- ===== Integrity & history triggers =====
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger t_comments_touch before update on public.task_comments for each row execute function public.touch_updated_at();

-- Guard: status/time/report may only change through lifecycle functions
create or replace function public.tasks_guard() returns trigger language plpgsql set search_path = public as $$
declare _p uuid; _depth int := 0;
begin
  if tg_op = 'UPDATE' then
    new.updated_at = now();
    if coalesce(current_setting('nexa.lifecycle', true), '') <> 'on' then
      if new.status is distinct from old.status or new.spent_seconds is distinct from old.spent_seconds
        or new.started_at is distinct from old.started_at or new.completed_at is distinct from old.completed_at
        or new.completion_report is distinct from old.completion_report then
        raise exception 'Статус, время и отчёт меняются только через действия жизненного цикла задачи';
      end if;
    end if;
    new.number = old.number; new.created_by = old.created_by;
  else
    if coalesce(current_setting('nexa.lifecycle', true), '') <> 'on' then
      new.status = 'todo'; new.spent_seconds = 0; new.started_at = null; new.completed_at = null; new.completion_report = null;
    end if;
  end if;
  -- parent must be in the same project and must not create cycles
  if new.parent_task_id is not null then
    select project_id into _p from public.tasks where id = new.parent_task_id;
    if _p is null then raise exception 'Родительская задача не найдена'; end if;
    if _p <> new.project_id then raise exception 'Подзадача должна быть в том же проекте'; end if;
    _p := new.parent_task_id;
    while _p is not null loop
      if _p = new.id then raise exception 'Циклическая связь parentTaskId'; end if;
      _depth := _depth + 1; if _depth > 50 then exit; end if;
      select parent_task_id into _p from public.tasks where id = _p;
    end loop;
  end if;
  return new;
end $$;
create trigger t_tasks_guard before insert or update on public.tasks for each row execute function public.tasks_guard();

create or replace function public.tasks_log_history() returns trigger language plpgsql security definer set search_path = public as $$
declare _sid text := nullif(current_setting('nexa.session', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.task_history(task_id, actor_id, action, new_value, session_id)
    values (new.id, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status, 'parent_task_id', new.parent_task_id), _sid);
    return new;
  end if;
  if new.title is distinct from old.title then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'title', to_jsonb(old.title), to_jsonb(new.title), _sid); end if;
  if new.description is distinct from old.description then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'description', to_jsonb(old.description), to_jsonb(new.description), _sid); end if;
  if new.priority is distinct from old.priority then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'priority', to_jsonb(old.priority), to_jsonb(new.priority), _sid); end if;
  if new.assignee_id is distinct from old.assignee_id then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'assignee_id', to_jsonb(old.assignee_id), to_jsonb(new.assignee_id), _sid); end if;
  if new.estimated_seconds is distinct from old.estimated_seconds then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'estimated_seconds', to_jsonb(old.estimated_seconds), to_jsonb(new.estimated_seconds), _sid); end if;
  if new.progress is distinct from old.progress then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'progress', to_jsonb(old.progress), to_jsonb(new.progress), _sid); end if;
  if new.parent_task_id is distinct from old.parent_task_id then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'parent_task_id', to_jsonb(old.parent_task_id), to_jsonb(new.parent_task_id), _sid); end if;
  if new.due_at is distinct from old.due_at then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'field_changed', 'due_at', to_jsonb(old.due_at), to_jsonb(new.due_at), _sid); end if;
  if new.status is distinct from old.status then insert into public.task_history(task_id, actor_id, action, field, old_value, new_value, session_id) values (new.id, auth.uid(), 'status_changed', 'status', to_jsonb(old.status), to_jsonb(new.status), _sid); end if;
  return new;
end $$;
create trigger t_tasks_history after insert or update on public.tasks for each row execute function public.tasks_log_history();

create or replace function public.comments_log_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_history(task_id, actor_id, action, new_value)
  values (new.task_id, new.author_id, case when new.parent_comment_id is null then 'comment_added' else 'reply_added' end,
    jsonb_build_object('comment_id', new.id, 'parent_comment_id', new.parent_comment_id));
  return new;
end $$;
create trigger t_comments_history after insert on public.task_comments for each row execute function public.comments_log_history();

-- Parent progress = share of finished subtasks
create or replace function public.recalc_parent_progress(_parent uuid) returns void language plpgsql security definer set search_path = public as $$
declare _total int; _done int;
begin
  if _parent is null then return; end if;
  select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'done')
    into _total, _done from public.tasks where parent_task_id = _parent;
  if _total > 0 then
    update public.tasks set progress = round(_done * 100.0 / _total) where id = _parent and progress is distinct from round(_done * 100.0 / _total)::smallint;
  end if;
end $$;
create or replace function public.tasks_after_change_parent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.recalc_parent_progress(old.parent_task_id); return old; end if;
  perform public.recalc_parent_progress(new.parent_task_id);
  if tg_op = 'UPDATE' and old.parent_task_id is distinct from new.parent_task_id then perform public.recalc_parent_progress(old.parent_task_id); end if;
  return new;
end $$;
create trigger t_tasks_parent_progress after insert or delete or update of status, parent_task_id on public.tasks
  for each row execute function public.tasks_after_change_parent();

-- ===== Lifecycle =====
create or replace function public._close_running_entry(_task_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare _e record; _dur int := 0;
begin
  for _e in select * from public.task_time_entries where task_id = _task_id and ended_at is null for update loop
    _dur := _dur + greatest(0, extract(epoch from (now() - _e.started_at))::int);
    update public.task_time_entries set ended_at = now(), duration_seconds = greatest(0, extract(epoch from (now() - _e.started_at))::int) where id = _e.id;
  end loop;
  if _dur > 0 then update public.tasks set spent_seconds = spent_seconds + _dur where id = _task_id; end if;
  return _dur;
end $$;

create or replace function public.task_transition(_task_id uuid, _action text, _session_id text default null, _report text default null)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare _t public.tasks; _uid uuid := auth.uid(); _next public.task_status; _other record; _open int;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  select * into _t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Задача не найдена'; end if;
  if not public.can_edit_task(_task_id, _uid) then raise exception 'Нет прав на изменение задачи'; end if;

  perform set_config('nexa.lifecycle', 'on', true);
  perform set_config('nexa.session', coalesce(_session_id, ''), true);

  case _action
    when 'start' then if _t.status <> 'todo' then raise exception 'Запуск возможен только из статуса «К выполнению»'; end if; _next := 'in_progress';
    when 'pause' then if _t.status <> 'in_progress' then raise exception 'Пауза возможна только для задачи в работе'; end if; _next := 'paused';
    when 'resume' then if _t.status <> 'paused' then raise exception 'Возобновить можно только задачу на паузе'; end if; _next := 'in_progress';
    when 'submit_review' then if _t.status not in ('in_progress', 'paused') then raise exception 'На проверку можно отправить задачу в работе или на паузе'; end if; _next := 'review';
    when 'return_to_work' then if _t.status <> 'review' then raise exception 'Вернуть в работу можно только задачу на проверке'; end if; _next := 'in_progress';
    when 'complete' then
      if _t.status not in ('in_progress', 'paused', 'review') then raise exception 'Завершить можно задачу в работе, на паузе или на проверке'; end if;
      if _report is null or length(trim(_report)) < 3 then raise exception 'Для завершения нужен отчёт'; end if;
      select count(*) into _open from public.tasks where parent_task_id = _task_id and status not in ('done', 'cancelled');
      if _open > 0 then raise exception 'Сначала завершите подзадачи (открыто: %)', _open; end if;
      _next := 'done';
    when 'cancel' then if _t.status in ('done', 'cancelled') then raise exception 'Задача уже закрыта'; end if; _next := 'cancelled';
    when 'reopen' then if _t.status not in ('done', 'cancelled') then raise exception 'Переоткрыть можно только закрытую задачу'; end if; _next := 'paused';
    else raise exception 'Неизвестное действие: %', _action;
  end case;

  -- timer handling
  if _next = 'in_progress' then
    if _session_id is null or length(_session_id) = 0 then raise exception 'Нужна текущая сессия для запуска таймера'; end if;
    -- only one running timer per user: pause the other running task
    for _other in select e.task_id from public.task_time_entries e where e.user_id = _uid and e.ended_at is null and e.task_id <> _task_id loop
      perform public._close_running_entry(_other.task_id);
      update public.tasks set status = 'paused' where id = _other.task_id and status = 'in_progress';
      insert into public.task_history(task_id, actor_id, action, session_id, new_value)
        values (_other.task_id, _uid, 'timer_auto_paused', _session_id, jsonb_build_object('reason', 'started_other_task', 'other_task_id', _task_id));
    end loop;
    insert into public.task_time_entries(task_id, user_id, session_id) values (_task_id, _uid, _session_id);
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_started', _session_id);
  elsif _t.status = 'in_progress' then
    perform public._close_running_entry(_task_id);
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_stopped', _session_id);
  end if;

  update public.tasks set
    status = _next,
    assignee_id = coalesce(assignee_id, case when _action = 'start' then _uid end),
    started_at = coalesce(started_at, case when _next = 'in_progress' then now() end),
    completed_at = case when _next = 'done' then now() when _next in ('cancelled') then completed_at else null end,
    completion_report = case when _next = 'done' then trim(_report) when _action = 'reopen' then null else completion_report end,
    progress = case when _next = 'done' then 100 else progress end
  where id = _task_id returning * into _t;

  if _next = 'done' then
    insert into public.task_history(task_id, actor_id, action, session_id, new_value) values (_task_id, _uid, 'completed_with_report', _session_id, jsonb_build_object('report', trim(_report)));
  end if;

  perform set_config('nexa.lifecycle', '', true);
  return _t;
end $$;
revoke execute on function public.task_transition(uuid, text, text, text) from public, anon;
grant execute on function public.task_transition(uuid, text, text, text) to authenticated;
revoke execute on function public._close_running_entry(uuid) from public, anon, authenticated;
revoke execute on function public.recalc_parent_progress(uuid) from public, anon, authenticated;

-- Onboarding: create profile; first user becomes admin, others employee
create or replace function public.ensure_my_profile(_full_name text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _p public.profiles; _email text;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  _email := coalesce(auth.jwt() ->> 'email', '');
  insert into public.profiles(id, full_name, email)
  values (_uid, coalesce(nullif(trim(_full_name), ''), split_part(_email, '@', 1)), _email)
  on conflict (id) do nothing;
  if not exists (select 1 from public.user_roles where user_id = _uid) then
    insert into public.user_roles(user_id, role)
    values (_uid, case when exists (select 1 from public.user_roles where role = 'admin') then 'employee'::public.app_role else 'admin'::public.app_role end);
  end if;
  select * into _p from public.profiles where id = _uid;
  return _p;
end $$;
revoke execute on function public.ensure_my_profile(text) from public, anon;
grant execute on function public.ensure_my_profile(text) to authenticated;

alter publication supabase_realtime add table public.tasks, public.task_comments, public.task_history, public.task_time_entries;