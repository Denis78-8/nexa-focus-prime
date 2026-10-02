import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TEMPORARY_PASSWORD_EXPIRED_MESSAGE = "Временный пароль истёк. Обратитесь к владельцу NEXA.";

// mustChangePassword is false and expiresAt null when the caller has no
// credential requirement row (legacy accounts, the owner).
export type CredentialState = { mustChangePassword: boolean; expired: boolean; expiresAt: string | null };

export const getMyCredentialState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CredentialState> => {
    const { data, error } = await context.supabase.rpc("get_my_credential_state");
    if (error) throw new Error(error.message);
    const state = data && typeof data === "object" ? data as { must_change_password?: unknown; expired?: unknown; expires_at?: unknown } : {};
    return {
      mustChangePassword: state.must_change_password === true,
      expired: state.expired === true,
      expiresAt: typeof state.expires_at === "string" ? state.expires_at : null,
    };
  });
