const DEEZER_BASE = "https://api.deezer.com";
const DEEZER_TIMEOUT_MS = 8000;

export interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  rank: number;
  bpm: number;
  explicit_lyrics: boolean;
  isrc: string;
  artist: {
    id: number;
    name: string;
    picture_medium: string;
    picture_xl: string;
  };
  album: {
    id: number;
    title: string;
    cover_medium: string;
    cover_xl: string;
    release_date: string;
  };
}

export interface DeezerSearchResult {
  data: DeezerTrack[];
  total: number;
  next?: string;
}

// Buscar canciones para el autocompletado en el juego
export async function searchTracks(
  query: string,
  limit = 10
): Promise<DeezerTrack[]> {
  if (!query || query.trim().length < 2) return [];

  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}&output=json`;
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
    });
  } catch {
    return [];
  }

  if (!res.ok) return [];

  const data = (await res.json()) as Partial<DeezerSearchResult>;
  // Deezer puede devolver { error } con HTTP 200 (p. ej. rate-limit).
  if (!Array.isArray(data?.data)) return [];
  return data.data.filter((t) => t.preview);
}

// Obtener canciones latinas populares para el cron de ingesta
export async function fetchLatinPopularTracks(
  genre = "Pop Latino",
  limit = 50
): Promise<DeezerTrack[]> {
  const queries = [
    "genre:\"Pop Latino\"",
    "genre:\"Reggaeton\"",
    "genre:\"Latin\"",
    "genre:\"Flamenco\"",
  ];

  const query = queries[Math.floor(Math.random() * queries.length)];
  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}&output=json`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as Partial<DeezerSearchResult>;
  if (!Array.isArray(data?.data)) return [];

  return data.data.filter(
    (t) => t.preview && t.rank > 400000
  );
}

// Obtener track individual por ID
export async function getTrackById(id: number): Promise<DeezerTrack | null> {
  let res: Response;
  try {
    res = await fetch(`${DEEZER_BASE}/track/${id}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;
  return res.json();
}
