import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/skeletons/shared";

export default function CategoriesLoading() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-4" aria-busy aria-label="Loading">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 pb-4 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[132px] rounded-3xl" />
        ))}
      </div>
    </div>
  );
}
