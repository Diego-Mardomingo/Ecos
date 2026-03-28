import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Pantalla intermedia /play (antes de elegir juego) */
export function PlayRouteSkeleton({ footer }: { footer?: ReactNode }) {
  return (
    <div
      className="flex min-h-full flex-col items-center justify-center gap-4 px-4"
      aria-busy
      aria-label="Loading"
    >
      <Skeleton className="h-16 w-16 rounded-2xl" />
      <Skeleton className="h-6 w-48 rounded" />
      <Skeleton className="h-4 w-32 rounded" />
      {footer ? (
        <div className="text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}
