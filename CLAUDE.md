# CLAUDE.md

Ecos: reto musical diario (Next.js 16 + Supabase). Proyecto personal; casi todos los usuarios juegan
desde el móvil. Se despliega en Vercel (`ecosgame.vercel.app`, región `fra1` en `vercel.json`):
`master` es producción y el resto de ramas, previews.

## Reglas de trabajo

- **Idioma**: español en comentarios, commits, logs de los scripts y `messages/es.json`. El panel de
  `/admin` está hardcodeado en español a propósito (es interno, no pasa por i18n).
- **Ramas**: nada no trivial va directo a `master` (despliega a producción). Rama `tipo/descripcion`
  antes del primer edit, y `ci.yml` en verde.
- **Commits y PRs**: el único autor y coautor del historial es el dueño del repo. Nada de
  `Co-Authored-By: Claude ...`, `Generated with Claude Code` ni firmas de herramientas en commits ni
  en cuerpos de PR; el historial se reescribió una vez para quitarlos.
- **Ajustes no son rediseño**: home, partida, ranking y perfil ya están rediseñados. Si te piden un
  ajuste, toca solo eso.
- **Procesos**: nunca `taskkill /IM node.exe` (tumba los servidores MCP). Para parar un servidor, por
  PID (`netstat -ano | grep :PUERTO`).
- **Login en local**: Google Identity Services solo acepta los orígenes autorizados en su consola
  (`LoginClient.tsx`); en local, `http://localhost:3000`.
- **La BD es la de producción**: jugar autenticado puntúa en el ranking real. Para probar partidas
  usa días pasados del archivo; la de hoy, solo con permiso.

## Comandos y verificación

```bash
pnpm dev                 # desarrollo
pnpm build               # build de producción — comprueba tipos, no lo saltes
pnpm typecheck           # tsc de la app + del service worker
pnpm lint                # eslint
pnpm ingest-weekly       # ingesta manual desde las playlists de Spotify
```

`pnpm` es obligatorio (`packageManager` en `package.json`). `react` y `react-dom` van fijados a 19.3.0
en `dependencies` y en `pnpm.overrides`: se suben a la vez. No generes `package-lock.json`.

Entorno, siempre en `.env.local` y nunca con valores en el repo: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` y, opcional, `NEXT_PUBLIC_SITE_URL` (https; `getSiteUrl()` en
`src/lib/seo/siteUrl.ts`). Los scripts de Python leen ese mismo fichero (`common.load_env()`); el de
notificaciones añade `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Cada script tiene su
`scripts/requirements-*.txt`. Para un `pnpm build` sin secretos, los valores ficticios de `ci.yml`.

**No hay tests** (decisión firme: ni runner ni ficheros de test; no los añadas). La red de seguridad
son `typecheck`, `lint` y `build`, los tres en verde: el lint está a cero, avisos incluidos, y
`ci.yml` los ejecuta en push a `master` y en PRs. No ven bucles de render ni la lógica de partida
(la home llegó a entrar en `Maximum update depth` con los tres en verde): lo que toque `GameClient`,
la caché de queries o la home se prueba en navegador, como invitado y autenticado (ganar, perder,
saltar, login a mitad de partida). En refactores sin cambio de comportamiento, mapea dependencias,
mueve literal y compara el resultado antes y después (p. ej. el payload de `next start`, por hash).

`tsconfig.worker.json` existe porque `src/app/sw.ts` declara `/// <reference no-default-lib="true" />`:
en el tsconfig principal desactivaría la lib `dom` de todo el programa (~200 errores falsos). El SW va
excluido de ese tsconfig y se comprueba aparte; no lo vuelvas a meter.

## El juego

Misma canción para todos, hasta 6 intentos, fragmento creciente (`ATTEMPT_DURATIONS = [1, 2, 4, 8, 16, 30]`
en `src/lib/store/gameStore.ts`). Cuanto antes aciertes, más puntos (`src/lib/scoring.ts`).

