import {
  MutationCache,
  Mutation,
  QueryCache,
  QueryClient,
  onlineManager,
} from "@tanstack/react-query";
import { toast } from "sonner";

function mutationSkipsGlobalToast(mutation: Mutation<unknown, unknown, unknown, unknown>) {
  const meta = mutation.options.meta as { skipGlobalErrorToast?: boolean } | undefined;
  return Boolean(meta?.skipGlobalErrorToast);
}

function querySkipsGlobalLog(query: { meta?: Record<string, unknown> | undefined }) {
  return Boolean(query.meta?.skipGlobalErrorToast);
}

export function createQueryClient() {
  const queryCache = new QueryCache({
    onError: (error, query) => {
      if (querySkipsGlobalLog(query)) return;
      if (process.env.NODE_ENV === "development") {
        console.error("[Query]", query.queryKey, error);
      }
    },
  });

  const mutationCache = new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutationSkipsGlobalToast(mutation)) return;
      const msg = error instanceof Error ? error.message : "Error";
      toast.error(msg);
    },
  });

  return new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 10 * 60 * 1000,
        /** Evita refetch al volver a la pestaña (home y listas ya tienen stale propio). */
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount) => {
          if (!onlineManager.isOnline()) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        networkMode: "online",
        /** Evita POST duplicados (validate-guess, perfil, etc.). */
        retry: 0,
      },
    },
  });
}
