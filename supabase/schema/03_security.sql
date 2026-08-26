-- RLS, políticas y privilegios de Ecos. Instantánea del proyecto real.
--
-- Este es el fichero que más importa que esté en git: una política mal puesta no se ve en el
-- código, no la detecta ningún typecheck, y sin versionar tampoco sale en ninguna revisión. Las
-- dos escaladas de privilegios que se cerraron el 2026-08-24 llevaban meses abiertas justo por
-- eso. Cualquier cambio aquí debería pasar por diff.

-- ---------------------------------------------------------------------------------------------
-- RLS activada en todas las tablas
-- ---------------------------------------------------------------------------------------------

alter table public.ecos_songs             enable row level security;
alter table public.ecos_games             enable row level security;
alter table public.ecos_profiles          enable row level security;
alter table public.ecos_guesses           enable row level security;
alter table public.ecos_scores            enable row level security;
alter table public.ecos_leaderboard       enable row level security;
alter table public.ecos_reports           enable row level security;
alter table public.ecos_feedback          enable row level security;
alter table public.ecos_push_subscriptions enable row level security;
alter table public.ecos_spotify_playlists enable row level security;
alter table public.ecos_system_logs       enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Catálogo y calendario: lectura pública
--
-- Que ecos_songs sea legible por cualquiera es deliberado, pero es también la razón de que el
-- payload de un reto sin resolver tenga que censurarse en el servidor: quien quiera hacer trampas
-- no necesita adivinar la canción, le basta con leer la tabla. Ver src/lib/queries/games.ts.
-- ---------------------------------------------------------------------------------------------

create policy ecos_songs_read on public.ecos_songs
  for select to public using (true);

create policy ecos_games_read on public.ecos_games
  for select to public using (true);

create policy ecos_spotify_playlists_read on public.ecos_spotify_playlists
  for select to public using (true);

-- ---------------------------------------------------------------------------------------------
-- Perfiles
--
-- El UPDATE no restringe columnas, así que lo único que impide que un usuario se ponga
-- role='admin' son los privilegios de columna de más abajo. Si algún día se reconceden a lo
-- bruto (`grant update on ecos_profiles`), la escalada vuelve. Ver migración
-- ecos_profiles_restrict_role_column_update.
-- ---------------------------------------------------------------------------------------------

create policy ecos_profiles_read on public.ecos_profiles
  for select to public using (true);

create policy ecos_profiles_own_insert on public.ecos_profiles
  for insert to authenticated with check (auth.uid() = user_id);

create policy ecos_profiles_own_write on public.ecos_profiles
  for update to public using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------------------------
-- Partida: cada usuario solo ve lo suyo
--
-- ecos_scores no tiene política de lectura global a propósito: el ranking no lee la tabla
-- directamente, va por las funciones SECURITY DEFINER de get_leaderboard_*.
-- ---------------------------------------------------------------------------------------------

create policy ecos_guesses_own_read on public.ecos_guesses
  for select to public using (auth.uid() = user_id);

create policy ecos_guesses_own_insert on public.ecos_guesses
  for insert to public with check (auth.uid() = user_id);

create policy ecos_scores_own_read on public.ecos_scores
  for select to public using (auth.uid() = user_id);

create policy ecos_leaderboard_read on public.ecos_leaderboard
  for select to public using (true);

-- ---------------------------------------------------------------------------------------------
-- Suscripciones push: propias
-- ---------------------------------------------------------------------------------------------

create policy ecos_push_subscriptions_own_select on public.ecos_push_subscriptions
  for select to public using (auth.uid() = user_id);

create policy ecos_push_subscriptions_own_insert on public.ecos_push_subscriptions
  for insert to public with check (auth.uid() = user_id);

create policy ecos_push_subscriptions_own_update on public.ecos_push_subscriptions
  for update to public using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy ecos_push_subscriptions_own_delete on public.ecos_push_subscriptions
  for delete to public using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------------------------
-- Reportes: se pueden crear, no leer
-- ---------------------------------------------------------------------------------------------

create policy authenticated_insert_own_report on public.ecos_reports
  for insert to authenticated with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------------------------
-- Sin políticas, a propósito: ecos_feedback y ecos_system_logs
--
-- RLS activada y ninguna política significa denegar todo salvo al service role, que se la salta.
-- Es el modelo correcto para tablas que solo usa el panel de admin.
--
-- ecos_feedback tenía hasta el 2026-08-24 una política llamada "Service role can do all" que
-- estaba declarada TO public con using(true). El service role ya se salta la RLS, así que esa
-- política no le aportaba nada: lo único que hacía era dejar que cualquiera con la anon key
-- leyera todo el feedback (columna email incluida), lo alterara o lo vaciara. Se borró junto con
-- los privilegios de anon/authenticated. No reintroducir: si algo necesita acceso, va por service
-- role desde una route handler.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- Privilegios
--
-- Supabase concede por defecto todo el DML a anon y authenticated en las tablas de `public`, así
-- que aquí solo aparece lo que se ha recortado. La RLS es la primera línea; estos revokes son la
-- segunda, para no depender de que la política esté bien escrita.
-- ---------------------------------------------------------------------------------------------

-- ecos_profiles: sin UPDATE de tabla, que arrastraría la columna `role`. Solo las columnas que
-- escribe la app con el cliente del propio usuario (api/profile y api/push/status).
revoke update on public.ecos_profiles from anon, authenticated;
grant update (
  user_id,
  username,
  avatar_url,
  show_avatar_in_rankings,
  updated_at,
  notifications_modal_dismiss_count
) on public.ecos_profiles to authenticated;

-- ecos_feedback: solo service role.
revoke all on public.ecos_feedback from anon, authenticated;
