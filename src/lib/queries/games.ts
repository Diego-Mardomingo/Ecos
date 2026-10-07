import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getEffectiveGameDate } from "@/lib/date-utils";

/**
 * Lecturas de juegos y del estado de partida de cada usuario.
 *
 * Dos tipos de dato, con caché distinta:
 * - **Iguales para todos** (la canción de hoy, el calendario de días pasados, un juego por id): se
 *   leen con service role dentro de `unstable_cache`, por día de Madrid. No cambian con las
 *   partidas, así que ninguna jugada las invalida.
 * - **Del usuario** (puntuaciones, partidas a medias): sin caché de servidor, con el cliente de
 *   cookies que le pasa el llamante, y siempre filtradas por `user_id` y, si hace falta, por rango
 *   de fechas. Nunca con `.in()` de ids: con todo el histórico la URL pasaba de 11 KB y crecía
 *   cada día (auditoría oct. 2026, PERFDB-05).
 *
 * Censura de spoilers: título, artista y carátula de un día pasado solo salen si el usuario lo ha
 * jugado (puntuación guardada). A los invitados no se les manda nunca: su progreso vive en
 * localStorage. La tabla `ecos_songs` es legible por cualquiera, así que esto se decide aquí, en
 * el servidor (ver supabase/schema/03_security.sql).
 */

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

export interface GameWithSong {
  id: string;
  date: string;
  game_number: number;
  ecos_songs: {
    id: string;
    title: string;
    artist_name: string;
    album_title: string | null;
    cover_url: string;
    preview_url: string | null;
    /** ISO date YYYY-MM-DD desde Spotify */
    release_date: string | null;
  };
}

export interface PreviousDayGame {
  id: string;
  date: string;
  game_number: number;
  played: boolean;
  won: boolean;
  score: number | null;
  cover_url: string;
  title: string;
  artist_name: string;
}

export interface TodaysCompletedResult {
  title: string;
  artist_name: string;
  cover_url: string;
  score: number;
  won: boolean;
}

export interface InProgressGuess {
  text: string;
  correct: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  attemptNumber: number;
}

export interface InProgressProgress {
  gameId: string;
  gameDate: string;
  guesses: InProgressGuess[];
  phase: "playing";
}

/** Rango de fechas `[from, to)` (YYYY-MM-DD). Cualquiera de los dos extremos es opcional. */
export interface DateRange {
  from?: string;
  to?: string;
}

/** Puntuación de un usuario en un juego. */
export interface UserScore {
  points: number | null;
  correct: boolean | null;
}

type SongRelation = GameWithSong["ecos_songs"];
type SongRef = Pick<SongRelation, "cover_url" | "title" | "artist_name">;

/**
 * Día pasado tal y como se guarda en la caché del calendario (con la canción, **sin censurar**).
 * No se manda nunca al cliente tal cual: pasa antes por {@link toPreviousDays}.
 */
export interface PastGameRow {
  id: string;
  date: string;
  game_number: number;
  song: SongRef | null;
}

/** Fila de `ecos_guesses` con las columnas que se devuelven al cliente. */
export interface GuessRow {
  guess_text: string;
  correct: boolean | null;
  correct_artist: boolean | null;
  correct_album: boolean | null;
  attempt_number: number;
}

export const GUESS_COLUMNS = "guess_text, correct, correct_artist, correct_album, attempt_number";

const GAME_WITH_SONG_SELECT = `
  id, date, game_number,
  ecos_songs (
    id, title, artist_name, album_title,
    cover_url, preview_url, release_date
  )
`;

/** Las fechas de juego no cambian, pero una corrección a mano en la BD se ve en como mucho 1 h. */
const SHARED_CACHE_SECONDS = 3600;

// ---------------------------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------------------------

/** Fila de juego con la canción embebida, tal y como puede llegar de PostgREST. */
interface GameRowWithSong {
  id: string;
  date: string;
  game_number: number;
  ecos_songs: SongRelation | SongRelation[] | null;
}

/**
 * Normaliza la fila a {@link GameWithSong}. Devuelve `null` si el juego no tiene canción,
 * en vez de dejar pasar un objeto incompleto con un cast.
 */
function toGameWithSong(row: GameRowWithSong): GameWithSong | null {
  const song = unwrapToOne(row.ecos_songs);
  if (!song) return null;

  return {
    id: row.id,
    date: row.date,
    game_number: row.game_number,
    ecos_songs: song,
  };
}

/** Intento guardado → forma que usa el cliente. */
export function mapGuessRow(row: GuessRow): InProgressGuess {
  return {
    text: row.guess_text,
    correct: row.correct ?? false,
    correctArtist: row.correct_artist ?? false,
    correctAlbum: row.correct_album ?? false,
    attemptNumber: row.attempt_number,
  };
}

