import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TablesUpdate } from "@/integrations/supabase/types";

/**
 * Единый источник истины для задач NEXA — таблица tasks в Lovable Cloud.
 * Статус, таймер, spent time и отчёт меняются только через task_transition (в БД),
 * остальные поля — через updateTask. История пишется триггерами БД.
 */

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export const ensureProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fullName?: string }) => z.object({ fullName: z.string().max(120).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile, error } = await context.supabase.rpc("ensure_my_profile", data.fullName ? { _full_name: data.fullName } : {});
    fail(error);
    const { data: roles } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    return { profile, roles: (roles ?? []).map((r) => r.role) };
  });

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [projects, members, tasks, profiles, running] = await Promise.all([
      sb.from("projects").select("*").order("created_at"),
      sb.from("project_members").select("*"),
      sb.from("tasks").select("*").order("number", { ascending: false }),
      sb.from("profiles").select("id, full_name, email, position, department, avatar_url, presence"),
      sb.from("task_time_entries").select("id, task_id, user_id, session_id, started_at").is("ended_at", null),
    ]);
    [projects, members, tasks, profiles, running].forEach((r) => fail(r.error));
    return {
      userId: context.userId,
      projects: projects.data ?? [],
      members: members.data ?? [],
      tasks: tasks.data ?? [],
      profiles: profiles.data ?? [],
      running: running.data ?? [],
    };
  });

export const getTaskActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [history, comments, entries] = await Promise.all([
      sb.from("task_history").select("*").eq("task_id", data.taskId).order("created_at", { ascending: false }),
      sb.from("task_comments").select("*").eq("task_id", data.taskId).order("created_at"),
      sb.from("task_time_entries").select("*").eq("task_id", data.taskId).order("started_at", { ascending: false }),
    ]);
    [history, comments, entries].forEach((r) => fail(r.error));
    return { history: history.data ?? [], comments: comments.data ?? [], entries: entries.data ?? [] };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string; name: string; description?: string }) =>
    z.object({ code: z.string().trim().min(2).max(12), name: z.string().trim().min(2).max(120), description: z.string().max(2000).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({ code: data.code.toUpperCase(), name: data.name, description: data.description ?? null, owner_id: context.userId })
      .select()
      .single();
    fail(error);
    await context.supabase.from("project_members").insert({ project_id: project!.id, user_id: context.userId, role: "lead" });
    return project!;
  });

const taskFields = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  estimatedSeconds: z.number().int().min(0).max(10_000_000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
});

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof taskFields> & { projectId: string }) =>
    taskFields.extend({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: task, error } = await context.supabase
      .from("tasks")
      .insert({
        project_id: data.projectId,
        parent_task_id: data.parentTaskId ?? null,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? "medium",
        assignee_id: data.assigneeId ?? null,
        estimated_seconds: data.estimatedSeconds ?? 0,
        due_at: data.dueAt ?? null,
        created_by: context.userId,
      })
      .select()
      .single();
    fail(error);
    return task!;
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Partial<z.input<typeof taskFields>> & { taskId: string }) =>
    taskFields.partial().extend({ taskId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: TablesUpdate<"tasks"> = {};
    if (data.title !== undefined) patch["title"] = data.title;
    if (data.description !== undefined) patch["description"] = data.description;
    if (data.priority !== undefined) patch["priority"] = data.priority;
    if (data.assigneeId !== undefined) patch["assignee_id"] = data.assigneeId;
    if (data.estimatedSeconds !== undefined) patch["estimated_seconds"] = data.estimatedSeconds;
    if (data.dueAt !== undefined) patch["due_at"] = data.dueAt;
    if (data.progress !== undefined) patch["progress"] = data.progress;
    if (data.parentTaskId !== undefined) patch["parent_task_id"] = data.parentTaskId;
    const { data: task, error } = await context.supabase.from("tasks").update(patch).eq("id", data.taskId).select().single();
    fail(error);
    return task!;
  });

export const transitionTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; action: string; sessionId: string; report?: string }) =>
    z
      .object({
        taskId: z.string().uuid(),
        action: z.enum(["start", "pause", "resume", "wait", "complete", "reopen"]),
        sessionId: z.string().min(8).max(100),
        report: z.string().max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: task, error } = await context.supabase.rpc("task_transition", {
      _task_id: data.taskId,
      _action: data.action,
      _session_id: data.sessionId,
      ...(data.report ? { _report: data.report } : {}),
    });
    fail(error);
    return task;
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; body: string; parentCommentId?: string | null }) =>
    z.object({ taskId: z.string().uuid(), body: z.string().trim().min(1).max(5000), parentCommentId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: c, error } = await context.supabase
      .from("task_comments")
      .insert({ task_id: data.taskId, body: data.body, parent_comment_id: data.parentCommentId ?? null, author_id: context.userId })
      .select()
      .single();
    fail(error);
    return c!;
  });
