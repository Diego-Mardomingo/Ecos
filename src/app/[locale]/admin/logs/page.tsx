import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { JOB_TYPES, type JobType } from "@/lib/system-logger";
import { formatAdminDate } from "../_lib/format";
import { LogBadges, jobLabel } from "../_lib/LogBadges";
import { ingestionPlaylistStats, summarizeLog } from "../_lib/logSummary";

export const dynamic = "force-dynamic";

const STATUSES = ["success", "partial", "failure"] as const;
type StatusFilter = (typeof STATUSES)[number];

function isStatus(v: string | undefined): v is StatusFilter {
  return STATUSES.some((s) => s === v);
}

function isJobType(v: string | undefined): v is JobType {
  return v !== undefined && Object.keys(JOB_TYPES).includes(v);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  parts.push(`${s} s`);
  return parts.join(" ");
}

function JobDetailsSummary({ jobType, details }: { jobType: string; details: unknown }) {
  const lines = summarizeLog(jobType, details);
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {lines.map((line, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

function filterHref(status: StatusFilter | undefined, job: JobType | undefined): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (job) params.set("job", job);
  const qs = params.toString();
  return qs ? `/admin/logs?${qs}` : "/admin/logs";
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; job?: string }>;
}) {
  await requireAdminPage();

  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : undefined;
  const job = isJobType(params.job) ? params.job : undefined;

  const supabase = await createServiceClient();

  let query = supabase.from("ecos_system_logs").select("*");
  if (status) query = query.eq("status", status);
  if (job) query = query.eq("job_type", job);
  const { data: logs } = await query.order("ran_at", { ascending: false }).limit(100);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Logs del sistema
      </h2>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-xs text-muted-foreground">Estado</span>
          <FilterChip href={filterHref(undefined, job)} active={!status}>
            Todos
          </FilterChip>
          {STATUSES.map((s) => (
            <FilterChip key={s} href={filterHref(s, job)} active={status === s}>
              {s}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-xs text-muted-foreground">Tipo</span>
          <FilterChip href={filterHref(status, undefined)} active={!job}>
            Todos
          </FilterChip>
          {(Object.keys(JOB_TYPES) as JobType[]).map((j) => (
            <FilterChip key={j} href={filterHref(status, j)} active={job === j}>
              {jobLabel(j)}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {(logs ?? []).map((log) => {
          const playlistStats = log.job_type === "ingestion" ? ingestionPlaylistStats(log.details) : [];
          return (
            <details key={log.id} className="rounded-xl bg-card overflow-hidden">
              <summary className="flex cursor-pointer flex-col gap-1 px-4 py-3 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1 space-y-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <LogBadges status={log.status} jobType={log.job_type} />
                    <span className="text-sm">{log.summary ?? "-"}</span>
                  </div>
                  <JobDetailsSummary jobType={log.job_type} details={log.details} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground sm:mt-0">
                  {log.duration_ms != null && <span>{formatDuration(log.duration_ms)}</span>}
                  <span>{formatAdminDate(log.ran_at)}</span>
                  <span
                    aria-hidden
                    className="material-symbols-outlined text-base"
                    style={{ fontVariationSettings: "'FILL' 0" }}
                  >
                    expand_more
                  </span>
                </div>
              </summary>
              <div className="border-t border-border bg-muted/20 px-4 py-3">
                {log.errors?.length ? (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-destructive">Errores:</p>
                    <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                      {JSON.stringify(log.errors, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {playlistStats.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-muted-foreground">Por playlist:</p>
                    <ul className="mt-1 space-y-1 text-xs">
                      {playlistStats.map((p, i) => (
                        <li key={i}>
                          <span className="font-medium">{p.name}</span>
                          {p.exhausted && (
                            <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
                              agotada
                            </span>
                          )}
                          {p.truncated && (
                            <span className="ml-1.5 rounded bg-slate-500/20 px-1.5 py-0.5 text-slate-600 dark:text-slate-400">
                              ≥ 100 pistas
                            </span>
                          )}
                          {p.failed && (
                            <span className="ml-1.5 rounded bg-red-500/20 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                              error
                            </span>
                          )}
                          <span className="block text-muted-foreground">{p.line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs font-medium text-muted-foreground">Details:</p>
                <pre className="mt-1 overflow-x-auto text-xs">
                  {JSON.stringify(log.details ?? {}, null, 2)}
                </pre>
              </div>
            </details>
          );
        })}
        {(!logs || logs.length === 0) && (
          <p className="py-8 text-center text-muted-foreground">No hay logs</p>
        )}
      </div>
    </div>
  );
}
