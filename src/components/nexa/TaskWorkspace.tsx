import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pause, Play, CheckCircle2, RotateCcw, Hourglass, MessageSquare, History, CornerDownRight } from "lucide-react";
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
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => qc.invalidateQueries({ queryKey: ["nexa"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_time_entries" }, () => qc.invalidateQueries({ queryKey: ["nexa"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, () => qc.invalidateQueries({ queryKey: ["nexa", "activity"] }))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Задачи</h1>
          <p className="mt-1 text-sm text-muted-foreground">Жизненный цикл, учёт времени и отчёты — данные из Lovable Cloud</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setProjectId(p.id);
                setTaskId(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-200 active:scale-[0.97] ${
                p.id === projectId ? "bg-primary/15 text-primary" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.code} · {p.name}
            </button>
          ))}
          <NewProject onCreated={(id) => setProjectId(id)} />
        </div>
      </div>

      {!project ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Вы пока не участник ни одного проекта. Создайте проект (доступно администратору и менеджеру) или попросите руководителя добавить вас.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-4">
            <NewTask projectId={project.id} members={membersOf(data, project.id)} parentId={null} />
            <TaskTree tasks={tasks} running={data.running} selectedId={taskId} onSelect={setTaskId} />
            <Members data={data} projectId={project.id} />
          </div>
          <div>
            {selected ? (
              <TaskDetail key={selected.id} task={selected} data={data} onSelect={setTaskId} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Выберите задачу слева.</div>
            )}
          </div>
        </div>
      )}
    </div>
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
  return p?.full_name || p?.email || "Сотрудник";
}

function liveSpent(task: Task, running: WS["running"], now: number) {
  const open = running.filter((r) => r.task_id === task.id);
  return task.spent_seconds + open.reduce((acc, r) => acc + (now - new Date(r.started_at).getTime()) / 1000, 0);
}

