"""
Duración del MP3 en una URL (p. ej. preview de Spotify).
Usado por ingest-weekly, measure-playlists y archivo/backfill-preview-duration.
Requiere: mutagen (ver scripts/requirements-ingest.txt).

Medir puede fallar de dos maneras que no significan lo mismo, y la ingesta las cuenta por
separado:

- `PreviewFetchError`: no se pudo descargar (timeout, DNS, 403/404/5xx). Si pasa con casi todas
  las pistas, el problema es de red o de Spotify, no de las canciones.
- `PreviewInvalidError`: se descargó, pero no es un MP3 del que se pueda sacar la duración.

`measure_mp3` las distingue y lanza; `get_mp3_duration_seconds` conserva el contrato antiguo
(devuelve None ante cualquier fallo) para los scripts de `archivo/` que lo usan así.
"""
from __future__ import annotations

import time
import urllib.error
import urllib.request
from io import BytesIO

from mutagen.mp3 import MP3

TIMEOUT_S = 20
# Un reintento ante fallos de red o 5xx/429; un 403/404 no mejora al repetir.
ATTEMPTS = 2
RETRY_DELAY_S = 1.5


class PreviewFetchError(Exception):
    """No se pudo descargar el preview."""


class PreviewInvalidError(Exception):
    """Se descargó el preview, pero no es un MP3 medible."""


def _download(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EcosIngest/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except Exception as exc:  # timeout, DNS, TLS, conexión cortada...
            last = exc
        if attempt < ATTEMPTS:
            time.sleep(RETRY_DELAY_S)
    if isinstance(last, urllib.error.HTTPError):
        raise PreviewFetchError(f"HTTP {last.code}") from last
    raise PreviewFetchError(f"{type(last).__name__}: {last}") from last


def measure_mp3(url: str) -> float:
    """Duración en segundos del MP3 de `url`. Lanza PreviewFetchError o PreviewInvalidError."""
    data = _download(url)
    try:
        length = getattr(MP3(BytesIO(data)).info, "length", None)
    except Exception as exc:
        raise PreviewInvalidError(f"{type(exc).__name__}: {exc}") from exc
    if length is None:
        raise PreviewInvalidError("el MP3 no trae duración")
    return float(length)


def get_mp3_duration_seconds(url: str) -> float | None:
    """Como `measure_mp3`, pero devuelve None ante cualquier fallo (contrato antiguo)."""
    try:
        return measure_mp3(url)
    except (PreviewFetchError, PreviewInvalidError):
        return None
