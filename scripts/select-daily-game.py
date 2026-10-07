#!/usr/bin/env python3
"""
Selección diaria: mantiene creados los juegos de hoy y de los DAYS_AHEAD días siguientes (Madrid).
Ejecutar 1x/día (GitHub Action). En régimen normal cada ejecución crea el juego de pasado mañana;
si el cron se salta días, rellena en orden todos los huecos, empezando por el día en curso.

Las reglas de selección están en selection.py; aquí solo se lee la base de datos, se llama a
`pick_song` y se inserta.

Sale con 1 si alguna fecha pendiente se queda sin juego, aunque las demás se hayan creado: un
run verde tiene que significar que están todas.

Uso:
  python scripts/select-daily-game.py              # crea los juegos que falten
  python scripts/select-daily-game.py --dry-run    # simulación: lee la BD y no escribe nada
  python scripts/select-daily-game.py --dry-run --hoy 2026-10-20 --seed 1

Requiere: pip install -r scripts/requirements-selector.txt
"""
from __future__ import annotations

import argparse
import logging
import random
import sys
from datetime import date, datetime, timedelta
from typing import Any

from common import (
    JOB_DAILY_GAME,
    MADRID,
    get_supabase,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)
from db_paging import fetch_all
from selection import (
    DAYS_AHEAD,
    MIN_PREVIEW_SECONDS,
    ROTATION_DAYS,
    UsedSongs,
    is_eligible,
    pick_song,
)

# Columnas de la canción que necesitan las reglas (pool y juegos recientes).
SONG_COLUMNS = (
    "id, title, artist_name, preview_url, preview_duration_seconds, release_date, genre, "
    "spotify_playlist_id, spotify_playlist_name"
)
NEARBY_SONG_COLUMNS = "release_date, genre, spotify_playlist_id, spotify_playlist_name, artist_name"
# Reintentos del insert si otro proceso se queda antes con el mismo game_number.
INSERT_ATTEMPTS = 3


def format_date_ddmmyyyy(iso_date: str) -> str:
    """Convierte fecha ISO (YYYY-MM-DD) a DD/MM/YYYY para logs."""
    return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%d/%m/%Y")


def get_pending_game_dates(supabase: Any, today: date) -> list[str]:
    """TODOS los días en [hoy, hoy + DAYS_AHEAD] (Madrid) sin juego, en orden.

    Crítico: el cron de GitHub es best-effort y llega con horas de retraso (hasta pasada la
    medianoche de Madrid, lo que dejó la web sin juego el 06/10/2026). Con un solo día de margen,
    un retraso así basta para que a las 00:00 no exista el juego. Con dos, una ejecución tardía
    sigue llegando con más de 24 h de colchón.
    """
    dates = [(today + timedelta(days=offset)).isoformat() for offset in range(DAYS_AHEAD + 1)]
    r = supabase.table("ecos_games").select("date").in_("date", dates).execute()
    existing = {row["date"] for row in (r.data or [])}
    return [d for d in dates if d not in existing]


def load_eligible_pool(supabase: Any, log: logging.Logger) -> list[dict]:
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

    # Paginado: sin esto la API devuelve 1.000 filas de las ~1.600 activas y el sorteo diario
    # nunca llega a ver el resto del catálogo.
    songs = fetch_all(
        lambda: supabase.table("ecos_songs").select(SONG_COLUMNS, count="exact").eq("is_active", True)
    )
    pool = [s for s in songs if is_eligible(s, active_playlist_ids)]
    log.info("Pool elegible: %d de %d canciones activas", len(pool), len(songs))
    return pool


