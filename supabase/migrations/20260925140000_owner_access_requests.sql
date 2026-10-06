-- Access-level requests are reviewed only by the current NEXA owner mapping
-- (public.nexa_owners). Notifications are durable rows with one recipient
-- each: the owner gets the request, the requester gets the outcome.
-- The statements below are idempotent so the file also upgrades a database
-- where an earlier draft of this migration was already applied.
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  current_level smallint not null check (current_level between 1 and 5),
  requested_level smallint not null check (requested_level between 1 and 5),
  reason text not null check (length(trim(reason)) between 3 and 2000),
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint access_requests_level_increase check (requested_level > current_level)
);
alter table public.access_requests add column if not exists cancelled_at timestamptz;

alter table public.access_requests drop constraint if exists access_requests_status_check;
alter table public.access_requests add constraint access_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));
alter table public.access_requests drop constraint if exists access_requests_review_state;
alter table public.access_requests add constraint access_requests_review_state check (
  (status = 'pending' and reviewed_by is null and reviewed_at is null and cancelled_at is null)
  or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null and cancelled_at is null)
  or (status = 'cancelled' and reviewed_by is null and reviewed_at is null and cancelled_at is not null)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_request_id uuid not null references public.access_requests(id) on delete cascade,
  title text not null,
  body text not null,
  action_label text not null default 'Рассмотреть',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One notification per recipient per request (owner + requester).
alter table public.notifications drop constraint if exists notifications_access_request_id_key;
alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create index if not exists access_requests_requester_created_idx
  on public.access_requests(requester_id, created_at desc);
create index if not exists access_requests_owner_status_idx
  on public.access_requests(owner_user_id, status, created_at desc);
create unique index if not exists access_requests_one_pending_per_requester
  on public.access_requests(requester_id) where status = 'pending';
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create unique index if not exists notifications_request_recipient_key
  on public.notifications(access_request_id, user_id);

alter table public.access_requests enable row level security;
alter table public.notifications enable row level security;
revoke all on public.access_requests, public.notifications from anon, authenticated;
grant all on public.access_requests, public.notifications to service_role;

