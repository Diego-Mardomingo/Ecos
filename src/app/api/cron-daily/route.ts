import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchLatinPopularTracks } from "@/lib/deezer";
import { format, addDays } from "date-fns";

export async function POST(request: NextRequest) {
  // Verificar cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  // Comprobar si ya hay canción para mañana
  const { data: existing } = await supabase
    .from("ecos_games")
    .select("id")
    .eq("date", tomorrow)
    .single();

  if (existing) {
    return NextResponse.json({ message: "Already scheduled", date: tomorrow });
  }

  // Obtener canciones populares de Deezer
  const tracks = await fetchLatinPopularTracks();

  if (!tracks.length) {
    return NextResponse.json({ error: "No tracks from Deezer" }, { status: 500 });
  }

  // Filtrar canciones ya usadas
  const { data: usedSongs } = await supabase
    .from("ecos_songs")
    .select("deezer_id");

  const usedIds = new Set(usedSongs?.map((s) => s.deezer_id) ?? []);
  const newTracks = tracks.filter((t) => !usedIds.has(t.id));

  if (!newTracks.length) {
    return NextResponse.json({ error: "No new tracks available" }, { status: 500 });
  }

  // Seleccionar aleatoriamente
  const track = newTracks[Math.floor(Math.random() * newTracks.length)];

  // Insertar canción
  const { data: song, error: songError } = await supabase
    .from("ecos_songs")
    .insert({
      deezer_id: track.id,
      title: track.title,
      artist_name: track.artist.name,
      album_title: track.album.title,
      cover_url: track.album.cover_xl,
      preview_url: track.preview,
      bpm: track.bpm,
      rank: track.rank,
      release_date: track.album.release_date,
      explicit: track.explicit_lyrics,
    })
    .select("id")
    .single();

  if (songError || !song) {
    return NextResponse.json({ error: "Failed to insert song" }, { status: 500 });
  }

  // Obtener número de juego siguiente
  const { count } = await supabase
    .from("ecos_games")
    .select("*", { count: "exact", head: true });

  const gameNumber = (count ?? 0) + 1;

  // Crear el juego del día
  const { error: gameError } = await supabase.from("ecos_games").insert({
    song_id: song.id,
    date: tomorrow,
    game_number: gameNumber,
  });

  if (gameError) {
    return NextResponse.json({ error: "Failed to create game" }, { status: 500 });
  }

  return NextResponse.json({
    message: "Game scheduled",
    date: tomorrow,
    song: track.title,
    artist: track.artist.name,
    gameNumber,
  });
}
