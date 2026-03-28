import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Portada cuadrada + barras de acción (juego / play/[gameId]) */
export function PlayGameSkeleton({ footer }: { footer?: ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4"
      aria-busy
      aria-label="Loading"
    >
      <Skeleton
        className="aspect-square w-full max-w-[280px] rounded-2xl"
        aria-hidden
      />
      <div className="w-full max-w-[280px] space-y-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
      {footer ? (
        <div className="text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}