create or replace function public.create_access_level_request(_requested_level smallint, _reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _current_level smallint;
  _owner_count integer;
  _owner uuid;
  _request_id uuid;
  _full_name text;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.is_active_user(_uid) then raise exception 'Учётная запись отключена'; end if;
  if _requested_level not between 1 and 5 then raise exception 'Уровень доступа должен быть от 1 до 5'; end if;
  if _reason is null or length(trim(_reason)) not between 3 and 2000 then
    raise exception 'Укажите причину длиной от 3 до 2000 символов';
  end if;

  select p.access_level, p.full_name into _current_level, _full_name
  from public.profiles p where p.id = _uid for update;
  if not found then raise exception 'Профиль сотрудника не найден'; end if;
  if _requested_level <= _current_level then raise exception 'Запрошенный уровень должен быть выше текущего'; end if;
  if exists (select 1 from public.access_requests r where r.requester_id = _uid and r.status = 'pending') then
    raise exception 'У вас уже есть заявка на рассмотрении. Отмените её, чтобы отправить новую';
  end if;

  select count(*) into _owner_count from public.nexa_owners o;
  if _owner_count = 1 then select o.user_id into _owner from public.nexa_owners o; end if;
  insert into public.access_requests(requester_id, owner_user_id, current_level, requested_level, reason)
  values (_uid, case when _owner_count = 1 then _owner else null end, _current_level, _requested_level, trim(_reason))
  returning id into _request_id;

  if _owner_count <> 1 then
    -- Keep an auditable pending request without changing access; surface a
    -- safe configuration error to the requester. No notification is broadcast.
    return jsonb_build_object('ok', false, 'code', 'owner_mapping_unavailable',
      'message', 'Не удалось определить единственного владельца NEXA. Заявка сохранена без изменения уровня доступа; обратитесь к владельцу системы.');
  end if;

  insert into public.notifications(user_id, access_request_id, title, body)
  values (_owner, _request_id, 'Новый запрос на предоставление доступа',
    format('%s · текущий уровень %s · запрошен уровень %s · причина: %s · дата: %s',
      _full_name, _current_level, _requested_level, trim(_reason),
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')));

  return jsonb_build_object('ok', true, 'request_id', _request_id, 'owner_user_id', _owner);
end;
$$;

create or replace function public.get_my_access_level_requests()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _uid uuid := auth.uid(); _owner_count integer; _owner uuid;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.is_active_user(_uid) then raise exception 'Учётная запись отключена'; end if;
  select count(*) into _owner_count from public.nexa_owners o;
  if _owner_count = 1 then select o.user_id into _owner from public.nexa_owners o; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'requester_id', r.requester_id, 'employee_name', p.full_name,
      'current_level', r.current_level, 'requested_level', r.requested_level,
      'reason', r.reason, 'status', r.status, 'reviewed_by', r.reviewed_by,
      'reviewer_name', reviewer.full_name, 'reviewed_at', r.reviewed_at,
      'cancelled_at', r.cancelled_at, 'created_at', r.created_at,
      'is_owner_review', (_owner_count = 1 and r.owner_user_id = _uid and _owner = _uid),
      'can_cancel', (r.requester_id = _uid and r.status = 'pending'),
      'notification_title', n.title, 'notification_body', n.body,
      'notification_status', n.status, 'action_label', n.action_label
    ) order by r.created_at desc)
    from public.access_requests r
    join public.profiles p on p.id = r.requester_id
    left join public.profiles reviewer on reviewer.id = r.reviewed_by
    left join public.notifications n on n.access_request_id = r.id and n.user_id = _uid
    where r.requester_id = _uid or (_owner_count = 1 and r.owner_user_id = _uid and _owner = _uid)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_access_level_request(_request_id uuid, _decision text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _owner_count integer;
  _owner uuid;
  _request public.access_requests;
  _current_level smallint;
  _requester_active boolean;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.is_active_user(_uid) then raise exception 'Учётная запись отключена'; end if;
  if _decision not in ('approved', 'rejected') then raise exception 'Решение должно быть approve или reject'; end if;
  -- Owner is resolved only from nexa_owners; roles, permissions and
  -- access_level deliberately play no part in this check.
  select count(*) into _owner_count from public.nexa_owners o;
  if _owner_count = 1 then select o.user_id into _owner from public.nexa_owners o; end if;
  if _owner_count <> 1 or _owner is distinct from _uid then
    raise exception 'Рассматривать заявки может только текущий владелец NEXA';
  end if;

  select * into _request from public.access_requests where id = _request_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if _request.owner_user_id is distinct from _uid then raise exception 'Заявка не адресована текущему владельцу'; end if;
  if _request.status <> 'pending' then raise exception 'Заявка уже рассмотрена или отменена'; end if;
  select p.access_level, p.is_active into _current_level, _requester_active
  from public.profiles p where p.id = _request.requester_id for update;
  if not found then raise exception 'Профиль сотрудника не найден'; end if;
  if _requester_active is distinct from true then raise exception 'Учётная запись сотрудника отключена'; end if;
  if _current_level is distinct from _request.current_level then
    raise exception 'Текущий уровень сотрудника изменился; попросите сотрудника отправить новую заявку';
  end if;

  if _decision = 'approved' then
    update public.profiles set access_level = _request.requested_level, updated_at = now()
    where id = _request.requester_id;
  end if;

  update public.access_requests set status = _decision, reviewed_by = _uid, reviewed_at = now()
  where id = _request_id;
  update public.notifications set status = _decision, updated_at = now()
  where access_request_id = _request_id and user_id = _uid;
  insert into public.notifications(user_id, access_request_id, title, body, action_label, status)
  values (_request.requester_id, _request_id,
    case when _decision = 'approved' then 'Доступ предоставлен' else 'Запрос на доступ отклонён' end,
    format('Уровень %s → %s · решение владельца NEXA', _request.current_level, _request.requested_level),
    'Открыть', _decision)
  on conflict (access_request_id, user_id) do update
    set title = excluded.title, body = excluded.body, status = excluded.status, updated_at = now();

  return jsonb_build_object('ok', true, 'status', _decision, 'reviewed_by', _uid,
    'reviewed_at', now(), 'access_level', case when _decision = 'approved' then _request.requested_level else _current_level end);
end;
$$;

create or replace function public.cancel_access_level_request(_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _uid uuid := auth.uid();
  _request public.access_requests;
begin
  if _uid is null then raise exception 'Требуется вход'; end if;
  if not public.is_active_user(_uid) then raise exception 'Учётная запись отключена'; end if;

  select * into _request from public.access_requests where id = _request_id for update;
  if not found or _request.requester_id is distinct from _uid then raise exception 'Заявка не найдена'; end if;
  if _request.status <> 'pending' then raise exception 'Отменить можно только заявку на рассмотрении'; end if;

  update public.access_requests set status = 'cancelled', cancelled_at = now()
  where id = _request_id;
  -- The owner's pending notification is closed; the requester gets the outcome.
  update public.notifications set status = 'cancelled', updated_at = now()
  where access_request_id = _request_id;
  insert into public.notifications(user_id, access_request_id, title, body, action_label, status)
  values (_uid, _request_id, 'Запрос на доступ отменён',
    format('Уровень %s → %s · заявка отменена сотрудником', _request.current_level, _request.requested_level),
    'Открыть', 'cancelled')
  on conflict (access_request_id, user_id) do update
    set title = excluded.title, body = excluded.body, status = excluded.status, updated_at = now();

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke execute on function public.create_access_level_request(smallint, text) from public, anon;
revoke execute on function public.get_my_access_level_requests() from public, anon;
revoke execute on function public.review_access_level_request(uuid, text) from public, anon;
revoke execute on function public.cancel_access_level_request(uuid) from public, anon;
grant execute on function public.create_access_level_request(smallint, text) to authenticated;
grant execute on function public.get_my_access_level_requests() to authenticated;
grant execute on function public.review_access_level_request(uuid, text) to authenticated;
grant execute on function public.cancel_access_level_request(uuid) to authenticated;
