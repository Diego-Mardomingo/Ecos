# Esquema de Ecos

Instantánea del esquema real del proyecto de Supabase (`hrpwtsnsxnogjpsxslwi`), volcada el
2026-08-24 y puesta al día el 2026-10-08 (tras BD-1 y BD-2). **No es una migración**: es el estado
actual, para poder leerlo, revisarlo en un diff y reconstruirlo si hace falta.

**Este directorio es el esquema vivo; `supabase/migrations/` no.** Allí hay migraciones sueltas que
se copiaron al repo al aplicarlas, pero la base de datos tiene decenas aplicadas por MCP (también de la otra aplicación) y solo unas
pocas están copiadas. Las tres de marzo de 2026 (RPC de ranking) están **desfasadas** respecto a lo
que corre en producción y no se deben reaplicar: ver `04_leaderboard.sql`. El proyecto real sigue
siendo la fuente de verdad.

| Fichero | Qué hay |
|---|---|
| `01_tables.sql` | Tablas, constraints, índices y triggers |
| `02_functions.sql` | Funciones `ecos_*` y `get_user_avg_guesses` |
| `03_security.sql` | RLS, políticas y privilegios, incluidos Realtime y Storage (bucket `avatars`) |
| `04_leaderboard.sql` | RPC de ranking: `get_leaderboard_by_period`, `get_leaderboard_period_summaries`, `get_user_ranking_stats` |

## Por qué está en git

El esquema es **estructura, no secretos**: saber que `ecos_profiles` tiene una columna `role` no
sirve de nada a quien no pueda saltarse la RLS. Y sin versionar, una política mal puesta no
aparece en ningún diff, no la detecta el typecheck y no pasa por revisión.

Eso no es teórico. El 2026-08-24 se cerraron dos agujeros que llevaban meses abiertos y que se
encontraron en cuanto se pudieron *leer* las políticas:

- Cualquier usuario con cuenta podía ponerse `role = 'admin'` en su propio perfil.
- Cualquiera con la anon key podía leer, alterar o vaciar `ecos_feedback`.

Los dos habrían salido en la primera revisión de un `03_security.sql`. Y la auditoría de octubre de
2026 encontró más del mismo tipo: RPC de puntuación ejecutables por cualquiera (el `EXECUTE` de una
función nace concedido a `PUBLIC`), `INSERT` de perfiles con `role`, perfiles y reto de mañana
legibles con la anon key, estadísticas de cualquier usuario.

**Una tabla `ecos_*` nueva nace con todo concedido**: Supabase da todo el DML (y `TRUNCATE`) a `anon`
y `authenticated` en cada tabla de `public`. Recórtala a mano en `03_security.sql` en el mismo
commit que la crea; la RLS sola no basta (`TRUNCATE` ni siquiera pasa por ella).

## Qué NO está aquí, y por qué

- **Las tablas `hubgames_*`.** La base de datos se comparte con otra aplicación. No son de este
  proyecto.
- **`is_admin`, `handle_new_user`, `run_judi_daily_notification`.** Pese al nombre genérico, son de
  la otra aplicación. Cuidado con `is_admin()`: consulta `hubgames_usuarios.administrador` y **no
  sirve para Ecos**, cuyo rol vive en `ecos_profiles.role`.
- **Los jobs de `pg_cron`.** Sus definiciones llevan un JWT incrustado. Aunque sea la anon key, que
  es pública por diseño, no se meten tokens en el repo. Los dos que apuntaban al selector diario
  (`jobid` 3 y 6) estuvieron desactivados desde el 2026-08-24 y se **borraron** el 2026-10-08 junto
  con la función `run_daily_game_selector_at_midnight_spain()` (BD-2): duplicaban lo que ya hace
  `.github/workflows/daily-game.yml`. El job 2 (`judi-*`) es de la otra aplicación.
- **Los triggers sobre `auth.users`.** Ese esquema es de Supabase; el trigger que llama a
  `ecos_handle_new_user()` no se puede versionar desde aquí.
- **Datos.** Solo estructura. Salvo la fila del bucket `avatars` de Storage (ver abajo).

## Storage y Realtime

