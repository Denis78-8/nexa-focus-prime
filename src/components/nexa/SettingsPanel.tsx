import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/nexa/PasswordInput";
import {
  AccessLevelValue,
  ActiveValue,
  ROLE_LABEL,
  VipBadge,
} from "@/components/nexa/profile-display";
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, passwordMeetsPolicy } from "@/lib/password-policy";
import { readUiPreferences, saveUiPreferences, type UiPreferences } from "@/lib/ui-preferences";
import { ENTER } from "@/lib/motion";

type SettingsProfile = {
  role: string | null;
  access_level: number | null;
  is_active: boolean;
  is_vip: boolean | null;
};

/** One settings group: a titled card of rows, like System Settings. */
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-center gap-3 px-1">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/70 text-foreground-secondary"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-title-3">{title}</h2>
          {description && <p className="text-callout text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="min-w-0 divide-y divide-border rounded-card border border-border bg-card px-5">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1 basis-48">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer text-body text-foreground">
            {label}
          </label>
        ) : (
          <div className="text-body text-foreground">{label}</div>
        )}
        {hint && <div className="mt-0.5 text-callout text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 max-w-full break-words text-right text-body">{children}</div>
    </div>
  );
}

function formatDate(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** A password rule that lights up when met. */
function Rule({ met, label }: { met: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-2 transition-colors duration-200 ${met ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-[background-color,scale] duration-300 ease-(--ease-spring) ${met ? "scale-100 bg-success text-background" : "scale-90 bg-secondary"}`}
      >
        {met && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
      </span>
      {label}
      <span className="sr-only">{met ? " — выполнено" : " — не выполнено"}</span>
    </li>
  );
}

/** Changes the signed-in user's own password through Supabase Auth. */
function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = passwordMeetsPolicy(password) && password === confirm;

  const reset = () => {
    setPassword("");
    setConfirm("");
  };
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
    <div className="py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-body text-foreground">Пароль</div>
          <div className="mt-0.5 text-callout text-muted-foreground">
            Не короче 12 символов, буквы разного регистра, цифра и спецсимвол
          </div>
        </div>
        <Button
          type="button"
          variant={open ? "ghost" : "outline"}
          size="sm"
          className="rounded-full px-3.5"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            reset();
          }}
        >
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
            transition={ENTER}
            className="overflow-hidden"
          >
            <div className="mt-4 grid gap-2 p-px sm:grid-cols-2">
              <PasswordInput
                id="settings-new-password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX_LENGTH}
                placeholder="Новый пароль"
                aria-label="Новый пароль"
                className="h-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordInput
                id="settings-confirm-password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX_LENGTH}
                placeholder="Подтверждение"
                aria-label="Подтверждение пароля"
                className="h-10"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <ul className="mt-3 grid gap-1.5 text-callout sm:grid-cols-2">
              {PASSWORD_RULES.map((rule) => (
                <Rule key={rule.label} met={rule.test(password)} label={rule.label} />
              ))}
              <Rule met={Boolean(confirm) && password === confirm} label="Пароли совпадают" />
            </ul>
            <div className="mt-4 flex justify-end pb-1">
              <Button
                type="submit"
                size="sm"
                className="rounded-full px-4"
                disabled={!valid || saving}
              >
                {saving ? "Сохраняем…" : "Сохранить пароль"}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SettingsPanel({
  profile,
  unreadNotifications,
  onOpenNotifications,
}: {
  profile: SettingsProfile;
  unreadNotifications: number;
  onOpenNotifications: () => void;
}) {
  const { session } = useAuth();
  const [preferences, setPreferences] = useState<UiPreferences>({
    animations: true,
    compact: false,
  });
  const [signingOut, setSigningOut] = useState(false);

  // Preferences live in this browser; read them after mount to avoid SSR mismatch.
  useEffect(() => {
    setPreferences(readUiPreferences());
  }, []);
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
    <div>
      <div className="mb-8">
        <h1 className="text-title-1">Настройки</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Интерфейс, безопасность и параметры вашей учётной записи
        </p>
      </div>

      <div className="max-w-3xl space-y-8">
        <Section
          icon={MonitorSmartphone}
          title="Интерфейс"
          description="Сохраняется в этом браузере."
        >
          <Row
            label="Анимации интерфейса"
            hint="Плавные переходы и движение фона"
            htmlFor="setting-animations"
          >
            <Switch
              id="setting-animations"
              checked={preferences.animations}
              onCheckedChange={(value) => update({ animations: value })}
            />
          </Row>
          <Row
            label="Компактный режим"
            hint="Меньше отступов, больше информации на экране"
            htmlFor="setting-compact"
          >
            <Switch
              id="setting-compact"
              checked={preferences.compact}
              onCheckedChange={(value) => update({ compact: value })}
            />
          </Row>
        </Section>

        <Section
          icon={Bell}
          title="Уведомления"
          description="Приходят в центр уведомлений LUNO DIGITAL. Других каналов доставки сейчас нет."
        >
          <Row label="Центр уведомлений" hint="Заявки на доступ и решения по ним">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full pl-3.5 pr-2.5"
              onClick={onOpenNotifications}
            >
              Открыть
              {unreadNotifications > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-badge leading-[1.125rem] text-primary-foreground">
                  {unreadNotifications}
                </span>
              )}
              <ChevronRight className="text-muted-foreground" />
            </Button>
          </Row>
        </Section>

        <Section icon={ShieldCheck} title="Безопасность">
          <PasswordChange />
          <Row label="Учётная запись">
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {session?.user.email ?? "—"}
            </span>
          </Row>
          <Row label="Последний вход">
            <span className="text-muted-foreground">
              {formatDate(session?.user.last_sign_in_at)}
            </span>
          </Row>
          <Row label="Сессия действует до" hint="Продлевается автоматически, пока вы работаете">
            <span className="text-muted-foreground">{formatDate(session?.expires_at)}</span>
          </Row>
        </Section>

        <Section
          icon={UserRound}
          title="Рабочее пространство"
          description="Изменяется только администратором."
        >
          <Row label="Роль">
            <span>{profile.role ? (ROLE_LABEL[profile.role] ?? profile.role) : "—"}</span>
          </Row>
          <Row label="Уровень доступа">
            {profile.access_level !== null ? (
              <AccessLevelValue level={profile.access_level} />
            ) : (
              <span>—</span>
            )}
          </Row>
          <Row label="Статус аккаунта">
            <ActiveValue active={profile.is_active} />
          </Row>
          {profile.is_vip && (
            <Row label="VIP">
              <VipBadge />
            </Row>
          )}
        </Section>

        <div className="rounded-card border border-border bg-card p-1.5">
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void signOut()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-body font-medium text-destructive transition-[background-color,scale] duration-200 ease-(--ease-spring) hover:bg-destructive/10 active:scale-[0.99] disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Выходим…" : "Выйти из аккаунта"}
          </button>
        </div>
      </div>
    </div>
  );
}
