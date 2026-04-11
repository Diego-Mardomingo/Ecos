import { Skeleton } from "@/components/ui/skeleton";

/** Cabecera alineada con ResultGameView / pantalla de juego (back · fecha · acción derecha). */
function PlayGameDetailHeaderSkeleton({ mode }: { mode: "result" | "playing" }) {
  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between gap-2 border-b border-border/80 bg-background/95 px-4 pt-safe backdrop-blur-sm">
      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" aria-hidden />
      <Skeleton className="mx-auto h-3 w-32 max-w-[45%]" aria-hidden />
      {mode === "result" ? (
        <div className="flex w-28 shrink-0 flex-col items-end gap-1">
          <div className="flex w-full items-center gap-1.5">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" aria-hidden />
            <Skeleton className="h-1 flex-1 rounded-full" aria-hidden />
          </div>
          <Skeleton className="h-2 w-16" aria-hidden />
        </div>
      ) : (
        <Skeleton className="h-9 w-[5.5rem] shrink-0 rounded-lg" aria-hidden />
      )}
    </header>
  );
}

/** Vista resultado (portada, título, puntos, compartir) — como ResultScreen en GameClient. */
export function PlayGameCompletedDetailSkeleton() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background" aria-busy aria-label="Loading">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/5 blur-[100px]" />
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <PlayGameDetailHeaderSkeleton mode="result" />
        <div className="h-14 shrink-0" aria-hidden />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-8 text-center">
            <Skeleton className="h-44 w-44 shrink-0 rounded-2xl shadow-2xl" aria-hidden />
            <div className="space-y-2">
              <Skeleton className="mx-auto h-3 w-24" aria-hidden />
              <Skeleton className="mx-auto h-8 w-56 max-w-full" aria-hidden />
              <Skeleton className="mx-auto h-4 w-40 max-w-full" aria-hidden />
              <div className="mt-3 space-y-2">
                <Skeleton className="mx-auto h-3 w-full max-w-xs" aria-hidden />
                <Skeleton className="mx-auto h-3 w-[85%] max-w-xs" aria-hidden />
              </div>
            </div>
            <div className="w-full max-w-sm rounded-2xl px-5 pb-10 pt-1">
              <div className="mb-5 flex justify-center gap-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
                ))}
              </div>
              <Skeleton className="mx-auto mb-1 h-9 w-32" aria-hidden />
              <Skeleton className="mx-auto h-4 w-48" aria-hidden />
              <Skeleton className="mt-4 h-12 w-full rounded-full" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vista en progreso — timer, aro, puntos, input — como PlayingGameAudioSection + GuessInput. */
export function PlayGameInProgressDetailSkeleton() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background" aria-busy aria-label="Loading">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/5 blur-[100px]" />
      </div>
      <div className="relative z-10 flex flex-col">
        <PlayGameDetailHeaderSkeleton mode="playing" />
        <div className="h-14 shrink-0" aria-hidden />
        <div className="flex w-full flex-col items-center px-4 pb-4 pt-1">
          <Skeleton className="h-9 w-20" aria-hidden />
          <Skeleton className="mt-2 h-1.5 w-full max-w-sm rounded-full" aria-hidden />
        </div>
        <div className="relative flex shrink-0 flex-col items-center gap-3 overflow-hidden px-4 pb-2 pt-4">
          <Skeleton className="size-32 rounded-full" aria-hidden />
          <div className="flex items-center gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
            ))}
          </div>
        </div>
        <div className="px-4 pb-8 pt-5">
          <Skeleton className="mb-3 h-10 w-full rounded-xl" aria-hidden />
          <Skeleton className="h-12 w-full rounded-xl" aria-hidden />
        </div>
      </div>
    </div>
  );
}
