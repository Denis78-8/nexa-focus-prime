import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Task data shared by Overview and the Tasks tab. Kept out of TaskWorkspace so
 * the main screen can use it without loading the (lazy) TaskWorkspace chunk.
 */

export const STATUS_LABEL: Record<string, string> = {
  todo: "Новая",
  in_progress: "В работе",
  waiting: "В ожидании",
  done: "Завершена",
};

export const WS_KEY = ["nexa", "workspace"] as const;

/**
 * Task and timer changes affect only the workspace (tasks, timers, Overview
 * share this key) and task activity (history is written by a tasks trigger).
 * Directory, notifications and avatar URLs do not depend on tasks.
 */
export function invalidateTaskData(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: WS_KEY });
  void qc.invalidateQueries({ queryKey: ["nexa", "activity"] });
}

export type RealtimeState = "connecting" | "live" | "offline";

// Debounce window for a burst of realtime events (see useTaskRealtime).
const REALTIME_DEBOUNCE_MS = 350;
const REALTIME_MAX_WAIT_MS = 1000;

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
    // A burst of events (a timer start writes the task and its time entry,
    // history triggers, several users) is folded into one refetch: the
    // workspace and the activity of the affected tasks are invalidated once,
    // REALTIME_DEBOUNCE_MS after the last event of the burst.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let workspace = false;
    let allActivity = false;
    const activityIds = new Set<string>();
    const flush = () => {
      timer = undefined;
      if (workspace) void qc.invalidateQueries({ queryKey: WS_KEY });
      if (allActivity) void qc.invalidateQueries({ queryKey: ["nexa", "activity"] });
      else activityIds.forEach((id) => void qc.invalidateQueries({ queryKey: ["nexa", "activity", id] }));
      workspace = false;
      allActivity = false;
      activityIds.clear();
    };
    // A continuous stream of events still flushes at least every REALTIME_MAX_WAIT_MS.
    let firstPending = 0;
    const schedule = () => {
      const now = Date.now();
      if (!timer) firstPending = now;
      else clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(REALTIME_DEBOUNCE_MS, firstPending + REALTIME_MAX_WAIT_MS - now)));
    };
    // Task id of a changed row (new row, or old row for deletes). Without it
    // (unexpected payload) every open activity is refreshed, as before.
    const touchActivity = (taskId: unknown) => {
      if (typeof taskId === "string") activityIds.add(taskId);
      else allActivity = true;
    };
    type Row = Record<string, unknown> | null | undefined;
    const rowOf = (payload: { new?: Row; old?: Row }) => (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) ?? {};

    const ch = supabase
      .channel("nexa-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        workspace = true;
        touchActivity(rowOf(payload)["id"]);
        schedule();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_time_entries" }, (payload) => {
        workspace = true;
        touchActivity(rowOf(payload)["task_id"]);
        schedule();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, (payload) => {
        touchActivity(rowOf(payload)["task_id"]);
        schedule();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects" }, () => {
        workspace = true;
        schedule();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("offline");
      });
    return () => {
      // Apply pending changes instead of dropping them when the tab unmounts.
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      supabase.removeChannel(ch);
    };
  }, [qc]);
  return state;
}
