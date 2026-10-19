import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateScore } from "@/lib/scoring";
import { MAX_ATTEMPTS } from "@/lib/server-attempt";
import { evaluateGuess, type GuessMatchSong } from "@/lib/guess-match";
import { unwrapToOne } from "@/lib/supabase/relations";
import { invalidateCategoryLeaderboard } from "@/lib/queries/categories";
import { notifyCategoryRankingChanged } from "@/lib/realtime/broadcast-ranking";
import type {
  CategoryGuessEvaluation,
  CategoryRunEndReason,
  CategoryRunGuess,
  CategoryRunLastRound,
  CategoryRunRevealedSong,
  CategoryRunState,
} from "@/lib/categories/types";
// Solo servidor.

/**
 * Lógica de las partidas del modo por categorías (racha infinita).
 *
 * Todo va con el cliente de service role que le pasa la ruta, así que **la ruta es responsable de
 * haber comprobado la sesión** y de pasar el `userId` de esa sesión. Aquí cada lectura y escritura
 * de una partida va además filtrada por `user_id`: nunca se opera sobre la de otro usuario.
 *
 * Las jugadas son un update condicional sobre `(id, user_id, status = 'active', current_attempt)`:
 * si otra petición (otra pestaña, un reintento) ya movió la partida, no actualiza filas y se
 * responde `conflict` con el estado real para que el cliente reconcilie. El servidor decide el
 * intento: el del cliente solo se acepta si coincide con `current_attempt`.
 *
 * No toca `ecos_scores`, `ecos_leaderboard`, `ecos_games` ni el canal realtime `ecos:ranking`
 * (el del ranking diario). Sí emite en `ecos:category-ranking:<slug>` al terminar una partida con
 * puntos, para refrescar la clasificación de esa categoría.
 *
 * Logs: ids de partida y de usuario, nunca título ni artista.
 */

const RUN_SELECT =
  "id, user_id, category_id, status, end_reason, streak, points, current_song_id, current_attempt, round_guesses, played_song_ids, ecos_categories(slug)";

const SONG_SELECT = "id, title, artist_name, album_title, cover_url";

/**
 * La partida con su canción actual embebida, para las jugadas: así `applyMove` no necesita otra
 * consulta para evaluarla. `toRunState` no copia `current_song`, así que nunca sale al cliente.
 */
const RUN_WITH_SONG_SELECT = `${RUN_SELECT}, current_song:ecos_songs!ecos_category_runs_current_song_id_fkey(${SONG_SELECT})`;

export interface RunRow {
  id: string;
  user_id: string;
  category_id: string;
  status: "active" | "ended";
  end_reason: CategoryRunEndReason | null;
  streak: number;
  points: number;
  current_song_id: string | null;
  current_attempt: number;
  round_guesses: unknown;
  played_song_ids: string[];
  ecos_categories: { slug: string } | { slug: string }[] | null;
  /** Solo en {@link loadRun}: la canción actual (sin revelar). */
  current_song?: CategoryRunRevealedSong | CategoryRunRevealedSong[] | null;
}

type SongRow = CategoryRunRevealedSong;

// ---------------------------------------------------------------------------------------------
// Mapeo a la respuesta (sin fugas)
// ---------------------------------------------------------------------------------------------

/** `round_guesses` viene de un jsonb: se normaliza en vez de fiarse de su forma. */
function parseGuesses(raw: unknown): CategoryRunGuess[] {
  if (!Array.isArray(raw)) return [];
  const guesses: CategoryRunGuess[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const g = item as Partial<CategoryRunGuess>;
    if (typeof g.attempt !== "number") continue;
    guesses.push({
      attempt: g.attempt,
      text: typeof g.text === "string" ? g.text : "",
      skipped: g.skipped === true,
      ...(typeof g.correctArtist === "boolean" ? { correctArtist: g.correctArtist } : {}),
      ...(typeof g.correctAlbum === "boolean" ? { correctAlbum: g.correctAlbum } : {}),
    });
  }
  return guesses;
}

