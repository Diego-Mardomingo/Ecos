import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Única lista de tipos de job de `ecos_system_logs`, con la etiqueta y el color con que los
 * pinta el panel de admin. El `CHECK ecos_system_logs_job_type_check` de la base de datos
 * (supabase/schema/01_tables.sql) y las constantes `JOB_*` de scripts/common.py tienen que
 * llevar los mismos valores: al añadir un tipo, se toca en los tres sitios.
 */
export const JOB_TYPES = {
  ingestion: {
    label: "Ingesta",
    color: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  daily_game: {
    label: "Juego diario",
    color: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  },
  daily_notifications: {
    label: "Notificaciones diarias",
    color: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  },
  games_check: {
    label: "Comprobación de juegos",
    color: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
  },
  // Desde la revisión de reportes ya no desactiva nada: avisa de que 3 usuarios distintos han
  // reportado la misma canción. El valor no cambia porque lo admite el CHECK de la BD.
  report_auto_deactivate: {
    label: "Aviso por reportes",
    color: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
  },
  // Histórico: lo escribió el primer script de juegos semanales (1 fila, 10/03/2026). Nadie lo
  // escribe ya, pero el CHECK lo admite y esa fila sigue en el panel.
  weekly_games: {
    label: "Juegos semanales (histórico)",
    color: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
  },
} as const;

export type JobType = keyof typeof JOB_TYPES;

type LogStatus = "success" | "partial" | "failure";

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
 * Usar desde API routes (report) o scripts (ingest).
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
