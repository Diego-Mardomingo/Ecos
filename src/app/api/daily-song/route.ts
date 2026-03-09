import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { format } from "date-fns";

export async function GET() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const { data, error } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs (
        id, title, artist_name, album_title,
        cover_url, youtube_id, genre
      )
    `
    )
    .eq("date", today)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No game today" }, { status: 404 });
  }

  // No exponer el título/artista en la respuesta pública
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ecos_songs, ...gameData } = data;
  const song = (ecos_songs as unknown) as {
    id: string;
    title: string;
    artist_name: string;
    album_title: string;
    cover_url: string;
    youtube_id: string;
    genre: string;
  };

  return NextResponse.json({
    ...gameData,
    song: {
      id: song.id,
      cover_url: song.cover_url,
      youtube_id: song.youtube_id,
      // Título y artista se revelan solo al acertar o perder
    },
  });
}
