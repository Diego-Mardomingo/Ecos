import { PageHeaderSkeleton } from "@/components/skeletons/shared";
import { RankingPodiumAndListSkeleton } from "@/components/skeletons/ranking-skeleton";

/** Detalle de un periodo del histórico: cabecera con subtítulo + podio + filas. */
export function RankingDetailSkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col px-4 pb-28" aria-busy aria-label="Loading">
      <PageHeaderSkeleton subpage withSubtitle />
      <RankingPodiumAndListSkeleton />
    </div>
  );
}
