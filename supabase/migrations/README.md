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

## Aplicadas tras desplegar

El 2026-10-08, después de desplegar la auditoría, se aplicaron a mano las dos que dependían del
código nuevo: `20261008130000_d12_borrar_columnas_muertas.sql` y la segunda parte de
`20261008140000_recortar_privilegios_tablas.sql` (sin `INSERT` de clientes en `ecos_guesses`).
Si una migración futura depende de un despliegue, márcala igual en su cabecera y anótala aquí.
