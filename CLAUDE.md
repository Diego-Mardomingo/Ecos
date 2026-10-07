# CLAUDE.md

Ecos: reto musical diario (Next.js 16 + Supabase), casi todo desde el móvil. Vercel, región `fra1`:
`master` es producción; el resto, previews.

## Reglas de trabajo

- **Español** en comentarios, commits, logs y `messages/es.json`. El panel `/admin` va en español sin i18n, a propósito.
- **Nada no trivial directo a `master`**: rama `tipo/descripcion` antes del primer edit.
- **Commits y PRs sin coautoría ni firmas** (`Co-Authored-By: Claude`, `Generated with Claude Code`…). El historial ya se reescribió una vez para quitarlos.
- **Ajustes no son rediseño**: home, partida, ranking y perfil ya están rediseñados; toca solo lo pedido.
- **Nunca `taskkill /IM node.exe`** (tumba los MCP): para un servidor, por PID.
- **La BD es la de producción**: jugar autenticado puntúa de verdad. Prueba con días pasados; el de hoy, solo con permiso.

## Comandos

```bash
pnpm dev | pnpm build | pnpm typecheck | pnpm lint | pnpm ingest-weekly
```

`pnpm` obligatorio; no generes `package-lock.json`. React va fijado (19.3.0) en `dependencies` y en `pnpm.overrides`: súbelos a la vez. Secretos solo en `.env.local` (los scripts de Python lo leen con `common.load_env()`); para un build sin secretos, los valores ficticios de `ci.yml`.

**No hay tests y no se añaden.** `typecheck`, `lint` (a cero, avisos incluidos) y `build` deben quedar en verde, pero no ven bucles de render ni la lógica de partida: lo que toque `GameClient`, la caché de queries o la home se prueba en navegador, como invitado y autenticado.

`src/app/sw.ts` va fuera del tsconfig principal (su `no-default-lib` rompería la lib `dom` de todo el programa) y se comprueba con `tsconfig.worker.json`. No lo vuelvas a meter.

## El juego

Misma canción para todos, 6 intentos, fragmento creciente (`ATTEMPT_DURATIONS` en `gameStore.ts`); puntos en `scoring.ts`.

- **Regla de acierto única**: `src/lib/guess-match.ts`, compartida por servidor e invitado. No la repliques.
- **El servidor decide intento y puntos**: `submitAttempt` (`ecos-finalize-helpers.ts`) registra la jugada y cierra la partida cuando la jugada decide. `MAX_ATTEMPTS`, `SKIPPED_GUESS_TEXT` y `resolveServerAttempt` están en `server-attempt.ts`.
- **Reportes**: nunca desactivan canciones; a los 3 usuarios distintos dejan un aviso al admin.
- **Hora de Madrid**: el día de juego sale de `getEffectiveGameDate()` (`src/lib/date-utils.ts`), única fuente de verdad. Usa sus helpers, no `new Date()`. Hay días de 23 y 25 h. El ranking semanal y mensual solo cuenta una partida completada dentro del periodo de su día (SQL, `supabase/schema/04_leaderboard.sql`).
- **Juegos futuros**: existen hoy, mañana y pasado. Nada puede servir uno con `date > getEffectiveGameDate()`. Lo cubren la RLS de `ecos_games`, `loadPlayableGame` y `audio-proxy`; una ruta nueva con service role tiene que comprobarlo ella.

## Supabase

**BD compartida con otra app.** Lo de Ecos lleva prefijo `ecos_`. `hubgames_*`, `handle_new_user`, `run_judi_*` e **`is_admin()`** son ajenos. `is_admin()` no sirve para Ecos: el rol vive en `ecos_profiles.role` (`requireAdmin.ts`).

Mucha lógica está en RPC (finalización de partida, búsqueda sin acentos, ranking, estadísticas): mira si existe antes de replicarla en el cliente.

- **Esquema vivo en `supabase/schema/`**, una instantánea hecha a mano: la BD real manda. Si cambias la BD, actualiza ahí en el mismo commit.
- **`supabase/migrations/`** es un registro, no historia. Las de marzo no se reaplican. «NO APLICAR HASTA DESPLEGAR» o «PENDIENTE» marcan lo que se aplica a mano tras desplegar.
- Para operar, **MCP de Supabase** (`execute_sql`, `apply_migration`), project id `hrpwtsnsxnogjpsxslwi`.
- **PostgREST corta en 1.000 filas sin error**: lecturas sin filtro de tablas grandes con `fetch_all` (`scripts/db_paging.py`) o `fetchAllRows` (`src/lib/supabase/fetchAll.ts`).