/** Partida a medias de un juego, o `null` si no hay ningún intento. */
export function toInProgress(
  gameId: string,
  gameDate: string,
  rows: GuessRow[]
): InProgressProgress | null {
  if (rows.length === 0) return null;
  return { gameId, gameDate, guesses: rows.map(mapGuessRow), phase: "playing" };
}

// ---------------------------------------------------------------------------------------------
// Datos iguales para todos (con caché de servidor)
// ---------------------------------------------------------------------------------------------

async function fetchGameByDate(
  client: SupabaseClient,
  date: string
): Promise<GameWithSong | null> {
  const { data, error } = await client
    .from("ecos_games")
    .select(GAME_WITH_SONG_SELECT)
    .eq("date", date)
    .maybeSingle();

  if (error) {
    console.error(`[ops] fallo al leer el juego del ${date}:`, error.code, error.message);
    throw error;
  }
  if (!data) {
    console.error(`[ops] sin juego para ${date}`);
    return null;
  }
  const game = toGameWithSong(data);
  if (!game) console.error(`[ops] el juego del ${date} no tiene canción`);
  return game;
}

/**
 * Juego del día de Madrid (o de `effectiveDate`), con la canción completa.
 *
 * Con service role: así la ruta de medianoche (`/api/home?effectiveDate=<mañana>`, solo en el
 * último minuto del día) puede leer el de mañana, que la RLS ya no enseña. Quien llame con una
 * fecha que no sea hoy es responsable de haberla validado.
 *
 * Caché por fecha, sin etiqueta: la canción del día no depende de ninguna partida. Si un día no
 * hay juego, el `null` cacheado no se da por bueno y se vuelve a preguntar (el juego puede
 * crearse a mano más tarde).
 */
export async function getTodaysGameCached(
  effectiveDate: string = getEffectiveGameDate()
): Promise<GameWithSong | null> {
  const cached = await unstable_cache(
    async () => fetchGameByDate(createServiceClient(), effectiveDate),
    ["todays-game", effectiveDate],
    { revalidate: SHARED_CACHE_SECONDS }
  )();
  if (cached) return cached;
  return fetchGameByDate(createServiceClient(), effectiveDate);
}

/**
 * Juego por id con la canción completa, con caché (un juego no cambia nunca). Con service role:
 * **no filtra fechas futuras**, eso lo comprueba quien llama (`isFutureGame`) antes de mandar
 * nada al cliente.
 */
export async function getGameByIdCached(gameId: string): Promise<GameWithSong | null> {
  return unstable_cache(
    async () => {
      const { data, error } = await createServiceClient()
        .from("ecos_games")
        .select(GAME_WITH_SONG_SELECT)
        .eq("id", gameId)
        .maybeSingle();
      if (error) {
        console.error(`[ops] fallo al leer el juego ${gameId}:`, error.code, error.message);
        throw error;
      }
      return data ? toGameWithSong(data) : null;
    },
    ["game-by-id", gameId],
    { revalidate: SHARED_CACHE_SECONDS }
  )();
}

/** ¿Es de un día que aún no ha llegado en Madrid? El selector crea los juegos con antelación. */
export function isFutureGame(game: { date: string }): boolean {
  return game.date > getEffectiveGameDate();
}

/**
 * Todos los juegos anteriores a `beforeDate`, del más reciente al más antiguo, con la canción
 * (sin censurar: la censura se aplica en {@link toPreviousDays}). Paginado: PostgREST corta en
 * 1.000 filas sin avisar.
 */
async function fetchPastGames(beforeDate: string): Promise<PastGameRow[]> {
  const svc = createServiceClient();
  type Row = {
    id: string;
    date: string;
    game_number: number;
    ecos_songs: SongRef | SongRef[] | null;
  };
  const rows = await fetchAllRows<Row>((from, to) =>
    svc
      .from("ecos_games")
      .select("id, date, game_number, ecos_songs ( cover_url, title, artist_name )")
      .lt("date", beforeDate)
      .order("date", { ascending: false })
      .range(from, to)
  );
  return rows.map((g) => ({
    id: g.id,
    date: g.date,
    game_number: g.game_number,
    song: unwrapToOne(g.ecos_songs),
  }));
}

/**
 * Calendario de días anteriores a `beforeDate`. Igual para todos: una lectura por día y servidor
 * en vez de una por usuario y carga de la home.
 */
export function getPastGamesCached(beforeDate: string): Promise<PastGameRow[]> {
  return unstable_cache(() => fetchPastGames(beforeDate), ["past-games", beforeDate], {
    revalidate: SHARED_CACHE_SECONDS,
  })();
}

/** Meses (`YYYY-MM`) con algún juego anterior a `beforeDate`, del más reciente al más antiguo. */
export async function getPastMonthKeys(beforeDate: string): Promise<string[]> {
  const past = await getPastGamesCached(beforeDate);
  const months = new Set<string>();
  for (const g of past) months.add(g.date.slice(0, 7));
  return [...months].sort((a, b) => b.localeCompare(a));
}

