import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, CheckCircle2, Inbox, ShieldQuestion, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getMyNotifications, markAllNotificationsRead, markNotificationsRead, type AppNotification } from "@/lib/notifications.functions";

// Real notifications of the current user, read through get_my_notifications().
// Polling + invalidation keep it fresh; see NOTIFICATIONS_REFRESH_MS.
export const NOTIFICATIONS_QUERY_KEY = ["nexa", "notifications"] as const;
export const NOTIFICATIONS_REFRESH_MS = 60_000;

export function useMyNotifications(enabled = true) {
  const load = useServerFn(getMyNotifications);
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => load(),
    enabled,
    retry: false,
    refetchInterval: NOTIFICATIONS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Only the types the backend actually creates; anything else gets a neutral look. */
const TYPE_META: Record<string, { icon: typeof Bell; label: string; tone: string }> = {
  access_request: { icon: ShieldQuestion, label: "Заявка на доступ", tone: "text-primary" },
  access_request_approved: { icon: CheckCircle2, label: "Доступ предоставлен", tone: "text-emerald-400" },
  access_request_rejected: { icon: XCircle, label: "Заявка отклонена", tone: "text-muted-foreground" },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, label: "Уведомление", tone: "text-muted-foreground" };
}

function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function timeLabel(value: string) {
  const date = new Date(value);
  return isToday(value)
    ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function NotificationRow({ item, onOpen }: { item: AppNotification; onOpen: (item: AppNotification) => void }) {
  const meta = typeMeta(item.type);
  const unread = !item.read_at;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`group relative flex w-full items-start gap-3.5 rounded-md px-4 py-3.5 text-left transition-colors duration-200 hover:bg-secondary/40 ${unread ? "bg-secondary/25" : ""}`}
    >
      {unread && <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" />}
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 ${meta.tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={`truncate text-sm ${unread ? "font-semibold" : "font-medium text-foreground/85"}`}>{item.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{timeLabel(item.created_at)}</span>
        </span>
        {item.body && <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.body}</span>}
        <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{meta.label}</span>
          {unread && <><span aria-hidden>·</span><span className="text-primary">Не прочитано</span></>}
          {item.access_request_id && <><span aria-hidden>·</span><span className="transition-colors group-hover:text-foreground">Открыть заявку</span></>}
        </span>
      </span>
    </button>
  );
}

/**
 * Notification feed. Opening an item marks it read; items linked to an access
 * request call onOpenAccessRequest so the screen can show that request.
 */
export function NotificationsCenter({ onOpenAccessRequest }: { onOpenAccessRequest: (requestId: string) => void }) {
  const notifications = useMyNotifications();
  const queryClient = useQueryClient();
  const markRead = useServerFn(markNotificationsRead);
  const markAll = useServerFn(markAllNotificationsRead);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
  const markOne = useMutation({ mutationFn: (id: string) => markRead({ data: { ids: [id] } }), onSuccess: invalidate });
  const markEverything = useMutation({
    mutationFn: () => markAll(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const items = notifications.data ?? [];
  const unreadCount = items.filter((item) => !item.read_at).length;
  const groups = useMemo(() => {
    const visible = items.filter((item) => filter === "all" || !item.read_at);
    return [
      { title: "Сегодня", items: visible.filter((item) => isToday(item.created_at)) },
      { title: "Ранее", items: visible.filter((item) => !isToday(item.created_at)) },
    ].filter((group) => group.items.length > 0);
  }, [items, filter]);

  const open = (item: AppNotification) => {
    if (!item.read_at) markOne.mutate(item.id);
    if (item.access_request_id) onOpenAccessRequest(item.access_request_id);
  };

  return (
    <section aria-label="Лента уведомлений">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-9 items-center rounded-md border border-border bg-card/60 p-0.5" role="group" aria-label="Фильтр уведомлений">
          {([["all", "Все"], ["unread", "Непрочитанные"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`inline-flex h-full items-center gap-1.5 rounded px-3 text-sm transition-colors ${filter === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
              {id === "unread" && unreadCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary">{unreadCount}</span>}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <Button type="button" variant="ghost" size="sm" disabled={markEverything.isPending} onClick={() => markEverything.mutate()} className="text-muted-foreground">
            <CheckCheck />
            Отметить все прочитанными
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-1.5">
        {notifications.isLoading && <p className="px-4 py-6 text-sm text-muted-foreground">Загрузка уведомлений…</p>}
        {notifications.error && (
          <p role="alert" className="px-4 py-6 text-sm text-muted-foreground">Не удалось загрузить уведомления: {(notifications.error as Error).message}</p>
        )}
        {!notifications.isLoading && !notifications.error && groups.length === 0 && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Пока ничего нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "unread" && items.length > 0 ? "Все уведомления прочитаны." : "Здесь появятся события, которые требуют вашего внимания."}
            </p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.title} className="py-1">
            <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.title}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => <NotificationRow key={item.id} item={item} onOpen={open} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
