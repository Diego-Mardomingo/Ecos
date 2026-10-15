/**
 * Contratos del modo por categorías (racha infinita). Sin imports de servidor, para que el cliente
 * los comparta con las rutas.
 *
 * REGLA DE FUGAS: de la canción ACTUAL sin resolver nunca sale nada (ni título, artista, portada,
 * preview, ids de Deezer/Spotify, ni su id en BD). Solo `lastRound.song` revela la canción que
 * acaba de resolverse. Para distinguir canciones (claves del reproductor) está `roundNumber`.
 */

export type CategoryRunStatus = "active" | "ended";
export type CategoryRunEndReason = "failed" | "abandoned" | "exhausted";

/** Intento de la canción actual (`ecos_category_runs.round_guesses`). */
export interface CategoryRunGuess {
  attempt: number;
  /** Lo escrito; vacío si se saltó. */
  text: string;
  skipped: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
}

/** Canción recién resuelta (acertada o fallada): la única que se revela. */
export interface CategoryRunRevealedSong {
  id: string;
  title: string;
  artist_name: string;
  album_title: string | null;
  cover_url: string;
}

export interface CategoryRunLastRound {
  outcome: "correct" | "failed";
  /** Intento en el que se acertó, o el último (6) si se falló. */
  attempt: number;
  pointsGained: number;
  song: CategoryRunRevealedSong;
}

export interface CategoryRunState {
  runId: string;
  categorySlug: string;
  status: CategoryRunStatus;
  endReason: CategoryRunEndReason | null;
  streak: number;
  points: number;
  /** Número del próximo intento (1..6) de la canción actual. */
  attempt: number;
  /** `streak + 1`: cambia con cada canción resuelta y sirve de clave del reproductor. */
  roundNumber: number;
  guesses: CategoryRunGuess[];
  /** Solo en la respuesta a la jugada que resolvió una canción. */
  lastRound?: CategoryRunLastRound;
}

/** Evaluación de una respuesta (misma forma que la de `/api/validate-guess`). */
export interface CategoryGuessEvaluation {
  correct: boolean;
  correctArtist: boolean;
  correctAlbum: boolean;
}

/** `POST /api/category-run/start`. */
export interface CategoryRunStartResponse {
  run: CategoryRunState;
  /** `true` si se ha reanudado una partida activa en vez de crear una. */
  resumed: boolean;
}

/** `POST /api/category-run/guess`. */
export interface CategoryRunGuessResponse {
  run: CategoryRunState;
  evaluation: CategoryGuessEvaluation;
}

/** `POST /api/category-run/skip` y `/abandon`. */
export interface CategoryRunMoveResponse {
  run: CategoryRunState;
}

/** 409: el cliente iba desfasado; `run` es el estado real para reconciliar. */
export interface CategoryRunConflictResponse {
  error: string;
  run: CategoryRunState;
}

/** Categoría visible (activa y con pool suficiente). */
export interface CategorySummary {
  id: string;
  slug: string;
  name_es: string;
  name_en: string;
  icon: string;
  pool_size: number;
  sort_order: number;
}

export interface UserCategorySummary {
  /** Mejor puntuación y mejor racha de las partidas **terminadas** (como la clasificación). */
  bestPoints: number;
  bestStreak: number;
  /** Partida activa del usuario en la categoría, si la hay. */
  activeRun: { runId: string; streak: number; points: number } | null;
}

/** `GET /api/categories`. `user` es `null` sin sesión; si hay, mapa por `categoryId`. */
export interface CategoriesResponse {
  categories: CategorySummary[];
  user: Record<string, UserCategorySummary> | null;
}

export interface CategoryLeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  points: number;
  streak: number;
  ended_at: string;
}

/** `GET /api/categories/[slug]/ranking`. */
export interface CategoryRankingResponse {
  category: Pick<CategorySummary, "slug" | "name_es" | "name_en">;
  entries: CategoryLeaderboardEntry[];
  /** Fila del usuario si no está en el top (con su posición real). */
  me: CategoryLeaderboardEntry | null;
  currentUserId: string | null;
}
