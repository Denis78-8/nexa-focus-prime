import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/components/nexa/profile-display";
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, passwordMeetsPolicy } from "@/lib/password-policy";
import { readUiPreferences, saveUiPreferences, type UiPreferences } from "@/lib/ui-preferences";

type SettingsProfile = { role: string | null; access_level: number | null; is_active: boolean; is_vip: boolean | null };

const EASE = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-4 border-t border-border py-7 first:border-t-0 first:pt-0 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0 divide-y divide-border/60">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 max-w-full break-words text-right text-sm">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`density-fixed relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200 ${checked ? "border-primary/60 bg-primary/80" : "border-border bg-secondary"}`}
    >
      <motion.span
        className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground"
        initial={false}
        animate={{ left: checked ? 18 : 2 }}
        transition={EASE}
      />
    </button>
  );
}

function formatDate(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Changes the signed-in user's own password through Supabase Auth. */
function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = passwordMeetsPolicy(password) && password === confirm;

  const reset = () => { setPassword(""); setConfirm(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Пароль изменён");
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить пароль");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-sm">Пароль</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Не короче 12 символов, буквы разного регистра, цифра и спецсимвол</div>
        </div>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => { setOpen((value) => !value); reset(); }}>
          <KeyRound />
          {open ? "Отмена" : "Сменить пароль"}
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.form
            key="password"
            onSubmit={submit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={EASE}
            className="overflow-hidden"
          >
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Input type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} placeholder="Новый пароль" aria-label="Новый пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Input type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} placeholder="Подтверждение" aria-label="Подтверждение пароля" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
              {PASSWORD_RULES.map((rule) => (
                <li key={rule.label} className={rule.test(password) ? "text-foreground" : "text-muted-foreground"}>{rule.test(password) ? "✓" : "·"} {rule.label}</li>
              ))}
              <li className={confirm && password === confirm ? "text-foreground" : "text-muted-foreground"}>{confirm && password === confirm ? "✓" : "·"} Пароли совпадают</li>
            </ul>
            <Button type="submit" size="sm" className="mt-4" disabled={!valid || saving}>{saving ? "Сохраняем…" : "Сохранить пароль"}</Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SettingsPanel({ profile, unreadNotifications, onOpenNotifications }: { profile: SettingsProfile; unreadNotifications: number; onOpenNotifications: () => void }) {
  const { session } = useAuth();
  const [preferences, setPreferences] = useState<UiPreferences>({ animations: true, compact: false });
  const [signingOut, setSigningOut] = useState(false);

  // Preferences live in this browser; read them after mount to avoid SSR mismatch.
  useEffect(() => { setPreferences(readUiPreferences()); }, []);
  const update = (patch: Partial<UiPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveUiPreferences(next);
  };

  const signOut = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      setSigningOut(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Интерфейс, безопасность и параметры вашей учётной записи</p>
      </div>

      <div className="min-w-0 rounded-xl border border-border bg-card px-5 py-7 sm:px-8">
        <Section title="Интерфейс" description="Сохраняется в этом браузере.">
          <Row label="Анимации интерфейса" hint="Плавные переходы и движение фона">
            <Switch label="Анимации интерфейса" checked={preferences.animations} onChange={(value) => update({ animations: value })} />
          </Row>
          <Row label="Компактный режим" hint="Меньше отступов, больше информации на экране">
            <Switch label="Компактный режим" checked={preferences.compact} onChange={(value) => update({ compact: value })} />
          </Row>
        </Section>

        <Section title="Уведомления" description="Уведомления приходят в центр уведомлений LUNO DIGITAL. Других каналов доставки сейчас нет.">
          <Row label="Центр уведомлений" hint="Заявки на доступ и решения по ним">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenNotifications}>
              Открыть{unreadNotifications > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{unreadNotifications}</span>}
            </Button>
          </Row>
        </Section>

        <Section title="Безопасность">
          <PasswordChange />
          <Row label="Учётная запись">
            <span className="text-muted-foreground">{session?.user.email ?? "—"}</span>
          </Row>
          <Row label="Последний вход">
            <span className="text-muted-foreground">{formatDate(session?.user.last_sign_in_at)}</span>
          </Row>
          <Row label="Сессия действует до" hint="Продлевается автоматически, пока вы работаете">
            <span className="text-muted-foreground">{formatDate(session?.expires_at)}</span>
          </Row>
        </Section>

        <Section title="Рабочее пространство" description="Изменяется только администратором.">
          <Row label="Роль">
            <span>{profile.role ? ROLE_LABEL[profile.role] ?? profile.role : "—"}</span>
          </Row>
          <Row label="Уровень доступа">
            <span>{profile.access_level !== null ? `Level ${profile.access_level}` : "—"}</span>
          </Row>
          <Row label="Статус аккаунта">
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${profile.is_active ? "bg-emerald-400" : "bg-destructive"}`} />
              {profile.is_active ? "Активен" : "Неактивен"}
            </span>
          </Row>
          {profile.is_vip && (
            <Row label="VIP">
              <span className="text-amber-200">✦ Да</span>
            </Row>
          )}
        </Section>

        <div className="flex justify-end border-t border-border pt-6">
          <Button type="button" variant="ghost" className="text-muted-foreground" disabled={signingOut} onClick={() => void signOut()}>
            <LogOut />
            {signingOut ? "Выходим…" : "Выйти"}
          </Button>
        </div>
      </div>
    </div>
  );
}