**La regla de acierto es una sola**: `src/lib/guess-match.ts`, módulo puro que usan el servidor y la
comprobación local del invitado. No la repliques. **El servidor decide intento y puntos**:
`submitAttempt` (`src/lib/ecos-finalize-helpers.ts`) registra la jugada y cierra la partida siempre
que la jugada decide, diga lo que diga el cliente; `MAX_ATTEMPTS`, `SKIPPED_GUESS_TEXT` y
`resolveServerAttempt` están en `src/lib/server-attempt.ts`. Lo usan `api/validate-guess`,
`api/skip-attempt` y la autorreparación de `api/game-progress`. Los reportes (`api/report`) nunca
desactivan canciones: a los 3 usuarios distintos dejan un aviso en `ecos_system_logs` para el admin.

**Todo está anclado a la hora de Madrid.** El día de juego no es el UTC ni el del navegador: se
calcula con `getEffectiveGameDate()` de `src/lib/date-utils.ts`, única fuente de verdad. Usa sus
helpers, no `new Date()`, para días de juego, cuentas atrás y límites de periodo. Dos días al año no
tienen 24 h (`getMsUntilNextMidnightMadrid()` lo contempla). El ranking semanal y el mensual solo
cuentan una partida si se completó dentro del periodo de su día de juego, en hora de Madrid; esa
lógica vive en SQL (`supabase/schema/04_leaderboard.sql`).

El selector mantiene creados **hoy, mañana y pasado mañana**, así que existen juegos futuros. Nada
puede servir uno con `date > getEffectiveGameDate()`: lo cubren la RLS de `ecos_games`,
`loadPlayableGame` y `api/audio-proxy`. Una ruta nueva con service role (la RLS no la cubre) tiene
que comprobarlo ella.

## Supabase

La base de datos **se comparte con otra aplicación**. Lo de Ecos lleva prefijo `ecos_`; las tablas
`hubgames_*`, `is_admin()`, `handle_new_user` y `run_judi_*` son ajenas: no las toques. **Trampa con
`is_admin()`**: no sirve para Ecos (consulta `hubgames_usuarios.administrador`, sin ningún usuario
marcado). El rol de admin de Ecos vive en `ecos_profiles.role` (`src/lib/auth/requireAdmin.ts`).

Mucha lógica de negocio vive en Postgres: `ecos_guess_and_finalize_score`, `ecos_finalize_game_score`,
`ecos_search_songs` (sin acentos vía `unaccent`), `get_leaderboard_by_period`,
`get_leaderboard_period_summaries`, `get_user_ranking_stats`, `get_user_avg_guesses`. Antes de
replicar una regla en el cliente, mira si ya es un RPC.

**El esquema vivo está en `supabase/schema/`** (tablas, funciones, RLS, privilegios, Storage y
Realtime; las RPC de ranking, en `04_leaderboard.sql`). Es una instantánea hecha a mano: **la BD real
sigue siendo la fuente de verdad** y el volcado puede quedarse atrás. Si cambias la BD, actualiza el
fichero que toque en el mismo commit; su README explica qué queda fuera y cómo verificarlo.
`supabase/migrations/` es un registro de lo aplicado, no la historia ni la fuente de verdad: las tres
de marzo (RPC de ranking) están desfasadas y **no se reaplican**, y una cabecera «NO APLICAR HASTA
DESPLEGAR» o «PENDIENTE» marca lo que se ejecuta a mano después de desplegar (ver su README).

`supabase/schema/03_security.sql` es el fichero que más cuidado merece. Dos escaladas de privilegios
(ponerse `role = 'admin'`; leer y vaciar `ecos_feedback` con la anon key) vivieron meses porque las
políticas no estaban en el repo, y en octubre de 2026 aparecieron más (RPC de puntuación ejecutables
por cualquiera, perfiles y reto de mañana legibles). Todo cambio de RLS o privilegios pasa por diff.
Lo que hay que saber:
- Supabase concede todo el DML (y TRUNCATE) a `anon` y `authenticated` en cada tabla nueva: **una tabla
  `ecos_*` nueva nace con todo concedido y hay que recortarla a mano** ahí. Los clientes solo escriben
  lo que la app hace con el cliente de cookies (perfil por columnas, suscripciones push, reportes);
  lo demás lo escribe la service role.
