import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

async function requirePermission(context: { supabase: unknown; userId: string }, permission: string) {
  const client = context.supabase as { rpc: (name: string, args: Record<string, string>) => Promise<{ data: boolean | null; error: { message: string } | null }> };
  const { data, error } = await client.rpc("has_permission", { _permission: permission });
  fail(error);
  if (!data) throw new Error("Недостаточно прав");
}

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const rpcClient = (context: { supabase: unknown }) => context.supabase as RpcClient;

async function isOwner(context: { supabase: unknown }) {
  // Decided inside the RPC from auth.uid() and nexa_owners; no id is passed.
  const { data, error } = await rpcClient(context).rpc("current_user_is_owner", {});
  fail(error);
  return data === true;
}

export const getAdminAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as unknown as { rpc: (name: string, args: Record<string, string>) => Promise<{ data: boolean | null; error: { message: string } | null }> };
    const { data, error } = await client.rpc("has_permission", { _permission: "admin.access" });
    fail(error);
    return { allowed: Boolean(data) };
  });

export const getAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePermission(context, "admin.access");
    const client = context.supabase as unknown as {
      rpc: (name: string, args: Record<string, string>) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await client.rpc("get_admin_panel_data", {});
    fail(error);
    if (!data || typeof data !== "object") throw new Error("Сервер вернул пустые данные Admin Panel");
    const { data: profilesWrite, error: profilesWriteError } = await client.rpc("has_permission", { _permission: "profiles.write" });
    fail(profilesWriteError);
    const result = data as {
      employees: any[]; roles: any[]; permissions: any[]; rolePermissions: any[];
      levelPermissions: any[]; owners: any[]; mailboxes: any[]; credentialManagementAllowed: boolean;
      mailboxesAllowed: boolean;
      capabilities: { employeesManage: boolean; rolesManage: boolean; accessLevelsManage: boolean; vipManage: boolean; systemManage: boolean; mailboxesRead: boolean; mailboxesManage: boolean };
    };
    // Permission-checked RPC: loading the panel needs no service-role secret.
    const { data: credentials, error: credentialsError } = await client.rpc("get_employee_credential_states", {});
    fail(credentialsError);
    return {
      ...result,
      credentials: (Array.isArray(credentials) ? credentials : []) as { user_id: string; must_change_password: boolean; expires_at: string; changed_at: string | null }[],
      capabilities: { ...result.capabilities, profilesWrite: Boolean(profilesWrite) },
    };
  });

const employeePasswordInput = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
}).refine((input) => input.newPassword === input.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

export const updateEmployeePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof employeePasswordInput>) => employeePasswordInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "admin.access");
    if (!(await isOwner(context))) throw new Error("Менять пароли сотрудников может только владелец LUNO DIGITAL");
    // The Auth Admin API call runs in the admin-set-employee-password Edge
    // Function (Cloud holds the service-role key). It is invoked with this
    // user's JWT and re-checks owner rights itself; the password is not logged.
    const client = context.supabase as unknown as {
      functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: (Error & { context?: Response }) | null }> };
    };
    const { data: result, error } = await client.functions.invoke("admin-set-employee-password", {
      body: { userId: data.userId, newPassword: data.newPassword, confirmPassword: data.confirmPassword },
    });
    if (error) {
      const payload = await error.context?.json().catch(() => null) as { error?: unknown } | null | undefined;
      if (typeof payload?.error === "string") throw new Error(payload.error);
      if (error.context?.status === 404) throw new Error("Серверная функция ещё не развёрнута в Cloud");
      throw new Error("Не удалось изменить пароль сотрудника");
    }
    if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) throw new Error("Сервер вернул некорректный ответ");
    return { ok: true };
  });

const employeeInput = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  position: z.string().trim().max(120).nullable(),
  department: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(120).nullable(),
  accessLevel: z.number().int().min(1).max(5),
  role: z.enum(["employee", "manager", "director", "admin"]),
  isVip: z.boolean(),
  isActive: z.boolean(),
});

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof employeeInput>) => employeeInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "admin.access");
    const client = context.supabase as unknown as {
      rpc: (name: string, args: Record<string, string | number | boolean | null>) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    if (import.meta.env.DEV) {
      console.info("[NEXA Admin phone/location DEV] RPC arguments", {
        userId: data.id,
        phone: data.phone,
        location: data.location,
      });
    }
    const { data: result, error } = await client.rpc("update_admin_employee", {
      _user_id: data.id,
      _full_name: data.fullName,
      _position: data.position,
      _department: data.department,
      _phone: data.phone,
      _location: data.location,
      _access_level: data.accessLevel,
      _role: data.role,
      _is_vip: data.isVip,
      _is_active: data.isActive,
    });
    fail(error);
    if (!result || typeof result !== "object" || !(result as { ok?: unknown }).ok) {
      throw new Error("Cloud не подтвердил сохранение данных сотрудника");
    }
    return { ok: true };
  });

