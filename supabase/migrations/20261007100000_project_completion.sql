-- Project lifecycle: active ⇄ completed. Completing is not deleting: tasks,
-- history, comments and time entries stay readable. A completed project is
-- read-only for new work: no new tasks, no new timer intervals, no new members.
-- Uses the existing projects.status column and can_manage_project() rights
-- (projects.write permission, project owner, or a "lead" member).

alter table public.projects
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

-- Status changes are allowed only through set_project_status() (which sets a
-- transaction-local flag after its own access and rights checks) and are
-- stamped by the database, so a direct PostgREST UPDATE cannot change the
-- status or fake completed_at / completed_by. Other project fields keep the
-- existing "Project managers update" policy.
create or replace function public.projects_lifecycle_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    if coalesce(current_setting('luno.project_status_change', true), '') <> 'rpc' then
      raise exception 'Статус проекта меняется только через set_project_status()';
    end if;
    if new.status not in ('active', 'completed') then
      raise exception 'Недопустимый статус проекта';
    end if;
    if new.status = 'completed' then
      if exists (
        select 1 from public.task_time_entries e join public.tasks t on t.id = e.task_id
        where t.project_id = new.id and e.ended_at is null
      ) then
        raise exception 'В проекте идут таймеры. Остановите их перед завершением проекта';
      end if;
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  elsif new.completed_at is distinct from old.completed_at or new.completed_by is distinct from old.completed_by then
    -- The stamps follow the status only.
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end;
$$;

drop trigger if exists t_projects_lifecycle_guard on public.projects;
create trigger t_projects_lifecycle_guard before update on public.projects
  for each row execute function public.projects_lifecycle_guard();

-- Read-only guards for completed projects (apply to every write path,
-- including RPCs such as the task transition function).
create or replace function public.project_is_completed(_project_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.projects p where p.id = _project_id and p.status = 'completed')
$$;
-- Internal helper for the triggers below; not callable by API clients.
revoke execute on function public.project_is_completed(uuid) from public, anon, authenticated;

create or replace function public.block_tasks_in_completed_project()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.project_is_completed(new.project_id) then
    raise exception 'Проект завершён: новые задачи создавать нельзя';
  end if;
  return new;
end;
$$;
drop trigger if exists t_tasks_completed_project on public.tasks;
create trigger t_tasks_completed_project before insert on public.tasks
  for each row execute function public.block_tasks_in_completed_project();

create or replace function public.block_timer_in_completed_project()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.project_is_completed((select t.project_id from public.tasks t where t.id = new.task_id)) then
    raise exception 'Проект завершён: запускать таймер нельзя';
  end if;
  return new;
end;
$$;
drop trigger if exists t_time_entries_completed_project on public.task_time_entries;
create trigger t_time_entries_completed_project before insert on public.task_time_entries
  for each row execute function public.block_timer_in_completed_project();

create or replace function public.block_members_in_completed_project()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.project_is_completed(new.project_id) then
    raise exception 'Проект завершён: добавлять участников нельзя';
  end if;
  return new;
end;
$$;
drop trigger if exists t_project_members_completed_project on public.project_members;
create trigger t_project_members_completed_project before insert on public.project_members
  for each row execute function public.block_members_in_completed_project();

-- The only way to change a project's status. Rights and state are checked
-- here for the caller; the lifecycle trigger stamps completed_at / completed_by.
create or replace function public.set_project_status(_project_id uuid, _status text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _current text;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if _status not in ('active', 'completed') then raise exception 'Недопустимый статус проекта'; end if;
  select p.status into _current from public.projects p where p.id = _project_id for update;
  if not found or not public.can_access_project(_project_id, _uid) then raise exception 'Проект не найден'; end if;
  if not public.can_manage_project(_project_id, _uid) then
    raise exception 'Недостаточно прав для изменения статуса проекта';
  end if;
  if _current = _status then
    raise exception '%', case when _status = 'completed' then 'Проект уже завершён' else 'Проект уже активен' end;
  end if;
  -- Transaction-local permit for projects_lifecycle_guard; not settable via the API.
  perform set_config('luno.project_status_change', 'rpc', true);
  update public.projects set status = _status, updated_at = now() where id = _project_id;
  return jsonb_build_object('ok', true, 'status', _status);
end;
$$;
revoke execute on function public.set_project_status(uuid, text) from public, anon;
grant execute on function public.set_project_status(uuid, text) to authenticated;

-- Realtime: project status changes reach open clients (RLS still applies).
do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
