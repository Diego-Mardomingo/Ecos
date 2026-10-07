"""
Acceso a Spotify para la ingesta: lo único que depende de `spotifyscraper`.

La ingesta (ingest-weekly.py) y la medición de playlists (measure-playlists.py) hablan con este
módulo, no con la librería. La razón es el riesgo de DEPS-07: spotifyscraper 2.x está congelada
(última versión, junio de 2025), la ingesta se apoya en un módulo interno suyo
(`spotify_scraper.parsers.json_parser`) y en `client.browser`, y la 3.x es una reescritura sin
`parsers`. Si Spotify cambia el HTML del embed no llegará ningún parche 2.x; el día que haya que
migrar, o escribir el parseo a mano, se toca este fichero y nada más.

Contrato:
- Cualquier fallo al hablar con Spotify (red, HTTP, HTML que ya no se entiende) lanza
  `SpotifyError`. Una lista vacía o un campo ausente NO son un error: el que llama decide qué
  significa. Sin esa distinción, un cambio en el embed se veía como «no hay canciones nuevas»
  (SONGS-08 / OPS-09).
- Los datos salen como dataclasses con los nombres de columna de `ecos_songs`, sin dicts de la
  librería.

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

# Si falta la dependencia, el ImportError sube tal cual y el script que importa este módulo lo
# traduce a un mensaje y a exit 1.
from spotify_scraper import SpotifyClient
from spotify_scraper.parsers.json_parser import extract_track_data_from_page

_ALBUM_PATTERNS = [
    r"open\.spotify\.com/album/([a-zA-Z0-9]{20,25})",
    r"spotify:album:([a-zA-Z0-9]{20,25})",
]


class SpotifyError(Exception):
    """Fallo al obtener o entender algo de Spotify (no «no hay resultados»)."""


class TrackUnavailableError(Exception):
    """La pista ya no existe en Spotify (retirada del catálogo): no es un fallo, es un dato."""


@dataclass(frozen=True)
class TrackStub:
    """Lo que dice la lista de una playlist de cada pista, sin pedir nada más."""

    spotify_id: str
    title: str | None
    artist: str | None


@dataclass(frozen=True)
class Playlist:
    name: str
    tracks: list[TrackStub]


@dataclass(frozen=True)
class TrackInfo:
    """Una pista tal como la lee el embed de Spotify."""

    spotify_id: str
    title: str
    artist: str
    album_title: str  # "" si Spotify no lo da (ver SpotifySource.album_title_fallback)
    cover_url: str | None
    duration_ms: int | None
    explicit: bool
    release_date: str | None
    preview_url: str | None


def _spotify_id(track: dict) -> str:
    tid = track.get("id")
    if tid:
        return str(tid)
    uri = track.get("uri") or ""
    return uri.split(":")[-1] if ":" in uri else ""


def _join_artists(artists: object) -> str | None:
    if not isinstance(artists, list):
        return None
    names = [a.get("name", "") for a in artists if isinstance(a, dict) and a.get("name")]
    return ", ".join(names) or None


class SpotifySource:
    """Cliente de Spotify de solo lectura. Úsalo como gestor de contexto."""

    def __init__(self) -> None:
        # La librería escribe en INFO una línea por petición; en una ingesta son miles.
        # Se baja antes y después de crear el cliente: al iniciarse reconfigura el logger.
        scraper_log = logging.getLogger("spotify_scraper")
        scraper_log.setLevel(logging.WARNING)
        self._client = SpotifyClient()
        scraper_log.setLevel(logging.WARNING)
        for name in list(logging.root.manager.loggerDict):
            if name.startswith("spotify_scraper"):
                logging.getLogger(name).setLevel(logging.WARNING)

    def __enter__(self) -> SpotifySource:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass

    def playlist(self, playlist_id: str) -> Playlist:
        """
        Nombre y pistas de la playlist, en su orden. Spotify solo da las 100 primeras (el embed
        corta ahí: comprobado con playlists de 150 pistas), así que una lista de exactamente 100
        puede estar truncada. Lanza SpotifyError si no se pudo leer; la lista puede venir vacía y
        quien llama debe tratarlo como sospechoso.
        """
        try:
            playlist = self._client.get_playlist_info(f"https://open.spotify.com/playlist/{playlist_id}")
            raw_tracks = playlist.get("tracks") or []
        except Exception as exc:
            raise SpotifyError(f"playlist {playlist_id}: {type(exc).__name__}: {exc}") from exc
        tracks = [
            TrackStub(
                spotify_id=_spotify_id(tr),
                title=tr.get("name") or tr.get("title"),
                artist=_join_artists(tr.get("artists")) or tr.get("artist_name") or None,
            )
            for tr in raw_tracks
            if isinstance(tr, dict)
        ]
        return Playlist(name=playlist.get("name") or playlist_id, tracks=tracks)

    def track_info(self, spotify_id: str) -> TrackInfo:
        """
        Datos de la pista desde su embed. Lanza SpotifyError si no se pudo leer o entender, y
        TrackUnavailableError si la pista ya no está en Spotify.
        """
        try:
            html = self._client.browser.get_page_content(
                f"https://open.spotify.com/embed/track/{spotify_id}"
            )
            full = extract_track_data_from_page(html)
        except Exception as exc:
            raise SpotifyError(f"pista {spotify_id}: {type(exc).__name__}: {exc}") from exc
        if not isinstance(full, dict) or full.get("ERROR"):
            raise SpotifyError(f"pista {spotify_id}: el embed no trae datos ({full!r:.80})")

        # Sin título o sin artista no hay canción jugable. Si la pista está marcada como no
        # reproducible, es una pista retirada del catálogo (el embed devuelve nombre vacío y
        # duración 0): un dato. Si no, que falten en una página que sí se parseó es justo lo que
        # pasaría si Spotify cambiara el embed, y antes se insertaba como "Unknown".
        title = full.get("name")
        artist = _join_artists(full.get("artists"))
        if not title or not artist:
            if full.get("is_playable") is False:
                raise TrackUnavailableError(spotify_id)
            raise SpotifyError(f"pista {spotify_id}: el embed no trae título o artista")

        album = full.get("album") or {}
        images = album.get("images") or []
        return TrackInfo(
            spotify_id=str(full.get("id") or spotify_id),
            title=title,
            artist=artist,
            album_title=album.get("name") or "",
            cover_url=(images[0].get("url") if images else None),
            duration_ms=full.get("duration_ms"),
            explicit=bool(full.get("explicit") or full.get("is_explicit")),
            release_date=album.get("release_date") or full.get("release_date"),
            preview_url=full.get("preview_url") or None,
        )

    def album_title_fallback(self, spotify_id: str) -> str:
        """
        Nombre del álbum cuando el embed no lo trae. Cuesta dos o tres peticiones, así que la
        ingesta solo lo pide para una pista que ya va a insertar. Devuelve "" si no lo encuentra:
        `ecos_songs.album_title` es NOT NULL y no merece la pena fallar por esto.
        """
        try:
            html = self._client.browser.get_page_content(f"https://open.spotify.com/track/{spotify_id}")
            for pat in _ALBUM_PATTERNS:
                m = re.search(pat, html)
                if m:
                    album = self._client.get_album_info(f"https://open.spotify.com/album/{m.group(1)}")
                    return album.get("name") or ""
        except Exception:
            pass
        return ""
