import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PageHeaderSkeleton, SegmentedSkeleton } from "@/components/skeletons/shared";

/** Calcado de `LeaderboardPodiumAndList`: columnas del podio (2·1·3) y filas desde el cuarto. */
function PodiumColumnSkeleton({ pedestal, avatar }: { pedestal: string; avatar: string }) {
  return (
    <div className="flex flex-col items-center">
      <Skeleton className={cn("rounded-full", avatar)} />
      <Skeleton className="mt-2 h-3 w-14 rounded" />
      <Skeleton className="mt-1.5 h-3.5 w-16 rounded" />
      <Skeleton className={cn("mt-2 w-full rounded-b-none rounded-t-2xl", pedestal)} />
    </div>
  );
}

/** Podio + filas (para LeaderboardClient en carga, el detalle del histórico y el loading de ruta). */
export function RankingPodiumAndListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-1 flex-col" aria-busy aria-label="Loading">
      <div className="grid grid-cols-3 items-end gap-2 px-1 pb-2 pt-8">
        <PodiumColumnSkeleton avatar="size-14" pedestal="h-[72px]" />
        <PodiumColumnSkeleton avatar="size-[72px]" pedestal="h-24" />
        <PodiumColumnSkeleton avatar="size-14" pedestal="h-14" />
      </div>
      <div className="mt-4 flex flex-col gap-2 pb-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
            <Skeleton className="h-4 w-6 rounded" />
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
            <Skeleton className="h-4 w-14 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Página de ranking entera (loading de ruta). */
export function RankingSkeleton() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-4" aria-busy aria-label="Loading">
      <PageHeaderSkeleton withAction />
      <SegmentedSkeleton />
      <RankingPodiumAndListSkeleton />
    </div>
  );
}
