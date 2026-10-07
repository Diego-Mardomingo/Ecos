import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeletons de la partida, calcados de `GameHeader`, `PlayingGameAudioSection` y
 * `ResultGameView`. Los usan el loading de `/play/[gameId]` y el overlay que se pinta al pulsar
 * un día desde la home.
 */

/** Cabecera fija (volver · reto y fecha · acción). */
function GameHeaderSkeleton({ withAction }: { withAction: boolean }) {
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 pt-safe">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-2 px-4">
          <Skeleton className="size-10 shrink-0 rounded-full" aria-hidden />
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-3 w-20 rounded" aria-hidden />
            <Skeleton className="h-3 w-36 rounded" aria-hidden />
          </div>
          {withAction ? <Skeleton className="h-10 w-24 rounded-full" aria-hidden /> : <div className="size-10" />}
        </div>
      </div>
      <div className="h-14 shrink-0 pt-safe box-content" aria-hidden />
    </>
  );
}

/** Onda segmentada en reposo: los seis tramos con sus etiquetas. */
function WaveformSkeleton() {
  const weights = [1, 1.41, 2, 2.83, 4, 5.48];
  return (
    <>
      <div className="flex h-[72px] gap-1.5">
        {weights.map((w, i) => (
          <Skeleton key={i} className="h-full rounded-lg" style={{ flex: `${w} 1 0` }} aria-hidden />
        ))}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {weights.map((w, i) => (
          <Skeleton key={i} className="h-1.5 rounded-full" style={{ flex: `${w} 1 0` }} aria-hidden />
        ))}
      </div>
    </>
  );
}

/** Vista resultado: carátula, veredicto, título, onda, puntos y compartir. */
export function PlayGameCompletedDetailSkeleton() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background" aria-busy aria-label="Loading">
      <GameHeaderSkeleton withAction={false} />
      <div className="flex flex-col items-center gap-6 px-5 pb-12 pt-6">
        <Skeleton className="size-[200px] rounded-2xl" aria-hidden />
        <div className="mt-2 flex w-full flex-col items-center gap-2">
          <Skeleton className="h-6 w-36 rounded-full" aria-hidden />
          <Skeleton className="mt-1 h-3 w-24 rounded" aria-hidden />
          <Skeleton className="h-8 w-60 max-w-full rounded-lg" aria-hidden />
          <Skeleton className="h-4 w-32 rounded" aria-hidden />
        </div>
        <div className="w-full rounded-3xl border border-border bg-card p-4">
          <WaveformSkeleton />
        </div>
        <Skeleton className="h-12 w-40 rounded-xl" aria-hidden />
        <Skeleton className="h-14 w-full rounded-full" aria-hidden />
      </div>
    </div>
  );
}

/** Vista en progreso: tarjeta de la onda, reloj con el botón de play y el buscador. */
export function PlayGameInProgressDetailSkeleton() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background" aria-busy aria-label="Loading">
      <GameHeaderSkeleton withAction />
      <div className="flex flex-col gap-4 px-4 pt-3">
        <div className="rounded-3xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-24 rounded" aria-hidden />
            <Skeleton className="h-7 w-32 rounded-full" aria-hidden />
          </div>
          <WaveformSkeleton />
        </div>
        <div className="flex h-[92px] items-center justify-center gap-6">
          <Skeleton className="h-4 w-10 rounded" aria-hidden />
          <Skeleton className="size-[84px] rounded-full" aria-hidden />
          <Skeleton className="h-4 w-10 rounded" aria-hidden />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl" aria-hidden />
      </div>
    </div>
  );
}