Ambos esquemas son de la plataforma, pero Ecos pone ahí piezas propias y la seguridad de las dos
depende de políticas que, si no se versionan, no salen en ningún diff. Están al final de
`03_security.sql`:

- **Storage, bucket `avatars`** (público, 2 MiB, `image/jpeg|png|webp`). Tres políticas sobre
  `storage.objects`: lectura pública del bucket, y INSERT/UPDATE solo en la carpeta del propio
  usuario (`<auth.uid()>/…`). No hay DELETE a propósito. Lo usa `EditProfileClient.tsx`.
- **Realtime, `realtime.messages`**: la política `ecos_ranking_broadcast_receive`, que deja a
  anon/authenticated recibir solo el canal `ecos:ranking` (aviso de «el ranking ha cambiado»).
  Nada puede emitir salvo la service role.

## Desfase conocido

Dos cosas del volcado van por delante o por detrás de la BD hasta que se aplique lo que queda
pendiente en `supabase/migrations/` (su README lo detalla, y la cabecera `ESTADO` de cada migración
manda):

- `ecos_guesses`: `03_security.sql` ya no tiene política ni privilegio de `INSERT`; la BD conserva
  `ecos_guesses_own_insert`, limitada a filas de salto, hasta desplegar el código que salta con
  service role.
- `ecos_songs`: `01_tables.sql` sigue con `genre`, `popularity`, `tempo`, `danceability`, `energy` y
  `raw_spotify_data`, que siguen en la BD hasta aplicar `20261008130000_d12_borrar_columnas_muertas.sql`
  tras desplegar. Al aplicarla, se quitan del volcado en el mismo commit.

Cuando se apliquen, borra esta sección.

## Cómo regenerarlo

No hay script: se hizo con consultas a través del MCP de Supabase. Las fuentes, por si hay que
repetirlo:

- Tablas y columnas → `pg_class` + `pg_attribute` + `pg_attrdef`
- Constraints → `pg_get_constraintdef(oid)`
- Índices → `pg_indexes` (descartando los que ya crea una constraint)
- Triggers → `pg_get_triggerdef(oid)`
- Funciones → `pg_get_functiondef(oid)`
- Políticas → `pg_policies` (también `schemaname in ('storage','realtime')`)
- Storage → `storage.buckets`
- Privilegios → `information_schema.table_privileges` y `column_privileges`
- Privilegios de funciones → `pg_proc.proacl` (el EXECUTE de `PUBLIC` sale como `=X/...`)

Merece la pena automatizarlo si esto se va a mantener; mientras no lo esté, **el proyecto real
sigue siendo la fuente de verdad y este directorio puede quedarse atrás**. Al cambiar algo en la
base de datos, actualizar el fichero que toque en el mismo commit.

## Verificar que sigue al día

```sql
-- Políticas que no estén en 03_security.sql (las de Ecos en public, y las de Storage y Realtime)
select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename like 'ecos\_%')
   or (schemaname = 'storage' and tablename = 'objects')
   or (schemaname = 'realtime' and tablename = 'messages')
order by schemaname, tablename, cmd;

-- Bucket de Storage
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- Funciones de Ecos: la huella de la definición viva. Compara con el fichero versionado
-- (02_functions.sql y 04_leaderboard.sql): `md5` del texto desde `CREATE OR REPLACE` hasta
-- `$function$`, sin el `;` final y con salto de línea al terminar.
select proname, pg_get_function_identity_arguments(oid) as args, md5(pg_get_functiondef(oid))
from pg_proc
where pronamespace = 'public'::regnamespace
  and (proname like 'ecos\_%' or proname like 'get\_%')
order by 1;

-- Privilegios de anon/authenticated (deberían coincidir con los revokes documentados)
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.table_privileges
where table_schema = 'public' and table_name like 'ecos\_%'
  and grantee in ('anon','authenticated')
group by table_name, grantee order by table_name, grantee;

-- Funciones SECURITY DEFINER que anon o authenticated pueden ejecutar (incluye lo heredado de
-- PUBLIC). Solo deberían salir las RPC de lectura documentadas en 03_security.sql.
select p.oid::regprocedure as funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (p.proname like 'ecos\_%' or p.proname like 'get\_%' or p.proname like 'run\_daily%')
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by 1;
```
