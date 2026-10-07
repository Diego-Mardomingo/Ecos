# Migraciones

No es la historia completa ni la fuente de verdad. La base de datos real (compartida con otra
aplicación) tiene muchas más migraciones aplicadas por MCP de las que hay aquí; el estado vigente
del esquema de Ecos está en `supabase/schema/`.

- Las tres de marzo de 2026 (`20260328120000`, `20260328200000`, `20260329140000`) crearon los RPC
  de ranking, pero **están desfasadas** (CURRENT_DATE/UTC, sin `show_avatar_in_rankings`) y **no se
  deben reaplicar**. La definición viva está en `supabase/schema/04_leaderboard.sql`.
- Las de octubre de 2026 sí son las que se aplicaron tal cual y se versionan aquí como registro de
  cada cambio (`20261008130000_d12_borrar_columnas_muertas.sql` es la excepción: se aplica a mano,
  después de desplegar).