**`03_security.sql` es el fichero más delicado**: varias escaladas de privilegios vivieron meses porque no se veían en ningún diff. Lo esencial:
- Toda tabla `ecos_*` nueva nace con todo el DML concedido a `anon` y `authenticated`: **recórtala a mano**. Los clientes solo escriben perfil (por columnas), suscripciones push y reportes; lo demás, la service role.
- El `EXECUTE` de una función nace concedido a `PUBLIC`: revocar solo a `anon`/`authenticated` no basta.
- `ecos_games` solo es legible hasta hoy; `ecos_profiles`, solo la fila propia; las estadísticas personales, solo para `auth.uid()`.

Clientes: `client.ts` (navegador), `createClient()` (cookies, respeta RLS), `createServiceClient()` (**sin RLS**: solo en servidor, y la autorización es tuya) y `createPublicClient()` (anon sin cookies, para caché compartida).

## Autorización

- **Proxy** (`src/proxy.ts`): 404 a `/admin` para no-admin y sesión más username en `/profile`. Refresca la sesión con `getUser()` **antes** de `intlMiddleware`, y toda respuesta sale por `withSession()`; si lo rompes, se pierden sesiones. Todo fichero nuevo en `public/` necesita excepción en su `matcher`.
- **El proxy no es la frontera**: las Server Actions llegan por POST a cualquier ruta. Toda action llama a `requireAdmin()` y toda página de admin a `requireAdminPage()`, cada una por su cuenta.
- **Sesión**: `getUser()`, nunca `getSession()`. `getClaims()` no ahorra nada, porque los JWT van firmados con HS256.
- **Redirecciones**: solo con `getSafeRedirectTarget()`. El destino del login con Google va en la cookie `ecos_login_redirect`.
- **Cerrar sesión** es local (`scope: "local"`): el global cierra la sesión en todos los dispositivos.

## Datos

- **Cliente**: `src/lib/hooks/queries.ts` es el punto de importación. **Las claves nuevas van en `queryKeys.ts`**, no en el sitio de uso. La página siembra la caché con `initialData`.
- **Histórico de la home**: es una sola query (`home.previousDaysAll`), sembrada por el RSC. Las fusiones de `homeHelpers.ts` devuelven la misma referencia si nada cambia; si no, bucle infinito de renders.
- **Persistencia en localStorage**: solo unas pocas queries (`shouldPersistQuery`). Sube **a mano** `QUERY_CACHE_VERSION` (`queryPersist.ts`) al cambiar la forma de una query persistida. `clearSessionScopedClientData` lo borra todo al cerrar sesión, también las cachés del service worker.
- **Servidor**: lo que es igual para todos va en `unstable_cache` con service role o `createPublicClient()`. Lo del usuario no se cachea. Una ruta con `Cache-Control: public` **nunca** usa el cliente de cookies, o su `Set-Cookie` se queda en la CDN.
- **Rutas API**: andamiaje de `src/lib/api/route.ts` y cuerpos con `readJsonBody`. El rate limit es una regla del firewall de Vercel, configurada a mano en el panel (no está en el repo).

## Invitado, audio y fugas

- **Dos ramas en `GameClient.tsx`**, la parte más delicada. El invitado guarda en localStorage (`gameProgressStore`) y el autenticado en la BD. El autenticado encola la jugada y `confirmMove` la reconcilia con la respuesta del servidor, que manda siempre. Toda regla nueva se prueba en las dos ramas.
- **Fugas**: la canción **de hoy** viaja completa en `/play` (el invitado compara en local); es una decisión tomada. Al añadir campos a respuestas públicas, no filtres `preview_url`, `title`, `artist_name` ni `cover_url` de un reto no resuelto.
- **Audio**: `preview_url` de Spotify vía `/api/audio-proxy?gameId=`, que oculta la URL del CDN pero no es una barrera de seguridad. Si se cae el scraping de previews, hay que recuperar una fuente de audio **y** relajar el filtro del pool (`is_eligible` y `MIN_PREVIEW_SECONDS` en `scripts/selection.py`).

