import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getEffectiveGameDate } from "@/lib/date-utils";

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
    youtube_id: string | null;
    preview_url: string | null;
    genre: string;
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

async function getTodaysGameWithClient(supabase: SupabaseClient) {
  const effectiveDate = getEffectiveGameDate();

  const { data, error } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs (
        id, title, artist_name, album_title,
        cover_url, youtube_id, preview_url, genre
      )
    `
    )
    .eq("date", effectiveDate)
    .single();

  if (error || !data) return null;
  return data as unknown as GameWithSong;
}

export async function getTodaysGame(): Promise<GameWithSong | null> {
  const supabase = await createClient();
  return getTodaysGameWithClient(supabase);
}

export async function getGameById(gameId: string): Promise<GameWithSong | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs (
        id, title, artist_name, album_title,
        cover_url, youtube_id, preview_url, genre
      )
    `
    )
    .eq("id", gameId)
    .single();

  if (error || !data) return null;
  return data as unknown as GameWithSong;
}

async function getPreviousDaysWithClient(
  supabase: SupabaseClient,
  userId: string | null,
  limit: number
): Promise<PreviousDayGame[]> {
  const effectiveDate = getEffectiveGameDate();

  const { data: games, error } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs ( cover_url, title, artist_name )
    `
    )
    .lt("date", effectiveDate)
    .order("date", { ascending: false })
    .limit(limit);

  if (error || !games) return [];

  type SongRef = { cover_url: string; title: string; artist_name: string };

  // Invitados: no enviar spoilers (title, cover, artist). El cliente usará gameProgressStore local.
  if (!userId) {
    return games.map((g) => ({
      id: g.id,
      date: g.date,
      game_number: g.game_number,
      played: false,
      won: false,
      score: null,
      cover_url: "",
      title: "",
      artist_name: "",
    }));
  }

  // Usuarios autenticados: solo enviar title/cover/artist para juegos ya jugados
  const gameIds = games.map((g) => g.id);
  const { data: scores } = await supabase
    .from("ecos_scores")
    .select("game_id, points, guesses_used, correct")
    .eq("user_id", userId)
    .in("game_id", gameIds);

  const scoreMap = new Map(scores?.map((s) => [s.game_id, s]) ?? []);

  return games.map((g) => {
    const score = scoreMap.get(g.id);
    const song = (g.ecos_songs as unknown) as SongRef | null;
    const played = !!score;
    return {
      id: g.id,
      date: g.date,
      game_number: g.game_number,
      played,
      won: score ? (score.correct === true) : false,
      score: score?.points ?? null,
      cover_url: played ? (song?.cover_url ?? "") : "",
      title: played ? (song?.title ?? "") : "",
      artist_name: played ? (song?.artist_name ?? "") : "",
    };
  });
}

export async function getPreviousDays(
  userId: string | null,
  limit = 10
): Promise<PreviousDayGame[]> {
  const supabase = await createClient();
  return getPreviousDaysWithClient(supabase, userId, limit);
}

export interface TodaysCompletedResult {
  title: string;
  artist_name: string;
  cover_url: string;
  score: number;
  won: boolean;
}

export async function getTodaysCompletedResult(
  userId: string,
  todaysGameId: string | null
): Promise<TodaysCompletedResult | null> {
  if (!todaysGameId) return null;
  const supabase = await createClient();
  const { data: scoreRow } = await supabase
    .from("ecos_scores")
    .select("points, correct")
    .eq("user_id", userId)
    .eq("game_id", todaysGameId)
    .single();
  if (!scoreRow) return null;
  const { data: game } = await supabase
    .from("ecos_games")
    .select("ecos_songs(cover_url, title, artist_name)")
    .eq("id", todaysGameId)
    .single();
  const song = game?.ecos_songs as { cover_url: string; title: string; artist_name: string } | null;
  if (!song) return null;
  return {
    title: song.title ?? "",
    artist_name: song.artist_name ?? "",
    cover_url: song.cover_url ?? "",
    score: scoreRow.points ?? 0,
    won: scoreRow.correct === true,
  };
}

export interface InProgressProgress {
  gameId: string;
  gameDate: string;
  guesses: Array<{ text: string; correct: boolean; correctArtist?: boolean; correctAlbum?: boolean; attemptNumber: number }>;
  phase: "playing";
}

/** Obtiene el progreso en curso para hoy y días anteriores (usuarios autenticados). */
export async function getInProgressGames(
  userId: string,
  todaysGameId: string | null,
  previousDayIds: string[]
): Promise<Record<string, InProgressProgress>> {
  const supabase = await createClient();
  const gameIds = [todaysGameId, ...previousDayIds].filter(Boolean) as string[];
  if (gameIds.length === 0) return {};

  const { data: scores } = await supabase
    .from("ecos_scores")
    .select("game_id")
    .eq("user_id", userId)
    .in("game_id", gameIds);
  const completedGameIds = new Set((scores ?? []).map((s) => s.game_id));
  const inProgressIds = gameIds.filter((id) => !completedGameIds.has(id));
  if (inProgressIds.length === 0) return {};

  const { data: guesses } = await supabase
    .from("ecos_guesses")
    .select("game_id, guess_text, correct, correct_artist, correct_album, attempt_number")
    .eq("user_id", userId)
    .in("game_id", inProgressIds)
    .order("attempt_number", { ascending: true });

  const { data: games } = await supabase
    .from("ecos_games")
    .select("id, date")
    .in("id", inProgressIds);

  const gameDateMap = new Map((games ?? []).map((g) => [g.id, g.date ?? ""]));

  const byGameId: Record<string, InProgressProgress> = {};
  const byGame = new Map<string, typeof guesses>();
  for (const g of guesses ?? []) {
    if (!byGame.has(g.game_id)) byGame.set(g.game_id, []);
    byGame.get(g.game_id)!.push(g);
  }
  for (const [gameId, list] of byGame) {
    if (list.length === 0) continue;
    byGameId[gameId] = {
      gameId,
      gameDate: gameDateMap.get(gameId) ?? "",
      guesses: list.map((g) => ({
        text: g.guess_text,
        correct: g.correct ?? false,
        correctArtist: g.correct_artist ?? false,
        correctAlbum: g.correct_album ?? false,
        attemptNumber: g.attempt_number,
      })),
      phase: "playing",
    };
  }
  return byGameId;
}

/** Versión cacheada usando createServiceClient (no cookies). */
export function getTodaysGameCached() {
  const effectiveDate = getEffectiveGameDate();
  return unstable_cache(
    async () => getTodaysGameWithClient(createServiceClient()),
    ["todays-game", effectiveDate],
    { revalidate: 300, tags: ["games"] }
  )();
}

/** Versión cacheada usando createServiceClient (no cookies). */
export function getPreviousDaysCached(userId: string | null, limit = 10) {
  const effectiveDate = getEffectiveGameDate();
  return unstable_cache(
    async () => getPreviousDaysWithClient(createServiceClient(), userId, limit),
    ["previous-days", effectiveDate, userId ?? "guest"],
    { revalidate: 300, tags: ["games"] }
  )();
}
