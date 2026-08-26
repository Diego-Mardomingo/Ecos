-- Extend leaderboard by period with optional reference date (historical weeks/months).
-- Add batch summaries for history cards.

DROP FUNCTION IF EXISTS public.get_leaderboard_by_period(text, integer, text);

CREATE OR REPLACE FUNCTION public.get_leaderboard_by_period(
  p_period text DEFAULT 'global'::text,
  p_limit integer DEFAULT 50,
  p_search text DEFAULT NULL::text,
  p_reference_date date DEFAULT NULL
)
RETURNS TABLE(user_id uuid, total_points bigint, streak integer, global_rank integer, aciertos integer, display_name text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date date;
  v_end_date date;
  v_search_pattern text;
  v_ref date;
BEGIN
  v_search_pattern := COALESCE('%' || NULLIF(trim(p_search), '') || '%', '%');

  IF p_period = 'global' THEN
    RETURN QUERY
    SELECT
      l.user_id,
      l.total_points::bigint,
      l.streak,
      l.global_rank::int,
      l.games_won::int AS aciertos,
      (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      )::text AS display_name,
      p.avatar_url
    FROM ecos_leaderboard l
    LEFT JOIN ecos_profiles p ON p.user_id = l.user_id
    LEFT JOIN auth.users au ON au.id = l.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (
        CASE
          WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username)
          WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin'
          THEN trim(p.display_name)
          ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador')
        END
      ) ILIKE v_search_pattern)
    ORDER BY l.total_points DESC, l.user_id
    LIMIT p_limit;
  ELSIF p_period = 'weekly' THEN
    v_ref := COALESCE(p_reference_date, CURRENT_DATE)::date;
    v_start_date := date_trunc('week', v_ref)::date;
    v_end_date := v_start_date + 6;
    RETURN QUERY
    WITH ranked AS (
      SELECT s.user_id, SUM(s.points)::bigint AS total_points,
        (COUNT(*) FILTER (WHERE s.correct))::int AS aciertos,
        ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rn
      FROM ecos_scores s JOIN ecos_games g ON g.id = s.game_id
      WHERE g.date >= v_start_date AND g.date <= v_end_date
      GROUP BY s.user_id
    )
    SELECT r.user_id, r.total_points, COALESCE(lb.streak, 0)::int AS streak, r.rn AS global_rank, r.aciertos,
      (CASE WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username) WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin' THEN trim(p.display_name) ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador') END)::text AS display_name, p.avatar_url
    FROM ranked r LEFT JOIN ecos_leaderboard lb ON lb.user_id = r.user_id LEFT JOIN ecos_profiles p ON p.user_id = r.user_id LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (CASE WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username) WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin' THEN trim(p.display_name) ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador') END) ILIKE v_search_pattern)
    ORDER BY r.total_points DESC, r.user_id LIMIT p_limit;
  ELSIF p_period = 'monthly' THEN
    v_ref := COALESCE(p_reference_date, CURRENT_DATE)::date;
    v_start_date := date_trunc('month', v_ref)::date;
    v_end_date := (date_trunc('month', v_ref) + interval '1 month - 1 day')::date;
    RETURN QUERY
    WITH ranked AS (
      SELECT s.user_id, SUM(s.points)::bigint AS total_points,
        (COUNT(*) FILTER (WHERE s.correct))::int AS aciertos,
        ROW_NUMBER() OVER (ORDER BY SUM(s.points) DESC, s.user_id)::int AS rn
      FROM ecos_scores s JOIN ecos_games g ON g.id = s.game_id
      WHERE g.date >= v_start_date AND g.date <= v_end_date
      GROUP BY s.user_id
    )
    SELECT r.user_id, r.total_points, COALESCE(lb.streak, 0)::int AS streak, r.rn AS global_rank, r.aciertos,
      (CASE WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username) WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin' THEN trim(p.display_name) ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador') END)::text AS display_name, p.avatar_url
    FROM ranked r LEFT JOIN ecos_leaderboard lb ON lb.user_id = r.user_id LEFT JOIN ecos_profiles p ON p.user_id = r.user_id LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE (p_search IS NULL OR trim(p_search) = '' OR (CASE WHEN p.username IS NOT NULL AND trim(p.username) <> '' THEN trim(p.username) WHEN p.display_name IS NOT NULL AND trim(p.display_name) <> '' AND lower(trim(p.display_name)) <> 'admin' THEN trim(p.display_name) ELSE coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email::text, '@', 1), 'Jugador') END) ILIKE v_search_pattern)
    ORDER BY r.total_points DESC, r.user_id LIMIT p_limit;
  ELSE RETURN;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_period_summaries(
  p_granularity text,
  p_count integer
)
RETURNS TABLE(
  period_start date,
  period_end date,
  winner_user_id uuid,
  winner_points bigint,
  winner_display_name text,
  winner_avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  v_n := LEAST(GREATEST(COALESCE(p_count, 12), 1), 52);

  IF p_granularity = 'weekly' THEN
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
    WITH periods AS (
      SELECT
        (date_trunc('month', CURRENT_DATE) - (i || ' months')::interval)::date AS ps,
        ((date_trunc('month', CURRENT_DATE) - (i || ' months')::interval) + interval '1 month - 1 day')::date AS pe
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_by_period(text, integer, text, date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_period_summaries(text, integer) TO PUBLIC;
