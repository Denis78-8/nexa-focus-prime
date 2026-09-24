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

async function isOwner(context: { supabase: unknown; userId: string }) {
  // Owner-only operations are checked against the protected registry after
  // requireSupabaseAuth has verified this request's user identity.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: owner, error: ownerError } = await (supabaseAdmin as unknown as { from: (table: string) => any }).from("nexa_owners").select("user_id").eq("user_id", context.userId).maybeSingle();
  fail(ownerError);
  return Boolean(owner);
}

async function updateAuthUserPassword(userId: string, password: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    auth: { admin: {
      getUserById: (id: string) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
      updateUserById: (id: string, attributes: { password: string }) => Promise<{ error: { message: string } | null }>;
    } };
  };
  const { data, error } = await admin.auth.admin.getUserById(userId);
  fail(error);
  if (!data.user || data.user.id !== userId) throw new Error("Auth-пользователь не найден");
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  fail(updateError);
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
    await requirePermission(context, "employees.read");
    await requirePermission(context, "profiles.private.read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };
    await requirePermission(context, "mailboxes.read");
    const [profiles, roles, permissions, rolePermissions, levelPermissions, owners, mailboxes] = await Promise.all([
      admin.from("profiles").select("id,full_name,email,position,department,phone,location,presence,access_level,is_vip,is_active,mailbox_status,invitation_status,created_at").order("full_name"),
      admin.from("user_roles").select("user_id,role"),
      admin.from("permissions").select("key,description").order("key"),
      admin.from("role_permissions").select("role,permission_key"),
      admin.from("access_level_permissions").select("access_level,permission_key"),
      admin.from("nexa_owners").select("user_id"),
      admin.from("corporate_mailboxes").select("id,user_id,email,local_part,domain,status,provider,is_primary,created_at,updated_at,disabled_at"),
    ]);
    [profiles, roles, permissions, rolePermissions, levelPermissions, owners, mailboxes].forEach((r) => fail(r.error));
    return {
      employees: profiles.data ?? [], roles: roles.data ?? [], permissions: permissions.data ?? [],
      rolePermissions: rolePermissions.data ?? [], levelPermissions: levelPermissions.data ?? [],
      owners: owners.data ?? [], mailboxes: mailboxes.data ?? [],
      credentialManagementAllowed: (owners.data ?? []).some((owner: { user_id: string }) => owner.user_id === context.userId),
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
    if (!(await isOwner(context))) throw new Error("Менять пароли сотрудников может только владелец NEXA");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,is_active")
      .eq("id", data.userId)
      .maybeSingle();
    fail(profileError);
    if (!profile || profile.id !== data.userId) throw new Error("Сотрудник с таким UUID не найден");
    if (!profile.is_active) throw new Error("Нельзя изменить пароль отключённой учётной записи");

    await updateAuthUserPassword(data.userId, data.newPassword);
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
    await requirePermission(context, "employees.manage");
    await requirePermission(context, "vip.manage");
    const owner = await isOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any; auth: any };
    const [{ data: targetOwner, error: ownerError }, { data: targetRole, error: targetRoleError }] = await Promise.all([
      admin.from("nexa_owners").select("user_id").eq("user_id", data.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", data.id).maybeSingle(),
    ]);
    fail(ownerError);
    fail(targetRoleError);
    if (targetOwner && !data.isActive) throw new Error("Учётную запись владельца нельзя деактивировать");
    if (!owner && (targetOwner || targetRole?.role === "admin" || data.role === "admin" || data.role === "director" || data.id === context.userId && !data.isActive)) {
      throw new Error("Изменять владельца, администратора, руководителя или блокировать собственный доступ может только владелец NEXA");
    }
    if (!owner && data.accessLevel > 3) throw new Error("Уровни 4–5 назначает только владелец NEXA");
    const { error: profileError } = await admin.from("profiles").update({
      full_name: data.fullName, position: data.position, department: data.department, phone: data.phone,
      location: data.location, access_level: data.accessLevel, is_vip: data.isVip, is_active: data.isActive,
    }).eq("id", data.id);
    fail(profileError);
    const { error: clearRolesError } = await admin.from("user_roles").delete().eq("user_id", data.id);
    fail(clearRolesError);
    const { error: roleError } = await admin.from("user_roles").insert({ user_id: data.id, role: data.role });
    fail(roleError);
    const { error: authError } = await admin.auth.admin.updateUserById(data.id, { ban_duration: data.isActive ? "none" : "876000h" });
    fail(authError);
    return { ok: true };
  });

