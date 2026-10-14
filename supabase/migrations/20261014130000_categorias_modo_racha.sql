-- Modo por categorías, racha infinita (plan Fase 2): tablas, categorías iniciales, funciones y privilegios.
--
-- ESTADO: APLICADA el 2026-10-14 (con min_songs = 60 por defecto). Requiere la migración
-- 20261014120000_metadatos_canciones (ecos_song_facets y las columnas de metadatos). Es aditiva
-- (tablas y funciones nuevas); no toca ecos_scores, ecos_leaderboard ni ecos_games, así que el
-- código actual sigue funcionando con ella.
--
-- Las tablas nacen con todo el DML concedido a anon y authenticated y las funciones con EXECUTE para
-- PUBLIC: se recortan al final (ver también 03_security.sql). Las escribe solo la service role.
--
-- Tras aplicarla: get_advisors (seguridad) y comprobar desde anon y authenticated que no pueden
-- escribir en las tablas nuevas ni ejecutar las funciones.

-- ---------------------------------------------------------------------------------------------
-- Modo por categorías (racha): categorías y partidas
-- ---------------------------------------------------------------------------------------------

-- Categoría = filtro sobre las facetas de ecos_song_facets (década, género, origen). Un campo null
-- no filtra por él. `min_songs`: tamaño mínimo del pool para mostrarla (lo aplica la API).
create table if not exists public.ecos_categories (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name_es text not null,
  name_en text not null,
  icon text not null,
  decades integer[],
  genres text[],
  origins text[],
  min_songs integer not null default 60,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

-- Una partida de racha infinita de un usuario en una categoría. Solo la escribe la service role.
-- `round_guesses`: intentos de la canción ACTUAL, array ordenado por intento:
--   [{"attempt": 1, "text": "lo escrito", "skipped": false}, ...]
-- (`text` vacío si se saltó). Se vacía ('[]') al pasar a la siguiente canción. `current_attempt` es
-- el número del próximo intento (1..6), de modo que round_guesses tiene current_attempt - 1 elementos.
-- `played_song_ids`: canciones ya resueltas (acertadas o falladas), para no repetirlas; la actual
-- no entra hasta resolverse.
-- `end_reason`: failed (agotó los 6 intentos), abandoned (cerrada a mano) o exhausted (pool agotado).
create table if not exists public.ecos_category_runs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  category_id uuid not null,
  status text not null default 'active',
  end_reason text,
  streak integer not null default 0,
  points integer not null default 0,
  current_song_id uuid,
  current_attempt smallint not null default 1,
  round_guesses jsonb not null default '[]'::jsonb,
  played_song_ids uuid[] not null default '{}'::uuid[],
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

alter table public.ecos_categories add constraint ecos_categories_pkey PRIMARY KEY (id);
alter table public.ecos_categories add constraint ecos_categories_slug_key UNIQUE (slug);

alter table public.ecos_category_runs add constraint ecos_category_runs_pkey PRIMARY KEY (id);
alter table public.ecos_category_runs add constraint ecos_category_runs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ecos_category_runs add constraint ecos_category_runs_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.ecos_categories(id) ON DELETE CASCADE;
alter table public.ecos_category_runs add constraint ecos_category_runs_current_song_id_fkey
  FOREIGN KEY (current_song_id) REFERENCES public.ecos_songs(id) ON DELETE SET NULL;
alter table public.ecos_category_runs add constraint ecos_category_runs_status_check
  CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])));
alter table public.ecos_category_runs add constraint ecos_category_runs_end_reason_check
  CHECK (((end_reason IS NULL) OR (end_reason = ANY (ARRAY['failed'::text, 'abandoned'::text, 'exhausted'::text]))));
alter table public.ecos_category_runs add constraint ecos_category_runs_attempt_check
  CHECK (((current_attempt >= 1) AND (current_attempt <= 6)));
alter table public.ecos_category_runs add constraint ecos_category_runs_state_check
  CHECK ((((status = 'active'::text) AND (end_reason IS NULL) AND (ended_at IS NULL))
       OR ((status = 'ended'::text) AND (end_reason IS NOT NULL) AND (ended_at IS NOT NULL))));
alter table public.ecos_category_runs add constraint ecos_category_runs_nonneg_check
  CHECK (((streak >= 0) AND (points >= 0)));

-- Una sola partida activa por usuario y categoría.
CREATE UNIQUE INDEX IF NOT EXISTS ecos_category_runs_one_active_key ON public.ecos_category_runs
  USING btree (user_id, category_id) WHERE status = 'active';
