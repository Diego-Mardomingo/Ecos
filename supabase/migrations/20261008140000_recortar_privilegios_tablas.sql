-- ============================================================================================
-- ESTADO (2026-10-08): APLICADA EN DOS PARTES.
--  - Ya aplicado en producción como `ecos_cerrar_insercion_de_aciertos_y_recortar_privilegios`:
--    todo lo de abajo SALVO el `revoke insert` de ecos_guesses a authenticated y el
--    `drop policy ecos_guesses_own_insert`. En su lugar, la política se limitó a filas de salto
--    (guess_text = 'skipped' y todo a false), porque el código desplegado entonces aún registraba
--    los saltos con el cliente de cookies.
--  - Segunda parte APLICADA el 2026-10-08 tras desplegar (migración ecos_guesses_sin_insert_de_clientes):
--      revoke insert on public.ecos_guesses from authenticated;
--      drop policy if exists ecos_guesses_own_insert on public.ecos_guesses;
-- ============================================================================================
-- ============================================================================================
-- Recorte de privilegios de tabla de anon y authenticated en las tablas ecos_* (LIMP-1).
--
-- Supabase concede por defecto todo el DML (y TRUNCATE, REFERENCES y TRIGGER) a anon y
-- authenticated en cada tabla nueva de `public`. Hasta ahora solo se habían recortado
-- ecos_profiles y ecos_feedback; el resto dependía únicamente de la RLS. Esta migración deja a
-- cada rol lo que la app usa de verdad con el cliente de cookies (o lo que una política declara)
-- y nada más. La service role no se toca: se salta la RLS y los scripts y el panel de admin la
-- usan para todo lo demás.
--
-- Estado de partida (information_schema.table_privileges, 2026-10-08): anon y authenticated con
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE y UPDATE en todas las ecos_* salvo
-- ecos_profiles (DELETE, REFERENCES, TRIGGER, TRUNCATE; más SELECT para authenticated y los
-- INSERT/UPDATE por columna de 03_security.sql) y ecos_feedback (nada).
--
-- Escrituras con el cliente de cookies (rol authenticated), lo único que hay que conservar:
--   * ecos_profiles           INSERT/UPDATE por columna (api/profile, api/push/status). Ya estaba.
--   * ecos_push_subscriptions INSERT/UPDATE (api/push/subscribe, api/push/unsubscribe) y DELETE
--                             (hay política propia de borrado; se conserva).
--   * ecos_reports            INSERT (api/report; política authenticated_insert_own_report).
-- Todo lo demás (partidas, puntuaciones, ranking, catálogo, playlists, logs) lo escribe la service
-- role: validate-guess/skip-attempt/game-progress, los scripts de cron y las acciones de admin.
--
-- SELECT no se toca: las lecturas las acota la RLS y varias son públicas a propósito.
--
-- ecos_guesses: además del privilegio se borra la política ecos_guesses_own_insert. Con ella, un
-- usuario podía insertar por REST (`POST /rest/v1/ecos_guesses`) una fila propia con
-- `correct = true` en el intento 1; la siguiente jugada o el GET de /api/game-progress cierran
-- la partida «con lo que hay en ecos_guesses» (finalizeFromStoredGuesses /
-- repairOrphanScoreIfNeeded) y le dan la puntuación máxima sin haber acertado. Los intentos solo
-- los escribe el servidor con service role (ecos-finalize-helpers.ts).
--
-- TRUNCATE no pasa por la RLS: es lo primero que no debe tener nadie más que el dueño.
--
-- Las tablas que se creen en el futuro vuelven a nacer con todo concedido (default privileges de
-- Supabase): hay que recortarlas a mano igual que estas.
-- ============================================================================================

-- Nadie fuera del servidor necesita TRUNCATE, REFERENCES ni TRIGGER en ninguna tabla de Ecos.
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

-- Solo lectura (o nada) para los clientes: lo escribe la service role.
revoke insert, update, delete on
  public.ecos_songs,
  public.ecos_games,
  public.ecos_guesses,
  public.ecos_scores,
  public.ecos_leaderboard,
  public.ecos_spotify_playlists,
  public.ecos_system_logs
from anon, authenticated;

-- ecos_guesses: la política de inserción propia ya no tiene ningún uso legítimo (ver arriba).
drop policy if exists ecos_guesses_own_insert on public.ecos_guesses;

-- ecos_profiles: nadie borra perfiles desde el cliente (no hay política de DELETE).
revoke delete on public.ecos_profiles from anon, authenticated;

-- ecos_reports: se crean con sesión y no se leen, cambian ni borran desde el cliente.
revoke insert, update, delete on public.ecos_reports from anon;
revoke update, delete on public.ecos_reports from authenticated;

-- ecos_push_subscriptions: solo con sesión (las políticas exigen auth.uid() = user_id).
revoke insert, update, delete on public.ecos_push_subscriptions from anon;