const inviteInput = z.object({ email: z.string().trim().email().max(254), fullName: z.string().trim().min(2).max(120), position: z.string().trim().max(120).optional(), department: z.string().trim().max(120).optional(), role: z.enum(["employee", "manager", "director"]), accessLevel: z.number().int().min(1).max(5) });

export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof inviteInput>) => inviteInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "employees.manage");
    const owner = await isOwner(context);
    if (!owner && (data.role !== "employee" || data.accessLevel > 3)) throw new Error("Повышенные роли и уровни назначает владелец NEXA");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { auth: any; from: (table: string) => any };
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(data.email, { data: { full_name: data.fullName } });
    fail(error);
    const uid = invited.user?.id;
    if (!uid) throw new Error("Supabase не вернул идентификатор приглашённого пользователя");
    const { error: profileError } = await admin.from("profiles").upsert({ id: uid, email: data.email, full_name: data.fullName, position: data.position ?? null, department: data.department ?? null, access_level: data.accessLevel, invitation_status: "sent", mailbox_status: "pending" });
    const { error: roleError } = profileError ? { error: null } : await admin.from("user_roles").insert({ user_id: uid, role: data.role });
    if (profileError || roleError) {
      await admin.auth.admin.deleteUser(uid);
      fail(profileError);
      fail(roleError);
    }
    const proposal = await availableCorporateAddress(data.fullName, admin);
    return { ok: true, userId: uid, invitationStatus: "sent", corporateEmailProposal: proposal.email };
  });

async function availableCorporateAddress(fullName: string, admin: { from: (table: string) => any }) {
  const { generateCorporateLocalPart, getCorporateMailDomain } = await import("@/lib/corporate-mail.server");
  const base = generateCorporateLocalPart(fullName);
  const domain = getCorporateMailDomain();
  const [mailboxResult, profileResult] = await Promise.all([
    admin.from("corporate_mailboxes").select("email"),
    admin.from("profiles").select("email").not("email", "is", null),
  ]);
  fail(mailboxResult.error);
  fail(profileResult.error);
  const occupied = new Set<string>([
    ...(mailboxResult.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
    ...(profileResult.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
  ]);
  for (let suffix = 1; suffix <= 10000; suffix += 1) {
    const marker = suffix === 1 ? "" : String(suffix);
    const localPart = `${base.slice(0, 64 - marker.length)}${marker}`;
    const email = `${localPart}@${domain}`;
    if (!occupied.has(email)) return { email, localPart, domain };
  }
  throw new Error("Не удалось подобрать свободный адрес корпоративной почты");
}

export const suggestCorporateEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fullName: string }) => z.object({ fullName: z.string().trim().min(2).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "mailboxes.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };
    return availableCorporateAddress(data.fullName, admin);
  });