-- Clasificación por categoría (mejor partida terminada de cada usuario).
CREATE INDEX IF NOT EXISTS ecos_category_runs_ranking_idx ON public.ecos_category_runs
  USING btree (category_id, status, points DESC, streak DESC, ended_at);
-- Índices de FK con cascada (sin ellos, borrar un usuario o una canción recorre la tabla).
CREATE INDEX IF NOT EXISTS ecos_category_runs_user_id_idx ON public.ecos_category_runs USING btree (user_id);
CREATE INDEX IF NOT EXISTS ecos_category_runs_current_song_id_idx ON public.ecos_category_runs USING btree (current_song_id);

CREATE TRIGGER ecos_category_runs_updated_at
  BEFORE UPDATE ON public.ecos_category_runs
  FOR EACH ROW EXECUTE FUNCTION public.ecos_set_updated_at();

-- Categorías iniciales (los iconos son nombres de Material Symbols: hay que regenerar la fuente).
insert into public.ecos_categories (slug, name_es, name_en, icon, decades, genres, origins, sort_order) values
  ('los-60',   'Los 60',   'The 60s',   'album',         array[1960], null, null, 10),
  ('los-70',   'Los 70',   'The 70s',   'radio',         array[1970], null, null, 20),
  ('los-80',   'Los 80',   'The 80s',   'headphones',    array[1980], null, null, 30),
  ('los-90',   'Los 90',   'The 90s',   'library_music', array[1990], null, null, 40),
  ('los-2000', 'Los 2000', 'The 2000s', 'graphic_eq',    array[2000], null, null, 50),
  ('los-2010', 'Los 2010', 'The 2010s', 'queue_music',   array[2010], null, null, 60),
  ('los-2020', 'Los 2020', 'The 2020s', 'trending_up',   array[2020], null, null, 70),
  ('pop-espanol',     'Pop español',     'Spanish pop',   'favorite',  null, array['pop'], array['es'], 80),
  ('latino-y-urbano', 'Latino y urbano', 'Latin & urban', 'nightlife', null, array['latino','urbano'], null, 90)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Modo por categorías (racha). Todas son INVOKER, con search_path vacío, y solo las ejecuta la
-- service role desde la API (ver el revoke en 03_security.sql).
-- ---------------------------------------------------------------------------------------------

-- Día de juego efectivo: el día natural en Madrid. DEBE coincidir con getEffectiveGameDate() de
-- src/lib/date-utils.ts (hoy es la fecha de Madrid sin hora de corte); si una cambia, cambia la otra.
CREATE OR REPLACE FUNCTION public.ecos_effective_game_date()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$function$;

