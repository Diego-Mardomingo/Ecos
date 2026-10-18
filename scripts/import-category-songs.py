#!/usr/bin/env python3
"""
Importa una lista curada de canciones a una categoría curada del modo por categorías
(`pop-ingles`, `rock-ingles`). Script MANUAL: se ejecuta a mano, en local.

Para cada fila del CSV (cabecera `rank,title,artist,featuring,year,reserve,source`):
- Busca la pista en Deezer (búsqueda simple: la avanzada `artist:"…" track:"…"` devuelve vacío,
  ver deezer_source.py) y elige la versión original: artista principal igual, título igual sin
  sufijos («- Remastered», «(feat. …)», «- Radio Edit»…), sin live/remix/karaoke/cover, y entre
  las válidas la de mayor `rank` de Deezer. El preview se mide (la URL va firmada y caduca; no se
  guarda) y tiene que durar `MIN_PREVIEW_SECONDS` como mínimo.
- Si ya hay una canción ACTIVA con la misma clave de dedupe (o el mismo `deezer_id` / `isrc`), no
  inserta: enlaza la existente a la categoría sin tocar su `daily_eligible`.
- Si no, inserta la canción con `daily_eligible = false` (solo para categorías: no puede salir en
  el reto diario) y la enlaza en `ecos_category_songs` con `position = rank`.

Objetivo `--target` (150) canciones válidas en la categoría: primero las principales
(`reserve=0`) y, si alguna falla, reservas en orden hasta llegar. Las ya enlazadas cuentan.
Es idempotente: relanzarlo no duplica nada.

Un fallo de la API de Deezer (tras los reintentos) deja la fila como «error», nunca como «no
encontrada». `--dry-run` no escribe ni registra (cliente de solo lectura), pero sí llama a Deezer
y enseña la tabla de emparejamientos. Los títulos y artistas pueden salir en los logs: no son
retos diarios.

Uso:
  python scripts/import-category-songs.py --category pop-ingles --csv RUTA.csv --dry-run
  python scripts/import-category-songs.py --category pop-ingles --csv RUTA.csv

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import traceback
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import (
    JOB_CATEGORY_IMPORT,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)

try:
    from db_paging import fetch_all
    from deezer_source import (
        DeezerApiError,
        DeezerCandidate,
        DeezerTrackDetail,
        album_genre_ids,
        search_tracks,
        track_detail,
    )
    from preview_audio import PreviewFetchError, PreviewInvalidError, measure_mp3
    from selection import MIN_PREVIEW_SECONDS
    from song_key import dedupe_key, version_key
except ImportError as e:
    print(f"Error importando dependencias: {e}")
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

DEFAULT_TARGET = 150
SEARCH_LIMIT = 25
TITLE_ONLY_LIMIT = 50
# Cuántos candidatos válidos se prueban (por rank) hasta dar con uno con preview suficiente.
MAX_CANDIDATES = 5
# Una diferencia de año mayor que esta entre Deezer y el CSV indica recopilatorio o remaster.
YEAR_TOLERANCE = 1
FAIL_RATIO = 0.5
MIN_SAMPLE = 10

# Estados de fila.
NEW = "nuevo"
EXISTING = "existente"
LINKED = "ya en categoría"
NOT_FOUND = "no encontrado"
NO_PREVIEW = "sin preview"
ERROR = "error"
DUPLICATE = "duplicado en CSV"
OK_STATES = (NEW, EXISTING, LINKED)

# --- Normalización ---

_PARENS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
_DASH_SUFFIX = re.compile(r"\s+-\s+.*$")
_FEAT = re.compile(r"\s+(feat\.?|featuring|ft\.?|with)\s+.*$")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_BANG_IN_WORD = re.compile(r"(?<=[a-z])!(?=[a-z])")
# Marcas de otra versión. Se rechaza el candidato si las trae en título o álbum y el CSV no.
_VERSION_WORDS = re.compile(
    r"\b(live|en vivo|unplugged|remix|remixed|remixes|karaoke|cover|covers|tribute|originally|"
    r"performed|instrumental|acoustic|sped up|speed up|slowed|reverb|made famous|"
    r"in the style|demo|rendition|lullaby|workout|ringtone|8 bit|piano version|orchestral|"
    r"nightcore|a cappella|acapella|mashup|rework|bootleg|extended|club|dub|sessions?|"
    r"glee|cast|mtv|bbc|backing track|alternate|alternative|reprise|outtake|rough|"
    r"(?<!single )(?<!album )(?<!original )(?<!lp )(?<!mono )(?<!stereo )(?<!remastered )"
    r"(?<!radio )(?<!\d{4} )version|"
    r"(?<!radio )(?<!single )(?<!album )(?<!original )(?<!lp )mix)\b"
)
# En el título del ÁLBUM solo estas cuentan: una pista original puede vivir en un álbum de «Remixes»
# o en uno llamado «Stripped».
_ALBUM_BAD = re.compile(
    r"\b(live|en vivo|unplugged|karaoke|tributes?|covers?|in the style|originally|instrumentals?|"
    r"lullaby|workout|8 bit|piano versions?|orchestral|nightcore)\b"
)
# Marcas de versión «sin más»: valen, pero se prefiere la versión de álbum si existe.
_PLAIN_PENALTY = re.compile(r"\b(radio|edit|single|mono|version|from)\b")
_UNACCENT = str.maketrans({"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ł": "l"})


def fold(s: str | None) -> str:
    """Minúsculas y sin acentos."""
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if not unicodedata.combining(c)).lower().translate(_UNACCENT)


def compact(s: str) -> str:
    """Solo letras y números, «&» como «and» y «P!nk» como «pink»."""
    t = fold(s).replace("&", " and ").replace("’", "'")
    t = _BANG_IN_WORD.sub("i", t).replace("'", "")
    return _NON_ALNUM.sub("", t)


def norm_artist(s: str) -> str:
    t = re.sub(r"^\s*the\s+", "", fold(s))
    return compact(t)


def norm_title(s: str) -> str:
    """Título comparable: sin paréntesis, sufijo « - …», «feat.», acentos ni puntuación."""
    t = fold(s)
    stripped = _FEAT.sub("", _DASH_SUFFIX.sub("", _PARENS.sub("", t)))
    return compact(stripped) or compact(t)


def version_words(s: str) -> set[str]:
    return set(_VERSION_WORDS.findall(fold(s).replace("-", " ")))


# «(Soul Seekerz Radio Edit)», «(Jason Nevins Rock Da Edit)»: una edición con nombre propio es un
# remix; «(Radio Edit)», «(Remastered Radio Edit)» o «- Single Version» son la misma grabación.
_NAMED_EDIT = re.compile(
    r"[(\[-]\s*(?!radio (?:edit|mix)|remaster|single|album|original|mono|stereo|\d)[^)\]]*\b(?:edit|mix)\b"
)
_COMPILATION = re.compile(
    r"\b(greatest hits|best of|very best|essential|collection|anthology|ultimate|singles|big hits|"
    r"cream of|grandes exitos|gold|themes|this is it|chapter and verse|vol(?:ume|\.)?)\b"
)


def is_other_version(title: str, album: str, csv_title: str) -> bool:
    """
    ¿Título o álbum de Deezer marcan otra versión (live, remix, karaoke…)? El título del CSV se
    quita antes: «Live Forever» no es en vivo, pero «Live Forever (Live at Glastonbury)» sí.
    """
    base = fold(csv_title)
    t, a = fold(title), fold(album)
    t = t.replace(base, " ", 1) if base in t else t
    a = a.replace(base, " ", 1) if base in a else a
    return bool(version_words(t) or album_words(a))


def named_edit(s: str) -> bool:
    return bool(_NAMED_EDIT.search(fold(s)))


def album_words(s: str) -> set[str]:
    return set(_ALBUM_BAD.findall(fold(s).replace("-", " ")))


def artist_matches(csv_artist: str, deezer_artist: str) -> bool:
    a, b = norm_artist(csv_artist), norm_artist(deezer_artist)
    if not a or not b:
        return False
    # Igualdad exacta: la contención dejaba pasar «Avicii Cover Band» por «Avicii».
    return a == b


def valid_candidates(cands: list[DeezerCandidate], row: Row) -> list[DeezerCandidate]:
    """Candidatos que son la canción del CSV en su versión original, de mayor a menor rank."""
    want_title = norm_title(row.title)
    out = []
    for c in cands:
        if not (artist_matches(row.artist, c.artist)
                or (row.featuring and artist_matches(row.featuring, c.artist))):
            continue
        if want_title not in (norm_title(c.title), norm_title(c.title_short)):
            continue
        if named_edit(c.title) or is_other_version(c.title, c.album_title, row.title):
            continue
        out.append(c)
    return sorted(out, key=lambda c: -c.rank)


# --- Filas y resultados ---


@dataclass(frozen=True)
class Row:
    rank: int
    title: str
    artist: str
    featuring: str
    year: str
    reserve: bool

    @property
    def artist_name(self) -> str:
        """`artist_name` como el catálogo: «Artista, Invitado» (ver deezer_source.first_artist)."""
        return f"{self.artist}, {self.featuring}" if self.featuring else self.artist


@dataclass
class Result:
    row: Row
    status: str
    deezer: str = ""  # «título — artista, álbum, año, preview s» o motivo
    song_id: str | None = None  # canción existente a enlazar
    payload: dict[str, Any] | None = None  # canción nueva a insertar
    note: str = ""
    error: str | None = None


def read_csv(path: Path) -> list[Row]:
    rows: list[Row] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            title = (r.get("title") or "").strip()
            artist = (r.get("artist") or "").strip()
            if not title or not artist:
                continue
            rows.append(
                Row(
                    rank=int(r["rank"]),
                    title=title,
                    artist=artist,
                    featuring=(r.get("featuring") or "").strip(),
                    year=(r.get("year") or "").strip(),
                    reserve=(r.get("reserve") or "0").strip() == "1",
                )
            )
    return rows


def ordered(rows: list[Row]) -> tuple[list[Row], list[Row]]:
    main = sorted((r for r in rows if not r.reserve), key=lambda r: r.rank)
    reserve = sorted((r for r in rows if r.reserve), key=lambda r: r.rank)
    return main, reserve


# --- Catálogo existente ---


class Catalog:
    """Canciones activas indexadas por clave de dedupe, deezer_id, isrc y clave de versión."""

    def __init__(self, songs: list[dict]) -> None:
        self.by_key: dict[str, dict] = {}
        self.by_deezer: dict[int, dict] = {}
        self.by_isrc: dict[str, dict] = {}
        self.by_version: dict[str, dict] = {}
        for s in songs:
            self.add(s)

    def add(self, s: dict) -> None:
        if s.get("dedupe_key"):
            self.by_key.setdefault(s["dedupe_key"], s)
        if s.get("deezer_id"):
            self.by_deezer.setdefault(int(s["deezer_id"]), s)
        if s.get("isrc"):
            self.by_isrc.setdefault(str(s["isrc"]).upper(), s)
        vk = version_key(s.get("title"), s.get("artist_name"))
        if vk:
            self.by_version.setdefault(vk, s)

    def find(self, row: Row, deezer_id: int | None = None, isrc: str | None = None) -> tuple[dict | None, str]:
        s = self.by_key.get(dedupe_key(row.title, row.artist_name) or "")
        if s:
            return s, "clave"
        if deezer_id and (s := self.by_deezer.get(deezer_id)):
            return s, "deezer_id"
        if isrc and (s := self.by_isrc.get(isrc.upper())):
            return s, "isrc"
        if s := self.by_version.get(version_key(row.title, row.artist_name) or ""):
            return s, "versión"
        return None, ""


def has_deezer_audio(song: dict) -> bool:
    secs = song.get("deezer_preview_seconds")
    return bool(song.get("deezer_id")) and secs is not None and float(secs) >= MIN_PREVIEW_SECONDS


# --- Resolución de una fila ---


def search_candidates(row: Row) -> list[DeezerCandidate]:
    """Candidatos válidos: búsqueda «artista título» y, si no hay, variantes más laxas."""
    clean = _PARENS.sub("", row.title).strip()
    queries = [(f"{row.artist} {row.title}", SEARCH_LIMIT)]
    if clean and clean != row.title:
        queries.append((f"{row.artist} {clean}", SEARCH_LIMIT))
    if row.featuring:
        queries.append((f"{row.artist} {clean or row.title} {row.featuring}", SEARCH_LIMIT))
    queries.append((row.title, TITLE_ONLY_LIMIT))
    for q, limit in queries:
        found = valid_candidates(search_tracks(q, limit), row)
        if found:
            return found
    return []


def pick_release_date(detail: DeezerTrackDetail, year: str) -> str | None:
    """Fecha de Deezer si cuadra con el año del CSV; si no (recopilatorio, remaster), solo el año."""
    dz = detail.release_date
    if dz and year.isdigit() and abs(int(dz[:4]) - int(year)) > YEAR_TOLERANCE:
        return year
    return dz or (year if year.isdigit() else None)


def describe(detail: DeezerTrackDetail, seconds: float | None) -> str:
    prev = f"{seconds:.0f}s" if seconds is not None else "sin preview"
    year = detail.release_date[:4] if detail.release_date else "?"
    return f"{detail.title} — {detail.artist}, {detail.album_title}, {year}, {prev}"


def detail_is_original(detail: DeezerTrackDetail, row: Row) -> bool:
    """La ficha de Deezer (que a veces difiere del resultado de búsqueda) sigue siendo la original."""
    if norm_title(detail.title) != norm_title(row.title) or named_edit(detail.title):
        return False
    return not is_other_version(detail.title, detail.album_title, row.title)


def plain_penalty(title: str) -> bool:
    """«Radio Edit», «Single Version»…: valen, pero se prefiere la versión de álbum (u «Original»)."""
    t = fold(title)
    return "original version" not in t and bool(_PLAIN_PENALTY.search(t))


def year_ok(detail: DeezerTrackDetail, year: str) -> bool:
    return bool(detail.release_date and year.isdigit()
                and abs(int(detail.release_date[:4]) - int(year)) <= YEAR_TOLERANCE)


def resolve(row: Row, catalog: Catalog, linked_ids: set[str], seen_deezer: set[int]) -> Result:
    """
    Decide qué hacer con una fila. Nunca lanza: un fallo de la API o del CDN es `error`.
    No escribe nada.

    Entre los candidatos válidos (hasta MAX_CANDIDATES, de mayor a menor rank de Deezer) se
    prefiere el de la fecha del CSV (±1 año: el álbum original, no un recopilatorio) y sin marca
    de «radio edit»/«single version»; el primero con preview suficiente gana.
    """
    try:
        cands = search_candidates(row)[:MAX_CANDIDATES]
        # Existente por clave de dedupe/versión antes de gastar peticiones de detalle.
        existing, via = catalog.find(row)
        if not cands and not existing:
            return Result(row, NOT_FOUND)
        if any(c.deezer_id in seen_deezer for c in cands):
            return Result(row, DUPLICATE, f"{cands[0].title} — {cands[0].artist}")
        details: list[DeezerTrackDetail] = []
        for cand in cands:
            detail = track_detail(cand.deezer_id)
            if detail is not None and detail_is_original(detail, row):
                details.append(detail)
        # Orden estable: dentro de cada grupo se mantiene el rank de Deezer.
        details.sort(key=lambda d: (not year_ok(d, row.year), bool(_COMPILATION.search(fold(d.album_title))),
                                    plain_penalty(d.title)))
        best: tuple[DeezerTrackDetail, float | None] | None = None
        for detail in details:
            if existing is None:
                existing, via = catalog.find(row, deezer_id=detail.deezer_id, isrc=detail.isrc)
            if existing is not None:
                return link_existing(row, existing, via, detail, linked_ids)
            seconds = measure_preview(detail)
            if best is None:
                best = (detail, seconds)
            if seconds is not None and seconds >= MIN_PREVIEW_SECONDS:
                return new_song(row, detail, seconds)
        if existing is not None:
            # Hay canción en el catálogo pero ninguna ficha de Deezer válida: se enlaza igual.
            return link_existing(row, existing, via, None, linked_ids)
        if best is not None:
            return Result(row, NO_PREVIEW, describe(*best))
        return Result(row, NOT_FOUND)
    except (DeezerApiError, PreviewFetchError) as exc:
        return Result(row, ERROR, error=f"{type(exc).__name__}: {exc}")


def measure_preview(detail: DeezerTrackDetail) -> float | None:
    """Duración del preview, o None si Deezer no lo da o no es un MP3 medible."""
    if not detail.preview_url:
        return None
    try:
        return measure_mp3(detail.preview_url)
    except PreviewInvalidError:
        return None


def link_existing(
    row: Row, song: dict, via: str, detail: DeezerTrackDetail | None, linked_ids: set[str]
) -> Result:
    shown = (
        describe(detail, song.get("deezer_preview_seconds")) if detail
        else f"{song.get('title')} — {song.get('artist_name')}"
    )
    note = f"existente por {via}: {song.get('title')} — {song.get('artist_name')}"
    if not has_deezer_audio(song):
        return Result(row, NO_PREVIEW, shown, song_id=song["id"], note=f"{note} (sin audio de Deezer)")
    if song["id"] in linked_ids:
        return Result(row, LINKED, shown, song_id=song["id"], note=note)
    return Result(row, EXISTING, shown, song_id=song["id"], note=note)


def new_song(row: Row, detail: DeezerTrackDetail, seconds: float) -> Result:
    shown = describe(detail, seconds)
    if not detail.cover_url or not detail.album_title:
        return Result(row, ERROR, shown, error="Deezer no da álbum o carátula")
    try:
        genres = album_genre_ids(detail.album_id) if detail.album_id else None
    except DeezerApiError as exc:
        return Result(row, ERROR, shown, error=f"géneros: {exc}")
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "title": row.title,
        "artist_name": row.artist_name,
        "album_title": detail.album_title,
        "cover_url": detail.cover_url,
        "release_date": pick_release_date(detail, row.year),
        "duration_ms": detail.duration_s * 1000 if detail.duration_s else None,
        "deezer_id": detail.deezer_id,
        "isrc": detail.isrc,
        "deezer_preview_seconds": seconds,
        "deezer_checked_at": now,
        "deezer_release_date": detail.release_date,
        "deezer_genre_ids": genres or None,
        "deezer_meta_checked_at": now,
        "explicit": detail.explicit,
        "is_active": True,
        "daily_eligible": False,
    }
    return Result(row, NEW, shown, payload=payload)


# --- Escritura ---


def write_result(supabase: Any, category_id: str, res: Result, catalog: Catalog) -> None:
    """Inserta la canción nueva (si la hay) y la enlaza a la categoría. Lanza si falla."""
    if res.payload is not None:
        inserted = supabase.table("ecos_songs").insert(res.payload).execute()
        song = inserted.data[0]
        res.song_id = song["id"]
        catalog.add({**res.payload, **song})
    if res.status in (NEW, EXISTING):
        supabase.table("ecos_category_songs").upsert(
            {"category_id": category_id, "song_id": res.song_id, "position": res.row.rank},
            on_conflict="category_id,song_id",
        ).execute()


def db_error(exc: Exception) -> str:
    code, msg = getattr(exc, "code", None), getattr(exc, "message", None)
    return f"{code or type(exc).__name__}: {msg or exc}"[:200]


def main() -> None:
    p = argparse.ArgumentParser(description="Importa una lista curada de canciones a una categoría curada.")
    p.add_argument("--category", required=True, help="slug de la categoría (pop-ingles, rock-ingles)")
    p.add_argument("--csv", required=True, type=Path, help="CSV: rank,title,artist,featuring,year,reserve,source")
    p.add_argument("--target", type=int, default=DEFAULT_TARGET, help="canciones válidas objetivo (150)")
    p.add_argument("--limit", type=int, help="solo las N primeras filas del CSV (para probar)")
    p.add_argument("--dry-run", action="store_true", help="llama a Deezer y muestra la tabla, sin escribir ni registrar")
    args = p.parse_args()

    load_env()
    log = setup_logging("import-category-songs")
    start_ms = now_ms()
    dry_run: bool = args.dry_run
    supabase = get_supabase(log, read_only=dry_run)
    if dry_run:
        log.info("SIMULACIÓN: no se escribe nada en la base de datos")

    c = dict.fromkeys(
        ("processed", NEW, EXISTING, LINKED, NOT_FOUND, NO_PREVIEW, ERROR, DUPLICATE, "write_errors"), 0
    )
    failed: list[Result] = []
    errors: list[str] = []
    results: list[Result] = []

    try:
        cat = (
            supabase.table("ecos_categories").select("id, slug, curated").eq("slug", args.category).execute().data
        )
        if not cat:
            log.error("No existe la categoría %r", args.category)
            sys.exit(1)
        category_id = cat[0]["id"]
        if not cat[0].get("curated"):
            log.warning("La categoría %r no está marcada como curada", args.category)

        rows = read_csv(args.csv)
        if args.limit:
            rows = rows[: args.limit]
        main_rows, reserve_rows = ordered(rows)
        log.info("CSV: %d principales + %d reservas; objetivo %d", len(main_rows), len(reserve_rows), args.target)

        songs = fetch_all(
            lambda: supabase.table("ecos_songs")
            .select("id, title, artist_name, dedupe_key, deezer_id, isrc, deezer_preview_seconds", count="exact")
            .eq("is_active", True)
        )
        catalog = Catalog(songs)
        linked_ids = {
            str(r["song_id"])
            for r in fetch_all(
                lambda: supabase.table("ecos_category_songs")
                .select("song_id, category_id", count="exact")
                .eq("category_id", category_id),
                order_by="song_id",
            )
        }
        log.info("Catálogo activo: %d canciones; ya enlazadas a la categoría: %d", len(songs), len(linked_ids))

        valid = 0
        seen_deezer: set[int] = set()
        queue = main_rows + reserve_rows
        for row in queue:
            if valid >= args.target:
                break
            res = resolve(row, catalog, linked_ids, seen_deezer)
            if not dry_run and res.status in (NEW, EXISTING):
                try:
                    write_result(supabase, category_id, res, catalog)
                except Exception as exc:
                    c["write_errors"] += 1
                    res = Result(row, ERROR, res.deezer, error=f"escritura: {db_error(exc)}")
            if res.status == NEW and res.payload:
                seen_deezer.add(int(res.payload["deezer_id"]))
                if dry_run:
                    # La simulación no inserta: se registra en el catálogo en memoria para que un
                    # duplicado posterior del CSV se detecte igual que en la pasada real.
                    catalog.add({**res.payload, "id": f"dry-{row.rank}", "dedupe_key": dedupe_key(row.title, row.artist_name)})
            if res.song_id and res.status in (EXISTING, NEW, LINKED):
                linked_ids.add(res.song_id)
            results.append(res)
            c["processed"] += 1
            c[res.status] += 1
            if res.status in OK_STATES:
                valid += 1
            else:
                failed.append(res)
                if res.status == ERROR and len(errors) < 10:
                    errors.append(f"#{row.rank} {row.title} — {row.artist}: {res.error}")
            tag = "R" if row.reserve else " "
            log.info("%s#%-3d %s — %s  =>  %s  [%s]%s", tag, row.rank, row.title, row.artist,
                     res.deezer or res.error or "-", res.status.upper(),
                     f"  ({res.note})" if res.note else "")
    except (Exception, KeyboardInterrupt) as exc:
        message = f"{type(exc).__name__}: {exc}"
        log.error("La importación se interrumpió: %s", message)
        log.error("%s", traceback.format_exc())
        gh_annotation("error", f"Importación de categoría interrumpida: {message}")
        if not dry_run:
            log_job(supabase, JOB_CATEGORY_IMPORT, "failure", f"{args.category}: interrumpido: {message}"[:200],
                    start_ms=start_ms, details={**c, "category": args.category, "interrupted": message},
                    errors=[message, *errors], log=log)
        sys.exit(1)

    log.info("=== Resumen (%s) ===", args.category)
    log.info("Válidas en la categoría: %d de %d | filas procesadas: %d", valid, args.target, c["processed"])
    log.info("Nuevas: %d | existentes enlazadas: %d | ya en la categoría: %d", c[NEW], c[EXISTING], c[LINKED])
    log.info("No encontradas: %d | sin preview: %d | error de API: %d | duplicadas en CSV: %d",
             c[NOT_FOUND], c[NO_PREVIEW], c[ERROR], c[DUPLICATE])
    if failed:
        log.info("Filas fallidas:")
        for r in failed:
            log.info("  #%d %s — %s: %s%s", r.row.rank, r.row.title, r.row.artist, r.status,
                     f" ({r.error or r.deezer or r.note})" if (r.error or r.deezer or r.note) else "")

    n = c["processed"]
    if n >= MIN_SAMPLE and c[ERROR] / n > FAIL_RATIO:
        status = "failure"
    elif c[ERROR] or c["write_errors"] or valid < args.target:
        status = "partial"
    else:
        status = "success"
    summary = (
        f"{args.category}: {valid}/{args.target} válidas; {c[NEW]} nuevas, {c[EXISTING]} existentes, "
        f"{c[LINKED]} ya enlazadas; {c[NOT_FOUND]} no encontradas, {c[NO_PREVIEW]} sin preview, "
        f"{c[ERROR]} errores"
    )
    log.info("Estado: %s", status)
    details = {**c, "category": args.category, "target": args.target, "valid": valid,
               "min_preview_seconds": MIN_PREVIEW_SECONDS,
               "failed": [f"#{r.row.rank} {r.row.title} — {r.row.artist}: {r.status}" for r in failed[:50]]}
    if dry_run:
        log.info("[simulación] registro %s: %s", status, summary)
        return
    saved = log_job(supabase, JOB_CATEGORY_IMPORT, status, summary,
                    start_ms=start_ms, details=details, errors=errors, log=log)
    if status == "failure" or not saved:
        sys.exit(1)


if __name__ == "__main__":
    main()
