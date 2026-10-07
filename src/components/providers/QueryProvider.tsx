"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  PersistQueryClientProvider,
  removeOldestQuery,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createQueryClient } from "@/lib/createQueryClient";
import {
  QUERY_CACHE_STORAGE_KEY,
  QUERY_CACHE_VERSION,
  shouldPersistQuery,
} from "@/lib/queryPersist";

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

function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    // Navegadores o iframes que prohíben el almacenamiento: sin persistencia, nada más.
    return undefined;
  }
}

/**
 * El persister se crea siempre, también en el servidor: sin `storage` es uno vacío que no hace
 * nada. Así el árbol es el mismo en servidor y en cliente (ver `QueryProvider`).
 */
let browserPersister: Persister | undefined;

function getPersister(): Persister {
  const create = () =>
    createSyncStoragePersister({
      storage: getLocalStorage(),
      key: QUERY_CACHE_STORAGE_KEY,
      // Si la cuota se llena (la comparte con el progreso del invitado), se van descartando las
      // queries más antiguas hasta que quepa. Antes el error se tragaba y no se guardaba nada.
      retry: removeOldestQuery,
    });
  if (typeof window === "undefined") return create();
  browserPersister ??= create();
  return browserPersister;
}

/**
 * Proveedor de TanStack Query con la caché persistida en `localStorage`.
 *
 * Siempre es el mismo elemento, `PersistQueryClientProvider`. Antes se renderizaba un
 * `QueryClientProvider` hasta hidratar y luego se cambiaba al persistente: al ser otro tipo de
 * elemento, React desmontaba y volvía a montar **toda** la app justo después de hidratar (dos
 * `getUser()` a la vez, peticiones repetidas y las animaciones de entrada otra vez; PERF-05). La
 * restauración desde `localStorage` ya ocurre en un efecto del propio proveedor, así que no hace
 * falta esperar a hidratar para montarlo.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

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

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: getPersister(),
        maxAge: 24 * 60 * 60 * 1000,
        buster: QUERY_CACHE_VERSION,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </PersistQueryClientProvider>
  );
}
