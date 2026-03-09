/**
 * Cliente Spotify API - OAuth Refresh Token Flow.
 * Usa SPOTIFY_REFRESH_TOKEN (obtenido con pnpm run spotify-auth).
 * Solo metadatos (sin audio). Usado por scripts de ingesta.
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

export interface SpotifyAudioFeatures {
  id: string;
  tempo: number | null;
  danceability: number;
  energy: number;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN required. " +
        "Run 'pnpm run spotify-auth' to obtain the refresh token."
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
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

export interface PlaylistTrack {
  track: SpotifyTrack | null;
}

export interface PlaylistTracksResponse {
  items: { track: SpotifyTrack | null }[];
  next: string | null;
  total: number;
}

/**
 * Obtiene las canciones de una playlist.
 * Pagina automáticamente si hay más de 100.
 */
export async function getPlaylistTracks(
  playlistId: string
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,duration_ms,explicit,popularity,artists(id,name),album(id,name,release_date,images)))`;

  while (url) {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const token = await getAccessToken();
    const res = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify API error: ${res.status} ${text}`);
    }

    const data = (await res.json()) as PlaylistTracksResponse;
    for (const item of data.items) {
      if (item.track?.id) {
        tracks.push(item.track);
      }
    }
    url = data.next ?? "";
  }

  return tracks;
}

/**
 * Obtiene audio features por track (GET /audio-features/{id}).
 * El endpoint batch ?ids= da 403 en Development Mode (feb 2026).
 */
export async function getAudioFeatures(
  trackIds: string[]
): Promise<Map<string, SpotifyAudioFeatures>> {
  const map = new Map<string, SpotifyAudioFeatures>();
  const CONCURRENCY = 5;

  async function fetchOne(id: string): Promise<void> {
    try {
      const af = (await apiGet<SpotifyAudioFeatures | null>(
        `/audio-features/${id}`
      )) as SpotifyAudioFeatures | null;
      if (af?.id) map.set(af.id, af);
    } catch {
      // Ignorar errores individuales (track sin features)
    }
  }

  for (let i = 0; i < trackIds.length; i += CONCURRENCY) {
    const batch = trackIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(fetchOne));
    if (i + CONCURRENCY < trackIds.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return map;
}

/**
 * Obtiene el nombre de una playlist.
 */
export async function getPlaylistName(playlistId: string): Promise<string> {
  const data = (await apiGet<{ name: string }>(
    `/playlists/${playlistId}?fields=name`
  )) as { name: string };
  return data.name;
}
