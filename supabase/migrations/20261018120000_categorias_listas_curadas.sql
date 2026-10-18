-- Categorías con lista curada (Pop en inglés y Rock en inglés) y canciones solo para categorías.
--
-- ESTADO: APLICADA el 2026-10-18, antes de desplegar. Es aditiva y compatible con el código ya
-- desplegado: la columna nueva nace a true para todo el catálogo, las categorías nuevas nacen
-- inactivas y ecos_search_songs conserva su comportamiento con los dos argumentos de siempre.
--
-- PENDIENTE TRAS DESPLEGAR: las listas ya están cargadas (scripts/import-category-songs.py, 150 + 150),
-- pero las categorías siguen inactivas porque el código desplegado no busca estas canciones
-- (scope=categories) ni admite las carátulas de Deezer en la CSP. Tras desplegar:
--   update public.ecos_categories set is_active = true where slug in ('pop-ingles', 'rock-ingles');
--
-- - ecos_songs.daily_eligible: false = la canción solo existe para las categorías con lista curada.
--   No entra en el reto diario (selection.py, reserve.ts), ni en las categorías por facetas, ni en
--   el buscador del diario.
-- - ecos_categories.curated: la categoría no filtra por facetas, sino por su lista de
--   ecos_category_songs.
-- - ecos_category_songs: canciones de cada categoría curada. Solo service role.
-- - ecos_category_pool: rama curada y exclusión de las canciones solo de categorías en la otra.
-- - ecos_search_songs: tercer argumento para incluir las canciones solo de categorías (lo pide el
--   modo por categorías; el diario no).
-- - ecos_system_logs: job_type `category_import` (scripts/import-category-songs.py; también en
--   src/lib/system-logger.ts y scripts/common.py).
--
-- Tras aplicarla: get_advisors (seguridad) y comprobar que anon y authenticated no leen ni escriben
-- ecos_category_songs.

alter table public.ecos_songs
  add column if not exists daily_eligible boolean not null default true;

alter table public.ecos_categories
  add column if not exists curated boolean not null default false;

create table if not exists public.ecos_category_songs (
  category_id uuid not null,
  song_id uuid not null,
  -- Posición en el listado de origen (solo informativa).
  position integer,
  created_at timestamp with time zone not null default now()
);

alter table public.ecos_category_songs add constraint ecos_category_songs_pkey
  PRIMARY KEY (category_id, song_id);
alter table public.ecos_category_songs add constraint ecos_category_songs_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.ecos_categories(id) ON DELETE CASCADE;
alter table public.ecos_category_songs add constraint ecos_category_songs_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES public.ecos_songs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ecos_category_songs_song_id_idx ON public.ecos_category_songs
  USING btree (song_id);

alter table public.ecos_system_logs drop constraint if exists ecos_system_logs_job_type_check;
alter table public.ecos_system_logs add constraint ecos_system_logs_job_type_check
  CHECK ((job_type = ANY (ARRAY['ingestion'::text, 'weekly_games'::text, 'daily_game'::text, 'report_auto_deactivate'::text, 'daily_notifications'::text, 'games_check'::text, 'deezer_backfill'::text, 'metadata_enrich'::text, 'category_import'::text])));

-- Categorías nuevas, inactivas hasta cargar sus listas (los iconos están en el subset de Material
-- Symbols de globals.css).
insert into public.ecos_categories (slug, name_es, name_en, icon, curated, is_active, sort_order) values
  ('pop-ingles',  'Pop en inglés',  'Pop in English',  'mic',           true, false, 100),
  ('rock-ingles', 'Rock en inglés', 'Rock in English', 'electric_bolt', true, false, 110)
on conflict (slug) do nothing;

