import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, "Серверная конфигурация недоступна");
  return value;
}

/** Service-role client. The key exists only in the Cloud function environment. */
export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anonymous client used only for the temporary-password reuse probe. */
export function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type Caller = { id: string; email: string | null; client: SupabaseClient };

/**
 * Resolves the caller from their own JWT. verify_jwt=true already rejects
 * anonymous calls at the gateway; this re-validates the token with Auth and
 * returns a client that runs RPCs and RLS as that user.
 */
export async function requireCaller(request: Request): Promise<Caller> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/.test(authorization)) throw new HttpError(401, "Требуется вход");
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Сессия недействительна");
  return { id: data.user.id, email: data.user.email ?? null, client };
}

/** Same check as the app's requirePermission: has_permission() as the caller. */
export async function requirePermission(caller: Caller, permission: string) {
  const { data, error } = await caller.client.rpc("has_permission", { _permission: permission });
  if (error) throw new HttpError(403, "Не удалось проверить права");
  if (data !== true) throw new HttpError(403, "Недостаточно прав");
}

/** Owner is resolved only from the nexa_owners registry. */
export async function isOwner(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("nexa_owners").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(503, "Не удалось проверить владельца NEXA");
  return data?.user_id === userId;
}
