# Esquema de Ecos

Instantánea del esquema real del proyecto de Supabase (`hrpwtsnsxnogjpsxslwi`), volcada el
2026-08-24. **No es una migración**: es el estado actual, para poder leerlo, revisarlo en un diff
y reconstruirlo si hace falta.

| Fichero | Qué hay |
|---|---|
| `01_tables.sql` | Tablas, constraints, índices y triggers |
| `02_functions.sql` | Funciones `ecos_*` y `get_user_avg_guesses` |
| `03_security.sql` | RLS, políticas y privilegios |

## Por qué está en git

El esquema es **estructura, no secretos**: saber que `ecos_profiles` tiene una columna `role` no
sirve de nada a quien no pueda saltarse la RLS. Y sin versionar, una política mal puesta no
aparece en ningún diff, no la detecta el typecheck y no pasa por revisión.

Eso no es teórico. El 2026-08-24 se cerraron dos agujeros que llevaban meses abiertos y que se
encontraron en cuanto se pudieron *leer* las políticas:

- Cualquier usuario con cuenta podía ponerse `role = 'admin'` en su propio perfil.
- Cualquiera con la anon key podía leer, alterar o vaciar `ecos_feedback`.

Los dos habrían salido en la primera revisión de un `03_security.sql`.

## Qué NO está aquí, y por qué

- **Las tablas `hubgames_*`.** La base de datos se comparte con otra aplicación. No son de este
  proyecto.
- **`is_admin`, `handle_new_user`, `run_judi_daily_notification`.** Pese al nombre genérico, son de
  la otra aplicación. Cuidado con `is_admin()`: consulta `hubgames_usuarios.administrador` y **no
  sirve para Ecos**, cuyo rol vive en `ecos_profiles.role`.
- **`get_leaderboard_by_period`, `get_leaderboard_period_summaries`, `get_user_ranking_stats`.**
  Ya están en `supabase/migrations/`, que es su historia real. Duplicarlas crearía dos versiones
  desincronizables.
- **Los jobs de `pg_cron`.** Sus definiciones llevan un JWT incrustado. Aunque sea la anon key, que
  es pública por diseño, no se meten tokens en el repo. Los dos que apuntaban al selector diario
  (`jobid` 3 y 6) están **desactivados** desde el 2026-08-24: duplicaban lo que ya hace
  `.github/workflows/daily-game.yml`.
- **Los triggers sobre `auth.users`.** Ese esquema es de Supabase; el trigger que llama a
  `ecos_handle_new_user()` no se puede versionar desde aquí.
- **Datos.** Solo estructura.

## Cómo regenerarlo

No hay script: se hizo con consultas a través del MCP de Supabase. Las fuentes, por si hay que
repetirlo:

- Tablas y columnas → `pg_class` + `pg_attribute` + `pg_attrdef`
- Constraints → `pg_get_constraintdef(oid)`
- Índices → `pg_indexes` (descartando los que ya crea una constraint)
- Triggers → `pg_get_triggerdef(oid)`
- Funciones → `pg_get_functiondef(oid)`
- Políticas → `pg_policies`
- Privilegios → `information_schema.table_privileges` y `column_privileges`

Merece la pena automatizarlo si esto se va a mantener; mientras no lo esté, **el proyecto real
sigue siendo la fuente de verdad y este directorio puede quedarse atrás**. Al cambiar algo en la
base de datos, actualizar el fichero que toque en el mismo commit.

## Verificar que sigue al día

```sql
-- Políticas que no estén en 03_security.sql
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies where schemaname = 'public' and tablename like 'ecos\_%'
order by tablename, cmd;

-- Privilegios de anon/authenticated (deberían coincidir con los revokes documentados)
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.table_privileges
where table_schema = 'public' and table_name like 'ecos\_%'
  and grantee in ('anon','authenticated')
group by table_name, grantee order by table_name, grantee;
```
