import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCurrentProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as unknown as {
      from: (table: string) => any;
      rpc: (name: string, args: Record<string, string>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    };
    const { data: profile, error } = await client
      .from("profiles")
      .select("id,full_name,position,department,avatar_url,presence,created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile || profile.id !== context.userId) throw new Error("Профиль текущего пользователя не найден");

    // Active status is checked through the authenticated caller's own UUID.
    // This does not require a service-role client and cannot inspect other users.
    const { data: isActive, error: activeError } = await client.rpc("is_active_user", {
      _user_id: context.userId,
    });
    if (activeError) {
      throw new Error(`Не удалось проверить активность профиля через is_active_user(): ${activeError.message}`);
    }
    if (isActive !== true) throw new Error("Учётная запись не активна (is_active_user() вернула false)");

    // Optional UI badges are loaded only through the authenticated RPC. If Cloud
    // has not exposed it yet, keep the active user's shell available and report it.
    const { data: rawAccessFlags, error: accessFlagsError } = await client.rpc("get_my_nexa_access_flags", {});
    const accessFlags = rawAccessFlags && typeof rawAccessFlags === "object"
      ? rawAccessFlags as Record<string, unknown>
      : null;
    const flagsWarning = accessFlagsError
      ? `Дополнительные access flags не загружены: ${accessFlagsError.message}`
      : !accessFlags
        ? "get_my_nexa_access_flags() не вернула данные; активный доступ проверен отдельно."
        : null;
    if (flagsWarning && import.meta.env.DEV) {
      console.warn("[NEXA Auth Gate DEV] optional access flags unavailable", {
        userId: context.userId,
        code: accessFlagsError?.code ?? null,
        message: flagsWarning,
      });
    }

    const claimEmail = typeof context.claims.email === "string" ? context.claims.email : null;
    const mayReadPrivateResult = await client.rpc("has_permission", { _permission: "profiles.private.read" });
    let phone: string | null = null;
    let location: string | null = null;
    if (!mayReadPrivateResult.error && mayReadPrivateResult.data === true) {
      const { data: adminAccess, error: adminAccessError } = await client.rpc("has_permission", { _permission: "admin.access" });
      if (!adminAccessError && adminAccess === true) {
        // The authenticated role intentionally lacks direct SELECT on private
        // profile columns. Reuse the permission-checked RPC and return only the
        // current user's phone/location from this server function.
        const { data: panelData, error: panelError } = await client.rpc("get_admin_panel_data", {});
        const panel = panelData && typeof panelData === "object" ? panelData as { employees?: unknown[] } : null;
        const ownProfile = !panelError
          ? panel?.employees?.find((employee): employee is { id: string; phone?: unknown; location?: unknown } =>
              Boolean(employee && typeof employee === "object" && "id" in employee && employee.id === context.userId),
            )
          : undefined;
        phone = typeof ownProfile?.phone === "string" ? ownProfile.phone : null;
        location = typeof ownProfile?.location === "string" ? ownProfile.location : null;
      }
    }

    return {
      ...profile,
      email: claimEmail,
      phone,
      location,
      is_active: true,
      access_level: typeof accessFlags?.["access_level"] === "number" ? accessFlags["access_level"] as number : null,
      is_vip: typeof accessFlags?.["is_vip"] === "boolean" ? accessFlags["is_vip"] as boolean : null,
      role: typeof accessFlags?.["role"] === "string" ? accessFlags["role"] as string : null,
      is_director: typeof accessFlags?.["is_director"] === "boolean" ? accessFlags["is_director"] as boolean : null,
      access_flags_error: flagsWarning,
      private_fields_allowed: !mayReadPrivateResult.error && Boolean(mayReadPrivateResult.data),
    };
  });

// Temporary DEV-only Auth Gate diagnostics. Reports only the caller's own
// profile/access state; owner membership is intentionally outside this gate.
export const getAuthGateDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!import.meta.env.DEV) throw new Error("Not found");

    const client = context.supabase as unknown as {
      from: (table: string) => any;
      rpc: (name: string, args: Record<string, string>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    };
    const [{ data: profile, error: profileError }, { data: active, error: activeError }, { data: flags, error: flagsError }, { data: adminAccess, error: permissionError }] = await Promise.all([
      client.from("profiles").select("id").eq("id", context.userId).maybeSingle(),
      client.rpc("is_active_user", { _user_id: context.userId }),
      client.rpc("get_my_nexa_access_flags", {}),
      client.rpc("has_permission", { _permission: "admin.access" }),
    ]);

    const access = flags && typeof flags === "object" ? flags as Record<string, unknown> : null;
    return {
      userId: context.userId,
      profileExists: Boolean(profile && profile.id === context.userId),
      profileUserId: profile?.id ?? null,
      profileError: profileError ? { message: profileError.message, code: profileError.code ?? null } : null,
      isActive: typeof active === "boolean" ? active : null,
      activeError: activeError ? { message: activeError.message, code: activeError.code ?? null } : null,
      flagsLoaded: Boolean(access),
      accessLevel: typeof access?.["access_level"] === "number" ? access["access_level"] as number : null,
      isVip: typeof access?.["is_vip"] === "boolean" ? access["is_vip"] as boolean : null,
      role: typeof access?.["role"] === "string" ? access["role"] as string : null,
      flagsError: flagsError ? { message: flagsError.message, code: flagsError.code ?? null } : null,
      adminAccess: permissionError ? null : Boolean(adminAccess),
      permissionError: permissionError ? { message: permissionError.message, code: permissionError.code ?? null } : null,
      ownerCheck: "Не выполняется Auth Gate; проверка Owner относится к Admin Panel.",
    };
  });
