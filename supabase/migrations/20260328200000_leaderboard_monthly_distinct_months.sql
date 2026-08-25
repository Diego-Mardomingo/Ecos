-- Monthly summaries: only calendar months that have at least one score; no row cap.
-- Weekly summaries: unchanged p_count (default 12, max 52).

CREATE OR REPLACE FUNCTION public.get_leaderboard_period_summaries(
  p_granularity text,
  p_count integer DEFAULT NULL
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

GRANT EXECUTE ON FUNCTION public.get_leaderboard_period_summaries(text, integer) TO PUBLIC;
