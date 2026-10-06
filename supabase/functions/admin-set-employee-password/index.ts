// Owner-only: sets a password chosen by the owner for an active employee.
// Runs in Cloud, where the service-role key lives, so the app server needs no
// service-role secret for this. The password goes straight to Supabase Auth
// and is never stored, logged or returned.
import { HttpError, json, serve } from "../_shared/http.ts";
import { isOwner, requireCaller, requirePermission, serviceClient } from "../_shared/auth.ts";
import { PASSWORD_MAX_LENGTH } from "../_shared/credentials.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_MIN_LENGTH = 12;

serve(async (request, body) => {
  const caller = await requireCaller(request);
  const { userId, newPassword, confirmPassword } = body;
  if (typeof userId !== "string" || !UUID.test(userId)) throw new HttpError(400, "Некорректный идентификатор сотрудника");
  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") throw new HttpError(400, "Некорректный запрос");
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    throw new HttpError(400, "Пароль должен быть длиной от 12 до 128 символов");
  }
  if (newPassword !== confirmPassword) throw new HttpError(400, "Пароли не совпадают");

  await requirePermission(caller, "admin.access");
  const admin = serviceClient();
  if (!(await isOwner(admin, caller.id))) throw new HttpError(403, "Менять пароли сотрудников может только владелец LUNO DIGITAL");
  if (userId === caller.id) throw new HttpError(400, "Нельзя изменить собственный пароль через Админ-панель");
  if (await isOwner(admin, userId)) throw new HttpError(403, "Пароль владельца LUNO DIGITAL нельзя изменить через Админ-панель");

  const { data: profile, error: profileError } = await admin.from("profiles").select("id,is_active").eq("id", userId).maybeSingle();
  if (profileError) throw new HttpError(503, "Не удалось прочитать профиль сотрудника");
  if (!profile || profile.id !== userId) throw new HttpError(404, "Сотрудник с таким UUID не найден");
  if (!profile.is_active) throw new HttpError(409, "Нельзя изменить пароль отключённой учётной записи");

  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
  if (authUserError || !authUser.user || authUser.user.id !== userId) throw new HttpError(404, "Auth-пользователь не найден");
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) throw new HttpError(400, "Supabase Auth не принял новый пароль");

  // End the employee's existing sessions. revoke_user_sessions deletes only
  // auth.sessions of the given user; the caller is a different user (checked
  // above), so the owner's own session is untouched.
  const { error: revokeError } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
  if (revokeError) {
    console.error("[admin-set-employee-password] session revocation failed", { userId });
    throw new HttpError(500, "Пароль изменён, но прежние сессии сотрудника не завершены. Повторите смену пароля.");
  }

  return json(request, 200, { ok: true, sessionsRevoked: true });
});
