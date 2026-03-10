import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { format, addDays } from "date-fns";
import { logSystemJob } from "@/lib/system-logger";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const supabase = await createServiceClient();

  const { data: usedSongIds } = await supabase
    .from("ecos_games")
    .select("song_id");
  const usedSet = new Set(
    (usedSongIds ?? []).map((r) => r.song_id as string).filter(Boolean)
  );

  const { data: availableSongs, error: songsError } = await supabase
    .from("ecos_songs")
    .select("id, title, artist_name")
    .eq("is_active", true)
    .or("youtube_id.not.is.null,preview_url.not.is.null");

  if (songsError || !availableSongs?.length) {
    const summary = songsError
      ? `Error: ${songsError.message}`
      : "No hay canciones disponibles";
    await logSystemJob(supabase, {
      job_type: "cron_daily",
      status: "failure",
      summary,
      duration_ms: Date.now() - start,
      details: { error: songsError?.message },
    });
    return NextResponse.json(
      { error: summary },
      { status: songsError ? 500 : 404 }
    );
  }

  const pool = availableSongs.filter((s) => !usedSet.has(s.id));
  const songsAvailableAfter = pool.length;
  const warning =
    songsAvailableAfter < 14 ? "songs_available_below_14" : undefined;

  const { count } = await supabase
    .from("ecos_games")
    .select("*", { count: "exact", head: true });
  let nextGameNumber = (count ?? 0) + 1;

  const gamesCreated: { date: string; game_number: number }[] = [];

  for (let i = 0; i < 7; i++) {
    const date = format(addDays(new Date(), i + 1), "yyyy-MM-dd");
    const { data: existing } = await supabase
      .from("ecos_games")
      .select("id")
      .eq("date", date)
      .single();

    if (existing) continue;

    const available = availableSongs.filter((s) => !usedSet.has(s.id));
    if (!available.length) break;

    const song = available[Math.floor(Math.random() * available.length)];
    usedSet.add(song.id);

    const { data: inserted, error: insertError } = await supabase
      .from("ecos_games")
      .insert({
        song_id: song.id,
        date,
        game_number: nextGameNumber,
      })
      .select("id")
      .single();

    if (insertError) continue;

    gamesCreated.push({ date, game_number: nextGameNumber });
    nextGameNumber++;
  }

  const remaining = availableSongs.filter((s) => !usedSet.has(s.id)).length;
  const status = warning ? "partial" : "success";
  const summary =
    gamesCreated.length > 0
      ? `${gamesCreated.length} días programados`
      : "Sin días nuevos que programar";

  await logSystemJob(supabase, {
    job_type: "cron_daily",
    status,
    summary,
    duration_ms: Date.now() - start,
    details: {
      days_scheduled: gamesCreated.length,
      games_created: gamesCreated,
      songs_available_after: remaining,
      warning,
    },
  });

  return NextResponse.json({
    message: summary,
    gamesCreated,
    songsAvailableAfter: remaining,
  });
}