- Las RPC de puntuación no las ejecuta nadie salvo la service role; `get_user_ranking_stats` y
  `get_user_avg_guesses` solo devuelven datos de `auth.uid()`.
- `ecos_games` solo es legible hasta hoy en Madrid; `ecos_profiles`, solo la fila propia (el ranking
  va por RPC `SECURITY DEFINER`); `ecos_songs` y `ecos_leaderboard`, por cualquiera.
- El `EXECUTE` de una función nace concedido a `PUBLIC`: revocarlo solo a `anon`/`authenticated` no
  basta.

Para operar sobre la BD usa **primero el MCP de Supabase** (`execute_sql` para DML, `apply_migration`
para DDL) antes de escribir migraciones o scripts a mano. Project id: `hrpwtsnsxnogjpsxslwi`.
PostgREST **corta cada `select` en 1.000 filas sin error**: todo `select` sin filtro sobre una tabla
que pueda pasar de ahí va por `fetch_all` (`scripts/db_paging.py`) o `fetchAllRows`
(`src/lib/supabase/fetchAll.ts`); `ecos_songs` ya supera las 1.600.

Clientes en `src/lib/supabase/` (y `src/lib/queries/public-client.ts`):
- `client.ts` — navegador, anon key.
- `server.ts` — `createClient()` ligado a cookies (respeta RLS) y `createServiceClient()` con service
  role (**bypass total de RLS**).
- `createPublicClient()` — anon key sin cookies, para `unstable_cache` y rutas con caché compartida.

`createServiceClient()` solo puede aparecer en route handlers, Server Components, ficheros
`"use server"` y `src/lib/queries/*` (dentro de `unstable_cache`). Cuando lo uses, la autorización es
tuya: no hay RLS que te cubra.

## Autorización

`src/proxy.ts` (el middleware de Next 16) da 404 a `/admin` a quien no es admin y exige sesión y
username en `/profile`. Además refresca la sesión: `getUser()` va **antes** de `intlMiddleware` y toda
respuesta (también redirecciones y 404) sale por `withSession()` con las cookies nuevas. Si lo tocas,
mantén ambas cosas o se pierden sesiones por rotación del refresh token. Todo fichero nuevo en
`public/` necesita una excepción en su `matcher`.

**El proxy no es la frontera de autorización.** Las Server Actions se despachan por action-id con un
POST que puede dirigirse a cualquier ruta, así que no pasan necesariamente por él. Toda server action
llama a `requireAdmin()` y toda página de admin a `requireAdminPage()` (404 en vez de error, con
`cache()` por render), cada una por su cuenta: el guard del layout no basta, porque en las
navegaciones de cliente Next puede no volver a ejecutarlo.

En servidor, `supabase.auth.getUser()`, nunca `getSession()` (falsificable). `getClaims()` no ahorra
nada: el proyecto firma los JWT con HS256 y con claves simétricas acaba llamando a Auth igual.

Destinos de redirección que vengan del usuario (`?redirect=`, `?next=`): `getSafeRedirectTarget()` de
`src/lib/auth/safeRedirectPath.ts`, el único saneador. El destino del login con Google viaja en la
cookie `ecos_login_redirect`. Tras el primer login, `resolvePostLoginPath()` manda al onboarding de
username si falta. Cerrar sesión es local (`signOut({ scope: "local" })`): el global revoca los
refresh tokens de todos los dispositivos.

## Datos en cliente y en servidor

