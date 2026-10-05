import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, SegmentedSkeleton } from "@/components/skeletons/shared";

/** Calcado de `WinnerCard` en `LeaderboardHistoryListClient`. */
function WinnerCardSkeleton() {
  return (
    <div className="w-[220px] shrink-0 rounded-3xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-28 rounded" />
      <div className="mt-3 flex items-center gap-3">
        <Skeleton className="size-11 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-20 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
        </div>
      </div>
    </div>
  );
}

/** Solo la zona de lista (cabecera y selector reales encima): dos meses con su carril de semanas. */
export function RankingHistoryListContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6" aria-busy aria-label="Loading">
      {[0, 1].map((m) => (
        <div key={m}>
          <div className="mb-2.5 flex items-center justify-between">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
          <div className="-mx-4 flex gap-3 overflow-hidden px-4">
            <WinnerCardSkeleton />
            <WinnerCardSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Página del histórico entera (loading de ruta). */
export function RankingHistorySkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col px-4" aria-busy aria-label="Loading">
      <PageHeaderSkeleton subpage />
      <SegmentedSkeleton />
      <div className="pt-5">
        <RankingHistoryListContentSkeleton />
      </div>
    </div>
  );
}
