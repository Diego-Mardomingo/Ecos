/**
 * Canal de Supabase Realtime (Broadcast) que avisa de que el ranking ha cambiado.
 *
 * Lo comparten el servidor, que emite al cerrarse una partida (`broadcast-ranking.ts`), y el
 * cliente, que escucha en `/ranking` (`useLeaderboardRealtime.ts`). Va en su propio módulo, sin
 * imports de servidor ni de navegador, para que ambos lados lo puedan importar.
 *
 * Por qué Broadcast y no `postgres_changes` (D7, PERFDB-09 / COST-05):
 * - `ecos_scores` tiene RLS `auth.uid() = user_id`: Realtime solo entrega a cada cliente las filas
 *   que puede leer, así que nadie recibiría las puntuaciones de los demás.
 * - Publicar `ecos_leaderboard` sí llegaría a todos (su lectura es pública), pero cada cierre de
 *   partida reescribe todas sus filas para mantener `global_rank` (PERFDB-08): N eventos por
 *   partida. Además obliga a Realtime a sondear el WAL, que ya es la consulta n.º 1 de la base de
 *   datos, compartida con otra aplicación.
 * - Broadcast es un único mensaje por partida, sin leer el WAL ni evaluar RLS por espectador, y no
 *   lleva datos: solo «ha cambiado algo». El cliente vuelve a pedir el ranking por la ruta de
 *   siempre.
 *
 * El canal es **privado**: solo el servidor (service role) puede emitir y solo se puede escuchar
 * con una política de `realtime.messages` (ver `supabase/migrations/20261007130000_*`).
 */

/** Tema del canal. Tiene que coincidir con el de la política RLS de `realtime.messages`. */
export const RANKING_BROADCAST_TOPIC = "ecos:ranking";

/** Evento: una partida se ha cerrado y la clasificación puede haber cambiado. */
export const RANKING_BROADCAST_EVENT = "scores-changed";
