import type { AudioSource } from "@/lib/audio/audioSources";
// Solo servidor (usa `fetch` a la API de Deezer y una caché en memoria de la instancia).

/**
 * Resolvedor de la preview de Deezer. `GET api.deezer.com/track/{id}` devuelve en `preview` un MP3
 * firmado en `cdnt-preview.dzcdn.net` (`?hdnea=exp=<unix>~acl=...~hmac=...`) que caduca a los 900 s,
 * no va atado a IP y el CDN responde con CORS `*` y Range, así que el navegador lo baja directo.
 *
 * La URL firmada **no se guarda nunca** en BD ni en `unstable_cache` (serviría una caducada mientras
 * revalida). Solo hay una caché en memoria por instancia, que reutiliza la URL mientras le queden
 * más de 3 min de vida. Los errores de la API llegan como HTTP 200 con `{"error": {...}}`
 * (código 4 = cuota, 800 = sin datos).
 *
 * Los logs llevan el id de Deezer, nunca título ni artista.
 */

const API_URL = "https://api.deezer.com/track";
const TIMEOUT_MS = 3000;
/** Vida mínima que debe quedarle a una URL cacheada para reutilizarla. */
const MIN_REUSE_MS = 3 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export type DeezerResolveResult =
  | { ok: true; source: AudioSource & { source: "deezer"; expiresAt: number } }
  /** `api`: red, timeout, HTTP o cuota (reintentable). `no-preview`: la pista ya no existe o no tiene preview. */
  | { ok: false; reason: "api" | "no-preview" };

type CachedPreview = { url: string; expiresAt: number };

const cache = new Map<number, CachedPreview>();

/** Instante de caducidad (ms) de una URL firmada de Deezer, o `null` si no trae `exp=`. */
function parseExpiry(url: string): number | null {
  const match = /[?&~=]exp=(\d+)/.exec(url);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function remember(deezerId: number, entry: CachedPreview): void {
  cache.delete(deezerId);
  cache.set(deezerId, entry);
  // Map conserva el orden de inserción: se descarta la más antigua.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchTrack(deezerId: number): Promise<unknown> {
  const response = await fetch(`${API_URL}/${deezerId}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function toResult(entry: CachedPreview): DeezerResolveResult {
  return { ok: true, source: { source: "deezer", url: entry.url, expiresAt: entry.expiresAt } };
}

export async function resolveDeezerPreview(deezerId: number): Promise<DeezerResolveResult> {
  const cached = cache.get(deezerId);
  if (cached && cached.expiresAt - Date.now() > MIN_REUSE_MS) return toResult(cached);

  let body: unknown;
  try {
    body = await fetchTrack(deezerId);
  } catch (error) {
    console.error(`[ops] deezer: fallo al consultar la pista ${deezerId}:`, error);
    return { ok: false, reason: "api" };
  }

  const data = (body ?? {}) as { error?: { type?: string; code?: number }; preview?: unknown };
  if (data.error) {
    const code = data.error.code;
    // 800 = pista sin datos o borrada; el resto (cuota, 4, u otros) es un fallo de la API.
    if (code === 800) {
      console.error(`[ops] deezer: la pista ${deezerId} ya no existe (código 800)`);
      return { ok: false, reason: "no-preview" };
    }
    console.error(`[ops] deezer: error de la API en la pista ${deezerId}: ${data.error.type} (${code})`);
    return { ok: false, reason: "api" };
  }

  const url = typeof data.preview === "string" ? data.preview : "";
  if (!url) {
    console.error(`[ops] deezer: la pista ${deezerId} no tiene preview`);
    return { ok: false, reason: "no-preview" };
  }
  const expiresAt = parseExpiry(url);
  if (expiresAt === null) {
    console.error(`[ops] deezer: la preview de la pista ${deezerId} no trae caducidad`);
    return { ok: false, reason: "api" };
  }

  const entry = { url, expiresAt };
  remember(deezerId, entry);
  return toResult(entry);
}
