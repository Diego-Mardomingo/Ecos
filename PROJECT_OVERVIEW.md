# 🎵 Heardle en Español — Project Overview

Documento de referencia para IA. Contexto de alto nivel del proyecto, stack, fuentes de datos y decisiones técnicas clave.

---

## ¿Qué es?

App web tipo Heardle enfocada en **música española y latina**. El jugador escucha fragmentos de audio progresivamente más largos e intenta adivinar la canción. Incluye sistema de puntuaciones, rachas, ranking global y progresión diaria (una canción por día, estilo Wordle).

Orientada a **móvil-first** (PWA instalable), con soporte web completo.

---

## Stack Tecnológico

### Framework
- **Next.js 14+ (App Router)** — SSR, API Routes, PWA-ready, deploy en Vercel

### Base de datos & Backend
- **Supabase** — PostgreSQL, Auth social (Google/Discord), Realtime para ranking en vivo, Storage (si se necesita), Edge Functions para lógica sensible

### Frontend
- **React 18 + TailwindCSS v4** — UI mobile-first
- **shadcn/ui** — Componentes accesibles
- **Framer Motion** — Animaciones (reveal de pistas, celebraciones)
- **Howler.js** — Reproducción de audio con control preciso
- **Zustand** — Estado global ligero (partida, score, audio)

### Data & Fetching
- **TanStack Query v5** — Cache y gestión de datos del ranking
- **Zod** — Validación de schemas cliente/servidor
- **@supabase/ssr** — Cliente Supabase con Server Components

### PWA
- **next-pwa** — Instalable como app nativa en móvil
- Respetar `safe-area-inset` para notch, diseño con viewport fijo

### Extras recomendados
- **React Hook Form + Zod** — Búsqueda/autocompletar canciones
- **date-fns** — Manejo de "canción del día" y rachas
- **canvas-confetti** — Celebración al acertar
- **Sentry** — Monitoreo de errores
- **Vercel Analytics** — Métricas reales de uso

---

## Fuente de Datos: Deezer API

### Por qué Deezer (y no Spotify)
- Spotify eliminó los preview URLs de 30s para apps nuevas en noviembre 2024 → inviable
- Deezer ofrece preview de 30s gratuito y sin autenticación para búsquedas
- Catálogo: 120M canciones (más que Spotify con 100M)
- Fortaleza especial en España, Brasil, México y LATAM
- Rate limit: 50 req/5s — suficiente para un cron job diario

### Qué datos provee por canción (sin auth)
```
GET https://api.deezer.com/search?q=bad+bunny&limit=50
GET https://api.deezer.com/track/{id}
```
- Título, duración, ISRC, posición en disco
- `preview` — URL directa al MP3 de 30s ✅
- `rank` — Popularidad (0-1.000.000)
- `bpm` — Tempo directo en el objeto track
- `explicit_lyrics` — Filtro de contenido explícito
- `artist` — Nombre, ID, foto en alta resolución
- `album` — Título, carátula (small/medium/big/xl), fecha, sello discográfico, UPC
- `contributors` — Compositores y productores con roles

### Restricciones legales importantes
- ✅ Usar preview URLs en tiempo real desde la CDN de Deezer
- ❌ No descargar ni almacenar los MP3 en Supabase Storage
- ❌ No almacenar las carátulas localmente (servir desde CDN de Deezer)

---

## Ingesta automática de canciones

Cron job diario (Supabase Edge Function o Vercel Cron):

```
1. Consultar Deezer API → canciones en español ordenadas por rank
2. Filtrar: que tenga preview_url + que no haya salido antes en el juego
3. Guardar metadatos en tabla `songs` de Supabase (sin audio, solo URLs)
4. Seleccionar automáticamente la "canción del día"
```

Queries útiles para música en español/latina:
- `genre: "Pop Latino"`, `genre: "Reggaeton"`, `genre: "Flamenco"`, `genre: "Latin"`
- Filtrar por `rank > 500000` para asegurar canciones conocidas

---

## Esquema de Base de Datos (Supabase/PostgreSQL)

```sql
-- Canciones (metadatos de Deezer, sin audio almacenado)
songs (
  id, deezer_id, title, artist_name, album_title,
  cover_url, preview_url, bpm, rank, release_date,
  genre, explicit, created_at
)

-- Partidas diarias (una canción por día)
games (id, song_id, date, created_at)

-- Intentos del usuario
guesses (id, user_id, game_id, attempt_number, guess_text, correct, created_at)

-- Puntuaciones (calculadas en Edge Function, no en cliente)
scores (id, user_id, game_id, points, guesses_used, time_ms, created_at)

-- Ranking global agregado
leaderboard (user_id, total_points, games_played, avg_guesses, streak, last_played)
```

---

## Mecánica del Juego

- 6 intentos máximo
- Cada intento revela un fragmento de audio más largo (1s → 2s → 4s → 8s → 16s → 30s)
- Puntuación inversa: acertar en el intento 1 da más puntos que en el 6
- La puntuación se calcula y valida en el servidor (Edge Function), nunca en cliente
- Una canción por día, misma para todos los usuarios (estilo Wordle)
- Racha diaria: bonus de puntos por días consecutivos jugados

---

## Estructura de carpetas sugerida

```
/app
  /api
    /validate-guess     ← Edge Function (no expone la canción al cliente)
    /daily-song         ← Devuelve solo el fragmento, nunca el título
  /(game)
    /page.tsx           ← Juego principal
  /ranking
    /page.tsx           ← Leaderboard con Realtime de Supabase
  /profile/[id]
    /page.tsx           ← Perfil con historial y estadísticas
/components
  /audio-player         ← Howler.js encapsulado
  /guess-input          ← Autocompletar canciones (React Hook Form)
  /score-display        ← Animación de puntos (Framer Motion)
  /leaderboard          ← Tabla de ranking en tiempo real
/lib
  /deezer.ts            ← Cliente Deezer API
  /supabase.ts          ← Cliente Supabase
  /scoring.ts           ← Lógica de puntuación
```

---

## Decisiones técnicas clave

| Decisión | Elección | Motivo |
|---|---|---|
| Audio source | Deezer API | Único con preview gratuito en 2025 |
| Auth | Supabase Auth | Social login sin configuración extra |
| Ranking en tiempo real | Supabase Realtime | Integrado, sin coste extra |
| Validación de respuestas | Edge Function (servidor) | Evita trampas desde el cliente |
| Estado del juego | Zustand | Ligero, sin boilerplate |
| Estilos | Tailwind v4 | Mobile-first, sin CSS custom |
| Deploy | Vercel | Next.js nativo, crons integrados |
