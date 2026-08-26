-- Rankings semanal/mensual: solo cuentan puntos si el usuario completó la partida
-- (created_at en fecha local Europe/Madrid) dentro del mismo periodo que el día del juego.
-- Evita que partidas antiguas completadas después alteren podios ya cerrados.

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
$function$


CREATE OR REPLACE FUNCTION public.get_leaderboard_period_summaries(p_granularity text, p_count integer DEFAULT NULL::integer)
 RETURNS TABLE(period_start date, period_end date, winner_user_id uuid, winner_points bigint, winner_display_name text, winner_avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_granularity = 'weekly' THEN
    v_n := LEAST(GREATEST(COALESCE(p_count, 12), 1), 52);
    RETURN QUERY
    WITH periods AS (
      SELECT
        (date_trunc('week', CURRENT_DATE)::date - (i * 7)) AS ps,
        (date_trunc('week', CURRENT_DATE)::date - (i * 7) + 6) AS pe
      FROM generate_series(1, v_n) AS t(i)
    )
    SELECT
      per.ps,
      per.pe,
      w.user_id,
      w.total_points,
      (CASE
        WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
        WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
        THEN trim(p.display_name)
        ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
      END)::text,
      p.avatar_url
    FROM periods per
    LEFT JOIN LATERAL (
      SELECT r.user_id, r.total_points
      FROM (
        SELECT s.user_id, SUM(s.points)::bigint AS total_points
        FROM ecos_scores s
        INNER JOIN ecos_games g ON g.id = s.game_id
        WHERE g.date >= per.ps AND g.date <= per.pe
          AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= per.ps
          AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= per.pe
        GROUP BY s.user_id
      ) r
      ORDER BY r.total_points DESC, r.user_id
      LIMIT 1
    ) w ON true
    LEFT JOIN ecos_profiles p ON p.user_id = w.user_id
    LEFT JOIN auth.users au ON au.id = w.user_id
    ORDER BY per.ps DESC;
  ELSIF p_granularity = 'monthly' THEN
    RETURN QUERY
    WITH months_with_scores AS (
      SELECT DISTINCT date_trunc('month', g.date)::date AS ps
      FROM ecos_scores s
      INNER JOIN ecos_games g ON g.id = s.game_id
      WHERE date_trunc('month', g.date::timestamp) = date_trunc('month', (s.created_at AT TIME ZONE 'Europe/Madrid')::timestamp)
    ),
    periods AS (
      SELECT
        m.ps,
        ((m.ps + interval '1 month')::date - 1) AS pe
      FROM months_with_scores m
    )
    SELECT
      per.ps,
      per.pe,
      w.user_id,
      w.total_points,
      (CASE
        WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
        WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
        THEN trim(p.display_name)
        ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
      END)::text,
      p.avatar_url
    FROM periods per
    INNER JOIN LATERAL (
      SELECT r.user_id, r.total_points
      FROM (
        SELECT s.user_id, SUM(s.points)::bigint AS total_points
        FROM ecos_scores s
        INNER JOIN ecos_games g ON g.id = s.game_id
        WHERE g.date >= per.ps AND g.date <= per.pe
          AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= per.ps
          AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= per.pe
        GROUP BY s.user_id
      ) r
      ORDER BY r.total_points DESC, r.user_id
      LIMIT 1
    ) w ON true
    LEFT JOIN ecos_profiles p ON p.user_id = w.user_id
    LEFT JOIN auth.users au ON au.id = w.user_id
    ORDER BY per.ps DESC;
  END IF;
  RETURN;
END;
$function$


CREATE OR REPLACE FUNCTION public.get_leaderboard_by_period(p_period text DEFAULT 'global'::text, p_limit integer DEFAULT 50, p_search text DEFAULT NULL::text, p_reference_date date DEFAULT NULL::date)
 RETURNS TABLE(user_id uuid, total_points bigint, streak integer, global_rank integer, aciertos integer, display_name text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date date;
  v_end_date date;
  v_search_pattern text;
  v_today_madrid date;
  v_ref date;
BEGIN
  v_search_pattern := COALESCE('%' || NULLIF(trim(p_search), '') || '%', '%');
  v_today_madrid := (NOW() AT TIME ZONE 'Europe/Madrid')::date;

  IF p_period = 'global' THEN
    RETURN QUERY
    WITH ranked AS (
      SELECT
        s.user_id,
        SUM(s.points)::bigint AS total_points,
        (COUNT(*) FILTER (WHERE s.correct))::int AS aciertos,
        ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rn
      FROM ecos_scores s
      GROUP BY s.user_id
    )
    SELECT
      r.user_id,
      r.total_points,
      COALESCE(lb.streak, 0)::int AS streak,
      r.rn AS global_rank,
      r.aciertos,
      (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      )::text AS display_name,
      p.avatar_url
    FROM ranked r
    LEFT JOIN ecos_leaderboard lb ON lb.user_id = r.user_id
    LEFT JOIN ecos_profiles p ON p.user_id = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      ) ILIKE v_search_pattern)
    ORDER BY r.total_points DESC, r.user_id
    LIMIT p_limit;

  ELSIF p_period = 'weekly' THEN
    v_ref := COALESCE(p_reference_date, v_today_madrid);
    v_start_date := v_ref - (EXTRACT(ISODOW FROM v_ref)::integer - 1);
    v_end_date := v_start_date + 6;
    RETURN QUERY
    WITH ranked AS (
      SELECT
        s.user_id,
        SUM(s.points)::bigint AS total_points,
        (COUNT(*) FILTER (WHERE s.correct))::int AS aciertos,
        ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rn
      FROM ecos_scores s
      JOIN ecos_games g ON g.id = s.game_id
      WHERE g.date >= v_start_date AND g.date <= v_end_date
        AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= v_start_date
        AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= v_end_date
      GROUP BY s.user_id
    )
    SELECT
      r.user_id,
      r.total_points,
      COALESCE(lb.streak, 0)::int AS streak,
      r.rn AS global_rank,
      r.aciertos,
      (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      )::text AS display_name,
      p.avatar_url
    FROM ranked r
    LEFT JOIN ecos_leaderboard lb ON lb.user_id = r.user_id
    LEFT JOIN ecos_profiles p ON p.user_id = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      ) ILIKE v_search_pattern)
    ORDER BY r.total_points DESC, r.user_id
    LIMIT p_limit;

  ELSIF p_period = 'monthly' THEN
    v_ref := COALESCE(p_reference_date, v_today_madrid);
    v_start_date := date_trunc('month', v_ref::timestamp)::date;
    v_end_date := (v_start_date + interval '1 month - 1 day')::date;
    RETURN QUERY
    WITH ranked AS (
      SELECT
        s.user_id,
        SUM(s.points)::bigint AS total_points,
        (COUNT(*) FILTER (WHERE s.correct))::int AS aciertos,
        ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rn
      FROM ecos_scores s
      JOIN ecos_games g ON g.id = s.game_id
      WHERE g.date >= v_start_date AND g.date <= v_end_date
        AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date >= v_start_date
        AND (s.created_at AT TIME ZONE 'Europe/Madrid')::date <= v_end_date
      GROUP BY s.user_id
    )
    SELECT
      r.user_id,
      r.total_points,
      COALESCE(lb.streak, 0)::int AS streak,
      r.rn AS global_rank,
      r.aciertos,
      (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      )::text AS display_name,
      p.avatar_url
    FROM ranked r
    LEFT JOIN ecos_leaderboard lb ON lb.user_id = r.user_id
    LEFT JOIN ecos_profiles p ON p.user_id = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      ) ILIKE v_search_pattern)
    ORDER BY r.total_points DESC, r.user_id
    LIMIT p_limit;
  ELSE
    RETURN;
  END IF;
END;
$function$

