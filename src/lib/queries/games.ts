import { createClient } from "@/lib/supabase/server";
import { getEffectiveGameDate } from "@/lib/date-utils";

export interface GameWithSong {
  id: string;
  date: string;
  game_number: number;
  ecos_songs: {
    id: string;
    title: string;
    artist_name: string;
    album_title: string;
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

export async function getTodaysGame(): Promise<GameWithSong | null> {
  const supabase = await createClient();
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

export async function getPreviousDays(
  userId: string | null,
  limit = 10
): Promise<PreviousDayGame[]> {
  const supabase = await createClient();
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

  if (!userId) {
    return games.map((g) => {
      const song = (g.ecos_songs as unknown) as SongRef | null;
      return {
        id: g.id,
        date: g.date,
        game_number: g.game_number,
        played: false,
        won: false,
        score: null,
        cover_url: song?.cover_url ?? "",
        title: song?.title ?? "",
        artist_name: song?.artist_name ?? "",
      };
    });
  }

  // Obtener resultados del usuario para estos juegos
  const gameIds = games.map((g) => g.id);
  const { data: scores } = await supabase
    .from("ecos_scores")
    .select("game_id, points, guesses_used")
    .eq("user_id", userId)
    .in("game_id", gameIds);

  const scoreMap = new Map(scores?.map((s) => [s.game_id, s]) ?? []);

  return games.map((g) => {
    const score = scoreMap.get(g.id);
    const song = (g.ecos_songs as unknown) as SongRef | null;
    return {
      id: g.id,
      date: g.date,
      game_number: g.game_number,
      played: !!score,
      won: score ? score.guesses_used <= 6 && score.points > 0 : false,
      score: score?.points ?? null,
      cover_url: song?.cover_url ?? "",
      title: song?.title ?? "",
      artist_name: song?.artist_name ?? "",
    };
  });
}