/** Fila → estado público. No copia `current_song_id` ni `played_song_ids`. */
export function toRunState(row: RunRow, lastRound?: CategoryRunLastRound): CategoryRunState {
  return {
    runId: row.id,
    categorySlug: unwrapToOne(row.ecos_categories)?.slug ?? "",
    status: row.status,
    endReason: row.end_reason,
    streak: row.streak,
    points: row.points,
    attempt: row.current_attempt,
    roundNumber: row.streak + 1,
    guesses: parseGuesses(row.round_guesses),
    ...(lastRound ? { lastRound } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------

/** Partida por id **del usuario**, con su canción actual; `null` si no existe o es de otro. */
export async function loadRun(
  svc: SupabaseClient,
  userId: string,
  runId: string
): Promise<RunRow | null> {
  const { data, error } = await svc
    .from("ecos_category_runs")
    .select(RUN_WITH_SONG_SELECT)
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as RunRow | null) ?? null;
}

async function loadActiveRun(
  svc: SupabaseClient,
  userId: string,
  categoryId: string
): Promise<RunRow | null> {
  const { data, error } = await svc
    .from("ecos_category_runs")
    .select(RUN_SELECT)
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as RunRow | null) ?? null;
}

async function loadSong(svc: SupabaseClient, songId: string): Promise<SongRow | null> {
  const { data, error } = await svc
    .from("ecos_songs")
    .select(SONG_SELECT)
    .eq("id", songId)
    .maybeSingle();
  if (error) throw error;
  return (data as SongRow | null) ?? null;
}

/** Siguiente canción del pool que no esté en `exclude`, o `null` si no queda ninguna. */
async function pickNextSong(
  svc: SupabaseClient,
  categoryId: string,
  exclude: string[]
): Promise<string | null> {
  const { data, error } = await svc.rpc("ecos_category_next_song", {
    p_category_id: categoryId,
    p_exclude: exclude,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Empezar o reanudar
// ---------------------------------------------------------------------------------------------

export type StartRunResult =
  | { kind: "ok"; run: CategoryRunState; resumed: boolean }
  /** El pool no tiene ninguna canción disponible. */
  | { kind: "empty" };

/**
 * Devuelve la partida activa del usuario en la categoría o crea una con una canción al azar. Si
 * dos peticiones crean a la vez, el índice único parcial rechaza la segunda y se relee la activa.
 */
export async function startOrResumeRun(
  svc: SupabaseClient,
  userId: string,
  categoryId: string
): Promise<StartRunResult> {
  // A la vez: buscar la activa y sortear la primera canción por si no la hay. Al reanudar, el
  // sorteo se descarta; a cambio, empezar una partida nueva se ahorra un viaje entero a la BD.
  const [existing, songId] = await Promise.all([
    loadActiveRun(svc, userId, categoryId),
    pickNextSong(svc, categoryId, []),
  ]);
  if (existing) return { kind: "ok", run: toRunState(existing), resumed: true };
  if (!songId) return { kind: "empty" };

  const { data, error } = await svc
    .from("ecos_category_runs")
    .insert({ user_id: userId, category_id: categoryId, current_song_id: songId })
    .select(RUN_SELECT)
    .single();

  if (error) {
    // 23505: ya hay una activa (carrera con otra petición).
    if (error.code === "23505") {
      const raced = await loadActiveRun(svc, userId, categoryId);
      if (raced) return { kind: "ok", run: toRunState(raced), resumed: true };
    }
    throw error;
  }
  return { kind: "ok", run: toRunState(data as RunRow), resumed: false };
}

// ---------------------------------------------------------------------------------------------
// Jugadas
// ---------------------------------------------------------------------------------------------

export type RunMove =
  | {
      kind: "guess";
      roundNumber: number;
      attemptNumber: number;
      guessText: string;
      guessSong: GuessMatchSong;
    }
  | { kind: "skip"; roundNumber: number; attemptNumber: number };

export type MoveResult =
  | { kind: "ok"; run: CategoryRunState; evaluation: CategoryGuessEvaluation }
  /** El cliente iba desfasado (o la partida ya está cerrada): `run` es el estado real. */
  | { kind: "conflict"; run: CategoryRunState };

const NO_MATCH: CategoryGuessEvaluation = {
  correct: false,
  correctArtist: false,
  correctAlbum: false,
};

/**
 * Update condicional de la partida activa en el intento que se esperaba. `null` si no actualiza
 * ninguna fila (otra petición se adelantó).
 */
async function updateRun(
  svc: SupabaseClient,
  run: RunRow,
  patch: Record<string, unknown>
): Promise<RunRow | null> {
  const { data, error } = await svc
    .from("ecos_category_runs")
    .update(patch)
    .eq("id", run.id)
    .eq("user_id", run.user_id)
    .eq("status", "active")
    .eq("current_attempt", run.current_attempt)
    .select(RUN_SELECT)
    .maybeSingle();
  if (error) throw error;
  return (data as RunRow | null) ?? null;
}

/**
 * 409 con el estado real. Si la canción a la que apuntaba la jugada ya está resuelta (un reintento
 * por red de una jugada ya aplicada, u otra pestaña), se adjunta su `lastRound` para que el cliente
 * no se quede sin la revelación: es la última de `played_song_ids` y mostrarla no filtra nada.
 */
async function conflictWithReveal(
  svc: SupabaseClient,
  fresh: RunRow,
  move: RunMove
): Promise<MoveResult> {
  // La canción de la jugada se resolvió con acierto (la partida ya va por la siguiente, o terminó
  // por pool agotado) o con el sexto fallo.
  const solved = move.roundNumber === fresh.streak && fresh.end_reason !== "failed";
  const failed =
    fresh.status === "ended" &&
    fresh.end_reason === "failed" &&
    move.roundNumber === fresh.streak + 1;
  const resolvedId = fresh.played_song_ids[fresh.played_song_ids.length - 1];
  if ((solved || failed) && resolvedId) {
    const song = await loadSong(svc, resolvedId);
    if (song) {
      const lastRound: CategoryRunLastRound = {
        outcome: failed ? "failed" : "correct",
        attempt: failed ? MAX_ATTEMPTS : move.attemptNumber,
        pointsGained: failed ? 0 : calculateScore(move.attemptNumber, 0).totalPoints,
        song,
      };
      return { kind: "conflict", run: toRunState(fresh, lastRound) };
    }
  }
  return { kind: "conflict", run: toRunState(fresh) };
}

/** Tras perder la carrera del update condicional: relee la partida (siempre existe, es del usuario). */
async function conflictResult(svc: SupabaseClient, run: RunRow, move: RunMove): Promise<MoveResult> {
  const fresh = (await loadRun(svc, run.user_id, run.id)) ?? run;
  return conflictWithReveal(svc, fresh, move);
}

/**
 * Una canción actual que ya no existe (borrada del catálogo) no se puede jugar: se sortea otra sin
 * puntuar nada y se pide al cliente que reconcilie.
 */
async function replaceMissingSong(
  svc: SupabaseClient,
  run: RunRow,
  move: RunMove
): Promise<MoveResult> {
  console.error(`[ops] category-run: la canción actual de la partida ${run.id} no existe`);
  const next = await pickNextSong(svc, run.category_id, run.played_song_ids);
  const patch = next
    ? { current_song_id: next, current_attempt: 1, round_guesses: [] }
    : {
        status: "ended",
        end_reason: "exhausted",
        ended_at: new Date().toISOString(),
        current_song_id: null,
      };
  const updated = await updateRun(svc, run, patch);
  if (!updated) return conflictResult(svc, run, move);
  notifyIfEnded(updated);
  return { kind: "conflict", run: toRunState(updated) };
}

/**
 * Cuando termina una partida con puntos, invalida la caché del ranking de la categoría y avisa por
 * Realtime a quien lo tenga abierto. Sin slug (no debería pasar) solo invalida.
 */
function notifyIfEnded(updated: RunRow): void {
  if (updated.status === "ended" && updated.points > 0) {
    invalidateCategoryLeaderboard(updated.category_id);
    const slug = unwrapToOne(updated.ecos_categories)?.slug;
    if (slug) notifyCategoryRankingChanged(slug);
  }
}

/**
 * Aplica un intento o un salto a la partida activa del usuario.
 *
 * - Acierto: suma `calculateScore(intento, 0)` (sin bonus de racha) y 1 a la racha, la canción
 *   pasa a `played_song_ids`, se vacían los intentos y se sortea la siguiente; si no queda
 *   ninguna, la partida termina con `exhausted`.
 * - Fallo o salto: consumen un intento; al agotar el sexto la partida termina con `failed` (y la
 *   canción también pasa a `played_song_ids`).
 */
export async function applyMove(
  svc: SupabaseClient,
  run: RunRow,
  move: RunMove
): Promise<MoveResult> {
  // La jugada tiene que ir a la canción actual (`roundNumber`) y al intento actual: si no, es de
  // otra pestaña o un reintento de una jugada ya aplicada (sin el número de canción, un reintento
  // del acierto al primer intento caería sobre el primer intento de la canción siguiente).
  if (
    run.status !== "active" ||
    move.roundNumber !== run.streak + 1 ||
    move.attemptNumber !== run.current_attempt
  ) {
    return conflictWithReveal(svc, run, move);
  }
  if (!run.current_song_id) return replaceMissingSong(svc, run, move);

  // Normalmente ya viene embebida (`loadRun`); si no, se lee aparte.
  const song =
    unwrapToOne(run.current_song ?? null) ?? (await loadSong(svc, run.current_song_id));
  if (!song) return replaceMissingSong(svc, run, move);

  const attempt = run.current_attempt;
  const evaluation = move.kind === "guess" ? evaluateGuess(move.guessSong, song) : NO_MATCH;

  const entry: CategoryRunGuess =
    move.kind === "guess"
      ? {
          attempt,
          text: move.guessText,
          skipped: false,
          correctArtist: evaluation.correctArtist,
          correctAlbum: evaluation.correctAlbum,
        }
      : { attempt, text: "", skipped: true };
  const guesses = [...parseGuesses(run.round_guesses), entry];

  // Intento fallido con intentos por delante: solo se anota.
  if (!evaluation.correct && attempt < MAX_ATTEMPTS) {
    const updated = await updateRun(svc, run, {
      round_guesses: guesses,
      current_attempt: attempt + 1,
    });
    if (!updated) return conflictResult(svc, run, move);
    return { kind: "ok", run: toRunState(updated), evaluation };
  }

  const played = [...run.played_song_ids, song.id];
  const endedAt = new Date().toISOString();

  // Sexto intento fallado: fin de la partida (se conservan los intentos para el resumen).
  if (!evaluation.correct) {
    const updated = await updateRun(svc, run, {
      status: "ended",
      end_reason: "failed",
      ended_at: endedAt,
      played_song_ids: played,
      round_guesses: guesses,
    });
    if (!updated) return conflictResult(svc, run, move);
    notifyIfEnded(updated);
    const lastRound: CategoryRunLastRound = {
      outcome: "failed",
      attempt,
      pointsGained: 0,
      song,
    };
    return { kind: "ok", run: toRunState(updated, lastRound), evaluation };
  }

  // Acierto.
  const pointsGained = calculateScore(attempt, 0).totalPoints;
  const nextSongId = await pickNextSong(svc, run.category_id, played);
  const base = {
    streak: run.streak + 1,
    points: run.points + pointsGained,
    played_song_ids: played,
    round_guesses: [],
    current_attempt: 1,
  };
  const updated = await updateRun(
    svc,
    run,
    nextSongId
      ? { ...base, current_song_id: nextSongId }
      : {
          ...base,
          current_song_id: null,
          status: "ended",
          end_reason: "exhausted",
          ended_at: endedAt,
        }
  );
  if (!updated) return conflictResult(svc, run, move);
  notifyIfEnded(updated);
  const lastRound: CategoryRunLastRound = { outcome: "correct", attempt, pointsGained, song };
  return { kind: "ok", run: toRunState(updated, lastRound), evaluation };
}

// ---------------------------------------------------------------------------------------------
// Abandonar
// ---------------------------------------------------------------------------------------------

/**
 * Cierra la partida con `abandoned`, conservando puntos y racha. Idempotente: una partida ya
 * cerrada devuelve su estado sin tocarla. `null` si no existe o es de otro usuario.
 */
export async function abandonRun(
  svc: SupabaseClient,
  userId: string,
  runId: string
): Promise<CategoryRunState | null> {
  const { data, error } = await svc
    .from("ecos_category_runs")
    .update({ status: "ended", end_reason: "abandoned", ended_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select(RUN_SELECT)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    const row = data as RunRow;
    notifyIfEnded(row);
    return toRunState(row);
  }
  const current = await loadRun(svc, userId, runId);
  return current ? toRunState(current) : null;
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

export interface RunSongAudio {
  previewUrl: string | null;
  deezerId: number | null;
  deezerPreviewSeconds: number | null;
}

/**
 * Datos de audio de la canción actual de una partida **activa del usuario**; `null` si no existe,
 * es de otro, está cerrada o no tiene canción. Nada de esto se devuelve al cliente tal cual.
 */
export async function loadActiveRunSongAudio(
  svc: SupabaseClient,
  userId: string,
  runId: string
): Promise<RunSongAudio | null> {
  const { data, error } = await svc
    .from("ecos_category_runs")
    .select("status, ecos_songs(preview_url, deezer_id, deezer_preview_seconds)")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") return null;

  const song = unwrapToOne<{
    preview_url: string | null;
    deezer_id: number | null;
    deezer_preview_seconds: number | null;
  }>(data.ecos_songs);
  if (!song) return null;
  return {
    previewUrl: song.preview_url,
    deezerId: song.deezer_id,
    deezerPreviewSeconds: song.deezer_preview_seconds,
  };
}
