-- Metadatos de canciones para el modo por categorías (plan Fase 1).
--
-- ESTADO: APLICADA el 2026-10-14 en producción (antes de lanzar scripts/enrich-metadata.py). Es aditiva (columnas nulas, un CHECK ampliado y una función nueva),
-- así que el código actual sigue funcionando con ella.
--
-- - ecos_songs: fecha y géneros de Deezer (`/track` y `/album`), idioma de la obra y país y
--   géneros del artista de MusicBrainz, y una corrección manual del origen. `*_checked_at` marca
--   que la consulta dio respuesta definitiva (encontrado o no); un fallo de la API no lo marca.
-- - ecos_system_logs: nuevo job_type `metadata_enrich` (también en src/lib/system-logger.ts y
--   scripts/common.py).
-- - ecos_song_facets: década, género y origen derivados de esas columnas (y del nombre de la
--   playlist). Solo service role / otras funciones.
--
-- Privilegios: las columnas nuevas heredan los de ecos_songs, ya recortados (los clientes solo
-- leen). La función nace con EXECUTE para PUBLIC: se revoca abajo.

alter table public.ecos_songs
  add column if not exists deezer_release_date text,
  add column if not exists deezer_genre_ids integer[],
  add column if not exists deezer_meta_checked_at timestamptz,
  add column if not exists mb_language text,
  add column if not exists mb_artist_country text,
  add column if not exists mb_genres text[],
  add column if not exists mb_checked_at timestamptz,
  add column if not exists origin_override text;

alter table public.ecos_songs drop constraint if exists ecos_songs_origin_override_check;
alter table public.ecos_songs add constraint ecos_songs_origin_override_check
  check (origin_override is null or origin_override in ('es', 'latam', 'intl'));

alter table public.ecos_system_logs drop constraint if exists ecos_system_logs_job_type_check;
alter table public.ecos_system_logs add constraint ecos_system_logs_job_type_check
  check ((job_type = any (array['ingestion'::text, 'weekly_games'::text, 'daily_game'::text, 'report_auto_deactivate'::text, 'daily_notifications'::text, 'games_check'::text, 'deezer_backfill'::text, 'metadata_enrich'::text])));

-- Facetas de una canción para el modo por categorías: década, género y origen. Función pura (solo
-- mira los argumentos), por eso IMMUTABLE. Solo la usan otras funciones de SQL y la service role:
-- ver el revoke en 03_security.sql.
--
-- Década: manda el «Los NN» del nombre de la playlist (misma regex y lógica que get_song_decade en
-- scripts/selection.py: la fecha del álbum miente en recopilatorios y reediciones); si no, el año
-- más antiguo entre la fecha de Deezer y la de Spotify.
-- Género: el nombre de la playlist; si no, el género de Deezer (grueso: casi todo es «pop», por eso
-- va el último en la prioridad).
-- Origen: origin_override; después país del artista e idioma de MusicBrainz; por último la pista de
-- la playlist («España», «Español», «Ñ»). Nunca se deduce del ISRC.
CREATE OR REPLACE FUNCTION public.ecos_song_facets(
  p_playlist_name text,
  p_release_date text,
  p_deezer_release_date text,
  p_deezer_genre_ids integer[],
  p_mb_language text,
  p_mb_artist_country text,
  p_origin_override text
)
 RETURNS TABLE(decade integer, genre text, origin text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  WITH base AS (
    SELECT
      lower(coalesce(p_playlist_name, '')) AS pl,
      upper(nullif(btrim(coalesce(p_mb_artist_country, '')), '')) AS country,
      lower(nullif(btrim(coalesce(p_mb_language, '')), '')) AS lang,
      -- Años de las dos fechas (solo si empiezan por 4 cifras); el menor gana.
      LEAST(
        CASE WHEN p_deezer_release_date ~ '^\d{4}' THEN left(p_deezer_release_date, 4)::integer END,
        CASE WHEN p_release_date ~ '^\d{4}' THEN left(p_release_date, 4)::integer END
      ) AS min_year
  ),
  calc AS (
    SELECT
      b.*,
      substring(b.pl from '\ylos (60|70|80|90|2000|2010)s?\y') AS pl_decade,
      -- La playlist apunta a España.
      (b.pl ~ 'espa(ñ|n)a|espa(ñ|n)ol|spain|ñ') AS pl_es
    FROM base b
  )
  SELECT
    CASE
      WHEN c.pl_decade IS NOT NULL THEN
        CASE WHEN c.pl_decade::integer < 100 THEN 1900 + c.pl_decade::integer ELSE c.pl_decade::integer END
      WHEN c.min_year BETWEEN 1900 AND 2100 THEN (c.min_year / 10) * 10
    END AS decade,
    CASE
      WHEN c.pl LIKE '%flamenco%' THEN 'flamenco'
      WHEN c.pl LIKE '%rap%' THEN 'rap'
      WHEN c.pl LIKE '%reggaeton%' OR c.pl LIKE '%urbano%' THEN 'urbano'
      WHEN c.pl LIKE '%balada%' THEN 'baladas'
      WHEN c.pl LIKE 'pop %' OR c.pl LIKE '% pop' OR c.pl LIKE '% pop %' THEN 'pop'
      WHEN p_deezer_genre_ids && ARRAY[116] THEN 'rap'
      WHEN p_deezer_genre_ids && ARRAY[122] THEN 'urbano'
      WHEN p_deezer_genre_ids && ARRAY[152, 85, 464] THEN 'rock'
      WHEN p_deezer_genre_ids && ARRAY[197] THEN 'latino'
      WHEN p_deezer_genre_ids && ARRAY[113, 106] THEN 'electronica'
      WHEN p_deezer_genre_ids && ARRAY[132] THEN 'pop'
    END AS genre,
    CASE
      WHEN p_origin_override IS NOT NULL THEN p_origin_override
      WHEN c.country = 'ES' THEN 'es'
      WHEN c.country IN ('MX','AR','CO','CL','PE','VE','EC','GT','CU','BO','DO','HN','PY','SV','NI','CR','PA','UY','PR')
        THEN 'latam'
      -- Otro país: extranjero, salvo que la obra esté en español (ahí decide la playlist).
      WHEN c.country IS NOT NULL AND c.lang IS DISTINCT FROM 'spa' THEN 'intl'
      WHEN c.lang = 'spa' THEN CASE WHEN c.pl_es THEN 'es' END
      WHEN c.lang IS NOT NULL THEN 'intl'
      WHEN c.pl_es THEN 'es'
    END AS origin
  FROM calc c;
$function$;

revoke execute on function public.ecos_song_facets(text, text, text, integer[], text, text, text)
  from public, anon, authenticated;
