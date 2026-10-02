// Completes the caller's own mandatory first-login password change. The new
// password goes straight to Supabase Auth, replacing the temporary one; it is
// never stored or logged by NEXA.
import { HttpError, json, serve } from "../_shared/http.ts";
import { anonClient, requireCaller, serviceClient } from "../_shared/auth.ts";
import { passwordMeetsPolicy } from "../_shared/credentials.ts";

const EXPIRED_MESSAGE = "Временный пароль истёк. Обратитесь к владельцу NEXA.";

serve(async (request, body) => {
  const caller = await requireCaller(request);
  const { newPassword, confirmPassword } = body;
  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") throw new HttpError(400, "Некорректный запрос");
  if (newPassword !== confirmPassword) throw new HttpError(400, "Пароли не совпадают");
  if (!passwordMeetsPolicy(newPassword)) throw new HttpError(400, "Пароль не соответствует требованиям");

  const admin = serviceClient();
  const { data: state, error: stateError } = await admin.from("employee_credentials")
    .select("must_change_password,expires_at").eq("user_id", caller.id).maybeSingle();
  if (stateError) throw new HttpError(503, "Не удалось прочитать состояние учётных данных");
  if (!state?.must_change_password) throw new HttpError(409, "Смена пароля не требуется");
  if (new Date(state.expires_at).getTime() <= Date.now()) throw new HttpError(403, EXPIRED_MESSAGE);
  const { data: profile, error: profileError } = await admin.from("profiles").select("is_active").eq("id", caller.id).maybeSingle();
  if (profileError) throw new HttpError(503, "Не удалось прочитать профиль");
  if (!profile?.is_active) throw new HttpError(403, "Учётная запись отключена");
  if (!caller.email) throw new HttpError(400, "Не удалось определить логин текущей сессии");

  // Reject reuse of the temporary password: if the proposed password already
  // signs in, it is the current one. The probe session is revoked at once
  // (scope "local" ends only that session, not the caller's).
  const probe = anonClient();
  const { data: reused } = await probe.auth.signInWithPassword({ email: caller.email, password: newPassword });
  if (reused.session) {
    await probe.auth.signOut({ scope: "local" });
    throw new HttpError(400, "Новый пароль должен отличаться от временного");
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(caller.id, { password: newPassword });
  if (updateError) throw new HttpError(400, "Supabase Auth не принял новый пароль");
  const { data: changed, error: changeError } = await admin.from("employee_credentials")
    .update({ must_change_password: false, changed_at: new Date().toISOString() })
    .eq("user_id", caller.id).eq("must_change_password", true)
    .select("user_id");
  if (changeError || !changed?.length) {
    console.error("[complete-password-change] state update failed after password change", { userId: caller.id });
    throw new HttpError(500, "Пароль изменён, но статус учётной записи не обновлён. Обратитесь к владельцу NEXA.");
  }
  await admin.from("profiles").update({ invitation_status: "accepted" })
    .eq("id", caller.id).in("invitation_status", ["sent", "not_invited"]);
  return json(request, 200, { ok: true });
});
