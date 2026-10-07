# scripts/archivo

Scripts de un solo uso que ya cumplieron su función. No los llama ningún workflow ni `package.json`.
Se conservan por si hiciera falta repetir algo parecido, pero **no se mantienen**.

- `backfill-games.py`: generaba juegos de fechas pasadas con las reglas de `select-daily-game.py`.
  `ecos_games` empieza el 2026-01-01 y está completo. Importa las reglas de `selection.py` (ya no
  tiene copia propia), usa `common.py` y admite `--dry-run`.
- `backfill-preview-duration.py`: rellenaba `preview_duration_seconds` donde era NULL. Hoy no queda
  ninguna canción con preview y duración NULL, y `ingest-weekly.py` ya la mide siempre.

Se movieron a este directorio, así que dos cosas dejaron de funcionar tal cual:

- Importan `common`, `db_paging`, `selection`, `song_key` y `preview_audio` por `sys.path`, que
  ahora están un directorio más arriba. Ejecútalos con `PYTHONPATH=scripts` (desde la raíz del
  repo).
- `backfill-preview-duration.py` busca `.env.local` en `scripts/`, no en la raíz: exporta las
  variables de entorno a mano. (`backfill-games.py` ya lo carga bien con `common.load_env`.)

Otro fallo en camino: `backfill-games.py` todavía pide `genre` en sus `select` (`SONG_COLUMNS` y la
consulta de `ecos_games`). Fallará en cuanto se aplique `20261008130000_d12_borrar_columnas_muertas.sql`, que
borra esa columna: si algún día se reutiliza, quítalo antes. El selector (`selection.py`) ya no
lo usa: la rotación de géneros mira el nombre de la playlist.
