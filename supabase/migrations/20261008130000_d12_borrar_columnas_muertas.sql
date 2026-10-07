-- ============================================================================================
-- NO APLICAR HASTA DESPLEGAR.  BD-2 parte 2 / D12 (DEAD-18, DATA-03).
--
-- Esta migración es destructiva y no se puede deshacer: borra seis columnas de ecos_songs. Hay
-- que aplicarla DESPUÉS de que esté en producción (Vercel) el código de la rama lote/bd-2 que
-- deja de leerlas, y de que master lleve los scripts nuevos (daily-game.yml ejecuta
-- scripts/select-daily-game.py desde master):
--
--   * src/lib/queries/games.ts           ya no pide `genre` (GAME_WITH_SONG_SELECT).
--   * src/components/game/GameResultScreen.tsx  ya no muestra `genre` en la ficha de la canción.
--   * scripts/select-daily-game.py y scripts/selection.py  ya no seleccionan `genre`; la rotación
--     de géneros especiales (flamenco/rap/reggaeton) mira solo el nombre de la playlist.
--   * scripts/ingest-weekly.py           ya no escribe `raw_spotify_data` (ni ninguna de las otras).
--
-- Si se aplica antes, el despliegue viejo seguirá pidiendo `genre` en el select embebido de
-- ecos_games -> ecos_songs, PostgREST devolverá 400 y la home y /play quedarán rotas hasta que
-- entre el despliegue nuevo. El selector diario fallaría igual con el código viejo.
--
-- Qué se pierde: `raw_spotify_data` tiene la respuesta cruda de Spotify de las 1.672 canciones
-- ingeridas hasta marzo 2026 (825 kB); nadie la lee. `tempo`, `danceability`, `energy`,
-- `popularity` y `genre` están a NULL en todas las filas (comprobado el 2026-10-08). Si se quiere
-- conservar la respuesta cruda, exportarla antes:
--   copy (select id, spotify_id, raw_spotify_data from ecos_songs) to ... (desde el cliente)
--
-- Comprobado el 2026-10-08: ninguna vista, índice, función ni política depende de estas columnas
-- (ecos_search_songs devuelve solo id, title, artist_name, album_title, cover_url y spotify_id).
--
-- Después de aplicarla: quitar `genre`, `popularity`, `tempo`, `danceability`, `energy` y
-- `raw_spotify_data` de supabase/schema/01_tables.sql en el mismo commit.
-- scripts/archivo/backfill-games.py (archivado, no se ejecuta) todavía pide `genre`: si alguna vez
-- se reutiliza, hay que quitarlo.
-- ============================================================================================

ALTER TABLE public.ecos_songs
  DROP COLUMN IF EXISTS tempo,
  DROP COLUMN IF EXISTS danceability,
  DROP COLUMN IF EXISTS energy,
  DROP COLUMN IF EXISTS popularity,
  DROP COLUMN IF EXISTS genre,
  DROP COLUMN IF EXISTS raw_spotify_data;
