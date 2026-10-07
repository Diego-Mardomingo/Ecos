import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { addCalendarDays, getEffectiveGameDate } from "@/lib/date-utils";
import type { JobType } from "@/lib/system-logger";
import { ageHours, formatAdminDate, formatAge, formatGameDate } from "./format";
import { jobColorClass, jobLabel, statusBadgeClass } from "./LogBadges";
import { RESERVE_CRITICAL, RESERVE_WARNING, countSelectorReserve } from "./reserve";

type Level = "ok" | "warning" | "error";

const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-green-600 dark:text-green-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

const LEVEL_ICON: Record<Level, string> = {
  ok: "check_circle",
  warning: "warning",
  error: "error",
};

function LevelIcon({ level }: { level: Level }) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined text-xl ${LEVEL_TEXT[level]}`}
      style={{ fontVariationSettings: "'FILL' 1" }}
    >
      {LEVEL_ICON[level]}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="mb-2 font-medium">{title}</p>
      {children}
    </div>
  );
}

/**
 * Antigüedad máxima (horas) antes de dar un job por parado. Los diarios tienen margen para el
 * retraso del cron de Actions (hasta ~6 h); la ingesta es semanal.
 */
const JOB_MAX_AGE_HOURS: Partial<Record<JobType, number>> = {
  daily_game: 30,
  daily_notifications: 30,
  games_check: 30,
  ingestion: 9 * 24,
};

const WATCHED_JOBS = Object.keys(JOB_MAX_AGE_HOURS) as JobType[];

const COVERAGE_LABELS = ["Hoy", "Mañana", "Pasado mañana"];

function currentTime(): number {
  return Date.now();
}

/**
 * Cobertura de juegos, antigüedad de cada job y problemas recientes. `reserve` es la tarjeta de la
 * reserva del selector, que tarda más y la página envuelve en `Suspense`.
 */
export async function HealthSection({ reserve }: { reserve: React.ReactNode }) {
  const supabase = createServiceClient();
  const nowMs = currentTime();
  const today = getEffectiveGameDate(new Date(nowMs));
  const dates = [today, addCalendarDays(today, 1), addCalendarDays(today, 2)];
  const sinceIso = new Date(nowMs - 7 * 24 * 3_600_000).toISOString();

  const [gamesRes, failuresRes, partialsRes, ...lastRuns] = await Promise.all([
    supabase.from("ecos_games").select("date, game_number").in("date", dates),
    supabase
      .from("ecos_system_logs")
      .select("*", { count: "exact", head: true })
      .eq("status", "failure")
      .gte("ran_at", sinceIso),
    supabase
      .from("ecos_system_logs")
      .select("*", { count: "exact", head: true })
      .eq("status", "partial")
      .gte("ran_at", sinceIso),
    ...WATCHED_JOBS.map((job) =>
      supabase
        .from("ecos_system_logs")
        .select("status, ran_at")
        .eq("job_type", job)
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ),
  ]);

  const gameByDate = new Map<string, number>(
    (gamesRes.data ?? []).map((g: { date: string; game_number: number }) => [g.date, g.game_number])
  );
  const failures = failuresRes.count ?? 0;
  const partials = partialsRes.count ?? 0;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Salud
      </h2>

      <Card title="Cobertura de juegos">
        {gamesRes.error && (
          <p className={`mb-2 text-sm ${LEVEL_TEXT.error}`}>
            No se pudo leer ecos_games: lo que sigue puede no ser real.
          </p>
        )}
        <ul className="space-y-1.5">
          {dates.map((date, i) => {
            const number = gameByDate.get(date);
            const present = number !== undefined;
            // Hoy y mañana son críticos; pasado mañana todavía deja margen al cron (como
            // check-games.py).
            const level: Level = present ? "ok" : i < 2 ? "error" : "warning";
            return (
              <li key={date} className="flex items-center gap-2 text-sm">
                <LevelIcon level={level} />
                <span className="w-28 font-medium">{COVERAGE_LABELS[i]}</span>
                <span className="text-muted-foreground">{formatGameDate(date)}</span>
                <span className={`ml-auto ${LEVEL_TEXT[level]}`}>
                  {present ? `Ecos #${number}` : "Falta el juego"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Hora de Madrid: {formatAdminDate(new Date(nowMs).toISOString())}
        </p>
      </Card>

      {reserve}

      <Card title="Última ejecución de cada job">
        <ul className="space-y-2">
          {WATCHED_JOBS.map((job, i) => {
            const last = lastRuns[i]?.data as { status: string; ran_at: string } | null | undefined;
            const maxAge = JOB_MAX_AGE_HOURS[job] ?? 0;
            const age = last ? ageHours(last.ran_at, nowMs) : null;
            const stale = age === null || age > maxAge;
            return (
              <li key={job} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <LevelIcon level={stale ? "error" : "ok"} />
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${jobColorClass(job)}`}
                >
                  {jobLabel(job)}
                </span>
                {last && age !== null ? (
                  <>
                    <span className={stale ? LEVEL_TEXT.error : "text-muted-foreground"}>
                      {formatAge(age)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatAdminDate(last.ran_at)}
                    </span>
                    <span
                      className={`ml-auto inline-block rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(last.status)}`}
                    >
                      {last.status}
                    </span>
                  </>
                ) : (
                  <span className={LEVEL_TEXT.error}>Sin ejecuciones registradas</span>
                )}
                {stale && age !== null && (
                  <span className="basis-full pl-7 text-xs text-muted-foreground">
                    Lleva más de {maxAge >= 48 ? `${maxAge / 24} días` : `${maxAge} h`} sin registrar
                    ejecución.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Últimos 7 días:</span>
          <Link
            href="/admin/logs?status=failure"
            className={`font-medium hover:underline ${failures > 0 ? LEVEL_TEXT.error : "text-muted-foreground"}`}
          >
            {failures} failure
          </Link>
          <Link
            href="/admin/logs?status=partial"
            className={`font-medium hover:underline ${partials > 0 ? LEVEL_TEXT.warning : "text-muted-foreground"}`}
          >
            {partials} partial
          </Link>
        </div>
      </Card>
    </section>
  );
}

/** Canciones que le quedan por sortear al selector diario. */
export async function ReserveCard() {
  const supabase = createServiceClient();
  let info: Awaited<ReturnType<typeof countSelectorReserve>> | null = null;
  try {
    info = await countSelectorReserve(supabase);
  } catch (err) {
    console.error("countSelectorReserve error:", err);
  }

  if (!info) {
    return (
      <Card title="Reserva del selector diario">
        <p className="text-sm text-red-600 dark:text-red-400">No se pudo calcular la reserva.</p>
      </Card>
    );
  }

  const { reserve, eligible } = info;
  const level: Level =
    reserve < RESERVE_CRITICAL ? "error" : reserve < RESERVE_WARNING ? "warning" : "ok";
  const months = (reserve / 30.4).toFixed(1).replace(".", ",");
  return (
    <Card title="Reserva del selector diario">
      <div className="flex items-center gap-2">
        <LevelIcon level={level} />
        <span className="text-2xl font-bold">{reserve.toLocaleString("es-ES")}</span>
        <span className="text-sm text-muted-foreground">
          canciones sin jugar · unos {months} meses
        </span>
      </div>
      {level !== "ok" && (
        <p className={`mt-2 text-sm ${LEVEL_TEXT[level]}`}>
          Quedan menos de {RESERVE_WARNING} canciones elegibles (unos seis meses). Hay que añadir
          playlists con canciones nuevas antes de que el selector se quede sin pool.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {eligible.toLocaleString("es-ES")} cumplen los criterios del selector (playlist activa,
        preview medido y sin versión ni audio repetido de lo ya jugado). Cuenta por arriba: no
        descuenta las versiones entre sí.
      </p>
    </Card>
  );
}

export function ReserveCardFallback() {
  return (
    <Card title="Reserva del selector diario">
      <p className="text-sm text-muted-foreground">Calculando…</p>
    </Card>
  );
}
