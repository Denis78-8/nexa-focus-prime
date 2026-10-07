-- Public work profiles: who may see whose public profile columns.
-- Only the row visibility of public.profiles changes; the column grants stay
-- as they are (authenticated reads id, full_name, position, department,
-- avatar_url, presence, created_at, updated_at, is_vip only), so email, phone,
-- location, access_level and is_active remain private.
-- An active viewer sees a profile when it is:
--   1. their own;
--   2. any, with profiles.read_all;
--   3. a member or the owner of a project the viewer can access;
--   4. the assignee, a timer user or a comment author on a task of such a project;
--   5. LUNO leadership (an active owner or director) — visible to every active employee.
-- The "Read permitted profiles" policy and the avatar storage policy already
-- use can_view_profile(), so they follow this function.

create or replace function public.can_view_profile(_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_user(auth.uid()) and (
    _profile_id = auth.uid()
    or public.has_permission_for(auth.uid(), 'profiles.read_all')
    or exists (
      select 1 from public.projects p
      where public.can_access_project(p.id, auth.uid())
        and (
          p.owner_id = _profile_id
          or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = _profile_id)
        )
    )
    or exists (
      select 1 from public.tasks t
      where t.assignee_id = _profile_id and public.can_access_project(t.project_id, auth.uid())
    )
    or exists (
      select 1 from public.task_time_entries e join public.tasks t on t.id = e.task_id
      where e.user_id = _profile_id and public.can_access_project(t.project_id, auth.uid())
    )
    or exists (
      select 1 from public.task_comments c join public.tasks t on t.id = c.task_id
      where c.author_id = _profile_id and public.can_access_project(t.project_id, auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = _profile_id and p.is_active and (
        exists (select 1 from public.nexa_owners o where o.user_id = p.id)
        or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role::text = 'director')
      )
    )
  )
$$;
revoke execute on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;

-- Public "Директор" badge for the profiles the caller may already see.
-- Returns no other role, level or status data.
create or replace function public.get_visible_profile_badges()
returns table (id uuid, is_director boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id,
    exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role::text = 'director')
      or lower(btrim(coalesce(p.position, ''))) = 'директор'
  from public.profiles p
  where public.can_view_profile(p.id)
$$;
revoke execute on function public.get_visible_profile_badges() from public, anon;
grant execute on function public.get_visible_profile_badges() to authenticated;

notify pgrst, 'reload schema';
