import { Skeleton } from "@/components/ui/skeleton";

/** Alineado con HomeClient: cabecera sticky, hero 4/3, fila de acciones 2 columnas */
export function HomeSkeleton() {
  return (
    <div
      className="flex min-h-full flex-col gap-5 px-4 pb-6"
      aria-busy
      aria-label="Loading"
    >
      <div className="flex flex-col gap-1">
        <div
          className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-md"
          style={{
            background: "color-mix(in srgb, var(--background) 85%, transparent)",
          }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
            <Skeleton className="h-5 w-24 rounded" />
            <Skeleton className="h-5 w-5 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="h-9 w-9 rounded-xl" />
          </div>
        </div>

        <div className="mb-3 flex justify-center">
          <Skeleton className="h-8 w-44 rounded-full" />
        </div>

        <Skeleton
          className="aspect-[4/3] w-full rounded-2xl"
          aria-hidden
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </section>

      <div className="space-y-2">
        <Skeleton className="h-4 w-32 rounded" />
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-20 shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
