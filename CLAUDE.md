# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

El proyecto está escrito en español: comentarios, mensajes de commit, textos de UI en `messages/es.json` y logs de los scripts. Mantén ese idioma al añadir código. El panel de administración está hardcodeado en español a propósito (es interno, no pasa por i18n).

## Comandos

```bash
pnpm dev                 # desarrollo
pnpm build               # build de producción — comprueba tipos, no lo saltes
pnpm typecheck           # tsc de la app + del service worker
pnpm lint                # eslint

pnpm verify-youtube      # comprueba que los youtube_id siguen siendo embebibles
pnpm ingest-weekly       # ingesta manual desde las playlists de Spotify
```

`pnpm` es obligatorio (`packageManager` en `package.json`, y `pnpm.overrides` fija React 19.2.3). No generes `package-lock.json`.

**No hay tests.** No existe runner ni ningún fichero de test; `scripts/spotify-scraper-test.py` es un script manual, no una suite. La red de seguridad son `typecheck`, `lint` y `build`, y los tres deben quedar en verde antes de dar algo por terminado.

`tsconfig.worker.json` existe porque `src/app/sw.ts` declara `/// <reference no-default-lib="true" />`: dentro del tsconfig principal eso desactivaría la lib `dom` en **todo** el programa y produciría ~200 errores falsos. El SW va excluido del tsconfig principal y se comprueba aparte. No lo vuelvas a meter.

## Arquitectura

### El juego

Un reto diario: la misma canción para todo el mundo, hasta 6 intentos, y en cada uno suena un fragmento más largo (`ATTEMPT_DURATIONS = [1, 2, 4, 8, 16, 30]` en `src/lib/store/gameStore.ts`). Cuanto antes aciertes, más puntos (`src/lib/scoring.ts`, que también genera el texto de compartir con emojis).

### Todo está anclado a la hora de Madrid

Es la invariante que más se cruza con el resto del código. El día de juego no es el día UTC ni el del navegador: se calcula con `getEffectiveGameDate()` de `src/lib/date-utils.ts`. Ese módulo es la única fuente de verdad para fechas — usa sus helpers en lugar de `new Date()` cuando se trate de días de juego, cuentas atrás o límites de periodo. Ojo con los dos días del año con cambio de horario: no todos los días tienen 24 h, y `getMsUntilNextMidnightMadrid()` ya lo contempla.

Las tablas de ranking semanal y mensual solo cuentan los puntos si la partida se completó dentro del mismo periodo que el día del juego, en hora local de Madrid. Esa lógica vive en SQL (ver `supabase/migrations/`).

### Supabase

La base de datos **se comparte con otra aplicación**. Las tablas de este proyecto llevan prefijo `ecos_`; las `hubgames_*` que aparecen en `src/types/supabase.ts` (generado) no son de aquí — no las toques.

Buena parte de la lógica de negocio vive en Postgres, no en TypeScript: `ecos_guess_and_finalize_score`, `ecos_finalize_game_score`, `ecos_search_songs` (búsqueda sin acentos vía `unaccent`), `get_leaderboard_by_period`, `get_leaderboard_period_summaries`, `get_user_ranking_stats`, `get_user_avg_guesses`. Antes de replicar una regla en el cliente, mira si ya existe como RPC.

**El esquema no está versionado.** `supabase/` está en `.gitignore` y solo hay tres migraciones sueltas de leaderboard. No hay DDL de tablas ni **ninguna** definición de RLS en el repo. Cualquier afirmación del código sobre políticas RLS hay que verificarla contra el proyecto real.

Para operar sobre la base de datos, usa **primero el MCP de Supabase** (`execute_sql` para DML, `apply_migration` para DDL) antes de escribir migraciones o scripts a mano. Project id: `hrpwtsnsxnogjpsxslwi`.

Hay dos clientes en `src/lib/supabase/`:
- `client.ts` — navegador, anon key.
- `server.ts` — `createClient()` ligado a cookies (respeta RLS) y `createServiceClient()` con service role (**bypass total de RLS**).

`createServiceClient()` solo puede aparecer en route handlers, Server Components y ficheros `"use server"`. Cuando lo uses, la autorización es responsabilidad tuya: no hay RLS que te cubra.

### Autorización

`src/proxy.ts` (el middleware de Next 16) protege `/admin` y `/profile`, y fuerza el onboarding de username. **No es la frontera de autorización.** Las Server Actions se despachan por action-id mediante un POST que puede dirigirse a cualquier ruta, así que no pasan necesariamente por el guard de ruta. Toda server action y toda página de admin debe llamar a `requireAdmin()` (`src/lib/auth/requireAdmin.ts`) por su cuenta.

