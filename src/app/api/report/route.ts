import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { logSystemJob } from "@/lib/system-logger";
import { z } from "zod";

const ReportSchema = z.object({
  gameId: z.string().uuid(),
  songId: z.string().uuid(),
  reason: z.enum([
    "bad_audio",
    // Vestigio del vídeo de YouTube, que ya no existe. Se sigue aceptando mientras la UI lo
    // ofrezca, pero se guarda como «other» (ver abajo). Cuando la opción desaparezca del diálogo
    // de reporte, quitar también esta línea.
    "wrong_video",
    "intro_problem",
    "explicit_content",
    "other",
  ]),
  description: z.string().max(500).optional(),
});

/** Ventana y número de usuarios distintos a partir del cual se avisa al admin. */
const REPORT_WINDOW_DAYS = 7;
const REPORT_ALERT_DISTINCT_USERS = 3;

/**
 * Reporte de una canción desde la pantalla de resultado.
 *
 * Antes, tres reportes con el mismo motivo desactivaban la canción, sin mirar quién los mandaba:
 * un solo usuario podía tumbar cualquier canción, incluida la del día (SEC-08 / SONGS-07). Además,
 * desactivar una canción que ya ha sido reto la saca del buscador y deja ese día sin solución.
 *
 * Ahora:
 * - la canción tiene que ser la del juego, y el juego no puede ser futuro;
 * - cada usuario cuenta una vez por canción y motivo;
 * - nunca se desactiva nada automáticamente: al llegar a `REPORT_ALERT_DISTINCT_USERS` usuarios
 *   distintos se deja una entrada en `ecos_system_logs` para que el admin lo revise en
 *   /admin/reports.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = ReportSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, songId, description } = parsed.data;
    const reason = parsed.data.reason === "wrong_video" ? "other" : parsed.data.reason;

    const serviceSupabase = createServiceClient();
    const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [gameRes, ownRes] = await Promise.all([
      serviceSupabase.from("ecos_games").select("song_id, date").eq("id", gameId).maybeSingle(),
      serviceSupabase
        .from("ecos_reports")
        .select("id")
        .eq("user_id", user.id)
        .eq("song_id", songId)
        .eq("reason", reason)
        .gte("created_at", since)
        .limit(1),
    ]);

    if (gameRes.error) throw gameRes.error;
    if (ownRes.error) throw ownRes.error;

    const game = gameRes.data as { song_id: string | null; date: string | null } | null;
    if (!game || game.song_id !== songId || !game.date || game.date > getEffectiveGameDate()) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Mismo usuario, canción y motivo en la ventana: ya está apuntado, no se duplica.
    if ((ownRes.data?.length ?? 0) > 0) {
      return NextResponse.json({ ok: true });
    }

    const { error: insertError } = await supabase.from("ecos_reports").insert({
      user_id: user.id,
      game_id: gameId,
      song_id: songId,
      reason,
      description: description ?? null,
    });

    if (insertError) {
      console.error("report insert error:", insertError);
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
    }

    const { data: sameReason, error: countError } = await serviceSupabase
      .from("ecos_reports")
      .select("user_id")
      .eq("song_id", songId)
      .eq("reason", reason)
      .gte("created_at", since);

    if (countError) {
      // El reporte ya está guardado; el aviso es secundario.
      console.error("report count error:", countError);
      return NextResponse.json({ ok: true });
    }

    const distinctUsers = new Set((sameReason ?? []).map((r) => r.user_id)).size;

    // Solo al cruzar el umbral, para no dejar una entrada por cada reporte posterior.
    if (distinctUsers === REPORT_ALERT_DISTINCT_USERS) {
      const { data: song } = await serviceSupabase
        .from("ecos_songs")
        .select("title, artist_name")
        .eq("id", songId)
        .maybeSingle();

      const label = song ? `«${song.title}» de ${song.artist_name}` : songId;

      // El CHECK de `job_type` no admite otro valor para reportes; el resumen deja claro que ya
      // no se desactiva nada.
      await logSystemJob(serviceSupabase, {
        job_type: "report_auto_deactivate",
        status: "partial",
        summary: `${distinctUsers} usuarios distintos han reportado ${label} (${reason}). No se ha desactivado: revisar en Reportes`,
        details: {
          song_id: songId,
          game_id: gameId,
          title: song?.title ?? "",
          reason,
          distinct_users: distinctUsers,
          window_days: REPORT_WINDOW_DAYS,
          deactivated: false,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("report error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
