import { memo, useEffect, useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CornerDownRight,
  Flag,
  FolderPlus,
  Hourglass,
  ListChecks,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Reply,
  RotateCcw,
  Timer,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  addComment,
  addProjectMember,
  createProject,
  createTask,
  ensureProfile,
  getTaskActivity,
  getWorkspace,
  setProjectStatus,
  transitionTask,
  updateTask,
} from "@/lib/tasks.functions";
import { formatDuration, getNexaSessionId } from "@/lib/nexa-session";
import { ProfileAvatar } from "@/components/nexa/ProfileAvatar";
import { EmployeeName } from "@/components/nexa/profile-display";
import { ProgressRing, RollingTime, Segmented } from "@/components/nexa/task-visuals";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export { STATUS_LABEL, useTaskRealtime, type RealtimeState } from "@/components/nexa/task-data";
import { STATUS_LABEL, WS_KEY, invalidateTaskData, useTaskRealtime } from "@/components/nexa/task-data";

type Action = "start" | "pause" | "resume" | "wait" | "complete" | "reopen";

const PRIORITY_LABEL: Record<string, string> = { low: "Низкий", medium: "Средний", high: "Высокий", critical: "Критический" };
// Motion presets: short, soft and purely presentational. MotionConfig below
// honours prefers-reduced-motion, which drops the transform part of each.
const EASE_OUT: Transition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] };
const SOFT_SPRING: Transition = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 };
const fadeUp = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };

function initialsOf(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU") || "—";
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  // When a timer starts, re-sync before the first paint: the stored value is
  // as old as the last stop, and would briefly show less time than elapsed.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setNow(Date.now());
  }
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Placeholder with the shape of the screen while the workspace loads. */
function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка задач">
      <h1 className="text-title-1">Задачи</h1>
      <div className="mt-3 h-4 w-48 animate-pulse rounded-full bg-secondary" />
      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[16.5rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="h-9 w-9 animate-pulse rounded-full bg-secondary" />
              <div className="h-3.5 flex-1 animate-pulse rounded-full bg-secondary" />
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-card border border-border bg-card p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-11 animate-pulse rounded-xl bg-secondary/70"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
        <div className="hidden h-72 animate-pulse rounded-card border border-border bg-card xl:block" />
      </div>
    </div>
  );
}

export function TaskWorkspace({
  initialMineOnly = false,
  initialTaskId = null,
}: {
  initialMineOnly?: boolean;
  initialTaskId?: string | null;
}) {
  const { session, loading } = useAuth();
  if (loading) return <WorkspaceSkeleton />;
  if (!session)
    return (
      <div className="rounded-card border border-border bg-card p-8 text-center">
        <h1 className="text-title-2">Задачи</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Войдите, чтобы работать с задачами, таймером и отчётами.
        </p>
        <Button asChild className="mt-5 rounded-full px-5">
          <Link to="/auth">Войти</Link>
        </Button>
      </div>
    );
  return (
    <Workspace
      initialMineOnly={initialMineOnly}
      initialTaskId={initialTaskId}
      userId={session.user.id}
    />
  );
}

