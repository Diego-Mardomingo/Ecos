import { NextResponse } from "next/server";

/**
 * Lectura de cuerpos JSON con tope de tamaño para los route handlers.
 *
 * `request.json()` lee el cuerpo entero sin límite: un POST de 20 MB a `/api/feedback` se
 * procesaba y acababa en 500 (auditoría oct. 2026, SEC-09 / B4-06). Aquí se corta antes:
 * primero por la cabecera `Content-Length` y, como esa cabecera la pone el cliente (y con
 * `Transfer-Encoding: chunked` ni siquiera viene), también contando los bytes mientras se leen.
 *
 * Esto no limita la frecuencia de peticiones: eso lo hace la regla de rate limit del firewall de
 * Vercel (en serverless un contador en memoria no sirve).
 */

/** Tope por defecto: de sobra para cualquier POST de la app, que manda unos cientos de bytes. */
export const DEFAULT_JSON_BODY_LIMIT = 8 * 1024;

export type JsonBodyResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

function tooLarge(maxBytes: number): JsonBodyResult {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Payload too large", maxBytes },
      { status: 413 }
    ),
  };
}

function invalidJson(): JsonBodyResult {
  return {
    ok: false,
    response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
  };
}

/**
 * Lee el cuerpo de `request` como JSON sin pasar de `maxBytes`.
 *
 * - `{ ok: true, data }` con el JSON ya parseado (sin validar: eso le toca al zod de cada ruta).
 * - `{ ok: false, response }` con un 413 si el cuerpo supera el tope o un 400 si está vacío o no
 *   es JSON. La ruta solo tiene que devolver `response`.
 *
 * Uso:
 * ```ts
 * const body = await readJsonBody(request);
 * if (!body.ok) return body.response;
 * const parsed = Schema.safeParse(body.data);
 * ```
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_JSON_BODY_LIMIT
): Promise<JsonBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared != null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) return tooLarge(maxBytes);
  }

  const raw = await readBodyBytes(request, maxBytes);
  if (raw === "too-large") return tooLarge(maxBytes);
  if (raw.byteLength === 0) return invalidJson();

  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return invalidJson();
  }
}

/** Lee el cuerpo por trozos y deja de leer en cuanto pasa de `maxBytes`. */
async function readBodyBytes(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | "too-large"> {
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
