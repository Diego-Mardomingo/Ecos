"""
Acceso a Deezer para la ingesta, el relleno y las comprobaciones: fuente principal del audio del
juego (Spotify queda de respaldo).

Contrato, igual que spotify_source.py:
- Cualquier fallo al hablar con Deezer (red, HTTP, cuota agotada tras los reintentos, JSON roto)
  lanza `DeezerApiError`. Que no haya resultados NO es un error: `find_track` devuelve None.
  Confundirlos desactivó el catálogo entero una vez.
- Los datos salen como dataclasses, sin dicts de la API.

Datos medidos (2026-10-09):
- Hay que usar la búsqueda simple `GET /search/track?q=<artista> <título>`: la avanzada
  (`artist:"…" track:"…"`) devuelve vacío.
- La URL de `preview` va FIRMADA y caduca a los 900 s (`hdnea=exp=…`): no se guarda nunca, se
  guarda `deezer_id` y se resuelve con `GET /track/{id}` cuando hace falta.
- Cuota no oficial: ~50 peticiones / 5 s por IP. El error es HTTP 200 con
  `{"error": {"code": 4}}`. Aquí se limita a MAX_REQUESTS por WINDOW_S y se reintenta con espera.

Solo usa la librería estándar. La duración del preview se mide con preview_audio.measure_mp3.
"""
from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass
from urllib.parse import urlparse

API = "https://api.deezer.com"
TIMEOUT_S = 15
# Margen bajo el límite real (~50 / 5 s).
MAX_REQUESTS = 40
WINDOW_S = 5.0
ATTEMPTS = 5
BACKOFF_S = 2.0
SEARCH_LIMIT = 10
DURATION_TOLERANCE_MS = 3000
QUOTA_ERROR_CODE = 4


class DeezerApiError(Exception):
    """Fallo al hablar con Deezer (no «no hay resultados»)."""


@dataclass(frozen=True)
class DeezerMatch:
    """Una pista de Deezer emparejada con una de Spotify."""

    deezer_id: int
    isrc: str | None
    duration_s: int
    preview_url: str | None  # firmada: caduca a los 900 s; no guardar


@dataclass(frozen=True)
class DeezerTrack:
    deezer_id: int
    isrc: str | None
    duration_s: int
    preview_url: str | None  # firmada: caduca a los 900 s; no guardar


@dataclass(frozen=True)
class DeezerTrackMeta:
    """Fecha de la pista y álbum al que pertenece (de `GET /track/{id}`)."""

    release_date: str | None  # «YYYY-MM-DD», tal cual la da Deezer
    album_id: int | None


# --- Normalización y emparejamiento ---

_PARENS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
_DASH_SUFFIX = re.compile(r"\s+-\s+.*$")
_FEAT = re.compile(r"\s+(feat\.?|featuring|ft\.?|con|with)\s+.*$")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
# Marcas de otra versión: si el título de Deezer las trae y el de Spotify no, no es la misma pista.
_VERSION_WORDS = re.compile(
    r"\b(live|en vivo|sped up|speed up|slowed|reverb|remix|acoustic|acustico|karaoke|instrumental)\b"
)


def _fold(s: str | None) -> str:
    """Minúsculas y sin acentos."""
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if not unicodedata.combining(c)).lower()


def norm_title(title: str | None) -> str:
    """Título sin paréntesis/corchetes, sufijo « - …» ni «feat.», sin acentos ni puntuación."""
    t = _fold(title)
    t = _PARENS.sub("", t)
    t = _DASH_SUFFIX.sub("", t)
    t = _FEAT.sub("", t)
    return _NON_ALNUM.sub(" ", t).strip()


def norm_artist(artist: str | None) -> str:
    return _NON_ALNUM.sub(" ", _fold(artist)).strip()


def first_artist(artist: str) -> str:
    """`ecos_songs.artist_name` es la lista de artistas de Spotify unida por ', '."""
    return artist.split(",")[0].strip()


def _version_words(title: str | None) -> set[str]:
    return set(_VERSION_WORDS.findall(_fold(title)))


def _contains(a: str, b: str) -> bool:
    return bool(a) and bool(b) and (a in b or b in a)


def candidate_matches(cand: dict, artist: str, title: str, duration_ms: int | None) -> bool:
    """¿El resultado de Deezer es la misma canción que la de Spotify?"""
    d_title = cand.get("title") or ""
    d_short = cand.get("title_short") or d_title
    t = norm_title(title)
    if not (_contains(t, norm_title(d_title)) or _contains(t, norm_title(d_short))):
        return False
    d_artist = norm_artist((cand.get("artist") or {}).get("name"))
    if not _contains(norm_artist(first_artist(artist)), d_artist):
        return False
    # Versiones: «live», «sped up»… solo valen si el título de Spotify también las trae.
    if _version_words(d_title) - _version_words(title):
        return False
    if duration_ms:
        dur = cand.get("duration")
        if not isinstance(dur, (int, float)) or abs(dur * 1000 - duration_ms) > DURATION_TOLERANCE_MS:
            return False
    return True


