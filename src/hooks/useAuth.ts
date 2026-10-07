import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Keeps the previous session object while the user stays the same (repeated
 * SIGNED_IN, TOKEN_REFRESHED): UI reads only user id and email, and server
 * functions take the current access token from supabase.auth.getSession() at
 * call time, so a refreshed token needs no React state update.
 */
function keepSameUser(previous: Session | null, next: Session | null) {
  if (previous && next && previous.user.id === next.user.id && previous.user.email === next.user.email) return previous;
  return next;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_e, s) => {
        if (mounted) setSession((previous) => keepSameUser(previous, s));
      });
      subscription = data.subscription;
      void supabase.auth.getSession()
        .then(({ data: result, error }) => {
          if (error) throw error;
          if (mounted) setSession((previous) => keepSameUser(previous, result.session));
        })
        .catch((error: unknown) => {
          console.error("[NEXA Auth] Не удалось восстановить сессию", error);
          if (mounted) {
            setSession(null);
            setConnectionError(true);
          }
        })
        .finally(() => { if (mounted) setLoading(false); });
    } catch (error) {
      console.error("[NEXA Auth] Не удалось подключиться", error);
      setConnectionError(true);
      setLoading(false);
    }
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading, connectionError };
}
