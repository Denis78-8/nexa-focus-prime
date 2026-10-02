// Owner-only: issues a new temporary password for an employee. The old
// password stops working, the 72-hour window restarts and the employee's
// sessions are revoked. The password is returned once and never stored.
import { HttpError, json, serve } from "../_shared/http.ts";
import { isOwner, requireCaller, requirePermission, serviceClient } from "../_shared/auth.ts";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "../_shared/credentials.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (request, body) => {
  const caller = await requireCaller(request);
  const userId = body.userId;
  if (typeof userId !== "string" || !UUID.test(userId)) throw new HttpError(400, "Некорректный идентификатор сотрудника");

  await requirePermission(caller, "admin.access");
  const admin = serviceClient();
  if (!(await isOwner(admin, caller.id))) throw new HttpError(403, "Выдавать временные пароли может только владелец NEXA");
  if (userId === caller.id) throw new HttpError(400, "Нельзя выдать временный пароль самому себе");
  if (await isOwner(admin, userId)) throw new HttpError(403, "Учётные данные владельца NEXA нельзя перевыпустить");

  const { data: profile, error: profileError } = await admin.from("profiles").select("id,is_active").eq("id", userId).maybeSingle();
  if (profileError) throw new HttpError(503, "Не удалось прочитать профиль сотрудника");
  if (!profile) throw new HttpError(404, "Сотрудник не найден");
  if (!profile.is_active) throw new HttpError(409, "Нельзя выдать пароль отключённой учётной записи");
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
  if (authUserError || !authUser.user?.email) throw new HttpError(404, "Auth-пользователь сотрудника не найден");

  const temporaryPassword = generateTemporaryPassword();
  const issuedAt = new Date();
  const expiresAt = temporaryPasswordExpiry(issuedAt);

  // 1. Lock the account behind the mandatory change before anything else.
  const { error: stateError } = await admin.from("employee_credentials").upsert({
    user_id: userId, must_change_password: true, issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(), changed_at: null, issued_by: caller.id,
  }, { onConflict: "user_id" });
  if (stateError) throw new HttpError(503, "Не удалось обновить состояние учётных данных");

  // 2. Replace the password; the previous temporary password stops working.
  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
  if (passwordError) {
    throw new HttpError(502, "Supabase Auth не принял новый пароль. Учётная запись заблокирована до повторной выдачи.");
  }

  // 3. Revoke existing sessions.
  const { error: revokeError } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
  if (revokeError) {
    console.error("[admin-reissue-temporary-password] session revocation failed", { userId });
    throw new HttpError(500, "Пароль заменён, но текущие сессии сотрудника не отозваны. Учётная запись заблокирована до смены пароля; повторите выдачу.");
  }

  return json(request, 200, { ok: true, userId, login: authUser.user.email, temporaryPassword, expiresAt: expiresAt.toISOString() });
});
