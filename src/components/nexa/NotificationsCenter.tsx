import { useState } from "react";
import {
  ArrowRight, Bell, CheckCheck, CircleAlert, Clock3, CornerDownRight,
  MessageCircle, ShieldAlert, UserPlus, AtSign, RefreshCw, Inbox, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type NotificationKind = "assigned" | "reply" | "status" | "added" | "mention" | "overdue" | "action" | "access";
type NotificationItem = {
  id: number;
  kind: NotificationKind;
  title: string;
  description: string;
  time: string;
  group: "Сегодня" | "Вчера" | "Ранее";
  object: string;
  objectTitle: string;
  objectType: string;
  unread: boolean;
};

const initialNotifications: NotificationItem[] = [
  { id: 1, kind: "assigned", title: "Заявка назначена вам", description: "Алексей Морозов назначил вас исполнителем обращения.", time: "5 мин", group: "Сегодня", object: "NX-1042", objectTitle: "Не синхронизируется почтовый ящик", objectType: "Заявка", unread: true },
  { id: 2, kind: "reply", title: "Новый ответ от клиента", description: "ООО «Вектор» добавил детали по подключению почты.", time: "18 мин", group: "Сегодня", object: "NX-1042", objectTitle: "Не синхронизируется почтовый ящик", objectType: "Заявка", unread: true },
  { id: 3, kind: "action", title: "Требуется ваше действие", description: "Проверьте приложенные файлы и ответьте клиенту.", time: "42 мин", group: "Сегодня", object: "NX-1041", objectTitle: "Ошибка 500 при экспорте отчёта", objectType: "Заявка", unread: true },
  { id: 4, kind: "mention", title: "Вас упомянули в обсуждении", description: "Дмитрий Орлов отметил вас в комментарии.", time: "1 ч", group: "Сегодня", object: "NX-1038", objectTitle: "Добавить роль наблюдателя", objectType: "Заявка", unread: true },
  { id: 5, kind: "overdue", title: "Срок ответа истёк", description: "Обращение ожидает ответа после срока SLA.", time: "2 ч", group: "Сегодня", object: "NX-1031", objectTitle: "Медленная загрузка портала", objectType: "Заявка", unread: true },
  { id: 6, kind: "status", title: "Статус заявки изменён", description: "Обращение переведено в работу.", time: "4 ч", group: "Сегодня", object: "NX-1031", objectTitle: "Медленная загрузка портала", objectType: "Заявка", unread: false },
  { id: 7, kind: "added", title: "Вас добавили в заявку", description: "Вы теперь участвуете в обсуждении обращения.", time: "Вчера, 17:30", group: "Вчера", object: "NX-1035", objectTitle: "Сброс двухфакторной аутентификации", objectType: "Заявка", unread: false },
  { id: 8, kind: "access", title: "Запрос повышения доступа", description: "Получен запрос на расширение уровня доступа для ИП Ким.", time: "Вчера, 14:12", group: "Вчера", object: "Запрос · ИП Ким", objectTitle: "Повышение уровня доступа", objectType: "Запрос доступа", unread: false },
  { id: 9, kind: "reply", title: "Новый ответ от клиента", description: "АО «Меридиан» уточнил детали обращения.", time: "Пн, 11:24", group: "Ранее", object: "NX-1031", objectTitle: "Медленная загрузка портала", objectType: "Заявка", unread: false },
  { id: 10, kind: "status", title: "Статус заявки изменён", description: "Обращение закрыто после решения вопроса.", time: "Пн, 09:05", group: "Ранее", object: "NX-1035", objectTitle: "Сброс двухфакторной аутентификации", objectType: "Заявка", unread: false },
];

const eventIcons = {
  assigned: UserPlus, reply: MessageCircle, status: RefreshCw, added: UserPlus,
  mention: AtSign, overdue: Clock3, action: CircleAlert, access: ShieldAlert,
};

export function useNotifications() {
  const [items, setItems] = useState(initialNotifications);
  const unreadCount = items.filter((item) => item.unread).length;
  const markAllRead = () => setItems((current) => current.map((item) => ({ ...item, unread: false })));
  const markRead = (id: number) => setItems((current) => current.map((item) => item.id === id ? { ...item, unread: false } : item));
  const clear = () => setItems([]);
  return { items, unreadCount, markAllRead, markRead, clear };
}

type NotificationsState = ReturnType<typeof useNotifications>;

export function NotificationsCenter({ state, onOpenTickets }: { state: NotificationsState; onOpenTickets: () => void }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const selected = state.items.find((item) => item.id === selectedId);
  const filtered = state.items.filter((item) => filter === "all" || item.unread);
  const visible = showAll ? filtered : filtered.slice(0, 6);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Bell className="size-3.5" /> РАБОЧЕЕ ПРОСТРАНСТВО / ВХОДЯЩИЕ</div>
          <h1 className="text-2xl font-semibold">Уведомления</h1>
          <p className="mt-1 text-sm text-muted-foreground">События по вашим обращениям и запросам</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={state.markAllRead} disabled={!state.unreadCount} className="border-border bg-card hover:bg-secondary hover:text-foreground active:scale-[0.98]">
            <CheckCheck /> Отметить всё прочитанным
          </Button>
          <Button variant="ghost" size="icon" title="Очистить ленту" aria-label="Очистить ленту" disabled={!state.items.length} onClick={() => { state.clear(); setSelectedId(null); }} className="text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95"><Trash2 /></Button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="mb-5 flex items-center justify-between border-b border-border">
            <div className="flex gap-6">
              {(["all", "unread"] as const).map((tab) => (
                <Button key={tab} variant="ghost" size="sm" onClick={() => setFilter(tab)} aria-pressed={filter === tab}
                  className={`relative h-10 rounded-none px-0 hover:bg-transparent ${filter === tab ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {tab === "all" ? "Все" : "Непрочитанные"}
                  {tab === "unread" && state.unreadCount > 0 && <span className="rounded-full bg-secondary px-1.5 text-[11px] text-secondary-foreground">{state.unreadCount}</span>}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "событие" : "событий"}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center border-b border-border text-center">
              <Inbox className="mb-4 size-8 text-muted-foreground" strokeWidth={1.3} />
              <h2 className="text-sm font-medium">{state.items.length ? "Всё прочитано" : "Уведомлений пока нет"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{state.items.length ? "Новых событий нет." : "Новые события появятся здесь."}</p>
              {state.items.length > 0 && <Button variant="link" size="sm" onClick={() => setFilter("all")} className="mt-2">Посмотреть все</Button>}
            </div>
          ) : (
            <div className="space-y-6">
              {(["Сегодня", "Вчера", "Ранее"] as const).map((group) => {
                const groupItems = visible.filter((item) => item.group === group);
                if (!groupItems.length) return null;
                return <section key={group}>
                  <h2 className="mb-2 text-xs font-medium text-muted-foreground">{group}</h2>
                  <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
                    {groupItems.map((item) => {
                      const Icon = eventIcons[item.kind];
                      return <Button key={item.id} variant="ghost" onClick={() => { state.markRead(item.id); setSelectedId(item.id); }} aria-current={selectedId === item.id ? "true" : undefined}
                        className={`group flex h-auto w-full min-w-0 items-start gap-3 rounded-none px-4 py-4 text-left whitespace-normal transition-all duration-200 hover:bg-secondary/60 hover:text-foreground active:scale-[0.995] sm:gap-4 sm:px-5 ${item.unread ? "bg-secondary/35" : "bg-card"} ${selectedId === item.id ? "bg-secondary/60" : ""}`}>
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-md border ${item.unread ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-secondary/50 text-muted-foreground"}`}><Icon className="size-4" strokeWidth={1.8} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className={`text-sm ${item.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}>{item.title}</span>
                            <span className="shrink-0 text-xs font-normal text-muted-foreground">{item.time}</span>
                          </span>
                          <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">{item.description}</span>
                          <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 text-xs font-normal text-muted-foreground"><CornerDownRight className="size-3 shrink-0" /><span className="shrink-0 font-mono text-primary">{item.object}</span><span className="truncate">· {item.objectTitle}</span></span>
                        </span>
                        <span className="mt-1 flex size-2 shrink-0 items-center justify-center">{item.unread && <span className="size-1.5 rounded-full bg-primary" />}</span>
                      </Button>;
                    })}
                  </div>
                </section>;
              })}
              {filtered.length > visible.length && <Button variant="outline" className="w-full border-border bg-card hover:bg-secondary hover:text-foreground active:scale-[0.98]" onClick={() => setShowAll(true)}>Показать ещё · {filtered.length - visible.length}</Button>}
            </div>
          )}
        </div>

        <aside className="lg:border-l lg:border-border lg:pl-6">
          <div className="lg:sticky lg:top-24">
            {selected ? <div className="animate-fade-in">
              <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground"><CornerDownRight className="size-3.5" /> СВЯЗАННЫЙ ОБЪЕКТ</div>
              <div className="border-t border-primary/60 pt-4">
                <div className="text-xs text-muted-foreground">{selected.objectType} · демонстрация</div>
                <div className="mt-2 font-mono text-xs text-primary">{selected.object}</div>
                <h2 className="mt-2 text-base font-medium leading-snug">{selected.objectTitle}</h2>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{selected.description}</p>
                {selected.objectType === "Заявка" && <Button variant="link" size="sm" onClick={onOpenTickets} className="mt-5 px-0 text-primary hover:text-primary/80">Перейти к заявкам <ArrowRight className="size-3.5" /></Button>}
              </div>
            </div> : <div className="border-t border-border pt-4">
              <div className="text-xs font-medium text-muted-foreground">АКТИВНОСТЬ</div>
              <div className="mt-5 text-3xl font-semibold">{state.unreadCount.toString().padStart(2, "0")}</div>
              <p className="mt-1 text-xs text-muted-foreground">Непрочитанных событий</p>
              <div className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Выберите событие в ленте, чтобы увидеть связанную заявку или запрос.</div>
            </div>}
          </div>
        </aside>
      </div>
    </div>
  );
}