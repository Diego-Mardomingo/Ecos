"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { QueryClientProvider, onlineManager, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createQueryClient } from "@/lib/createQueryClient";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { QUERY_CACHE_STORAGE_KEY, shouldPersistQuery } from "@/lib/queryPersist";

/**
 * En el navegador, un único QueryClient para toda la vida de la pestaña.
 *
 * Si se creara dentro del componente, se perdería cada vez que el proveedor se vuelve a montar, y
 * eso pasa más de lo que parece: al cambiar de idioma, Next rehace todo lo que cuelga de
 * `[locale]/layout.tsx` (el segmento cambia de valor), y al pasar de la app al panel de admin se
 * monta otro `QueryProvider`. Con la caché nueva volvían los esqueletos y las peticiones.
 *
 * En el servidor sí se crea uno por render: compartirlo mezclaría datos entre peticiones.
 * El vaciado al cambiar de usuario no depende de esto: lo hace `AuthProvider`.
 */
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  /* La persistencia necesita localStorage, así que espera a hidratar. En un remontaje posterior
     (cambio de idioma) ya es `true` desde el primer render y no se alterna de proveedor, que
     volvería a montar todo el árbol una segunda vez. */
  const persistReady = useIsMounted();

  useEffect(() => {
    return onlineManager.setEventListener((setOnline) => {
      const onOnline = () => setOnline(true);
      const offOnline = () => setOnline(false);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", offOnline);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", offOnline);
      };
    });
  }, []);

  const persister = useMemo(() => {
    if (!persistReady || typeof window === "undefined") return null;
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: QUERY_CACHE_STORAGE_KEY,
    });
  }, [persistReady]);

  const content = (
    <>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </>
  );

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        // Invalida la caché persistida cuando cambia el build: evita restaurar
        // datos con un esquema antiguo tras un deploy.
        buster:
          process.env.NEXT_PUBLIC_BUILD_ID ??
          process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
          "dev",
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {content}
    </PersistQueryClientProvider>
  );
}
