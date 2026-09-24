import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const OWNER_EMAIL = "denis.savinov@nexa.ru";

export const Route = createFileRoute("/owner-reset")({ component: OwnerPasswordSetup });

function OwnerPasswordSetup() {
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (resetToken.length < 32) {
      setError("Введите временный код восстановления, настроенный в Lovable Cloud.");
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError("Пароль должен содержать от 12 до 128 символов.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("owner-password-reset", {
        body: { newPassword, confirmPassword },
        headers: { "x-owner-password-reset-token": resetToken },
      });
      if (invokeError || !data?.ok) throw invokeError ?? new Error("Reset failed");
      setResetToken("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch {
      setError("Не удалось установить пароль владельца. Проверьте временный код и настройки Cloud Function.");
      setResetToken("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">TEMPORARY OWNER PASSWORD SETUP</p>
        <h1 className="text-lg font-semibold">Первичная установка пароля владельца</h1>
        {success ? (
          <p role="status" className="mt-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
            Пароль владельца успешно изменён. Войдите в NEXA под {OWNER_EMAIL}.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="owner-email" className="text-sm font-medium">Email</label>
              <Input id="owner-email" type="email" value={OWNER_EMAIL} readOnly aria-readonly="true" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="owner-reset-token" className="text-sm font-medium">Временный код восстановления</label>
              <Input id="owner-reset-token" type="password" autoComplete="off" required value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
              <p className="text-xs text-muted-foreground">Перед запуском задайте OWNER_PASSWORD_RESET_TOKEN в Lovable Cloud → Secrets. Используйте случайный код от 32 символов и удалите секрет после смены пароля.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="owner-new-password" className="text-sm font-medium">Новый пароль</label>
              <Input id="owner-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="owner-confirm-password" className="text-sm font-medium">Повтор нового пароля</label>
              <Input id="owner-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Устанавливаем…" : "Установить пароль"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
