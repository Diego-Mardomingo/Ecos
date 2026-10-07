# scripts/archivo

Scripts de un solo uso que ya cumplieron su función. No los llama ningún workflow ni `package.json`.
Se conservan por si hiciera falta repetir algo parecido, pero **no se mantienen**.

- `backfill-games.py`: generaba juegos de fechas pasadas con las reglas de `select-daily-game.py`.
  `ecos_games` empieza el 2026-01-01 y está completo.
- `backfill-preview-duration.py`: rellenaba `preview_duration_seconds` donde era NULL. Hoy no queda
  ninguna canción con preview y duración NULL, y `ingest-weekly.py` ya la mide siempre.

Se movieron sin cambiar el contenido, así que dos cosas dejaron de funcionar tal cual:

- Importan `db_paging`, `song_key` y `preview_audio` por `sys.path`, que ahora están un directorio
  más arriba. Ejecútalos con `PYTHONPATH=scripts` (desde la raíz del repo).
- Buscan `.env.local` en `scripts/`, no en la raíz. Exporta las variables de entorno a mano.
