import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Users } from "lucide-react";
import { ProfileAvatar } from "@/components/nexa/ProfileAvatar";
import { Input } from "@/components/ui/input";
import { getEmployeeDirectory, type DirectoryEmployee } from "@/lib/directory.functions";
import { useIsOnline, useOnlineIds } from "@/lib/presence";
import { EmployeeName, OFFLINE_LABEL, ONLINE_LABEL, ProfileCard, ProfileField, ROLE_LABEL, VipBadge, initialsOf, realPhone, realValue } from "@/components/nexa/profile-display";

type Filter = "all" | "online" | "offline" | "vip";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "online", label: "На связи" },
  { id: "offline", label: "Не на связи" },
  { id: "vip", label: "VIP" },
];

function employeesLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} сотрудник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} сотрудника`;
  return `${count} сотрудников`;
}

// Online = live Realtime Presence (src/lib/presence.ts), not profiles.presence.
function matchesFilter(employee: DirectoryEmployee, filter: Filter, onlineIds: ReadonlySet<string>) {
  if (filter === "online") return onlineIds.has(employee.id);
  if (filter === "offline") return !onlineIds.has(employee.id);
  if (filter === "vip") return employee.is_vip;
  return true;
}

function matchesQuery(employee: DirectoryEmployee, query: string) {
  if (!query) return true;
  return [employee.full_name, employee.email, employee.position, employee.department]
    .some((value) => value?.toLocaleLowerCase("ru-RU").includes(query));
}

function PresenceDot({ online }: { online: boolean }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />;
}

function EmployeeAvatar({ employee, size }: { employee: DirectoryEmployee; size: "sm" | "lg" }) {
  const box = size === "lg" ? "h-24 w-24 rounded-xl text-2xl" : "h-10 w-10 rounded-lg text-xs";
  return (
    <ProfileAvatar avatarUrl={employee.avatar_url} name={employee.full_name} initials={initialsOf(employee.full_name)} className={`${box} shrink-0 border border-border bg-secondary`} />
  );
}

function EmployeeListItem({ employee, selected, isSelf, onSelect }: { employee: DirectoryEmployee; selected: boolean; isSelf: boolean; onSelect: () => void }) {
  const online = useIsOnline(employee.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`relative flex min-h-[68px] w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-200 ${
        selected ? "bg-secondary/80" : "hover:bg-secondary/40"
      }`}
    >
      {selected && <span aria-hidden className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary" />}
      <EmployeeAvatar employee={employee} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <EmployeeName name={employee.full_name || "Сотрудник"} isVip={employee.is_vip} title={employee.full_name || "Сотрудник"} className="min-w-0 truncate text-sm font-medium" />
          {employee.is_vip && <VipBadge size="sm" />}
          {employee.is_director && <span className="shrink-0 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Директор</span>}
          {isSelf && <span className="shrink-0 text-[10px] text-muted-foreground">вы</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PresenceDot online={online} />
          <span className="sr-only">{online ? ONLINE_LABEL : OFFLINE_LABEL}</span>
          <span className="truncate">{employee.position || "Должность не указана"}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {employee.access_level !== null && <span className="font-mono text-[11px] text-muted-foreground">L{employee.access_level}</span>}
      </div>
    </button>
  );
}

function EmployeeDetails({ employee, canSeePrivate }: { employee: DirectoryEmployee; canSeePrivate: boolean }) {
  const email = realValue(employee.email);
  const phone = realPhone(employee.phone);
  const location = realValue(employee.location);
  const online = useIsOnline(employee.id);
  const presence = online ? ONLINE_LABEL : OFFLINE_LABEL;
  const level = employee.access_level !== null ? `Level ${employee.access_level}` : null;
  const role = employee.role ? ROLE_LABEL[employee.role] ?? employee.role : null;
  const createdAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : null;
  const restricted = "Недоступно по правам доступа";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card px-6 py-5">
        <div className="flex items-center gap-5">
          <EmployeeAvatar employee={employee} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h2 className="text-2xl font-semibold tracking-tight"><EmployeeName name={employee.full_name || "Сотрудник"} isVip={employee.is_vip} /></h2>
              {employee.is_vip && <VipBadge />}
              {employee.is_director && <span className="shrink-0 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Директор</span>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[employee.position, employee.department].filter(Boolean).join(" · ") || "Должность и отдел не указаны"}
            </p>
            {presence && (
              <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <PresenceDot online={online} />
                {presence}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ProfileCard title="Доступ">
          <div className="mb-4 flex items-baseline gap-2">
            <span className={`text-3xl font-semibold tracking-tight ${level ? "" : "text-muted-foreground"}`}>{level ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{level ? "уровень доступа" : restricted}</span>
          </div>
          <dl className="divide-y divide-border border-t border-border pt-2.5">
            <ProfileField label="Роль" value={role ?? restricted} muted={!role} />
            <ProfileField
              label="Статус"
              value={employee.is_active === null ? restricted : (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${employee.is_active ? "bg-emerald-400" : "bg-destructive"}`} />
                  {employee.is_active ? "Активен" : "Неактивен"}
                </span>
              )}
              muted={employee.is_active === null}
            />
            <ProfileField label="VIP" value={employee.is_vip ? "Да" : "Нет"} muted={!employee.is_vip} />
          </dl>
        </ProfileCard>

        <ProfileCard title="Контакты">
          <dl className="divide-y divide-border">
            <ProfileField label="Email" value={email ?? (canSeePrivate ? "Не указан" : restricted)} muted={!email} />
            {canSeePrivate && <ProfileField label="Телефон" value={phone ?? "Не указан"} muted={!phone} />}
            {canSeePrivate && <ProfileField label="Локация" value={location ?? "Не указана"} muted={!location} />}
          </dl>
        </ProfileCard>
      </div>

      <ProfileCard title="Рабочая информация">
        <dl className="divide-y divide-border">
          <ProfileField label="Должность" value={employee.position || "Не указана"} muted={!employee.position} />
          <ProfileField label="Отдел" value={employee.department || "Не указан"} muted={!employee.department} />
          <ProfileField label="Профиль создан" value={createdAt ?? "Не указана"} muted={!createdAt} />
          <ProfileField label="Уровень доступа" value={level ?? restricted} muted={!level} />
        </dl>
      </ProfileCard>
    </div>
  );
}

