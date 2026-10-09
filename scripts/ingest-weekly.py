#!/usr/bin/env python3
"""
Ingesta semanal: Spotify (vía spotify_source.py) + Supabase.
Ejecutar 1x/semana (GitHub Action).

Por playlist, en modo "default" lee bloques de 5 pistas y solo salta al siguiente si en el
bloque no se insertó nada; en modo "all" mira la playlist entera. Sin límite de canciones por
semana. Spotify solo da las 100 primeras pistas de cada playlist (el embed corta ahí), así que
una playlist de 100 puede estar truncada y, cuando todas sus pistas ya están en el catálogo, está
agotada: el informe del run las lista (`details.exhausted_playlists`).

Antes de pedir nada a Spotify por una pista, se descarta si ya está en el catálogo (por
spotify_id o por clave título+artista, ver song_key.py): en un run normal el 85 % de lo que
traen las playlists ya se conoce, y enriquecerlo costaba 1-3 peticiones por pista.

Hay dos fuentes de audio: Deezer (principal, deezer_source.py) y el preview de Spotify
(respaldo). De cada pista nueva se mide el MP3 de las dos (deezer_preview_seconds y
preview_duration_seconds) y se inserta si CUALQUIERA dura al menos MIN_PREVIEW_SECONDS
(selection.py; D10: el umbral no cambia). Una pista con preview corto en Spotify entra si Deezer
da el audio (`eligible_by_deezer_only`); no entra si ninguna de las dos sirve (`no_audio`). La URL
de Deezer va firmada y caduca: solo se guarda deezer_id (y isrc). El log distingue las causas
porque no significan lo mismo: «sin URL» y «preview corto» son datos de Spotify; «no encontrada» y
«corto» de Deezer, datos de Deezer; «fallo al medir», «fallo de la API de Deezer» y «fallo al
leer la pista» son fallos de la ingesta (SONGS-08 / OPS-09). Un fallo de la API de Deezer no
aborta la ingesta ni cuenta como «no encontrada»: si Spotify sirve, la pista entra sin los datos
de Deezer (deezer_checked_at queda a NULL y backfill-deezer.py la completará).

Un fallo de Spotify no es «no hay canciones nuevas»: si fallan la mayoría de las lecturas o de
las mediciones, o ninguna playlist se pudo leer, el run termina en `failure` (exit 1, GitHub
manda el email). Cualquier fallo suelto lo deja en `partial`. Si el script muere por una
excepción, también escribe una fila `failure` con los contadores hasta ese momento.

El catálogo se lee con fetch_all: sin paginar, la API corta en 1.000 filas y el filtro queda
ciego a todo lo que pase de ahí, que es lo que metió canciones repetidas hasta agosto de 2026.

El repo es público y con él los logs de Actions: este script no escribe títulos ni artistas, solo
ids de Spotify.

Uso:
  python scripts/ingest-weekly.py                       # ingesta real
  python scripts/ingest-weekly.py --dry-run             # lee y mide, no escribe nada
  python scripts/ingest-weekly.py --dry-run --playlist 37i9dQZEVXbNFJfN1Vw8d9

La selección diaria de juegos corre en workflow separado (daily-game.yml).

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import logging
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from common import (
    JOB_INGESTION,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)

try:
    from db_paging import fetch_all
    from deezer_source import DeezerApiError, find_track
    from preview_audio import PreviewFetchError, PreviewInvalidError, measure_mp3
    from selection import MIN_PREVIEW_SECONDS
    from song_key import dedupe_key
    from spotify_source import SpotifyError, SpotifySource, TrackStub, TrackUnavailableError
except ImportError as e:
    print(f"Error importando dependencias: {e}")
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

# --- Config ---
CHUNK_SIZE = 5  # Bloque de 5; saltar al siguiente solo si en el bloque no se insertó nada
# Spotify devuelve como mucho 100 pistas por playlist (comprobado en playlists de 150).
SPOTIFY_PLAYLIST_CAP = 100

# Umbrales del estado del run. Por debajo de MIN_SAMPLE intentos un porcentaje no dice nada.
FAIL_RATIO = 0.5
MIN_SAMPLE = 10
# Con tantas pistas leídas sin ninguna con preview_url, el problema es de Spotify o del parseo.
MIN_SAMPLE_NO_URL = 20
# Mensajes de fallo que se guardan en `errors` del registro (el resto solo se cuenta).
MAX_FAILURE_SAMPLES = 5

COUNT_FIELDS = (
    "found",  # pistas revisadas (incluye las ya conocidas)
    "duplicates",
    "no_id",  # pistas de la lista sin spotify_id
    "enrich_attempts",
    "enrich_failed",  # no se pudo leer la pista en Spotify
    "unavailable",  # la pista ya no existe en Spotify (retirada): un dato, no un fallo
    "candidates",  # pistas nuevas leídas: las que se miran para insertar
    "no_preview_url",  # Spotify no da preview_url
    "measure_attempts",
    "measure_failed",  # no se pudo descargar o medir el preview
    "preview_short",  # preview de Spotify medido, pero < MIN_PREVIEW_SECONDS
    "deezer_found",  # Deezer da la pista y su preview se pudo medir
    "deezer_not_found",  # la búsqueda funcionó y no hay emparejamiento: un dato
    "deezer_api_error",  # la API de Deezer falló o no se pudo medir su preview: un fallo
    "deezer_short",  # preview de Deezer medido, pero < MIN_PREVIEW_SECONDS
    "no_audio",  # pistas nuevas que no entran: ninguna de las dos fuentes sirve
    "eligible_by_deezer_only",  # insertadas gracias a Deezer (Spotify no servía)
    "inserted",
    "insert_errors",
)


class Counts:
    """Contadores de una playlist que también suman en los del run."""

    def __init__(self, parent: Counts | None = None) -> None:
        self.parent = parent
        self.n = dict.fromkeys(COUNT_FIELDS, 0)

    def bump(self, name: str, by: int = 1) -> None:
        self.n[name] += by
        if self.parent:
            self.parent.bump(name, by)

    def __getitem__(self, name: str) -> int:
        return self.n[name]

    @property
    def no_preview(self) -> int:
        """Pistas nuevas que no entran por falta de audio (nombre histórico del panel)."""
        return self.n["no_audio"]


class Catalog:
    """Qué hay ya en el catálogo y qué se ha visto en este run, para descartar repetidos."""

    def __init__(self, rows: list[dict]) -> None:
        self.ids = {r["spotify_id"] for r in rows if r.get("spotify_id")}
        self.keys: set[str] = set()
        for r in rows:
            k = dedupe_key(r.get("title"), r.get("artist_name"))
            if k:
                self.keys.add(k)

    def is_known(self, spotify_id: str | None, key: str | None) -> bool:
        return bool((spotify_id and spotify_id in self.ids) or (key and key in self.keys))

    def add(self, spotify_id: str | None, key: str | None) -> None:
        if spotify_id:
            self.ids.add(spotify_id)
        if key:
            self.keys.add(key)


def short_db_error(exc: Exception) -> str:
    """Código y mensaje de un error de PostgREST, sin `details` (que incluye la fila)."""
    code, message = getattr(exc, "code", None), getattr(exc, "message", None)
    if code or message:
        return f"{code or '?'}: {message or ''}"[:200]
    return type(exc).__name__


def short_bucket(seconds: float) -> str:
    """Tramo de un preview corto, para ver si los descartes rozan el umbral o no."""
    if seconds < 15:
        return "menos_de_15s"
    if seconds < 20:
        return "15_a_20s"
    if seconds < 25:
        return "20_a_25s"
    return "25s_o_mas"


class Run:
    def __init__(self, log: logging.Logger, supabase: Any, source: SpotifySource, dry_run: bool) -> None:
        self.log = log
        self.supabase = supabase
        self.source = source
        self.dry_run = dry_run
        self.catalog = Catalog([])
        self.totals = Counts()
        self.playlist_stats: list[dict] = []
        self.errors: list[str] = []  # van a `errors` del registro
        self.insert_error_samples = 0
        self.failure_samples = {"enrich": 0, "measure": 0, "deezer": 0}
        self.playlists_total = 0
        self.playlists_failed = 0
        self.exhausted: list[str] = []
        self.short_buckets: dict[str, int] = {}

    def note_failure(self, kind: str, message: str) -> None:
        """Guarda como muestra un fallo de lectura, de medición o de Deezer (los primeros nada más)."""
        if self.failure_samples[kind] < MAX_FAILURE_SAMPLES:
            self.failure_samples[kind] += 1
            self.errors.append(message)


def load_active_playlists(supabase: Any) -> list[tuple[str, str, str]]:
    """
    Devuelve [(spotify_playlist_id, spotify_playlist_name, ingest_mode)] solo activas.
    ingest_mode: 'default' o 'all'
    """
    res = (
        supabase.table("ecos_spotify_playlists")
        .select("spotify_playlist_id, spotify_playlist_name, ingest_mode")
        .eq("is_active", True)
        .order("created_at", desc=False)
        .execute()
    )
    out: list[tuple[str, str, str]] = []
    for r in res.data or []:
        pl_id = (r.get("spotify_playlist_id") or "").strip()
        if not pl_id:
            continue
        name = (r.get("spotify_playlist_name") or pl_id).strip()
        mode = (r.get("ingest_mode") or "default").strip()
        if mode not in ("default", "all"):
            mode = "default"
        out.append((pl_id, name, mode))
    return out


@dataclass(frozen=True)
class DeezerResult:
    deezer_id: int | None = None
    isrc: str | None = None
    seconds: float | None = None  # preview medido; None si no hay o no se pudo
    api_error: bool = False


def lookup_deezer(run: Run, info: Any, sid: str, pc: Counts) -> DeezerResult:
    """
    Busca la pista en Deezer y mide su preview. Nunca lanza: un fallo de la API se cuenta aparte
    de «no encontrada» y la ingesta sigue.
    """
    log = run.log
    try:
        match = find_track(info.artist, info.title, info.duration_ms)
    except DeezerApiError as exc:
        pc.bump("deezer_api_error")
        log.warning("  Fallo de la API de Deezer con %s: %s", sid, exc)
        run.note_failure("deezer", f"Deezer {sid}: {exc}")
        return DeezerResult(api_error=True)
    if match is None:
        pc.bump("deezer_not_found")
        return DeezerResult()
    if not match.preview_url:
        # Deezer conoce la pista pero no da preview: no es un fallo ni sirve como audio.
        pc.bump("deezer_not_found")
        return DeezerResult(deezer_id=match.deezer_id, isrc=match.isrc)
    try:
        seconds = measure_mp3(match.preview_url)
    except (PreviewFetchError, PreviewInvalidError) as exc:
        pc.bump("deezer_api_error")
        log.warning("  Fallo al medir el preview de Deezer de %s: %s", sid, exc)
        run.note_failure("deezer", f"Medir preview de Deezer {sid}: {exc}")
        return DeezerResult(api_error=True)
    pc.bump("deezer_found")
    if seconds < MIN_PREVIEW_SECONDS:
        pc.bump("deezer_short")
    return DeezerResult(deezer_id=match.deezer_id, isrc=match.isrc, seconds=seconds)


def process_track(run: Run, stub: TrackStub, pl_id: str, pl_name: str, pc: Counts) -> bool:
    """Lee, mide e inserta una pista nueva. Devuelve True si se insertó."""
    log = run.log
    if not stub.spotify_id:
        pc.bump("no_id")
        return False

    pc.bump("enrich_attempts")
    try:
        info = run.source.track_info(stub.spotify_id)
    except TrackUnavailableError:
        pc.bump("unavailable")
        return False
    except SpotifyError as exc:
        pc.bump("enrich_failed")
        log.warning("  Fallo al leer la pista: %s", exc)
        run.note_failure("enrich", f"Leer pista: {exc}")
        return False

    sid = info.spotify_id
    key = dedupe_key(info.title, info.artist)
    # La lista y el embed pueden discrepar en el id o en cómo se escribe el título.
    if run.catalog.is_known(sid, key):
        pc.bump("duplicates")
        return False
    # Desde aquí la pista cuenta como vista aunque se rechace: otra playlist que la repita no
    # vuelve a descargar su preview. La clave título+artista solo se registra al insertar, porque
    # otra edición del mismo título sí podría tener un preview largo.
    run.catalog.add(sid, None)
    pc.bump("candidates")

    # --- Spotify: preview_url medido ---
    spotify_seconds: float | None = None
    if not info.preview_url:
        pc.bump("no_preview_url")
    else:
        pc.bump("measure_attempts")
        try:
            spotify_seconds = measure_mp3(info.preview_url)
        except (PreviewFetchError, PreviewInvalidError) as exc:
            pc.bump("measure_failed")
            kind = "descargar" if isinstance(exc, PreviewFetchError) else "medir"
            log.warning("  Fallo al %s el preview de %s: %s", kind, sid, exc)
            run.note_failure("measure", f"Fallo al {kind} el preview de {sid}: {exc}")
        else:
            if spotify_seconds < MIN_PREVIEW_SECONDS:
                pc.bump("preview_short")
                bucket = short_bucket(spotify_seconds)
                run.short_buckets[bucket] = run.short_buckets.get(bucket, 0) + 1
    spotify_ok = spotify_seconds is not None and spotify_seconds >= MIN_PREVIEW_SECONDS

    # --- Deezer: búsqueda y preview medido ---
    deezer = lookup_deezer(run, info, sid, pc)
    deezer_ok = deezer.seconds is not None and deezer.seconds >= MIN_PREVIEW_SECONDS

    if not spotify_ok and not deezer_ok:
        pc.bump("no_audio")
        return False
    if deezer_ok and not spotify_ok:
        pc.bump("eligible_by_deezer_only")
    seconds = spotify_seconds

    row = {
        "spotify_id": sid,
        "title": info.title,
        "artist_name": info.artist,
        # NOT NULL: antes un álbum sin nombre hacía fallar el insert (DATA-04).
        "album_title": info.album_title or run.source.album_title_fallback(sid),
        "cover_url": info.cover_url,
        "duration_ms": info.duration_ms,
        "explicit": info.explicit,
        "release_date": info.release_date,
        "preview_url": info.preview_url,
        "preview_duration_seconds": seconds,
        "deezer_id": deezer.deezer_id,
        "isrc": deezer.isrc,
        "deezer_preview_seconds": deezer.seconds,
        # Solo si la búsqueda terminó (encontrada o no): con un fallo de la API queda a NULL y
        # backfill-deezer.py la volverá a intentar.
        "deezer_checked_at": None if deezer.api_error else datetime.now(timezone.utc).isoformat(),
        "spotify_playlist_id": pl_id,
        "spotify_playlist_name": pl_name,
        "is_active": True,
        # raw_spotify_data ya no se escribe: nadie la lee y D12 la borra (BD-2). Es nullable.
    }
    if run.dry_run:
        log.debug(
            "  [simulación] insertaría %s (spotify %s s, deezer %s s)", sid, seconds, deezer.seconds
        )
        run.catalog.add(sid, key)
        pc.bump("inserted")
        return True
    try:
        run.supabase.table("ecos_songs").insert(row).execute()
    except Exception as ins_err:
        err_msg = str(ins_err)
        # 23505 = unique_violation. Puede venir de spotify_id o del índice único sobre
        # dedupe_key, que es el árbitro final si la clave de Python y la de Postgres discrepan
        # en algún carácter raro.
        if "23505" in err_msg or "duplicate" in err_msg.lower():
            run.catalog.add(sid, key)
            pc.bump("duplicates")
            return False
        pc.bump("insert_errors")
        # El error de Postgres trae la fila entera (título y artista incluidos) y el log de
        # Actions es público: a stdout solo el código y el mensaje. La fila completa va al
        # registro de la base de datos, que solo ve el admin.
        log.warning("  Error al insertar %s: %s", sid, short_db_error(ins_err))
        run.errors.append(f"{info.title} / {info.artist}: {err_msg}")
        return False
    run.catalog.add(sid, key)
    pc.bump("inserted")
    log.debug("  + %s", sid)
    return True


def ingest_playlist(run: Run, pl_idx: int, pl_id: str, pl_name: str, mode: str) -> None:
    log = run.log
    n = run.playlists_total
    pc = Counts(parent=run.totals)

    def failed(error: str) -> None:
        run.playlists_failed += 1
        run.errors.append(f"Playlist {pl_name} ({pl_id}): {error}")
        run.playlist_stats.append({
            "playlist": pl_name,
            "playlist_id": pl_id,
            "status": "error",
            "error": error,
            "tracks_processed": 0,
            "duplicates": 0,
            "no_preview": 0,
            "inserted": 0,
        })

    try:
        all_tracks = run.source.playlist(pl_id).tracks
    except SpotifyError as exc:
        log.warning("[%d/%d] Playlist NO LEÍDA: %s (%s) - %s", pl_idx + 1, n, pl_name, pl_id, exc)
        failed(str(exc))
        return
    if not all_tracks:
        # Una playlist activa sin pistas es un fallo de lectura (o una playlist borrada), no
        # «nada nuevo».
        log.warning("[%d/%d] Playlist SIN PISTAS: %s (%s)", pl_idx + 1, n, pl_name, pl_id)
        failed("la playlist devolvió 0 pistas")
        return

    in_playlist = len(all_tracks)
    if mode == "all":
        blocks = [all_tracks]
    else:
        blocks = [all_tracks[i : i + CHUNK_SIZE] for i in range(0, in_playlist, CHUNK_SIZE)]

    for block in blocks:
        inserted_in_block = 0
        for stub in block:
            # Antes de gastar una petición: lo que ya está en el catálogo no se vuelve a leer.
            key = dedupe_key(stub.title, stub.artist)
            if run.catalog.is_known(stub.spotify_id, key):
                pc.bump("duplicates")
                continue
            if process_track(run, stub, pl_id, pl_name, pc):
                inserted_in_block += 1
        pc.bump("found", len(block))
        if inserted_in_block > 0:
            break

    exhausted = pc["found"] == in_playlist and pc["duplicates"] == in_playlist
    if exhausted:
        run.exhausted.append(pl_name)
    stat = {
        "playlist": pl_name,
        "playlist_id": pl_id,
        "status": "ok",
        "mode": mode,
        "tracks_in_playlist": in_playlist,
        "tracks_processed": pc["found"],
        "duplicates": pc["duplicates"],
        "no_preview": pc.no_preview,
        "no_preview_url": pc["no_preview_url"],
        "preview_short": pc["preview_short"],
        "measure_failed": pc["measure_failed"],
        "deezer_found": pc["deezer_found"],
        "deezer_not_found": pc["deezer_not_found"],
        "deezer_api_error": pc["deezer_api_error"],
        "deezer_short": pc["deezer_short"],
        "eligible_by_deezer_only": pc["eligible_by_deezer_only"],
        "enrich_failed": pc["enrich_failed"],
        "unavailable": pc["unavailable"],
        "inserted": pc["inserted"],
        "possibly_truncated": in_playlist >= SPOTIFY_PLAYLIST_CAP,
        "exhausted": exhausted,
    }
    run.playlist_stats.append(stat)
    log.info(
        "[%d/%d] %s: procesadas %d de %d (modo %s) -> insertadas %d, duplicadas %d, "
        "sin URL %d, preview corto %d, fallo al medir %d, fallo al leer %d, retiradas %d, "
        "Deezer: encontradas %d / no %d / fallo API %d / cortas %d, solo por Deezer %d%s",
        pl_idx + 1, n, pl_name, pc["found"], in_playlist, mode, pc["inserted"], pc["duplicates"],
        pc["no_preview_url"], pc["preview_short"], pc["measure_failed"], pc["enrich_failed"],
        pc["unavailable"], pc["deezer_found"], pc["deezer_not_found"], pc["deezer_api_error"],
        pc["deezer_short"], pc["eligible_by_deezer_only"],
        " [AGOTADA]" if exhausted else "",
    )

    if not run.dry_run:
        try:
            run.supabase.table("ecos_spotify_playlists").update(
                {"last_ingested_at": datetime.now(timezone.utc).isoformat()}
            ).eq("spotify_playlist_id", pl_id).execute()
        except Exception as exc:
            # Es solo la métrica de frescura del panel: no justifica tirar el run.
            log.warning("No se pudo actualizar last_ingested_at de %s: %s", pl_id, exc)


def evaluate(run: Run) -> tuple[str, list[str]]:
    """
    Estado del run y los motivos de que no sea `success`.

    `failure` es lo que hace salir con 1 (y que GitHub avise por email): el scraper o la red están
    rotos, no es una semana tranquila. `partial` es cualquier fallo suelto.
    """
    t = run.totals
    failure: list[str] = []
    partial: list[str] = []

    if run.playlists_total == 0:
        partial.append("no hay playlists activas")
    elif run.playlists_failed == run.playlists_total:
        failure.append("ninguna playlist se pudo leer")
    elif run.playlists_failed / run.playlists_total >= FAIL_RATIO:
        failure.append(f"{run.playlists_failed} de {run.playlists_total} playlists fallaron")
    elif run.playlists_failed:
        partial.append(f"{run.playlists_failed} playlists fallaron")

    if t["enrich_attempts"] >= MIN_SAMPLE and t["enrich_failed"] / t["enrich_attempts"] > FAIL_RATIO:
        failure.append(f"falló la lectura de {t['enrich_failed']} de {t['enrich_attempts']} pistas")
    elif t["enrich_failed"]:
        partial.append(f"{t['enrich_failed']} pistas no se pudieron leer")

    if t["measure_attempts"] >= MIN_SAMPLE and t["measure_failed"] / t["measure_attempts"] > FAIL_RATIO:
        failure.append(f"falló la medición de {t['measure_failed']} de {t['measure_attempts']} previews")
    elif t["measure_failed"]:
        partial.append(f"{t['measure_failed']} previews no se pudieron medir")

    if t["candidates"] >= MIN_SAMPLE_NO_URL and t["no_preview_url"] == t["candidates"]:
        failure.append(f"ninguna de las {t['candidates']} pistas nuevas trae preview_url")

    # Deezer es la fuente principal, pero Spotify cubre: un fallo de su API deja el run en
    # `partial` (las pistas sin datos de Deezer las completa backfill-deezer.py).
    if t["deezer_api_error"]:
        partial.append(f"falló la API de Deezer con {t['deezer_api_error']} pistas")

    if t["insert_errors"]:
        (failure if t["inserted"] == 0 else partial).append(f"{t['insert_errors']} errores al insertar")

    if failure:
        return "failure", failure + partial
    if partial:
        return "partial", partial
    return "success", []


def build_details(run: Run, status_reasons: list[str]) -> dict:
    t = run.totals
    details: dict[str, Any] = {
        "playlists_checked": run.playlists_total,
        "playlists_failed": run.playlists_failed,
        "tracks_found": t["found"],
        "duplicates": t["duplicates"],
        # `no_preview` son las pistas que no entran por no tener audio en ninguna fuente (así lo
        # etiqueta el panel). Antes de oct. 2026 era la suma de las tres causas de Spotify; ahora
        # esas tres son datos de Spotify aunque Deezer rescate la pista.
        "no_preview": t.no_preview,
        "no_audio": t["no_audio"],
        "no_preview_url": t["no_preview_url"],
        "preview_short": t["preview_short"],
        "measure_failed": t["measure_failed"],
        "enrich_failed": t["enrich_failed"],
        "unavailable": t["unavailable"],
        "deezer_found": t["deezer_found"],
        "deezer_not_found": t["deezer_not_found"],
        "deezer_api_error": t["deezer_api_error"],
        "deezer_short": t["deezer_short"],
        "eligible_by_deezer_only": t["eligible_by_deezer_only"],
        "songs_added": t["inserted"],
        "min_preview_seconds": MIN_PREVIEW_SECONDS,
        "preview_short_buckets": run.short_buckets,
        "exhausted_playlists": run.exhausted,
        "playlist_stats": run.playlist_stats,
    }
    if status_reasons:
        details["reasons"] = status_reasons
    return details


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingesta semanal desde las playlists activas de Spotify.")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="simulación: lee Spotify y la base de datos y mide los previews, pero no escribe nada",
    )
    p.add_argument(
        "--playlist",
        action="append",
        metavar="ID",
        help="(solo con --dry-run) limita la simulación a esta playlist; se puede repetir",
    )
    args = p.parse_args()
    if args.playlist and not args.dry_run:
        p.error("--playlist solo se admite con --dry-run")
    return args


def main() -> None:
    args = parse_args()
    load_env()
    log = setup_logging("ingest", verbose=True)
    start_ms = now_ms()
    dry_run: bool = args.dry_run
    supabase = get_supabase(log, read_only=dry_run)
    if dry_run:
        log.info("SIMULACIÓN: no se escribe nada en la base de datos")

    def record(status: str, summary: str, details: dict, errors: list[str] | None = None) -> bool:
        if dry_run:
            log.info("[simulación] registro %s: %s", status, summary)
            return True
        return log_job(
            supabase, JOB_INGESTION, status, summary,
            start_ms=start_ms, details=details, errors=errors, log=log,
        )

    run: Run | None = None
    try:
        with SpotifySource() as source:
            run = Run(log, supabase, source, dry_run)
            log.info("=== Ingesta semanal Ecos ===")
            existing_rows = fetch_all(
                lambda: supabase.table("ecos_songs").select("spotify_id, title, artist_name", count="exact")
            )
            run.catalog = Catalog(existing_rows)
            log.info("Catálogo cargado para deduplicar: %d canciones", len(existing_rows))

            playlists = load_active_playlists(supabase)
            if args.playlist:
                playlists = [p for p in playlists if p[0] in set(args.playlist)]
            run.playlists_total = len(playlists)
            log.info("Playlists activas: %d", len(playlists))
            if not playlists:
                log.warning("No hay playlists activas en ecos_spotify_playlists")

            for idx, (pl_id, pl_name, mode) in enumerate(playlists):
                ingest_playlist(run, idx, pl_id, pl_name, mode)
    except (Exception, KeyboardInterrupt) as exc:
        # Sin esto, un fallo inesperado (red caída al cargar el catálogo, timeout de Actions...)
        # no dejaba fila y el run solo quedaba rojo en GitHub: el 14 y el 21 de junio no hay
        # registro en la base de datos.
        message = f"{type(exc).__name__}: {exc}"
        log.error("La ingesta se interrumpió: %s", message)
        log.error("%s", traceback.format_exc())
        gh_annotation("error", f"Ingesta interrumpida: {message}")
        details = build_details(run, ["interrumpida"]) if run else {}
        details["interrupted"] = message
        record(
            "failure",
            f"Interrumpida: {message}"[:200],
            details,
            [message, *(run.errors if run else [])],
        )
        sys.exit(1)

    assert run is not None  # si no, el except de arriba ya salió con 1
    t = run.totals
    status, reasons = evaluate(run)
    if status == "success":
        summary = f"{t['inserted']} canciones insertadas" if t["inserted"] else "Sin canciones nuevas"
    else:
        summary = f"{t['inserted']} insertadas; " + "; ".join(reasons)

    log.info("=== Resumen ===")
    log.info(
        "Encontradas: %d | Duplicadas: %d | Sin URL: %d | Preview corto: %d | Fallo al medir: %d | "
        "Fallo al leer: %d | Retiradas: %d | Insertadas: %d",
        t["found"], t["duplicates"], t["no_preview_url"], t["preview_short"], t["measure_failed"],
        t["enrich_failed"], t["unavailable"], t["inserted"],
    )
    log.info(
        "Deezer: encontradas %d | No encontradas: %d | Fallo de la API: %d | Preview corto: %d | "
        "Entran solo por Deezer: %d | Sin audio en ninguna fuente: %d",
        t["deezer_found"], t["deezer_not_found"], t["deezer_api_error"], t["deezer_short"],
        t["eligible_by_deezer_only"], t["no_audio"],
    )
    if run.short_buckets:
        log.info("Previews cortos por duración: %s", run.short_buckets)
    if run.exhausted:
        log.info("Playlists agotadas (todo lo que traen ya está en el catálogo): %s", ", ".join(run.exhausted))
    log.info("Estado: %s%s", status, f" ({'; '.join(reasons)})" if reasons else "")
    if status != "success":
        gh_annotation("error" if status == "failure" else "warning", f"Ingesta {status}: {summary}")

    saved = record(status, summary, build_details(run, reasons), run.errors)
    if status == "failure" or not saved:
        sys.exit(1)


if __name__ == "__main__":
    main()
