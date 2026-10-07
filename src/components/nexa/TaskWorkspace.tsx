import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pause, Play, CheckCircle2, RotateCcw, Hourglass, MessageSquare, History, CornerDownRight, ListChecks, Plus, Users, ChevronLeft, MoreHorizontal } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type Action = "start" | "pause" | "resume" | "wait" | "complete" | "reopen";

export const STATUS_LABEL: Record<string, string> = {
  todo: "Новая",
  in_progress: "В работе",
  waiting: "В ожидании",
  done: "Завершена",
};
const PRIORITY_LABEL: Record<string, string> = { low: "Низкий", medium: "Средний", high: "Высокий", critical: "Критический" };
const WS_KEY = ["nexa", "workspace"] as const;

/**
 * Task and timer changes affect only the workspace (tasks, timers, Overview
 * share this key) and task activity (history is written by a tasks trigger).
 * Directory, notifications and avatar URLs do not depend on tasks.
 */
function invalidateTaskData(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: WS_KEY });
  void qc.invalidateQueries({ queryKey: ["nexa", "activity"] });
}

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
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export type RealtimeState = "connecting" | "live" | "offline";

/**
 * The single realtime subscription for task data, shared by the Tasks tab and
 * Overview (only one of them is mounted at a time, so there is one channel).
 * Changes refresh only the workspace and task activity caches (P1). Returns
 * the actual channel state for the LIVE indicator.
 */
export function useTaskRealtime(): RealtimeState {
  const qc = useQueryClient();
  const [state, setState] = useState<RealtimeState>("connecting");
  useEffect(() => {
    const ch = supabase
      .channel("nexa-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => invalidateTaskData(qc))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_time_entries" }, () => invalidateTaskData(qc))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, () => qc.invalidateQueries({ queryKey: ["nexa", "activity"] }))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects" }, () => void qc.invalidateQueries({ queryKey: WS_KEY }))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("offline");
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  return state;
}

export function TaskWorkspace() {
  const { session, loading } = useAuth();
  if (loading) return <div className="text-sm text-muted-foreground">Загрузка…</div>;
  if (!session)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">Задачи</h1>
        <p className="mt-2 text-sm text-muted-foreground">Войдите, чтобы работать с задачами, таймером и отчётами.</p>
        <Button asChild className="mt-5 active:scale-[0.97]">
          <Link to="/auth">Войти</Link>
        </Button>
      </div>
    );
  return <Workspace />;
}