`src/lib/hooks/queries.ts` es el punto de importación de los datos en cliente: hooks, mutaciones y las
opciones de cada query (`homeTodayQueryOptions`…, que se reutilizan también en `prefetchQuery` y
`fetchQuery`). Detrás: `queryKeys.ts` (el registro `queryKeys` y los `*_STALE_MS`: **las claves nuevas
van aquí**, no en el sitio de uso), `queryTypes.ts`, `queryFetchers.ts` (`postJson`, `ApiError`) y
`gameCacheSync.ts` (parcheado optimista).

La página (Server Component) hace el fetch inicial y lo pasa como `initialData` a un cliente que
siembra la caché de TanStack Query. En la home, el histórico es una sola query (`home.previousDaysAll`)
que siembra el RSC en cada visita (`adoptHomePayload`); `syncGameDay` detecta el cambio de día. Las
fusiones de `homeHelpers.ts` devuelven la misma referencia si nada cambia: si no, entran en bucle.
Los updaters de `setState` han de ser puros.

La caché se persiste en localStorage, pero solo unas pocas queries (`shouldPersistQuery`), con
`QUERY_CACHE_VERSION` (`src/lib/queryPersist.ts`) como `buster`: **súbela a mano** al cambiar la forma
de una query persistida. Al cerrar sesión o cambiar de usuario, `clearSessionScopedClientData` lo
borra todo, también las cachés del service worker.

En servidor, lo que es igual para todos se lee con service role o `createPublicClient()` dentro de
`unstable_cache` (por día de Madrid; ninguna jugada lo invalida). Lo del usuario no se cachea. Una ruta
con `Cache-Control: public` (`publicCacheHeaders`) **nunca** con el `createClient()` de cookies: su
`Set-Cookie` se quedaría en la CDN. Los route handlers usan el andamiaje de `src/lib/api/route.ts`
(`getRequestUser`, `jsonError`, `handleRoute`, `parseIntParam`) y todo cuerpo JSON se lee con
`readJsonBody` (`src/lib/api/body-limit.ts`, tope de tamaño). El límite de frecuencia no está en
código: va en una regla de rate limit del firewall de Vercel, que se configura a mano en el panel
(no está en el repo; compruébalo allí antes de darla por puesta).

## Invitado, audio y fugas

Se juega sin cuenta. El progreso de un invitado vive en localStorage (`gameProgressStore`); el de un
usuario autenticado, en la BD. `GameClient.tsx` reconcilia ambas fuentes y es la parte más delicada
del código: casi toda la lógica tiene una rama para invitado (`applyGuestAttempt`…) y otra para
autenticado. El autenticado pinta la jugada al momento y la encola (`enqueueSubmit`); la respuesta del
servidor se reconcilia con `confirmMove` (`gameProgressSnapshots.ts`) y manda siempre. Toda regla nueva
se prueba en las dos ramas.

La canción **de hoy** viaja completa al cliente en el payload de `/play`, porque el invitado compara en
local: decisión asumida, no un descuido. Lo demás no: título, artista y carátula de un día pasado solo
salen si el usuario lo ha jugado (`src/lib/queries/games.ts`) y los futuros no salen nunca. Al añadir
campos a respuestas públicas, comprueba que no filtras `preview_url`, `title`, `artist_name` ni
`cover_url` de un reto no resuelto.

Audio: una sola fuente (`AudioPlayer.tsx`, `<audio>` nativo), el `preview_url` de Spotify servido por
`/api/audio-proxy?gameId=`. El proxy evita exponer la URL del CDN, rechaza juegos futuros y deja que el
navegador cachee el MP3; **no es una barrera de seguridad**, porque el preview acaba en el navegador de
todos modos. Si algún día se cae el scraping de previews, el arreglo es recuperar una fuente de audio
**y** relajar el filtro del pool (`is_eligible`, `MIN_PREVIEW_SECONDS` en `scripts/selection.py`); solo
lo primero no sirve de nada.

## Ranking en tiempo real

