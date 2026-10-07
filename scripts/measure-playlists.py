#!/usr/bin/env python3
"""
Mide playlists candidatas ANTES de añadirlas a ecos_spotify_playlists. Solo lee: no escribe en la
base de datos ni en ningún sitio (usa el cliente de solo lectura).

Por cada playlist dice cuánto aportaría a la ingesta:
- % de pistas nuevas: las que no están ya en el catálogo (por spotify_id ni por título+artista).
- De las nuevas, cuántas tienen preview_url y cuántas lo tienen de al menos MIN_PREVIEW_SECONDS
  (el umbral de selection.py: solo esas entran en el juego).
- Aportación estimada: nuevas × (previews válidos / nuevas medidas).

Las playlists se miden en el orden dado y cada una cuenta como ya vista para las siguientes, así
que la tabla enseña la aportación marginal: una pista que está en dos candidatas solo cuenta en
la primera.

Spotify solo entrega las 100 primeras pistas de cada playlist; es lo que mediría la ingesta.

Uso:
  python scripts/measure-playlists.py 37i9dQZF1DX4UtSsGT1Sbe 37i9dQZF1DXbTxeAdrVG2l
  python scripts/measure-playlists.py --max-nuevas 100 ID...

Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

from common import get_supabase, load_env, setup_logging

try:
    from db_paging import fetch_all
    from preview_audio import PreviewFetchError, PreviewInvalidError, measure_mp3
    from selection import MIN_PREVIEW_SECONDS
    from song_key import dedupe_key
    from spotify_source import SpotifyError, SpotifySource, TrackUnavailableError
except ImportError as e:
    print(f"Error importando dependencias: {e}")
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)


@dataclass
class Result:
    playlist_id: str
    name: str = ""
    error: str | None = None
    tracks: int = 0
    known: int = 0
    new: int = 0
    measured: int = 0  # nuevas con preview_url medido
    no_url: int = 0
    short: int = 0
    valid: int = 0
    read_failed: int = 0
    unavailable: int = 0  # pistas retiradas de Spotify
    measure_failed: int = 0
    sampled: int = 0  # nuevas que se han mirado (puede ser menos que `new` con --max-nuevas)

    @property
    def pct_new(self) -> float:
        return 100 * self.new / self.tracks if self.tracks else 0.0

    @property
    def pct_valid(self) -> float:
        """% de previews de >= umbral entre las nuevas que se leyeron sin fallo."""
        looked = self.no_url + self.measured
        return 100 * self.valid / looked if looked else 0.0

    @property
    def estimate(self) -> float:
        """Canciones nuevas utilizables que aportaría, extrapolando la muestra a todas las nuevas."""
        looked = self.no_url + self.measured
        return self.new * self.valid / looked if looked else 0.0


def measure_playlist(source: SpotifySource, pid: str, ids: set[str], keys: set[str], max_new: int) -> Result:
    res = Result(playlist_id=pid)
    try:
        playlist = source.playlist(pid)
    except SpotifyError as exc:
        res.error = str(exc)
        return res
    res.name = playlist.name
    res.tracks = len(playlist.tracks)
    if not playlist.tracks:
        res.error = "0 pistas"
        return res

    new_stubs = []
    for stub in playlist.tracks:
        key = dedupe_key(stub.title, stub.artist)
        if (stub.spotify_id and stub.spotify_id in ids) or (key and key in keys):
            res.known += 1
        else:
            new_stubs.append((stub, key))
            # Cuenta como vista para las siguientes candidatas.
            if stub.spotify_id:
                ids.add(stub.spotify_id)
            if key:
                keys.add(key)
    res.new = len(new_stubs)

    for stub, _key in new_stubs[:max_new]:
        if not stub.spotify_id:
            continue
        res.sampled += 1
        try:
            info = source.track_info(stub.spotify_id)
        except TrackUnavailableError:
            res.unavailable += 1
            continue
        except SpotifyError:
            res.read_failed += 1
            continue
        if not info.preview_url:
            res.no_url += 1
            continue
        try:
            seconds = measure_mp3(info.preview_url)
        except (PreviewFetchError, PreviewInvalidError):
            res.measure_failed += 1
            continue
        res.measured += 1
        if seconds >= MIN_PREVIEW_SECONDS:
            res.valid += 1
        else:
            res.short += 1
    return res


def main() -> None:
    p = argparse.ArgumentParser(description="Mide playlists candidatas (solo lectura).")
    p.add_argument("playlists", nargs="+", metavar="ID", help="ids de playlist de Spotify")
    p.add_argument(
        "--max-nuevas",
        type=int,
        default=60,
        help="máximo de pistas nuevas que se leen y miden por playlist (por defecto 60)",
    )
    args = p.parse_args()

    load_env()
    log = setup_logging("measure-playlists")
    supabase = get_supabase(log, read_only=True)
    rows = fetch_all(
        lambda: supabase.table("ecos_songs").select("spotify_id, title, artist_name", count="exact")
    )
    ids = {r["spotify_id"] for r in rows if r.get("spotify_id")}
    keys = {k for k in (dedupe_key(r.get("title"), r.get("artist_name")) for r in rows) if k}
    log.info("Catálogo: %d canciones. Umbral de preview: %g s", len(rows), MIN_PREVIEW_SECONDS)

    results: list[Result] = []
    with SpotifySource() as source:
        for pid in dict.fromkeys(args.playlists):
            res = measure_playlist(source, pid, ids, keys, args.max_nuevas)
            results.append(res)
            if res.error:
                log.warning("%s: no se pudo medir: %s", pid, res.error)
            else:
                log.info(
                    "%s %s: %d pistas, %d nuevas (%.0f %%), previews válidos %d de %d leídas -> ~%.0f utilizables",
                    pid, res.name, res.tracks, res.new, res.pct_new, res.valid, res.no_url + res.measured,
                    res.estimate,
                )

    print()
    print("| Playlist | ID | Pistas | Nuevas | % nuevas | Sin URL | Cortos | >= umbral | % válidos | Utilizables (est.) | Fallos |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(results, key=lambda r: r.estimate, reverse=True):
        if r.error:
            print(f"| (error) | {r.playlist_id} | - | - | - | - | - | - | - | - | {r.error} |")
            continue
        print(
            f"| {r.name} | {r.playlist_id} | {r.tracks} | {r.new} | {r.pct_new:.0f} % | {r.no_url} | "
            f"{r.short} | {r.valid} | {r.pct_valid:.0f} % | {r.estimate:.0f} | {r.read_failed + r.measure_failed} |"
        )


if __name__ == "__main__":
    main()
