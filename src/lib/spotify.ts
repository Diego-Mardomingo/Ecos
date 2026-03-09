/**
 * Cliente Spotify API - Client Credentials Flow.
 * Usa Search API para ingesta (compatible con playlists editoriales restringidas).
 * Solo metadatos (sin audio). Requiere SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  popularity: number;
  artists: { id: string; name: string }[];
  album: {
    id: string;
    name: string;
    release_date: string;
    images: { url: string; height: number; width: number }[];
  };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return data.access_token;
}

async function apiGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${path}: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

interface SearchTracksResponse {
  tracks: {
    items: SpotifyTrack[];
    next: string | null;
    offset: number;
    limit: number;
  };
}

/**
 * Busca canciones por query. Search API (límite 10 por request en feb 2026).
 */
export async function searchTracks(
  query: string,
  options: { market?: string; limit?: number; offset?: number } = {}
): Promise<SpotifyTrack[]> {
  const market = options.market ?? "ES";
  const limit = Math.min(options.limit ?? 10, 10);
  const offset = options.offset ?? 0;

  const params = new URLSearchParams({
    q: query,
    type: "track",
    market,
    limit: String(limit),
    offset: String(offset),
  });

  const data = (await apiGet<SearchTracksResponse>(
    `/search?${params.toString()}`
  )) as SearchTracksResponse;

  return data.tracks?.items ?? [];
}

/**
 * Obtiene canciones de una fuente (query). Pagina y deduplica.
 */
export async function searchTracksFromSource(
  _sourceId: string,
  query: string,
  maxTracks: number,
  market = "ES"
): Promise<SpotifyTrack[]> {
  const seen = new Set<string>();
  const tracks: SpotifyTrack[] = [];
  let offset = 0;
  const limit = 10;

  while (tracks.length < maxTracks) {
    const batch = await searchTracks(query, { market, limit, offset });

    if (batch.length === 0) break;

    for (const t of batch) {
      if (t?.id && !seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
        if (tracks.length >= maxTracks) break;
      }
    }

    if (batch.length < limit) break;
    offset += limit;
  }

  return tracks;
}