def load_used_songs(supabase: Any) -> UsedSongs:
    """Canciones que ya salieron en algún juego, de cualquier fecha (regla 1)."""
    # Paginado también aquí: hoy hay bastantes menos de 1.000 juegos, pero al pasar de esa cifra
    # un select sin paginar empezaría a "olvidar" canciones ya jugadas y a repetirlas.
    rows = fetch_all(
        lambda: supabase.table("ecos_games").select(
            "song_id, ecos_songs(title, artist_name, preview_url)", count="exact"
        )
    )
    used = UsedSongs()
    for r in rows:
        song = dict(r.get("ecos_songs") or {})
        song["id"] = r.get("song_id")
        used.add(song)
    return used


def load_nearby_games(supabase: Any, pending_dates: list[str]) -> list[dict]:
    """Juegos a ROTATION_DAYS días o menos de las fechas pendientes, para las reglas 2-5.

    Se leen una sola vez para todas las fechas: lo que se cree en esta ejecución se añade a la
    lista en memoria, así que la segunda fecha ya ve la primera (y la simulación también).
    """
    since = (date.fromisoformat(pending_dates[0]) - timedelta(days=ROTATION_DAYS)).isoformat()
    until = (date.fromisoformat(pending_dates[-1]) + timedelta(days=ROTATION_DAYS)).isoformat()
    r = (
        supabase.table("ecos_games")
        .select(f"date, ecos_songs({NEARBY_SONG_COLUMNS})")
        .gte("date", since)
        .lte("date", until)
        .execute()
    )
    return r.data or []


def next_game_number(supabase: Any) -> int:
    """max(game_number) + 1. No vale count(*) + 1: un borrado o un insert a mano lo descuadra."""
    r = (
        supabase.table("ecos_games")
        .select("game_number")
        .order("game_number", desc=True)
        .limit(1)
        .execute()
    )
    rows = r.data or []
    return (int(rows[0]["game_number"]) if rows else 0) + 1


def _unique_violation(exc: Exception) -> str | None:
    """Qué restricción única de ecos_games ha saltado ('date' o 'game_number'), si es eso."""
    text = str(exc)
    if getattr(exc, "code", None) != "23505" and "23505" not in text:
        return None
    if "ecos_games_date_key" in text:
        return "date"
    if "ecos_games_game_number_key" in text:
        return "game_number"
    return None


def insert_game(supabase: Any, song_id: str, target_date: str, log: logging.Logger) -> int | None:
    """Inserta el juego y devuelve su número, o None si otra ejecución ya creó esa fecha."""
    for attempt in range(1, INSERT_ATTEMPTS + 1):
        number = next_game_number(supabase)
        try:
            supabase.table("ecos_games").insert(
                {"song_id": song_id, "date": target_date, "game_number": number}
            ).execute()
            return number
        except Exception as exc:
            which = _unique_violation(exc)
            if which == "date":
                return None
            if which == "game_number" and attempt < INSERT_ATTEMPTS:
                log.warning("game_number %d ocupado, se reintenta (%d/%d)", number, attempt, INSERT_ATTEMPTS)
                continue
            raise
    raise RuntimeError("inalcanzable")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Crea los juegos de hoy y de los próximos días.")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="simulación: lee la base de datos, elige y lo cuenta, pero no escribe nada",
    )
    p.add_argument(
        "--hoy",
        metavar="AAAA-MM-DD",
        help="(solo con --dry-run) simula que hoy en Madrid es esta fecha",
    )
    p.add_argument("--seed", type=int, help="semilla del sorteo (para repetir una simulación)")
    args = p.parse_args()
    if args.hoy and not args.dry_run:
        p.error("--hoy solo se admite con --dry-run")
    return args