export const reserveCorporateMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; email: string }) => z.object({ userId: z.string().uuid(), email: z.string().trim().email().max(254).toLowerCase() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, "mailboxes.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,full_name,is_active").eq("id", data.userId).maybeSingle();
    fail(profileError);
    if (!profile) throw new Error("Сотрудник не найден");
    if (!profile.is_active) throw new Error("Нельзя зарезервировать адрес для отключённого сотрудника");
    const { email, localPart, domain } = await availableCorporateAddress(profile.full_name, admin);
    if (email !== data.email) throw new Error(`Предложение уже изменилось. Обновите адрес: ${email}`);
    const { isValidCorporateEmail, getCorporateMailProvider } = await import("@/lib/corporate-mail.server");
    if (!isValidCorporateEmail(email, domain)) throw new Error("Адрес не прошёл серверную проверку формата");
    const { data: existing, error: existingError } = await admin.from("corporate_mailboxes").select("id").eq("user_id", data.userId).eq("is_primary", true).maybeSingle();
    fail(existingError);
    if (existing) throw new Error("У сотрудника уже есть основной корпоративный адрес");

    const { data: mailbox, error: insertError } = await admin.from("corporate_mailboxes").insert({
      user_id: data.userId, email, local_part: localPart, domain, status: "pending", provider: null,
      provider_user_id: null, is_primary: true, created_by: context.userId,
      metadata: { provisioning: "not_started" },
    }).select("id,user_id,email,local_part,domain,status,provider,is_primary,created_at").single();
    fail(insertError);

    const provider = getCorporateMailProvider();
    let providerResult: Awaited<ReturnType<typeof provider.createMailbox>>;
    try {
      providerResult = await provider.createMailbox({ email, displayName: profile.full_name });
    } catch {
      providerResult = { ok: false, code: "provider_error" };
    }
    const audit = (action: "mailbox_created" | "mailbox_provision_failed", metadata: Record<string, unknown>) =>
      admin.from("mailbox_audit_events").insert({ mailbox_id: mailbox.id, action, actor_user_id: context.userId, target_user_id: data.userId, metadata });
    if (!providerResult.ok) {
      const { error: createdAuditError } = await audit("mailbox_created", { status: "pending", reservationOnly: true, realMailboxCreated: false });
      fail(createdAuditError);
      const { error: failureAuditError } = await audit("mailbox_provision_failed", { code: providerResult.code, realMailboxCreated: false });
      fail(failureAuditError);
      if (providerResult.code === "provider_error") {
        const { error: statusError } = await admin.from("corporate_mailboxes").update({ status: "error", metadata: { provisioning: "error" } }).eq("id", mailbox.id);
        fail(statusError);
      } else {
        const { error: statusError } = await admin.from("corporate_mailboxes").update({ metadata: { provisioning: "provider_not_configured" } }).eq("id", mailbox.id);
        fail(statusError);
      }
      return { mailbox: providerResult.code === "provider_error" ? { ...mailbox, status: "error" } : mailbox, provisioning: providerResult.code };
    }

    const { error: activateError } = await admin.from("corporate_mailboxes").update({
      status: "active", provider: providerResult.value.provider, provider_user_id: providerResult.value.providerUserId,
      metadata: { provisioning: "active" },
    }).eq("id", mailbox.id);
    fail(activateError);
    const { error: createdAuditError } = await audit("mailbox_created", { status: "active", provider: providerResult.value.provider, realMailboxCreated: true });
    fail(createdAuditError);
    return { mailbox: { ...mailbox, status: "active", provider: providerResult.value.provider }, provisioning: "active" as const };
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
    const owner = await isOwner(context);
    const protectedPermissions = ["admin.access", "employees.manage", "roles.manage", "access_levels.manage", "vip.manage", "system.manage", "mailboxes.manage"];
    if (data.kind === "role" && data.subject === "admin") throw new Error("Матрица admin защищена");
    if (!owner && (protectedPermissions.includes(data.permission) || data.kind === "role" && data.subject === "director")) throw new Error("Эту матрицу может менять только владелец NEXA");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };
    const table = data.kind === "role" ? "role_permissions" : "access_level_permissions";
    const key = data.kind === "role" ? { role: data.subject, permission_key: data.permission } : { access_level: Number(data.subject), permission_key: data.permission };
    if (data.enabled) {
      const { error } = await admin.from(table).upsert(key, { onConflict: data.kind === "role" ? "role,permission_key" : "access_level,permission_key" });
      fail(error);
    } else {
      let query = admin.from(table).delete().eq("permission_key", data.permission);
      query = data.kind === "role" ? query.eq("role", data.subject) : query.eq("access_level", Number(data.subject));
      const { error } = await query;
      fail(error);
    }
    return { ok: true };
  });

export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePermission(context, "system.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as { from: (table: string) => any }).from("profiles").select("id", { count: "exact", head: true });
    return { database: error ? "error" : "ok", checkedAt: new Date().toISOString(), version: "NEXA Helpdesk · v0.2" };
  });
