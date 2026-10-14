#!/usr/bin/env python3
"""
Enriquecimiento de metadatos: rellena en las canciones ACTIVAS la fecha y los géneros de Deezer y
el idioma, el país y los géneros de MusicBrainz. Alimenta las facetas del modo por categorías
(década, género y origen: ecos_song_facets en supabase/schema/02_functions.sql).

Qué hace con cada canción (reanudable: salta lo que ya está comprobado):
- Deezer (si tiene `deezer_id` y `deezer_meta_checked_at` es NULL): `GET /track/{id}` da la fecha y
  el álbum; `GET /album/{id}` los géneros (caché por álbum en memoria).
- MusicBrainz (si tiene `isrc` y `mb_checked_at` es NULL): por ISRC, el idioma de la obra y el
  artista principal; de ahí, país y géneros. Va a 1 petición por segundo: la pasada completa
  tarda ~1 h, y la ingesta semanal solo trae unas pocas canciones.
- `*_checked_at` solo se marca con una respuesta definitiva: encontrado o «no existe». Un fallo de
  la API no escribe nada de esa canción y se cuenta aparte (fallo no es «no encontrada»).

`--dry-run` no escribe nada (cliente de solo lectura) ni registra, pero sí llama a las APIs. Si la
migración 20261014120000 aún no está aplicada, el dry-run lee sin las columnas nuevas y lo avisa;
la pasada real la exige.

El repo es público y los logs se ven: el script NUNCA lee ni imprime título ni artista de ninguna
canción, solo ids. Los informes son agregados.

Uso:
  python scripts/enrich-metadata.py --dry-run --limit 15
  python scripts/enrich-metadata.py                     # pasada real
  python scripts/enrich-metadata.py --only deezer       # o --only mb

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import sys
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from common import (
    JOB_METADATA_ENRICH,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)

try:
    from db_paging import fetch_all
    from deezer_source import DeezerApiError, album_genre_ids, track_meta
    from musicbrainz_source import MusicBrainzError, lookup_artist, lookup_isrc
except ImportError as e:
    print(f"Error importando dependencias: {e}")
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

BASE_COLUMNS = "id, deezer_id, isrc"
META_COLUMNS = "deezer_meta_checked_at, mb_checked_at"
WORKERS = 4
FAIL_RATIO = 0.5
MIN_SAMPLE = 10
TOP_N = 15


@dataclass
class Outcome:
    song_id: str
    kind: str  # found | not_found | api_error
    update: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    language: str | None = None
    country: str | None = None
    genres: list[str] = field(default_factory=list)
    deezer_genres: list[int] = field(default_factory=list)
    year: str | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def deezer_lookup(song: dict) -> Outcome:
    """Fecha y géneros de Deezer. Nunca lanza: un fallo se devuelve como `api_error`."""
    sid = str(song["id"])
    try:
        meta = track_meta(int(song["deezer_id"]))
        if meta is None:
            return Outcome(sid, "not_found", {"deezer_meta_checked_at": now_iso()})
        genres = album_genre_ids(meta.album_id) if meta.album_id else None
    except DeezerApiError as exc:
        return Outcome(sid, "api_error", error=str(exc))
    update = {
        "deezer_release_date": meta.release_date,
        "deezer_genre_ids": genres or None,
        "deezer_meta_checked_at": now_iso(),
    }
    return Outcome(sid, "found", update, deezer_genres=genres or [],
                   year=meta.release_date[:4] if meta.release_date else None)


def mb_lookup(song: dict) -> Outcome:
    """Idioma, país y géneros de MusicBrainz por ISRC. Nunca lanza."""
    sid = str(song["id"])
    isrc = str(song["isrc"]).strip().upper()
    try:
        info = lookup_isrc(isrc)
        if info is None:
            return Outcome(sid, "not_found", {"mb_checked_at": now_iso()})
        country = info.artist_country
        genres: list[str] = []
        if info.artist_mbid:
            artist = lookup_artist(info.artist_mbid)
            if artist is not None:
                country = artist.country or country
                genres = artist.genres
    except MusicBrainzError as exc:
        return Outcome(sid, "api_error", error=str(exc))
    update = {
        "mb_language": info.language,
        "mb_artist_country": country,
        "mb_genres": genres or None,
        "mb_checked_at": now_iso(),
    }
    return Outcome(sid, "found", update, language=info.language, country=country, genres=genres)


def load_songs(supabase: Any, dry_run: bool, log: Any) -> tuple[list[dict], bool]:
    """Canciones activas (solo ids y marcas). Devuelve (filas, tiene_columnas_nuevas)."""
    try:
        rows = fetch_all(
            lambda: supabase.table("ecos_songs")
            .select(f"{BASE_COLUMNS}, {META_COLUMNS}", count="exact")
            .eq("is_active", True)
        )
        return rows, True
    except Exception as exc:
        if not (dry_run and getattr(exc, "code", None) == "42703"):
            raise
        log.warning(
            "La BD aún no tiene las columnas de metadatos (migración pendiente): "
            "la simulación sigue sin ellas, como si ninguna canción estuviera comprobada"
        )
        rows = fetch_all(
            lambda: supabase.table("ecos_songs").select(BASE_COLUMNS, count="exact").eq("is_active", True)
        )
        return rows, False


def top(counter: Counter, n: int = TOP_N) -> dict[str, int]:
    return dict(counter.most_common(n))


def main() -> None:
    p = argparse.ArgumentParser(description="Rellena metadatos de Deezer y MusicBrainz de las canciones activas.")
    p.add_argument("--dry-run", action="store_true", help="llama a las APIs y cuenta, pero no escribe ni registra")
    p.add_argument("--limit", type=int, help="solo las N primeras canciones pendientes (para probar)")
    p.add_argument("--only", choices=("deezer", "mb"), help="solo una de las dos fuentes")
    args = p.parse_args()

    load_env()
    log = setup_logging("enrich-metadata")
    start_ms = now_ms()
    dry_run: bool = args.dry_run
    supabase = get_supabase(log, read_only=dry_run)
    if dry_run:
        log.info("SIMULACIÓN: no se escribe nada en la base de datos")

    c = dict.fromkeys(
        ("songs_checked", "deezer_checked", "deezer_found", "deezer_not_found", "deezer_with_date",
         "deezer_with_genres", "mb_checked", "mb_found", "mb_not_found", "mb_with_language",
         "mb_with_country", "mb_with_genres", "api_errors", "updated", "update_errors"),
        0,
    )
    languages: Counter = Counter()
    countries: Counter = Counter()
    mb_genres: Counter = Counter()
    deezer_genres: Counter = Counter()
    decades: Counter = Counter()
    errors: list[str] = []

    def save(out: Outcome) -> None:
        """Cuenta el resultado y, si procede, lo escribe. Solo `found` y `not_found` marcan."""
        if out.kind == "api_error":
            c["api_errors"] += 1
            if len(errors) < 5:
                errors.append(f"canción {out.song_id}: {out.error}"[:200])
            return
        if not dry_run:
            try:
                supabase.table("ecos_songs").update(out.update).eq("id", out.song_id).execute()
                c["updated"] += 1
            except Exception as exc:
                c["update_errors"] += 1
                code, msg = getattr(exc, "code", None), getattr(exc, "message", None)
                if len(errors) < 5:
                    errors.append(f"update {out.song_id}: {code or type(exc).__name__}: {msg or ''}"[:200])

    try:
        songs, has_columns = load_songs(supabase, dry_run, log)
        want_deezer = args.only in (None, "deezer")
        want_mb = args.only in (None, "mb")
        todo_deezer = [s for s in songs if want_deezer and s.get("deezer_id") and not s.get("deezer_meta_checked_at")]
        todo_mb = [s for s in songs if want_mb and s.get("isrc") and not s.get("mb_checked_at")]
        if args.limit:
            # El límite es de canciones, no de consultas: las primeras N con algo pendiente.
            pending = {str(s["id"]) for s in [*todo_deezer, *todo_mb]}
            keep = {str(s["id"]) for s in songs if str(s["id"]) in pending}
            keep = set(sorted(keep)[: args.limit])
            todo_deezer = [s for s in todo_deezer if str(s["id"]) in keep]
            todo_mb = [s for s in todo_mb if str(s["id"]) in keep]
        c["songs_checked"] = len({str(s["id"]) for s in [*todo_deezer, *todo_mb]})
        log.info("Canciones activas: %d; con algo pendiente: %d (Deezer %d, MusicBrainz %d)",
                 len(songs), c["songs_checked"], len(todo_deezer), len(todo_mb))

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for n, out in enumerate(pool.map(deezer_lookup, todo_deezer), start=1):
                c["deezer_checked"] += 1
                if out.kind == "found":
                    c["deezer_found"] += 1
                    if out.update.get("deezer_release_date"):
                        c["deezer_with_date"] += 1
                        decades[f"{out.year[:3]}0s"] += 1  # type: ignore[index]
                    if out.deezer_genres:
                        c["deezer_with_genres"] += 1
                        deezer_genres.update(str(g) for g in out.deezer_genres)
                elif out.kind == "not_found":
                    c["deezer_not_found"] += 1
                save(out)
                if n % 100 == 0:
                    log.info("  Deezer %d/%d", n, len(todo_deezer))

        # MusicBrainz va en serie: su propio límite (1 petición/s) ya manda.
        for n, song in enumerate(todo_mb, start=1):
            out = mb_lookup(song)
            c["mb_checked"] += 1
            if out.kind == "found":
                c["mb_found"] += 1
                if out.language:
                    c["mb_with_language"] += 1
                    languages[out.language] += 1
                if out.country:
                    c["mb_with_country"] += 1
                    countries[out.country] += 1
                if out.genres:
                    c["mb_with_genres"] += 1
                    mb_genres.update(out.genres)
            elif out.kind == "not_found":
                c["mb_not_found"] += 1
            save(out)
            if n % 50 == 0:
                log.info("  MusicBrainz %d/%d (encontradas %d, no %d, fallos %d)",
                         n, len(todo_mb), c["mb_found"], c["mb_not_found"], c["api_errors"])
    except (Exception, KeyboardInterrupt) as exc:
        message = f"{type(exc).__name__}: {exc}"
        log.error("El enriquecimiento se interrumpió: %s", message)
        log.error("%s", traceback.format_exc())
        gh_annotation("error", f"Enriquecimiento de metadatos interrumpido: {message}")
        if not dry_run:
            log_job(supabase, JOB_METADATA_ENRICH, "failure", f"Interrumpido: {message}"[:200],
                    start_ms=start_ms, details={**c, "interrupted": message}, errors=[message, *errors], log=log)
        sys.exit(1)

    log.info("=== Informe (agregado, sin títulos ni artistas) ===")
    log.info("Columnas de metadatos en la BD: %s", "sí" if has_columns else "NO (migración pendiente)")
    log.info("Canciones con algo pendiente: %d | fallos de API: %d", c["songs_checked"], c["api_errors"])
    log.info("Deezer: %d consultadas | con datos %d | sin datos %d | con fecha %d | con géneros %d",
             c["deezer_checked"], c["deezer_found"], c["deezer_not_found"], c["deezer_with_date"],
             c["deezer_with_genres"])
    log.info("  Décadas (fecha de Deezer): %s", dict(sorted(decades.items())) or "ninguna")
    log.info("  Géneros de Deezer (ids): %s", top(deezer_genres) or "ninguno")
    log.info("MusicBrainz: %d consultadas | encontradas %d | no están %d | con idioma %d | con país %d | con géneros %d",
             c["mb_checked"], c["mb_found"], c["mb_not_found"], c["mb_with_language"], c["mb_with_country"],
             c["mb_with_genres"])
    log.info("  Idiomas: %s", top(languages) or "ninguno")
    log.info("  Países: %s", top(countries) or "ninguno")
    log.info("  Géneros de artista: %s", top(mb_genres) or "ninguno")
    if not dry_run:
        log.info("Actualizadas: %d | errores al actualizar: %d", c["updated"], c["update_errors"])

    n_checked = c["deezer_checked"] + c["mb_checked"]
    if n_checked >= MIN_SAMPLE and c["api_errors"] / n_checked > FAIL_RATIO:
        status = "failure"
    elif c["api_errors"] or c["update_errors"]:
        status = "partial"
    else:
        status = "success"
    summary = (
        f"Deezer {c['deezer_found']}/{c['deezer_checked']}, MusicBrainz {c['mb_found']}/{c['mb_checked']}, "
        f"{c['api_errors']} fallos de API"
    )
    log.info("Estado: %s", status)
    details = {**c, "languages": top(languages), "countries": top(countries), "only": args.only}
    if dry_run:
        log.info("[simulación] registro %s: %s", status, summary)
        return
    if n_checked == 0:
        log.info("Nada pendiente: no se registra.")
        return
    saved = log_job(supabase, JOB_METADATA_ENRICH, status, summary,
                    start_ms=start_ms, details=details, errors=errors, log=log)
    if status == "failure" or not saved:
        sys.exit(1)


if __name__ == "__main__":
    main()
