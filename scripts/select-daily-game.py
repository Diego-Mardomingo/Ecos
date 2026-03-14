#!/usr/bin/env python3
"""
Selección diaria: elige 1 canción para el juego del día siguiente (visible a las 00:00 Madrid).
Ejecutar 1x/día a las 22:00 Madrid (GitHub Action). Crea el juego del día 8 el día 7 a las 22:00.
Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import logging
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# Cargar .env.local
_env = Path(__file__).resolve().parent.parent / ".env.local"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            if k.strip():
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

try:
    from supabase import create_client, Client
except ImportError:
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

MADRID = ZoneInfo("Europe/Madrid")
ROTATION_DAYS = 14
SPECIAL_GENRES = {"flamenco", "rap", "reggaeton"}


def setup_logging() -> logging.Logger:
    log = logging.getLogger("daily-game")
    log.setLevel(logging.INFO)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(h)
    return log


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


def main() -> None:
    log = setup_logging()
    start_ms = int(datetime.now().timestamp() * 1000)

    url_env = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url_env or not key_env:
        log.error("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos")
        sys.exit(1)

    supabase: Client = create_client(url_env, key_env)
    now_madrid = datetime.now(MADRID)
    # Juego del día siguiente (el cron corre a las 22:00, crea para mañana)
    target_date = (now_madrid + timedelta(days=1)).date().isoformat()
    cutoff_14 = (now_madrid - timedelta(days=ROTATION_DAYS)).date().isoformat()
    # Para reglas de rotación: evitar repetir década/género del juego actual (hoy)
    today_for_rotation = now_madrid.date().isoformat()

    # Usadas en ecos_games
    r_used = supabase.table("ecos_games").select("song_id").execute()
    used_song_ids = {str(r["song_id"]) for r in (r_used.data or []) if r.get("song_id")}

    # ¿Ya existe juego para hoy?
    r_existing = supabase.table("ecos_games").select("id").eq("date", target_date).execute()
    if r_existing.data and len(r_existing.data) > 0:
        log.info("Ya existe juego para %s (visible a las 00:00), nada que hacer", target_date)
        try:
            supabase.table("ecos_system_logs").insert({
                "job_type": "daily_game",
                "status": "success",
                "summary": "Juego ya existía para mañana",
                "duration_ms": int(datetime.now().timestamp() * 1000) - start_ms,
                "details": {"target_date": target_date, "skipped": True},
            }).execute()
        except Exception:
            pass
        return

    # Canciones elegibles: activas, con youtube o preview
    r_songs = supabase.table("ecos_songs").select(
        "id, title, artist_name, youtube_id, preview_url, release_date, genre, "
        "spotify_playlist_id, spotify_playlist_name"
    ).eq("is_active", True).execute()

    all_songs = [
        s for s in (r_songs.data or [])
        if s.get("youtube_id") or s.get("preview_url")
    ]

    # Regla 1: nunca repetir
    pool = [s for s in all_songs if str(s["id"]) not in used_song_ids]
    if not pool:
        log.error("Pool vacío: no hay canciones no usadas")
        _log_failure(supabase, start_ms, "Pool vacío")
        sys.exit(1)

    # Últimos 14 días de juegos con datos de canción (para reglas 2, 3, 4, 5)
    r_recent = supabase.table("ecos_games").select(
        "date, ecos_songs(release_date, genre, spotify_playlist_id, spotify_playlist_name, artist_name)"
    ).gte("date", cutoff_14).order("date", desc=True).execute()

    recent_games = r_recent.data or []
    yesterday_decade: str | None = None
    yesterday_genre: str | None = None
    artists_last_14: set[str] = set()
    playlist_last_date: dict[str, str] = {}

    for g in recent_games:
        song = g.get("ecos_songs") or {}
        date_str = g.get("date", "")
        if date_str == today_for_rotation:
            yesterday_decade = get_decade(song.get("release_date"))
            yesterday_genre = get_special_genre(song.get("genre"), song.get("spotify_playlist_name"))

        artist = (song.get("artist_name") or "").strip().lower()
        if artist:
            artists_last_14.add(artist)
        pl_id = song.get("spotify_playlist_id")
        if pl_id and (not playlist_last_date.get(pl_id) or playlist_last_date[pl_id] < date_str):
            playlist_last_date[pl_id] = date_str

    cutoff_priority = (now_madrid - timedelta(days=ROTATION_DAYS)).date().isoformat()
    priority_playlists = {pl for pl, d in playlist_last_date.items() if d < cutoff_priority}

    # Reglas 3, 4, 5: filtrar candidatos
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

    candidates = [s for s in pool if is_valid(s)]

    # Regla 2: prioridad playlists que llevan 14+ días sin aparecer
    priority_candidates = [s for s in candidates if (s.get("spotify_playlist_id") or "") in priority_playlists]
    if priority_candidates:
        candidates = priority_candidates
        log.info("Regla 2: %d candidatos de playlists prioritarias", len(candidates))

    # Regla 6: fallback aleatorio si no hay candidatos
    if not candidates:
        candidates = pool
        log.info("Regla 6: fallback aleatorio entre %d no usadas", len(candidates))

    song = random.choice(candidates)

    # Validar campos mínimos
    if not song.get("title") or not song.get("artist_name"):
        log.error("Canción sin title o artist_name")
        _log_failure(supabase, start_ms, "Campos requeridos faltantes")
        sys.exit(1)

    # Siguiente game_number
    r_count = supabase.table("ecos_games").select("*", count="exact", head=True).execute()
    next_game_number = (r_count.count or 0) + 1

    try:
        supabase.table("ecos_games").insert({
            "song_id": song["id"],
            "date": target_date,
            "game_number": next_game_number,
        }).execute()
        log.info("Ecos #%d para %s: %s / %s",
                 next_game_number, target_date, song.get("title", "")[:40], song.get("artist_name", "")[:30])
    except Exception as e:
        log.error("Error insertando juego: %s", e)
        _log_failure(supabase, start_ms, str(e))
        sys.exit(1)

    duration_ms = int(datetime.now().timestamp() * 1000) - start_ms
    try:
        supabase.table("ecos_system_logs").insert({
            "job_type": "daily_game",
            "status": "success",
            "summary": f"1 juego creado para {target_date}",
            "duration_ms": duration_ms,
            "details": {
                "target_date": target_date,
                "game_number": next_game_number,
                "song_id": str(song["id"]),
                "title": song.get("title"),
                "artist": song.get("artist_name"),
            },
        }).execute()
    except Exception as log_err:
        log.warning("No se pudo guardar log: %s", log_err)


def _log_failure(supabase: Client, start_ms: int, error: str) -> None:
    try:
        supabase.table("ecos_system_logs").insert({
            "job_type": "daily_game",
            "status": "failure",
            "summary": error,
            "duration_ms": int(datetime.now().timestamp() * 1000) - start_ms,
            "errors": [error],
            "details": {},
        }).execute()
    except Exception:
        pass


if __name__ == "__main__":
    main()
