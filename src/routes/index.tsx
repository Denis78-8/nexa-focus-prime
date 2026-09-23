import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

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

type ScreenId = "overview" | "tickets" | "clients" | "knowledge" | "settings";

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "tickets", label: "Заявки" },
  { id: "clients", label: "Клиенты" },
  { id: "knowledge", label: "База знаний" },
  { id: "settings", label: "Настройки" },
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
  const navRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const btn = nav.querySelector<HTMLButtonElement>(`[data-screen="${active}"]`);
    if (btn) {
      setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  }, [active]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
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
          <nav ref={navRef} className="relative flex items-center gap-1">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                data-screen={s.id}
                onClick={() => setActive(s.id)}
                className={`relative z-10 rounded-md px-3.5 py-2 text-sm transition-colors ${
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
            <button className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Поиск
            </button>
            <button className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              + Заявка
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              ДМ
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {active === "overview" && <Overview go={setActive} />}
        {active === "tickets" && <Tickets />}
        {active === "clients" && <Clients />}
        {active === "knowledge" && <Knowledge />}
        {active === "settings" && <Settings />}
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
    <div>
      <SectionTitle title="Заявки" sub="Очередь обращений с приоритетами и статусами" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Тема</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Приоритет</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium">Агент</th>
              <th className="px-4 py-3 font-medium">Возраст</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {TICKETS.map((t) => (
              <tr key={t.id} className="hover:bg-secondary/50">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id}</td>
                <td className="px-4 py-3">{t.title}</td>
                <td className="px-4 py-3 text-muted-foreground">{t.client}</td>
                <td className={`px-4 py-3 text-xs font-medium ${priorityClass(t.priority)}`}>{t.priority}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(t.status)}`}>{t.status}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{t.agent}</td>
                <td className="px-4 py-3 text-muted-foreground">{t.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
