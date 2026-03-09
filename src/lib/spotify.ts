/**
 * Cliente Spotify API - Client Credentials Flow.
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
 * Obtiene audio features de hasta 100 tracks (batch).
 */
export async function getAudioFeatures(
  trackIds: string[]
): Promise<Map<string, SpotifyAudioFeatures>> {
  const map = new Map<string, SpotifyAudioFeatures>();
  const chunkSize = 100;

  for (let i = 0; i < trackIds.length; i += chunkSize) {
    const chunk = trackIds.slice(i, i + chunkSize);
    const ids = chunk.join(",");
    const data = (await apiGet<{
      audio_features: (SpotifyAudioFeatures | null)[];
    }>(`/audio-features?ids=${ids}`)) as {
      audio_features: (SpotifyAudioFeatures | null)[];
    };

    for (let j = 0; j < chunk.length; j++) {
      const af = data.audio_features?.[j];
      if (af?.id) {
        map.set(af.id, af);
      }
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
