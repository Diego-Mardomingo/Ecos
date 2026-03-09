#!/usr/bin/env python3
"""
Ingesta semanal: SpotifyScraper + YouTube + Supabase + generación de 7 juegos.
Ejecutar 1x/semana (GitHub Action).
1. Scrape: 5 primeras por playlist (si duplicadas, 5 siguientes; máx 10). Playlist personal: todas.
   Guarda todos los datos en raw_spotify_data.
2. Selección: elige 7 canciones aleatorias y crea ecos_games para los 7 próximos días.
Logs separados: ingestion (por playlist) y weekly_games (selección random).
Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

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
    from spotify_scraper import SpotifyClient
    from spotify_scraper.parsers.json_parser import extract_track_data_from_page
    from supabase import create_client, Client
except ImportError as e:
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

# --- Config ---
# (playlist_id, nombre, modo)
# modo: "default" = 5 primeras, si duplicadas -> 5 siguientes (máx 10)
#       "all"     = todas las canciones (playlist personal)
PLAYLISTS: list[tuple[str, str, str]] = [
    ("37i9dQZEVXbNFJfN1Vw8d9", "Top 50 Spain", "default"),
    ("37i9dQZF1DXaxEKcoCdWHD", "Exitos Espana", "default"),
    ("37i9dQZF1DWVskFRGurTfg", "Hits Urbanos", "default"),
    ("37i9dQZF1DXcd2Vmhfon1w", "Rap Espanol", "default"),
    ("37i9dQZF1DWV7FWPDK0Dg1", "Flamenco Pop", "default"),
    ("37i9dQZF1DWZMtkg0cMXbp", "Flamenco Flow", "default"),
    ("37i9dQZF1DX8SfyqmSFDwe", "Old School Reggaeton", "default"),
    ("37i9dQZF1DX09mi3a4Zmox", "Baladas Romanticas", "default"),
    ("37i9dQZF1DXdnGF35OawbN", "Verano Forever", "default"),
    ("37i9dQZF1DX20VDU4OIBfS", "Canciones del Recuerdo", "default"),
    ("37i9dQZF1DX7alvT6zKWrM", "Los 2010 Espana", "default"),
    ("37i9dQZF1DXb0AsvHMF4aM", "Los 2000s Espana", "default"),
    ("37i9dQZF1DWXm9R2iowygp", "Los 90 Espana", "default"),
    ("37i9dQZF1DWU4xtX4v6Z9l", "Los 80 Espana", "default"),
    ("5xeQJDbA4L6LNyVeFz3MHF", "Playlist Personal", "all"),
]
CHUNK_SIZE = 5  # Por defecto: 5 primeras, luego 5 siguientes si las primeras duplicadas
ALBUM_PATTERNS = [
    r"open\.spotify\.com/album/([a-zA-Z0-9]{20,25})",
    r"spotify:album:([a-zA-Z0-9]{20,25})",
]
YOUTUBE_BLACKLIST = [
    "live", "version", "acústico", "acoustic", "cover", "karaoke",
    "instrumental", "en vivo", "concierto", "remix",
]
YOUTUBE_QUERIES = [
    lambda t, a: f"{t} {a} official audio",
    lambda t, a: f"{t} {a} letra",
    lambda t, a: f"{t} {a} official video",
    lambda t, a: f"{t} {a}",
]


def setup_logging(verbose: bool = True) -> logging.Logger:
    log = logging.getLogger("ingest")
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(h)
    # Reducir ruido del scraper de Spotify
    logging.getLogger("spotify_scraper").setLevel(logging.WARNING)
    return log


def extract_album_id(html: str) -> str | None:
    for pat in ALBUM_PATTERNS:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


def get_spotify_id(track: dict) -> str:
    tid = track.get("id")
    if tid:
        return tid
    uri = track.get("uri", "")
    return uri.split(":")[-1] if uri and ":" in uri else ""


def enrich_track(client: SpotifyClient, track: dict, log: logging.Logger) -> dict | None:
    sid = get_spotify_id(track)
    if not sid:
        return None
    embed_url = f"https://open.spotify.com/embed/track/{sid}"
    try:
        html = client.browser.get_page_content(embed_url)
        full = extract_track_data_from_page(html)
        full["spotify_id"] = full.get("id") or sid
        album = full.get("album") or {}
        if not album.get("name"):
            try:
                reg_html = client.browser.get_page_content(f"https://open.spotify.com/track/{sid}")
                aid = extract_album_id(reg_html)
                if aid:
                    alb = client.get_album_info(f"https://open.spotify.com/album/{aid}")
                    if alb.get("name"):
                        full.setdefault("album", {})["name"] = alb["name"]
            except Exception:
                pass
        return full
    except Exception as e:
        log.warning("  Fallo enriquecer %s: %s", sid, e)
        return None


def _build_raw_spotify_data(full: dict, pl_id: str, pl_name: str) -> dict:
    """Construye raw_spotify_data solo con los campos del scraper + playlist."""
    album = full.get("album") or {}
    images = album.get("images") or []
    cover = images[0].get("url") if images else None
    artists = full.get("artists", [])
    artist = ", ".join(a.get("name", "") for a in artists if a.get("name")) or "Unknown"
    return {
        "spotify_id": full.get("id") or full.get("spotify_id"),
        "title": full.get("name"),
        "artist_name": artist,
        "album_title": album.get("name"),
        "duration_ms": full.get("duration_ms"),
        "explicit": bool(full.get("explicit") or full.get("is_explicit")),
        "release_date": album.get("release_date") or full.get("release_date"),
        "preview_url": full.get("preview_url"),
        "cover_url": cover,
        "spotify_playlist_id": pl_id,
        "spotify_playlist_name": pl_name,
    }


def search_youtube(title: str, artist: str, api_key: str) -> str | None:
    def blacklisted(s: str) -> bool:
        return any(w in s.lower() for w in YOUTUBE_BLACKLIST)

    for qfn in YOUTUBE_QUERIES:
        q = qfn(title, artist)
        url = (
            f"https://www.googleapis.com/youtube/v3/search?part=snippet&type=video"
            f"&videoEmbeddable=true&maxResults=10&q={urllib.parse.quote(q)}&key={api_key}"
        )
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=15) as r:
                data = json.loads(r.read().decode())
        except Exception:
            continue
        for item in data.get("items", []):
            vid = item.get("id", {}).get("videoId")
            snip = item.get("snippet", {}).get("title", "")
            if not vid or blacklisted(snip):
                continue
            status_url = f"https://www.googleapis.com/youtube/v3/videos?part=status&id={vid}&key={api_key}"
            try:
                with urllib.request.urlopen(urllib.request.Request(status_url), timeout=10) as sr:
                    sd = json.loads(sr.read().decode())
                if (sd.get("items") or [{}])[0].get("status", {}).get("embeddable") is True:
                    return vid
            except Exception:
                continue
    return None


def main() -> None:
    log = setup_logging()
    start_ms = int(datetime.utcnow().timestamp() * 1000)

    url_env = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    yt_key = os.environ.get("YOUTUBE_API_KEY")
    if not url_env or not key_env:
        log.error("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos")
        sys.exit(1)
    if not yt_key:
        log.error("YOUTUBE_API_KEY requerido")
        sys.exit(1)

    supabase: Client = create_client(url_env, key_env)
    existing = {r["spotify_id"] for r in (supabase.table("ecos_songs").select("spotify_id").execute()).data or []}
    seen_this_run: set[str] = set()
    errors: list[str] = []
    playlist_stats: list[dict] = []
    total_found = 0
    total_duplicates = 0
    total_no_yt = 0
    total_inserted = 0

    log.info("=== Ingesta semanal Ecos ===")
    log.info("Playlists: %d", len(PLAYLISTS))

    client = SpotifyClient()

    try:
        for pl_idx, (pl_id, pl_name, mode) in enumerate(PLAYLISTS):
            pl_found = 0
            pl_duplicates = 0
            pl_no_yt = 0
            pl_inserted = 0
            url = f"https://open.spotify.com/playlist/{pl_id}"
            try:
                playlist = client.get_playlist_info(url)
                all_tracks = playlist.get("tracks") or []
            except Exception as e:
                log.warning("[%d/%d] Playlist NO ENCONTRADA: %s (%s) - %s", pl_idx + 1, len(PLAYLISTS), pl_name, pl_id, e)
                playlist_stats.append({
                    "playlist": pl_name,
                    "playlist_id": pl_id,
                    "status": "error",
                    "error": str(e),
                    "tracks_processed": 0,
                    "duplicates": 0,
                    "no_youtube": 0,
                    "inserted": 0,
                })
                errors.append(f"Playlist {pl_name} ({pl_id}): {e}")
                continue

            pl_total_in_playlist = len(all_tracks)
            chunk1 = all_tracks[:CHUNK_SIZE]
            chunk2 = all_tracks[CHUNK_SIZE : CHUNK_SIZE * 2] if len(all_tracks) > CHUNK_SIZE else []
            if mode == "all":
                batches: list[list] = [all_tracks]
            else:
                batches = [chunk1] if chunk1 else []

            for batch in batches:
                for i, tr in enumerate(batch):
                    full = enrich_track(client, tr, log)
                    if not full:
                        continue
                    sid = get_spotify_id(full) or full.get("spotify_id", "")
                    if not sid:
                        continue

                    if sid in existing or sid in seen_this_run:
                        pl_duplicates += 1
                        total_duplicates += 1
                        continue
                    seen_this_run.add(sid)

                    artists = full.get("artists", [])
                    artist = ", ".join(a.get("name", "") for a in artists if a.get("name")) or "Unknown"
                    title = full.get("name") or "Unknown"
                    album = full.get("album") or {}
                    images = album.get("images") or []
                    cover = images[0].get("url") if images else None

                    yt_id = search_youtube(title, artist, yt_key)
                    if not yt_id:
                        pl_no_yt += 1
                        total_no_yt += 1
                        continue

                    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
                    row = {
                        "spotify_id": sid,
                        "title": title,
                        "artist_name": artist,
                        "album_title": album.get("name"),
                        "cover_url": cover,
                        "duration_ms": full.get("duration_ms"),
                        "explicit": bool(full.get("explicit") or full.get("is_explicit")),
                        "release_date": album.get("release_date") or full.get("release_date"),
                        "preview_url": full.get("preview_url"),
                        "spotify_playlist_id": pl_id,
                        "spotify_playlist_name": pl_name,
                        "youtube_id": yt_id,
                        "youtube_verified": True,
                        "youtube_verified_at": now_iso,
                        "is_active": True,
                        "raw_spotify_data": _build_raw_spotify_data(full, pl_id, pl_name),
                    }
                    try:
                        supabase.table("ecos_songs").insert(row).execute()
                        existing.add(sid)
                        pl_inserted += 1
                        total_inserted += 1
                        log.debug("  + %s - %s", title[:40], artist[:30])
                    except Exception as ins_err:
                        err_msg = str(ins_err)
                        if "23505" in err_msg or "duplicate" in err_msg.lower():
                            existing.add(sid)
                            pl_duplicates += 1
                            total_duplicates += 1
                        else:
                            errors.append(f"{title} / {artist}: {err_msg}")
                            log.warning("  Insert error: %s", err_msg)
                if mode == "default" and batch == chunk1 and pl_inserted == 0 and chunk2:
                    batches.append(chunk2)

            pl_found = sum(len(b) for b in batches)
            total_found += pl_found
            log.info("[%d/%d] %s: procesadas %d tracks (total playlist: %d, modo: %s)", pl_idx + 1, len(PLAYLISTS), pl_name, pl_found, pl_total_in_playlist, mode)

            playlist_stats.append({
                "playlist": pl_name,
                "playlist_id": pl_id,
                "status": "ok",
                "mode": mode,
                "tracks_in_playlist": pl_total_in_playlist,
                "tracks_processed": pl_found,
                "duplicates": pl_duplicates,
                "no_youtube": pl_no_yt,
                "inserted": pl_inserted,
            })
            log.info("  -> insertadas: %d, duplicadas: %d, sin YouTube: %d", pl_inserted, pl_duplicates, pl_no_yt)

    finally:
        client.close()

    duration_ms = int(datetime.utcnow().timestamp() * 1000) - start_ms
    status = "failure" if errors and total_inserted == 0 else ("partial" if errors else "success")
    summary = f"{total_inserted} canciones insertadas" if total_inserted > 0 else (errors[0][:100] if errors else "Sin canciones nuevas")

    log.info("=== Resumen ===")
    log.info("Tracks encontrados: %d | Duplicados: %d | Sin YouTube: %d | Insertadas: %d", total_found, total_duplicates, total_no_yt, total_inserted)
    log.info("Duracion: %d ms | Estado: %s", duration_ms, status)

    try:
        supabase.table("ecos_system_logs").insert({
            "job_type": "ingestion",
            "status": status,
            "summary": summary,
            "duration_ms": duration_ms,
            "errors": errors[:20] if errors else None,
            "details": {
                "playlists_checked": len(PLAYLISTS),
                "tracks_found": total_found,
                "duplicates": total_duplicates,
                "no_youtube": total_no_yt,
                "songs_added": total_inserted,
                "playlist_stats": playlist_stats,
            },
        }).execute()
        log.info("Log ingestion guardado en ecos_system_logs")
    except Exception as log_err:
        log.error("No se pudo guardar log ingestion: %s", log_err)

    if status == "failure":
        sys.exit(1)

    # === 2. SELECCIÓN DE 7 JUEGOS PARA LA SEMANA ===
    log.info("=== Selección semanal de juegos ===")
    games_start_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    used_song_ids: set[str] = set()
    games_log: list[dict] = []
    games_errors: list[str] = []
    games_created = 0

    r_used = supabase.table("ecos_games").select("song_id").execute()
    for row in (r_used.data or []):
        if row.get("song_id"):
            used_song_ids.add(str(row["song_id"]))

    r_songs = supabase.table("ecos_songs").select("id, title, artist_name, youtube_id, cover_url").eq("is_active", True).eq("youtube_verified", True).not_.is_("youtube_id", "null").execute()
    all_songs = r_songs.data or []
    pool = [s for s in all_songs if str(s["id"]) not in used_song_ids]
    total_pool = len(pool)

    r_count = supabase.table("ecos_games").select("*", count="exact", head=True).execute()
    next_game_number = (r_count.count or 0) + 1

    log.info("Pool disponible: %d canciones (total con youtube: %d, ya usadas: %d)", total_pool, len(all_songs), len(used_song_ids))

    for i in range(1, 8):
        day = datetime.now(timezone.utc).date() + timedelta(days=i)
        date_str = day.isoformat()
        available = [s for s in pool if str(s["id"]) not in used_song_ids]
        if not available:
            log.warning("Día %s: Sin canciones disponibles en pool", date_str)
            games_log.append({"date": date_str, "status": "error", "error": "pool_vacio"})
            games_errors.append(f"{date_str}: pool vacío")
            continue

        r_existing = supabase.table("ecos_games").select("id").eq("date", date_str).execute()
        if r_existing.data and len(r_existing.data) > 0:
            log.info("Día %s: ya existe juego, skip", date_str)
            games_log.append({"date": date_str, "status": "skipped", "reason": "ya_existe"})
            continue

        song = random.choice(available)
        missing = []
        if not song.get("title"):
            missing.append("title")
        if not song.get("artist_name"):
            missing.append("artist_name")
        if not song.get("youtube_id"):
            missing.append("youtube_id")
        if missing:
            log.warning("Día %s: canción sin campos requeridos %s - %s", date_str, missing, song.get("title", "?"))
            games_log.append({"date": date_str, "status": "error", "error": "missing_fields", "missing": missing, "song_id": str(song.get("id"))})
            games_errors.append(f"{date_str}: falta {', '.join(missing)}")
            continue

        try:
            supabase.table("ecos_games").insert({
                "song_id": song["id"],
                "date": date_str,
                "game_number": next_game_number,
            }).execute()
            used_song_ids.add(str(song["id"]))
            next_game_number += 1
            games_created += 1
            log.info("Día %s: Ecos #%d - %s / %s", date_str, next_game_number - 1, song.get("title", "")[:35], song.get("artist_name", "")[:25])
            games_log.append({
                "date": date_str,
                "status": "ok",
                "game_number": next_game_number - 1,
                "song_id": str(song["id"]),
                "title": song.get("title"),
                "artist": song.get("artist_name"),
            })
        except Exception as e:
            err_msg = str(e)
            log.warning("Día %s: error insertando juego: %s", date_str, err_msg)
            games_log.append({"date": date_str, "status": "error", "error": err_msg, "song_id": str(song.get("id"))})
            games_errors.append(f"{date_str}: {err_msg[:80]}")

    games_duration = int(datetime.now(timezone.utc).timestamp() * 1000) - games_start_ms
    games_status = "failure" if games_created == 0 and games_errors else ("partial" if games_errors else "success")
    games_summary = f"{games_created} juegos creados para 7 días" if games_created > 0 else ("Errores: " + "; ".join(games_errors[:3]) if games_errors else "Sin juegos que crear")

    log.info("=== Resumen juegos ===")
    log.info("Creados: %d | Errores: %d | Pool inicial: %d | Duracion: %d ms", games_created, len(games_errors), total_pool, games_duration)

    try:
        supabase.table("ecos_system_logs").insert({
            "job_type": "weekly_games",
            "status": games_status,
            "summary": games_summary,
            "duration_ms": games_duration,
            "errors": games_errors[:20] if games_errors else None,
            "details": {
                "pool_total": total_pool,
                "games_created": games_created,
                "games_per_day": games_log,
            },
        }).execute()
        log.info("Log weekly_games guardado en ecos_system_logs")
    except Exception as log_err:
        log.error("No se pudo guardar log weekly_games: %s", log_err)


if __name__ == "__main__":
    main()
