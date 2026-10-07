# Migraciones

Registro de lo que se ha aplicado a la base de datos, no su historia completa ni su fuente de verdad.
La base real (compartida con otra aplicación) tiene muchas más migraciones aplicadas por MCP de las
que hay aquí, y el estado vigente del esquema de Ecos está en `supabase/schema/`. Si una migración y
el esquema discrepan, manda el esquema (y, sobre él, la BD).

- Las tres de marzo de 2026 (`20260328120000`, `20260328200000`, `20260329140000`) crearon los RPC
  de ranking, pero **están desfasadas** (CURRENT_DATE/UTC, sin `show_avatar_in_rankings`) y **no se
  deben reaplicar**. La definición viva está en `supabase/schema/04_leaderboard.sql`.
- Las de octubre de 2026 son la auditoría. Salvo lo pendiente de abajo, se aplicaron en producción
  y su SQL es el que corrió; las que se aplicaron con retoques o en varias partes lo dicen en la
  cabecera (`ESTADO`).
- Al aplicar una migración nueva, apunta en su cabecera cuándo y con qué nombre se aplicó, y refleja el
  resultado en `supabase/schema/` en el mismo commit.

## Pendiente de aplicar a mano, después de desplegar

Son destructivas o dependen de que el código nuevo esté en producción. Aplicarlas antes rompe la
versión desplegada. Cuando se apliquen, actualiza la cabecera de la migración, quita la sección
«Desfase conocido» de `supabase/schema/README.md` y borra este apartado.

- `20261008130000_d12_borrar_columnas_muertas.sql` (D12): borra seis columnas de `ecos_songs`
  (`tempo`, `danceability`, `energy`, `popularity`, `genre`, `raw_spotify_data`). Hay que esperar a
  que estén en producción el código de la app que ya no las lee y los scripts nuevos de `master`
  (`daily-game.yml` ejecuta `select-daily-game.py` desde `master`).
- Segunda parte de `20261008140000_recortar_privilegios_tablas.sql`, ya anotada en su cabecera: el
  resto se aplicó, pero falta `revoke insert on public.ecos_guesses from authenticated` y
  `drop policy if exists ecos_guesses_own_insert on public.ecos_guesses`, que solo se pueden aplicar
  cuando el código nuevo (que salta con service role) esté desplegado.
