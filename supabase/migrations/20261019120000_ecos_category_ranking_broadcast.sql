-- Ranking de categorías en tiempo real por Supabase Realtime Broadcast.
--
-- Mismo mecanismo que el ranking diario (20261007130000_ecos_ranking_broadcast.sql): al terminar
-- una partida de categoría con puntos, el servidor emite un mensaje sin datos (POST a
-- /realtime/v1/api/broadcast con la service role) y el navegador que tenga abierta la clasificación
-- de esa categoría vuelve a pedirla. No se publica ninguna tabla.
--
-- Un canal privado por categoría, `ecos:category-ranking:<slug>`, para que cada aviso solo llegue a
-- quien mira esa categoría. Solo SELECT para anon/authenticated (la clasificación es pública) y
-- solo en esos temas; sin política de INSERT, ningún cliente puede emitir.

drop policy if exists ecos_category_ranking_broadcast_receive on realtime.messages;

create policy ecos_category_ranking_broadcast_receive
  on realtime.messages
  for select
  to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'ecos:category-ranking:%'
  );
