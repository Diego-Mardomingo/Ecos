"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createQueryClient } from "@/lib/createQueryClient";
import { shouldPersistQuery } from "@/lib/queryPersist";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const [persistReady, setPersistReady] = useState(false);

  useEffect(() => {
    /* Persist needs mount: localStorage is only available on the client. */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount switch to PersistQueryClientProvider
    setPersistReady(true);
  }, []);

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
      key: "ecos-query-cache",
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
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {content}
    </PersistQueryClientProvider>
  );
}
