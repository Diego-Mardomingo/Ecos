#!/usr/bin/env python3
"""
Backfill: genera juegos para fechas pasadas.

Usa las mismas reglas que select-daily-game.py, importándolas de selection.py (pool: preview >=
MIN_PREVIEW_SECONDS y playlist activa; no repetir canción, década, género especial ni artista).
Antes tenía una copia propia de las reglas, ya desfasada: no conocía `version_key`, ni el preview
repetido, ni la década por el nombre de la playlist, y su regla 2 tenía el mismo fallo que ya se
corrigió en el selector.

Script de un solo uso (ver README.md de este directorio): no lo llama ningún workflow.

Uso, desde la raíz del repo:
  PYTHONPATH=scripts python scripts/archivo/backfill-games.py --start 2026-01-01 --end 2026-03-14
  PYTHONPATH=scripts python scripts/archivo/backfill-games.py --start ... --end ... --dry-run

No escribe títulos ni artistas en la salida (el repo es público): solo ids de canción.
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date, timedelta

from common import get_supabase, load_env, setup_logging
from db_paging import fetch_all
from selection import UsedSongs, is_eligible, pick_song

SONG_COLUMNS = (
    "id, title, artist_name, preview_url, preview_duration_seconds, release_date, genre, "
    "spotify_playlist_id, spotify_playlist_name"
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill juegos diarios para rango de fechas")
    parser.add_argument("--start", required=True, help="Fecha inicio (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="Fecha fin (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="elige y cuenta, pero no inserta nada")
    parser.add_argument("--seed", type=int, help="semilla del sorteo")
    args = parser.parse_args()

    load_env()
    log = setup_logging("backfill")
    supabase = get_supabase(log, read_only=args.dry_run)
    rng = random.Random(args.seed)

    start_date = date.fromisoformat(args.start)
    end_date = date.fromisoformat(args.end)
    if start_date > end_date:
        log.error("--start debe ser anterior o igual a --end")
        sys.exit(1)
    dates_to_fill = [
        (start_date + timedelta(days=i)).isoformat()
        for i in range((end_date - start_date).days + 1)
    ]

    r_pl = supabase.table("ecos_spotify_playlists").select("spotify_playlist_id").eq("is_active", True).execute()
    active_playlist_ids = {
        (r.get("spotify_playlist_id") or "").strip()
        for r in (r_pl.data or [])
        if r.get("spotify_playlist_id")
    }
    songs = fetch_all(
        lambda: supabase.table("ecos_songs").select(SONG_COLUMNS, count="exact").eq("is_active", True)
    )
    pool = [s for s in songs if is_eligible(s, active_playlist_ids)]
    log.info("Pool elegible: %d de %d canciones activas", len(pool), len(songs))
    if not pool:
        log.error("No hay canciones en el catálogo")
        sys.exit(1)

    # Todos los juegos, con lo que piden las reglas 2-5. `pick_song` mira los de ±ROTATION_DAYS
    # alrededor de la fecha, antes y después, así que un hueco se rellena respetando los dos lados.
    games = fetch_all(
        lambda: supabase.table("ecos_games").select(
            "song_id, date, "
            "ecos_songs(title, artist_name, preview_url, release_date, genre, "
            "spotify_playlist_id, spotify_playlist_name)",
            count="exact",
        )
    )
    used = UsedSongs()
    nearby_games: list[dict] = []
    existing_dates: set[str] = set()
    for g in games:
        song = dict(g.get("ecos_songs") or {})
        song["id"] = g.get("song_id")
        used.add(song)
        existing_dates.add(g["date"])
        nearby_games.append({"date": g["date"], "ecos_songs": song})

    r_num = supabase.table("ecos_games").select("game_number").order("game_number", desc=True).limit(1).execute()
    next_number = (int(r_num.data[0]["game_number"]) if r_num.data else 0) + 1

    created = 0
    for target_date in dates_to_fill:
        if target_date in existing_dates:
            log.info("%s: ya existe, skip", target_date)
            continue

        pick = pick_song(pool, used, nearby_games, target_date, rng)
        song = pick.song
        if pick.error or not song:
            log.error("%s: sin candidatos válidos (%s)", target_date, pick.error)
            continue

        if not args.dry_run:
            try:
                supabase.table("ecos_games").insert(
                    {"song_id": song["id"], "date": target_date, "game_number": next_number}
                ).execute()
            except Exception as e:
                log.error("%s: error insertando: %s", target_date, e)
                continue
        used.add(song)
        nearby_games.append({"date": target_date, "ecos_songs": song})
        existing_dates.add(target_date)
        log.info(
            "%s: Ecos #%d%s — canción %s (regla %s, %d candidatos)",
            target_date, next_number, " [simulación]" if args.dry_run else "", song["id"], pick.rule, pick.candidates,
        )
        next_number += 1
        created += 1

    log.info("Backfill completado (%s - %s): %d juegos%s", args.start, args.end, created, " simulados" if args.dry_run else "")


if __name__ == "__main__":
    main()