# --- Cliente HTTP con límite de ritmo ---

_lock = threading.Lock()
_sent: deque[float] = deque()


def _throttle() -> None:
    """Bloquea hasta que quepa otra petición en la ventana de WINDOW_S."""
    while True:
        with _lock:
            now = time.monotonic()
            while _sent and now - _sent[0] >= WINDOW_S:
                _sent.popleft()
            if len(_sent) < MAX_REQUESTS:
                _sent.append(now)
                return
            wait = WINDOW_S - (now - _sent[0])
        time.sleep(max(wait, 0.05))


def _get(path: str, params: dict | None = None) -> dict:
    """GET con reintentos ante cuota (code 4), 429, 5xx y fallos de red. Devuelve el JSON."""
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    last = "sin intentos"
    for attempt in range(1, ATTEMPTS + 1):
        _throttle()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EcosIngest/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if not (exc.code == 429 or exc.code >= 500):
                raise DeezerApiError(f"{path}: {last}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        else:
            if not isinstance(data, dict):
                raise DeezerApiError(f"{path}: respuesta inesperada")
            err = data.get("error")
            if not isinstance(err, dict) or err.get("code") != QUOTA_ERROR_CODE:
                # Otros errores (p. ej. 800 «no data») los interpreta quien llama.
                return data
            last = f"cuota agotada (code {QUOTA_ERROR_CODE})"
        if attempt < ATTEMPTS:
            time.sleep(BACKOFF_S * attempt)
    raise DeezerApiError(f"{path}: {last} tras {ATTEMPTS} intentos")


# --- API pública ---


def find_track(artist: str, title: str, duration_ms: int | None) -> DeezerMatch | None:
    """
    Busca la pista en Deezer. Devuelve el emparejamiento o None si ningún resultado cumple la
    regla (título, primer artista y duración ±3 s). Lanza DeezerApiError si la API falla.
    """
    data = _get("/search/track", {"q": f"{first_artist(artist)} {title}", "limit": SEARCH_LIMIT})
    if isinstance(data.get("error"), dict):
        raise DeezerApiError(f"búsqueda: error {data['error'].get('code')}")
    for cand in data.get("data") or []:
        if not isinstance(cand, dict) or not cand.get("id"):
            continue
        if candidate_matches(cand, artist, title, duration_ms):
            return DeezerMatch(
                deezer_id=int(cand["id"]),
                isrc=cand.get("isrc") or None,
                duration_s=int(cand.get("duration") or 0),
                preview_url=cand.get("preview") or None,
            )
    return None


def track(deezer_id: int) -> DeezerTrack | None:
    """Datos y preview firmado frescos de una pista. None si Deezer dice que no existe."""
    data = _get(f"/track/{deezer_id}")
    err = data.get("error")
    if isinstance(err, dict):
        if err.get("type") == "DataException" or err.get("code") == 800:
            return None
        raise DeezerApiError(f"pista {deezer_id}: error {err.get('code')}")
    if not data.get("id"):
        return None
    return DeezerTrack(
        deezer_id=int(data["id"]),
        isrc=data.get("isrc") or None,
        duration_s=int(data.get("duration") or 0),
        preview_url=data.get("preview") or None,
    )


def track_meta(deezer_id: int) -> DeezerTrackMeta | None:
    """
    Fecha de lanzamiento y álbum de una pista. None si Deezer dice que la pista no existe; lanza
    DeezerApiError si la API falla. Una pista que existe sin fecha devuelve release_date=None.
    """
    data = _get(f"/track/{deezer_id}")
    err = data.get("error")
    if isinstance(err, dict):
        if err.get("type") == "DataException" or err.get("code") == 800:
            return None
        raise DeezerApiError(f"pista {deezer_id}: error {err.get('code')}")
    if not data.get("id"):
        return None
    album = data.get("album")
    album_id = album.get("id") if isinstance(album, dict) else None
    release = data.get("release_date")
    # Deezer usa «0000-00-00» cuando no sabe la fecha.
    if not isinstance(release, str) or not re.match(r"^[1-9]\d{3}-", release):
        release = None
    return DeezerTrackMeta(release_date=release, album_id=int(album_id) if album_id else None)


# Géneros por álbum, en memoria: muchas canciones comparten álbum. None = Deezer no tiene el álbum
# (respuesta definitiva); un fallo de la API lanza y no se cachea.
_album_genres: dict[int, list[int] | None] = {}


def album_genre_ids(album_id: int) -> list[int] | None:
    """
    Ids de género del álbum (`genres.data`, o `genre_id` si falta; -1 = «sin género» se descarta).
    None si el álbum no existe; lista vacía si existe sin géneros. Lanza DeezerApiError si falla.
    """
    if album_id in _album_genres:
        return _album_genres[album_id]
    data = _get(f"/album/{album_id}")
    err = data.get("error")
    if isinstance(err, dict):
        if err.get("type") == "DataException" or err.get("code") == 800:
            _album_genres[album_id] = None
            return None
        raise DeezerApiError(f"álbum {album_id}: error {err.get('code')}")
    if not data.get("id"):
        _album_genres[album_id] = None
        return None
    ids: list[int] = []
    genres = data.get("genres")
    for g in (genres.get("data") if isinstance(genres, dict) else None) or []:
        if isinstance(g, dict) and isinstance(g.get("id"), int) and g["id"] > 0 and g["id"] not in ids:
            ids.append(g["id"])
    gid = data.get("genre_id")
    if not ids and isinstance(gid, int) and gid > 0:
        ids.append(gid)
    _album_genres[album_id] = ids
    return ids


@dataclass(frozen=True)
class DeezerCandidate:
    """Resultado de una búsqueda de pistas (sin fecha: esa solo viene en `GET /track/{id}`)."""

    deezer_id: int
    title: str
    title_short: str
    artist: str
    album_title: str
    rank: int
    has_preview: bool


@dataclass(frozen=True)
class DeezerTrackDetail:
    """Ficha completa de una pista (`GET /track/{id}`), con el preview firmado fresco."""

    deezer_id: int
    title: str
    artist: str
    album_id: int | None
    album_title: str
    cover_url: str | None  # cover_xl o, si falta, cover_big
    release_date: str | None  # «YYYY-MM-DD»
    isrc: str | None
    duration_s: int
    explicit: bool
    preview_url: str | None  # firmada: caduca a los 900 s; no guardar


def search_tracks(query: str, limit: int = SEARCH_LIMIT) -> list[DeezerCandidate]:
    """
    Búsqueda simple de pistas, en el orden de relevancia de Deezer. Lista vacía = sin resultados;
    lanza DeezerApiError si la API falla.
    """
    data = _get("/search/track", {"q": query, "limit": limit})
    if isinstance(data.get("error"), dict):
        raise DeezerApiError(f"búsqueda: error {data['error'].get('code')}")
    out: list[DeezerCandidate] = []
    for c in data.get("data") or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        album = c.get("album") if isinstance(c.get("album"), dict) else {}
        artist = c.get("artist") if isinstance(c.get("artist"), dict) else {}
        out.append(
            DeezerCandidate(
                deezer_id=int(c["id"]),
                title=c.get("title") or "",
                title_short=c.get("title_short") or c.get("title") or "",
                artist=artist.get("name") or "",
                album_title=album.get("title") or "",
                rank=int(c.get("rank") or 0),
                has_preview=bool(c.get("preview")),
            )
        )
    return out


def track_detail(deezer_id: int) -> DeezerTrackDetail | None:
    """Ficha de una pista. None si Deezer dice que no existe; lanza DeezerApiError si falla."""
    data = _get(f"/track/{deezer_id}")
    err = data.get("error")
    if isinstance(err, dict):
        if err.get("type") == "DataException" or err.get("code") == 800:
            return None
        raise DeezerApiError(f"pista {deezer_id}: error {err.get('code')}")
    if not data.get("id"):
        return None
    album = data.get("album") if isinstance(data.get("album"), dict) else {}
    artist = data.get("artist") if isinstance(data.get("artist"), dict) else {}
    release = data.get("release_date")
    if not isinstance(release, str) or not re.match(r"^[1-9]\d{3}-", release):
        release = None
    return DeezerTrackDetail(
        deezer_id=int(data["id"]),
        title=data.get("title") or "",
        artist=artist.get("name") or "",
        album_id=int(album["id"]) if album.get("id") else None,
        album_title=album.get("title") or "",
        cover_url=album.get("cover_xl") or album.get("cover_big") or None,
        release_date=release,
        isrc=data.get("isrc") or None,
        duration_s=int(data.get("duration") or 0),
        explicit=bool(data.get("explicit_lyrics")),
        preview_url=data.get("preview") or None,
    )


def preview_host(url: str | None) -> str | None:
    return urlparse(url).hostname if url else None
