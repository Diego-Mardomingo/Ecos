-- Búsqueda: solo las columnas que usa la app, límite acotado y orden por relevancia
-- (auditoría oct. 2026: PERFDB-07, DEAD-24 y el orden de «Así» que encontró el orquestador).
-- Mismo SQL que la definición de supabase/schema/02_functions.sql.
--
-- Compatible con el código anterior: /api/search-songs ya pide las seis columnas con
-- `.rpc(...).select(...)`, que funciona igual con SETOF ecos_songs que con RETURNS TABLE.
--
-- Cambiar el tipo de retorno obliga a DROP + CREATE, que se lleva los privilegios: se vuelven a
-- conceder al final (la RPC está abierta a propósito, ver supabase/schema/03_security.sql).

DROP FUNCTION IF EXISTS public.ecos_search_songs(text, integer);

CREATE FUNCTION public.ecos_search_songs(p_query text, p_limit integer)
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
    AND s.preview_url IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.ecos_search_songs(text, integer)
  TO anon, authenticated, service_role;