function Workspace({
  initialMineOnly,
  initialTaskId,
  userId,
}: {
  initialMineOnly: boolean;
  initialTaskId: string | null;
  userId: string;
}) {
  const qc = useQueryClient();
  const fetchWs = useServerFn(getWorkspace);
  const ensure = useServerFn(ensureProfile);

  // ensure_my_profile runs once per signed-in user: the result stays cached
  // for the session (the whole cache is dropped on sign-out or a user change),
  // so reopening the tab does not wait for it again. The workspace query
  // starts only after it succeeded, so there is no race on a first visit.
  const ensured = useQuery({
    queryKey: ["nexa", "ensure-profile", userId],
    queryFn: () => ensure({ data: {} }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (ensured.error) toast.error((ensured.error as Error).message);
  }, [ensured.error]);
  const ready = ensured.isSuccess;

  const ws = useQuery({ queryKey: WS_KEY, queryFn: () => fetchWs(), enabled: ready });

  useTaskRealtime();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(initialTaskId);
  const [mineOnly, setMineOnly] = useState(initialMineOnly);
  // UI-only: whether the "new task" composer is expanded.
  const [composerOpen, setComposerOpen] = useState(false);
  const data = ws.data;

  useEffect(() => {
    if (!data || projectId || !data.projects[0]) return;
    // A task opened from Overview starts in its own project.
    const focused = initialTaskId ? data.tasks.find((t) => t.id === initialTaskId) : undefined;
    setProjectId(focused?.project_id ?? data.projects[0].id);
  }, [data, projectId, initialTaskId]);

  // Cached workspace data of the current user is shown at once.
  if (!ws.data && (!ready || ws.isLoading)) return <WorkspaceSkeleton />;
  if (ws.error)
    return (
      <div
        role="alert"
        className="rounded-card border border-destructive/30 bg-destructive/10 px-5 py-4 text-body text-foreground"
      >
        {(ws.error as Error).message}
      </div>
    );
  if (!data) return null;

  const project = data.projects.find((p) => p.id === projectId) ?? null;
  const tasks = data.tasks.filter((t) => t.project_id === projectId);
  const selected = data.tasks.find((t) => t.id === taskId) ?? null;

  const filterKey = `${projectId ?? "none"}:${mineOnly ? "mine" : "all"}`;
  const openTotal = data.tasks.filter((t) => t.status !== "done").length;
  const projectCompleted = isCompleted(project);
  const selectProject = (id: string) => {
    setProjectId(id);
    setTaskId(null);
    setComposerOpen(false);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div>
        {/* Page header: title, scope summary and the one global action. */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-title-1">Задачи</h1>
            <p className="mt-2 text-body text-muted-foreground">
              {data.projects.length > 0
                ? `${data.projects.length} ${plural(data.projects.length, "проект", "проекта", "проектов")} · ${openTotal} ${plural(openTotal, "открытая задача", "открытые задачи", "открытых задач")}`
                : "Рабочее пространство"}
            </p>
          </div>
          <NewProject onCreated={selectProject} />
        </div>

        {!project ? (
          <div className="flex items-start gap-4 rounded-card border border-border bg-card px-5 py-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/70 text-foreground-secondary"
            >
              <ListChecks className="h-5 w-5" />
            </span>
            <div>
              <div className="text-title-3">Проектов пока нет</div>
              <p className="mt-1 text-body text-muted-foreground">
                Создайте проект (доступно администратору и менеджеру) или попросите руководителя
                добавить вас в существующий.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[16.5rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,0.95fr)_minmax(0,1.05fr)]">
            {/* 1. Projects: a quiet sidebar list on the page itself (no card). */}
            <aside
              aria-label="Проекты"
              className="hidden min-w-0 lg:row-span-2 lg:block lg:self-stretch xl:row-span-1"
            >
              <div className="lg:sticky lg:top-[5.5rem] lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col">
                <div className="hidden items-baseline justify-between px-3 pb-2 lg:flex">
                  <span className="text-callout font-semibold text-foreground-secondary">
                    Проекты
                  </span>
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {data.projects.length}
                  </span>
                </div>
                <nav className="-mx-1 hidden min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2 lg:block">
                  {data.projects.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      tasks={data.tasks}
                      active={p.id === projectId}
                      onSelect={selectProject}
                    />
                  ))}
                </nav>
                <div className="mt-2 hidden lg:block">
                  <Members data={data} projectId={project.id} />
                </div>
              </div>
            </aside>

            {/* 2. Tasks of the selected project */}
            <section
              aria-label="Задачи проекта"
              className={`min-w-0 flex-col overflow-clip rounded-card border border-border bg-card lg:flex xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] ${selected ? "hidden" : "flex"}`}
            >
              <div className="border-b border-border px-4 pb-3.5 pt-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-caption text-muted-foreground">
                      {project.code}
                    </div>
                    <h2
                      className="mt-0.5 hidden break-words text-title-3 lg:line-clamp-2"
                      title={project.name}
                    >
                      {project.name}
                    </h2>
                    {/* Phones and tablets: the title itself picks the project (a pull-down). */}
                    <label htmlFor="task-project" className="sr-only">
                      Проект
                    </label>
                    <NativeSelect
                      id="task-project"
                      value={projectId ?? ""}
                      onChange={(e) => selectProject(e.target.value)}
                      wrapperClassName="mt-0.5 -ml-2 lg:hidden"
                      className="h-9 border-transparent bg-transparent pl-2 text-title-3 hover:border-border hover:bg-field"
                    >
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {isCompleted(p) ? " · Завершён" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {projectCompleted ? (
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-caption font-medium text-foreground-secondary">
                        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                        {completedLabel(project)}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 w-8 rounded-full px-0 sm:w-auto sm:px-3.5"
                        aria-label="Новая задача"
                        aria-expanded={composerOpen}
                        onClick={() => setComposerOpen((open) => !open)}
                      >
                        <Plus
                          className={`h-4 w-4 transition-[rotate] duration-300 ease-(--ease-spring) ${composerOpen ? "rotate-45" : ""}`}
                        />
                        <span className="hidden sm:inline">Задача</span>
                      </Button>
                    )}
                    <ProjectMenu project={project} userId={data.userId} />
                  </div>
                </div>
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <Segmented
                    label="Какие задачи показать"
                    pillId="task-filter-pill"
                    value={mineOnly}
                    onChange={(mine) => {
                      setMineOnly(mine);
                      setTaskId(null);
                    }}
                    options={[
                      [false, "Все"],
                      [true, "Мои"],
                    ]}
                  />
                  <StatusSummary tasks={tasks} />
                </div>
              </div>
              <AnimatePresence initial={false}>
                {composerOpen && !projectCompleted && (
                  <motion.div
                    key="composer"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={EASE_OUT}
                    className="shrink-0 overflow-hidden border-b border-border"
                  >
                    <div className="p-3 sm:p-4">
                      <NewTask projectId={project.id} members={membersOf(data, project.id)} parentId={null} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {/* presenceAffectsLayout off: otherwise the presence context is
                    recreated on every render and re-renders each memoized row. */}
                <AnimatePresence mode="wait" initial={false} presenceAffectsLayout={false}>
                  <motion.div key={filterKey} {...fadeUp} transition={EASE_OUT} className="p-2">
                    <TaskTree
                      tasks={tasks}
                      running={data.running}
                      selectedId={taskId}
                      onSelect={setTaskId}
                      userId={data.userId}
                      mineOnly={mineOnly}
                      data={data}
                      onCreate={
                        composerOpen || projectCompleted ? undefined : () => setComposerOpen(true)
                      }
                      onShowAll={() => setMineOnly(false)}
                      completed={projectCompleted}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="border-t border-border p-3 lg:hidden">
                <Members data={data} projectId={project.id} />
              </div>
            </section>

            {/* 3. Selected task */}
            <section
              aria-label="Детали задачи"
              className={`min-w-0 lg:col-start-2 lg:block xl:col-start-auto ${selected ? "block" : "hidden"}`}
            >
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  <motion.div key={selected.id} {...fadeUp} transition={EASE_OUT}>
                    <div className="mb-3 flex min-w-0 items-center gap-2 lg:hidden">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-9 shrink-0 rounded-full pl-2.5"
                        onClick={() => setTaskId(null)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Задачи
                      </Button>
                      <span className="min-w-0 truncate text-callout text-muted-foreground">
                        <span className="font-mono">{project.code}</span> · {project.name}
                      </span>
                    </div>
                    <TaskDetail task={selected} data={data} onSelect={setTaskId} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={EASE_OUT}
                    className="flex flex-col items-center rounded-card border border-dashed border-border-strong px-6 py-14 text-center"
                  >
                    <span
                      aria-hidden
                      className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-foreground-secondary"
                    >
                      <ListChecks className="h-5 w-5" />
                    </span>
                    <div className="mt-4 text-title-3">Задача не выбрана</div>
                    <p className="mt-1.5 max-w-xs text-body text-muted-foreground">
                      Выберите задачу в списке — здесь появятся таймер, подзадачи и обсуждение.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

type Project = WS["projects"][number];

const isCompleted = (project: Project | null | undefined) => project?.status === "completed";

function completedLabel(project: Project) {
  if (!project.completed_at) return "Завершён";
  return `Завершён ${new Date(project.completed_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** First letter of a project name, shown inside its progress ring. */
function monogram(name: string) {
  return (
    name
      .trim()
      .match(/[\p{L}\p{N}]/u)?.[0]
      ?.toLocaleUpperCase("ru-RU") ?? "•"
  );
}

/**
 * One project in the sidebar: a ring with the share of finished tasks around
 * the project's initial, the name on up to two lines and the task counts.
 * The selection is a card that glides between rows (layoutId). Project
 * actions ("⋯") live in the header of the task list.
 */
function ProjectRow({
  project: p,
  tasks,
  active,
  onSelect,
}: {
  project: Project;
  tasks: Task[];
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const done = isCompleted(p);
  const own = tasks.filter((t) => t.project_id === p.id);
  const open = own.filter((t) => t.status !== "done").length;
  const finished = own.length - open;
  const count =
    own.length > 0
      ? `${own.length} ${plural(own.length, "задача", "задачи", "задач")}`
      : "Нет задач";
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      aria-current={active ? "true" : undefined}
      title={`${p.code} · ${p.name}${done ? ` · ${completedLabel(p)}` : ""}`}
      className={`relative flex w-full items-center gap-3 rounded-xl py-2 pl-2 pr-3 text-left transition-colors duration-200 ${active ? "" : "hover:bg-white/[0.04]"}`}
    >
      {active && (
        <motion.span
          layoutId="project-selection"
          transition={SOFT_SPRING}
          className="absolute inset-0 rounded-xl border border-border bg-card shadow-[inset_0_1px_0_oklch(1_0_0/0.05),0_10px_24px_-16px_oklch(0_0_0/0.9)]"
        />
      )}
      <ProgressRing
        value={done ? 100 : own.length > 0 ? (finished / own.length) * 100 : 0}
        size={36}
        stroke={3}
        tone={active && !done ? "primary" : "muted"}
        className="relative"
      >
        {done ? (
          <Check aria-hidden className="h-4 w-4 text-muted-foreground" />
        ) : (
          <span
            aria-hidden
            className={`text-callout font-semibold transition-colors duration-300 ${active ? "text-primary" : "text-foreground-secondary"}`}
          >
            {monogram(p.name)}
          </span>
        )}
      </ProgressRing>
      <span className="relative min-w-0 flex-1">
        <span
          className={`line-clamp-2 break-words text-body ${done ? "text-muted-foreground" : active ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}
        >
          {p.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <span className="truncate">{done ? "Завершён" : count}</span>
          {!done && open > 0 && (
            <span
              className={`shrink-0 tabular-nums ${active ? "text-primary" : "text-foreground-secondary"}`}
            >
              · {open} {plural(open, "открыта", "открыты", "открыто")}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * "⋯" actions for a project: complete or reopen. The menu asks the database
 * whether the caller may manage this project (can_manage_project); the
 * set_project_status RPC re-checks rights and state on the backend.
 */
function ProjectMenu({ project, userId, className = "" }: { project: Project; userId: string; className?: string }) {
  const qc = useQueryClient();
  const changeStatus = useServerFn(setProjectStatus);
  const completed = isCompleted(project);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rights = useQuery({
    queryKey: ["nexa", "project-rights", project.id],
    staleTime: 60_000,
    enabled: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (name: string, args: Record<string, string>) => Promise<{ data: boolean | null; error: { message: string } | null }>)(
        "can_manage_project", { _project_id: project.id, _user_id: userId },
      );
      if (error) throw new Error(error.message);
      return data === true;
    },
  });
  const m = useMutation({
    mutationFn: (status: "active" | "completed") => changeStatus({ data: { projectId: project.id, status } }),
    onSuccess: (_result, status) => {
      void qc.invalidateQueries({ queryKey: WS_KEY });
      setConfirmOpen(false);
      toast.success(status === "completed" ? `Проект ${project.code} завершён` : `Проект ${project.code} снова открыт`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const allowed = rights.data === true;
  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open && !rights.data) void rights.refetch(); }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Действия с проектом ${project.code}`}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,opacity] duration-200 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${className}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-56 p-1">
          <div className="truncate px-2 pb-1.5 pt-1 text-caption text-muted-foreground">
            <span className="font-mono">{project.code}</span> · {project.name}
          </div>
          <DropdownMenuItem disabled={!allowed || m.isPending} onSelect={() => setConfirmOpen(true)} className="gap-2.5 rounded-lg px-2 py-2 text-body">
            {completed ? <RotateCcw className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
            {completed ? "Открыть проект заново" : "Завершить проект"}
          </DropdownMenuItem>
          {rights.isFetching && (
            <div className="px-2 pb-1.5 pt-0.5 text-caption text-muted-foreground">
              Проверяем права…
            </div>
          )}
          {!rights.isFetching && rights.data === false && (
            <div className="px-2 pb-1.5 pt-0.5 text-caption text-muted-foreground">
              Доступно владельцу проекта и руководителям
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[26rem] gap-5 p-6">
          <AlertDialogHeader className="space-y-2.5">
            <span
              aria-hidden
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-primary/25 bg-primary-soft text-primary sm:mx-0"
            >
              {completed ? <RotateCcw className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </span>
            <AlertDialogTitle>
              {completed ? "Открыть проект заново?" : "Завершить проект?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-body text-muted-foreground">
              {completed
                ? "В проекте снова можно будет создавать задачи, запускать таймеры и добавлять участников."
                : "После завершения новые задачи в проекте создавать нельзя. Все существующие задачи, история и комментарии останутся доступны."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel disabled={m.isPending} className="mt-0">
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={m.isPending}
              onClick={(e) => { e.preventDefault(); m.mutate(completed ? "active" : "completed"); }}
            >
              {m.isPending ? "Сохраняем…" : completed ? "Открыть проект" : "Завершить проект"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Russian plural form for 1 / 2–4 / 5+ */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Status glyph: one restrained shape per status instead of coloured pills. */
function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  if (status === "done")
    return (
      <span
        aria-hidden
        className={`flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/35 ${className}`}
      >
        <Check className="h-2.5 w-2.5 text-background" strokeWidth={3.5} />
      </span>
    );
  if (status === "waiting")
    return <Hourglass aria-hidden className={`h-4 w-4 text-warning ${className}`} />;
  if (status === "in_progress")
    return (
      <span
        aria-hidden
        className={`flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-primary shadow-[0_0_8px_oklch(0.724_0.187_48.9/0.45)] ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
    );
  return (
    <span
      aria-hidden
      className={`h-4 w-4 rounded-full border-[1.5px] border-muted-foreground/60 ${className}`}
    />
  );
}

/** Counts per status for the selected project, shown as quiet inline text. */
function StatusSummary({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  const count = (status: string) => tasks.filter((t) => t.status === status).length;
  const parts = (["in_progress", "todo", "waiting", "done"] as const).map((s) => [s, count(s)] as const).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
      {parts.map(([s, n]) => (
        <span key={s} className="inline-flex items-center gap-1.5" title={STATUS_LABEL[s]}>
          <StatusIcon status={s} className="scale-[0.8]" />
          <span className="hidden sm:inline">{STATUS_LABEL[s]}</span>
          <span className="tabular-nums text-foreground-secondary">{n}</span>
        </span>
      ))}
    </div>
  );
}

/** "Савинов Денис Витальевич" → "Савинов Д. В." for dense rows; full name stays in the title tooltip. */
function shortName(fullName: string) {
  const [last, ...rest] = fullName.trim().split(/\s+/);
  if (!last || rest.length === 0) return fullName;
  return `${last} ${rest.map((part) => `${part[0]}.`).join(" ")}`;
}

function dueLabel(task: Task) {
  if (!task.due_at) return null;
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return null;
  const overdue = task.status !== "done" && due.getTime() < Date.now();
  return { text: due.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }), overdue };
}

type WS = Awaited<ReturnType<typeof getWorkspace>>;
type Task = WS["tasks"][number];

function membersOf(data: WS, projectId: string) {
  const project = data.projects.find((p) => p.id === projectId);
  const ids = new Set(data.members.filter((m) => m.project_id === projectId).map((m) => m.user_id));
  if (project) ids.add(project.owner_id);
  return data.profiles.filter((p) => ids.has(p.id));
}

/** Name of a workspace profile, rendered through EmployeeName (VIP accent). */
function PersonName({ data, id, className = "", short = false }: { data: WS; id: string | null; className?: string; short?: boolean }) {
  const profile = id ? data.profiles.find((x) => x.id === id) : undefined;
  const full = nameOf(data, id);
  return <EmployeeName name={short ? shortName(full) : full} isVip={profile?.is_vip} title={full} className={className} />;
}

function nameOf(data: WS, id: string | null) {
  if (!id) return "—";
  const p = data.profiles.find((x) => x.id === id);
  return p?.full_name || "Сотрудник";
}

/** Who is running a timer on the task right now (running.user_id, not the assignee). */
function workersOf(data: WS, taskId: string) {
  return [...new Set(data.running.filter((r) => r.task_id === taskId).map((r) => r.user_id))];
}

/** Shows "Профиль недоступен" when a user id exists but its profile was not returned (RLS). */
function PersonOrUnavailable({ data, id, className = "", short = false }: { data: WS; id: string; className?: string; short?: boolean }) {
  if (!data.profiles.some((p) => p.id === id)) return <span className={`text-muted-foreground ${className}`}>Профиль недоступен</span>;
  return <PersonName data={data} id={id} className={className} short={short} />;
}

/**
 * Displayed progress per task kind:
 *  - done → 100%;
 *  - has subtasks → stored progress (computed from subtasks by the DB);
 *  - leaf with an estimate → time progress, min(100, liveSpent / estimate);
 *  - leaf without an estimate → stored manual progress, or null when it is 0
 *    (the UI then says "Оценка не задана" instead of a false 0%).
 */
function displayedProgress(task: Task, hasSubtasks: boolean, spent: number): { value: number | null; source: "done" | "subtasks" | "time" | "manual" } {
  if (task.status === "done") return { value: 100, source: "done" };
  if (hasSubtasks) return { value: task.progress, source: "subtasks" };
  if (task.estimated_seconds > 0) return { value: Math.min(100, Math.floor((spent / task.estimated_seconds) * 100)), source: "time" };
  return { value: task.progress > 0 ? task.progress : null, source: "manual" };
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function liveSpent(task: Task, running: WS["running"], now: number) {
  const open = running.filter((r) => r.task_id === task.id);
  return task.spent_seconds + open.reduce((acc, r) => acc + (now - new Date(r.started_at).getTime()) / 1000, 0);
}

/**
 * Re-renders only itself once a second while one of the task's timers runs,
 * so a ticking timer does not re-render the whole tree or task detail.
 */
function LiveSpent({ task, running, children }: { task: Task; running: WS["running"]; children: (spent: number) => React.ReactNode }) {
  const now = useNow(running.some((r) => r.task_id === task.id));
  return <>{children(liveSpent(task, running, now))}</>;
}

function LiveBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-1.5 py-px text-badge uppercase tracking-wider text-primary">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      Live
    </span>
  );
}

const NO_TASKS: Task[] = [];

type Profile = WS["profiles"][number];

/**
 * One row of the task tree. Memoized: props are the task object (kept stable
 * by React Query structural sharing while unchanged) and primitives, so a
 * change of one task, the selection or another task's timer does not
 * re-render the other rows.
 */
const TaskRow = memo(function TaskRow({ task: t, depth, selected, onSelect, assignee, profiles, runningStarts, workerIds, childDone, childTotal }: {
  task: Task; depth: number; selected: boolean; onSelect: (id: string) => void; assignee: Profile | null; profiles: WS["profiles"];
  runningStarts: string; workerIds: string; childDone: number; childTotal: number;
}) {
  const live = runningStarts !== "";
  const running = useMemo<WS["running"]>(
    () => (live ? runningStarts.split("|").map((started_at, i) => ({ id: `${t.id}:${i}`, task_id: t.id, user_id: "", session_id: "", started_at })) : []),
    [live, runningStarts, t.id],
  );
  const due = dueLabel(t);
  const urgent = t.priority === "high" || t.priority === "critical";
  const finished = t.status === "done";
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(t.id)}
      whileTap={{ scale: 0.99 }}
      aria-current={selected ? "true" : undefined}
      title={t.title}
      className={`group/row relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${selected ? "" : "hover:bg-white/[0.04]"}`}
    >
      {selected && (
        <motion.span
          layoutId="task-selection"
          transition={SOFT_SPRING}
          className="absolute inset-0 rounded-xl bg-secondary shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07),inset_0_1px_0_oklch(1_0_0/0.06)]"
        >
          <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-primary shadow-[0_0_10px_oklch(0.724_0.187_48.9/0.6)]" />
        </motion.span>
      )}
      <span className="relative flex h-5 w-4 shrink-0 items-center justify-center">
        <StatusIcon status={t.status} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span
          className={`block truncate ${depth > 0 ? "text-callout leading-5" : "text-body"} ${finished ? "text-muted-foreground line-through decoration-muted-foreground/40" : selected ? "font-semibold text-foreground" : depth > 0 ? "text-foreground/85" : "font-medium text-foreground/95"}`}
        >
          {t.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-x-2.5 text-caption text-muted-foreground">
          <span className="shrink-0 font-mono text-muted-foreground/80">#{t.number}</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {assignee ? (
              <ProfileAvatar avatarUrl={assignee.avatar_url} name={assignee.full_name || "Сотрудник"} initials={initialsOf(assignee.full_name || "С")} className="h-4 w-4 rounded-full" fallbackClassName="text-[8px]" />
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-border-strong" />
            )}
            {assignee ? <EmployeeName name={shortName(assignee.full_name || "Сотрудник")} isVip={assignee.is_vip} title={assignee.full_name ?? undefined} className="truncate" /> : <span className="truncate">{t.assignee_id ? "Профиль недоступен" : "Без исполнителя"}</span>}
          </span>
          {live && <LiveBadge />}
          {live && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate" title="Сейчас работает">
              {workerIds.split("|").map((id, i) => {
                const worker = profiles.find((p) => p.id === id);
                return (
                  <span key={id} className="truncate">
                    {i > 0 && ", "}
                    {worker ? <EmployeeName name={shortName(worker.full_name || "Сотрудник")} isVip={worker.is_vip} title={worker.full_name || "Сотрудник"} /> : <span className="text-muted-foreground">Профиль недоступен</span>}
                  </span>
                );
              })}
            </span>
          )}
          {urgent && !finished && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 ${t.priority === "critical" ? "text-destructive" : "text-warning"}`}
            >
              <Flag aria-hidden className="h-3 w-3" />
              <span className="hidden sm:inline">{PRIORITY_LABEL[t.priority]}</span>
            </span>
          )}
          {due && (
            <span
              className={`shrink-0 items-center gap-1 ${due.overdue ? "inline-flex text-destructive" : "hidden sm:inline-flex"}`}
            >
              <CalendarDays aria-hidden className="h-3 w-3" />
              {due.text}
            </span>
          )}
          {childTotal > 0 && (
            <span className="hidden shrink-0 items-center gap-1 sm:inline-flex" title="Подзадачи: готово / всего"><CornerDownRight className="h-3 w-3" />{childDone}/{childTotal}</span>
          )}
        </span>
      </span>
      <span className="relative hidden shrink-0 pt-px text-right sm:block">
        <span
          className={`block text-caption tabular-nums ${live ? "font-medium text-primary" : "text-muted-foreground"}`}
        >
          <LiveSpent task={t} running={running}>
            {(spent) => formatDuration(spent)}
          </LiveSpent>
        </span>
      </span>
      <span className="sr-only">{STATUS_LABEL[t.status]}</span>
    </motion.button>
  );
});

function TaskTree({ tasks, running, selectedId, onSelect, userId, mineOnly, data, onCreate, onShowAll, completed = false }: { tasks: Task[]; running: WS["running"]; selectedId: string | null; onSelect: (id: string) => void; userId: string; mineOnly: boolean; data: WS; onCreate?: (() => void) | undefined; onShowAll: () => void; completed?: boolean }) {
  // Derived tree data is recomputed only when the task list or the filter
  // changes, not on every render (selection, timer, profile updates).
  const { roots, childrenOf, rootIdOf } = useMemo(() => {
    const visibleIds = new Set(tasks.filter((t) => !mineOnly || t.assignee_id === userId).map((t) => t.id));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    if (mineOnly) {
      for (const task of tasks) {
        if (task.assignee_id !== userId) continue;
        let parentId = task.parent_task_id;
        while (parentId) {
          visibleIds.add(parentId);
          parentId = byId.get(parentId)?.parent_task_id ?? null;
        }
      }
    }
    const children = new Map<string, Task[]>();
    const rootList: Task[] = [];
    for (const t of tasks) {
      if (!visibleIds.has(t.id)) continue;
      if (t.parent_task_id && byId.has(t.parent_task_id)) {
        const list = children.get(t.parent_task_id);
        if (list) list.push(t);
        else children.set(t.parent_task_id, [t]);
      } else rootList.push(t);
    }
    const rootIdOf = (id: string) => {
      let task = byId.get(id);
      while (task?.parent_task_id && byId.has(task.parent_task_id))
        task = byId.get(task.parent_task_id);
      return task?.id ?? null;
    };
    return { roots: rootList, childrenOf: (id: string) => children.get(id) ?? NO_TASKS, rootIdOf };
  }, [tasks, mineOnly, userId]);
  // Finished top-level tasks fold into "Завершённые" (like Reminders), open
  // work stays on top. The group opens by itself when nothing else is open or
  // when the selected task lives in it.
  const openRoots = roots.filter((t) => t.status !== "done");
  const doneRoots = roots.filter((t) => t.status === "done");
  const selectedRoot = selectedId ? rootIdOf(selectedId) : null;
  const selectedInDone = doneRoots.some((t) => t.id === selectedRoot);
  const [showDone, setShowDone] = useState(selectedInDone);
  const [wasSelectedInDone, setWasSelectedInDone] = useState(selectedInDone);
  if (selectedInDone !== wasSelectedInDone) {
    setWasSelectedInDone(selectedInDone);
    if (selectedInDone) setShowDone(true);
  }
  const doneOpen = showDone || openRoots.length === 0;
  // Per-task running state as stable primitives, so a memoized row re-renders
  // only when its own timers change.
  const runningByTask = useMemo(() => {
    const map = new Map<string, { starts: string; workers: string }>();
    for (const r of running) {
      const entry = map.get(r.task_id);
      if (entry) {
        entry.starts += `|${r.started_at}`;
        if (!entry.workers.split("|").includes(r.user_id)) entry.workers += `|${r.user_id}`;
      } else map.set(r.task_id, { starts: r.started_at, workers: r.user_id });
    }
    return map;
  }, [running]);
  const render = (t: Task, depth: number): React.ReactNode => {
    const children = childrenOf(t.id);
    const live = runningByTask.get(t.id);
    return (
      <div key={t.id}>
        <TaskRow
          task={t}
          depth={depth}
          selected={t.id === selectedId}
          onSelect={onSelect}
          assignee={t.assignee_id ? data.profiles.find((p) => p.id === t.assignee_id) ?? null : null}
          profiles={data.profiles}
          runningStarts={live?.starts ?? ""}
          workerIds={live?.workers ?? ""}
          childDone={children.filter((c) => c.status === "done").length}
          childTotal={children.length}
        />
        {children.length > 0 && (
          <div className="relative ml-[1.25rem] border-l border-border pl-2">
            {children.map((c) => render(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };
  if (tasks.length === 0 || roots.length === 0) {
    const empty = tasks.length === 0;
    if (empty && completed)
      return (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <CheckCircle2 aria-hidden className="h-6 w-6 text-muted-foreground" />
          <div className="mt-3 text-body font-medium">В проекте нет задач</div>
          <p className="mt-1 text-callout text-muted-foreground">
            Проект завершён — новые задачи не создаются
          </p>
        </div>
      );
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-secondary/70 text-foreground-secondary"
        >
          {empty ? <ListChecks className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
        </span>
        <div className="mt-3 text-body font-medium">
          {empty ? "В проекте пока нет задач" : "Нет задач, назначенных на вас"}
        </div>
        <p className="mt-1 max-w-xs text-callout text-muted-foreground">
          {empty
            ? "Начните с первой задачи — подзадачи можно добавить позже."
            : "Остальные задачи проекта — в списке «Все»."}
        </p>
        {empty ? (
          onCreate && (
            <Button size="sm" className="mt-4 h-9 rounded-full px-4" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Создать задачу
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="mt-4 h-9 rounded-full px-4"
            onClick={onShowAll}
          >
            Показать все
          </Button>
        )}
      </div>
    );
  }
  return (
    <div>
      {openRoots.length > 0 ? (
        <div className="space-y-0.5">{openRoots.map((t) => render(t, 0))}</div>
      ) : (
        <p className="flex items-center gap-2 px-3 py-2.5 text-callout text-muted-foreground">
          <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
          Открытых задач нет — всё завершено
        </p>
      )}
      {doneRoots.length > 0 && (
        <div className={openRoots.length > 0 ? "mt-2 border-t border-border pt-2" : ""}>
          {openRoots.length > 0 ? (
            <button
              type="button"
              aria-expanded={doneOpen}
              onClick={() => setShowDone((open) => !open)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-callout font-medium text-muted-foreground transition-colors duration-200 hover:bg-white/[0.04] hover:text-foreground"
            >
              <ChevronRight
                aria-hidden
                className={`h-4 w-4 transition-[rotate] duration-300 ease-(--ease-spring) ${doneOpen ? "rotate-90" : ""}`}
              />
              Завершённые
              <span className="tabular-nums text-muted-foreground">{doneRoots.length}</span>
            </button>
          ) : null}
          <AnimatePresence initial={false}>
            {doneOpen && (
              <motion.div
                key="done"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={EASE_OUT}
                className="overflow-hidden"
              >
                <div className="space-y-0.5">{doneRoots.map((t) => render(t, 0))}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function NewProject({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createProject);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const m = useMutation({
    mutationFn: () => create({ data: { code, name } }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: WS_KEY });
      onCreated(p.id);
      setOpen(false);
      setCode("");
      setName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Новый проект"
          className="h-9 w-9 shrink-0 rounded-full px-0 sm:w-auto sm:px-4"
        >
          <FolderPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Новый проект</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <div className="text-title-3">Новый проект</div>
          <p className="mt-1 text-callout text-muted-foreground">
            Короткий код проекта виден в задачах и меню.
          </p>
          <div className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <Input
              aria-label="Код проекта"
              placeholder="Код"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono"
              required
            />
            <Input
              aria-label="Название проекта"
              placeholder="Название"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" disabled={m.isPending}>
              {m.isPending ? "Создаём…" : "Создать"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function NewTask({ projectId, members, parentId }: { projectId: string; members: WS["profiles"]; parentId: string | null }) {
  const qc = useQueryClient();
  const create = useServerFn(createTask);
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const m = useMutation({
    mutationFn: () =>
      create({
        data: {
          projectId,
          title,
          priority,
          parentTaskId: parentId,
          assigneeId: assignee || null,
          estimatedSeconds: Math.round((parseFloat(hours.replace(",", ".")) || 0) * 3600),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WS_KEY });
      setTitle("");
      setHours("");
      setDueAt("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="rounded-xl border border-border bg-background/50 p-3"
    >
      <div className="flex items-center gap-2">
        <Input
          placeholder={parentId ? "Новая подзадача" : "Новая задача"}
          aria-label={parentId ? "Название подзадачи" : "Название задачи"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 min-w-0 flex-1 text-[15px] md:text-[15px]"
          required
          minLength={2}
        />
        <Button disabled={m.isPending} className="h-10 shrink-0 rounded-full px-4">
          Добавить
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="relative block min-w-0">
          <Clock
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="number"
            min="0"
            step="0.25"
            aria-label="Оценка в часах"
            placeholder="Оценка, ч"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="pl-9"
            inputMode="decimal"
          />
        </label>
        <NativeSelect
          aria-label="Приоритет"
          icon={Flag}
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        >
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
        <label className="relative block min-w-0">
          <CalendarDays
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Срок выполнения"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className={`pl-9 ${dueAt ? "" : "text-muted-foreground"}`}
          />
        </label>
        <NativeSelect
          aria-label="Исполнитель"
          icon={UserRound}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Без исполнителя</option>
          {members.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name || "Сотрудник"}</option>
          ))}
        </NativeSelect>
      </div>
    </form>
  );
}

function Members({ data, projectId }: { data: WS; projectId: string }) {
  const qc = useQueryClient();
  const add = useServerFn(addProjectMember);
  const members = membersOf(data, projectId);
  // A completed project takes no new members (also enforced by a DB trigger).
  const others = isCompleted(data.projects.find((p) => p.id === projectId)) ? [] : data.profiles.filter((p) => !members.some((m) => m.id === p.id));
  const [uid, setUid] = useState("");
  // UI-only: the add-member picker stays folded so it does not compete with projects.
  const [adding, setAdding] = useState(false);
  const m = useMutation({
    mutationFn: () => add({ data: { projectId, userId: uid, role: "member" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WS_KEY });
      setUid("");
      setAdding(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const shown = members.slice(0, 6);
  return (
    <div className="lg:rounded-card lg:border lg:border-border lg:bg-card/60 lg:p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-callout font-semibold text-foreground-secondary">
          <Users aria-hidden className="h-4 w-4" />
          Участники
          <span className="font-normal tabular-nums text-muted-foreground">{members.length}</span>
        </span>
        {others.length > 0 && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-caption font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
          >
            <UserPlus aria-hidden className="h-3.5 w-3.5" />
            Добавить
          </button>
        )}
      </div>
      {members.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="flex shrink-0 -space-x-2">
            {shown.map((p) => (
              <ProfileAvatar
                key={p.id}
                avatarUrl={p.avatar_url}
                name={p.full_name || "Сотрудник"}
                initials={initialsOf(p.full_name || "С")}
                className="h-7 w-7 rounded-full ring-2 ring-card"
                fallbackClassName="text-[10px]"
              />
            ))}
            {members.length > shown.length && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground-secondary ring-2 ring-card">
                +{members.length - shown.length}
              </span>
            )}
          </div>
          <p className="line-clamp-2 min-w-0 text-caption text-muted-foreground">
            {members.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <EmployeeName
                  name={shortName(p.full_name || "Сотрудник")}
                  isVip={p.is_vip}
                  title={p.full_name || "Сотрудник"}
                />
              </span>
            ))}
          </p>
        </div>
      )}
      <AnimatePresence initial={false}>
        {others.length > 0 && adding && (
          <motion.div
            key="add-member"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={EASE_OUT}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              <NativeSelect
                aria-label="Добавить участника"
                value={uid}
                onChange={(e) => setUid(e.target.value)}
              >
                <option value="">Выберите сотрудника…</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || "Сотрудник"}
                  </option>
                ))}
              </NativeSelect>
              <div className="flex justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => {
                    setAdding(false);
                    setUid("");
                  }}
                >
                  Отмена
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-full px-3.5"
                  disabled={!uid || m.isPending}
                  onClick={() => m.mutate()}
                >
                  Добавить
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type TaskDetailProps = { task: Task; data: WS; onSelect: (id: string) => void };

/**
 * TaskDetail reads only the slices of the workspace compared here: the task
 * itself, its subtasks and parent, its running timers, profiles, projects,
 * members, the user id and task titles (history labels). Task objects stay
 * referentially stable while unchanged (React Query structural sharing), so a
 * change of another task or another task's timer does not re-render it.
 */
function sameTaskDetailInputs(prev: TaskDetailProps, next: TaskDetailProps) {
  if (prev.task !== next.task || prev.onSelect !== next.onSelect) return false;
  const a = prev.data;
  const b = next.data;
  if (a === b) return true;
  if (a.userId !== b.userId || a.profiles !== b.profiles || a.projects !== b.projects || a.members !== b.members) return false;
  const id = next.task.id;
  const runA = a.running.filter((r) => r.task_id === id);
  const runB = b.running.filter((r) => r.task_id === id);
  if (runA.length !== runB.length || runA.some((r, i) => r !== runB[i])) return false;
  if (a.tasks.length !== b.tasks.length) return false;
  for (let i = 0; i < b.tasks.length; i += 1) {
    const x = a.tasks[i]!;
    const y = b.tasks[i]!;
    if (x === y) continue;
    // Another task changed: relevant only as a subtask, the parent, or a title shown in history.
    if (x.id !== y.id || x.title !== y.title) return false;
    if (y.parent_task_id === id || x.parent_task_id === id || y.id === next.task.parent_task_id) return false;
  }
  return true;
}

const TaskDetail = memo(TaskDetailView, sameTaskDetailInputs);

function TaskDetailView({ task, data, onSelect }: TaskDetailProps) {
  const qc = useQueryClient();
  const transition = useServerFn(transitionTask);
  const update = useServerFn(updateTask);
  const fetchActivity = useServerFn(getTaskActivity);
  const activity = useQuery({ queryKey: ["nexa", "activity", task.id], queryFn: () => fetchActivity({ data: { taskId: task.id } }) });

  const myRunning = data.running.some((r) => r.task_id === task.id && r.user_id === data.userId);
  const subtasks = data.tasks.filter((t) => t.parent_task_id === task.id);
  const parent = data.tasks.find((t) => t.id === task.parent_task_id);
  const assigneeProfile = task.assignee_id ? data.profiles.find((p) => p.id === task.assignee_id) ?? null : null;
  const [report, setReport] = useState("");
  const [showReport, setShowReport] = useState(false);
  // UI-only: the subtask composer stays collapsed until requested.
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [priorityDraft, setPriorityDraft] = useState(task.priority);
  const [assigneeDraft, setAssigneeDraft] = useState(task.assignee_id ?? "");
  const [estimateDraft, setEstimateDraft] = useState(task.estimated_seconds ? String(task.estimated_seconds / 3600) : "");
  const [dueDraft, setDueDraft] = useState(toLocalDateTime(task.due_at));
  // UI-only: which half of the discussion is shown, folded lists, and the
  // manual-progress value while the slider is being dragged.
  const [discussion, setDiscussion] = useState<"comments" | "history">("comments");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showIntervals, setShowIntervals] = useState(false);
  const [manualDraft, setManualDraft] = useState<number | null>(null);
  const [seenProgress, setSeenProgress] = useState(task.progress);
  if (seenProgress !== task.progress) {
    setSeenProgress(task.progress);
    setManualDraft(null);
  }
  const formId = useId();

  const act = useMutation({
    mutationFn: (v: { action: Action; report?: string }) =>
      transition({ data: { taskId: task.id, action: v.action, sessionId: getNexaSessionId(), ...(v.report ? { report: v.report } : {}) } }),
    onSuccess: () => {
      invalidateTaskData(qc);
      setShowReport(false);
      setReport("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = useMutation({
    mutationFn: (p: Parameters<typeof update>[0]["data"]) => update({ data: p }),
    onSuccess: () => invalidateTaskData(qc),
    onError: (e: Error) => toast.error(e.message),
  });

  // Completed project: no new timer intervals (enforced by a DB trigger too).
  const projectDone = isCompleted(data.projects.find((p) => p.id === task.project_id));
  const actions: { a: Action; label: string; icon: React.ReactNode; primary?: boolean }[] = [];
  if (task.status === "todo" && !projectDone) actions.push({ a: "start", label: "Начать", icon: <Play className="h-4 w-4" />, primary: true });
  if (task.status === "in_progress" && myRunning) actions.push({ a: "pause", label: "Пауза", icon: <Pause className="h-4 w-4" /> });
  if ((task.status === "in_progress" || task.status === "waiting") && !myRunning && !projectDone)
    actions.push({ a: "resume", label: "Возобновить", icon: <Play className="h-4 w-4" />, primary: true });
  if (task.status === "in_progress") actions.push({ a: "wait", label: "В ожидание", icon: <Hourglass className="h-4 w-4" /> });
  if (task.status === "done") actions.push({ a: "reopen", label: "Переоткрыть", icon: <RotateCcw className="h-4 w-4" /> });

  const est = task.estimated_seconds;
  const timerLive = data.running.some((r) => r.task_id === task.id);
  const history = activity.data?.history ?? [];
  const entries = activity.data?.entries ?? [];

  const comments = activity.data?.comments ?? NO_COMMENTS;
  const visibleHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const manualValue = manualDraft ?? task.progress;
  const due = dueLabel(task);
  const openEditor = () => {
    setTitleDraft(task.title);
    setDescriptionDraft(task.description ?? "");
    setPriorityDraft(task.priority);
    setAssigneeDraft(task.assignee_id ?? "");
    setEstimateDraft(task.estimated_seconds ? String(task.estimated_seconds / 3600) : "");
    setDueDraft(toLocalDateTime(task.due_at));
    setEditing((value) => !value);
  };

  return (
    <article className="@container space-y-4">
      {/* Header: title, description and properties */}
      <section className="rounded-card border border-border bg-card p-5 sm:p-6">
        {/* Number (and parent) with the edit control on one line, so the
            title below gets the full width of the card. */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
            <span className="font-mono">#{task.number}</span>
            {parent && (
              <>
                <span aria-hidden>·</span>
                <span>подзадача</span>
                <button
                  type="button"
                  className="min-w-0 max-w-full truncate rounded text-foreground-secondary underline-offset-2 transition-colors hover:text-primary hover:underline"
                  onClick={() => onSelect(parent.id)}
                >
                  <span className="font-mono">#{parent.number}</span> {parent.title}
                </button>
              </>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 w-8 shrink-0 rounded-full px-0 sm:w-auto sm:px-3"
            aria-label={editing ? "Закрыть редактирование" : "Изменить задачу"}
            aria-expanded={editing}
            onClick={openEditor}
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{editing ? "Закрыть" : "Изменить"}</span>
          </Button>
        </div>
        {/* Long titles (they can be whole sentences) step down one size. */}
        <h2
          className={`mt-2 break-words ${task.title.length > 80 ? "text-title-3" : "text-title-2"}`}
        >
          {task.title}
        </h2>
        {task.description && (
          <p className="mt-3 whitespace-pre-wrap break-words text-reading text-foreground-secondary">
            {task.description}
          </p>
        )}

        {/* Properties: four quiet tiles and the people row. */}
        <dl className="mt-5 grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          <Property label="Статус" icon={<StatusIcon status={task.status} className="scale-90" />}>
            {STATUS_LABEL[task.status]}
          </Property>
          <Property
            label="Приоритет"
            icon={<Flag aria-hidden className="h-3.5 w-3.5" />}
            className={
              task.priority === "critical"
                ? "text-destructive"
                : task.priority === "high"
                  ? "text-warning"
                  : ""
            }
          >
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </Property>
          <Property
            label="Срок"
            icon={<CalendarDays aria-hidden className="h-3.5 w-3.5" />}
            className={
              due?.overdue ? "text-destructive" : task.due_at ? "" : "text-muted-foreground"
            }
          >
            {task.due_at
              ? new Date(task.due_at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Не задан"}
          </Property>
          <Property
            label="Оценка"
            icon={<Clock aria-hidden className="h-3.5 w-3.5" />}
            className={est ? "tabular-nums" : "text-muted-foreground"}
          >
            {est ? formatDuration(est) : "Не задана"}
          </Property>
        </dl>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-xl border border-border bg-background/40 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {assigneeProfile ? (
              <ProfileAvatar
                avatarUrl={assigneeProfile.avatar_url}
                name={assigneeProfile.full_name || "Сотрудник"}
                initials={initialsOf(assigneeProfile.full_name || "С")}
                className="h-8 w-8 rounded-full"
                fallbackClassName="text-[11px]"
              />
            ) : (
              <span className="h-8 w-8 shrink-0 rounded-full border border-dashed border-border-strong" />
            )}
            <div className="min-w-0">
              <div className="text-caption text-muted-foreground">Исполнитель</div>
              <div className="text-callout font-medium">
                {task.assignee_id ? (
                  <PersonOrUnavailable data={data} id={task.assignee_id} className="break-words" />
                ) : (
                  <span className="text-muted-foreground">Без исполнителя</span>
                )}
              </div>
            </div>
          </div>
          {timerLive && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-callout">
              <LiveBadge />
              <span className="text-muted-foreground">Сейчас работает:</span>
              {workersOf(data, task.id).map((id, i) => (
                <span key={id} className="min-w-0">
                  {i > 0 && ", "}
                  <PersonOrUnavailable data={data} id={id} className="break-words" />
                </span>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {editing && (
            <motion.div key="edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
              <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/50 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-title`}>Название</Label>
                  <Input
                    id={`${formId}-title`}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-description`}>Описание</Label>
                  <Textarea
                    id={`${formId}-description`}
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    placeholder="Что нужно сделать, ссылки, детали"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-priority`}>Приоритет</Label>
                    <NativeSelect
                      id={`${formId}-priority`}
                      icon={Flag}
                      value={priorityDraft}
                      onChange={(e) => setPriorityDraft(e.target.value as typeof task.priority)}
                    >
                      {Object.entries(PRIORITY_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-assignee`}>Исполнитель</Label>
                    <NativeSelect
                      id={`${formId}-assignee`}
                      icon={UserRound}
                      value={assigneeDraft}
                      onChange={(e) => setAssigneeDraft(e.target.value)}
                    >
                      <option value="">Без исполнителя</option>
                      {membersOf(data, task.project_id).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name || "Сотрудник"}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-estimate`}>Оценка, ч</Label>
                    <Input
                      id={`${formId}-estimate`}
                      type="number"
                      min="0"
                      step="0.25"
                      value={estimateDraft}
                      onChange={(e) => setEstimateDraft(e.target.value)}
                      inputMode="decimal"
                      placeholder="Например, 1,5"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-due`}>Срок</Label>
                    <Input
                      id={`${formId}-due`}
                      type="datetime-local"
                      value={dueDraft}
                      onChange={(e) => setDueDraft(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
                  <Button size="sm" className="rounded-full px-4" disabled={patch.isPending || titleDraft.trim().length < 2} onClick={() => patch.mutate({
                    taskId: task.id,
                    title: titleDraft,
                    description: descriptionDraft || null,
                    priority: priorityDraft,
                    assigneeId: assigneeDraft || null,
                    estimatedSeconds: Math.round((parseFloat(estimateDraft.replace(",", ".")) || 0) * 3600),
                    dueAt: dueDraft ? new Date(dueDraft).toISOString() : null,
                  })}>Сохранить</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Work: timer, progress, actions, report and time intervals. */}
      <section
        aria-label="Работа"
        className={`relative overflow-hidden rounded-card border bg-card p-5 sm:p-6 ${myRunning ? "luno-timer-live" : "border-border"}`}
      >
        <LiveSpent task={task} running={data.running}>
          {(spent) => {
            const over = est > 0 && spent > est;
            const shown = displayedProgress(task, subtasks.length > 0, spent);
            return (
              <div className="relative flex items-center gap-5">
                <ProgressRing
                  value={shown.value}
                  size={88}
                  stroke={6}
                  tone={shown.source === "done" ? "success" : "primary"}
                >
                  <span
                    className={`text-title-3 tabular-nums ${shown.value === null ? "text-muted-foreground" : ""}`}
                  >
                    {shown.value === null ? "—" : `${shown.value}%`}
                  </span>
                </ProgressRing>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-callout text-muted-foreground">
                    Затрачено
                    {timerLive && <LiveBadge />}
                  </div>
                  <RollingTime
                    value={formatDuration(spent)}
                    className={`mt-0.5 text-timer transition-colors duration-300 ${over ? "text-destructive" : myRunning ? "text-primary" : timerLive ? "text-foreground" : "text-foreground/85"}`}
                  />
                  <div className="mt-1 text-callout text-muted-foreground">
                    {est ? (
                      <>
                        из {formatDuration(est)} по оценке
                        {over && <span className="text-destructive"> · превышено</span>}
                      </>
                    ) : (
                      "Оценка не задана"
                    )}
                  </div>
                  <div className="mt-0.5 text-caption text-muted-foreground">
                    {PROGRESS_SOURCE[shown.value === null ? "none" : shown.source]}
                  </div>
                </div>
              </div>
            );
          }}
        </LiveSpent>

        {/* Manual progress stays editable for leaf tasks; it is the shown value only without an estimate. */}
        {!subtasks.length && task.status !== "done" && (
          <div className="relative mt-4 flex items-center gap-3">
            <span className="shrink-0 text-callout text-muted-foreground">Вручную</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              defaultValue={task.progress}
              style={{ "--range-fill": `${manualValue}%` } as React.CSSProperties}
              onInput={(e) => setManualDraft(Number(e.currentTarget.value))}
              onMouseUp={(e) =>
                patch.mutate({
                  taskId: task.id,
                  progress: Number((e.target as HTMLInputElement).value),
                })
              }
              onKeyUp={(e) =>
                patch.mutate({
                  taskId: task.id,
                  progress: Number((e.target as HTMLInputElement).value),
                })
              }
              className="luno-range min-w-0 flex-1"
              aria-label="Прогресс выполнения"
            />
            <span className="w-10 shrink-0 text-right text-callout tabular-nums text-foreground-secondary">
              {manualValue}%
            </span>
          </div>
        )}

        {/* Completed project: start/resume are not offered; say why instead of leaving a gap. */}
        {projectDone && !myRunning && task.status !== "done" && (
          <p className="relative mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1 text-caption text-foreground-secondary">
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            Проект завершён — таймер недоступен
          </p>
        )}
        {(actions.length > 0 || task.status === "in_progress" || task.status === "waiting") && (
          <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {actions.map((x) => (
              <Button
                key={x.a}
                variant={x.primary || x.a === "pause" ? "default" : "secondary"}
                className="h-10 rounded-full px-4"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: x.a })}
              >
                {x.icon}
                {x.label}
              </Button>
            ))}
            {(task.status === "in_progress" || task.status === "waiting") && (
              <Button
                variant="secondary"
                className={`h-10 rounded-full px-4 ${showReport ? "ring-1 ring-primary/50" : ""}`}
                aria-expanded={showReport}
                onClick={() => setShowReport((v) => !v)}
              >
                <CheckCircle2 className="h-4 w-4" />
                Завершить
              </Button>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {showReport && (
            <motion.div
              key="report-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={EASE_OUT}
              className="relative overflow-hidden"
            >
              <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/50 p-4">
                <Label htmlFor={`${formId}-report`} className="text-body font-medium">
                  Отчёт о выполнении
                </Label>
                <Textarea
                  id={`${formId}-report`}
                  value={report}
                  onChange={(e) => setReport(e.target.value)}
                  placeholder="Что сделано, результат, ссылки"
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="rounded-full px-4"
                    disabled={report.trim().length < 3 || act.isPending}
                    onClick={() => act.mutate({ action: "complete", report })}
                  >
                    Завершить с отчётом
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {task.completion_report && (
            <motion.div
              key="completion"
              {...fadeUp}
              transition={EASE_OUT}
              className="relative mt-5 rounded-xl border border-success/25 bg-success/[0.07] p-4"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-callout font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                Отчёт при завершении
              </div>
              <p className="whitespace-pre-wrap break-words text-body text-foreground">
                {task.completion_report}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {entries.length > 0 && (
          <div className="relative mt-4 border-t border-border pt-3">
            <button
              type="button"
              aria-expanded={showIntervals}
              onClick={() => setShowIntervals((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-callout text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <Timer aria-hidden className="h-4 w-4" />
                Интервалы времени
                <span className="tabular-nums">{entries.length}</span>
              </span>
              <ChevronDown
                aria-hidden
                className={`h-4 w-4 transition-[rotate] duration-300 ease-(--ease-spring) ${showIntervals ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence initial={false}>
              {showIntervals && (
                <motion.ul
                  key="intervals"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={EASE_OUT}
                  className="overflow-hidden"
                >
                  {entries.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-caption text-muted-foreground first:mt-2"
                    >
                      <span className="min-w-0">
                        <PersonName data={data} id={e.user_id} /> ·{" "}
                        {new Date(e.started_at).toLocaleString("ru-RU", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground-secondary">
                        {e.ended_at ? formatDuration(e.duration_seconds ?? 0) : "идёт…"}
                      </span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Structure: subtasks */}
      <section
        aria-label="Подзадачи"
        className="rounded-card border border-border bg-card p-5 sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-baseline gap-2 text-title-3">
            Подзадачи
            <span className="text-body font-normal tabular-nums text-muted-foreground">
              {subtasks.length}
            </span>
          </h3>
          {task.status !== "done" && !projectDone && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-full px-3"
              aria-expanded={subtaskFormOpen}
              onClick={() => setSubtaskFormOpen((open) => !open)}
            >
              <Plus
                className={`h-4 w-4 transition-[rotate] duration-300 ease-(--ease-spring) ${subtaskFormOpen ? "rotate-45" : ""}`}
              />
              Подзадача
            </Button>
          )}
        </div>
        {subtasks.length === 0 && !subtaskFormOpen && (
          <p className="mt-2 text-callout text-muted-foreground">
            Подзадач пока нет. С ними прогресс задачи считается автоматически.
          </p>
        )}
        {subtasks.length > 0 && (
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/40">
            <AnimatePresence initial={false}>
              {subtasks.map((st) => (
                <motion.button
                  key={st.id}
                  type="button"
                  {...fadeUp}
                  transition={EASE_OUT}
                  onClick={() => onSelect(st.id)}
                  title={st.title}
                  className="group/sub flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <StatusIcon status={st.status} />
                  <span className="font-mono text-caption text-muted-foreground">#{st.number}</span>
                  <span
                    className={`min-w-0 flex-1 truncate text-body ${st.status === "done" ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
                  >
                    {st.title}
                  </span>
                  <span className="hidden text-caption text-muted-foreground sm:inline">
                    {STATUS_LABEL[st.status]}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-[translate,color] duration-200 group-hover/sub:translate-x-0.5 group-hover/sub:text-foreground"
                  />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence initial={false}>
          {task.status !== "done" && !projectDone && subtaskFormOpen && (
            <motion.div key="subtask-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
              <div className="mt-3">
                <NewTask projectId={task.project_id} members={membersOf(data, task.project_id)} parentId={task.id} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Discussion: comments and history behind one segmented control. */}
      <section
        aria-label="Обсуждение"
        className="rounded-card border border-border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-title-3">Обсуждение</h3>
          <Segmented
            label="Раздел обсуждения"
            pillId="discussion-pill"
            value={discussion}
            onChange={setDiscussion}
            options={[
              [
                "comments",
                <>
                  Комментарии{" "}
                  <span className="tabular-nums text-muted-foreground">{comments.length}</span>
                </>,
              ],
              [
                "history",
                <>
                  История{" "}
                  <span className="tabular-nums text-muted-foreground">{history.length}</span>
                </>,
              ],
            ]}
          />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {discussion === "comments" ? (
            <motion.div key="comments" {...fadeUp} transition={EASE_OUT}>
              <Comments taskId={task.id} data={data} comments={comments} />
            </motion.div>
          ) : (
            <motion.div key="history" {...fadeUp} transition={EASE_OUT}>
              <ol className="mt-5">
                {visibleHistory.map((h, index) => (
                  <motion.li
                    key={h.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ ...EASE_OUT, delay: Math.min(index, 8) * 0.025 }}
                    className="relative flex gap-3 pb-4 last:pb-0"
                  >
                    <span aria-hidden className="relative flex w-4 shrink-0 justify-center">
                      <span
                        className={`mt-1 h-2 w-2 rounded-full ring-4 ring-card ${historyDot(h.action)}`}
                      />
                      {index < visibleHistory.length - 1 && (
                        <span className="absolute bottom-[-0.25rem] top-4 w-px bg-border" />
                      )}
                    </span>
                    <span className="min-w-0 text-callout">
                      <span className="text-foreground">{describe(h, data)}</span>
                      <span className="mt-0.5 block text-caption text-muted-foreground">
                        <PersonName data={data} id={h.actor_id} /> ·{" "}
                        {new Date(h.created_at).toLocaleString("ru-RU", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </span>
                  </motion.li>
                ))}
                {history.length === 0 && (
                  <li className="text-callout text-muted-foreground">Пока нет событий.</li>
                )}
              </ol>
              {history.length > HISTORY_PREVIEW && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 h-8 rounded-full px-3 text-muted-foreground"
                  onClick={() => setShowAllHistory((v) => !v)}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-[rotate] duration-300 ease-(--ease-spring) ${showAllHistory ? "rotate-180" : ""}`}
                  />
                  {showAllHistory ? "Свернуть" : `Показать все · ${history.length}`}
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </article>
  );
}

/** Events shown before "Показать все" in the task history. */
const HISTORY_PREVIEW = 6;

const PROGRESS_SOURCE = {
  done: "Прогресс · задача завершена",
  subtasks: "Прогресс · по подзадачам",
  time: "Прогресс · по времени",
  manual: "Прогресс · вручную",
  none: "Прогресс не задан",
} as const;

/** Colour of a history event's dot: creation and completion green, status and timer orange. */
function historyDot(action: string) {
  if (action === "created" || action === "completed_with_report") return "bg-success";
  if (action === "status_changed" || action === "reopened" || action.startsWith("timer_"))
    return "bg-primary";
  return "bg-muted-foreground/70";
}

/** One property tile of the task header. `className` tints the value. */
function Property({
  label,
  icon,
  children,
  className = "",
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 flex min-w-0 items-center gap-1.5 text-callout font-medium ${className}`}
      >
        {icon}
        <span className="truncate">{children}</span>
      </dd>
    </div>
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Human-readable labels for the task fields written by tasks_log_history.
const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  description: "Описание",
  priority: "Приоритет",
  assignee_id: "Исполнитель",
  estimated_seconds: "Оценка",
  progress: "Прогресс",
  parent_task_id: "Родительская задача",
  due_at: "Срок",
  status: "Статус",
};

/** Presentation only: turns a history row into readable Russian text, never raw ids. */
function describe(h: { action: string; field: string | null; old_value: unknown; new_value: unknown }, data: WS) {
  const value = (raw: unknown): string => {
    if (raw == null || raw === "") return "—";
    const text = String(raw);
    switch (h.field) {
      case "status": return STATUS_LABEL[text] ?? text;
      case "priority": return PRIORITY_LABEL[text] ?? text;
      case "assignee_id": return nameOf(data, text);
      case "parent_task_id": {
        const parent = data.tasks.find((t) => t.id === text);
        return parent ? `#${parent.number}` : "другая задача";
      }
      case "estimated_seconds": return Number(raw) > 0 ? formatDuration(Number(raw)) : "—";
      case "progress": return `${Number(raw)}%`;
      case "due_at": {
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
      }
      default: return UUID_PATTERN.test(text) ? "—" : text;
    }
  };
  switch (h.action) {
    case "created": return "создал задачу";
    case "status_changed": return `Статус: ${value(h.old_value)} → ${value(h.new_value)}`;
    case "field_changed": {
      const label = h.field ? FIELD_LABEL[h.field] : undefined;
      if (!label) return "обновил задачу";
      if (h.field === "description") return "изменил описание";
      return `${label}: ${value(h.old_value)} → ${value(h.new_value)}`;
    }
    case "timer_started": return "запустил таймер";
    case "timer_stopped": return "остановил таймер";
    case "completed_with_report": return "завершил с отчётом";
    case "reopened": return "переоткрыл задачу";
    case "comment_added": return "оставил комментарий";
    case "reply_added": return "ответил на комментарий";
    default: return "обновил задачу";
  }
}

type Comment = Awaited<ReturnType<typeof getTaskActivity>>["comments"][number];

const NO_COMMENTS: Comment[] = [];

type CommentsProps = { taskId: string; data: WS; comments: Comment[] };

/** Comments depend on the task, its comment list and author profiles only. */
const Comments = memo(CommentsView, (prev: CommentsProps, next: CommentsProps) =>
  prev.taskId === next.taskId && prev.comments === next.comments && prev.data.profiles === next.data.profiles);

function CommentsView({ taskId, data, comments }: CommentsProps) {
  const qc = useQueryClient();
  const add = useServerFn(addComment);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const m = useMutation({
    mutationFn: (v: { body: string; parent: string | null }) => add({ data: { taskId, body: v.body, parentCommentId: v.parent } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexa", "activity", taskId] });
      setBody("");
      setReply("");
      setReplyTo(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const roots = useMemo(() => comments.filter((c) => !c.parent_comment_id), [comments]);
  const renderC = (c: Comment, depth: number): React.ReactNode => {
    const author = nameOf(data, c.author_id);
    const profile = data.profiles.find((item) => item.id === c.author_id);
    const replies = comments.filter((r) => r.parent_comment_id === c.id);
    return (
      <motion.div
        key={c.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={EASE_OUT}
        className={depth > 0 ? "ml-4 border-l border-border pl-4" : ""}
      >
        <div className="flex gap-3 py-3">
          <ProfileAvatar
            avatarUrl={profile?.avatar_url}
            name={author}
            initials={initialsOf(author)}
            className={`${depth > 0 ? "h-7 w-7" : "h-8 w-8"} shrink-0 rounded-full`}
            fallbackClassName="text-[10px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <EmployeeName
                name={author}
                isVip={profile?.is_vip}
                className="text-callout font-semibold text-foreground"
              />
              <span className="text-caption text-muted-foreground">
                {new Date(c.created_at).toLocaleString("ru-RU", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-body text-foreground/90">
              {c.body}
            </p>
            <button
              type="button"
              aria-expanded={replyTo === c.id}
              className="mt-1.5 inline-flex items-center gap-1 rounded text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
            >
              <Reply aria-hidden className="h-3.5 w-3.5" />
              Ответить
            </button>
            <AnimatePresence initial={false}>
              {replyTo === c.id && (
                <motion.div key="reply" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
                  <div className="mt-2 flex gap-2 p-px">
                    <Input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      className="h-9"
                      placeholder={`Ответ для ${shortName(author)}`}
                      aria-label="Текст ответа"
                    />
                    <Button
                      size="sm"
                      className="h-9 shrink-0 rounded-full px-3.5"
                      disabled={!reply.trim() || m.isPending}
                      onClick={() => m.mutate({ body: reply, parent: c.id })}
                    >
                      Отправить
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        {replies.map((r) => renderC(r, depth + 1))}
      </motion.div>
    );
  };
  return (
    <div className="mt-3">
      {roots.length > 0 ? (
        <div className="divide-y divide-border">
          <AnimatePresence initial={false}>{roots.map((c) => renderC(c, 0))}</AnimatePresence>
        </div>
      ) : (
        <p className="py-3 text-callout text-muted-foreground">
          Комментариев пока нет — начните обсуждение.
        </p>
      )}
      {/* Composer: one field with the send button inside, like a message bar. */}
      <div className="mt-3 rounded-2xl border border-input bg-field transition-[border-color,box-shadow] duration-150 focus-within:border-primary/70 focus-within:ring-[3px] focus-within:ring-primary/20 hover:border-border-strong">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Написать комментарий"
          aria-label="Текст комментария"
          className="min-h-[4.5rem] resize-none border-0 bg-transparent px-3.5 pt-3 shadow-none hover:border-0 focus-visible:ring-0"
        />
        <div className="flex justify-end px-2 pb-2">
          <Button
            size="sm"
            className="h-8 rounded-full px-3.5"
            disabled={!body.trim() || m.isPending}
            onClick={() => m.mutate({ body, parent: null })}
          >
            <ArrowUp className="h-4 w-4" />
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}
