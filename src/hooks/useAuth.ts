import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_e, s) => {
        if (mounted) setSession(s);
      });
      subscription = data.subscription;
      void supabase.auth.getSession()
        .then(({ data: result, error }) => {
          if (error) throw error;
          if (mounted) setSession(result.session);
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
