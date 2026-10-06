-- Las estadísticas personales solo para uno mismo (auditoría oct. 2026, SEC-12).
--
-- get_user_ranking_stats y get_user_avg_guesses son SECURITY DEFINER y aceptaban cualquier
-- p_user_id: con la anon key se leían las de cualquier usuario (get_user_avg_guesses además lee
-- ecos_scores, que por RLS es privada). Ahora devuelven vacío / 0 si p_user_id no es auth.uid(),
-- y anon ya no puede ejecutarlas. get_user_avg_guesses vive en supabase/schema/02_functions.sql.
-- Aplicada en producción como migración `ecos_bd1_seguridad_restante`, junto con los cambios de
-- RLS que recoge supabase/schema/03_security.sql.

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
 RETURNS TABLE(total_points bigint, games_played bigint, games_won bigint, global_rank integer, streak integer, max_streak integer, weekly_points bigint, weekly_rank integer, weekly_aciertos integer, monthly_points bigint, monthly_rank integer, monthly_aciertos integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today_madrid date;
  v_week_start date;
  v_week_end date;
  v_month_start date;
  v_month_end date;
BEGIN
  -- Estadísticas personales: solo las del propio usuario (SEC-12).
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  v_today_madrid := (NOW() AT TIME ZONE 'Europe/Madrid')::date;
  v_week_start := v_today_madrid - (EXTRACT(ISODOW FROM v_today_madrid)::integer - 1);
  v_week_end := v_week_start + 6;
  v_month_start := date_trunc('month', v_today_madrid::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  RETURN QUERY
  WITH
  global_agg AS (
    SELECT
      s.user_id,
      SUM(s.points)::bigint AS tp,
      COUNT(*)::bigint AS gp,
      (COUNT(*) FILTER (WHERE s.correct))::bigint AS gw,
      ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rnk
    FROM ecos_scores s
    GROUP BY s.user_id
  ),
  weekly_agg AS (
    SELECT
      s.user_id,
      SUM(s.points)::bigint AS tp,
      (COUNT(*) FILTER (WHERE s.correct))::bigint AS ac,
      ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rnk
    FROM ecos_scores s
    JOIN ecos_games g ON g.id = s.game_id
    WHERE g.date >= v_week_start AND g.date <= v_week_end
      AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= v_week_start
      AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= v_week_end
    GROUP BY s.user_id
  ),
  monthly_agg AS (
    SELECT
      s.user_id,
      SUM(s.points)::bigint AS tp,
      (COUNT(*) FILTER (WHERE s.correct))::bigint AS ac,
      ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rnk
    FROM ecos_scores s
    JOIN ecos_games g ON g.id = s.game_id
    WHERE g.date >= v_month_start AND g.date <= v_month_end
      AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= v_month_start
      AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= v_month_end
    GROUP BY s.user_id
  )
  SELECT
    COALESCE((SELECT ga.tp FROM global_agg ga WHERE ga.user_id = p_user_id), 0::bigint),
    COALESCE((SELECT ga.gp FROM global_agg ga WHERE ga.user_id = p_user_id), 0::bigint),
    COALESCE((SELECT ga.gw FROM global_agg ga WHERE ga.user_id = p_user_id), 0::bigint),
    (SELECT ga.rnk FROM global_agg ga WHERE ga.user_id = p_user_id),
    COALESCE((SELECT lb.streak FROM ecos_leaderboard lb WHERE lb.user_id = p_user_id), 0),
    COALESCE((SELECT lb.max_streak FROM ecos_leaderboard lb WHERE lb.user_id = p_user_id), 0),
    COALESCE((SELECT wa.tp FROM weekly_agg wa WHERE wa.user_id = p_user_id), 0::bigint),
    (SELECT wa.rnk FROM weekly_agg wa WHERE wa.user_id = p_user_id),
    COALESCE((SELECT wa.ac FROM weekly_agg wa WHERE wa.user_id = p_user_id), 0::bigint)::int,
    COALESCE((SELECT ma.tp FROM monthly_agg ma WHERE ma.user_id = p_user_id), 0::bigint),
    (SELECT ma.rnk FROM monthly_agg ma WHERE ma.user_id = p_user_id),
    COALESCE((SELECT ma.ac FROM monthly_agg ma WHERE ma.user_id = p_user_id), 0::bigint)::int;
END;
$function$;

revoke execute on function public.get_user_ranking_stats(uuid) from public, anon;
grant execute on function public.get_user_ranking_stats(uuid) to authenticated, service_role;
