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

-- ecos_games, en cambio, solo hasta hoy en Madrid. Hasta oct. 2026 era using(true) y el reto de
-- mañana (que el selector crea con dos días de antelación) se leía entero por REST con la anon
-- key: `ecos_games?date=gt.<hoy>&select=ecos_songs(title,preview_url)`. Las RPC de ranking son
-- SECURITY DEFINER y el admin usa service role, así que no les afecta.
create policy ecos_games_read on public.ecos_games
  for select to public
  using (date <= (now() at time zone 'Europe/Madrid')::date);

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

-- Lectura: solo la fila propia, y anon nada (ver el revoke de select más abajo). Hasta oct. 2026
-- era using(true) para public: cualquiera leía el nombre real de Google y el `role` de todos.
-- Toda lectura con el cliente de cookies es de la propia fila (proxy, requireAdmin, profile/*,
-- api/profile, api/push/status); el ranking va por las RPC SECURITY DEFINER. La comprobación de
-- username ocupado de api/profile ya no ve filas ajenas: la cubre ecos_profiles_username_key.
create policy ecos_profiles_own_read on public.ecos_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

create policy ecos_profiles_own_insert on public.ecos_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy ecos_profiles_own_write on public.ecos_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------------
-- Partida: cada usuario solo ve lo suyo
--
-- ecos_scores no tiene política de lectura global a propósito: el ranking no lee la tabla
-- directamente, va por las funciones SECURITY DEFINER de get_leaderboard_*.
-- ---------------------------------------------------------------------------------------------

-- Todas las políticas con auth.uid() lo envuelven en (select ...) para que Postgres lo evalúe una
-- vez por consulta y no por fila (PERFDB-11). Misma semántica.
create policy ecos_guesses_own_read on public.ecos_guesses
  for select to public using ((select auth.uid()) = user_id);

-- Sin política de INSERT, a propósito. Hasta oct. 2026 existía ecos_guesses_own_insert (to
-- public, auth.uid() = user_id): cualquiera con sesión podía insertar por REST un intento propio
-- con correct = true, y el servidor cierra la partida con lo que hay en ecos_guesses
-- (finalizeFromStoredGuesses, repairOrphanScoreIfNeeded), así que daba la puntuación máxima sin
-- acertar. Los intentos solo los escribe el servidor con service role. No reintroducir.
-- Migración: supabase/migrations/20261008140000_recortar_privilegios_tablas.sql

create policy ecos_scores_own_read on public.ecos_scores
  for select to public using ((select auth.uid()) = user_id);

create policy ecos_leaderboard_read on public.ecos_leaderboard
  for select to public using (true);

-- ---------------------------------------------------------------------------------------------
-- Suscripciones push: propias
-- ---------------------------------------------------------------------------------------------

create policy ecos_push_subscriptions_own_select on public.ecos_push_subscriptions
  for select to public using ((select auth.uid()) = user_id);

create policy ecos_push_subscriptions_own_insert on public.ecos_push_subscriptions
  for insert to public with check ((select auth.uid()) = user_id);

create policy ecos_push_subscriptions_own_update on public.ecos_push_subscriptions
  for update to public
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy ecos_push_subscriptions_own_delete on public.ecos_push_subscriptions
  for delete to public using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------------
-- Reportes: se pueden crear, no leer
-- ---------------------------------------------------------------------------------------------

create policy authenticated_insert_own_report on public.ecos_reports
  for insert to authenticated with check ((select auth.uid()) = user_id);

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
-- Supabase concede por defecto todo el DML (más TRUNCATE, REFERENCES y TRIGGER) a anon y
-- authenticated en las tablas de `public`, así que aquí solo aparece lo que se ha recortado. La
-- RLS es la primera línea; estos revokes son la segunda, para no depender de que la política esté
-- bien escrita. TRUNCATE ni siquiera pasa por la RLS.
--
-- Desde oct. 2026 (migración 20261008140000_recortar_privilegios_tablas) los clientes solo
-- conservan, además de SELECT, lo que la app escribe con el cliente de cookies:
--   * ecos_profiles           INSERT/UPDATE por columna (abajo).
--   * ecos_push_subscriptions INSERT, UPDATE y DELETE, solo authenticated.
--   * ecos_reports            INSERT, solo authenticated.
-- Lo demás lo escribe la service role. Una tabla ecos_* nueva nace con todo concedido: recórtala
-- aquí igual.
-- ---------------------------------------------------------------------------------------------

revoke truncate, references, trigger on
  public.ecos_songs,
  public.ecos_games,
  public.ecos_profiles,
  public.ecos_guesses,
  public.ecos_scores,
  public.ecos_leaderboard,
  public.ecos_reports,
  public.ecos_push_subscriptions,
  public.ecos_spotify_playlists,
  public.ecos_system_logs
from anon, authenticated;

revoke insert, update, delete on
  public.ecos_songs,
  public.ecos_games,
  public.ecos_guesses,
  public.ecos_scores,
  public.ecos_leaderboard,
  public.ecos_spotify_playlists,
  public.ecos_system_logs
from anon, authenticated;

revoke insert, update, delete on public.ecos_reports from anon;
revoke update, delete on public.ecos_reports from authenticated;

revoke insert, update, delete on public.ecos_push_subscriptions from anon;

-- ecos_profiles: sin INSERT ni UPDATE de tabla, que arrastrarían la columna `role`. Solo las
-- columnas que escribe la app con el cliente del propio usuario (api/profile y api/push/status).
--
-- El parche de agosto recortó solo UPDATE; el INSERT siguió incluyendo `role` hasta octubre de
-- 2026, así que una cuenta sin fila de perfil podía insertarse role = 'admin'. Los dos van juntos.
revoke select on public.ecos_profiles from anon;
revoke delete on public.ecos_profiles from anon, authenticated;
revoke insert on public.ecos_profiles from anon, authenticated;
grant insert (
  user_id,
  username,
  avatar_url,
  show_avatar_in_rankings,
  updated_at
) on public.ecos_profiles to authenticated;

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

-- ---------------------------------------------------------------------------------------------
-- Privilegios de funciones
--
-- Postgres concede EXECUTE a PUBLIC al crear una función, y anon/authenticated lo heredan aunque
-- no aparezcan en el ACL. Revocar solo a anon y authenticated no basta: hay que incluir PUBLIC.
--
-- Incidente (oct. 2026): estas funciones son SECURITY DEFINER y no comprueban auth.uid(), así que
-- cualquiera con la anon key podía llamar a /rest/v1/rpc/... y escribir la puntuación de cualquier
-- usuario con los puntos que quisiera, saltándose validate-guess entero. La app solo las llama
-- con service_role (validate-guess, skip-attempt, game-progress). Ningún cliente de navegador
-- debe poder ejecutarlas.
--
-- Las RPC de lectura del ranking y la búsqueda (get_leaderboard_by_period,
-- get_leaderboard_period_summaries, ecos_search_songs) siguen abiertas a propósito: se llaman con
-- el cliente de cookies, también sin sesión.
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.ecos_guess_and_finalize_score(
  uuid, uuid, integer, text, boolean, boolean, boolean, integer, integer, boolean, integer, boolean
) from public, anon, authenticated;
revoke execute on function public.ecos_finalize_game_score(
  uuid, uuid, integer, integer, boolean, boolean, integer, boolean
) from public, anon, authenticated;
revoke execute on function public.ecos_update_leaderboard(uuid, integer, boolean, integer, boolean)
  from public, anon, authenticated;

-- Solo trigger (on auth.users): nadie la llama por la API. Un trigger no comprueba EXECUTE al
-- dispararse, así que el alta de usuarios no se ve afectada.
revoke execute on function public.ecos_handle_new_user() from public, anon, authenticated;

-- run_daily_game_selector_at_midnight_spain() y los jobs de pg_cron 3 y 6 se borraron el
-- 2026-10-08 (migración 20261008120000_bd2_rendimiento_y_limpieza): daily-game.yml ya hace ese
-- trabajo. Tampoco existe la sobrecarga de 4 argumentos de ecos_update_leaderboard.

-- Estadísticas personales: solo con sesión, y cada función comprueba dentro que p_user_id sea
-- auth.uid() (si no, devuelve vacío / 0). Hasta oct. 2026 cualquiera con la anon key leía las
-- de cualquier usuario. Todos los usos piden las del propio user.id (lib/queries/users.ts).
revoke execute on function public.get_user_ranking_stats(uuid) from public, anon;
revoke execute on function public.get_user_avg_guesses(uuid) from public, anon;
grant execute on function public.get_user_ranking_stats(uuid) to authenticated, service_role;
grant execute on function public.get_user_avg_guesses(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Realtime: aviso de «el ranking ha cambiado» (D7, oct. 2026)
--
-- El servidor emite por Broadcast (canal privado `ecos:ranking`, sin datos) al cerrarse una
-- partida, y /ranking escucha ese canal. No se publica ninguna tabla en `supabase_realtime`: la RLS
-- de ecos_scores es propia y publicar ecos_leaderboard emitiría N eventos por partida y mantendría
-- el sondeo del WAL. Ver src/lib/realtime/ranking-channel.ts.
--
-- Solo SELECT para anon/authenticated y solo en ese tema: nadie, salvo la service role del
-- servidor, puede emitir. `realtime.messages` es de la plataforma; no tocar nada más de ella.
-- Migración: supabase/migrations/20261007130000_ecos_ranking_broadcast.sql
-- ---------------------------------------------------------------------------------------------

create policy ecos_ranking_broadcast_receive
  on realtime.messages
  for select
  to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'ecos:ranking'
  );

-- ---------------------------------------------------------------------------------------------
-- Storage: bucket `avatars` (DOC-17)
--
-- Fotos de perfil. Las sube el propio navegador con el cliente de cookies (EditProfileClient.tsx),
-- siempre a `<user_id>/avatar.<ext>` y con `upsert: true`, de ahí que haga falta INSERT y UPDATE.
-- Creado con las migraciones de Supabase `create_avatars_bucket` y `avatars_storage_policies`; se
-- versiona aquí porque `storage` es un esquema de la plataforma y el volcado del resto no lo cubre.
--
-- Bucket público: las imágenes se sirven por URL pública, sin pasar por la RLS. La política de
-- lectura de abajo solo afecta a listar/descargar por la API de Storage.
-- Límites que impone el servidor: 2 MiB y jpeg/png/webp (el cliente los comprueba antes también).
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Escritura: solo dentro de la carpeta del propio usuario (`<auth.uid()>/…`).
create policy "Users can upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "Users can update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "Public read avatars" on storage.objects
  for select to public
  using (bucket_id = 'avatars');

-- No hay política de DELETE: un usuario no puede borrar su foto, solo sustituirla. Si cambia de
-- formato (png -> webp) la anterior queda huérfana en el bucket. Conocido y aceptado; a revisar
-- si algún día se añade «quitar foto».
