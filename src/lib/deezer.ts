const DEEZER_BASE = "https://api.deezer.com";

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
  const res = await fetch(url, { next: { revalidate: 60 } });

  if (!res.ok) return [];

  const data: DeezerSearchResult = await res.json();
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

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];

  const data: DeezerSearchResult = await res.json();

  return data.data.filter(
    (t) => t.preview && t.rank > 400000
  );
}

// Obtener track individual por ID
export async function getTrackById(id: number): Promise<DeezerTrack | null> {
  const res = await fetch(`${DEEZER_BASE}/track/${id}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) return null;
  return res.json();
}
