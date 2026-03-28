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

/** Detalle de un periodo del historial: cabecera con subtítulo + podio + tabla */
export function RankingDetailSkeleton() {
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
        <div className="min-w-0 flex-1 space-y-2 pr-9 text-center">
          <Skeleton className="mx-auto h-5 w-40 rounded" />
          <Skeleton className="mx-auto h-3 w-52 max-w-full rounded" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 py-6">
          <div className="flex items-end justify-center gap-4">
            <PodiumBarSkeleton barClass="h-10" />
            <PodiumBarSkeleton barClass="h-16" elevated />
            <PodiumBarSkeleton barClass="h-8" />
          </div>
        </div>

        <div
          className={cn(
            leaderboardHeaderGridClass,
            "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          )}
        >
          <span aria-hidden className="block min-h-[1px] w-full" />
          <Skeleton className="h-3 max-w-[2rem] rounded" />
          <Skeleton className="h-3 max-w-[4rem] rounded" />
          <Skeleton className="h-3 max-w-[2.5rem] justify-self-end rounded" />
          <Skeleton className="h-3 max-w-[3rem] justify-self-end rounded" />
        </div>

        <div className="flex flex-col gap-1 px-4 pb-28">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl bg-card">
              <div className={leaderboardRowGridClass}>
                <div
                  className="flex h-full min-h-[2rem] justify-center"
                  aria-hidden
                />
                <Skeleton className="h-4 w-6 rounded tabular-nums" />
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 min-w-0 flex-1 rounded" />
                </div>
                <Skeleton className="h-4 w-8 justify-self-end rounded tabular-nums" />
                <Skeleton className="h-4 w-12 justify-self-end rounded tabular-nums" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
