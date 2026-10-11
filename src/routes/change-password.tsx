import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/nexa/AuthLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { completePasswordChange } from "@/lib/edge-functions";
import {
  getMyCredentialState,
  TEMPORARY_PASSWORD_EXPIRED_MESSAGE,
  type CredentialState,
} from "@/lib/credentials.functions";
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, passwordMeetsPolicy } from "@/lib/password-policy";

export const Route = createFileRoute("/change-password")({
  head: () => ({ meta: [{ title: "Смена пароля — LUNO DIGITAL" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const loadState = useServerFn(getMyCredentialState);
  const [state, setState] = useState<CredentialState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  // Passwords live only in component state and are cleared after submit.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    let live = true;
    loadState()
      .then((result) => { if (live) setState(result); })
      .catch((error: unknown) => { if (live) setStateError(error instanceof Error ? error.message : "Не удалось проверить состояние учётной записи"); });
    return () => { live = false; };
  }, [session, loadState]);

  if (loading) return <Shell><p className="text-sm text-muted-foreground">Проверяем сессию…</p></Shell>;
  if (!session) return <Navigate to="/auth" />;
  if (stateError) return <Shell><p role="alert" className="text-sm">{stateError}</p><SignOutButton /></Shell>;
  if (!state) return <Shell><p className="text-sm text-muted-foreground">Проверяем учётную запись…</p></Shell>;
  if (!state.mustChangePassword) return <Navigate to="/" />;
  if (state.expired) {
    return (
      <Shell>
        <p role="alert" className="text-sm">{TEMPORARY_PASSWORD_EXPIRED_MESSAGE}</p>
        <SignOutButton />
      </Shell>
    );
  }

  const valid = passwordMeetsPolicy(newPassword) && newPassword === confirmPassword;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await completePasswordChange(newPassword, confirmPassword);
      setNewPassword("");
      setConfirmPassword("");
      // All sessions were revoked server-side (SEC-001); drop the local copy
      // and sign in again with the new password.
      await supabase.auth.signOut({ scope: "local" });
      toast.success("Пароль изменён. Войдите с новым паролем.");
      await navigate({ to: "/auth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить пароль");
      const fresh = await loadState().catch(() => null);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-title-2">Смените временный пароль</h1>
      <p className="mt-2 text-callout text-muted-foreground">
        Рабочее пространство откроется после смены пароля.
        {state.expiresAt && <> Временный пароль действителен до {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.expiresAt))}.</>}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Новый пароль</Label>
          <Input id="new-password" type="password" autoComplete="new-password" className="h-11" maxLength={PASSWORD_MAX_LENGTH} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Подтверждение пароля</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" className="h-11" maxLength={PASSWORD_MAX_LENGTH} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <ul className="space-y-1.5 text-caption">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule.label} className={rule.test(newPassword) ? "text-primary" : "text-muted-foreground"}>{rule.test(newPassword) ? "✓" : "·"} {rule.label}</li>
          ))}
          <li className={confirmPassword && newPassword === confirmPassword ? "text-primary" : "text-muted-foreground"}>
            {confirmPassword && newPassword === confirmPassword ? "✓" : "·"} Пароли совпадают
          </li>
        </ul>
        <Button type="submit" size="lg" className="w-full" disabled={busy || !valid}>{busy ? "Сохраняем…" : "Сменить пароль"}</Button>
      </form>
      <SignOutButton />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AuthLayout>
      <div className="luno-rise">{children}</div>
    </AuthLayout>
  );
}

function SignOutButton() {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="ghost"
      className="mt-3 w-full"
      onClick={() => void supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
    >
      Выйти
    </Button>
  );
}
