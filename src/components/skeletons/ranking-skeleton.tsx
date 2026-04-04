import {
  leaderboardHeaderGridClass,
  leaderboardRowGridClass,
} from "@/components/leaderboard/leaderboard-grid-classes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function PodiumBarSkeleton({
  barClass,
  elevated,
}: {
  barClass: string;
  elevated?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center gap-2",
        elevated && "-mb-2"
      )}
    >
      <Skeleton className="h-14 w-14 rounded-full" />
      <Skeleton className="h-3 w-16 rounded" />
      <Skeleton className={cn("w-full max-w-[5.5rem] rounded-t-lg", barClass)} />
    </div>
  );
}

/** Podio + cabecera de tabla + filas (para LeaderboardClient en carga o route loading) */
export function RankingPodiumAndListSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-busy aria-label="Loading">
      <div className="px-4 py-6">
        <div className="flex items-end justify-center gap-4">
          <PodiumBarSkeleton barClass="h-10" />
          <PodiumBarSkeleton barClass="h-16" elevated />
          <PodiumBarSkeleton barClass="h-8" />
        </div>
      </div>

      <div className="px-4">
        <div
          className={cn(
            leaderboardHeaderGridClass,
            "text-[11px] font-semibold leading-snug tracking-wide text-muted-foreground sm:text-xs"
          )}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="block w-1 shrink-0" aria-hidden />
            <Skeleton className="h-3.5 w-[2.75rem] shrink-0 rounded" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <Skeleton className="h-3.5 max-w-[4rem] flex-1 rounded" />
            <Skeleton className="h-3.5 w-12 shrink-0 rounded" />
          </div>
        </div>

        <div className="flex flex-col gap-1 pb-28">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl bg-card">
              <div className={leaderboardRowGridClass}>
                <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
                  <span className="block h-8 w-1 shrink-0" />
                  <Skeleton className="h-4 w-[2.75rem] shrink-0 rounded tabular-nums" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
                    <Skeleton className="h-4 w-full max-w-[10rem] rounded" />
                    <Skeleton className="h-3 w-24 rounded" />
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end self-center">
                  <Skeleton className="h-4 w-12 rounded tabular-nums" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-24 flex-shrink-0" aria-hidden />
    </div>
  );
}

/** Cabecera sticky, banner invitado, tabs pill, podio y lista */
export function RankingSkeleton() {
  return (
    <div
      className="flex min-h-full min-h-[calc(100dvh-5rem)] flex-col"
      aria-busy
      aria-label="Loading"
    >
      <div
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 pt-safe backdrop-blur-md"
        style={{
          background: "color-mix(in srgb, var(--background) 85%, transparent)",
        }}
      >
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-5 w-28 rounded" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>

      <Skeleton className="mx-4 mt-1 h-[4.5rem] rounded-2xl" />

      <div className="px-4 py-3">
        <Skeleton className="flex h-11 w-full rounded-full p-1" />
      </div>

      <RankingPodiumAndListSkeleton />
    </div>
  );
}
