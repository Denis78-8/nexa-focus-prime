-- Private Realtime Presence for LUNO DIGITAL online status.
-- One private topic per user: 'luno-presence:<user uuid>'.
--   * write (track): only the owner of the topic, only an active account;
--   * read (presence state): only users who may see that profile
--     (public.can_view_profile — the same rule as the profiles table).
-- RLS cannot inspect the tracked key/payload, so the user id is bound to the
-- topic name, not to the presence key. Other Realtime traffic (the public
-- 'nexa-tasks' postgres_changes channel) is not affected: these policies only
-- match extension = 'presence' on 'luno-presence:%' topics.
-- public.profiles, its RLS and column grants are not changed.

-- Parses the user id from a presence topic; null for anything else (no cast errors).
create or replace function public.luno_presence_topic_user(_topic text)
returns uuid
language sql immutable set search_path = public, pg_temp as $$
  select case
    when _topic ~ '^luno-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substr(_topic, 15)::uuid
  end
$$;
revoke execute on function public.luno_presence_topic_user(text) from public, anon;
grant execute on function public.luno_presence_topic_user(text) to authenticated;

drop policy if exists "luno presence: track own topic" on realtime.messages;
create policy "luno presence: track own topic" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and public.luno_presence_topic_user(realtime.topic()) = auth.uid()
    and public.is_active_user(auth.uid())
  );

drop policy if exists "luno presence: read visible profiles" on realtime.messages;
create policy "luno presence: read visible profiles" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and public.luno_presence_topic_user(realtime.topic()) is not null
    and public.can_view_profile(public.luno_presence_topic_user(realtime.topic()))
  );
