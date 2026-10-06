import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

// Thin wrappers over the caller-scoped notification RPCs. The RPCs select and
// update only rows where user_id = auth.uid(); nothing here passes a user id.
export type AppNotification = Tables<"notifications">;

export const getMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppNotification[]> => {
    const { data, error } = await context.supabase.rpc("get_my_notifications");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const markInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof markInput>) => markInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase.rpc("mark_notifications_read", { _ids: data.ids });
    if (error) throw new Error(error.message);
    return { updated: updated ?? 0 };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: updated, error } = await context.supabase.rpc("mark_all_notifications_read");
    if (error) throw new Error(error.message);
    return { updated: updated ?? 0 };
  });
