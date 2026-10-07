"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import {
  clearSessionScopedClientData,
  getCachedSessionUser,
  syncCachedSessionUser,
} from "@/lib/auth/clearSessionScopedClientData";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setUser, setLoading } = useAuthStore();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      /*
       * supabase-js (≈55 KB gzip con GoTrue y Realtime) se carga aquí y no con un import estático:
       * así no entra en el JS crítico de todas las páginas y la hidratación no lo espera (PERF-08).
       * El estado de sesión ya arranca en `loading`, así que llegar unos cientos de ms más tarde
       * no cambia nada en pantalla.
       */
      const { createClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = createClient();

      const applyUserIdTransition = async (newUserId: string | null) => {
        if (prevUserIdRef.current === undefined) {
          const cachedUserId = getCachedSessionUser();
          if (cachedUserId !== newUserId) {
            queryClient.clear();
            clearSessionScopedClientData();
          }
          prevUserIdRef.current = newUserId;
          syncCachedSessionUser(newUserId);
          return;
        }
        if (prevUserIdRef.current === newUserId) {
          syncCachedSessionUser(newUserId);
          return;
        }
        prevUserIdRef.current = newUserId;
        queryClient.clear();
        clearSessionScopedClientData();
        syncCachedSessionUser(newUserId);
        await supabase.auth.getSession();
        router.refresh();
      };

      void supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (cancelled) return;
        await applyUserIdTransition(user?.id ?? null);
        setUser(user);
        setLoading(false);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        const nextId = session?.user?.id ?? null;
        void (async () => {
          await applyUserIdTransition(nextId);
          setUser(session?.user ?? null);
          setLoading(false);
        })();
      });
      unsubscribe = () => subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, router, setUser, setLoading]);

  return <>{children}</>;
}
