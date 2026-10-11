import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "motion/react";
import {
  Briefcase,
  Building2,
  CalendarDays,
  ChevronLeft,
  Mail,
  MapPin,
  Phone,
  Search,
  Users,
} from "lucide-react";
import { ProfileAvatar } from "@/components/nexa/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/nexa/task-visuals";
import { getEmployeeDirectory, type DirectoryEmployee } from "@/lib/directory.functions";
import { useIsOnline, useOnlineIds } from "@/lib/presence";
import { ENTER, SPRING_SOFT } from "@/lib/motion";
import {
  AccessLevelMeter,
  AccessLevelValue,
  ActiveValue,
  CopyValueButton,
  DirectorBadge,
  EmployeeName,
  FactTiles,
  HeroPhoto,
  InfoGroup,
  InfoRow,
  OFFLINE_LABEL,
  ONLINE_LABEL,
  PresenceBadge,
  PresenceDot,
  ProfileHero,
  RESTRICTED_LABEL,
  ROLE_LABEL,
  VipBadge,
  initialsOf,
  realPhone,
  realValue,
} from "@/components/nexa/profile-display";

type Filter = "all" | "online" | "offline" | "vip";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "online", label: ONLINE_LABEL },
  { id: "offline", label: OFFLINE_LABEL },
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
function matchesFilter(
  employee: DirectoryEmployee,
  filter: Filter,
  onlineIds: ReadonlySet<string>,
) {
  if (filter === "online") return onlineIds.has(employee.id);
  if (filter === "offline") return !onlineIds.has(employee.id);
  if (filter === "vip") return employee.is_vip;
  return true;
}

function matchesQuery(employee: DirectoryEmployee, query: string) {
  if (!query) return true;
  return [employee.full_name, employee.email, employee.position, employee.department].some(
    (value) => value?.toLocaleLowerCase("ru-RU").includes(query),
  );
}

/** Position for the list row; skipped when it only repeats the "Директор" badge. */
function rowPosition(employee: DirectoryEmployee) {
  const position = employee.position?.trim() || null;
  if (employee.is_director && position?.toLocaleLowerCase("ru-RU") === "директор") return null;
  return position;
}

