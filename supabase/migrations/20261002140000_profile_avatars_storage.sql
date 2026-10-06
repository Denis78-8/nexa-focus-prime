-- Profile photos in Supabase Storage.
-- Private bucket: objects are read through short-lived signed URLs, and only
-- by users who may already see that profile (public.can_view_profile).
-- Each user may write only profiles/<own auth.uid()>/... . profiles.avatar_url
-- keeps the object path; the existing column grant and the
-- "Update own public profile" policy already let a user set it on their own row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: a signed-in user may read a photo only if they may view that profile.
drop policy if exists "Avatars readable by profile viewers" on storage.objects;
create policy "Avatars readable by profile viewers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_view_profile(((storage.foldername(name))[2])::uuid)
  );

-- Write: only into the caller's own folder, only for an active account.
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active_user(auth.uid())
  );

drop policy if exists "Users replace own avatar" on storage.objects;
create policy "Users replace own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active_user(auth.uid())
  );

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
