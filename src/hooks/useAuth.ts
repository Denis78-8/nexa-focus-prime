import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession()
      .then(({ data: d, error }) => {
        if (error) throw error;
        setSession(d.session);
      })
      .catch((error: unknown) => {
        console.error("[NEXA Auth] Не удалось восстановить сессию", error);
        setSession(null);
      })
      .finally(() => setLoading(false));
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}
