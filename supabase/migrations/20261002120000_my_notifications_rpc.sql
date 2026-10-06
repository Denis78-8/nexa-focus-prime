-- Read and mark-as-read API for the caller's own notifications.
-- public.notifications stays closed to anon/authenticated: no table grants or
-- policies are added. These SECURITY DEFINER functions only ever touch rows
-- where user_id = auth.uid(); no user id is accepted from the client.

create or replace function public.get_my_notifications()
returns setof public.notifications
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'Требуется вход';
  end if;
  if not public.is_active_user(_uid) then
    raise exception 'Учётная запись неактивна';
  end if;

  return query
    select n.*
    from public.notifications n
    where n.user_id = _uid
    order by n.created_at desc
    limit 100;
end;
$$;

-- Marks the given notifications of the caller as read. Ids that belong to
-- someone else or are already read are ignored, so repeating the call is safe.
create or replace function public.mark_notifications_read(_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  _uid uuid := auth.uid();
  _updated integer;
begin
  if _uid is null then
    raise exception 'Требуется вход';
  end if;
  if not public.is_active_user(_uid) then
    raise exception 'Учётная запись неактивна';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = _uid
    and id = any(coalesce(_ids, '{}'::uuid[]))
    and read_at is null;
  get diagnostics _updated = row_count;
  return _updated;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  _uid uuid := auth.uid();
  _updated integer;
begin
  if _uid is null then
    raise exception 'Требуется вход';
  end if;
  if not public.is_active_user(_uid) then
    raise exception 'Учётная запись неактивна';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = _uid
    and read_at is null;
  get diagnostics _updated = row_count;
  return _updated;
end;
$$;

revoke all on function public.get_my_notifications() from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.get_my_notifications() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

notify pgrst, 'reload schema';
