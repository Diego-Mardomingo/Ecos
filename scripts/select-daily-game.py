#!/usr/bin/env python3
"""
Selección diaria: elige 1 canción para el juego del día siguiente (visible a las 00:00 Madrid).
Ejecutar 1x/día ~22:00 Madrid (GitHub Action). Crea el juego del día siguiente si falta;
si el cron llega tarde y ya es medianoche en Madrid, rellena primero el día en curso.

Pool elegible: preview_url + preview_duration_seconds >= MIN_PREVIEW_SECONDS + spotify_playlist_id en
ecos_spotify_playlists con is_active = true.
(30 s nominales de Spotify suelen medir ~29.7 s en MP3; el umbral es ligeramente inferior para no vaciar el pool.)

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
# Pool elegible: preview medido >= este umbral (s) y playlist activa en ecos_spotify_playlists
MIN_PREVIEW_SECONDS = 29.0


def format_date_ddmmyyyy(iso_date: str) -> str:
    """Convierte fecha ISO (YYYY-MM-DD) a DD/MM/YYYY para logs."""
    return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%d/%m/%Y")


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


def get_pending_game_dates(supabase: Client, now_madrid: datetime) -> list[str]:
    """TODOS los días en [hoy, mañana] (Madrid) sin juego, en orden.

    Crítico: si el cron se salta un día (GitHub cron es best-effort), hay que rellenar
    tanto el día en curso como el siguiente para no dejar la web sin juego y para que
    el desfase no se arrastre indefinidamente.
    """
    pending: list[str] = []
    for offset in (0, 1):
        candidate = (now_madrid.date() + timedelta(days=offset)).isoformat()
        r_existing = supabase.table("ecos_games").select("id").eq("date", candidate).limit(1).execute()
        if not r_existing.data:
            pending.append(candidate)
    return pending


def _load_eligible_pool(supabase: Client, log: logging.Logger) -> list[dict]:
    """Canciones activas que cumplen playlist activa + preview_url + duración mínima."""
    r_pl = (
        supabase.table("ecos_spotify_playlists")
        .select("spotify_playlist_id")
        .eq("is_active", True)
        .execute()
    )
    active_playlist_ids = {
        (r.get("spotify_playlist_id") or "").strip()
        for r in (r_pl.data or [])
        if r.get("spotify_playlist_id")
    }

    r_songs = supabase.table("ecos_songs").select(
        "id, title, artist_name, youtube_id, preview_url, preview_duration_seconds, release_date, genre, "
        "spotify_playlist_id, spotify_playlist_name"
    ).eq("is_active", True).execute()

    def is_eligible_pool(song: dict) -> bool:
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

    return [s for s in (r_songs.data or []) if is_eligible_pool(s)]


def select_song_for_date(
    supabase: Client,
    target_date: str,
    now_madrid: datetime,
    all_songs: list[dict],
    used_song_ids: set[str],
    log: logging.Logger,
) -> tuple[dict | None, str | None]:
    """Aplica las reglas de selección para una fecha. Devuelve (song, error).

    Relee el contexto de rotación desde la BD, así que si en esta misma ejecución se
    creó el juego de hoy, la selección de mañana ya lo tiene en cuenta.
    """
    cutoff_14 = (now_madrid - timedelta(days=ROTATION_DAYS)).date().isoformat()
    rotation_reference_date = (
        datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=1)
    ).isoformat()

    # Regla 1: nunca repetir
    pool = [s for s in all_songs if str(s["id"]) not in used_song_ids]
    if not pool:
        return None, "Pool vacío: no quedan canciones no usadas"

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
        if date_str == rotation_reference_date:
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

    if not song.get("title") or not song.get("artist_name"):
        return None, "Campos requeridos faltantes (title/artist_name)"

    return song, None


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

    pending_dates = get_pending_game_dates(supabase, now_madrid)
    if not pending_dates:
        log.info("Ya existen juegos para hoy y mañana en Madrid, nada que hacer")
        try:
            supabase.table("ecos_system_logs").insert({
                "job_type": "daily_game",
                "status": "success",
                "summary": "Juegos ya existían para hoy y mañana",
                "duration_ms": int(datetime.now().timestamp() * 1000) - start_ms,
                "details": {"skipped": True, "madrid_now": now_madrid.isoformat()},
            }).execute()
        except Exception as log_err:
            log.warning("No se pudo guardar log: %s", log_err)
        return

    all_songs = _load_eligible_pool(supabase, log)
    if not all_songs:
        msg = (
            f"Pool elegible vacío: ninguna canción cumple preview ≥ {MIN_PREVIEW_SECONDS:g}s, "
            "playlist activa y preview_url"
        )
        log.error(msg)
        _log_failure(supabase, start_ms, msg)
        sys.exit(1)

    r_used = supabase.table("ecos_games").select("song_id").execute()
    used_song_ids = {str(r["song_id"]) for r in (r_used.data or []) if r.get("song_id")}

    r_count = supabase.table("ecos_games").select("*", count="exact", head=True).execute()
    next_game_number = (r_count.count or 0) + 1

    created: list[str] = []
    for target_date in pending_dates:
        song, err = select_song_for_date(
            supabase, target_date, now_madrid, all_songs, used_song_ids, log
        )
        if err or not song:
            log.error("No se pudo seleccionar para %s: %s", target_date, err)
            _log_failure(supabase, start_ms, f"{target_date}: {err}")
            # Si falla el primer día seguimos intentando el segundo; solo abortamos
            # con exit!=0 al final si no se creó ninguno.
            continue

        try:
            supabase.table("ecos_games").insert({
                "song_id": song["id"],
                "date": target_date,
                "game_number": next_game_number,
            }).execute()
        except Exception as e:
            # Otra ejecución concurrente pudo crear el juego (unique en date): tratar como benigno.
            log.warning("No se pudo insertar juego para %s (¿ya existe?): %s", target_date, e)
            _log_failure(supabase, start_ms, f"insert {target_date}: {e}")
            continue

        log.info("Ecos #%d para %s: %s / %s",
                 next_game_number, target_date, song.get("title", "")[:40], song.get("artist_name", "")[:30])

        # Actualizar estado local para que la siguiente fecha no repita canción.
        used_song_ids.add(str(song["id"]))
        try:
            supabase.table("ecos_system_logs").insert({
                "job_type": "daily_game",
                "status": "success",
                "summary": f"1 juego creado para {format_date_ddmmyyyy(target_date)}",
                "duration_ms": int(datetime.now().timestamp() * 1000) - start_ms,
                "details": {
                    "target_date": format_date_ddmmyyyy(target_date),
                    "game_number": next_game_number,
                    "song_id": str(song["id"]),
                    "title": song.get("title"),
                    "artist": song.get("artist_name"),
                    "playlist": song.get("spotify_playlist_name") or None,
                    "playlist_id": song.get("spotify_playlist_id") or None,
                },
            }).execute()
        except Exception as log_err:
            log.warning("No se pudo guardar log: %s", log_err)

        created.append(target_date)
        next_game_number += 1

    if not created:
        log.error("No se creó ningún juego para las fechas pendientes: %s", pending_dates)
        sys.exit(1)


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
