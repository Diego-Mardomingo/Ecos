import type { SupabaseClient } from "@supabase/supabase-js";

export type JobType =
  | "ingestion"
  | "weekly_games"
  | "cron_daily"
  | "verify_youtube"
  | "report_auto_deactivate";

export type LogStatus = "success" | "partial" | "failure";

export interface LogSystemJobParams {
  job_type: JobType;
  status: LogStatus;
  summary: string;
  duration_ms?: number;
  errors?: string[];
  details: Record<string, unknown>;
}

/**
 * Registra un job automático en ecos_system_logs.
 * Usar desde API routes (cron-daily, report) o scripts (ingest, verify-youtube).
 * El caller debe pasar el cliente Supabase (createServiceClient en server, createClient con service key en scripts).
 */
export async function logSystemJob(
  supabase: SupabaseClient,
  params: LogSystemJobParams
): Promise<void> {
  const { job_type, status, summary, duration_ms, errors, details } = params;

  await supabase.from("ecos_system_logs").insert({
    job_type,
    status,
    summary,
    duration_ms: duration_ms ?? null,
    errors: errors?.length ? errors : null,
    details: details ?? {},
  });
}
