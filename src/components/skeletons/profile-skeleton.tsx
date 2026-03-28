import { Skeleton } from "@/components/ui/skeleton";

/** Alineado con ProfileClient: título, avatar 24, stats grid 3×2 */
export function ProfileSkeleton() {
  return (
    <div
      className="flex min-h-full flex-col gap-5 px-4 pb-28"
      aria-busy
      aria-label="Loading"
    >
      <Skeleton className="mx-auto h-8 w-40 rounded-md" />

      <section className="flex flex-col items-center gap-3 py-4">
        <Skeleton className="h-24 w-24 shrink-0 rounded-full" />
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-6 w-36 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-5 w-56 rounded-full" />
          <Skeleton className="h-3 w-64 max-w-full rounded" />
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
        ))}
      </section>

      <div className="space-y-4">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