def main() -> None:
    args = parse_args()
    load_env()
    log = setup_logging("daily-game")
    start_ms = now_ms()
    dry_run: bool = args.dry_run
    supabase = get_supabase(log, read_only=dry_run)
    rng = random.Random(args.seed)

    now_madrid = datetime.now(MADRID)
    today = date.fromisoformat(args.hoy) if args.hoy else now_madrid.date()
    if dry_run:
        log.info("SIMULACIÓN: no se escribe nada en la base de datos (hoy = %s)", today.isoformat())

    def record(status: str, summary: str, details: dict, errors: list[str] | None = None) -> None:
        if dry_run:
            log.info("[simulación] registro %s: %s %s", status, summary, details)
            return
        log_job(
            supabase, JOB_DAILY_GAME, status, summary,
            start_ms=start_ms, details=details, errors=errors, log=log,
        )

    pending_dates = get_pending_game_dates(supabase, today)
    if not pending_dates:
        log.info("Ya existen juegos para hoy y los %d días siguientes en Madrid, nada que hacer", DAYS_AHEAD)
        record(
            "success",
            f"Juegos ya existían para hoy y los {DAYS_AHEAD} días siguientes",
            {"skipped": True, "madrid_now": now_madrid.isoformat()},
        )
        return
    log.info("Fechas pendientes: %s", ", ".join(pending_dates))

    pool = load_eligible_pool(supabase, log)
    if not pool:
        msg = (
            f"Pool elegible vacío: ninguna canción cumple preview ≥ {MIN_PREVIEW_SECONDS:g}s, "
            "playlist activa y preview_url"
        )
        log.error(msg)
        record("failure", msg, {"pending_dates": pending_dates}, [msg])
        sys.exit(1)

    used = load_used_songs(supabase)
    nearby_games = load_nearby_games(supabase, pending_dates)

    created: list[str] = []
    failed: list[str] = []
    for target_date in pending_dates:
        pick = pick_song(pool, used, nearby_games, target_date, rng)
        song = pick.song
        if pick.error or not song:
            msg = f"{target_date}: {pick.error}"
            log.error("No se pudo seleccionar para %s", msg)
            record("failure", msg, {"target_date": format_date_ddmmyyyy(target_date)}, [msg])
            failed.append(target_date)
            continue

        details = {
            "target_date": format_date_ddmmyyyy(target_date),
            "song_id": str(song["id"]),
            "title": song.get("title"),
            "artist": song.get("artist_name"),
            "playlist": song.get("spotify_playlist_name") or None,
            "playlist_id": song.get("spotify_playlist_id") or None,
            "rule": pick.rule,
            "pool_size": pick.pool_size,
            "candidates": pick.candidates,
        }

        if dry_run:
            number: int | None = next_game_number(supabase) + len(created)
        else:
            try:
                number = insert_game(supabase, song["id"], target_date, log)
            except Exception as exc:
                msg = f"insert {target_date}: {exc}"
                log.error("No se pudo insertar el juego: %s", msg)
                record("failure", msg, {**details, "error": str(exc)}, [msg])
                failed.append(target_date)
                continue
            if number is None:
                # Otra ejecución creó esa fecha entre la lectura y el insert: está cubierta.
                log.warning("El juego de %s ya lo creó otra ejecución", target_date)
                continue

        log.info(
            "Ecos #%d para %s: %s / %s (regla %s, %d candidatos de %d disponibles)",
            number, target_date, (song.get("title") or "")[:40], (song.get("artist_name") or "")[:30],
            pick.rule, pick.candidates, pick.pool_size,
        )

        # Estado local para que la siguiente fecha no repita canción y aplique las reglas 2-5
        # con este juego ya contado.
        used.add(song)
        nearby_games.append({"date": target_date, "ecos_songs": song})

        # El sorteo de reserva (regla 6) significa que las reglas no dejaron candidatos: se
        # registra como parcial para que destaque en el panel.
        status = "partial" if pick.rule == "6-fallback" else "success"
        record(
            status,
            f"1 juego creado para {format_date_ddmmyyyy(target_date)}",
            {**details, "game_number": number},
        )
        created.append(target_date)

    if failed:
        log.error("Fechas sin juego: %s (creadas: %s)", ", ".join(failed), ", ".join(created) or "ninguna")
        sys.exit(1)


if __name__ == "__main__":
    main()