function EmployeeListItem({
  employee,
  selected,
  isSelf,
  onSelect,
}: {
  employee: DirectoryEmployee;
  selected: boolean;
  isSelf: boolean;
  onSelect: () => void;
}) {
  const online = useIsOnline(employee.id);
  const name = employee.full_name || "Сотрудник";
  const position = rowPosition(employee);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-200 ${selected ? "" : "hover:bg-white/[0.04]"}`}
    >
      {selected && (
        <motion.span
          layoutId="employee-selection"
          transition={SPRING_SOFT}
          className="absolute inset-0 rounded-xl bg-secondary shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07),inset_0_1px_0_oklch(1_0_0/0.06)]"
        >
          <span className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-primary shadow-[0_0_10px_oklch(0.724_0.187_48.9/0.6)]" />
        </motion.span>
      )}
      <span className="relative shrink-0">
        <ProfileAvatar
          avatarUrl={employee.avatar_url}
          name={name}
          initials={initialsOf(name)}
          className="h-10 w-10 rounded-full"
          fallbackClassName="text-xs"
        />
        <PresenceDot
          online={online}
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3"
          ring="ring-2 ring-card"
        />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <EmployeeName
            name={name}
            isVip={employee.is_vip}
            title={name}
            className="min-w-0 truncate text-body font-medium"
          />
          {employee.is_vip && <VipBadge size="sm" />}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          {employee.is_director && <DirectorBadge size="sm" />}
          {isSelf && <span className="shrink-0 font-medium text-primary">Вы</span>}
          {isSelf && position && <span aria-hidden>·</span>}
          {position ? (
            <span className="truncate">{position}</span>
          ) : (
            !employee.is_director &&
            !isSelf && <span className="truncate">Должность не указана</span>
          )}
          <span className="sr-only">{online ? ONLINE_LABEL : OFFLINE_LABEL}</span>
        </span>
      </span>
      {employee.access_level !== null && (
        <span className="relative shrink-0" title={`Уровень доступа ${employee.access_level}`}>
          <AccessLevelMeter level={employee.access_level} size="sm" />
          <span className="sr-only">Уровень доступа {employee.access_level}</span>
        </span>
      )}
    </button>
  );
}

function EmployeeDetails({
  employee,
  canSeePrivate,
  isSelf,
}: {
  employee: DirectoryEmployee;
  canSeePrivate: boolean;
  isSelf: boolean;
}) {
  const email = realValue(employee.email);
  const phone = realPhone(employee.phone);
  const location = realValue(employee.location);
  const online = useIsOnline(employee.id);
  const role = employee.role ? (ROLE_LABEL[employee.role] ?? employee.role) : null;
  const createdAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : null;
  const name = employee.full_name || "Сотрудник";

  return (
    <div className="space-y-4">
      <ProfileHero
        avatar={
          <HeroPhoto online={online}>
            <ProfileAvatar
              avatarUrl={employee.avatar_url}
              name={name}
              initials={initialsOf(name)}
              className="h-full w-full rounded-full"
              fallbackClassName="text-2xl tracking-tight"
            />
          </HeroPhoto>
        }
        name={name}
        isVip={employee.is_vip}
        isDirector={employee.is_director}
        isSelf={isSelf}
        subtitle={
          [employee.position, employee.department].filter(Boolean).join(" · ") ||
          "Должность и отдел не указаны"
        }
        presence={<PresenceBadge online={online} />}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <InfoGroup title="Контакты" heading="h3">
          <InfoRow
            icon={Mail}
            label="Почта"
            value={email ?? (canSeePrivate ? "Не указана" : RESTRICTED_LABEL)}
            muted={!email}
            action={email ? <CopyValueButton value={email} label="Скопировать почту" /> : undefined}
          />
          {canSeePrivate && (
            <InfoRow icon={Phone} label="Телефон" value={phone ?? "Не указан"} muted={!phone} />
          )}
          {canSeePrivate && (
            <InfoRow
              icon={MapPin}
              label="Локация"
              value={location ?? "Не указана"}
              muted={!location}
            />
          )}
        </InfoGroup>

        <InfoGroup title="Работа" heading="h3">
          <InfoRow
            icon={Briefcase}
            label="Должность"
            value={employee.position || "Не указана"}
            muted={!employee.position}
          />
          <InfoRow
            icon={Building2}
            label="Отдел"
            value={employee.department || "Не указан"}
            muted={!employee.department}
          />
          <InfoRow
            icon={CalendarDays}
            label="Профиль создан"
            value={createdAt ?? "Не указана"}
            muted={!createdAt}
          />
        </InfoGroup>
      </div>

      <FactTiles
        title="Доступ"
        heading="h3"
        items={[
          {
            label: "Уровень доступа",
            value: <AccessLevelValue level={employee.access_level} />,
            muted: employee.access_level === null,
          },
          { label: "Роль", value: role ?? RESTRICTED_LABEL, muted: !role },
          {
            label: "Статус",
            value: <ActiveValue active={employee.is_active} />,
            muted: employee.is_active === null,
          },
          { label: "VIP", value: employee.is_vip ? "Да" : "Нет", muted: !employee.is_vip },
        ]}
      />
    </div>
  );
}

function DirectorySkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Загрузка сотрудников"
      className="grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)]"
    >
      <div className="space-y-1 rounded-card border border-border bg-card p-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
            <div
              className="h-10 w-10 animate-pulse rounded-full bg-secondary"
              style={{ animationDelay: `${i * 120}ms` }}
            />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-secondary" />
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-secondary/70" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden h-80 animate-pulse rounded-card border border-border bg-card lg:block" />
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
  // UI-only, phones and tablets: the list and the profile take turns
  // (list → profile → back), as in Tasks.
  const [detailOpen, setDetailOpen] = useState(false);

  const data = directory.data;
  useEffect(() => {
    if (data && !selectedId) setSelectedId(data.currentUserId);
  }, [data, selectedId]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const onlineIds = useOnlineIds();
  const visible = useMemo(
    () =>
      (data?.employees ?? []).filter(
        (employee) =>
          matchesFilter(employee, filter, onlineIds) && matchesQuery(employee, normalizedQuery),
      ),
    [data, filter, normalizedQuery, onlineIds],
  );
  const counts = useMemo(() => {
    const searched = (data?.employees ?? []).filter((employee) =>
      matchesQuery(employee, normalizedQuery),
    );
    return Object.fromEntries(
      FILTERS.map((item) => [
        item.id,
        searched.filter((employee) => matchesFilter(employee, item.id, onlineIds)).length,
      ]),
    ) as Record<Filter, number>;
  }, [data, normalizedQuery, onlineIds]);
  const selected = data?.employees.find((employee) => employee.id === selectedId) ?? null;

  const openEmployee = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    if (window.matchMedia("(max-width: 1023px)").matches) window.scrollTo({ top: 0 });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title-1">Сотрудники</h1>
          <p className="mt-2 text-body text-muted-foreground">
            Команда LUNO DIGITAL и профили участников
          </p>
        </div>
        <div className={`relative w-full sm:w-72 ${detailOpen ? "hidden lg:block" : ""}`}>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, почта, должность"
            aria-label="Поиск сотрудников"
            className="h-10 rounded-full pl-10"
          />
        </div>
      </div>

      {directory.isLoading && <DirectorySkeleton />}
      {directory.error && (
        <p
          role="alert"
          className="rounded-card border border-destructive/30 bg-destructive/10 p-5 text-body text-foreground"
        >
          {(directory.error as Error).message}
        </p>
      )}

      {data && (
        <div className="grid items-start gap-4 lg:grid-cols-[23rem_minmax(0,1fr)]">
          <aside
            aria-label="Список сотрудников"
            className={`min-w-0 flex-col overflow-clip rounded-card border border-border bg-card lg:sticky lg:top-[5.5rem] lg:flex lg:max-h-[calc(100dvh-7rem)] ${detailOpen ? "hidden" : "flex"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
              <Segmented
                label="Фильтр сотрудников"
                pillId="employee-filter-pill"
                value={filter}
                onChange={setFilter}
                className="w-full [&>button]:flex-1 [&>button]:px-2"
                options={FILTERS.map(
                  (item) =>
                    [
                      item.id,
                      <>
                        {item.label}
                        <span className="hidden tabular-nums text-muted-foreground sm:inline">
                          {counts[item.id]}
                        </span>
                      </>,
                    ] as const,
                )}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-10 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-secondary/70 text-foreground-secondary">
                    <Users className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-body font-medium">Никого не найдено</p>
                  <p className="mt-1 text-callout text-muted-foreground">
                    Измените поиск или фильтр.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {visible.map((employee) => (
                    <EmployeeListItem
                      key={employee.id}
                      employee={employee}
                      selected={employee.id === selectedId}
                      isSelf={employee.id === data.currentUserId}
                      onSelect={() => openEmployee(employee.id)}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
              {employeesLabel(visible.length)}
            </div>
          </aside>
          <div className={`min-w-0 lg:block ${detailOpen ? "block" : "hidden"}`}>
            <div className="mb-3 lg:hidden">
              <Button
                variant="secondary"
                size="sm"
                className="h-9 rounded-full pl-2.5"
                onClick={() => setDetailOpen(false)}
              >
                <ChevronLeft className="h-4 w-4" />
                Сотрудники
              </Button>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {selected ? (
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={ENTER}
                >
                  <EmployeeDetails
                    employee={selected}
                    canSeePrivate={data.privateFieldsVisible || selected.id === data.currentUserId}
                    isSelf={selected.id === data.currentUserId}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={ENTER}
                  className="rounded-card border border-dashed border-border-strong p-10 text-center text-body text-muted-foreground"
                >
                  Выберите сотрудника из списка.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
