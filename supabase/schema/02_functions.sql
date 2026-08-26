-- Funciones de Ecos. Instantánea del proyecto real; ver README.md de este directorio.
--
-- NO están aquí `get_leaderboard_by_period`, `get_leaderboard_period_summaries` ni
-- `get_user_ranking_stats`: esas ya viven en `supabase/migrations/`, que es su historia real.
-- Duplicarlas aquí solo crearía dos versiones que se pueden desincronizar.
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

-- Búsqueda sin acentos (de ahí la extensión unaccent). Solo canciones activas y con preview,
-- que es lo único que el juego puede reproducir.
CREATE OR REPLACE FUNCTION public.ecos_search_songs(p_query text, p_limit integer)
 RETURNS SETOF ecos_songs
 LANGUAGE sql
 STABLE
AS $function$
  SELECT *
  FROM ecos_songs
  WHERE is_active = true
    AND preview_url IS NOT NULL
    AND (
      unaccent(title) ILIKE '%' || unaccent(p_query) || '%'
      OR unaccent(artist_name) ILIKE '%' || unaccent(p_query) || '%'
    )
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_avg_guesses(p_user_id uuid)
 RETURNS real
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(AVG(guesses_used)::real, 0)
  FROM ecos_scores
  WHERE user_id = p_user_id;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Finalización de partida
--
-- Cadena: ecos_guess_and_finalize_score -> ecos_finalize_game_score -> ecos_update_leaderboard.
-- Todas SECURITY DEFINER, y la app las llama con service role desde /api/validate-guess y
-- /api/skip-attempt. El número de intento y los puntos los decide el servidor, nunca el cliente
-- (ver src/lib/server-attempt.ts).
-- ---------------------------------------------------------------------------------------------

-- OJO: hay dos sobrecargas de ecos_update_leaderboard. La de 4 argumentos es la antigua y no
-- respeta `p_update_streak` ni la hora de Madrid; la de 5 es la que usa el código. Se conserva
-- la primera porque sigue existiendo en el proyecto, pero es candidata a borrarse.
CREATE OR REPLACE FUNCTION public.ecos_update_leaderboard(p_user_id uuid, p_points integer, p_won boolean, p_streak integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO ecos_leaderboard (user_id, total_points, games_played, games_won, streak, last_played)
  VALUES (p_user_id, p_points, 1, CASE WHEN p_won THEN 1 ELSE 0 END, p_streak, CURRENT_DATE)
  ON CONFLICT (user_id) DO UPDATE SET
    total_points  = ecos_leaderboard.total_points + p_points,
    games_played  = ecos_leaderboard.games_played + 1,
    games_won     = ecos_leaderboard.games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    streak        = p_streak,
    last_played   = CURRENT_DATE,
    updated_at    = NOW();

  -- Recalcular global_rank para todos
  UPDATE ecos_leaderboard el
  SET global_rank = ranked.rn
  FROM (
    SELECT user_id, ROW_NUMBER() OVER (ORDER BY total_points DESC) AS rn
    FROM ecos_leaderboard
  ) ranked
  WHERE el.user_id = ranked.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ecos_update_leaderboard(p_user_id uuid, p_points integer, p_won boolean, p_streak integer, p_update_streak boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  madrid_date date;
BEGIN
  madrid_date := (NOW() AT TIME ZONE 'Europe/Madrid')::date;

  INSERT INTO ecos_leaderboard (user_id, total_points, games_played, games_won, streak, max_streak, last_played)
  VALUES (
    p_user_id,
    p_points,
    1,
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

  UPDATE ecos_leaderboard el
  SET global_rank = ranked.rn
  FROM (
    SELECT user_id, ROW_NUMBER() OVER (ORDER BY total_points DESC) AS rn
    FROM ecos_leaderboard
  ) ranked
  WHERE el.user_id = ranked.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ecos_finalize_game_score(p_user_id uuid, p_game_id uuid, p_points integer, p_guesses_used integer, p_correct boolean, p_won boolean, p_streak integer, p_update_streak boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO ecos_scores (user_id, game_id, points, guesses_used, correct)
  VALUES (p_user_id, p_game_id, p_points, p_guesses_used, p_correct)
  ON CONFLICT (user_id, game_id)
  DO UPDATE SET
    points = EXCLUDED.points,
    guesses_used = EXCLUDED.guesses_used,
    correct = EXCLUDED.correct;

  PERFORM public.ecos_update_leaderboard(p_user_id, p_points, p_won, p_streak, p_update_streak);
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
