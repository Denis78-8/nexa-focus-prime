import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthBackground } from "@/components/nexa/AuthBackground";
import { BrandLogo } from "@/components/nexa/BrandLogo";

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

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    console.info("AUTH DEBUG: submit start");
    setBusy(true);
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
    <div className="dark relative flex min-h-dvh items-center justify-center px-6 text-foreground">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-card/95 p-6 shadow-[0_24px_80px_-24px_oklch(0_0_0/0.7)]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandLogo height={64} />
          <div className="text-xs text-muted-foreground">Вход в рабочее пространство</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="em">Email</Label>
            <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Пароль</Label>
            <Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full active:scale-[0.98]" disabled={busy}>
            {busy ? "Подождите…" : "Войти"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">Учётные записи выдаёт владелец LUNO DIGITAL</p>
      </div>
    </div>
  );
}
