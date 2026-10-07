import { Skeleton } from "@/components/ui/skeleton";

/**
 * Calcado de `HomeClient`: cabecera, tarjeta del reto, cuenta atrás, «Tu progreso», últimos días
 * y el calendario del archivo.
 */
export function HomeSkeleton() {
  return (
    <div className="flex min-h-full flex-col gap-[26px] px-4 pb-6" aria-busy aria-label="Loading">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-9 rounded-xl" />
            <Skeleton className="h-6 w-16 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="size-10 rounded-full" />
          </div>
        </div>

        {/* Tarjeta del reto */}
        <div className="@container flex flex-col gap-4 rounded-[28px] border border-border bg-card p-[18px]">
          {/* Funda + disco asomando. `.ecos-skeleton` fuerza `position: relative`, así que el
              posicionado va en envoltorios; la funda lleva base opaca para que el disco no se
              transparente por debajo. */}
          <div className="relative [--s:min(216px,64cqw)]">
            <div
              className="absolute"
              style={{
                width: "calc(var(--s) * 0.954)",
                height: "calc(var(--s) * 0.954)",
                left: "calc(var(--s) * 0.5)",
                top: "calc(var(--s) * 0.023)",
              }}
            >
              <Skeleton className="size-full rounded-full" />
            </div>
            <div className="relative w-[var(--s)] rounded-xl bg-card">
              <Skeleton className="aspect-square w-full rounded-xl" />
            </div>
          </div>
          <Skeleton className="h-7 w-56 rounded-lg" />
          <div className="flex gap-2.5">
            <Skeleton className="h-[52px] flex-1 rounded-full" />
            <Skeleton className="size-[52px] rounded-full" />
          </div>
        </div>

        <div className="flex justify-center">
          <Skeleton className="h-7 w-52 rounded-full" />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-6 w-32 rounded-lg" />
          <Skeleton className="h-8 w-44 rounded-[11px]" />
        </div>
        <Skeleton className="h-[150px] rounded-[22px]" />
        <Skeleton className="mt-2.5 h-[120px] rounded-[22px]" />
      </div>

      <div>
        <Skeleton className="mb-3 h-6 w-32 rounded-lg" />
        <div className="-mx-4 flex gap-3 overflow-hidden px-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-[124px] shrink-0">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <Skeleton className="mt-2 h-3 w-20 rounded" />
              <Skeleton className="mt-1.5 h-3 w-14 rounded" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-6 w-24 rounded-lg" />
          <div className="flex gap-1">
            <Skeleton className="size-8 rounded-[10px]" />
            <Skeleton className="size-8 rounded-[10px]" />
          </div>
        </div>
        <div className="rounded-[22px] border border-border bg-card p-3">
          <div className="flex items-center justify-between px-1 pb-3">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-32 rounded" />
              <Skeleton className="h-3 w-40 rounded" />
            </div>
            <Skeleton className="size-11 rounded-full" />
          </div>
          <div className="grid grid-cols-7 gap-[5px]">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-[11px]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
