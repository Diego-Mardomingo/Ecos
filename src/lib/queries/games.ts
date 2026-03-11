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