type CorporateAddress = { email: string; localPart: string; domain: string };

// The local part is derived from the full name here (transliteration); the
// suggest_corporate_email RPC picks a free suffix on the canonical domain
// stored in the database, under mailboxes.manage.
async function availableCorporateAddress(context: { supabase: unknown }, fullName: string, forUserId?: string) {
  const { generateCorporateLocalPart } = await import("@/lib/corporate-mail.server");
  const base = generateCorporateLocalPart(fullName);
  const { data, error } = await rpcClient(context).rpc("suggest_corporate_email", { _local_part: base, _for_user: forUserId ?? null });
  fail(error);
  return { base, address: data as CorporateAddress };
}

export const suggestCorporateEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fullName: string; userId?: string }) => z.object({ fullName: z.string().trim().min(2).max(120), userId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "mailboxes.manage");
    const { address } = await availableCorporateAddress(context, data.fullName, data.userId);
    return address;
  });

type ReservedMailbox = { id: string; user_id: string; email: string; local_part: string; domain: string; status: string; provider: string | null; is_primary: boolean; created_at: string };

export const reserveCorporateMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; email: string }) => z.object({ userId: z.string().uuid(), email: z.string().trim().email().max(254).toLowerCase() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "mailboxes.manage");
    const client = rpcClient(context);
    const { data: target, error: targetError } = await client.rpc("get_mailbox_reservation_target", { _user_id: data.userId });
    fail(targetError);
    const profile = target as { fullName: string; isActive: boolean };
    if (!profile.isActive) throw new Error("Нельзя зарезервировать адрес для отключённого сотрудника");
    const { base, address } = await availableCorporateAddress(context, profile.fullName, data.userId);
    if (address.email !== data.email) throw new Error(`Предложение уже изменилось. Обновите адрес: ${address.email}`);
    const { isValidCorporateEmail, getCorporateMailProvider } = await import("@/lib/corporate-mail.server");
    if (!isValidCorporateEmail(address.email, address.domain)) throw new Error("Адрес не прошёл серверную проверку формата");

    // The RPC re-checks permission, the employee, the free address and the
    // single primary mailbox, then inserts the pending reservation.
    const { data: reserved, error: reserveError } = await client.rpc("reserve_corporate_mailbox", {
      _user_id: data.userId, _email: address.email, _local_part: base,
    });
    fail(reserveError);
    const mailbox = reserved as ReservedMailbox;

    const provider = getCorporateMailProvider();
    let providerResult: Awaited<ReturnType<typeof provider.createMailbox>>;
    try {
      providerResult = await provider.createMailbox({ email: mailbox.email, displayName: profile.fullName });
    } catch {
      providerResult = { ok: false, code: "provider_error" };
    }
    if (providerResult.ok) {
      // Unreachable while nullCorporateMailProvider is the only provider.
      // Activation will be added as a server-side Cloud step together with a
      // real provider; the reservation stays pending and nothing is activated.
      throw new Error(`Адрес ${mailbox.email} зарезервирован. Активация ящика провайдером пока не поддерживается.`);
    }
    // The reservation audit event was written by reserve_corporate_mailbox;
    // the RPC records the failure event and the final status.
    const { error: finishError } = await client.rpc("finish_corporate_mailbox_provisioning", { _mailbox_id: mailbox.id, _result: providerResult.code });
    fail(finishError);
    return { mailbox: providerResult.code === "provider_error" ? { ...mailbox, status: "error" } : mailbox, provisioning: providerResult.code };
  });

export const getMyCorporateMailbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as unknown as { from: (table: string) => any };
    const { data, error } = await client.from("corporate_mailboxes")
      .select("email,status,provider,created_at,is_primary")
      .eq("user_id", context.userId).eq("is_primary", true).maybeSingle();
    fail(error);
    return data;
  });

const matrixInput = z.object({ kind: z.enum(["role", "level"]), subject: z.string().max(30), permission: z.string().max(80), enabled: z.boolean() });
export const updatePermissionMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof matrixInput>) => matrixInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, data.kind === "role" ? "roles.manage" : "access_levels.manage");
    // SEC-002: owner-only. The update_permission_matrix RPC checks the
    // permission, the nexa_owners registry and the protected entries itself.
    const { error } = await rpcClient(context).rpc("update_permission_matrix", {
      _kind: data.kind, _subject: data.subject, _permission: data.permission, _enabled: data.enabled,
    });
    fail(error);
    return { ok: true };
  });

export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePermission(context, "system.manage");
    // Minimal health check: the RPC only confirms the database answers.
    const { data, error } = await rpcClient(context).rpc("get_system_status", {});
    const ok = !error && (data as { database?: unknown } | null)?.database === "ok";
    return { database: ok ? "ok" : "error", checkedAt: new Date().toISOString(), version: "LUNO DIGITAL" };
  });
