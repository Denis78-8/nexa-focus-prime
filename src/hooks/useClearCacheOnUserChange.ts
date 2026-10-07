import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Query keys (["nexa","workspace"], ["nexa","directory"], …) are not scoped
 * by user, so the whole cache is dropped on sign-out and whenever the signed-in
 * user changes. One listener for the app; mounted queries refetch for the new
 * user, and realtime channels are untouched.
 */
export function useClearCacheOnUserChange(queryClient: QueryClient) {
  useEffect(() => {
    let lastUserId: string | null | undefined;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        const userId = session?.user.id ?? null;
        const changed = event === "SIGNED_OUT" || (lastUserId !== undefined && lastUserId !== userId);
        lastUserId = userId;
        if (changed) queryClient.clear();
      });
      subscription = data.subscription;
    } catch {
      // No client (missing env): useAuth reports the connection error.
    }
    return () => subscription?.unsubscribe();
  }, [queryClient]);
}
