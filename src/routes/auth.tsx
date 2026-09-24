import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход — NEXA Obsidian Flow" },
      { name: "description", content: "Вход в рабочее пространство NEXA: задачи, проекты и учёт времени." },
      { property: "og:title", content: "Вход — NEXA Obsidian Flow" },
      { property: "og:description", content: "Вход в рабочее пространство NEXA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    console.info("AUTH DEBUG: submit start");
    setBusy(true);
    try {
      if (mode === "signin") {
        console.info("AUTH DEBUG: before signInWithPassword");
        const result = await supabase.auth.signInWithPassword({ email, password });
        console.info("AUTH DEBUG: after signInWithPassword", { error: Boolean(result.error) });
        if (result.error) {
          console.error("AUTH DEBUG: signIn error", {
            name: result.error.name,
            message: result.error.message,
            status: result.error.status,
            code: result.error.code,
          });
          throw result.error;
        }
        console.info("AUTH DEBUG: before redirect");
        navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/" });
        else {
          setConfirmationEmail(email);
          setMode("signin");
        }
      }
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      const details = [
        e.name === "AbortError"
          ? "Сервер авторизации не ответил за 20 секунд. Проверьте соединение и повторите вход."
          : e.message || "Ошибка входа",
        e.code ? `code: ${e.code}` : "",
        e.status ? `status: ${e.status}` : "",
      ].filter(Boolean).join(" · ");

      console.error("[NEXA Auth]", err);
      toast.error(details);
    } finally {
      console.info("AUTH DEBUG: submit finally");
      setBusy(false);
    }
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">N</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">NEXA</div>
            <div className="text-[11px] text-muted-foreground">{mode === "signin" ? "Вход в рабочее пространство" : "Регистрация сотрудника"}</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {confirmationEmail && (
            <p role="status" className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
              Аккаунт создан. Подтвердите адрес по ссылке из письма на <strong>{confirmationEmail}</strong>, затем войдите.
            </p>
          )}
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="fn">ФИО</Label>
              <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="em">Email</Label>
            <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Пароль</Label>
            <Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full active:scale-[0.98]" disabled={busy}>
            {busy ? "Подождите…" : mode === "signin" ? "Войти" : "Зарегистрироваться"}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
          <button type="button" className="hover:text-foreground" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Войти"}
          </button>
          <Link to="/" className="hover:text-foreground">На главную</Link>
        </div>
      </div>
    </div>
  );
}
