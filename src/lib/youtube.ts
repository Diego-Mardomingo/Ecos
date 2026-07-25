/**
 * YouTube Data API v3 - búsqueda de vídeos para ingesta.
 * Verifica embeddable antes de devolver. Usado por scripts de ingesta.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_TIMEOUT_MS = 10000;

/**
 * Error de la API de YouTube (cuota agotada, key inválida, 5xx) — DISTINTO de "no encontrado".
 * Los callers deben abortar en vez de tratarlo como "sin vídeo válido".
 */
export class YouTubeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

/** ¿El fallo HTTP indica un problema de la API (no un "no hay resultados")? */
function isApiFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

const BLACKLIST_WORDS = [
  "live",
  "version",
  "acústico",
  "acoustic",
  "cover",
  "karaoke",
  "instrumental",
  "en vivo",
  "concierto",
];

const SEARCH_QUERIES = [
  (title: string, artist: string) => `${title} ${artist} official audio`,
  (title: string, artist: string) => `${title} ${artist} letra`,
  (title: string, artist: string) => `${title} ${artist} official video`,
  (title: string, artist: string) => `${title} ${artist}`,
];

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("YOUTUBE_API_KEY required");
  }
  return key;
}

function isBlacklisted(title: string): boolean {
  const lower = title.toLowerCase();
  return BLACKLIST_WORDS.some((w) => lower.includes(w));
}

interface SearchItem {
  id: { kind: string; videoId?: string };
  snippet?: { title: string };
}

interface VideosStatusItem {
  id: string;
  status?: { embeddable?: boolean };
}

/**
 * Busca un vídeo de YouTube para la canción y verifica que sea embeddable.
 * Orden de preferencia: official audio > letra > official video > genérico.
 * Filtra resultados con live, remix, cover, etc.
 * @returns videoId o null si no se encuentra uno válido
 */
export async function searchEmbeddableVideo(
  title: string,
  artist: string
): Promise<string | null> {
  const apiKey = getApiKey();

  for (const buildQuery of SEARCH_QUERIES) {
    const q = buildQuery(title, artist);
    const searchUrl = `${API_BASE}/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&q=${encodeURIComponent(q)}&key=${apiKey}`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
    });
    if (!searchRes.ok) {
      // Cuota/auth/5xx: abortar; no es "no hay resultados".
      if (isApiFailure(searchRes.status)) {
        throw new YouTubeApiError(searchRes.status, `YouTube search failed: ${searchRes.status}`);
      }
      continue;
    }

    const searchData = (await searchRes.json()) as {
      items?: SearchItem[];
    };

    const items = searchData.items ?? [];
    for (const item of items) {
      const videoId = item.id?.videoId;
      const snippetTitle = item.snippet?.title ?? "";

      if (!videoId || isBlacklisted(snippetTitle)) {
        continue;
      }

      // Verificar embeddable con videos.list
      const videoRes = await fetch(
        `${API_BASE}/videos?part=status&id=${videoId}&key=${apiKey}`,
        { signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
      );
      if (!videoRes.ok) {
        if (isApiFailure(videoRes.status)) {
          throw new YouTubeApiError(videoRes.status, `YouTube videos.list failed: ${videoRes.status}`);
        }
        continue;
      }

      const videoData = (await videoRes.json()) as {
        items?: VideosStatusItem[];
      };
      const video = videoData.items?.[0];
      if (video?.status?.embeddable === true) {
        return videoId;
      }
    }
  }

  return null;
}