## Ranking en tiempo real

Broadcast privado de Supabase en el canal `ecos:ranking` (`src/lib/realtime/*`): el servidor emite al cerrarse una partida y `/ranking` recarga. Su política está en `realtime.messages`. **Es un requisito: si falla, se arregla, no se quita.**

## Interfaz

- **i18n**: `next-intl`, español sin prefijo e inglés en `/en`. Navega con `src/i18n/navigation.ts`.
- **Iconos**: subset autoalojado de Material Symbols. **Un icono nuevo exige regenerar la fuente** (pasos en `globals.css`) o sale como texto.
- **Animaciones**: `m.*` dentro de `LazyMotion strict`; `motion` falla. Lo visible al cargar no puede depender de una entrada de framer: usa CSS (`animate-in`, `@starting-style`). `whileTap` en `div`/`span` lleva `tabIndex={-1}`. Nada de `animate()`/`useAnimate`.
- **CSP bloqueante** en `next.config.ts`, con otra propia para el service worker. Mal ajustada, rompe el login sin avisar: cómo tocarla, en su comentario.
- **Service worker** (`src/app/sw.ts`, en `/serwist/sw.js`): solo guarda estáticos.
- **SEO**: las partidas llevan `noindex`. Una página con `openGraph` usa `getPageSeo()`. No renombres `manifest.json`.

## Scripts y cron

Además de `ci.yml`, cuatro workflows de datos en `.github/workflows/`:

| Workflow | Script | Qué hace |
|---|---|---|
| `daily-game.yml` | `select-daily-game.py` | Mantiene creados hoy, mañana y pasado |
| `check-games.yml` | `check-games.py` | Cada 3 h repara y avisa; los lunes reactiva los crons |
| `weekly-ingest.yml` | `ingest-weekly.py` | Ingesta semanal |
| `send-daily-notifications.yml` | `send-daily-notifications.py` | Push, solo entre las 12:00 y las 21:00 de Madrid |

- **Los crons de Actions llegan con horas de retraso**: no dependas de la hora exacta.
- **Piezas comunes**: `common.py` (entorno, cliente, `log_job`, `JOB_*`), `selection.py` (reglas del selector y filtro del pool) y `spotify_source.py` (lo único que depende de `spotifyscraper`). Todos admiten `--dry-run`. `scripts/archivo/` no se mantiene.
- **Registro**: todo job registra con `log_job` en `ecos_system_logs`, que es lo que muestra `/admin`. Los `job_type` deben coincidir en `JOB_TYPES` (`system-logger.ts`), el `CHECK` de `01_tables.sql` y `common.py`; si no, el registro se pierde sin avisar.
- **Distingue fallo de la API de «no hay resultados»**: confundirlos ya desactivó el catálogo entero una vez.
- **El repo es público**: ningún log puede mostrar título ni artista de un reto futuro.

## React y el compilador

El React Compiler está activo (`reactCompiler: true`, `panicThreshold: "none"`). **Un componente que no compila pierde el memoizado entero sin avisar.** Compruébalo con `grep -l memo_cache_sentinel .next/static/chunks/*.js`.

El lint trae sus reglas como error y el repo está a cero. Los comentarios del código citan estos nombres:
- **`react-hooks/refs`**: no leas ni escribas `ref.current` en el render. Para el valor anterior, estado ajustado en render; para espejos de callbacks, `useEffect` sin deps.
- **`react-hooks/set-state-in-effect`**: nada de `setState` síncrono en un efecto. Lo derivable se calcula en el render. Para `localStorage`, `useIsMounted()` más ajuste en render. Para fuentes externas, `useSyncExternalStore`.
- **`react-hooks/preserve-manual-memoization`**: las deps manuales deben coincidir con las que infiere el compilador; si no, quita el `useMemo`.

Construcciones que dejan un componente sin compilar y el lint no ve:
- `try/finally`;
- `throw`, `?:`, `&&` o `?.` dentro de un `try`;
- `import()` dentro del componente.

Sácalas a funciones de módulo. Los stores de Zustand se leen con selector, no con funciones en el render, o el valor se queda viejo. Los updaters de `setState` son puros: nada de escrituras a la caché ni otros `setState` dentro.
