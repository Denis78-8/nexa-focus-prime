import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Profile photos live in the private "avatars" bucket under
// profiles/<auth.uid()>/... ; profiles.avatar_url stores the object path.
// Storage policies allow writing only into the caller's own folder and reading
// only photos of profiles the caller may view.
export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Validates a picked file before upload; returns an error message or null. */
export function validateAvatarFile(file: File) {
  if (!AVATAR_TYPES[file.type]) return "Подходят только изображения JPEG, PNG или WebP";
  if (file.size > AVATAR_MAX_BYTES) return "Файл больше 2 МБ";
  return null;
}

/**
 * Uploads a new photo for the signed-in user and stores its path in
 * profiles.avatar_url. Each upload gets a new file name, so cached signed URLs
 * never show a stale photo; older files in the user's folder are removed.
 */
export async function uploadMyAvatar(file: File) {
  const problem = validateAvatarFile(file);
  if (problem) throw new Error(problem);
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Требуется вход");
  const userId = auth.user.id;
  const folder = `profiles/${userId}`;
  const path = `${folder}/avatar-${Date.now()}.${AVATAR_TYPES[file.type]}`;

  const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw new Error(`Не удалось загрузить фото: ${uploadError.message}`);

  const { error: profileError } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", userId);
  if (profileError) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    throw new Error(`Фото загружено, но профиль не обновлён: ${profileError.message}`);
  }

  // Best effort: drop previous photos so the folder keeps a single file.
  const { data: existing } = await supabase.storage.from(AVATAR_BUCKET).list(folder);
  const stale = (existing ?? []).map((item) => `${folder}/${item.name}`).filter((name) => name !== path);
  if (stale.length) await supabase.storage.from(AVATAR_BUCKET).remove(stale);
  return path;
}

/** Resolves profiles.avatar_url to a displayable URL (signed for storage paths). */
export function useAvatarUrl(avatarUrl: string | null | undefined) {
  const value = avatarUrl?.trim() || null;
  const isStoragePath = Boolean(value && !/^https?:\/\//i.test(value));
  const signed = useQuery({
    queryKey: ["nexa", "avatar-url", value],
    enabled: isStoragePath,
    staleTime: (SIGNED_URL_TTL_SECONDS - 300) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(value!, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (!value) return null;
  return isStoragePath ? signed.data ?? null : value;
}
