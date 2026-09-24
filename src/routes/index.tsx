import { createFileRoute, Navigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AtSign,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  Mail,
  LogOut,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TaskWorkspace } from "@/components/nexa/TaskWorkspace";
import { AdminPanel } from "@/components/nexa/AdminPanel";
import { getAdminAccess } from "@/lib/admin.functions";
import { getMyCorporateMailbox } from "@/lib/admin.functions";
import { getCurrentProfile } from "@/lib/profile.functions";
import { ensureProfile } from "@/lib/tasks.functions";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEXA Helpdesk — Obsidian Flow" },
      {
        name: "description",
        content:
          "Интерактивный прототип интерфейса NEXA Helpdesk в строгом graphite/orange стиле: обзор, заявки, клиенты, база знаний и настройки.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "NEXA Helpdesk — Obsidian Flow" },
      {
        property: "og:description",
        content:
          "Прототип NEXA Helpdesk: графитовый фон, тёплый оранжевый акцент, живая верхняя навигация.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NexaPrototype,
});

type ScreenId = "overview" | "tickets" | "clients" | "knowledge" | "settings" | "profile";

type EmployeeProfileData = {
  initials: string;
  id: string;
  full_name: string;
  position: string | null;
  department: string | null;
  avatar_url: string | null;
  presence: string;
  created_at: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  access_level: number | null;
  private_fields_allowed: boolean;
};

function getInitials(fullName: string) {
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU") || "NX";
}

async function signOutCurrentUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "tickets", label: "Заявки" },
  { id: "clients", label: "Клиенты" },
  { id: "knowledge", label: "База знаний" },
  { id: "settings", label: "Настройки" },
  { id: "profile", label: "Профиль" },
];

const TICKETS = [
  { id: "NX-1042", title: "Не синхронизируется почтовый ящик", client: "ООО «Вектор»", priority: "Высокий", status: "В работе", agent: "А. Соколова", age: "12 мин" },
  { id: "NX-1041", title: "Ошибка 500 при экспорте отчёта", client: "АО «Меридиан»", priority: "Критический", status: "Новая", agent: "—", age: "26 мин" },
  { id: "NX-1038", title: "Добавить роль наблюдателя", client: "ИП Ким", priority: "Средний", status: "Ожидает", agent: "Д. Орлов", age: "1 ч" },
  { id: "NX-1035", title: "Сброс двухфакторной аутентификации", client: "ООО «Север»", priority: "Низкий", status: "Решена", agent: "М. Литвин", age: "3 ч" },
  { id: "NX-1031", title: "Медленная загрузка портала", client: "АО «Меридиан»", priority: "Высокий", status: "В работе", agent: "А. Соколова", age: "5 ч" },
];

const CLIENTS = [
  { name: "АО «Меридиан»", plan: "Enterprise", open: 6, sla: "99.9%" },
  { name: "ООО «Вектор»", plan: "Business", open: 3, sla: "99.5%" },
  { name: "ООО «Север»", plan: "Business", open: 1, sla: "99.8%" },
  { name: "ИП Ким", plan: "Starter", open: 2, sla: "98.9%" },
];

const ARTICLES = [
  { title: "Подключение почтового канала", views: 1284, updated: "2 дня назад" },
  { title: "Настройка SLA-политик", views: 961, updated: "5 дней назад" },
  { title: "Роли и права доступа", views: 847, updated: "1 неделю назад" },
  { title: "Экспорт отчётов в CSV", views: 402, updated: "2 недели назад" },
];

