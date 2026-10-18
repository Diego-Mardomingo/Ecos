-- Funciones de Ecos. Instantánea del proyecto real; ver README.md de este directorio.
--
-- Las RPC de ranking (`get_leaderboard_by_period`, `get_leaderboard_period_summaries`,
-- `get_user_ranking_stats`) están en `04_leaderboard.sql`, volcadas de la BD viva. Las
-- migraciones de `supabase/migrations/` que las crearon (marzo 2026) están desfasadas respecto
-- a lo que corre en producción (usan CURRENT_DATE/UTC y no respetan `show_avatar_in_rankings`):
-- no son su historia real y no se deben reaplicar.
--
-- Tampoco están `is_admin`, `handle_new_user` ni `run_judi_daily_notification`: pese al nombre
-- genérico, pertenecen a la otra aplicación que comparte el proyecto de Supabase. Ojo con
-- `is_admin()` en particular — consulta `hubgames_usuarios.administrador` y NO sirve para Ecos,
-- cuyo rol vive en `ecos_profiles.role` (ver `src/lib/auth/requireAdmin.ts`).

CREATE OR REPLACE FUNCTION public.ecos_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ecos_push_subscriptions_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;

-- Crea el perfil al registrarse. La engancha un trigger sobre auth.users, que no se puede
-- versionar desde aquí porque ese esquema es de Supabase.
CREATE OR REPLACE FUNCTION public.ecos_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.ecos_profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      ''
    )
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Deduplicación del catálogo
--
-- ecos_songs solo tenía único en spotify_id, y Spotify publica la misma canción como single y
-- dentro de un álbum o recopilatorio: otro spotify_id, misma pista, otra carátula. La ingesta
-- las veía como dos canciones distintas.
--
-- La clave va en una columna mantenida por trigger y no en un índice de expresión porque
-- unaccent() es STABLE, no IMMUTABLE, así que Postgres no la admite dentro de un índice.
-- Marcarla como inmutable a mano es el truco habitual, pero deja el índice inconsistente si
-- algún día cambia el diccionario. Un trigger BEFORE sí puede llamar a una función STABLE, y
-- además cubre cualquier insert: la ingesta, el panel o una consulta a mano.
--
-- scripts/song_key.py calcula una versión de esta clave para prefiltrar en la ingesta. No es
-- idéntica (no replica toda la tabla de unaccent) pero sí igual o más fina, así que nunca junta
-- lo que aquí se separa. El árbitro es el índice único.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ecos_dedupe_key(p_title text, p_artist text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select lower(btrim(regexp_replace(unaccent(coalesce(p_title, '')), '\s+', ' ', 'g')))
      || E'\x1f'
      || lower(btrim(regexp_replace(unaccent(coalesce(p_artist, '')), '\s+', ' ', 'g')));
$function$;

CREATE OR REPLACE FUNCTION public.ecos_songs_set_dedupe_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.dedupe_key := public.ecos_dedupe_key(new.title, new.artist_name);
  return new;
end;
$function$;

-- Búsqueda sin acentos (de ahí la extensión unaccent). Solo canciones activas y con alguna fuente de
-- audio (preview de Spotify o id de Deezer), que es lo único que el juego puede reproducir.
-- Filtro ampliado con la migración 20261010120000_deezer_columnas_y_fuente_audio (PENDIENTE).
--
-- Devuelve solo las columnas que usa /api/search-songs: con SETOF ecos_songs viajaba la fila
-- entera (raw_spotify_data, preview_url…), 4,3 veces más bytes, y quien llamara a la RPC por REST
-- se llevaba el preview_url de cualquier canción. El límite se acota dentro (1–200, 100 si llega
-- NULL): antes un `LIMIT NULL` devolvía el catálogo entero.
--
-- Orden por relevancia, normalizando igual que el filtro (minúsculas y sin acentos):
--   0 título idéntico a la consulta · 1 título que empieza por ella · 2 palabra completa del
--   título · 3 artista que empieza por ella · 4 palabra completa del artista · 5 el resto.
-- Desempate: título más corto, alfabético y por id (orden estable). Antes no había ORDER BY y,
-- con «Así», la canción titulada exactamente «Así» salía la última de 19.
--
-- Cambiar el tipo de retorno obliga a DROP + CREATE, que se lleva los privilegios: se vuelven a
-- conceder abajo (la RPC está abierta a propósito, ver 03_security.sql). Aplicada como migración
-- 20261007120000_search_songs_relevance (supabase/migrations/).
--
-- `p_include_category_only`: incluye las canciones solo de categorías (daily_eligible = false). Lo
-- pide el buscador del modo por categorías (`scope=categories` en /api/search-songs); el del reto
-- diario no. Migración 20261018120000_categorias_listas_curadas.
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

CREATE OR REPLACE FUNCTION public.get_user_avg_guesses(p_user_id uuid)
 RETURNS real
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(AVG(guesses_used)::real, 0)
  FROM ecos_scores
  WHERE user_id = p_user_id
    AND p_user_id = auth.uid();
$function$;

-- ---------------------------------------------------------------------------------------------
-- Finalización de partida
--
-- Cadena: ecos_guess_and_finalize_score -> ecos_finalize_game_score -> ecos_update_leaderboard.
-- Todas SECURITY DEFINER, y la app las llama con service role desde /api/validate-guess y
-- /api/skip-attempt. El número de intento y los puntos los decide el servidor, nunca el cliente
-- (ver src/lib/server-attempt.ts).
-- ---------------------------------------------------------------------------------------------

-- ecos_update_leaderboard ya no recalcula `global_rank` (PERFDB-08): reescribía todo el ranking en
-- cada cierre de partida y nadie lo lee, las RPC de get_leaderboard_* calculan la posición al vuelo.
-- La columna sigue existiendo, pero queda sin mantener. Tampoco existe ya la sobrecarga antigua de
-- 4 argumentos (DEAD-16). Migración: 20261008120000_bd2_rendimiento_y_limpieza.
CREATE OR REPLACE FUNCTION public.ecos_update_leaderboard(p_user_id uuid, p_points integer, p_won boolean, p_streak integer, p_update_streak boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  madrid_date date;
BEGIN
  madrid_date := (NOW() AT TIME ZONE 'Europe/Madrid')::date;

  INSERT INTO ecos_leaderboard (user_id, total_points, games_played, games_won, streak, max_streak, last_played)
  VALUES (
    p_user_id, p_points, 1,
    CASE WHEN p_won THEN 1 ELSE 0 END,
    CASE WHEN p_update_streak THEN p_streak ELSE 0 END,
    CASE WHEN p_update_streak THEN GREATEST(0, p_streak) ELSE 0 END,
    CASE WHEN p_update_streak THEN madrid_date ELSE '1970-01-01'::date END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_points  = ecos_leaderboard.total_points + p_points,
    games_played  = ecos_leaderboard.games_played + 1,
    games_won     = ecos_leaderboard.games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    streak        = CASE WHEN p_update_streak THEN p_streak ELSE ecos_leaderboard.streak END,
    max_streak    = CASE WHEN p_update_streak THEN GREATEST(COALESCE(ecos_leaderboard.max_streak, 0), p_streak) ELSE ecos_leaderboard.max_streak END,
    last_played   = CASE WHEN p_update_streak THEN madrid_date ELSE ecos_leaderboard.last_played END,
    updated_at    = NOW();
END;
$function$;

-- Solo suma al ranking si la puntuación es nueva (DATA-02): `xmax = 0` distingue el INSERT del
-- ON CONFLICT DO UPDATE. Antes, dos cierres simultáneos de la misma partida sumaban los puntos dos
-- veces a ecos_leaderboard.
CREATE OR REPLACE FUNCTION public.ecos_finalize_game_score(p_user_id uuid, p_game_id uuid, p_points integer, p_guesses_used integer, p_correct boolean, p_won boolean, p_streak integer, p_update_streak boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted boolean;
BEGIN
  INSERT INTO ecos_scores (user_id, game_id, points, guesses_used, correct)
  VALUES (p_user_id, p_game_id, p_points, p_guesses_used, p_correct)
  ON CONFLICT (user_id, game_id)
  DO UPDATE SET
    points = EXCLUDED.points,
    guesses_used = EXCLUDED.guesses_used,
    correct = EXCLUDED.correct
  RETURNING (xmax = 0) INTO v_inserted;

  IF v_inserted THEN
    PERFORM public.ecos_update_leaderboard(p_user_id, p_points, p_won, p_streak, p_update_streak);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ecos_guess_and_finalize_score(p_user_id uuid, p_game_id uuid, p_attempt_number integer, p_guess_text text, p_correct boolean, p_correct_artist boolean, p_correct_album boolean, p_points integer, p_guesses_used integer, p_won boolean, p_streak integer, p_update_streak boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO ecos_guesses (user_id, game_id, attempt_number, guess_text, correct, correct_artist, correct_album)
  VALUES (p_user_id, p_game_id, p_attempt_number, p_guess_text, p_correct, p_correct_artist, p_correct_album)
  ON CONFLICT (user_id, game_id, attempt_number) DO UPDATE SET
    guess_text = EXCLUDED.guess_text,
    correct = EXCLUDED.correct,
    correct_artist = EXCLUDED.correct_artist,
    correct_album = EXCLUDED.correct_album;

  PERFORM public.ecos_finalize_game_score(
    p_user_id,
    p_game_id,
    p_points,
    p_guesses_used,
    p_correct,
    p_won,
    p_streak,
    p_update_streak
  );
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Facetas de canción (modo por categorías). Migración 20261014120000_metadatos_canciones (aplicada).
-- ---------------------------------------------------------------------------------------------

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
