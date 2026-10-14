import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getRequestUser, handleRoute, isUuid, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { loadActiveRunSongAudio } from "@/lib/categories/runs";
import { preferredAudioSource, resolveAudioSources } from "@/lib/audio/resolveSources";
import type { AudioUrlResponse } from "@/lib/audio/audioSources";

/**
 * Fuentes de audio de la canción ACTUAL de una partida activa del propio usuario (mismo contrato
 * que `/api/audio-url`). Las URL firmadas de Deezer se piden al vuelo y no se guardan.
 *
 * La URL es la misma en cada canción de la partida (`?runId=`), así que la respuesta va con
 * `no-store`: una caché del navegador serviría el audio de la canción anterior.
 *
 * La fuente primaria sale de la propia canción (`preferredAudioSource`), no de `ecos_games`.
 */
export const GET = handleRoute("[ops] api/category-run/audio", async (request: NextRequest) => {
  const { user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) return jsonError(400, "Missing runId");
  if (!isUuid(runId)) return jsonError(404, "Run not found");

  const audio = await loadActiveRunSongAudio(createServiceClient(), user.id, runId);
  if (!audio) return jsonError(404, "Run not found");

  const sources = await resolveAudioSources(
    {
      audioSource: preferredAudioSource({
        deezer_id: audio.deezerId,
        deezer_preview_seconds: audio.deezerPreviewSeconds,
      }),
      previewUrl: audio.previewUrl,
      deezerId: audio.deezerId,
    },
    `la partida ${runId}`
  );
  if (sources.length === 0) {
    console.error(`[ops] category-run/audio: la partida ${runId} no tiene audio`);
    return jsonError(404, "No preview available");
  }

  const body: AudioUrlResponse = { sources };
  return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
});
