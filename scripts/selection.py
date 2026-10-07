"""
Reglas de la selección diaria, sin acceso a la base de datos.

select-daily-game.py lee de Supabase el pool, los juegos ya usados y los cercanos, y llama a
`pick_song`. Todo lo que hay aquí es puro: recibe listas de dicts y un `random.Random`, así que
se puede ejecutar en seco con una semilla fija y comparar elecciones.

Reglas, en orden:
1. Nunca repetir: ni la misma canción (id), ni otra edición (`dedupe_key`), ni otra versión de
   la misma canción (`version_key`: "Hey" / "Hey - Spanish"), ni el mismo audio (`preview_url`).
2. Preferir playlists que no han salido en los ROTATION_DAYS días alrededor de la fecha.
3. No repetir la década del día anterior ni la del siguiente (si ya existe).
4. No repetir el género especial (flamenco, rap, reggaeton) del día anterior ni del siguiente.
5. No repetir artista en ROTATION_DAYS días, comparando artista a artista.
6. Si las reglas 3-5 dejan cero candidatos, sorteo entre todas las no usadas.

Todas las ventanas se cuentan desde la fecha objetivo, no desde el día en que corre el script:
con juegos creados a dos días vista, contarlas desde "hoy" las desplazaba.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from song_key import artist_names, dedupe_key, version_key

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
    except ValueError:
        return None
    if year >= 2000:
        return f"{year // 10 * 10}s"
    if year >= 1960:
        return f"{year % 100 // 10 * 10}s"
    return None


# "Los 60 España", "Los 2000s Espana", "Los 2010 Espana"...
_PLAYLIST_DECADE = re.compile(r"\blos (60|70|80|90|2000|2010)s?\b")


def get_song_decade(song: dict) -> str | None:
    """
    Década de la canción para la regla 3.

    Si la playlist es de una década ("Los 70 España"), manda la playlist: `release_date` es la
    fecha del álbum, y en las playlists de los 60 y 70 muchas canciones vienen de recopilatorios
    o reediciones muy posteriores ("Mi gran noche" de Raphael figura como 2005).
    """
    name = (song.get("spotify_playlist_name") or "").lower()
    m = _PLAYLIST_DECADE.search(name)
    if m:
        return f"{m.group(1)}s"
    return get_decade(song.get("release_date"))


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
    version_keys: set[str] = field(default_factory=set)
    preview_urls: set[str] = field(default_factory=set)

    def add(self, song: dict) -> None:
        if song.get("id"):
            self.ids.add(str(song["id"]))
        k = dedupe_key(song.get("title"), song.get("artist_name"))
        if k:
            self.keys.add(k)
        vk = version_key(song.get("title"), song.get("artist_name"))
        if vk:
            self.version_keys.add(vk)
        if song.get("preview_url"):
            self.preview_urls.add(song["preview_url"])

    def contains(self, song: dict) -> bool:
        if str(song["id"]) in self.ids:
            return True
        if dedupe_key(song.get("title"), song.get("artist_name")) in self.keys:
            return True
        # Otra versión de una canción ya jugada: "Hey - Spanish" salió el 06/09 y "Hey" seguía
        # en el sorteo.
        vk = version_key(song.get("title"), song.get("artist_name"))
        if vk and vk in self.version_keys:
            return True
        # Mismo audio con otro título o artista ("Hay Quel Venir al Sur" / "Hay que venir al sur").
        return bool(song.get("preview_url")) and song["preview_url"] in self.preview_urls


@dataclass
class Pick:
    song: dict | None
    error: str | None = None
    # Qué decidió la elección: "2" (playlist sin salir en la ventana), "3-5" (reglas 3-5 sin
    # prioridad) o "6-fallback" (sorteo entre todas las no usadas).
    rule: str | None = None
    pool_size: int = 0
    candidates: int = 0


@dataclass
class RotationContext:
    """Lo que dicen los juegos cercanos a la fecha objetivo (reglas 2-5)."""

    neighbor_decades: set[str] = field(default_factory=set)
    neighbor_genres: set[str] = field(default_factory=set)
    artists: set[str] = field(default_factory=set)
    playlists: set[str] = field(default_factory=set)


def build_rotation_context(nearby_games: list[dict], target_date: str) -> RotationContext:
    """
    Contexto de rotación para `target_date`.

    `nearby_games`: juegos con `date` y `ecos_songs` (release_date, genre, spotify_playlist_id,
    spotify_playlist_name, artist_name), en cualquier orden y de cualquier fecha; aquí se
    filtran los que caen a ROTATION_DAYS días o menos de la fecha objetivo, antes o después
    (después solo hay juegos cuando se rellena un hueco).
    """
    target = date.fromisoformat(target_date)
    neighbors = {
        (target - timedelta(days=1)).isoformat(),
        (target + timedelta(days=1)).isoformat(),
    }
    ctx = RotationContext()
    for g in nearby_games:
        date_str = g.get("date") or ""
        if not date_str or date_str == target_date:
            continue
        if abs((date.fromisoformat(date_str) - target).days) > ROTATION_DAYS:
            continue
        song = g.get("ecos_songs") or {}
        if date_str in neighbors:
            decade = get_song_decade(song)
            if decade:
                ctx.neighbor_decades.add(decade)
            genre = get_special_genre(song.get("genre"), song.get("spotify_playlist_name"))
            if genre:
                ctx.neighbor_genres.add(genre)
        ctx.artists |= artist_names(song.get("artist_name"))
        pl_id = (song.get("spotify_playlist_id") or "").strip()
        if pl_id:
            ctx.playlists.add(pl_id)
    return ctx


def passes_rotation(song: dict, ctx: RotationContext) -> bool:
    """Reglas 3, 4 y 5."""
    decade = get_song_decade(song)
    if decade and decade in ctx.neighbor_decades:
        return False  # Regla 3
    genre = get_special_genre(song.get("genre"), song.get("spotify_playlist_name"))
    if genre and genre in ctx.neighbor_genres:
        return False  # Regla 4
    if artist_names(song.get("artist_name")) & ctx.artists:
        return False  # Regla 5
    return True


def pick_song(
    pool: list[dict],
    used: UsedSongs,
    nearby_games: list[dict],
    target_date: str,
    rng: random.Random,
) -> Pick:
    """Elige la canción de `target_date`. Ver las reglas al principio del módulo."""
    # Regla 1. Sin título o artista no hay juego posible (ni respuesta que validar).
    available = [
        s
        for s in pool
        if s.get("title") and s.get("artist_name") and not used.contains(s)
    ]
    if not available:
        return Pick(None, "Pool vacío: no quedan canciones no usadas")

    ctx = build_rotation_context(nearby_games, target_date)
    candidates = [s for s in available if passes_rotation(s, ctx)]
    rule = "3-5"

    # Regla 2: entre los válidos, preferir las playlists que no han salido en la ventana.
    priority = [
        s for s in candidates if (s.get("spotify_playlist_id") or "").strip() not in ctx.playlists
    ]
    if priority:
        candidates = priority
        rule = "2"

    # Regla 6.
    if not candidates:
        candidates = available
        rule = "6-fallback"

    song = rng.choice(candidates)
    return Pick(song, None, rule, len(available), len(candidates))