Usa siempre `supabase.auth.getUser()`, nunca `getSession()` (es falsificable). Para destinos de redirección post-login, `getSafeRedirectTarget()` de `src/lib/auth/safeRedirectPath.ts`.

### Datos en cliente

`src/lib/hooks/queries.ts` (~1.500 líneas) es el módulo central: el registro `queryKeys`, todas las queries y mutaciones, el parcheado optimista de caché y los helpers de prefetch. **Añade las claves nuevas al registro `queryKeys`**, no las inventes en el sitio de uso.

El patrón general es: la página (Server Component) hace el fetch inicial y lo pasa como `initialData` a un cliente que lo siembra en la caché de TanStack Query. La caché se persiste en localStorage con un `buster` ligado al build.

Cuidado al tocar la home: `HomeClient.tsx` prefetchea agresivamente el histórico completo y eso escala con la antigüedad del juego. Es deuda conocida.

### Modo invitado

Se puede jugar sin cuenta. El progreso de un invitado vive en localStorage vía `gameProgressStore`; el de un usuario autenticado, en la base de datos. `GameClient.tsx` reconcilia ambas fuentes y esa es la parte más delicada del código: casi toda la lógica está duplicada en una rama para invitado y otra para autenticado. Si cambias el flujo de una, revisa la otra.

Consecuencia de diseño: la canción del día viaja completa al cliente en el payload de `/play`, porque el invitado necesita comparar en local. Es una decisión asumida, no un descuido.

### Audio

Dos fuentes con fallback (`AudioPlayer.tsx`): si la canción tiene `preview_url` de Spotify se sirve a través de `/api/audio-proxy`, que existe para no exponer la URL del CDN; si no, se usa un iframe oculto de YouTube. Al añadir campos a respuestas públicas, comprueba que no filtras `preview_url`, `title`, `artist_name` ni `cover_url` de un reto no resuelto.

### i18n

`next-intl` con `localePrefix: "as-needed"`: español sin prefijo, inglés bajo `/en`. Navega con los helpers de `src/i18n/navigation.ts`, no con los de `next/link` o `next/navigation` directamente.

### Scripts y cron

Los tres workflows de `.github/workflows/` son jobs de datos, no CI:
- `daily-game.yml` (diario) → `select-daily-game.py`, elige la canción del día siguiente.
- `weekly-ingest.yml` (semanal) → `ingest-weekly.py`, ingesta desde las playlists activas de Spotify.
- `send-daily-notifications.yml` (diario) → push a quien no haya jugado hoy.

Todos usan la service role key y registran su ejecución en `ecos_system_logs`, que es lo que muestra el panel de admin. Si añades un script, mantén ese registro.

Los scripts que llaman a APIs externas deben distinguir **fallo de la API** (cuota, auth, 5xx) de **"no hay resultados"**. Confundirlos ya provocó un incidente: `verify-youtube.ts` desactivaba el catálogo entero al agotarse la cuota diaria de YouTube. Por eso tiene ahora un circuit breaker.

## Reglas de React que rompen el lint

`eslint-config-next` 16 trae las reglas del compilador de React como **error**, y el repo está a cero. El compilador aborta la optimización de un componente entero al primer fallo, así que un error nuevo puede desactivar el memoizado de todo el fichero.

Las tres que más aparecen y cómo se resuelven en este repo:

- **`react-hooks/refs`** — no leas ni escribas `ref.current` durante el render. Para "recordar el valor anterior", usa estado ajustado durante el render (`if (algo !== last) { setLast(algo); ... }`). Para espejos del último valor de cara a callbacks imperativos, escríbelos en un `useEffect` sin deps.
- **`react-hooks/set-state-in-effect`** — nada de `setState` síncrono en el cuerpo de un efecto. Si el valor es derivable, calcúlalo en el render. Para leer `localStorage`/`sessionStorage` sin romper la hidratación, usa `useIsMounted()` (`src/lib/hooks/useIsMounted.ts`) más ajuste de estado en render. Para fuentes externas reales (`matchMedia`, etc.), `useSyncExternalStore`.
- **`react-hooks/preserve-manual-memoization`** — las deps manuales deben coincidir con las que infiere el compilador. Si desglosas `obj?.prop` cuando infiere `obj`, se descarta la optimización: pon la dependencia completa o quita el `useMemo` y deja que memoice el compilador.

Los updaters de `setState` tienen que ser puros: React puede ejecutarlos más de una vez. No metas dentro escrituras a la caché de queries ni otros `setState`.
