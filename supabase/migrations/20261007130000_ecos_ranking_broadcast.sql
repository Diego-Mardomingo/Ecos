-- Ranking en tiempo real por Supabase Realtime Broadcast (auditoría oct. 2026, D7 / PERFDB-09).
--
-- Antes: el hook del ranking escuchaba `postgres_changes` de ecos_scores y ecos_leaderboard, pero
-- la publicación `supabase_realtime` no tiene ninguna tabla (nunca recibía nada), la RLS de
-- ecos_scores solo deja leer filas propias, y aun así la suscripción mantenía el sondeo del WAL
-- (la consulta n.º 1 de la base de datos, compartida con otra aplicación).
--
-- Ahora: el servidor emite un mensaje Broadcast al cerrar una partida (POST a
-- /realtime/v1/api/broadcast con la service role, canal privado `ecos:ranking`, sin datos en el
-- mensaje) y el navegador, en /ranking, escucha ese canal. No se publica ninguna tabla.
--
-- Esta política es lo único que hace falta en la base de datos: deja que cualquiera (también sin
-- sesión: el ranking es público) se suscriba al canal. No hay política de INSERT, así que ningún
-- cliente puede emitir en él; la service role se salta la RLS. `realtime.messages` es de la
-- plataforma y hoy no tiene ninguna política: esta solo casa con el tema `ecos:ranking`.

drop policy if exists ecos_ranking_broadcast_receive on realtime.messages;

create policy ecos_ranking_broadcast_receive
  on realtime.messages
  for select
  to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'ecos:ranking'
  );
