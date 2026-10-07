"""
Reglas de la selección diaria, sin acceso a la base de datos.

select-daily-game.py lee de Supabase el pool, los juegos ya usados y los recientes, y llama a
`pick_song`. Todo lo que hay aquí es puro: recibe listas de dicts y un `random.Random`, así que
se puede ejecutar en seco con una semilla fija y comparar elecciones.

Reglas, en orden:
1. Nunca repetir: ni la misma canción (id) ni otra edición de la misma (`dedupe_key`).
2. Preferir playlists que llevan ROTATION_DAYS días sin salir.
3. No repetir la década del día anterior.
4. No repetir el género especial (flamenco, rap, reggaeton) del día anterior.
5. No repetir artista en ROTATION_DAYS días.
6. Si las reglas 3-5 dejan cero candidatos, sorteo entre todas las no usadas.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, timedelta

from song_key import dedupe_key

ROTATION_DAYS = 14
# Días por delante de hoy que deben tener juego creado (ver select-daily-game.py).
DAYS_AHEAD = 2
SPECIAL_GENRES = {"flamenco", "rap", "reggaeton"}
# Pool elegible: preview medido >= este umbral (s) y playlist activa en ecos_spotify_playlists.
# 30 s nominales de Spotify suelen medir ~29.7 s en MP3; el umbral es ligeramente inferior para
# no vaciar el pool.
MIN_PREVIEW_SECONDS = 29.0


def get_decade(release_date: str | None) -> str | None:
    """Extrae década de release_date (YYYY, YYYY-MM, YYYY-MM-DD)."""
    if not release_date or len(release_date) < 4:
        return None
    try:
        year = int(release_date[:4])
        if year >= 2020:
            return "2020s"
        if year >= 2010:
            return "2010s"
        if year >= 2000:
            return "2000s"
        if year >= 1990:
            return "90s"
        if year >= 1980:
            return "80s"
        return None
    except ValueError:
        return None


def get_special_genre(genre: str | None, playlist_name: str | None) -> str | None:
    """Detecta si la canción es Flamenco, Rap o Reggaeton (géneros con rotación)."""
    text = " ".join(filter(None, [genre or "", playlist_name or ""])).lower()
    for g in SPECIAL_GENRES:
        if g in text:
            return g
    return None


def is_eligible(song: dict, active_playlist_ids: set[str]) -> bool:
    """Playlist activa + preview_url + duración medida >= MIN_PREVIEW_SECONDS."""
    pl_id = (song.get("spotify_playlist_id") or "").strip()
    if not pl_id or pl_id not in active_playlist_ids:
        return False
    if not song.get("preview_url"):
        return False
    dur = song.get("preview_duration_seconds")
    if dur is None:
        return False
    try:
        return float(dur) >= MIN_PREVIEW_SECONDS
    except (TypeError, ValueError):
        return False


@dataclass
class UsedSongs:
    """Lo que ya salió en algún juego (regla 1)."""

    ids: set[str] = field(default_factory=set)
    keys: set[str] = field(default_factory=set)

    def add(self, song: dict) -> None:
        if song.get("id"):
            self.ids.add(str(song["id"]))
        k = dedupe_key(song.get("title"), song.get("artist_name"))
        if k:
            self.keys.add(k)

    def contains(self, song: dict) -> bool:
        return (
            str(song["id"]) in self.ids
            or dedupe_key(song.get("title"), song.get("artist_name")) in self.keys
        )


@dataclass
class Pick:
    song: dict | None
    error: str | None = None
    rule: str | None = None
    pool_size: int = 0
    candidates: int = 0


def pick_song(
    pool: list[dict],
    used: UsedSongs,
    recent_games: list[dict],
    target_date: str,
    today: date,
    rng: random.Random,
) -> Pick:
    """
    Elige la canción de `target_date`.

    `recent_games`: juegos con `date` y `ecos_songs` (release_date, genre, spotify_playlist_id,
    spotify_playlist_name, artist_name), en cualquier orden.
    """
    cutoff_14 = (today - timedelta(days=ROTATION_DAYS)).isoformat()
    rotation_reference_date = (date.fromisoformat(target_date) - timedelta(days=1)).isoformat()

    available = [s for s in pool if not used.contains(s)]
    if not available:
        return Pick(None, "Pool vacío: no quedan canciones no usadas")

    window = sorted(
        (g for g in recent_games if (g.get("date") or "") >= cutoff_14),
        key=lambda g: g.get("date") or "",
        reverse=True,
    )
    yesterday_decade: str | None = None
    yesterday_genre: str | None = None
    artists_last_14: set[str] = set()
    playlist_last_date: dict[str, str] = {}

    for g in window:
        song = g.get("ecos_songs") or {}
        date_str = g.get("date", "")
        if date_str == rotation_reference_date:
            yesterday_decade = get_decade(song.get("release_date"))
            yesterday_genre = get_special_genre(song.get("genre"), song.get("spotify_playlist_name"))

        artist = (song.get("artist_name") or "").strip().lower()
        if artist:
            artists_last_14.add(artist)
        pl_id = song.get("spotify_playlist_id")
        if pl_id and (not playlist_last_date.get(pl_id) or playlist_last_date[pl_id] < date_str):
            playlist_last_date[pl_id] = date_str

    priority_playlists = {pl for pl, d in playlist_last_date.items() if d < cutoff_14}

    def is_valid(s: dict) -> bool:
        decade = get_decade(s.get("release_date"))
        if yesterday_decade and decade == yesterday_decade:
            return False  # Regla 3
        genre = get_special_genre(s.get("genre"), s.get("spotify_playlist_name"))
        if yesterday_genre and genre == yesterday_genre:
            return False  # Regla 4
        artist = (s.get("artist_name") or "").strip().lower()
        if artist and artist in artists_last_14:
            return False  # Regla 5
        return True

    candidates = [s for s in available if is_valid(s)]
    rule = "3-5"

    priority_candidates = [
        s for s in candidates if (s.get("spotify_playlist_id") or "") in priority_playlists
    ]
    if priority_candidates:
        candidates = priority_candidates
        rule = "2"

    if not candidates:
        candidates = available
        rule = "6-fallback"

    song = rng.choice(candidates)
    if not song.get("title") or not song.get("artist_name"):
        return Pick(None, "Campos requeridos faltantes (title/artist_name)")

    return Pick(song, None, rule, len(available), len(candidates))
