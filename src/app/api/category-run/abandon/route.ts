import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { abandonRun } from "@/lib/categories/runs";
import type { CategoryRunMoveResponse } from "@/lib/categories/types";

const AbandonSchema = z.object({
  runId: z.string().uuid(),
});

/**
 * Abandona la partida: termina con `abandoned` y conserva puntos y racha. Idempotente (una partida
 * ya cerrada responde 200 con su estado).
 */
export const POST = handleRoute("api/category-run/abandon", async (request: NextRequest) => {
  const { user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = AbandonSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const run = await abandonRun(createServiceClient(), user.id, parsed.data.runId);
  if (!run) return jsonError(404, "Run not found");

  const response: CategoryRunMoveResponse = { run };
  return NextResponse.json(response, { headers: PRIVATE_NO_STORE });
});
