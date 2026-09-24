-- 1) Status set: drop invented statuses (paused/review/cancelled). "В ожидании" = waiting.
drop trigger if exists t_tasks_parent_progress on public.tasks;
alter table public.tasks alter column status drop default;
create type public.task_status_v2 as enum ('todo', 'in_progress', 'waiting', 'done');
alter table public.tasks alter column status type public.task_status_v2 using (
  case status::text when 'paused' then 'in_progress' when 'review' then 'waiting' when 'cancelled' then 'done' else status::text end
)::public.task_status_v2;
drop type public.task_status;
alter type public.task_status_v2 rename to task_status;
alter table public.tasks alter column status set default 'todo';

-- 2) Timer: no hidden "one timer per user" rule. One open interval per task+user.
drop index if exists public.one_running_entry_per_user;
create unique index one_running_entry_per_task_user on public.task_time_entries(task_id, user_id) where ended_at is null;

-- 3) Access: only project owner or explicit member. No global role-based access.
create or replace function public.can_access_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id)
$$;
create or replace function public.can_manage_project(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = _project_id and p.owner_id = _user_id)
    or exists (select 1 from public.project_members m where m.project_id = _project_id and m.user_id = _user_id and m.role = 'lead')
$$;
create or replace function public.can_edit_task(_task_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = _task_id
    and public.can_access_project(t.project_id, _user_id)
    and (t.assignee_id = _user_id or t.created_by = _user_id or public.can_manage_project(t.project_id, _user_id)))
$$;
drop policy "Editors update tasks" on public.tasks;
create policy "Editors update tasks" on public.tasks for update to authenticated
  using (public.can_access_project(project_id, auth.uid()) and (assignee_id = auth.uid() or created_by = auth.uid() or public.can_manage_project(project_id, auth.uid())));
drop policy "Managers delete tasks" on public.tasks;
create policy "Managers delete tasks" on public.tasks for delete to authenticated
  using (public.can_access_project(project_id, auth.uid()) and (created_by = auth.uid() or public.can_manage_project(project_id, auth.uid())));
drop policy "Admins delete projects" on public.projects;
create policy "Owners delete projects" on public.projects for delete to authenticated using (owner_id = auth.uid());

-- 4) Guard: assignee must have access to the project
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
  if new.assignee_id is not null and not public.can_access_project(new.project_id, new.assignee_id) then
    raise exception 'Исполнитель должен быть участником проекта';
  end if;
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

-- 5) Parent progress without cancelled
create or replace function public.recalc_parent_progress(_parent uuid) returns void language plpgsql security definer set search_path = public as $$
declare _total int; _done int;
begin
  if _parent is null then return; end if;
  select count(*), count(*) filter (where status = 'done') into _total, _done from public.tasks where parent_task_id = _parent;
  if _total > 0 then
    perform set_config('nexa.lifecycle', coalesce(current_setting('nexa.lifecycle', true), ''), true);
    update public.tasks set progress = round(_done * 100.0 / _total) where id = _parent and progress is distinct from round(_done * 100.0 / _total)::smallint;
  end if;
end $$;
create trigger t_tasks_parent_progress after insert or delete or update of status, parent_task_id on public.tasks
  for each row execute function public.tasks_after_change_parent();

-- 6) Single lifecycle
drop function public.task_transition(uuid, text, text, text);
create function public.task_transition(_task_id uuid, _action text, _session_id text default null, _report text default null)
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

  -- timer: start/resume open an interval; pause/wait/complete close all open intervals of the task
  if _action in ('start', 'resume') then
    insert into public.task_time_entries(task_id, user_id, session_id) values (_task_id, _uid, _session_id);
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_started', _session_id);
  elsif _action in ('pause', 'wait', 'complete') then
    if public._close_running_entry(_task_id) >= 0 and exists (select 1 from public.task_history where false) then null; end if;
    insert into public.task_history(task_id, actor_id, action, session_id) values (_task_id, _uid, 'timer_stopped', _session_id);
  end if;

  update public.tasks set
    status = _next,
    assignee_id = coalesce(assignee_id, case when _action = 'start' then _uid end),
    started_at = coalesce(started_at, case when _action = 'start' then now() end),
    completed_at = case when _next = 'done' then now() else null end,
    completion_report = case when _next = 'done' then trim(_report) when _action = 'reopen' then null else completion_report end,
    progress = case when _next = 'done' then 100 else progress end
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