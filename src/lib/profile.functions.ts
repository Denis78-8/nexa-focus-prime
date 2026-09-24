import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type PrivateProfileFields = {
  email: string | null;
  phone: string | null;
  location: string | null;
  access_level: number | null;
};

export const getCurrentProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as unknown as {
      from: (table: string) => any;
      rpc: (name: string, args: Record<string, string>) => Promise<{ data: boolean | null; error: { message: string } | null }>;
    };
    const { data: profile, error } = await client
      .from("profiles")
      .select("id,full_name,position,department,avatar_url,presence,created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile || profile.id !== context.userId) throw new Error("Профиль текущего пользователя не найден");

    let privateFields: PrivateProfileFields = {
      email: null,
      phone: null,
      location: null,
      access_level: null,
    };
    const { data: mayReadPrivate, error: permissionError } = await client.rpc("has_permission", {
      _permission: "profiles.private.read",
    });
    if (!permissionError && mayReadPrivate) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as { from: (table: string) => any };
        const { data, error: privateError } = await admin
          .from("profiles")
          .select("email,phone,location,access_level")
          .eq("id", context.userId)
          .maybeSingle();
        if (!privateError && data) privateFields = data as PrivateProfileFields;
      } catch {
        // Private fields stay hidden if privileged server access is unavailable.
      }
    }

    return {
      ...profile,
      ...privateFields,
      private_fields_allowed: !permissionError && Boolean(mayReadPrivate),
    };
  });