function Workspace() {
  const qc = useQueryClient();
  const fetchWs = useServerFn(getWorkspace);
  const ensure = useServerFn(ensureProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensure({ data: {} })
      .then(() => setReady(true))
      .catch((e: Error) => toast.error(e.message));
  }, [ensure]);

  const ws = useQuery({ queryKey: WS_KEY, queryFn: () => fetchWs(), enabled: ready });

  useTaskRealtime();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  // UI-only: whether the "new task" composer is expanded.
  const [composerOpen, setComposerOpen] = useState(false);
  const data = ws.data;

  useEffect(() => {
    if (data && !projectId && data.projects[0]) setProjectId(data.projects[0].id);
  }, [data, projectId]);

  if (!ready || ws.isLoading) return <div className="text-sm text-muted-foreground">Загрузка рабочего пространства…</div>;
  if (ws.error) return <div className="text-sm text-destructive">{(ws.error as Error).message}</div>;
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
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.projects.length > 0
                ? `${data.projects.length} ${plural(data.projects.length, "проект", "проекта", "проектов")} · ${openTotal} ${plural(openTotal, "открытая задача", "открытые задачи", "открытых задач")}`
                : "Рабочее пространство"}
            </p>
          </div>
          <NewProject onCreated={selectProject} />
        </div>

        {!project ? (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium">Проектов пока нет</div>
              <p className="mt-0.5 text-muted-foreground">Создайте проект (доступно администратору и менеджеру) или попросите руководителя добавить вас в существующий.</p>
            </div>
          </div>
        ) : (
          <div className="grid overflow-clip rounded-xl border border-border bg-card lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,0.92fr)_minmax(0,1.08fr)]">
            {/* 1. Projects */}
            <aside aria-label="Проекты" className={`flex-col border-border bg-background/40 lg:flex lg:border-r xl:row-span-1 lg:row-span-2 ${selected ? "hidden" : "flex"}`}>
              <div className="flex flex-1 flex-col xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:flex-none">
              <div className="hidden px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-foreground/55 lg:block">Проекты · {data.projects.length}</div>
              {/* Mobile: compact project selector */}
              <div className="border-b border-border px-4 py-3 lg:hidden">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground" htmlFor="task-project">Проект</label>
                <select
                  id="task-project"
                  value={projectId ?? ""}
                  onChange={(e) => selectProject(e.target.value)}
                  className="h-9 w-full truncate rounded-md border border-border bg-card px-2.5 text-sm"
                >
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} · {p.name}{isCompleted(p) ? " · Завершён" : ""}</option>
                  ))}
                </select>
              </div>
              <nav className="hidden flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 lg:block">
                {data.projects.map((p) => {
                  const active = p.id === projectId;
                  const done = isCompleted(p);
                  const own = data.tasks.filter((t) => t.project_id === p.id);
                  const open = own.filter((t) => t.status !== "done").length;
                  const count = own.length > 0 ? `${own.length} ${plural(own.length, "задача", "задачи", "задач")}` : "Нет задач";
                  return (
                    <div key={p.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => selectProject(p.id)}
                        aria-current={active ? "true" : undefined}
                        title={`${p.code} · ${p.name}${done ? ` · ${completedLabel(p)}` : ""}`}
                        className={`relative flex w-full items-center gap-2.5 rounded-lg py-2 pl-2 pr-9 text-left transition-colors ${active ? "bg-secondary/70" : "hover:bg-secondary/35"}`}
                      >
                        {active && <span aria-hidden className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${done ? "bg-foreground/35" : "bg-primary/80"}`} />}
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-semibold uppercase tracking-wide ${done ? "border-border bg-secondary/40 text-foreground/55" : active ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-border bg-card text-muted-foreground"}`}>
                          {p.code.slice(0, 3)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`line-clamp-2 text-[14px] leading-tight ${done ? `font-medium ${active ? "text-foreground/85" : "text-foreground/70"}` : active ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>{p.name}</span>
                          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                            {done && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary/70 px-1.5 py-px text-[10px] font-medium text-foreground/65"><CheckCircle2 aria-hidden className="h-2.5 w-2.5" />Завершён</span>}
                            <span className="truncate">{count}</span>
                          </span>
                        </span>
                        {!done && open > 0 && (
                          <span title={`Открытых задач: ${open}`} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${active ? "bg-primary/[0.12] text-primary" : "bg-secondary/70 text-muted-foreground"}`}>{open}</span>
                        )}
                      </button>
                      <ProjectMenu project={p} userId={data.userId} className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${active ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"}`} />
                    </div>
                  );
                })}
              </nav>
              <div className="mt-auto hidden lg:block">
                <Members data={data} projectId={project.id} />
              </div>
              </div>
            </aside>

            {/* 2. Tasks of the selected project */}
            <section aria-label="Задачи проекта" className={`min-w-0 flex-col border-border lg:flex xl:border-r ${selected ? "hidden" : "flex"}`}>
              <div className="flex flex-1 flex-col xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:flex-none xl:overflow-y-auto">
              <div className="border-b border-border px-4 pb-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{project.code}</div>
                    <h2 className="truncate text-base font-semibold tracking-tight" title={project.name}>{project.name}</h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {projectCompleted ? (
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 text-[11px] font-medium text-foreground/70">
                        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                        {completedLabel(project)}
                      </span>
                    ) : (
                      <Button size="sm" className="h-8 active:scale-[0.97]" aria-expanded={composerOpen} onClick={() => setComposerOpen((open) => !open)}>
                        <Plus className="h-4 w-4" />
                        Задача
                      </Button>
                    )}
                    <ProjectMenu project={project} userId={data.userId} className="lg:hidden" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex h-8 items-center rounded-md border border-border bg-background/40 p-0.5">
                    {([
                      [false, "Все задачи"],
                      [true, "Мои задачи"],
                    ] as const).map(([mine, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={mineOnly === mine}
                        onClick={() => {
                          setMineOnly(mine);
                          setTaskId(null);
                        }}
                        className={`relative h-full rounded px-2.5 text-xs transition-colors ${mineOnly === mine ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {mineOnly === mine && <motion.span layoutId="task-filter-pill" transition={SOFT_SPRING} className="absolute inset-0 rounded bg-secondary" />}
                        <span className="relative">{label}</span>
                      </button>
                    ))}
                  </div>
                  <StatusSummary tasks={tasks} />
                </div>
              </div>
              <AnimatePresence initial={false}>
                {composerOpen && !projectCompleted && (
                  <motion.div key="composer" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden border-b border-border">
                    <div className="p-3">
                      <NewTask projectId={project.id} members={membersOf(data, project.id)} parentId={null} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={filterKey} {...fadeUp} transition={EASE_OUT} className="flex-1 p-2">
                  <TaskTree tasks={tasks} running={data.running} selectedId={taskId} onSelect={setTaskId} userId={data.userId} mineOnly={mineOnly} data={data} onCreate={composerOpen || projectCompleted ? undefined : () => setComposerOpen(true)} onShowAll={() => setMineOnly(false)} completed={projectCompleted} />
                </motion.div>
              </AnimatePresence>
              <div className="lg:hidden">
                <Members data={data} projectId={project.id} />
              </div>
              </div>
            </section>

            {/* 3. Selected task */}
            <section aria-label="Детали задачи" className={`min-w-0 border-t border-border lg:col-start-2 lg:block xl:col-start-auto xl:border-t-0 xl:bg-background/30 xl:shadow-[inset_1px_0_0_oklch(1_0_0/0.05)] ${selected ? "block border-t-0" : "hidden"}`}>
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  <motion.div key={selected.id} {...fadeUp} transition={EASE_OUT}>
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 lg:hidden">
                      <Button variant="ghost" size="sm" className="h-8 -ml-2 text-muted-foreground" onClick={() => setTaskId(null)}>
                        <ChevronLeft className="h-4 w-4" />
                        Задачи
                      </Button>
                      <span className="truncate text-xs text-muted-foreground">{project.code} · {project.name}</span>
                    </div>
                    <TaskDetail task={selected} data={data} onSelect={setTaskId} />
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EASE_OUT} className="px-6 py-8">
                    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border px-4 py-4">
                      <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Задача не выбрана</div>
                        <p className="mt-0.5 text-sm text-muted-foreground">Выберите задачу в списке, чтобы увидеть таймер, подзадачи, комментарии и историю.</p>
                      </div>
                    </div>
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
            className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-56 p-1">
          <div className="truncate px-2 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{project.code} · {project.name}</div>
          <DropdownMenuItem disabled={!allowed || m.isPending} onSelect={() => setConfirmOpen(true)} className="gap-2.5 rounded-md px-2 py-2 text-[13px]">
            {completed ? <RotateCcw className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
            {completed ? "Открыть проект заново" : "Завершить проект"}
          </DropdownMenuItem>
          {rights.isFetching && <div className="px-2 pb-1.5 pt-0.5 text-[11px] text-muted-foreground">Проверяем права…</div>}
          {!rights.isFetching && rights.data === false && (
            <div className="px-2 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">Доступно владельцу проекта и руководителям</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[26rem] gap-5 rounded-xl p-6">
          <AlertDialogHeader className="space-y-2.5">
            <span aria-hidden className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary/50 text-foreground/70 sm:mx-0">
              {completed ? <RotateCcw className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
            </span>
            <AlertDialogTitle className="text-base font-semibold tracking-tight">{completed ? "Открыть проект заново?" : "Завершить проект?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              {completed
                ? "В проекте снова можно будет создавать задачи, запускать таймеры и добавлять участников."
                : "После завершения новые задачи в проекте создавать нельзя. Все существующие задачи, история и комментарии останутся доступны."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel disabled={m.isPending} className="mt-0 border-border bg-transparent hover:bg-secondary/60">Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={m.isPending}
              className="bg-foreground text-background hover:bg-foreground/90"
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
  if (status === "done") return <CheckCircle2 aria-hidden className={`h-4 w-4 text-muted-foreground ${className}`} />;
  if (status === "waiting") return <Hourglass aria-hidden className={`h-3.5 w-3.5 text-amber-300/80 ${className}`} />;
  if (status === "in_progress")
    return (
      <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full border border-primary/60 ${className}`}>
        <span className="h-2 w-2 rounded-full bg-primary" />
      </span>
    );
  return <span aria-hidden className={`h-4 w-4 rounded-full border border-muted-foreground/50 ${className}`} />;
}

/** Counts per status for the selected project, shown as quiet inline text. */
function StatusSummary({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  const count = (status: string) => tasks.filter((t) => t.status === status).length;
  const parts = (["in_progress", "todo", "waiting", "done"] as const).map((s) => [s, count(s)] as const).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {parts.map(([s, n]) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusIcon status={s} className="scale-[0.8]" />
          {STATUS_LABEL[s]} <span className="tabular-nums text-foreground/80">{n}</span>
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
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-primary">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      Live
    </span>
  );
}

function TaskTree({ tasks, running, selectedId, onSelect, userId, mineOnly, data, onCreate, onShowAll, completed = false }: { tasks: Task[]; running: WS["running"]; selectedId: string | null; onSelect: (id: string) => void; userId: string; mineOnly: boolean; data: WS; onCreate?: (() => void) | undefined; onShowAll: () => void; completed?: boolean }) {
  const visibleIds = new Set(tasks.filter((t) => !mineOnly || t.assignee_id === userId).map((t) => t.id));
  if (mineOnly) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const task of tasks) {
      if (task.assignee_id !== userId) continue;
      let parentId = task.parent_task_id;
      while (parentId) {
        visibleIds.add(parentId);
        parentId = byId.get(parentId)?.parent_task_id ?? null;
      }
    }
  }
  const roots = tasks.filter((t) => visibleIds.has(t.id) && (!t.parent_task_id || !tasks.some((x) => x.id === t.parent_task_id)));
  const childrenOf = (id: string) => tasks.filter((c) => visibleIds.has(c.id) && c.parent_task_id === id);
  const render = (t: Task, depth: number): React.ReactNode => {
    const selected = t.id === selectedId;
    const live = running.some((r) => r.task_id === t.id);
    const children = childrenOf(t.id);
    const assignee = t.assignee_id ? data.profiles.find((p) => p.id === t.assignee_id) : null;
    const due = dueLabel(t);
    const urgent = t.priority === "high" || t.priority === "critical";
    return (
      <div key={t.id}>
        <motion.button
          type="button"
          onClick={() => onSelect(t.id)}
          whileTap={{ scale: 0.995 }}
          aria-current={selected ? "true" : undefined}
          title={t.title}
          className={`relative flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200 ${selected ? "" : "hover:bg-secondary/35"}`}
        >
          {selected && (
            <motion.span layoutId="task-selection" transition={SOFT_SPRING} className="absolute inset-0 rounded-lg bg-secondary/70 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary/80" />
            </motion.span>
          )}
          <span className="relative mt-0.5 flex h-5 w-4 shrink-0 items-center justify-center"><StatusIcon status={t.status} /></span>
          <span className="relative min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/65">#{t.number}</span>
              <span className={`truncate leading-5 ${depth > 0 ? "text-[13px]" : "text-[14px]"} ${t.status === "done" ? "text-muted-foreground line-through decoration-muted-foreground/40" : selected ? "font-medium text-foreground" : depth > 0 ? "text-foreground/85" : "font-medium text-foreground/95"}`}>{t.title}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-x-2.5 text-[11px] leading-4 text-muted-foreground/75">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {assignee ? (
                  <ProfileAvatar avatarUrl={assignee.avatar_url} name={assignee.full_name || "Сотрудник"} initials={initialsOf(assignee.full_name || "С")} className="h-4 w-4 rounded-full" fallbackClassName="text-[8px]" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-border" />
                )}
                {assignee ? <EmployeeName name={shortName(assignee.full_name || "Сотрудник")} isVip={assignee.is_vip} title={assignee.full_name ?? undefined} className="truncate" /> : <span className="truncate">Без исполнителя</span>}
              </span>
              {live && <LiveBadge />}
              {urgent && <span className={`shrink-0 ${t.priority === "critical" ? "text-destructive/85" : "text-amber-300/70"}`}>{PRIORITY_LABEL[t.priority]}</span>}
              {due && <span className={`shrink-0 ${due.overdue ? "text-destructive/85" : "hidden sm:inline"}`}>до {due.text}</span>}
              {children.length > 0 && (
                <span className="hidden shrink-0 items-center gap-1 sm:inline-flex" title="Подзадачи: готово / всего"><CornerDownRight className="h-3 w-3" />{children.filter((c) => c.status === "done").length}/{children.length}</span>
              )}
            </span>
          </span>
          <span className="relative hidden shrink-0 pt-0.5 text-right sm:block">
            <span className={`block font-mono text-[11px] tabular-nums ${live ? "text-foreground/90" : "text-muted-foreground/65"}`}><LiveSpent task={t} running={running}>{(spent) => formatDuration(spent)}</LiveSpent></span>
          </span>
          <span className="sr-only">{STATUS_LABEL[t.status]}</span>
        </motion.button>
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
        <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/25 px-4 py-3.5">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">В проекте нет задач</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Проект завершён — новые задачи не создаются</p>
          </div>
        </div>
      );
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{empty ? "В проекте пока нет задач" : "Нет задач, назначенных на вас"}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{empty ? (completed ? "Проект завершён — новые задачи не создаются" : "Начните с первой задачи — подзадачи можно добавить позже.") : "Остальные задачи проекта — во вкладке «Все задачи»."}</p>
        </div>
        {empty ? (
          onCreate && <Button size="sm" variant="secondary" className="h-8 shrink-0" onClick={onCreate}><Plus className="h-4 w-4" />Создать</Button>
        ) : (
          <Button size="sm" variant="ghost" className="h-8 shrink-0 text-muted-foreground" onClick={onShowAll}>Все задачи</Button>
        )}
      </div>
    );
  }
  return <div className="space-y-0.5">{roots.map((t) => render(t, 0))}</div>;
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
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-9 text-muted-foreground active:scale-[0.97]">
        Новый проект
      </Button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex items-center gap-2"
    >
      <Input placeholder="Код" value={code} onChange={(e) => setCode(e.target.value)} className="h-8 w-20" required />
      <Input placeholder="Название проекта" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-48" required />
      <Button size="sm" disabled={m.isPending}>Создать</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Отмена</Button>
    </form>
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
      className="rounded-lg border border-border bg-background/40 p-2.5"
    >
      <div className="flex items-center gap-2">
        <Input placeholder={parentId ? "Новая подзадача" : "Новая задача"} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 min-w-0 flex-1" required minLength={2} />
        <Button size="sm" disabled={m.isPending} className="h-8 active:scale-[0.97]">Добавить</Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Input type="number" min="0" step="0.25" placeholder="Оценка, ч" value={hours} onChange={(e) => setHours(e.target.value)} className="h-7 w-24 text-xs" inputMode="decimal" />
        <Input aria-label="Срок выполнения" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="h-7 w-44 text-xs" />
        <select aria-label="Приоритет" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select aria-label="Исполнитель" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">Без исполнителя</option>
          {members.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name || "Сотрудник"}</option>
          ))}
        </select>
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
  return (
    <div className="border-t border-border/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Участники · {members.length}
        </span>
        {others.length > 0 && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            + Добавить
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {members.map((p) => (
          <EmployeeName key={p.id} name={p.full_name || "Сотрудник"} isVip={p.is_vip} title={p.full_name || "Сотрудник"} className="max-w-[12rem] truncate rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground" />
        ))}
      </div>
      {others.length > 0 && adding && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <select aria-label="Добавить участника" value={uid} onChange={(e) => setUid(e.target.value)} className="h-7 min-w-0 flex-1 basis-40 rounded-md border border-input bg-background px-2 text-xs">
            <option value="">Добавить сотрудника…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || "Сотрудник"}</option>
            ))}
          </select>
          <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!uid || m.isPending} onClick={() => m.mutate()}>Добавить</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAdding(false); setUid(""); }}>Отмена</Button>
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task, data, onSelect }: { task: Task; data: WS; onSelect: (id: string) => void }) {
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

  return (
    <div className="divide-y divide-border">
      {/* Header */}
      <section className="px-6 pb-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>#{task.number}</span>
              {parent && (
                <>
                  <span aria-hidden>·</span>
                  <span>подзадача</span>
                  <button type="button" className="truncate text-foreground/80 underline-offset-2 hover:text-primary hover:underline" onClick={() => onSelect(parent.id)}>#{parent.number} {parent.title}</button>
                </>
              )}
            </div>
            <h2 className="mt-1.5 break-words text-[22px] font-semibold leading-tight tracking-tight">{task.title}</h2>
            {task.description && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground sm:text-sm">{task.description}</p>}
          </div>
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => {
            setTitleDraft(task.title);
            setDescriptionDraft(task.description ?? "");
            setPriorityDraft(task.priority);
            setAssigneeDraft(task.assignee_id ?? "");
            setEstimateDraft(task.estimated_seconds ? String(task.estimated_seconds / 3600) : "");
            setDueDraft(toLocalDateTime(task.due_at));
            setEditing((value) => !value);
          }}>{editing ? "Закрыть" : "Изменить"}</Button>
        </div>

        {/* Properties: one quiet label/value grid instead of chips and cards. */}
        <dl className="mt-5 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 sm:gap-y-1.5 text-sm sm:grid-cols-[6rem_minmax(0,1fr)_6rem_minmax(0,1fr)]">
          <dt className="text-xs leading-6 text-muted-foreground">Статус</dt>
          <dd className="flex min-w-0 items-center gap-2 leading-6"><StatusIcon status={task.status} className="scale-90" />{STATUS_LABEL[task.status]}</dd>
          <dt className="text-xs leading-6 text-muted-foreground">Приоритет</dt>
          <dd className={`leading-6 ${task.priority === "critical" ? "text-destructive" : task.priority === "high" ? "text-amber-300/90" : "text-foreground/85"}`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</dd>
          <dt className="text-xs leading-6 text-muted-foreground">Срок</dt>
          <dd className={`leading-6 ${dueLabel(task)?.overdue ? "text-destructive" : task.due_at ? "" : "text-muted-foreground"}`}>{task.due_at ? new Date(task.due_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Не задан"}</dd>
          <dt className="text-xs leading-6 text-muted-foreground">Оценка</dt>
          <dd className={`leading-6 ${est ? "font-mono tabular-nums" : "text-muted-foreground"}`}>{est ? formatDuration(est) : "Не задана"}</dd>
          <dt className="text-xs leading-6 text-muted-foreground">Исполнитель</dt>
          <dd className="flex min-w-0 items-center gap-2 leading-6 sm:col-span-3">
            {assigneeProfile ? (
              <ProfileAvatar avatarUrl={assigneeProfile.avatar_url} name={assigneeProfile.full_name || "Сотрудник"} initials={initialsOf(assigneeProfile.full_name || "С")} className="h-5 w-5 rounded-full" fallbackClassName="text-[9px]" />
            ) : (
              <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-border" />
            )}
            {task.assignee_id ? <PersonName data={data} id={task.assignee_id} className="min-w-0 break-words" /> : <span className="min-w-0 text-muted-foreground">Не назначен</span>}
          </dd>
        </dl>

        <AnimatePresence initial={false}>
          {editing && (
            <motion.div key="edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
              <div className="mt-4 space-y-2 rounded-lg border border-border bg-background/40 p-3">
                <Input aria-label="Название задачи" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} maxLength={200} />
                <Textarea aria-label="Описание задачи" value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} rows={3} maxLength={5000} placeholder="Описание" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <select aria-label="Приоритет" value={priorityDraft} onChange={(e) => setPriorityDraft(e.target.value as typeof task.priority)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    {Object.entries(PRIORITY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <select aria-label="Исполнитель" value={assigneeDraft} onChange={(e) => setAssigneeDraft(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="">Без исполнителя</option>
                    {membersOf(data, task.project_id).map((member) => <option key={member.id} value={member.id}>{member.full_name || "Сотрудник"}</option>)}
                  </select>
                  <Input aria-label="Оценка времени в часах" type="number" min="0" step="0.25" value={estimateDraft} onChange={(e) => setEstimateDraft(e.target.value)} inputMode="decimal" placeholder="Оценка, ч" />
                  <Input aria-label="Срок выполнения" type="datetime-local" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={patch.isPending || titleDraft.trim().length < 2} onClick={() => patch.mutate({
                    taskId: task.id,
                    title: titleDraft,
                    description: descriptionDraft || null,
                    priority: priorityDraft,
                    assigneeId: assigneeDraft || null,
                    estimatedSeconds: Math.round((parseFloat(estimateDraft.replace(",", ".")) || 0) * 3600),
                    dueAt: dueDraft ? new Date(dueDraft).toISOString() : null,
                  })}>Сохранить</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Timer + actions */}
      <section className="px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Затрачено
              {timerLive && <LiveBadge />}
            </div>
            <LiveSpent task={task} running={data.running}>
              {(spent) => {
                const over = est > 0 && spent > est;
                return (
                  <>
                    <div className={`mt-1 font-mono text-4xl font-semibold tabular-nums tracking-tight transition-colors duration-300 ${over ? "text-destructive" : myRunning ? "text-primary" : timerLive ? "text-foreground" : "text-foreground/80"}`}>
                      {formatDuration(spent)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {est ? <>из {formatDuration(est)} по оценке{over && <span className="text-destructive"> · превышено</span>}</> : "Оценка не задана"}
                    </div>
                  </>
                );
              }}
            </LiveSpent>
          </div>
          {/* Completed project: start/resume are not offered; say why instead of leaving a gap. */}
          {projectDone && !myRunning && task.status !== "done" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] text-muted-foreground">
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
              Проект завершён — таймер недоступен
            </span>
          )}
          {(actions.length > 0 || task.status === "in_progress" || task.status === "waiting") && (
            <motion.div layout transition={EASE_OUT} className="flex w-full flex-wrap items-center gap-1 border-t border-border/60 pt-3 sm:w-auto sm:border-t-0 sm:pt-0">
              {actions.map((x) => (
                <motion.span key={x.a} layout whileTap={{ scale: 0.97 }} transition={EASE_OUT}>
                  <Button
                    variant={x.primary ? "default" : "ghost"}
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: x.a })}
                  >
                    {x.icon}
                    {x.label}
                  </Button>
                </motion.span>
              ))}
              {(task.status === "in_progress" || task.status === "waiting") && (
                <motion.span layout whileTap={{ scale: 0.97 }} transition={EASE_OUT}>
                  <Button size="sm" variant={showReport ? "secondary" : "ghost"} aria-expanded={showReport} onClick={() => setShowReport((v) => !v)}>
                    <CheckCircle2 className="h-4 w-4" />
                    Завершить
                  </Button>
                </motion.span>
              )}
            </motion.div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {showReport && (
            <motion.div key="report-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
              <div className="mt-4 space-y-2 rounded-lg border border-border bg-background/40 p-3">
                <div className="text-sm font-medium">Отчёт о выполнении</div>
                <Textarea value={report} onChange={(e) => setReport(e.target.value)} placeholder="Что сделано, результат, ссылки" rows={4} />
                <Button size="sm" disabled={report.trim().length < 3 || act.isPending} onClick={() => act.mutate({ action: "complete", report })}>
                  Завершить с отчётом
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Metadata + progress */}
      <section className="px-6 py-5">
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted-foreground">Прогресс{subtasks.length ? " · по подзадачам" : ""}</span>
            <span className="font-medium tabular-nums">{task.progress}%</span>
          </div>
          <div className="relative flex h-3 items-center">
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-secondary/70">
              <motion.div className="h-full rounded-full bg-primary/70" initial={false} animate={{ width: `${task.progress}%` }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            {!subtasks.length && task.status !== "done" && (
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                defaultValue={task.progress}
                onMouseUp={(e) => patch.mutate({ taskId: task.id, progress: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => patch.mutate({ taskId: task.id, progress: Number((e.target as HTMLInputElement).value) })}
                className="absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-foreground"
                aria-label="Прогресс выполнения"
              />
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {task.completion_report && (
            <motion.div key="completion" {...fadeUp} transition={EASE_OUT} className="mt-5 rounded-lg border border-border bg-background/40 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Отчёт при завершении
              </div>
              <p className="whitespace-pre-wrap text-sm">{task.completion_report}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Subtasks */}
      <section className="px-6 py-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Подзадачи · {subtasks.length}</h3>
          {task.status !== "done" && !projectDone && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" aria-expanded={subtaskFormOpen} onClick={() => setSubtaskFormOpen((open) => !open)}>
              <Plus className="h-3.5 w-3.5" />
              Подзадача
            </Button>
          )}
        </div>
        {subtasks.length === 0 && !subtaskFormOpen && <p className="text-xs text-muted-foreground">Подзадач пока нет.</p>}
        {subtasks.length > 0 && (
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            <AnimatePresence initial={false}>
              {subtasks.map((st) => (
                <motion.button
                  key={st.id}
                  type="button"
                  layout
                  {...fadeUp}
                  transition={EASE_OUT}
                  onClick={() => onSelect(st.id)}
                  title={st.title}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/40"
                >
                  <StatusIcon status={st.status} />
                  <span className="font-mono text-xs text-muted-foreground">#{st.number}</span>
                  <span className={`flex-1 truncate ${st.status === "done" ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>{st.title}</span>
                  <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[st.status]}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence initial={false}>
          {task.status !== "done" && !projectDone && subtaskFormOpen && (
            <motion.div key="subtask-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
              <div className="mt-2">
                <NewTask projectId={task.project_id} members={membersOf(data, task.project_id)} parentId={task.id} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <Comments taskId={task.id} data={data} comments={activity.data?.comments ?? []} />

      {/* History timeline */}
      <section className="bg-background/25 px-6 py-6">
        <h3 className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><History className="h-3.5 w-3.5" /> История · {history.length}</h3>
        {entries.length > 0 && (
          <div className="mb-4 rounded-lg border border-border">
            <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">Интервалы времени</div>
            {entries.map((e) => (
              <div key={e.id} className="flex justify-between px-3 py-1.5 text-xs text-muted-foreground">
                <span><PersonName data={data} id={e.user_id} /> · {new Date(e.started_at).toLocaleString("ru-RU")}</span>
                <span className="font-mono tabular-nums">{e.ended_at ? formatDuration(e.duration_seconds ?? 0) : "идёт…"}</span>
              </div>
            ))}
          </div>
        )}
        <ol className="max-h-80 overflow-auto">
          {history.map((h, index) => (
            <motion.li
              key={h.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...EASE_OUT, delay: Math.min(index, 8) * 0.025 }}
              className="relative flex gap-3 pb-3 last:pb-0"
            >
              <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                {index < history.length - 1 && <span className="absolute top-3.5 bottom-[-0.25rem] w-px bg-border" />}
              </span>
              <span className="min-w-0 text-xs leading-relaxed">
                <span className="text-foreground/90">{describe(h, data)}</span>
                <span className="block text-muted-foreground"><PersonName data={data} id={h.actor_id} /> · {new Date(h.created_at).toLocaleString("ru-RU")}</span>
              </span>
            </motion.li>
          ))}
          {history.length === 0 && <li className="text-xs text-muted-foreground">Пока нет событий.</li>}
        </ol>
      </section>
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

function Comments({ taskId, data, comments }: { taskId: string; data: WS; comments: Comment[] }) {
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
    const vip = data.profiles.find((profile) => profile.id === c.author_id)?.is_vip;
    const replies = comments.filter((r) => r.parent_comment_id === c.id);
    return (
      <motion.div key={c.id} layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={EASE_OUT} className={depth > 0 ? "ml-3.5 border-l border-border/70 pl-4" : ""}>
        <div className="flex gap-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold">{initialsOf(author)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <EmployeeName name={author} isVip={vip} className="text-sm font-medium text-foreground" />
              <span className="text-[11px] text-muted-foreground/70">{new Date(c.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{c.body}</p>
            <button type="button" className="mt-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>Ответить</button>
            <AnimatePresence initial={false}>
              {replyTo === c.id && (
                <motion.div key="reply" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden">
                  <div className="mt-2 flex gap-2">
                    <Input value={reply} onChange={(e) => setReply(e.target.value)} className="h-8" placeholder="Ответ" />
                    <Button size="sm" disabled={!reply.trim() || m.isPending} onClick={() => m.mutate({ body: reply, parent: c.id })}>Отправить</Button>
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
    <section className="px-6 py-6">
      <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> Комментарии · {comments.length}</h3>
      <div className="mt-2">
        <AnimatePresence initial={false}>{roots.map((c) => renderC(c, 0))}</AnimatePresence>
      </div>
      <div className="mt-3 flex gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Написать комментарий" />
        <Button size="sm" disabled={!body.trim() || m.isPending} onClick={() => m.mutate({ body, parent: null })} className="self-end">Отправить</Button>
      </div>
    </section>
  );
}
