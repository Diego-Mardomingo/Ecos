-- Deezer como fuente principal de audio, Spotify como respaldo (plan docs/plan-audio, F5).
--
-- ESTADO: PENDIENTE. Es aditiva (columnas nuevas con valor por defecto o nulas, un índice y un
-- CHECK ampliado), así que no rompe el código actual: aplicarla ANTES de fusionar y desplegar
-- el código que la usa (los scripts piden las columnas nuevas y el panel lee `audio_source`).
--
-- - ecos_songs: id de Deezer, ISRC, duración medida del preview de Deezer y cuándo se comprobó.
--   La URL de preview de Deezer va firmada y caduca a los 900 s: NO se guarda; se resuelve con
--   `GET /track/{deezer_id}` cuando hace falta. Los índices no son únicos a propósito: dos filas
--   de Spotify (single y álbum) pueden apuntar a la misma pista de Deezer, y los duplicados se
--   descartan en el selector (selection.py), no con una restricción.
-- - ecos_games.audio_source: la fuente se fija al crear la partida. El valor por defecto deja
--   todas las partidas existentes (hoy, mañana y pasado incluidas) en Spotify.
-- - ecos_system_logs: nuevo job_type `deezer_backfill` (también en src/lib/system-logger.ts y
--   scripts/common.py).
-- - ecos_search_songs: una canción es buscable si tiene alguna fuente de audio.
--   CREATE OR REPLACE conserva los privilegios (abierta a propósito, ver 03_security.sql).
--
-- Los privilegios no cambian: las columnas nuevas heredan los de sus tablas, ya recortadas.

alter table public.ecos_songs
  add column if not exists deezer_id bigint,
  add column if not exists isrc text,
  add column if not exists deezer_preview_seconds double precision,
  add column if not exists deezer_checked_at timestamptz;

create index if not exists ecos_songs_deezer_id_idx on public.ecos_songs using btree (deezer_id);
create index if not exists ecos_songs_isrc_idx on public.ecos_songs using btree (isrc);

alter table public.ecos_games
  add column if not exists audio_source text not null default 'spotify';

alter table public.ecos_games drop constraint if exists ecos_games_audio_source_check;
alter table public.ecos_games add constraint ecos_games_audio_source_check
  check (audio_source in ('spotify', 'deezer'));

alter table public.ecos_system_logs drop constraint if exists ecos_system_logs_job_type_check;
alter table public.ecos_system_logs add constraint ecos_system_logs_job_type_check
  check ((job_type = any (array['ingestion'::text, 'weekly_games'::text, 'daily_game'::text, 'report_auto_deactivate'::text, 'daily_notifications'::text, 'games_check'::text, 'deezer_backfill'::text])));

create or replace function public.ecos_search_songs(p_query text, p_limit integer)
 returns table(id uuid, title text, artist_name text, album_title text, cover_url text, spotify_id text)
 language sql
 stable
 set search_path to 'public'
as $function$
  WITH q AS (
    SELECT lower(unaccent(btrim(p_query))) AS nq
  )
  SELECT s.id, s.title, s.artist_name, s.album_title, s.cover_url, s.spotify_id
  FROM ecos_songs s, q
  WHERE s.is_active = true
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