Por Supabase Realtime **Broadcast** privado, canal `ecos:ranking` (`src/lib/realtime/*`): el servidor
emite al cerrarse una partida y `/ranking` escucha y vuelve a pedir los datos. No se publica ninguna
tabla; la política vive en `realtime.messages` (`03_security.sql`). Es un requisito: si falla, se
arregla, no se quita.

## i18n e interfaz

- **i18n**: `next-intl` con `localePrefix: "as-needed"` (español sin prefijo, inglés bajo `/en`). Navega
  con los helpers de `src/i18n/navigation.ts`, no con los de `next/link` o `next/navigation`.
- **Iconos**: Material Symbols, `<span className="material-symbols-outlined">`, con un subset
  autoalojado (`src/app/fonts/material-symbols-outlined.woff2`). **Un icono nuevo exige regenerarlo**
  (los pasos y la lista, en `globals.css`) o se pinta como texto.
- **Tema y marca**: tokens en `globals.css` (Tailwind v4, `--brand`). Componentes de estado compartidos
  en `components/ui/` (`status-screen`, `segmented-control`). Carátulas de home y resultado por
  `next/image`; avatares por `<img>` plano.
- **Animaciones**: `m.*` de framer-motion dentro de `LazyMotion strict` (`MotionProvider`); importar
  `motion` falla. Nada visible al cargar puede depender de una entrada de framer (el `m.*` se queda en
  su `initial` hasta que llega el chunk): usa CSS (`animate-in`, `@starting-style`). `whileTap` en un
  `div`/`span` necesita `tabIndex={-1}`. No uses `animate()` ni `useAnimate` de framer: arrastran todo el
  motor (hay Web Animations API en `GameAudioSection`).
- **CSP bloqueante** en `next.config.ts`, con una CSP propia para el service worker. Una CSP mal
  ajustada rompe la app en silencio (p. ej. el login de Google): cómo tocarla, en el comentario de ese
  fichero.
- **Service worker**: `src/app/sw.ts`, servido en `/serwist/sw.js` (no hay nada de SW en `public/`). No
  guarda páginas ni RSC, solo estáticos.
- **SEO**: `src/app/robots.ts`, `sitemap.ts`, `[locale]/opengraph-image.tsx` y el comodín
  `[locale]/[...rest]` para el 404. Una página que define `openGraph` usa `getPageSeo()` (si no, pierde
  el del layout). Las partidas llevan `noindex` y `robots.txt` no bloquea `/play`, para que el
  rastreador llegue a leerlo. `src/app/manifest.json` lo recoge Next solo y el `matcher` del proxy lo
  nombra: no lo renombres.

## Scripts y cron (`.github/workflows/`)

`ci.yml` (lint, typecheck y build en push a `master` y PRs) y cuatro jobs de datos:
- `daily-game.yml` (diario) → `select-daily-game.py`: mantiene creados hoy, mañana y pasado mañana.
- `check-games.yml` (cada 3 h) → `check-games.py`: lanza el selector si falta alguno de los tres y falla
  (GitHub avisa por email) si falta hoy o mañana o su preview no responde. Los lunes reactiva los
  cuatro crons (un repo público sin actividad pierde los programados).
- `weekly-ingest.yml` (semanal) → `ingest-weekly.py`, desde las playlists activas de Spotify.
- `send-daily-notifications.yml` (diario) → push a quien no ha jugado hoy; fuera de las 12:00–21:00 de
  Madrid no envía y lo deja como `partial` (el lanzamiento manual se salta la ventana).

**Los crons de Actions llegan con horas de retraso** (mediana +2 h, máximo ~7 h): no dependas de la
hora exacta. Por eso el colchón de dos días y la ventana de las notificaciones.

