import { JOB_TYPES } from "@/lib/system-logger";

/** Estado de un log, con el color que usa todo el panel. */
export function statusBadgeClass(status: string): string {
  if (status === "success") return "bg-green-500/20 text-green-600 dark:text-green-400";
  if (status === "partial") return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
  return "bg-red-500/20 text-red-600 dark:text-red-400";
}

export function jobLabel(jobType: string): string {
  return JOB_TYPES[jobType as keyof typeof JOB_TYPES]?.label ?? jobType;
}

export function jobColorClass(jobType: string): string {
  return JOB_TYPES[jobType as keyof typeof JOB_TYPES]?.color ?? "bg-muted text-muted-foreground";
}

const BADGE = "inline-block rounded px-2 py-0.5 text-xs font-medium";

/** Las dos etiquetas (estado y tipo de job) de una fila de log. */
export function LogBadges({ status, jobType }: { status: string; jobType: string }) {
  return (
    <>
      <span className={`${BADGE} ${statusBadgeClass(status)}`}>{status}</span>
      <span className={`${BADGE} ${jobColorClass(jobType)}`}>{jobLabel(jobType)}</span>
    </>
  );
}
