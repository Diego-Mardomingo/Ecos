#!/usr/bin/env python3
"""
Ingesta semanal: SpotifyScraper + YouTube + Supabase.
Ejecutar 1x/semana (GitHub Action).
Scrape por playlist: bloques de 5; solo salta al siguiente bloque si las 5 están duplicadas.
Sin límite de canciones. Playlist personal: todas.
La selección diaria de juegos corre en workflow separado (daily-game.yml).
Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from io import BytesIO

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
    from mutagen.mp3 import MP3
except ImportError as e:
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

# --- Config ---
CHUNK_SIZE = 5  # Bloque de 5; saltar al siguiente solo si las 5 duplicadas
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


def normalize_text(s: str | None) -> str:
    if not s:
        return ""
    s = s.strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def track_key(title: str | None, artist: str | None) -> str:
    return f"{normalize_text(title)}|{normalize_text(artist)}"


def extract_title_artist_from_track(track: dict) -> tuple[str | None, str | None]:
    title = track.get("name") or track.get("title")
    artists = track.get("artists")
    if isinstance(artists, list):
        artist = ", ".join(a.get("name", "") for a in artists if isinstance(a, dict) and a.get("name")) or None
    else:
        artist = track.get("artist_name") or None
    return title, artist


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


def load_active_playlists(supabase: Client) -> list[tuple[str, str, str]]:
    """
    Devuelve [(spotify_playlist_id, spotify_playlist_name, ingest_mode)] solo activas.
    ingest_mode: 'default' o 'all'
    """
    res = (
        supabase.table("ecos_spotify_playlists")
        .select("spotify_playlist_id, spotify_playlist_name, ingest_mode")
        .eq("is_active", True)
        .order("created_at", desc=False)
        .execute()
    )
    rows = res.data or []
    out: list[tuple[str, str, str]] = []
    for r in rows:
        pl_id = (r.get("spotify_playlist_id") or "").strip()
        if not pl_id:
            continue
        name = (r.get("spotify_playlist_name") or pl_id).strip()
        mode = (r.get("ingest_mode") or "default").strip()
        if mode not in ("default", "all"):
            mode = "default"
        out.append((pl_id, name, mode))
    return out


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
    existing_rows = (supabase.table("ecos_songs").select("spotify_id, title, artist_name").execute()).data or []
    existing = {r["spotify_id"] for r in existing_rows if r.get("spotify_id")}
    existing_keys = {track_key(r.get("title"), r.get("artist_name")) for r in existing_rows}
    seen_this_run: set[str] = set()
    seen_keys_this_run: set[str] = set()
    errors: list[str] = []
    playlist_stats: list[dict] = []
    total_found = 0
    total_duplicates = 0
    total_no_yt = 0
    total_inserted = 0

    log.info("=== Ingesta semanal Ecos ===")
    PLAYLISTS = load_active_playlists(supabase)
    log.info("Playlists activas: %d", len(PLAYLISTS))
    if not PLAYLISTS:
        log.warning("No hay playlists activas en ecos_spotify_playlists")

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
            if mode == "all":
                block_idx = 0
                blocks_to_try: list[list] = [all_tracks]
            else:
                block_idx = 0
                blocks_to_try = [
                    all_tracks[i : i + CHUNK_SIZE]
                    for i in range(0, len(all_tracks), CHUNK_SIZE)
                    if all_tracks[i : i + CHUNK_SIZE]
                ]

            pl_found = 0
            done_with_playlist = False
            while block_idx < len(blocks_to_try) and not done_with_playlist:
                block = blocks_to_try[block_idx]
                if mode == "default" and len(block) == CHUNK_SIZE:
                    # Quick check: ¿las 5 duplicadas? Si sí, saltar bloque sin enriquecer
                    sids = [get_spotify_id(tr) or "" for tr in block]
                    keys = []
                    for tr in block:
                        t, a = extract_title_artist_from_track(tr)
                        keys.append(track_key(t, a))
                    all_block_dup = all(
                        (
                            (sid and (sid in existing or sid in seen_this_run))
                            or (k and (k in existing_keys or k in seen_keys_this_run))
                        )
                        for sid, k in zip(sids, keys)
                    )
                    if all_block_dup:
                        for sid in sids:
                            if sid:
                                seen_this_run.add(sid)
                        for k in keys:
                            if k:
                                seen_keys_this_run.add(k)
                        pl_duplicates += len(block)
                        total_duplicates += len(block)
                        pl_found += len(block)
                        block_idx += 1
                        continue

                inserted_in_block = 0
                for tr in block:
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

                    preview_url = full.get("preview_url")
                    dedupe_key = track_key(title, artist)
                    if dedupe_key and (dedupe_key in existing_keys or dedupe_key in seen_keys_this_run):
                        pl_duplicates += 1
                        total_duplicates += 1
                        continue

                    yt_id = search_youtube(title, artist, yt_key)
                    if not yt_id and not preview_url:
                        pl_no_yt += 1
                        total_no_yt += 1
                        continue

                    # Si entra por preview, exigir duración mínima usable (>=28s)
                    if not yt_id and preview_url:
                        dur = get_mp3_duration_seconds(preview_url)
                        if dur is None or dur < 28.0:
                            # no insertar si no hay preview suficiente
                            pl_no_yt += 1
                            total_no_yt += 1
                            continue

                    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
                    uses_preview = not yt_id and preview_url
                    row = {
                        "spotify_id": sid,
                        "title": title,
                        "artist_name": artist,
                        "album_title": album.get("name"),
                        "cover_url": cover,
                        "duration_ms": full.get("duration_ms"),
                        "explicit": bool(full.get("explicit") or full.get("is_explicit")),
                        "release_date": album.get("release_date") or full.get("release_date"),
                        "preview_url": preview_url,
                        "spotify_playlist_id": pl_id,
                        "spotify_playlist_name": pl_name,
                        "youtube_id": yt_id,
                        "youtube_verified": bool(yt_id),
                        "youtube_verified_at": now_iso if yt_id else None,
                        "is_active": True,
                        "raw_spotify_data": _build_raw_spotify_data(full, pl_id, pl_name),
                    }
                    try:
                        supabase.table("ecos_songs").insert(row).execute()
                        existing.add(sid)
                        if dedupe_key:
                            existing_keys.add(dedupe_key)
                        pl_inserted += 1
                        total_inserted += 1
                        inserted_in_block += 1
                        log.debug("  + %s - %s%s", title[:40], artist[:30], " (preview)" if uses_preview else "")
                    except Exception as ins_err:
                        err_msg = str(ins_err)
                        if "23505" in err_msg or "duplicate" in err_msg.lower():
                            existing.add(sid)
                            if dedupe_key:
                                existing_keys.add(dedupe_key)
                            pl_duplicates += 1
                            total_duplicates += 1
                        else:
                            errors.append(f"{title} / {artist}: {err_msg}")
                            log.warning("  Insert error: %s", err_msg)

                pl_found += len(block)
                if inserted_in_block > 0:
                    done_with_playlist = True
                else:
                    block_idx += 1

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


if __name__ == "__main__":
    main()
