"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/lib/store/authStore";
import { clearSessionScopedClientData } from "@/lib/auth/clearSessionScopedClientData";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setUser, setLoading } = useAuthStore();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();

    const applyUserIdTransition = (newUserId: string | null) => {
      if (prevUserIdRef.current === undefined) {
        prevUserIdRef.current = newUserId;
        return;
      }
      if (prevUserIdRef.current === newUserId) return;
      prevUserIdRef.current = newUserId;
      queryClient.clear();
      clearSessionScopedClientData();
      router.refresh();
    };

    supabase.auth.getUser().then(({ data: { user } }) => {
      applyUserIdTransition(user?.id ?? null);
      setUser(user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user?.id ?? null;
      applyUserIdTransition(nextId);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient, router, setUser, setLoading]);

  return <>{children}</>;
}
