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
    /**
     * Se loguea también en producción. Antes solo en desarrollo, así que un fetch que fallara en
     * producción dejaba la pantalla vacía sin rastro en ninguna parte.
     *
     * No se muestra toast: aquí caen también los prefetch de la home y los refetch en segundo
     * plano, que el usuario no ha pedido, y con mala cobertura saldría una ráfaga de avisos por
     * algo que no ha hecho. Los errores de acciones suyas ya avisan por `mutationCache`.
     */
    onError: (error, query) => {
      if (querySkipsGlobalLog(query)) return;
      console.error("[Query]", query.queryKey, error);
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
