#!/usr/bin/env python3
"""
Relleno de Deezer: busca en Deezer cada canción ACTIVA del catálogo que aún no tiene `deezer_id` y
guarda `deezer_id`, `isrc`, `deezer_preview_seconds` y `deezer_checked_at`. Se ejecuta a mano, en
local, una vez tras aplicar la migración 20261010120000 (después pasa a scripts/archivo/); el
`job_type` `deezer_backfill` se queda en la base de datos porque los registros históricos lo usan.

Qué hace con cada canción (mismas reglas que la ingesta, ver deezer_source.py):
- Encontrada: se guarda todo; el preview se mide con preview_audio.measure_mp3 (la URL de Deezer
  va firmada y caduca, no se guarda).
- No encontrada: solo `deezer_checked_at`, para que otra pasada la salte. `--recheck` vuelve a
  mirar también las ya comprobadas sin éxito.
- Fallo de la API (o del CDN al medir): no se escribe nada de esa canción, y se cuenta aparte. Un
  fallo no es «no encontrada».

`--dry-run` no escribe nada (cliente de solo lectura) ni registra, pero sí llama a Deezer. Si la
migración aún no está aplicada, el dry-run lee sin las columnas nuevas y lo avisa; la pasada real
exige la migración.

Informe por stdout: contadores, cuántas canciones pasan a ser elegibles sin serlo antes, hosts del
CDN vistos y una muestra de hasta SAMPLE_SIZE emparejamientos para escuchar y validar. La muestra
sale SOLO de canciones de juegos con fecha anterior a hoy en Madrid, con enlace de Deezer: nunca
se imprime el título de una canción de hoy, de un reto futuro ni de una que no ha salido aún. El
registro en ecos_system_logs lleva solo totales.

Uso:
  python scripts/backfill-deezer.py --dry-run
  python scripts/backfill-deezer.py                  # pasada real
  python scripts/backfill-deezer.py --recheck        # incluye las ya buscadas sin éxito

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import random
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from common import (
    JOB_DEEZER_BACKFILL,
    MADRID,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)

try:
    from db_paging import fetch_all
    from deezer_source import DeezerApiError, find_track, preview_host
    from preview_audio import PreviewFetchError, PreviewInvalidError, measure_mp3
    from selection import MIN_PREVIEW_SECONDS, is_eligible
except ImportError as e:
    print(f"Error importando dependencias: {e}")
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

BASE_COLUMNS = (
    "id, title, artist_name, duration_ms, preview_url, preview_duration_seconds, "
    "spotify_playlist_id"
)
DEEZER_COLUMNS = "deezer_id, isrc, deezer_preview_seconds, deezer_checked_at"
SAMPLE_SIZE = 20
WORKERS = 4
# Por debajo de MIN_SAMPLE canciones un porcentaje no dice nada.
FAIL_RATIO = 0.5
MIN_SAMPLE = 10


@dataclass(frozen=True)
class Outcome:
    song: dict
    kind: str  # found | not_found | api_error
    deezer_id: int | None = None
    isrc: str | None = None
    seconds: float | None = None
    host: str | None = None
    error: str | None = None


def lookup(song: dict) -> Outcome:
    """Busca y mide una canción. Nunca lanza: un fallo se devuelve como `api_error`."""
    try:
        match = find_track(song["artist_name"], song["title"], song.get("duration_ms"))
    except DeezerApiError as exc:
        return Outcome(song, "api_error", error=str(exc))
    if match is None:
        return Outcome(song, "not_found")
    host = preview_host(match.preview_url)
    if not match.preview_url:
        # Deezer conoce la pista pero no da preview: se guarda el id sin duración.
        return Outcome(song, "found", match.deezer_id, match.isrc, None, host)
    try:
        seconds = measure_mp3(match.preview_url)
    except (PreviewFetchError, PreviewInvalidError) as exc:
        return Outcome(song, "api_error", error=f"medir preview: {exc}")
    return Outcome(song, "found", match.deezer_id, match.isrc, seconds, host)


def load_songs(supabase: Any, dry_run: bool, log: Any) -> tuple[list[dict], bool]:
    """Canciones activas. Devuelve (filas, tiene_columnas_de_deezer)."""
    try:
        rows = fetch_all(
            lambda: supabase.table("ecos_songs")
            .select(f"{BASE_COLUMNS}, {DEEZER_COLUMNS}", count="exact")
            .eq("is_active", True)
        )
        return rows, True
    except Exception as exc:
        if not (dry_run and getattr(exc, "code", None) == "42703"):
            raise
        log.warning(
            "La BD aún no tiene las columnas de Deezer (migración pendiente): "
            "la simulación sigue sin ellas, como si ninguna canción estuviera comprobada"
        )
        rows = fetch_all(
            lambda: supabase.table("ecos_songs").select(BASE_COLUMNS, count="exact").eq("is_active", True)
        )
        return rows, False


def played_song_ids(supabase: Any, today: str) -> set[str]:
    """Canciones de juegos con fecha anterior a hoy (Madrid): las únicas que pueden mostrarse."""
    rows = fetch_all(
        lambda: supabase.table("ecos_games").select("song_id, date", count="exact").lt("date", today)
    )
    return {str(r["song_id"]) for r in rows}


def main() -> None:
    p = argparse.ArgumentParser(description="Rellena deezer_id e isrc de las canciones activas.")
    p.add_argument("--dry-run", action="store_true", help="llama a Deezer y cuenta, pero no escribe ni registra")
    p.add_argument("--recheck", action="store_true", help="incluye las canciones ya buscadas sin éxito")
    p.add_argument("--limit", type=int, help="solo las N primeras canciones (para probar)")
    p.add_argument("--seed", type=int, help="semilla de la muestra para escuchar")
    args = p.parse_args()

    load_env()
    log = setup_logging("backfill-deezer")
    start_ms = now_ms()
    dry_run: bool = args.dry_run
    supabase = get_supabase(log, read_only=dry_run)
    if dry_run:
        log.info("SIMULACIÓN: no se escribe nada en la base de datos")
    today = datetime.now(MADRID).date().isoformat()

    c = dict.fromkeys(
        ("songs_checked", "found", "not_found", "api_errors", "short", "became_eligible",
         "updated", "update_errors", "duplicate_deezer_ids", "no_preview"),
        0,
    )
    hosts: set[str] = set()
    errors: list[str] = []

    try:
        songs, has_columns = load_songs(supabase, dry_run, log)
        playlists = (
            supabase.table("ecos_spotify_playlists").select("spotify_playlist_id").eq("is_active", True).execute()
        )
        active_playlists = {
            (r.get("spotify_playlist_id") or "").strip() for r in (playlists.data or []) if r.get("spotify_playlist_id")
        }
        todo = [
            s for s in songs
            if s.get("title") and s.get("artist_name") and not s.get("deezer_id")
            and (args.recheck or not s.get("deezer_checked_at"))
        ]
        if args.limit:
            todo = todo[: args.limit]
        log.info("Canciones activas: %d; por comprobar: %d", len(songs), len(todo))
        eligible_before = sum(1 for s in songs if is_eligible(s, active_playlists))

        matches: list[Outcome] = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for n, out in enumerate(pool.map(lookup, todo), start=1):
                c["songs_checked"] += 1
                song = out.song
                update: dict[str, Any] | None = None
                if out.kind == "api_error":
                    c["api_errors"] += 1
                    if len(errors) < 5:
                        errors.append(f"canción {song['id']}: {out.error}")
                elif out.kind == "not_found":
                    c["not_found"] += 1
                    update = {"deezer_checked_at": datetime.now(timezone.utc).isoformat()}
                else:
                    c["found"] += 1
                    matches.append(out)
                    if out.host:
                        hosts.add(out.host)
                    if out.seconds is None:
                        c["no_preview"] += 1
                    elif out.seconds < MIN_PREVIEW_SECONDS:
                        c["short"] += 1
                    after = {**song, "deezer_id": out.deezer_id, "deezer_preview_seconds": out.seconds}
                    if not is_eligible(song, active_playlists) and is_eligible(after, active_playlists):
                        c["became_eligible"] += 1
                    update = {
                        "deezer_id": out.deezer_id,
                        "isrc": out.isrc,
                        "deezer_preview_seconds": out.seconds,
                        "deezer_checked_at": datetime.now(timezone.utc).isoformat(),
                    }
                if update and not dry_run:
                    try:
                        supabase.table("ecos_songs").update(update).eq("id", song["id"]).execute()
                        c["updated"] += 1
                    except Exception as exc:
                        c["update_errors"] += 1
                        code, msg = getattr(exc, "code", None), getattr(exc, "message", None)
                        if len(errors) < 5:
                            errors.append(f"update {song['id']}: {code or type(exc).__name__}: {msg or ''}"[:200])
                if n % 100 == 0:
                    log.info("  %d/%d (encontradas %d, no %d, fallos API %d)",
                             n, len(todo), c["found"], c["not_found"], c["api_errors"])

        ids = [m.deezer_id for m in matches]
        c["duplicate_deezer_ids"] = len(ids) - len(set(ids))
        played = played_song_ids(supabase, today) if matches else set()
    except (Exception, KeyboardInterrupt) as exc:
        message = f"{type(exc).__name__}: {exc}"
        log.error("El relleno se interrumpió: %s", message)
        log.error("%s", traceback.format_exc())
        gh_annotation("error", f"Relleno de Deezer interrumpido: {message}")
        if not dry_run:
            log_job(supabase, JOB_DEEZER_BACKFILL, "failure", f"Interrumpido: {message}"[:200],
                    start_ms=start_ms, details={**c, "interrupted": message}, errors=[message, *errors], log=log)
        sys.exit(1)

    n_checked = c["songs_checked"]
    log.info("=== Informe ===")
    log.info("Columnas de Deezer en la BD: %s", "sí" if has_columns else "NO (migración pendiente)")
    log.info("Comprobadas: %d | Encontradas: %d | No encontradas: %d | Fallo de API: %d",
             n_checked, c["found"], c["not_found"], c["api_errors"])
    log.info("Encontradas con preview corto (< %gs): %d | sin preview: %d | deezer_id repetido: %d",
             MIN_PREVIEW_SECONDS, c["short"], c["no_preview"], c["duplicate_deezer_ids"])
    log.info("Elegibles antes: %d | pasan a elegibles gracias a Deezer: %d", eligible_before, c["became_eligible"])
    log.info("Hosts del CDN vistos: %s", ", ".join(sorted(hosts)) or "ninguno")
    if not dry_run:
        log.info("Actualizadas: %d | errores al actualizar: %d", c["updated"], c["update_errors"])

    # Muestra para escuchar: solo canciones de juegos anteriores a hoy (Madrid).
    candidates = [m for m in matches if str(m.song["id"]) in played]
    sample = random.Random(args.seed).sample(candidates, min(SAMPLE_SIZE, len(candidates)))
    log.info("Muestra para escuchar (%d de %d emparejamientos de juegos pasados):", len(sample), len(candidates))
    for m in sample:
        secs = f"{m.seconds:.1f}s" if m.seconds is not None else "sin preview"
        log.info("  %s — %s -> https://www.deezer.com/track/%s (%s)",
                 m.song["artist_name"], m.song["title"], m.deezer_id, secs)

    if n_checked >= MIN_SAMPLE and c["api_errors"] / n_checked > FAIL_RATIO:
        status = "failure"
    elif c["api_errors"] or c["update_errors"]:
        status = "partial"
    else:
        status = "success"
    summary = (
        f"{c['found']} encontradas, {c['not_found']} no, {c['api_errors']} fallos de API; "
        f"{c['became_eligible']} pasan a elegibles"
    )
    log.info("Estado: %s", status)
    details = {**c, "cdn_hosts": sorted(hosts), "recheck": bool(args.recheck),
               "min_preview_seconds": MIN_PREVIEW_SECONDS}
    if dry_run:
        log.info("[simulación] registro %s: %s", status, summary)
        return
    saved = log_job(supabase, JOB_DEEZER_BACKFILL, status, summary,
                    start_ms=start_ms, details=details, errors=errors, log=log)
    if status == "failure" or not saved:
        sys.exit(1)


if __name__ == "__main__":
    main()