-- Canciones jugables de una categoría. Elegibilidad igual que is_eligible de scripts/selection.py
-- (canción activa, playlist activa y audio de >= 29 s en Deezer o en Spotify; 29 = MIN_PREVIEW_SECONDS),
-- facetas que cumplan la categoría y SIN las canciones de juegos diarios con fecha >= hoy (ni otras
-- ediciones de la misma canción, por dedupe_key), para no destripar el reto de hoy ni los futuros.
CREATE OR REPLACE FUNCTION public.ecos_category_pool(p_category_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH cat AS (
    SELECT c.decades, c.genres, c.origins
    FROM public.ecos_categories c
    WHERE c.id = p_category_id
  ),
  reserved AS (
    SELECT rs.id, rs.dedupe_key
    FROM public.ecos_games g
    JOIN public.ecos_songs rs ON rs.id = g.song_id
    WHERE g.date >= public.ecos_effective_game_date()
  )
  SELECT s.id
  FROM cat c
  CROSS JOIN public.ecos_songs s
  JOIN public.ecos_spotify_playlists pl
    ON pl.spotify_playlist_id = s.spotify_playlist_id AND pl.is_active
  CROSS JOIN LATERAL public.ecos_song_facets(
    s.spotify_playlist_name, s.release_date, s.deezer_release_date, s.deezer_genre_ids,
    s.mb_language, s.mb_artist_country, s.origin_override
  ) f
  WHERE s.is_active
    AND (
      (s.deezer_id IS NOT NULL AND s.deezer_preview_seconds >= 29)
      OR (s.preview_url IS NOT NULL AND s.preview_duration_seconds >= 29)
    )
    AND (c.decades IS NULL OR f.decade = ANY (c.decades))
    AND (c.genres IS NULL OR f.genre = ANY (c.genres))
    AND (c.origins IS NULL OR f.origin = ANY (c.origins))
    AND NOT EXISTS (
      SELECT 1 FROM reserved r WHERE r.id = s.id OR r.dedupe_key = s.dedupe_key
    );
$function$;

-- Tamaño del pool de cada categoría activa (la API filtra por min_songs).
CREATE OR REPLACE FUNCTION public.ecos_category_pool_sizes()
 RETURNS TABLE(category_id uuid, pool_size integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT c.id, (SELECT count(*) FROM public.ecos_category_pool(c.id))::integer
  FROM public.ecos_categories c
  WHERE c.is_active;
$function$;

-- Una canción aleatoria del pool que no esté en p_exclude, o null si no queda ninguna. VOLATILE
-- (random()).
CREATE OR REPLACE FUNCTION public.ecos_category_next_song(p_category_id uuid, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE sql
 VOLATILE
 SET search_path TO ''
AS $function$
  SELECT p.song_id
  FROM public.ecos_category_pool(p_category_id) AS p(song_id)
  WHERE p_exclude IS NULL OR NOT (p.song_id = ANY (p_exclude))
  ORDER BY random()
  LIMIT 1;
$function$;

-- Clasificación de una categoría: la mejor partida TERMINADA de cada usuario (con puntos > 0),
-- ordenada por puntos, luego racha y luego quién terminó antes (ended_at ascendente; user_id como
-- último desempate para que el orden sea estable). Misma forma que get_leaderboard_by_period:
-- nombre público ya resuelto (username, luego display_name salvo «admin», luego «Jugador») y avatar
-- solo si show_avatar_in_rankings. No lee auth.users (la service role no tiene acceso).
-- Si llega p_user_id y ese usuario está fuera de los p_limit primeros, su fila se AÑADE al final con
-- su posición real (`rank`), en el mismo resultado.
CREATE OR REPLACE FUNCTION public.get_category_leaderboard(p_category_id uuid, p_limit integer DEFAULT 50, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, streak integer, ended_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH best AS (
    SELECT DISTINCT ON (r.user_id) r.user_id, r.points, r.streak, r.ended_at
    FROM public.ecos_category_runs r
    WHERE r.category_id = p_category_id AND r.status = 'ended' AND r.points > 0
    ORDER BY r.user_id, r.points DESC, r.streak DESC, r.ended_at ASC
  ),
  ranked AS (
    SELECT b.*,
      (ROW_NUMBER() OVER (ORDER BY b.points DESC, b.streak DESC, b.ended_at ASC, b.user_id))::integer AS rn
    FROM best b
  )
  SELECT
    r.rn AS rank,
    r.user_id,
    (
      CASE
        WHEN p.username IS NOT NULL AND btrim(p.username) <> '' THEN btrim(p.username)
        WHEN p.display_name IS NOT NULL AND btrim(p.display_name) <> '' AND lower(btrim(p.display_name)) <> 'admin'
          THEN btrim(p.display_name)
        ELSE 'Jugador'
      END
    )::text AS display_name,
    (CASE WHEN COALESCE(p.show_avatar_in_rankings, true) THEN p.avatar_url ELSE NULL END)::text AS avatar_url,
    r.points,
    r.streak,
    r.ended_at
  FROM ranked r
  LEFT JOIN public.ecos_profiles p ON p.user_id = r.user_id
  WHERE r.rn <= LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
     OR (p_user_id IS NOT NULL AND r.user_id = p_user_id)
  ORDER BY r.rn;
$function$;

-- Modo por categorías (migración 20261014130000_categorias_modo_racha). Las dos tablas se
-- escriben solo con la service role.
alter table public.ecos_categories    enable row level security;
alter table public.ecos_category_runs enable row level security;

-- Categorías: lectura pública de las activas. Runs: sin política, solo service role (la API lee y
-- escribe con ella y atribuye siempre a user_id).
create policy ecos_categories_read on public.ecos_categories
  for select to anon, authenticated using (is_active);

revoke insert, update, delete, truncate, references, trigger on public.ecos_categories from anon, authenticated;
revoke all on public.ecos_category_runs from anon, authenticated;

-- Funciones: nacen con EXECUTE para PUBLIC. Solo la service role (la API); ninguna es SECURITY DEFINER.
revoke execute on function public.ecos_effective_game_date() from public, anon, authenticated;
revoke execute on function public.ecos_category_pool(uuid) from public, anon, authenticated;
revoke execute on function public.ecos_category_pool_sizes() from public, anon, authenticated;
revoke execute on function public.ecos_category_next_song(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.get_category_leaderboard(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.ecos_effective_game_date() to service_role;
grant execute on function public.ecos_category_pool(uuid) to service_role;
grant execute on function public.ecos_category_pool_sizes() to service_role;
grant execute on function public.ecos_category_next_song(uuid, uuid[]) to service_role;
grant execute on function public.get_category_leaderboard(uuid, integer, uuid) to service_role;