// ---------------------------------------------------------------------------------------------
// Datos del usuario (sin caché de servidor)
// ---------------------------------------------------------------------------------------------

/**
 * Puntuaciones del usuario por `game_id`, opcionalmente solo de los juegos de un rango de
 * fechas. Una fila por día jugado: crece despacio, pero va paginada igual.
 */
export async function fetchUserScores(
  supabase: SupabaseClient,
  userId: string,
  range?: DateRange
): Promise<Map<string, UserScore>> {
  // El embed `!inner` solo hace falta para filtrar por la fecha del juego.
  const columns =
    range?.from || range?.to
      ? "game_id, points, correct, ecos_games!inner(date)"
      : "game_id, points, correct";
  type Row = { game_id: string; points: number | null; correct: boolean | null };
  const rows = await fetchAllRows<Row>((from, to) => {
    let q = supabase.from("ecos_scores").select(columns).eq("user_id", userId);
    if (range?.from) q = q.gte("ecos_games.date", range.from);
    if (range?.to) q = q.lt("ecos_games.date", range.to);
    return q.order("game_id").range(from, to).overrideTypes<Row[], { merge: false }>();
  });
  return new Map(rows.map((s) => [s.game_id, { points: s.points, correct: s.correct }]));
}

/**
 * Partidas a medias del usuario (con intentos y sin puntuación) en juegos hasta `upTo`
 * (incluido) y dentro de `range`, en un solo viaje.
 *
 * Es un anti-join de PostgREST: juegos con algún intento del usuario (`ecos_guesses!inner`) y sin
 * puntuación suya (`ecos_scores=is.null`, con el filtro por usuario aplicado dentro del embed).
 * Devuelve solo las partidas abiertas, que son pocas, en vez de todos los intentos del usuario
 * (cientos) o una lista de ids en la URL.
 */
export async function fetchInProgressGames(
  supabase: SupabaseClient,
  userId: string,
  { upTo, from, to }: DateRange & { upTo: string }
): Promise<Record<string, InProgressProgress>> {
  let q = supabase
    .from("ecos_games")
    .select(`id, date, ecos_guesses!inner(${GUESS_COLUMNS}), ecos_scores(game_id)`)
    .eq("ecos_guesses.user_id", userId)
    .eq("ecos_scores.user_id", userId)
    .is("ecos_scores", null)
    .lte("date", upTo);
  if (from) q = q.gte("date", from);
  if (to) q = q.lt("date", to);

  const { data, error } = await q.order("attempt_number", {
    referencedTable: "ecos_guesses",
    ascending: true,
  });
  if (error) throw error;

  const byGameId: Record<string, InProgressProgress> = {};
  for (const game of (data ?? []) as Array<{
    id: string;
    date: string | null;
    ecos_guesses: GuessRow[];
  }>) {
    const progress = toInProgress(game.id, game.date ?? "", game.ecos_guesses ?? []);
    if (progress) byGameId[game.id] = progress;
  }
  return byGameId;
}

// ---------------------------------------------------------------------------------------------
// Composición
// ---------------------------------------------------------------------------------------------

/**
 * Días pasados para la home, censurados: con `scores === null` (invitado) ninguno sale jugado ni
 * con canción; con puntuaciones, solo los jugados llevan título, artista y carátula.
 */
export function toPreviousDays(
  past: PastGameRow[],
  scores: Map<string, UserScore> | null,
  range?: DateRange
): PreviousDayGame[] {
  const out: PreviousDayGame[] = [];
  for (const g of past) {
    if (range?.from && g.date < range.from) continue;
    if (range?.to && g.date >= range.to) continue;
    const score = scores?.get(g.id);
    const played = !!score;
    out.push({
      id: g.id,
      date: g.date,
      game_number: g.game_number,
      played,
      won: score ? score.correct === true : false,
      score: score?.points ?? null,
      cover_url: played ? (g.song?.cover_url ?? "") : "",
      title: played ? (g.song?.title ?? "") : "",
      artist_name: played ? (g.song?.artist_name ?? "") : "",
    });
  }
  return out;
}

/** Resultado de hoy si el usuario ya lo ha jugado; sale de datos ya leídos, sin consultas. */
export function getTodaysCompletedResult(
  todaysGame: GameWithSong | null,
  userScores: Map<string, UserScore>
): TodaysCompletedResult | null {
  if (!todaysGame) return null;
  const score = userScores.get(todaysGame.id);
  if (!score) return null;
  const song = todaysGame.ecos_songs;
  return {
    title: song.title ?? "",
    artist_name: song.artist_name ?? "",
    cover_url: song.cover_url ?? "",
    score: score.points ?? 0,
    won: score.correct === true,
  };
}