function TaskTree({ tasks, running, selectedId, onSelect }: { tasks: Task[]; running: WS["running"]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = useNow(running.length > 0);
  const roots = tasks.filter((t) => !t.parent_task_id || !tasks.some((x) => x.id === t.parent_task_id));
  const render = (t: Task, depth: number): React.ReactNode => (
    <div key={t.id}>
      <button
        onClick={() => onSelect(t.id)}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-200 active:scale-[0.99] ${
          t.id === selectedId ? "bg-secondary" : "hover:bg-secondary/50"
        }`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">#{t.number}</span>
        <span className="flex-1 truncate">{t.title}</span>
        {running.some((r) => r.task_id === t.id) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
        <span className="font-mono text-xs text-muted-foreground">{formatDuration(liveSpent(t, running, now))}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusTone(t.status)}`}>{STATUS_LABEL[t.status]}</span>
      </button>
      {tasks.filter((c) => c.parent_task_id === t.id).map((c) => render(c, depth + 1))}
    </div>
  );
  return (
    <div className="rounded-lg border border-border bg-card p-2">
      {tasks.length === 0 ? <div className="p-4 text-sm text-muted-foreground">В проекте пока нет задач.</div> : roots.map((t) => render(t, 0))}
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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="active:scale-[0.97]">
        + Проект
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
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WS_KEY });
      setTitle("");
      setHours("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
    >
      <Input placeholder={parentId ? "Новая подзадача" : "Новая задача"} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 min-w-40 flex-1" required minLength={2} />
      <Input placeholder="Оценка, ч" value={hours} onChange={(e) => setHours(e.target.value)} className="h-8 w-24" inputMode="decimal" />
      <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
        {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
        <option value="">Без исполнителя</option>
        {members.map((p) => (
          <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
        ))}
      </select>
      <Button size="sm" disabled={m.isPending} className="active:scale-[0.97]">Добавить</Button>
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
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium">Участники проекта</h2>
      <div className="flex flex-wrap gap-1.5">
        {members.map((p) => (
          <span key={p.id} className="rounded-full bg-secondary px-2.5 py-1 text-xs">{p.full_name || p.email}</span>
        ))}
      </div>
      {others.length > 0 && (
        <div className="mt-3 flex gap-2">
          <select value={uid} onChange={(e) => setUid(e.target.value)} className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Добавить сотрудника…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!uid || m.isPending} onClick={() => m.mutate()}>Добавить</Button>
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
  const now = useNow(data.running.some((r) => r.task_id === task.id));
  const spent = liveSpent(task, data.running, now);
  const subtasks = data.tasks.filter((t) => t.parent_task_id === task.id);
  const parent = data.tasks.find((t) => t.id === task.parent_task_id);
  const [report, setReport] = useState("");
  const [showReport, setShowReport] = useState(false);

  const act = useMutation({
    mutationFn: (v: { action: Action; report?: string }) =>
      transition({ data: { taskId: task.id, action: v.action, sessionId: getNexaSessionId(), ...(v.report ? { report: v.report } : {}) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexa"] });
      setShowReport(false);
      setReport("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = useMutation({
    mutationFn: (p: Parameters<typeof update>[0]["data"]) => update({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexa"] }),
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
  const over = est > 0 && spent > est;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs text-muted-foreground">
              #{task.number}
              {parent && (
                <>
                  {" · подзадача "}
                  <button className="text-primary hover:underline" onClick={() => onSelect(parent.id)}>#{parent.number}</button>
                </>
              )}
            </div>
            <h2 className="mt-1 text-lg font-semibold">{task.title}</h2>
            {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${statusTone(task.status)}`}>{STATUS_LABEL[task.status]}</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Затрачено" value={formatDuration(spent)} accent={myRunning} warn={over} />
          <Stat label="Оценка" value={est ? formatDuration(est) : "—"} />
          <Stat label="Исполнитель" value={nameOf(data, task.assignee_id)} />
          <Stat label="Приоритет" value={PRIORITY_LABEL[task.priority] ?? task.priority} />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Прогресс{subtasks.length ? " (по подзадачам)" : ""}</span>
            <span>{task.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="h-1.5 rounded-full bg-primary transition-all duration-500 ease-out" style={{ width: `${task.progress}%` }} />
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
              className="mt-2 w-full accent-[var(--color-primary)]"
              aria-label="Прогресс выполнения"
            />
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {actions.map((x) => (
            <Button
              key={x.a}
              variant={x.primary ? "default" : "outline"}
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: x.a })}
              className="transition-transform duration-150 active:scale-[0.96]"
            >
              {x.icon}
              {x.label}
            </Button>
          ))}
          {(task.status === "in_progress" || task.status === "waiting") && (
            <Button size="sm" variant="outline" onClick={() => setShowReport((v) => !v)} className="active:scale-[0.96]">
              <CheckCircle2 className="h-4 w-4" />
              Завершить
            </Button>
          )}
        </div>

        {showReport && (
          <div className="mt-4 space-y-2 rounded-md border border-border p-3">
            <div className="text-sm font-medium">Отчёт о выполнении</div>
            <Textarea value={report} onChange={(e) => setReport(e.target.value)} placeholder="Что сделано, результат, ссылки" rows={4} />
            <Button size="sm" disabled={report.trim().length < 3 || act.isPending} onClick={() => act.mutate({ action: "complete", report })}>
              Завершить с отчётом
            </Button>
          </div>
        )}

        {task.completion_report && (
          <div className="mt-4 rounded-md bg-secondary/60 p-3 text-sm">
            <div className="mb-1 text-xs text-muted-foreground">Отчёт при завершении</div>
            <p className="whitespace-pre-wrap">{task.completion_report}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Подзадачи · {subtasks.length}</h3>
        {subtasks.map((s) => (
          <button key={s.id} onClick={() => onSelect(s.id)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary/50">
            <span className="font-mono text-xs text-muted-foreground">#{s.number}</span>
            <span className="flex-1 truncate">{s.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusTone(s.status)}`}>{STATUS_LABEL[s.status]}</span>
          </button>
        ))}
        {task.status !== "done" && (
          <div className="mt-2">
            <NewTask projectId={task.project_id} members={membersOf(data, task.project_id)} parentId={task.id} />
          </div>
        )}
      </div>

      <Comments taskId={task.id} data={data} comments={activity.data?.comments ?? []} />

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4 text-muted-foreground" /> История и интервалы времени</h3>
        <div className="mb-3 space-y-1">
          {(activity.data?.entries ?? []).map((e) => (
            <div key={e.id} className="flex justify-between text-xs text-muted-foreground">
              <span>{nameOf(data, e.user_id)} · {new Date(e.started_at).toLocaleString("ru-RU")}</span>
              <span className="font-mono">{e.ended_at ? formatDuration(e.duration_seconds ?? 0) : "идёт…"}</span>
            </div>
          ))}
        </div>
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {(activity.data?.history ?? []).map((h) => (
            <div key={h.id} className="text-xs">
              <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString("ru-RU")} · {nameOf(data, h.actor_id)} — </span>
              {describe(h)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function describe(h: { action: string; field: string | null; old_value: unknown; new_value: unknown }) {
  const v = (x: unknown) => (h.field === "status" ? STATUS_LABEL[String(x)] ?? String(x) : x == null ? "—" : String(x));
  switch (h.action) {
    case "created": return "создал задачу";
    case "status_changed": return `статус: ${v(h.old_value)} → ${v(h.new_value)}`;
    case "field_changed": return `${h.field}: ${v(h.old_value)} → ${v(h.new_value)}`;
    case "timer_started": return "запустил таймер";
    case "timer_stopped": return "остановил таймер";
    case "completed_with_report": return "завершил с отчётом";
    case "reopened": return "переоткрыл задачу";
    case "comment_added": return "оставил комментарий";
    case "reply_added": return "ответил на комментарий";
    default: return h.action;
  }
}

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-md bg-secondary/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${accent ? "text-primary" : ""} ${warn ? "text-destructive" : ""}`}>{value}</div>
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
  const renderC = (c: Comment, depth: number): React.ReactNode => (
    <div key={c.id} style={{ marginLeft: depth * 18 }} className="mt-2">
      <div className="rounded-md bg-secondary/50 p-2.5 text-sm">
        <div className="mb-0.5 text-[11px] text-muted-foreground">{nameOf(data, c.author_id)} · {new Date(c.created_at).toLocaleString("ru-RU")}</div>
        <p className="whitespace-pre-wrap">{c.body}</p>
      </div>
      <button className="mt-1 text-[11px] text-primary hover:underline" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>Ответить</button>
      {replyTo === c.id && (
        <div className="mt-1 flex gap-2">
          <Input value={reply} onChange={(e) => setReply(e.target.value)} className="h-8" placeholder="Ответ" />
          <Button size="sm" disabled={!reply.trim() || m.isPending} onClick={() => m.mutate({ body: reply, parent: c.id })}>Отправить</Button>
        </div>
      )}
      {comments.filter((r) => r.parent_comment_id === c.id).map((r) => renderC(r, depth + 1))}
    </div>
  );
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-4 w-4 text-muted-foreground" /> Комментарии · {comments.length}</h3>
      {roots.map((c) => renderC(c, 0))}
      <div className="mt-3 flex gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Комментарий" />
        <Button size="sm" disabled={!body.trim() || m.isPending} onClick={() => m.mutate({ body, parent: null })} className="self-end">Отправить</Button>
      </div>
    </div>
  );
}
