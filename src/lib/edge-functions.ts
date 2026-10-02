import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Calls a NEXA Supabase Edge Function with the current user's session JWT
 * (attached by supabase-js). Operations that need the Auth Admin API run
 * there, with the service-role key held only by the Cloud environment.
 */
async function invokeEdge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = "Серверная операция не выполнена";
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === "string") message = payload.error;
      else if (error.context.status === 404) message = "Серверная функция ещё не развёрнута в Cloud";
    }
    throw new Error(message);
  }
  if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
    throw new Error("Сервер вернул некорректный ответ");
  }
  return data as T;
}

/** Shown once in the Admin Panel; never persisted, logged or put in a URL. */
export type IssuedCredentials = { userId: string; login: string; temporaryPassword: string; expiresAt: string };

export type NewEmployeeInput = {
  fullName: string;
  position?: string | undefined;
  department?: string | undefined;
  role: "employee" | "manager" | "director";
  accessLevel: number;
  isVip: boolean;
};

export const createEmployee = (input: NewEmployeeInput) =>
  invokeEdge<IssuedCredentials>("admin-create-employee", input);

export const reissueTemporaryPassword = (userId: string) =>
  invokeEdge<IssuedCredentials>("admin-reissue-temporary-password", { userId });

export const completePasswordChange = (newPassword: string, confirmPassword: string) =>
  invokeEdge<{ ok: true }>("complete-password-change", { newPassword, confirmPassword });