Piezas comunes: `scripts/common.py` (entorno, cliente, logging, `log_job`, constantes `JOB_*`),
`scripts/selection.py` (reglas puras del selector, **incluido el filtro del pool**: `is_eligible`,
`MIN_PREVIEW_SECONDS`) y `scripts/spotify_source.py`, lo único que depende de `spotifyscraper`.
Selector, check-games, ingesta y notificaciones admiten `--dry-run`; `measure-playlists.py` mide
playlists candidatas sin insertarlas. Spotify entrega como mucho 100 pistas por playlist.
`scripts/archivo/` son scripts de un solo uso que no se mantienen.

Todos los jobs usan la service role key y registran su ejecución en `ecos_system_logs` con `log_job`,
que es lo que muestra `/admin` (incluida la sección «Salud»: cobertura, antigüedad de cada job y
reserva del selector, con aviso por debajo de 180 canciones). La lista de `job_type` está en tres
sitios que deben coincidir: `JOB_TYPES` (`src/lib/system-logger.ts`), el `CHECK` de la BD
(`01_tables.sql`) y `common.py`; un valor que el `CHECK` no admita pierde el registro (así estuvieron
las notificaciones meses sin dejar rastro). Si añades un script, mantén ese registro.

Los scripts que llaman a APIs externas deben distinguir **fallo de la API** (cuota, auth, 5xx) de
**«no hay resultados»**. Confundirlos desactivó una vez el catálogo entero (un script verificaba con
YouTube y la cuota diaria se agotó); `spotify_source.py` lo cumple con `SpotifyError`. Y el repo es
público, y con él los logs de Actions: ningún script escribe en ellos título ni artista de un reto
futuro.

## Reglas de React que rompen el lint

`eslint-config-next` 16 trae las reglas del compilador de React como **error**, y el repo está a cero.
El compilador está activo en el build (`reactCompiler: true` en `next.config.ts`, plugin de Babel,
`panicThreshold: "none"`): lo que no puede compilar lo deja tal cual, así que **un componente que
falla pierde el memoizado entero sin que nada avise**. Comprueba que se aplica con
`grep -l memo_cache_sentinel .next/static/chunks/*.js`: deben salir chunks de la app, no solo el
runtime de React.

Las tres reglas que más aparecen y cómo se resuelven en este repo (los comentarios del código citan
estos nombres; no los cambies):

- **`react-hooks/refs`** — no leas ni escribas `ref.current` durante el render. Para "recordar el valor
  anterior", usa estado ajustado durante el render (`if (algo !== last) { setLast(algo); ... }`). Para
  espejos del último valor de cara a callbacks imperativos, escríbelos en un `useEffect` sin deps.
- **`react-hooks/set-state-in-effect`** — nada de `setState` síncrono en el cuerpo de un efecto. Si el
  valor es derivable, calcúlalo en el render. Para leer `localStorage`/`sessionStorage` sin romper la
  hidratación, usa `useIsMounted()` (`src/lib/hooks/useIsMounted.ts`) más ajuste de estado en render.
  Para fuentes externas reales (`matchMedia`, etc.), `useSyncExternalStore`.
- **`react-hooks/preserve-manual-memoization`** — las deps manuales deben coincidir con las que infiere
  el compilador. Si desglosas `obj?.prop` cuando infiere `obj`, se descarta la optimización: pon la
  dependencia completa o quita el `useMemo` y deja que memoice el compilador.

Hay construcciones que dejan un componente sin compilar y el lint no avisa: `try/finally`, un `throw`
o un `?:`/`&&`/`?.` dentro de un `try`, y un `import()` dentro del componente. Van en funciones de
módulo (ver `runQueuedMove` en `GameClient.tsx`). Y los stores de Zustand se leen con selector, no con
funciones durante el render (`useGameProgressStore((s) => s.byGameId[id])`, no `getProgress(id)`): el
compilador memoizaría el resultado por la identidad de la función, que nunca cambia, y se quedaría viejo.

Los updaters de `setState` tienen que ser puros: React puede ejecutarlos más de una vez. No metas
dentro escrituras a la caché de queries ni otros `setState`.