/** Read-only corporate directory; all changes stay in the Admin Panel. */
export function EmployeeDirectory() {
  const load = useServerFn(getEmployeeDirectory);
  const directory = useQuery({ queryKey: ["nexa", "directory"], queryFn: () => load() });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = directory.data;
  useEffect(() => {
    if (data && !selectedId) setSelectedId(data.currentUserId);
  }, [data, selectedId]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const onlineIds = useOnlineIds();
  const visible = useMemo(
    () => (data?.employees ?? []).filter((employee) => matchesFilter(employee, filter, onlineIds) && matchesQuery(employee, normalizedQuery)),
    [data, filter, normalizedQuery, onlineIds],
  );
  const selected = data?.employees.find((employee) => employee.id === selectedId) ?? null;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Сотрудники</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Команда LUNO DIGITAL и профиль участников</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск сотрудников"
            aria-label="Поиск сотрудников"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-9 items-center rounded-md border border-border bg-card/60 p-0.5" role="group" aria-label="Фильтр сотрудников">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`h-full rounded px-3 text-sm transition-colors ${filter === item.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {data && <span className="text-sm text-muted-foreground">{employeesLabel(visible.length)}</span>}
      </div>

      {directory.isLoading && <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Загрузка сотрудников…</p>}
      {directory.error && <p role="alert" className="rounded-lg border border-border bg-card p-5 text-sm text-destructive">{(directory.error as Error).message}</p>}

      {data && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="h-fit rounded-lg border border-border bg-card p-1.5 lg:sticky lg:top-24">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <Users className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Никого не найдено. Измените поиск или фильтр.</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {visible.map((employee) => (
                  <EmployeeListItem
                    key={employee.id}
                    employee={employee}
                    selected={employee.id === selectedId}
                    isSelf={employee.id === data.currentUserId}
                    onSelect={() => setSelectedId(employee.id)}
                  />
                ))}
              </div>
            )}
          </aside>
          <div className="min-w-0">
            {selected ? (
              <EmployeeDetails
                employee={selected}
                canSeePrivate={data.privateFieldsVisible || selected.id === data.currentUserId}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">Выберите сотрудника из списка.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
