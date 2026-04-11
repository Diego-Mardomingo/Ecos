"""
Duración del MP3 en una URL (p. ej. preview de Spotify).
Usado por ingest-weekly y backfill-preview-duration.
Requiere: mutagen (ver scripts/requirements-ingest.txt).
"""
from __future__ import annotations

from io import BytesIO
import urllib.request

from mutagen.mp3 import MP3


def get_mp3_duration_seconds(url: str) -> float | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EcosIngest/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        audio = MP3(BytesIO(data))
        length = getattr(audio.info, "length", None)
        return float(length) if length is not None else None
    except Exception:
        return None
