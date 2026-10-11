import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/nexa/AuthLayout";
import { PasswordInput } from "@/components/nexa/PasswordInput";
import { riseDelay } from "@/lib/motion";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход — LUNO DIGITAL" },
      { name: "description", content: "Вход в рабочее пространство LUNO DIGITAL: задачи, проекты и учёт времени." },
      { property: "og:title", content: "Вход — LUNO DIGITAL" },
      { property: "og:description", content: "Вход в рабочее пространство LUNO DIGITAL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const ERROR_ID = "auth-error";

const SIGN_IN_MESSAGE = {
  invalidCredentials: "Неверная почта или пароль.",
  network: "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.",
  unavailable: "Сервис временно недоступен. Попробуйте ещё раз.",
  generic: "Не удалось выполнить вход. Попробуйте ещё раз.",
} as const;

/**
 * User-facing text for a failed sign-in. Raw Supabase messages, codes and
 * statuses never reach the screen (they stay in the console logs above).
 * Wrong password and unknown email get the same message, so the screen does
 * not reveal whether an account exists.
 */
function signInErrorMessage(error: Error & { code?: string; status?: number }) {
  if (error.code === "invalid_credentials" || error.message === "Invalid login credentials") {
    return SIGN_IN_MESSAGE.invalidCredentials;
  }
  if (typeof error.status === "number" && error.status >= 500) return SIGN_IN_MESSAGE.unavailable;
  if (
    error.name === "AbortError" ||
    error.name === "AuthRetryableFetchError" ||
    error.name === "TypeError" ||
    error.status === 0
  ) {
    return SIGN_IN_MESSAGE.network;
  }
  return SIGN_IN_MESSAGE.generic;
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    console.info("AUTH DEBUG: submit start");
    setBusy(true);
    setError(null);
    try {
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
      if (import.meta.env.DEV) {
        console.info("[NEXA Auth DEV] sign-in identity", {
          userId: result.data.user.id,
          email: result.data.user.email ?? null,
        });
      }
      console.info("AUTH DEBUG: before redirect");
      navigate({ to: "/" });
    } catch (err) {
      setError(signInErrorMessage(err as Error & { code?: string; status?: number }));
      console.error("[NEXA Auth]", err);
    } finally {
      console.info("AUTH DEBUG: submit finally");
      setBusy(false);
    }
  }

  const invalid = error ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

  return (
    <AuthLayout>
      <div className="luno-rise" style={riseDelay(140)}>
        <h1 className="text-title-1">Вход</h1>
        <p className="mt-2 text-body text-muted-foreground">Рабочее пространство LUNO DIGITAL</p>
      </div>

      <form onSubmit={submit} className="luno-rise mt-8 space-y-5" style={riseDelay(220)}>
        <div className="space-y-2">
          <Label htmlFor="em">Почта</Label>
          <Input
            id="em"
            type="email"
            autoComplete="username"
            inputMode="email"
            className="h-11"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            required
            {...invalid}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw">Пароль</Label>
          <PasswordInput
            id="pw"
            autoComplete="current-password"
            minLength={6}
            className="h-11"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            required
            {...invalid}
          />
        </div>

        {error && (
          <div
            id={ERROR_ID}
            role="alert"
            className="animate-fade-in flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="min-w-0 text-callout text-foreground">{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 aria-hidden className="animate-spin" />}
          {busy ? "Входим…" : "Войти"}
        </Button>
      </form>

      <p
        className="luno-rise mt-8 flex items-start gap-2.5 text-callout text-muted-foreground"
        style={riseDelay(320)}
      >
        <ShieldCheck aria-hidden className="mt-px h-4 w-4 shrink-0" />
        Учётные записи выдаёт владелец LUNO&nbsp;DIGITAL
      </p>
    </AuthLayout>
  );
}
