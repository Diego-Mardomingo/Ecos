import { revalidateTag, unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type {
  CategoryLeaderboardEntry,
  CategorySummary,
  UserCategorySummary,
} from "@/lib/categories/types";

/**
 * Lecturas del modo por categorías (racha infinita), para las rutas API y las páginas RSC.
 *
 * - **Igual para todos** (categorías con el tamaño de su pool, top del ranking): service role dentro
 *   de `unstable_cache`, con etiqueta.
 * - **Del usuario** (mejor marca, partida activa): sin caché. `ecos_category_runs` no tiene política
 *   RLS, así que se lee con service role y **la autorización es de quien llama**: siempre filtrado
 *   por el `userId` de una sesión ya verificada con `getUser()`.
 *
 * Las funciones SQL (`ecos_category_pool_sizes`, `get_category_leaderboard`) solo las ejecuta la
 * service role.
 */

export const CATEGORIES_CACHE_TAG = "categories";
const CATEGORIES_CACHE_SECONDS = 3600;
const LEADERBOARD_CACHE_SECONDS = 60;

export const CATEGORY_LEADERBOARD_LIMIT = 50;

export function categoryLeaderboardTag(categoryId: string): string {
  return `category-leaderboard:${categoryId}`;
}

/**
 * Avisa de que el top de una categoría ha cambiado (una partida con puntos acaba de terminar). Va
 * con `expire: 0` para que la siguiente lectura ya vea la partida y no una versión caducada.
 */
export function invalidateCategoryLeaderboard(categoryId: string): void {
  revalidateTag(categoryLeaderboardTag(categoryId), { expire: 0 });
}

// ---------------------------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------------------------

/** Categoría activa con su pool; `min_songs` es interno (lo aplica {@link getVisibleCategories}). */
interface ActiveCategory extends CategorySummary {
  min_songs: number;
}

async function fetchActiveCategories(): Promise<ActiveCategory[]> {
  const svc = createServiceClient();
  const [categoriesRes, sizesRes] = await Promise.all([
    svc
      .from("ecos_categories")
      .select("id, slug, name_es, name_en, icon, min_songs, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true }),
    svc.rpc("ecos_category_pool_sizes"),
  ]);
  if (categoriesRes.error) throw categoriesRes.error;
  // Distinguir fallo de «sin resultados»: sin tamaños no se decide nada, mejor un error.
  if (sizesRes.error) throw sizesRes.error;

  const sizes = new Map<string, number>(
    ((sizesRes.data ?? []) as { category_id: string; pool_size: number }[]).map((r) => [
      r.category_id,
      r.pool_size,
    ])
  );

  return (
    (categoriesRes.data ?? []) as Omit<ActiveCategory, "pool_size">[]
  ).map((c) => ({ ...c, pool_size: sizes.get(c.id) ?? 0 }));
}

function getActiveCategoriesCached(): Promise<ActiveCategory[]> {
  return unstable_cache(fetchActiveCategories, ["categories-active-v1"], {
    revalidate: CATEGORIES_CACHE_SECONDS,
    tags: [CATEGORIES_CACHE_TAG],
  })();
}

/** Categorías activas con pool suficiente (`pool_size >= min_songs`), por `sort_order`. */
export async function getVisibleCategories(): Promise<CategorySummary[]> {
  const all = await getActiveCategoriesCached();
  return all
    .filter((c) => c.pool_size >= c.min_songs)
    .map(({ id, slug, name_es, name_en, icon, pool_size, sort_order }) => ({
      id,
      slug,
      name_es,
      name_en,
      icon,
      pool_size,
      sort_order,
    }));
}

/** Categoría visible por slug, o `null` si no existe, está inactiva o tiene pool insuficiente. */
export async function getCategoryBySlug(slug: string): Promise<CategorySummary | null> {
  const visible = await getVisibleCategories();
  return visible.find((c) => c.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Resumen del usuario
// ---------------------------------------------------------------------------------------------

interface RunSummaryRow {
  id: string;
  category_id: string;
  status: string;
  points: number;
  streak: number;
}

/**
 * Mejor puntuación, mejor racha y partida activa del usuario en cada categoría (mapa por id de
 * categoría; solo las que ha jugado). Sin caché.
 */
export async function getUserCategorySummary(
  userId: string
): Promise<Record<string, UserCategorySummary>> {
  const svc = createServiceClient();
  const rows = await fetchAllRows<RunSummaryRow>((from, to) =>
    svc
      .from("ecos_category_runs")
      .select("id, category_id, status, points, streak")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const summary: Record<string, UserCategorySummary> = {};
  for (const r of rows) {
    const entry = (summary[r.category_id] ??= { bestPoints: 0, bestStreak: 0, activeRun: null });
    entry.bestPoints = Math.max(entry.bestPoints, r.points);
    entry.bestStreak = Math.max(entry.bestStreak, r.streak);
    if (r.status === "active") {
      entry.activeRun = { runId: r.id, streak: r.streak, points: r.points };
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------

type LeaderboardRow = {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  points: number;
  streak: number;
  ended_at: string;
};

async function fetchLeaderboard(
  categoryId: string,
  limit: number,
  userId: string | null
): Promise<CategoryLeaderboardEntry[]> {
  const { data, error } = await createServiceClient().rpc("get_category_leaderboard", {
    p_category_id: categoryId,
    p_limit: limit,
    p_user_id: userId,
  });
  if (error) throw error;
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({
    rank: Number(r.rank),
    user_id: r.user_id,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    points: Number(r.points),
    streak: Number(r.streak),
    ended_at: r.ended_at,
  }));
}

function getTopCached(categoryId: string, limit: number): Promise<CategoryLeaderboardEntry[]> {
  return unstable_cache(
    () => fetchLeaderboard(categoryId, limit, null),
    ["category-leaderboard-v1", categoryId, String(limit)],
    { revalidate: LEADERBOARD_CACHE_SECONDS, tags: [categoryLeaderboardTag(categoryId)] }
  )();
}

/**
 * Top de la categoría (cacheado, igual para todos) y, si se pasa `userId` y no está en el top, su
 * fila con la posición real (`me`, sin caché). `me` es `null` si ya está en el top o no tiene
 * ninguna partida terminada con puntos.
 */
export async function getCategoryLeaderboard(
  categoryId: string,
  userId: string | null = null,
  limit = CATEGORY_LEADERBOARD_LIMIT
): Promise<{ entries: CategoryLeaderboardEntry[]; me: CategoryLeaderboardEntry | null }> {
  const entries = await getTopCached(categoryId, limit);
  if (!userId || entries.some((e) => e.user_id === userId)) return { entries, me: null };

  // Con p_limit = 1 vienen el primero y la fila del usuario, no el top entero otra vez.
  const own = await fetchLeaderboard(categoryId, 1, userId);
  return { entries, me: own.find((e) => e.user_id === userId) ?? null };
}
