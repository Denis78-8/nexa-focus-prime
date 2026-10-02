// Creates a NEXA employee: Auth user + employee_credentials + profile + role.
// Login and temporary password are generated here; the password is sent to
// Supabase Auth and returned once to the caller. It is never stored or logged.
import { HttpError, json, serve } from "../_shared/http.ts";
import { isOwner, requireCaller, requirePermission, serviceClient } from "../_shared/auth.ts";
import { availableCorporateLogin } from "../_shared/corporate-login.ts";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "../_shared/credentials.ts";

const ROLES = new Set(["employee", "manager", "director"]);

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError(400, "Некорректные данные сотрудника");
  return value.trim() || null;
}

function parseInput(body: Record<string, unknown>) {
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (fullName.length < 2 || fullName.length > 120) throw new HttpError(400, "Укажите имя и фамилию");
  const role = body.role;
  if (typeof role !== "string" || !ROLES.has(role)) throw new HttpError(400, "Некорректная роль");
  const accessLevel = body.accessLevel;
  if (typeof accessLevel !== "number" || !Number.isInteger(accessLevel) || accessLevel < 1 || accessLevel > 5) {
    throw new HttpError(400, "Уровень доступа должен быть от 1 до 5");
  }
  if (body.isVip !== undefined && typeof body.isVip !== "boolean") throw new HttpError(400, "Некорректный признак VIP");
  return {
    fullName,
    position: optionalText(body.position, 120),
    department: optionalText(body.department, 120),
    role,
    accessLevel,
    isVip: body.isVip === true,
  };
}

serve(async (request, body) => {
  const caller = await requireCaller(request);
  const input = parseInput(body);

  // Same permission model as the previous server function.
  await requirePermission(caller, "employees.manage");
  if (input.role !== "employee") await requirePermission(caller, "roles.manage");
  if (input.accessLevel !== 2) await requirePermission(caller, "access_levels.manage");
  if (input.isVip) await requirePermission(caller, "vip.manage");
  const admin = serviceClient();
  const owner = await isOwner(admin, caller.id);
  if (!owner && (input.role !== "employee" || input.accessLevel !== 2)) {
    throw new HttpError(403, "Повышенные роли и уровни назначает владелец NEXA");
  }

  const login = await availableCorporateLogin(admin, input.fullName);
  const temporaryPassword = generateTemporaryPassword();
  const issuedAt = new Date();
  const expiresAt = temporaryPasswordExpiry(issuedAt);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: login,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (createError || !created.user) {
    const taken = createError?.message?.toLowerCase().includes("already");
    throw new HttpError(taken ? 409 : 502, taken ? "Логин уже занят в Auth; обновите форму и повторите" : "Supabase Auth не создал пользователя");
  }
  const uid = created.user.id;

  // Credential state is written first so the account is locked behind the
  // mandatory password change before a profile ever makes it active.
  let failedStep: string | null = null;
  const credential = await admin.from("employee_credentials").insert({
    user_id: uid, must_change_password: true, issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(), issued_by: caller.id,
  });
  if (credential.error) failedStep = "employee_credentials";
  if (!failedStep) {
    const profile = await admin.from("profiles").insert({
      id: uid, email: login, full_name: input.fullName,
      position: input.position ?? (input.role === "director" ? "Директор" : null),
      department: input.department, access_level: input.accessLevel, is_vip: input.isVip,
      invitation_status: "sent", mailbox_status: "pending",
    });
    if (profile.error) failedStep = "profiles";
  }
  if (!failedStep) {
    const role = await admin.from("user_roles").insert({ user_id: uid, role: input.role });
    if (role.error) failedStep = "user_roles";
  }

  if (failedStep) {
    // Roll back everything created above; every rollback step is checked.
    const rollbackFailures: string[] = [];
    if ((await admin.from("user_roles").delete().eq("user_id", uid)).error) rollbackFailures.push("user_roles");
    if ((await admin.from("profiles").delete().eq("id", uid)).error) rollbackFailures.push("profiles");
    if ((await admin.auth.admin.deleteUser(uid)).error) rollbackFailures.push("auth.users");
    // employee_credentials is removed by ON DELETE CASCADE with the Auth user.
    if (rollbackFailures.length) {
      console.error("[admin-create-employee] rollback incomplete", { userId: uid, failedStep, rollbackFailures });
      throw new HttpError(500, `Создание прервано на шаге ${failedStep}; откат не завершён (${rollbackFailures.join(", ")}). Учётная запись заблокирована. Сообщите владельцу NEXA идентификатор ${uid}.`);
    }
    throw new HttpError(500, `Создание прервано на шаге ${failedStep}; изменения отменены.`);
  }

  return json(request, 200, { ok: true, userId: uid, login, temporaryPassword, expiresAt: expiresAt.toISOString() });
});
