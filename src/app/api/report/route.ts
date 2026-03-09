import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logSystemJob } from "@/lib/system-logger";
import { z } from "zod";

const ReportSchema = z.object({
  gameId: z.string().uuid(),
  songId: z.string().uuid(),
  reason: z.enum([
    "bad_audio",
    "wrong_video",
    "intro_problem",
    "explicit_content",
    "other",
  ]),
  description: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, songId, reason, description } = parsed.data;

    const { error: insertError } = await supabase.from("ecos_reports").insert({
      user_id: user.id,
      game_id: gameId,
      song_id: songId,
      reason,
      description: description ?? null,
    });

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to save report" },
        { status: 500 }
      );
    }

    const serviceSupabase = await createServiceClient();
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceStr = since.toISOString();

    const { data: sameReason } = await serviceSupabase
      .from("ecos_reports")
      .select("id")
      .eq("song_id", songId)
      .eq("reason", reason)
      .gte("created_at", sinceStr);

    const count = sameReason?.length ?? 0;

    if (count >= 3) {
      const { data: song } = await serviceSupabase
        .from("ecos_songs")
        .select("title, artist_name")
        .eq("id", songId)
        .single();

      await serviceSupabase
        .from("ecos_songs")
        .update({ is_active: false })
        .eq("id", songId);

      await logSystemJob(serviceSupabase, {
        job_type: "report_auto_deactivate",
        status: "success",
        summary: `Canción desactivada por ${count} reportes (${reason})`,
        details: {
          song_id: songId,
          title: (song as { title?: string })?.title ?? "",
          reason,
          report_count: count,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("report error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
