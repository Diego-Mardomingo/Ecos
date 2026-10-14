import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { startOrResumeRun } from "@/lib/categories/runs";
import { getCategoryBySlug } from "@/lib/queries/categories";
import type { CategoryRunStartResponse } from "@/lib/categories/types";

const StartSchema = z.object({
  slug: z.string().min(1).max(64),
});

/**
 * Empieza (o reanuda) la partida de racha del usuario en una categoría. Solo autenticados. Usa
 * service role: la partida se atribuye siempre al `user.id` de la sesión.
 *
 * La categoría tiene que estar activa y con el pool al mínimo (`getCategoryBySlug`); si no, 404.
 */
export const POST = handleRoute("api/category-run/start", async (request: NextRequest) => {
  const { user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = StartSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const category = await getCategoryBySlug(parsed.data.slug);
  if (!category) return jsonError(404, "Category not found");

  const result = await startOrResumeRun(createServiceClient(), user.id, category.id);
  if (result.kind === "empty") return jsonError(409, "No songs available");

  const response: CategoryRunStartResponse = { run: result.run, resumed: result.resumed };
  return NextResponse.json(response, { headers: PRIVATE_NO_STORE });
});
