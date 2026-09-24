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