function statusClass(status: string) {
  switch (status) {
    case "Новая":
      return "bg-primary/15 text-primary";
    case "В работе":
      return "bg-secondary text-secondary-foreground";
    case "Ожидает":
      return "bg-secondary text-muted-foreground";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function priorityClass(p: string) {
  if (p === "Критический") return "text-destructive";
  if (p === "Высокий") return "text-primary";
  return "text-muted-foreground";
}

function NexaPrototype() {
  const [active, setActive] = useState<ScreenId>("overview");
  const [adminOpen, setAdminOpen] = useState(false);
  const [canOpenAdmin, setCanOpenAdmin] = useState(false);
  const [workspaceAccessSession, setWorkspaceAccessSession] = useState<Session | null>(null);
  const [blockedSession, setBlockedSession] = useState<Session | null>(null);
  const [currentProfile, setCurrentProfile] = useState<EmployeeProfileData | null>(null);
  const checkAdmin = useServerFn(getAdminAccess);
  const ensure = useServerFn(ensureProfile);
  const loadCurrentProfile = useServerFn(getCurrentProfile);
  const { session, loading } = useAuth();
  const navRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    let live = true;
    setCanOpenAdmin(false);
    if (session) {
      ensure({ data: {} })
        .then(() => loadCurrentProfile())
        .then((profile) => {
          if (!live) return;
          if (profile.id !== session.user.id) throw new Error("Профиль не соответствует текущей сессии");
          setCurrentProfile({ ...profile, initials: getInitials(profile.full_name) });
          setWorkspaceAccessSession(session);
          setBlockedSession(null);
          void checkAdmin()
            .then((result) => { if (live) setCanOpenAdmin(result.allowed); })
            .catch(() => { if (live) setCanOpenAdmin(false); });
        })
        .catch(() => {
          if (!live) return;
          setCurrentProfile(null);
          setWorkspaceAccessSession(session);
          setBlockedSession(session);
        });
    }
    return () => { live = false; };
  }, [session, ensure, checkAdmin]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const updateIndicator = () => {
      const btn = nav.querySelector<HTMLButtonElement>(`[data-screen="${active}"]`);
      if (!btn) return;
      const navRect = nav.getBoundingClientRect();
      const buttonRect = btn.getBoundingClientRect();
      setIndicator({ left: buttonRect.left - navRect.left, width: buttonRect.width });
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active]);

  if (loading || session && workspaceAccessSession !== session) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Проверяем сессию…
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" />;
  if (blockedSession === session) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div role="alert" className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="font-semibold">Доступ к NEXA закрыт</h1>
          <p className="mt-2 text-sm text-muted-foreground">Учётная запись отключена или не удалось подтвердить доступ. Обратитесь к администратору.</p>
          <Button variant="outline" className="mt-4" onClick={() => void signOutCurrentUser().catch((error: Error) => toast.error(error.message))}>
            <LogOut />
            Выйти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3 xl:gap-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              N
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">NEXA</div>
              <div className="text-[11px] text-muted-foreground">Helpdesk · Obsidian Flow</div>
            </div>
          </div>

          {/* Nav with sliding indicator */}
          <nav ref={navRef} className="relative flex min-w-0 items-center gap-0.5 xl:gap-1">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                data-screen={s.id}
                 type="button"
                onClick={() => setActive(s.id)}
                 aria-current={active === s.id ? "page" : undefined}
                className={`relative z-10 rounded-md px-2.5 py-2 text-sm transition-colors duration-200 active:scale-[0.97] xl:px-3.5 ${
                  active === s.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
            <span
              aria-hidden
              className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {canOpenAdmin && <button type="button" onClick={() => setAdminOpen((open) => !open)} className={`rounded-md border px-3 py-1.5 text-sm ${adminOpen ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Администрирование</button>}
            <button className="hidden rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground lg:block">
              Поиск
            </button>
            <button className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              + Заявка
            </button>
            <button
              type="button"
              aria-label="Открыть профиль сотрудника"
              onClick={() => setActive("profile")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold transition-all duration-200 hover:bg-primary hover:text-primary-foreground active:scale-95"
            >
              {currentProfile?.initials ?? "NX"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {adminOpen ? <AdminPanel /> : active === "overview" && <Overview go={setActive} />}
        {!adminOpen && active === "tickets" && <Tickets />}
        {!adminOpen && active === "clients" && <Clients />}
        {!adminOpen && active === "knowledge" && <Knowledge />}
        {!adminOpen && active === "settings" && <Settings />}
        {!adminOpen && active === "profile" && currentProfile && <EmployeeProfile employee={currentProfile} />}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-muted-foreground">
          <span>NEXA Helpdesk — визуальный прототип</span>
          <span>Obsidian Flow · v0.2</span>
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

function Overview({ go }: { go: (s: ScreenId) => void }) {
  const stats = [
    { label: "Открытые заявки", value: "24", delta: "+3 за сутки" },
    { label: "Среднее время ответа", value: "7 мин", delta: "−12% к неделе" },
    { label: "SLA соблюдение", value: "99.4%", delta: "стабильно" },
    { label: "CSAT", value: "4.8", delta: "+0.2" },
  ];
  return (
    <div>
      <SectionTitle title="Обзор" sub="Ключевые метрики службы поддержки за сегодня" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold">{s.value}</div>
            <div className="mt-1 text-xs text-primary">{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Последние заявки</h2>
            <button onClick={() => go("tickets")} className="text-xs text-primary hover:underline">
              Все заявки →
            </button>
          </div>
          <div className="divide-y divide-border">
            {TICKETS.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-20 font-mono text-xs text-muted-foreground">{t.id}</span>
                <span className="flex-1 truncate">{t.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(t.status)}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Нагрузка команды</h2>
          {[
            { name: "А. Соколова", load: 82 },
            { name: "Д. Орлов", load: 64 },
            { name: "М. Литвин", load: 41 },
          ].map((a) => (
            <div key={a.name} className="mb-3">
              <div className="mb-1 flex justify-between text-xs">
                <span>{a.name}</span>
                <span className="text-muted-foreground">{a.load}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${a.load}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tickets() {
  return (
    <div className="animate-fade-in">
      <TaskWorkspace />
    </div>
  );
}

function Clients() {
  return (
    <div>
      <SectionTitle title="Клиенты" sub="Аккаунты, тарифы и открытые обращения" />
      <div className="grid gap-4 sm:grid-cols-2">
        {CLIENTS.map((c) => (
          <div key={c.name} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{c.name}</h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{c.plan}</span>
            </div>
            <div className="mt-4 flex gap-6 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Открытые заявки</div>
                <div className="mt-0.5 text-lg font-semibold text-primary">{c.open}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SLA</div>
                <div className="mt-0.5 text-lg font-semibold">{c.sla}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Knowledge() {
  return (
    <div>
      <SectionTitle title="База знаний" sub="Статьи для клиентов и агентов" />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {ARTICLES.map((a) => (
          <div key={a.title} className="flex items-center gap-4 px-5 py-4 hover:bg-secondary/50">
            <div className="flex-1">
              <div className="text-sm font-medium">{a.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Обновлено: {a.updated}</div>
            </div>
            <div className="text-xs text-muted-foreground">{a.views} просмотров</div>
            <button className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
              Открыть
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const [email, setEmail] = useState(true);
  const [slack, setSlack] = useState(false);
  const [auto, setAuto] = useState(true);
  const rows = [
    { label: "Email-уведомления", desc: "Отправлять клиентам статусы заявок", value: email, set: setEmail },
    { label: "Slack-интеграция", desc: "Дублировать критические заявки в канал", value: slack, set: setSlack },
    { label: "Автоназначение", desc: "Распределять новые заявки по нагрузке", value: auto, set: setAuto },
  ];
  return (
    <div>
      <SectionTitle title="Настройки" sub="Каналы и автоматизация рабочего пространства" />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-sm font-medium">{r.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{r.desc}</div>
            </div>
            <button
              onClick={() => r.set(!r.value)}
              aria-pressed={r.value}
              className={`relative h-6 w-11 rounded-full transition-colors ${r.value ? "bg-primary" : "bg-secondary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-all ${
                  r.value ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeProfile({ employee }: { employee: EmployeeProfileData }) {
  const [contactCopied, setContactCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const getMailbox = useServerFn(getMyCorporateMailbox);
  const [mailbox, setMailbox] = useState<{ email: string; status: string; provider: string | null; created_at: string } | null>(null);

  useEffect(() => {
    getMailbox().then((value) => setMailbox(value)).catch(() => setMailbox(null));
  }, [getMailbox]);

  const copyContact = async () => {
    if (!employee.email) return;
    await navigator.clipboard?.writeText(employee.email);
    setContactCopied(true);
    window.setTimeout(() => setContactCopied(false), 1400);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentUser();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSigningOut(false);
    }
  };

  const presenceLabel: Record<string, string> = {
    online: "На связи",
    away: "Отошёл",
    offline: "Не в сети",
  };
  const joinedAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : "Не указана";

  return (
    <div className="animate-fade-in">
      <section className="border-b border-border pb-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="flex min-w-0 items-center gap-5">
            <Avatar className="h-20 w-20 rounded-lg border border-border bg-secondary shadow-sm sm:h-24 sm:w-24">
              {employee.avatar_url && <AvatarImage src={employee.avatar_url} alt={employee.full_name} />}
              <AvatarFallback className="rounded-lg bg-secondary text-2xl font-semibold text-primary">
                {employee.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {presenceLabel[employee.presence] ?? (employee.presence || "Статус не указан")}
                </span>
              </div>
              <h1 className="text-2xl font-semibold sm:text-3xl">{employee.full_name}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
                {employee.position || "Должность не указана"} · {employee.department || "Отдел не указан"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={copyContact} disabled={!employee.email} className="active:scale-[0.98]">
              {contactCopied ? <Check /> : <AtSign />}
              {contactCopied ? "Контакт скопирован" : "Скопировать email"}
            </Button>
            <Button className="active:scale-[0.98]">
              <MessageSquare />
              Написать
            </Button>
            <Button variant="outline" onClick={() => void signOut()} disabled={signingOut} className="active:scale-[0.98]">
              <LogOut />
              {signingOut ? "Выходим…" : "Выйти"}
            </Button>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочие показатели</h2>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card xl:grid-cols-4">
              {[
                { value: "—", label: "Активных задач", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Решено за месяц", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Средний ответ", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Оценка клиентов", note: "Статистика профиля пока не подключена" },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className={`p-4 transition-colors duration-200 hover:bg-secondary/40 ${
                    index % 2 ? "border-l border-border" : ""
                  } ${index > 1 ? "border-t border-border xl:border-t-0" : ""} ${
                    index > 0 ? "xl:border-l xl:border-border" : ""
                  }`}
                >
                  <div className="text-2xl font-semibold">{item.value}</div>
                  <div className="mt-1 text-xs font-medium">{item.label}</div>
                  <div className="mt-2 text-[11px] text-muted-foreground">{item.note}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Текущая активность</h2>
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Данные активности для профиля пока не подключены.
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочая нагрузка</h2>
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-2xl font-semibold">—</div>
                  <p className="mt-1 text-xs text-muted-foreground">Расчёт нагрузки по задачам пока не подключён.</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium">Корпоративная почта</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              {mailbox ? <>
                <div className="break-all text-sm font-medium">{mailbox.email}</div>
                <div className="mt-2 text-xs text-muted-foreground">Статус: {{ pending: "Не подключена", active: "Активна", suspended: "Приостановлена", disabled: "Отключена", error: "Ошибка" }[mailbox.status] ?? mailbox.status}</div>
                <div className="mt-1 text-xs text-muted-foreground">Провайдер: {mailbox.provider ?? "Не настроен"}</div>
                {mailbox.status === "pending" && <p className="mt-2 text-xs text-muted-foreground">Адрес зарезервирован в NEXA. Реальный почтовый ящик пока не создан.</p>}
              </> : <p className="text-xs text-muted-foreground">Корпоративный адрес пока не назначен.</p>}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-medium">Контакты</h2>
            <div className="space-y-1 rounded-lg border border-border bg-card p-3">
              {[
                { icon: Mail, label: "Почта", value: employee.private_fields_allowed ? employee.email || "Не указана" : "Недоступна по RBAC" },
                ...(employee.private_fields_allowed ? [
                  { icon: Phone, label: "Телефон", value: employee.phone || "Не указан" },
                  { icon: MapPin, label: "Локация", value: employee.location || "Не указана" },
                ] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-3 rounded-md p-2 transition-colors hover:bg-secondary/45">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 break-words text-xs">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочая информация</h2>
            <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
              {[
                { icon: BriefcaseBusiness, label: "Должность", value: employee.position || "Не указана" },
                { icon: Building2, label: "Отдел", value: employee.department || "Не указан" },
                { icon: CalendarDays, label: "Профиль создан", value: joinedAt },
                ...(employee.private_fields_allowed ? [{ icon: ShieldCheck, label: "Уровень доступа", value: employee.access_level ? `Уровень ${employee.access_level}` : "Не указан" }] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-3 py-3.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 text-xs font-medium">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
