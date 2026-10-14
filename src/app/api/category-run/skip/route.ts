import { NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError } from "@/lib/api/route";
import { applyMove, loadRun } from "@/lib/categories/runs";
import { moveResponse } from "@/lib/categories/route-helpers";

const SkipSchema = z.object({
  runId: z.string().uuid(),
  /** Canción de la partida a la que va la jugada (`run.roundNumber`): descarta reintentos viejos. */
  roundNumber: z.number().int().min(1),
  attemptNumber: z.number().int().min(1).max(6),
});

/**
 * Salto en una partida por categorías: consume el intento sin respuesta (al agotar el sexto, la
 * partida termina). Si `roundNumber` o `attemptNumber` no son los actuales, 409 con el estado de la partida.
 */
export const POST = handleRoute("api/category-run/skip", async (request: NextRequest) => {
  const { user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = SkipSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const svc = createServiceClient();
  const run = await loadRun(svc, user.id, parsed.data.runId);
  if (!run) return jsonError(404, "Run not found");

  const result = await applyMove(svc, run, {
    kind: "skip",
    roundNumber: parsed.data.roundNumber,
    attemptNumber: parsed.data.attemptNumber,
  });
  return moveResponse(result, false);
});
