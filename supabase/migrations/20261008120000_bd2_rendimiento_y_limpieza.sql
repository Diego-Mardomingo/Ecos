-- Aplicada en producción como `ecos_bd2_rendimiento_y_limpieza` (2026-10-08).
-- Estado final reflejado en supabase/schema/ (01_tables, 02_functions, 03_security).

-- BD-2 (parte 1): rendimiento y limpieza compatibles con el código desplegado hoy.

-- 1. PERFDB-08: el cierre de partida ya no reescribe todo el ranking para mantener global_rank,
--    que nadie lee (las RPC de ranking calculan la posición al vuelo).
-- 2. DATA-02: solo se suma al ranking si la puntuación es nueva. Antes, dos cierres simultáneos de
--    la misma partida sumaban los puntos dos veces a ecos_leaderboard.
CREATE OR REPLACE FUNCTION public.ecos_update_leaderboard(p_user_id uuid, p_points integer, p_won boolean, p_streak integer, p_update_streak boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.ecos_finalize_game_score(p_user_id uuid, p_game_id uuid, p_points integer, p_guesses_used integer, p_correct boolean, p_won boolean, p_streak integer, p_update_streak boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

-- 3. DEAD-16: la sobrecarga antigua de 4 argumentos, la función del selector por pg_cron y los dos
--    crons inactivos que la sustituyó daily-game.yml. El cron 2 (judi-*) es de la otra app: no tocar.
DROP FUNCTION public.ecos_update_leaderboard(uuid, integer, boolean, integer);
DROP FUNCTION public.run_daily_game_selector_at_midnight_spain();
SELECT cron.unschedule(3);
SELECT cron.unschedule(6);

-- 4. PERFDB-11: auth.uid() evaluado una vez por consulta, no por fila. Misma semántica.
ALTER POLICY ecos_guesses_own_insert ON public.ecos_guesses WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ecos_guesses_own_read ON public.ecos_guesses USING ((select auth.uid()) = user_id);
ALTER POLICY ecos_profiles_own_insert ON public.ecos_profiles WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ecos_push_subscriptions_own_delete ON public.ecos_push_subscriptions USING ((select auth.uid()) = user_id);
ALTER POLICY ecos_push_subscriptions_own_insert ON public.ecos_push_subscriptions WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ecos_push_subscriptions_own_select ON public.ecos_push_subscriptions USING ((select auth.uid()) = user_id);
ALTER POLICY ecos_push_subscriptions_own_update ON public.ecos_push_subscriptions USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY authenticated_insert_own_report ON public.ecos_reports WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ecos_scores_own_read ON public.ecos_scores USING ((select auth.uid()) = user_id);

-- 5. PERFDB-12 / DEAD-19: índices sin uso o que duplican una UNIQUE (que se queda).
DROP INDEX public.ecos_songs_fts;                       -- 0 scans, 296 kB; la búsqueda usa ILIKE
DROP INDEX public.ecos_push_subscriptions_enabled_idx;  -- 0 scans
DROP INDEX public.idx_ecos_games_date;                  -- duplica ecos_games_date_key
DROP INDEX public.idx_ecos_guesses_user_game;           -- prefijo de la UNIQUE (user_id, game_id, attempt_number)
DROP INDEX public.idx_ecos_scores_user;                 -- prefijo de la UNIQUE (user_id, game_id)
DROP INDEX public.ecos_push_subscriptions_user_id_idx;  -- prefijo de la UNIQUE (user_id, endpoint)

-- 6. PERFDB-13: FK sin índice con cascadas reales.
CREATE INDEX IF NOT EXISTS ecos_guesses_game_id_idx ON public.ecos_guesses (game_id);
CREATE INDEX IF NOT EXISTS ecos_games_song_id_idx ON public.ecos_games (song_id);

-- 7. DATA-05: borrar un usuario, un juego o una canción con reportes ya no falla.
ALTER TABLE public.ecos_reports
  DROP CONSTRAINT ecos_reports_user_id_fkey,
  ADD CONSTRAINT ecos_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  DROP CONSTRAINT ecos_reports_game_id_fkey,
  ADD CONSTRAINT ecos_reports_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.ecos_games(id) ON DELETE SET NULL,
  DROP CONSTRAINT ecos_reports_song_id_fkey,
  ADD CONSTRAINT ecos_reports_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.ecos_songs(id) ON DELETE SET NULL;

-- 8. PERFDB-14 (parte): las RPC de lectura del ranking son STABLE, no VOLATILE.
ALTER FUNCTION public.get_leaderboard_by_period(text, integer, text, date) STABLE;
ALTER FUNCTION public.get_leaderboard_period_summaries(text, integer) STABLE;
ALTER FUNCTION public.get_user_ranking_stats(uuid) STABLE;
