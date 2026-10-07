import { Skeleton } from "@/components/ui/skeleton";

/**
 * Piezas comunes de los skeletons, calcadas de los componentes reales: `PageHeader` y
 * `SegmentedControl`. Si cambian sus medidas, hay que cambiarlas aquí también.
 */

/** Hueco de `PageHeader`. Raíz: título grande a la izquierda; subpágina: volver + título centrado. */
export function PageHeaderSkeleton({
  subpage = false,
  withAction = false,
  withSubtitle = false,
}: {
  subpage?: boolean;
  withAction?: boolean;
  withSubtitle?: boolean;
}) {
  return (
    <div className={subpage ? "flex min-h-14 items-center gap-3 pb-3 pt-2" : "flex min-h-14 items-center gap-3 pb-3 pt-3"}>
      {subpage && <Skeleton className="size-10 shrink-0 rounded-full" />}
      <div className={subpage ? "flex flex-1 flex-col items-center gap-1.5" : "flex flex-1 flex-col gap-1.5"}>
        {!subpage && <Skeleton className="h-3 w-24 rounded" />}
        <Skeleton className={subpage ? "h-5 w-32 rounded" : "h-7 w-40 rounded-lg"} />
        {withSubtitle && <Skeleton className="h-3 w-28 rounded" />}
      </div>
      {withAction ? <Skeleton className="size-10 shrink-0 rounded-full" /> : subpage ? <div className="size-10 shrink-0" /> : null}
    </div>
  );
}

export function SegmentedSkeleton() {
  return <Skeleton className="h-11 w-full rounded-full" />;
}
