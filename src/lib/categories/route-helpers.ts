import { NextResponse } from "next/server";
import { PRIVATE_NO_STORE } from "@/lib/api/route";
import type { MoveResult } from "@/lib/categories/runs";
import type {
  CategoryRunConflictResponse,
  CategoryRunGuessResponse,
  CategoryRunMoveResponse,
} from "@/lib/categories/types";
// Solo servidor.

/** Respuesta de una jugada: 200 con la partida (y la evaluación si fue un intento) o 409 con su estado real. */
export function moveResponse(result: MoveResult, withEvaluation: boolean): NextResponse {
  if (result.kind === "conflict") {
    const conflict: CategoryRunConflictResponse = { error: "Run out of sync", run: result.run };
    return NextResponse.json(conflict, { status: 409, headers: PRIVATE_NO_STORE });
  }
  const body: CategoryRunGuessResponse | CategoryRunMoveResponse = withEvaluation
    ? { run: result.run, evaluation: result.evaluation }
    : { run: result.run };
  return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
}
