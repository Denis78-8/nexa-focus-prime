import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Inbox,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/nexa/task-visuals";
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
  access_request: {
    icon: ShieldQuestion,
    label: "Заявка на доступ",
    tone: "border-primary/25 bg-primary-soft text-primary",
  },
  access_request_approved: {
    icon: CheckCircle2,
    label: "Доступ предоставлен",
    tone: "border-success/25 bg-success/10 text-success",
  },
  access_request_rejected: {
    icon: XCircle,
    label: "Заявка отклонена",
    tone: "border-border bg-secondary/70 text-muted-foreground",
  },
};

function typeMeta(type: string) {
  return (
    TYPE_META[type] ?? {
      icon: Bell,
      label: "Уведомление",
      tone: "border-border bg-secondary/70 text-muted-foreground",
    }
  );
}

function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function timeLabel(value: string) {
  const date = new Date(value);
  return isToday(value)
    ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function NotificationRow({ item, onOpen }: { item: AppNotification; onOpen: (item: AppNotification) => void }) {
  const meta = typeMeta(item.type);
  const unread = !item.read_at;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative flex w-full items-start gap-3.5 rounded-xl px-3.5 py-3.5 text-left transition-colors duration-200 hover:bg-white/[0.04]"
    >
      <span className="relative mt-0.5 shrink-0">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border ${meta.tone}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        {unread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card shadow-[0_0_8px_oklch(0.724_0.187_48.9/0.7)]"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={`min-w-0 truncate text-body ${unread ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-caption text-muted-foreground">
            {timeLabel(item.created_at)}
          </span>
        </span>
        {item.body && (
          <span className="mt-1 block text-callout text-muted-foreground">{item.body}</span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <span>{meta.label}</span>
          {unread && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-primary">Не прочитано</span>
            </>
          )}
          {item.access_request_id && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 transition-colors group-hover:text-foreground">
                Открыть заявку
                <ChevronRight className="h-3.5 w-3.5 transition-[translate] duration-200 group-hover:translate-x-0.5" />
              </span>
            </>
          )}
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
    <section aria-label="Лента уведомлений" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Фильтр уведомлений"
          pillId="notifications-filter-pill"
          value={filter}
          onChange={setFilter}
          options={[
            ["all", "Все"],
            [
              "unread",
              <>
                Непрочитанные
                {unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-badge leading-4 text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </>,
            ],
          ]}
        />
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={markEverything.isPending}
            onClick={() => markEverything.mutate()}
            className="rounded-full text-muted-foreground"
          >
            <CheckCheck />
            Отметить все прочитанными
          </Button>
        )}
      </div>

      <div className="rounded-card border border-border bg-card p-1.5">
        {notifications.isLoading && (
          <div className="space-y-1 p-1.5" aria-label="Загрузка уведомлений">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3.5 px-2 py-3">
                <div
                  className="h-9 w-9 animate-pulse rounded-full bg-secondary"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-secondary" />
                  <div className="h-3 w-1/3 animate-pulse rounded-full bg-secondary/70" />
                </div>
              </div>
            ))}
          </div>
        )}
        {notifications.error && (
          <p role="alert" className="px-4 py-6 text-callout text-muted-foreground">
            Не удалось загрузить уведомления: {(notifications.error as Error).message}
          </p>
        )}
        {!notifications.isLoading && !notifications.error && groups.length === 0 && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/70 text-foreground-secondary">
              <Inbox className="h-5 w-5" />
            </span>
            <p className="mt-4 text-title-3">Пока ничего нет</p>
            <p className="mt-1 max-w-xs text-callout text-muted-foreground">
              {filter === "unread" && items.length > 0
                ? "Все уведомления прочитаны."
                : "Здесь появятся события, которые требуют вашего внимания."}
            </p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.title} className="py-1">
            <div className="px-3.5 pb-1 pt-2 text-caption font-semibold text-muted-foreground">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={open} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