-- Canciones jugables de una categoría. Elegibilidad igual que is_eligible de scripts/selection.py
-- (canción activa y audio de >= 29 s en Deezer o en Spotify; 29 = MIN_PREVIEW_SECONDS) y SIN las
-- canciones de juegos diarios con fecha >= hoy (ni otras ediciones de la misma canción, por
-- dedupe_key), para no destripar el reto de hoy ni los futuros.
-- - Categoría por facetas: además, playlist activa, facetas que cumplan la categoría y solo
--   canciones del catálogo diario (daily_eligible).
-- - Categoría curada: las canciones de su lista en ecos_category_songs, sin mirar playlist ni facetas.
CREATE OR REPLACE FUNCTION public.ecos_category_pool(p_category_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH cat AS (
    SELECT c.id, c.decades, c.genres, c.origins, c.curated
    FROM public.ecos_categories c
    WHERE c.id = p_category_id
  ),
  reserved AS (
    SELECT rs.id, rs.dedupe_key
    FROM public.ecos_games g
    JOIN public.ecos_songs rs ON rs.id = g.song_id
    WHERE g.date >= public.ecos_effective_game_date()
  ),
  candidates AS (
    SELECT s.*
    FROM cat c
    CROSS JOIN public.ecos_songs s
    JOIN public.ecos_spotify_playlists pl
      ON pl.spotify_playlist_id = s.spotify_playlist_id AND pl.is_active
    CROSS JOIN LATERAL public.ecos_song_facets(
      s.spotify_playlist_name, s.release_date, s.deezer_release_date, s.deezer_genre_ids,
      s.mb_language, s.mb_artist_country, s.origin_override
    ) f
    WHERE NOT c.curated
      AND s.daily_eligible
      AND (c.decades IS NULL OR f.decade = ANY (c.decades))
      AND (c.genres IS NULL OR f.genre = ANY (c.genres))
      AND (c.origins IS NULL OR f.origin = ANY (c.origins))
    UNION ALL
    SELECT s.*
    FROM cat c
    JOIN public.ecos_category_songs cs ON cs.category_id = c.id
    JOIN public.ecos_songs s ON s.id = cs.song_id
    WHERE c.curated
  )
  SELECT s.id
  FROM candidates s
  WHERE s.is_active
    AND (
      (s.deezer_id IS NOT NULL AND s.deezer_preview_seconds >= 29)
      OR (s.preview_url IS NOT NULL AND s.preview_duration_seconds >= 29)
    )
    AND NOT EXISTS (
      SELECT 1 FROM reserved r WHERE r.id = s.id OR r.dedupe_key = s.dedupe_key
    );
$function$;

-- Búsqueda: tercer argumento para las canciones solo de categorías. Cambia la firma, así que DROP +
-- CREATE y se vuelven a conceder los privilegios (abierta a propósito, ver 03_security.sql).
DROP FUNCTION IF EXISTS public.ecos_search_songs(text, integer);

CREATE FUNCTION public.ecos_search_songs(p_query text, p_limit integer, p_include_category_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, title text, artist_name text, album_title text, cover_url text, spotify_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT lower(unaccent(btrim(p_query))) AS nq
  )
  SELECT s.id, s.title, s.artist_name, s.album_title, s.cover_url, s.spotify_id
  FROM ecos_songs s, q
  WHERE s.is_active = true
    AND (s.daily_eligible OR COALESCE(p_include_category_only, false))
    AND (s.preview_url IS NOT NULL OR s.deezer_id IS NOT NULL)
    AND (
      unaccent(s.title) ILIKE '%' || unaccent(p_query) || '%'
      OR unaccent(s.artist_name) ILIKE '%' || unaccent(p_query) || '%'
    )
  ORDER BY
    CASE
      WHEN lower(unaccent(s.title)) = q.nq THEN 0
      WHEN lower(unaccent(s.title)) LIKE q.nq || '%' THEN 1
      WHEN ' ' || regexp_replace(lower(unaccent(s.title)), '[^[:alnum:]]+', ' ', 'g') || ' '
           LIKE '% ' || q.nq || ' %' THEN 2
      WHEN lower(unaccent(s.artist_name)) LIKE q.nq || '%' THEN 3
      WHEN ' ' || regexp_replace(lower(unaccent(s.artist_name)), '[^[:alnum:]]+', ' ', 'g') || ' '
           LIKE '% ' || q.nq || ' %' THEN 4
      ELSE 5
    END,
    length(s.title),
    lower(unaccent(s.title)),
    s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$function$;

GRANT EXECUTE ON FUNCTION public.ecos_search_songs(text, integer, boolean)
  TO anon, authenticated, service_role;

-- Privilegios: ecos_category_songs nace con todo concedido a anon y authenticated. Solo la service
-- role la lee y escribe (RLS sin políticas, y además sin privilegios).
alter table public.ecos_category_songs enable row level security;
revoke all on public.ecos_category_songs from anon, authenticated;
