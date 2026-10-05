import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Bloque de carga con destello (`.ecos-skeleton` en `globals.css`). */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ecos-skeleton rounded-md", className)} {...props} />;
}

export { Skeleton };
