import { Skeleton } from "@/components/ui/skeleton";

function HistoryCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <Skeleton className="h-4 w-2/3 max-w-[14rem] rounded" />
      <div className="mt-4 flex items-center gap-3">
        <Skeleton className="h-12 w-12 shrink-0 rounded-full ring-2 ring-brand/20" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <Skeleton className="h-5 w-5 shrink-0 rounded" />
      </div>
    </div>
  );
}

/** Solo la zona de lista (cabecera y tabs reales encima) */
export function RankingHistoryListContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3" aria-busy aria-label="Loading">
      {[1, 2, 3].map((i) => (
        <HistoryCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Cabecera con back + título, toggle semanal/mensual, tarjetas tipo historial */
export function RankingHistorySkeleton() {
  return (
    <div
      className="flex min-h-full min-h-[calc(100dvh-5rem)] flex-col"
      aria-busy
      aria-label="Loading"
    >
      <div
        className="sticky top-0 z-30 flex items-center gap-2 px-2 py-3 pt-safe backdrop-blur-md"
        style={{
          background: "color-mix(in srgb, var(--background) 85%, transparent)",
        }}
      >
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="mx-auto h-5 min-w-0 flex-1 rounded pr-9" />
      </div>

      <div className="px-4 pb-3">
        <Skeleton className="h-11 w-full rounded-full" />
      </div>

      <RankingHistoryListContentSkeleton />
    </div>
  );
}
