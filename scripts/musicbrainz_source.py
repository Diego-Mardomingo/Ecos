"""
Acceso a MusicBrainz para enriquecer el catálogo con idioma de la obra, país y géneros del artista.

Contrato, igual que deezer_source.py:
- Cualquier fallo al hablar con MusicBrainz (red, HTTP, límite de ritmo agotado tras los
  reintentos, JSON roto) lanza `MusicBrainzError`. Que no exista el ISRC o el artista NO es un
  error: las funciones devuelven None.
- Los datos salen como dataclasses, sin dicts de la API.

Reglas del servicio (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting):
- Como mucho 1 petición por segundo y un User-Agent que identifique la aplicación. Aquí se espera
  MIN_INTERVAL_S entre peticiones. Pasarse devuelve 503; se reintenta con espera.
- Un ISRC desconocido responde 404 (no es un fallo).

Cobertura medida: solo ~la mitad de las canciones del catálogo aparece por ISRC. Los artistas se
guardan en una caché en memoria (un artista suele tener varias canciones).

Solo usa la librería estándar.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

API = "https://musicbrainz.org/ws/2"
USER_AGENT = "Ecos/1.0 ( https://github.com/Diego-Mardomingo/Ecos )"
TIMEOUT_S = 20
# Un poco por encima de 1 s: el límite oficial es 1 petición por segundo.
MIN_INTERVAL_S = 1.1
ATTEMPTS = 5
BACKOFF_S = 3.0
MAX_GENRES = 5
# «sin letra» y «varios idiomas»: no dicen en qué idioma se canta.
NON_LANGUAGES = frozenset({"zxx", "mul", "und"})


class MusicBrainzError(Exception):
    """Fallo al hablar con MusicBrainz (no «no encontrado»)."""


@dataclass(frozen=True)
class IsrcInfo:
    """Lo que MusicBrainz sabe de un ISRC."""

    language: str | None  # ISO 639-3 de la obra («spa», «eng»…), None si ninguna lo trae
    artist_mbid: str | None  # artista principal de la grabación
    artist_country: str | None  # país del artista si ya viene en el artist-credit
    first_release_date: str | None  # la más antigua entre las grabaciones


@dataclass(frozen=True)
class ArtistInfo:
    country: str | None  # ISO 3166-1 alfa-2
    genres: list[str]  # los de más votos primero


# --- Cliente HTTP con límite de ritmo ---

_lock = threading.Lock()
_last_request = 0.0


def _throttle() -> None:
    """Bloquea hasta que hayan pasado MIN_INTERVAL_S desde la petición anterior."""
    global _last_request
    with _lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def _get(path: str, params: dict[str, str]) -> dict | None:
    """GET con reintentos ante 503/429/5xx y fallos de red. None si responde 404."""
    url = f"{API}{path}?{urllib.parse.urlencode({**params, 'fmt': 'json'}, safe='+')}"
    last = "sin intentos"
    for attempt in range(1, ATTEMPTS + 1):
        _throttle()
        retry_after = 0.0
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = f"HTTP {exc.code}"
            if not (exc.code in (429, 503) or exc.code >= 500):
                raise MusicBrainzError(f"{path}: {last}") from exc
            try:
                retry_after = float(exc.headers.get("Retry-After") or 0)
            except ValueError:
                retry_after = 0.0
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        else:
            if not isinstance(data, dict):
                raise MusicBrainzError(f"{path}: respuesta inesperada")
            return data
        if attempt < ATTEMPTS:
            time.sleep(max(BACKOFF_S * attempt, min(retry_after, 60.0)))
    raise MusicBrainzError(f"{path}: {last} tras {ATTEMPTS} intentos")


# --- API pública ---


def _work_languages(recording: dict) -> list[str]:
    """Idiomas de las obras ligadas a una grabación, en el orden en que vienen."""
    out: list[str] = []
    for rel in recording.get("relations") or []:
        work = rel.get("work") if isinstance(rel, dict) else None
        if not isinstance(work, dict):
            continue
        langs = work.get("languages")
        if isinstance(langs, list):
            out.extend(x for x in langs if isinstance(x, str))
        lang = work.get("language")
        if isinstance(lang, str):
            out.append(lang)
    return out


def _pick_language(languages: list[str]) -> str | None:
    """El primero que diga un idioma real; zxx/mul/und solo si es lo único que hay."""
    for lang in languages:
        if lang not in NON_LANGUAGES:
            return lang
    return languages[0] if languages else None


def lookup_isrc(isrc: str) -> IsrcInfo | None:
    """
    Idioma de la obra, artista principal y fecha del primer lanzamiento de un ISRC. None si
    MusicBrainz no lo conoce (404 o sin grabaciones). Lanza MusicBrainzError si la API falla.
    """
    data = _get(f"/isrc/{urllib.parse.quote(isrc)}", {"inc": "artists+work-rels"})
    recordings = [r for r in (data or {}).get("recordings") or [] if isinstance(r, dict)]
    if not recordings:
        return None

    languages: list[str] = []
    dates: list[str] = []
    artist_mbid: str | None = None
    artist_country: str | None = None
    for rec in recordings:
        languages.extend(_work_languages(rec))
        date = rec.get("first-release-date")
        if isinstance(date, str) and date:
            dates.append(date)
        if artist_mbid is None:
            for credit in rec.get("artist-credit") or []:
                artist = credit.get("artist") if isinstance(credit, dict) else None
                if isinstance(artist, dict) and artist.get("id"):
                    artist_mbid = str(artist["id"])
                    country = artist.get("country")
                    artist_country = country if isinstance(country, str) and country else None
                    break
    return IsrcInfo(
        language=_pick_language(languages),
        artist_mbid=artist_mbid,
        artist_country=artist_country,
        # «YYYY», «YYYY-MM» o «YYYY-MM-DD»: ordenadas como texto, la más antigua queda primero.
        first_release_date=min(dates) if dates else None,
    )


_artists: dict[str, ArtistInfo | None] = {}


def lookup_artist(mbid: str) -> ArtistInfo | None:
    """
    País (`country`, o el código ISO del `area` si falta) y géneros (los de más votos) de un artista.
    None si no existe. Lanza MusicBrainzError si la API falla (y no cachea el fallo).
    """
    if mbid in _artists:
        return _artists[mbid]
    data = _get(f"/artist/{urllib.parse.quote(mbid)}", {"inc": "genres"})
    if data is None:
        _artists[mbid] = None
        return None
    country = data.get("country")
    if not (isinstance(country, str) and country):
        country = None
        area = data.get("area")
        codes = area.get("iso-3166-1-codes") if isinstance(area, dict) else None
        if isinstance(codes, list) and codes and isinstance(codes[0], str):
            country = codes[0]
    genres = [g for g in data.get("genres") or [] if isinstance(g, dict) and isinstance(g.get("name"), str)]
    genres.sort(key=lambda g: -(g.get("count") or 0))
    info = ArtistInfo(country=country, genres=[g["name"] for g in genres[:MAX_GENRES]])
    _artists[mbid] = info
    return info
