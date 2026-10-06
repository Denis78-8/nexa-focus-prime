import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pause, Play, CheckCircle2, RotateCcw, Hourglass, MessageSquare, History, CornerDownRight, ListChecks, Timer, Plus, Users } from "lucide-react";
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
  transitionTask,
  updateTask,
} from "@/lib/tasks.functions";
import { formatDuration, getNexaSessionId } from "@/lib/nexa-session";

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

function statusTone(s: string) {
  if (s === "in_progress") return "bg-primary/15 text-primary";
  if (s === "waiting") return "bg-secondary text-foreground";
  if (s === "done") return "bg-secondary text-muted-foreground";
  return "bg-secondary text-muted-foreground";
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

  // Realtime: любое изменение в БД обновляет единый кэш рабочего пространства
  useEffect(() => {
    const ch = supabase
      .channel("nexa-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => invalidateTaskData(qc))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_time_entries" }, () => invalidateTaskData(qc))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, () => qc.invalidateQueries({ queryKey: ["nexa", "activity"] }))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

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

  return (
    <MotionConfig reducedMotion="user">
      <div>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
            <p className="mt-1 text-sm text-muted-foreground">Рабочее пространство</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.projects.length > 0 && (
              <select
                aria-label="Проект"
                value={projectId ?? ""}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTaskId(null);
                }}
                title={project ? `${project.code} · ${project.name}` : undefined}
                className="h-9 max-w-[14rem] truncate rounded-md border border-border bg-card/60 px-2.5 text-sm"
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                ))}
              </select>
            )}
            <div className="relative flex h-9 items-center rounded-md border border-border bg-card/60 p-0.5">
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
                  className={`relative h-full rounded px-3 text-sm transition-colors ${mineOnly === mine ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mineOnly === mine && <motion.span layoutId="task-filter-pill" transition={SOFT_SPRING} className="absolute inset-0 rounded bg-secondary" />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
            {project && (
              <Button size="sm" className="h-9 active:scale-[0.97]" aria-expanded={composerOpen} onClick={() => setComposerOpen((open) => !open)}>
                <Plus className="h-4 w-4" />
                Задача
              </Button>
            )}
            <NewProject onCreated={(id) => setProjectId(id)} />
          </div>
        </div>

        {!project ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Вы пока не участник ни одного проекта. Создайте проект (доступно администратору и менеджеру) или попросите руководителя добавить вас.
          </div>
        ) : (
          <div className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
            <div className="flex min-w-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{project.code} · {project.name}</span>
                <span className="text-xs text-muted-foreground">{tasks.length}</span>
              </div>
              <AnimatePresence initial={false}>
                {composerOpen && (
                  <motion.div key="composer" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={EASE_OUT} className="overflow-hidden px-3">
                    <div className="pb-3">
                      <NewTask projectId={project.id} members={membersOf(data, project.id)} parentId={null} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={filterKey} {...fadeUp} transition={EASE_OUT} className="flex-1 px-2 pb-2">
                  <TaskTree tasks={tasks} running={data.running} selectedId={taskId} onSelect={setTaskId} userId={data.userId} mineOnly={mineOnly} data={data} />
                </motion.div>
              </AnimatePresence>
              <Members data={data} projectId={project.id} />
            </div>
            <div className="min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  <motion.div key={selected.id} {...fadeUp} transition={EASE_OUT}>
                    <TaskDetail task={selected} data={data} onSelect={setTaskId} />
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EASE_OUT} className="flex min-h-[26rem] flex-col items-center justify-center px-8 py-10 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-secondary/60 text-muted-foreground">
                      <ListChecks className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 text-sm font-medium">Выберите задачу из списка</h2>
                    <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">Здесь появятся детали задачи, таймер, история изменений и комментарии.</p>
                    <div className="mt-5 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />Таймер</span>
                      <span className="inline-flex items-center gap-1.5"><History className="h-3.5 w-3.5" />История</span>
                      <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Комментарии</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

type WS = Awaited<ReturnType<typeof getWorkspace>>;
type Task = WS["tasks"][number];

function membersOf(data: WS, projectId: string) {
  const project = data.projects.find((p) => p.id === projectId);
  const ids = new Set(data.members.filter((m) => m.project_id === projectId).map((m) => m.user_id));
  if (project) ids.add(project.owner_id);
  return data.profiles.filter((p) => ids.has(p.id));
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

function TaskTree({ tasks, running, selectedId, onSelect, userId, mineOnly, data }: { tasks: Task[]; running: WS["running"]; selectedId: string | null; onSelect: (id: string) => void; userId: string; mineOnly: boolean; data: WS }) {
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
  const render = (t: Task, depth: number): React.ReactNode => {
    const selected = t.id === selectedId;
    const live = running.some((r) => r.task_id === t.id);
    return (
      <div key={t.id}>
        <motion.button
          type="button"
          onClick={() => onSelect(t.id)}
          whileTap={{ scale: 0.995 }}
          aria-current={selected ? "true" : undefined}
          title={t.title}
          className={`relative flex w-full items-center gap-3 rounded-md py-2 pr-3 text-left text-sm transition-colors duration-200 ${selected ? "" : "hover:bg-secondary/40"}`}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          {selected && (
            <motion.span layoutId="task-selection" transition={SOFT_SPRING} className="absolute inset-0 rounded-md bg-secondary/80">
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
            </motion.span>
          )}
          <span className="relative flex min-w-0 flex-1 items-center gap-3">
            {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground">#{t.number}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${selected ? "font-medium text-foreground" : depth > 0 ? "text-foreground/80" : "font-medium text-foreground/90"}`}>{t.title}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{t.assignee_id ? nameOf(data, t.assignee_id) : "Без исполнителя"}</span>
                {t.priority === "high" || t.priority === "critical" ? <span className="shrink-0 text-amber-300/80">· {PRIORITY_LABEL[t.priority]}</span> : null}
                {live && <LiveBadge />}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`block font-mono text-xs tabular-nums ${live ? "text-foreground" : "text-muted-foreground"}`}><LiveSpent task={t} running={running}>{(spent) => formatDuration(spent)}</LiveSpent></span>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${statusTone(t.status)}`}>{STATUS_LABEL[t.status]}</span>
            </span>
          </span>
        </motion.button>
        {tasks.filter((c) => visibleIds.has(c.id) && c.parent_task_id === t.id).map((c) => render(c, depth + 1))}
      </div>
    );
  };
  return (
    <div>
      {tasks.length === 0 ? <div className="px-3 py-6 text-sm text-muted-foreground">В проекте пока нет задач.</div> : roots.length === 0 ? <div className="px-3 py-6 text-sm text-muted-foreground">Нет задач, назначенных на вас.</div> : <div className="divide-y divide-border/40">{roots.map((t) => render(t, 0))}</div>}
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
  const others = data.profiles.filter((p) => !members.some((m) => m.id === p.id));
  const [uid, setUid] = useState("");
  const m = useMutation({
    mutationFn: () => add({ data: { projectId, userId: uid, role: "member" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WS_KEY });
      setUid("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="mt-auto border-t border-border/60 px-4 py-3 opacity-80 transition-opacity hover:opacity-100">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Участники · {members.length}
      </div>
      <div className="flex flex-wrap gap-1">
        {members.map((p) => (
          <span key={p.id} title={p.full_name || "Сотрудник"} className="max-w-[12rem] truncate rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">{p.full_name || "Сотрудник"}</span>
        ))}
      </div>
      {others.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          <select value={uid} onChange={(e) => setUid(e.target.value)} className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs">
            <option value="">Добавить сотрудника…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || "Сотрудник"}</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!uid || m.isPending} onClick={() => m.mutate()}>Добавить</Button>
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

  const actions: { a: Action; label: string; icon: React.ReactNode; primary?: boolean }[] = [];
  if (task.status === "todo") actions.push({ a: "start", label: "Начать", icon: <Play className="h-4 w-4" />, primary: true });
  if (task.status === "in_progress" && myRunning) actions.push({ a: "pause", label: "Пауза", icon: <Pause className="h-4 w-4" /> });
  if ((task.status === "in_progress" || task.status === "waiting") && !myRunning)
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
      <section className="px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>#{task.number}</span>
              {parent && (
                <>
                  <span aria-hidden>·</span>
                  <span>подзадача</span>
                  <button type="button" className="text-primary hover:underline" onClick={() => onSelect(parent.id)}>#{parent.number} {parent.title}</button>
                </>
              )}
            </div>
            <h2 className="mt-1.5 break-words text-xl font-semibold tracking-tight">{task.title}</h2>
            {task.description && <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-1 ${statusTone(task.status)}`}>{STATUS_LABEL[task.status]}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-foreground">{task.assignee_id ? initialsOf(nameOf(data, task.assignee_id)) : "—"}</span>
                {task.assignee_id ? nameOf(data, task.assignee_id) : "Без исполнителя"}
              </span>
            </div>
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
          {(actions.length > 0 || task.status === "in_progress" || task.status === "waiting") && (
            <motion.div layout transition={EASE_OUT} className="flex flex-wrap items-center gap-1">
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
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Оценка" value={est ? formatDuration(est) : "—"} />
          <Stat label="Исполнитель" value={nameOf(data, task.assignee_id)} />
          <Stat label="Приоритет" value={PRIORITY_LABEL[task.priority] ?? task.priority} />
          <Stat label="Срок" value={task.due_at ? new Date(task.due_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "Не задан"} />
        </dl>

        <div className="mt-5">
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
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Подзадачи · {subtasks.length}</h3>
          {task.status !== "done" && (
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
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">#{st.number}</span>
                  <span className="flex-1 truncate">{st.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusTone(st.status)}`}>{STATUS_LABEL[st.status]}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence initial={false}>
          {task.status !== "done" && subtaskFormOpen && (
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
      <section className="px-6 py-5">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><History className="h-3.5 w-3.5" /> История</h3>
        {entries.length > 0 && (
          <div className="mb-4 rounded-lg border border-border">
            <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">Интервалы времени</div>
            {entries.map((e) => (
              <div key={e.id} className="flex justify-between px-3 py-1.5 text-xs text-muted-foreground">
                <span>{nameOf(data, e.user_id)} · {new Date(e.started_at).toLocaleString("ru-RU")}</span>
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
                <span className="block text-muted-foreground">{nameOf(data, h.actor_id)} · {new Date(h.created_at).toLocaleString("ru-RU")}</span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium leading-snug text-foreground" title={value}>{value}</dd>
    </div>
  );
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
              <span className={`text-sm font-medium ${vip ? "text-primary" : "text-foreground"}`}>{author}</span>
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
    <section className="px-6 py-5">
      <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> Комментарии · {comments.length}</h3>
      <div className="mt-1">
        <AnimatePresence initial={false}>{roots.map((c) => renderC(c, 0))}</AnimatePresence>
      </div>
      <div className="mt-3 flex gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Написать комментарий" />
        <Button size="sm" disabled={!body.trim() || m.isPending} onClick={() => m.mutate({ body, parent: null })} className="self-end">Отправить</Button>
      </div>
    </section>
  );
}
