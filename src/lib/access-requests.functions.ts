import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

const requestInput = z.object({
  requestedLevel: z.number().int().min(1).max(5),
  reason: z.string().trim().min(3).max(2000),
});
const reviewInput = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});
const cancelInput = z.object({ requestId: z.string().uuid() });

export type AccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

// The Cloud RPCs return plain public.access_requests rows. Display fields
// below are derived on the server from that row, the caller's id and the
// profiles the caller is allowed to read under existing RLS.
type AccessRequestRow = Tables<"access_requests">;

export type AccessRequestItem = {
  id: string;
  requester_id: string;
  employee_name: string;
  current_level: number;
  requested_level: number;
  reason: string;
  status: AccessRequestStatus;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  /** The caller is the owner this pending request is addressed to. */
  is_owner_review: boolean;
  /** The caller is the requester and the request is still pending. */
  can_cancel: boolean;
  notification_title: string;
  action_label: string | null;
};

const STATUSES: readonly AccessRequestStatus[] = ["pending", "approved", "rejected", "cancelled"];
function toStatus(value: string): AccessRequestStatus {
  const status = STATUSES.find((candidate) => candidate === value);
  if (!status) throw new Error(`Неизвестный статус заявки: ${value}`);
  return status;
}

function titleFor(row: AccessRequestRow, status: AccessRequestStatus, callerId: string) {
  if (row.owner_user_id === callerId && row.requester_id !== callerId) return "Новый запрос на предоставление доступа";
  if (status === "approved") return "Доступ предоставлен";
  if (status === "rejected") return "Запрос на доступ отклонён";
  if (status === "cancelled") return "Запрос на доступ отменён";
  return "Заявка на предоставление доступа";
}

/** Fails unless the RPC returned the access_requests row it promises. */
function requireRow(result: { data: AccessRequestRow | null; error: { message: string } | null }, failure: string) {
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.id) throw new Error(failure);
  return result.data;
}

export const createAccessLevelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof requestInput>) => requestInput.parse(input))
  .handler(async ({ data, context }) => {
    const row = requireRow(await context.supabase.rpc("create_access_level_request", {
      _requested_level: data.requestedLevel,
      _reason: data.reason,
    }), "Сервер не подтвердил создание заявки");
    return { id: row.id, status: toStatus(row.status) };
  });

export const getMyAccessLevelRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessRequestItem[]> => {
    const { data: rows, error } = await context.supabase.rpc("get_my_access_level_requests");
    if (error) throw new Error(error.message);
    const requests = rows ?? [];
    if (requests.length === 0) return [];

    // Names come from profiles under the caller's own RLS; a profile the caller
    // may not see simply falls back to a neutral label.
    const profileIds = [...new Set(requests.flatMap((row) => [row.requester_id, row.reviewed_by]).filter((id): id is string => Boolean(id)))];
    const { data: profiles, error: profilesError } = await context.supabase
      .from("profiles").select("id, full_name").in("id", profileIds);
    if (profilesError) throw new Error(profilesError.message);
    const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

    return requests
      .map((row): AccessRequestItem => {
        const status = toStatus(row.status);
        const isOwnerReview = row.owner_user_id === context.userId && status === "pending";
        return {
          id: row.id,
          requester_id: row.requester_id,
          employee_name: names.get(row.requester_id) || "Сотрудник",
          current_level: row.current_level,
          requested_level: row.requested_level,
          reason: row.reason,
          status,
          reviewed_by: row.reviewed_by,
          reviewer_name: row.reviewed_by ? names.get(row.reviewed_by) ?? null : null,
          reviewed_at: row.reviewed_at,
          cancelled_at: row.cancelled_at,
          created_at: row.created_at,
          is_owner_review: isOwnerReview,
          can_cancel: row.requester_id === context.userId && status === "pending",
          notification_title: titleFor(row, status, context.userId),
          action_label: isOwnerReview ? "Рассмотреть" : null,
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

export const reviewAccessLevelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof reviewInput>) => reviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const row = requireRow(await context.supabase.rpc("review_access_level_request", {
      _request_id: data.requestId,
      _decision: data.decision,
    }), "Решение не подтверждено сервером");
    const status = toStatus(row.status);
    if (status !== data.decision) throw new Error("Решение не подтверждено сервером");
    return { id: row.id, status };
  });

export const cancelAccessLevelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof cancelInput>) => cancelInput.parse(input))
  .handler(async ({ data, context }) => {
    const row = requireRow(await context.supabase.rpc("cancel_access_level_request", {
      _request_id: data.requestId,
    }), "Отмена не подтверждена сервером");
    if (toStatus(row.status) !== "cancelled") throw new Error("Отмена не подтверждена сервером");
    return { id: row.id, status: "cancelled" as const };
  });
