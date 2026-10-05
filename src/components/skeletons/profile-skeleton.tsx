import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/skeletons/shared";

/** Calcado de `ProfileClient`: identidad, anillo de aciertos, rachas y dos grupos de ajustes. */
export function ProfileSkeleton() {
  return (
    <div className="flex min-h-full flex-col px-4 pb-28" aria-busy aria-label="Loading">
      <PageHeaderSkeleton withAction />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center rounded-[28px] border border-border bg-card px-5 pb-5 pt-6">
          <Skeleton className="size-[102px] rounded-full" />
          <Skeleton className="mt-3 h-7 w-40 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-32 rounded" />
          <Skeleton className="mt-3 h-6 w-36 rounded-full" />
        </div>
        <div className="flex items-center gap-5 rounded-3xl border border-border bg-card p-4">
          <Skeleton className="size-24 shrink-0 rounded-full" />
          <div className="flex-1 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-4 w-full rounded" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-[124px] rounded-3xl" />
          <Skeleton className="h-[124px] rounded-3xl" />
        </div>
        {[3, 2].map((rows, g) => (
          <div key={g}>
            <Skeleton className="mb-2 ml-1 h-3 w-28 rounded" />
            <div className="divide-y divide-border rounded-3xl border border-border bg-card">
              {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
                  <Skeleton className="size-9 rounded-xl" />
                  <Skeleton className="h-4 flex-1 rounded" />
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
