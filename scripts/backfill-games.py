#!/usr/bin/env python3
"""
Backfill: genera juegos para fechas pasadas (1 mar - 9 mar 2025).
Usa la misma lógica y reglas que select-daily-game.py.
Solo inserta en Supabase, sin archivos de salida.
"""
from __future__ import annotations

import logging
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

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

ROTATION_DAYS = 14
SPECIAL_GENRES = {"flamenco", "rap", "reggaeton"}


def get_decade(release_date: str | None) -> str | None:
    if not release_date or len(release_date) < 4:
        return None
    try:
        year = int(release_date[:4])
        if year >= 2020: return "2020s"
        if year >= 2010: return "2010s"
        if year >= 2000: return "2000s"
        if year >= 1990: return "90s"
        if year >= 1980: return "80s"
        return None
    except ValueError:
        return None


def get_special_genre(genre: str | None, playlist_name: str | None) -> str | None:
    text = " ".join(filter(None, [genre or "", playlist_name or ""])).lower()
    for g in SPECIAL_GENRES:
        if g in text:
            return g
    return None


def select_song_for_date(
    supabase: Client,
    target_date: str,
    used_song_ids: set[str],
    games_before: list[dict],
    all_songs: list[dict],
    log: logging.Logger,
) -> dict | None:
    """Selecciona una canción para target_date usando las 6 reglas."""
    yesterday = (date.fromisoformat(target_date) - timedelta(days=1)).isoformat()
    cutoff_14 = (date.fromisoformat(target_date) - timedelta(days=ROTATION_DAYS)).isoformat()

    pool = [s for s in all_songs if str(s["id"]) not in used_song_ids]
    if not pool:
        return None

    yesterday_decade = None
    yesterday_genre = None
    artists_last_14 = set()
    playlist_last_date = {}

    for g in games_before:
        song = g.get("ecos_songs") or {}
        date_str = g.get("date", "")
        if date_str == yesterday:
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
            return False
        genre = get_special_genre(s.get("genre"), s.get("spotify_playlist_name"))
        if yesterday_genre and genre == yesterday_genre:
            return False
        artist = (s.get("artist_name") or "").strip().lower()
        if artist and artist in artists_last_14:
            return False
        return True

    candidates = [s for s in pool if is_valid(s)]
    priority_candidates = [s for s in candidates if (s.get("spotify_playlist_id") or "") in priority_playlists]
    if priority_candidates:
        candidates = priority_candidates
    if not candidates:
        candidates = pool

    return random.choice(candidates)


def main() -> None:
    log = logging.getLogger("backfill")
    log.setLevel(logging.INFO)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(h)

    url_env = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url_env or not key_env:
        log.error("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos")
        sys.exit(1)

    supabase: Client = create_client(url_env, key_env)

    r_songs = supabase.table("ecos_songs").select(
        "id, title, artist_name, youtube_id, preview_url, release_date, genre, "
        "spotify_playlist_id, spotify_playlist_name"
    ).eq("is_active", True).execute()
    all_songs = [s for s in (r_songs.data or []) if s.get("youtube_id") or s.get("preview_url")]

    if not all_songs:
        log.error("No hay canciones en el catálogo")
        sys.exit(1)

    start_date = date(2025, 3, 1)
    end_date = date(2025, 3, 9)
    dates_to_fill = [
        (start_date + timedelta(days=i)).isoformat()
        for i in range((end_date - start_date).days + 1)
    ]

    r_used = supabase.table("ecos_games").select("song_id, date").execute()
    used_song_ids = {str(r["song_id"]) for r in (r_used.data or []) if r.get("song_id")}
    existing_dates = {r["date"] for r in (r_used.data or []) if r.get("date")}

    r_count = supabase.table("ecos_games").select("*", count="exact", head=True).execute()
    next_game_number = (r_count.count or 0) + 1

    for target_date in dates_to_fill:
        if target_date in existing_dates:
            log.info("%s: ya existe, skip", target_date)
            continue

        cutoff_14 = (date.fromisoformat(target_date) - timedelta(days=ROTATION_DAYS)).isoformat()
        r_recent = supabase.table("ecos_games").select(
            "date, ecos_songs(release_date, genre, spotify_playlist_id, spotify_playlist_name, artist_name)"
        ).gte("date", cutoff_14).lt("date", target_date).order("date", desc=True).execute()
        games_before = r_recent.data or []

        song = select_song_for_date(supabase, target_date, used_song_ids, games_before, all_songs, log)
        if not song or not song.get("title") or not song.get("artist_name"):
            log.error("%s: sin candidatos válidos", target_date)
            continue

        try:
            supabase.table("ecos_games").insert({
                "song_id": song["id"],
                "date": target_date,
                "game_number": next_game_number,
            }).execute()
            used_song_ids.add(str(song["id"]))
            next_game_number += 1
            log.info("%s: Ecos #%d — %s / %s",
                     target_date, next_game_number - 1,
                     song.get("title", "")[:35], song.get("artist_name", "")[:25])
        except Exception as e:
            log.error("%s: error insertando: %s", target_date, e)

    log.info("Backfill completado (1 mar - 9 mar 2025)")


if __name__ == "__main__":
    main()
