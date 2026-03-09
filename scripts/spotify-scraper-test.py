#!/usr/bin/env python3
"""
Prueba de SpotifyScraper con playlists de scripts/config/playlists.ts.
3 canciones por playlist. Solo muestra campos para ingesta.
Ejecutar: python scripts/spotify-scraper-test.py
Requiere: pip install spotifyscraper
"""
import re
import sys

try:
    from spotify_scraper import SpotifyClient
    from spotify_scraper.parsers.json_parser import extract_track_data_from_page
except ImportError:
    print("Instala spotifyscraper: pip install spotifyscraper")
    sys.exit(1)

# Playlists de scripts/config/playlists.ts (id, nombre)
PLAYLISTS = [
    ("37i9dQZEVXbNFJfN1Vw8d9", "Top 50 Spain"),
    ("37i9dQZF1DXaxEKcoCdWHD", "Exitos Espana"),
    ("37i9dQZF1DWVskFRGurTfg", "Hits Urbanos"),
    ("37i9dQZF1DXcd2Vmhfon1w", "Rap Espanol"),
    ("37i9dQZF1DWV7FWPDK0Dg1", "Flamenco Pop"),
    ("37i9dQZF1DWZMtkg0cMXbp", "Flamenco Flow"),
    ("37i9dQZF1DX8SfyqmSFDwe", "Old School Reggaeton"),
    ("37i9dQZF1DX09mi3a4Zmox", "Baladas Romanticas"),
    ("37i9dQZF1DXdnGF35OawbN", "Verano Forever"),
    ("37i9dQZF1DX20VDU4OIBfS", "Canciones del Recuerdo"),
    ("37i9dQZF1DX7alvT6zKWrM", "Los 2010 Espana"),
    ("37i9dQZF1DXb0AsvHMF4aM", "Los 2000s Espana"),
    ("37i9dQZF1DWXm9R2iowygp", "Los 90 Espana"),
    ("37i9dQZF1DWU4xtX4v6Z9l", "Los 80 Espana"),
    ("5xeQJDbA4L6LNyVeFz3MHF", "Playlist Personal"),
]
MAX_TRACKS_PER_PLAYLIST = 3

# Patrones para extraer album ID (la URL regular del track incluye enlaces al álbum)
_ALBUM_ID_PATTERNS = [
    r'open\.spotify\.com/album/([a-zA-Z0-9]{20,25})',
    r'spotify:album:([a-zA-Z0-9]{20,25})',
]


def extract_album_id_from_html(html: str) -> str | None:
    """Busca el album ID en el HTML de la página del track."""
    if not html:
        return None
    for pat in _ALBUM_ID_PATTERNS:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


def get_spotify_id(track: dict) -> str:
    """Extrae el Spotify ID del track (id o uri)."""
    track_id = track.get("id")
    if track_id:
        return track_id
    uri = track.get("uri", "")
    if uri and ":" in uri:
        return uri.split(":")[-1]
    return ""


def enrich_track_with_full_info(client: SpotifyClient, track: dict) -> dict:
    """
    Enriquece un track: obtiene datos completos (get_track_info) y si album.name
    está vacío, intenta extraer el album ID del HTML y llamar get_album_info.
    """
    spotify_id = get_spotify_id(track)
    if not spotify_id:
        return track

    embed_url = f"https://open.spotify.com/embed/track/{spotify_id}"
    try:
        html = client.browser.get_page_content(embed_url)
        full = extract_track_data_from_page(html)
        full["spotify_id"] = full.get("id") or spotify_id
        if "added_at" in track:
            full["added_at"] = track["added_at"]

        # Si album.name vacío, buscar album ID en la página regular (la embed no lo incluye)
        album = full.get("album") or {}
        if not album.get("name"):
            regular_html = client.browser.get_page_content(
                f"https://open.spotify.com/track/{spotify_id}"
            )
            album_id = extract_album_id_from_html(regular_html)
            if album_id:
                try:
                    album_info = client.get_album_info(f"https://open.spotify.com/album/{album_id}")
                    if album_info.get("name"):
                        if "album" not in full:
                            full["album"] = {}
                        full["album"]["name"] = album_info["name"]
                except Exception:
                    pass  # album name seguirá vacío

        return full
    except Exception as e:
        # Fallback a get_track_info si extract_track_data falla
        try:
            full = client.get_track_info(f"https://open.spotify.com/track/{spotify_id}")
            full["spotify_id"] = full.get("id") or spotify_id
            if "added_at" in track:
                full["added_at"] = track["added_at"]
            return full
        except Exception:
            print(f"    [Advertencia: falló para {spotify_id}: {e}]")
            track["spotify_id"] = spotify_id
            return track


def format_ingesta_fields(t: dict, pl_id: str = "", pl_name: str = "") -> str:
    """Formatea los campos para ingesta de un track (coinciden con ecos_songs)."""
    artists = t.get("artists", [])
    artist_names = ", ".join(a.get("name", "") for a in artists if a.get("name"))
    album = t.get("album") or {}
    images = album.get("images") or []
    cover_url = images[0].get("url") if images else None
    explicit = t.get("explicit") or t.get("is_explicit")
    release_date = album.get("release_date") or t.get("release_date")

    lines = [
        f"  spotify_id:   {t.get('spotify_id') or t.get('id')}",
        f"  title:       {t.get('name')}",
        f"  artist_name: {artist_names}",
        f"  album_title: {album.get('name') or ''}",
        f"  duration_ms: {t.get('duration_ms')}",
        f"  explicit:    {explicit}",
        f"  release_date:{release_date}",
        f"  preview_url: {t.get('preview_url')}",
        f"  cover_url:   {cover_url}",
    ]
    if pl_id:
        lines.append(f"  spotify_playlist_id:   {pl_id}")
    if pl_name:
        lines.append(f"  spotify_playlist_name: {pl_name}")
    if t.get("track_number") is not None:
        lines.append(f"  track_number:{t.get('track_number')}")
    if t.get("disc_number") is not None:
        lines.append(f"  disc_number: {t.get('disc_number')}")
    return "\n".join(lines)


def main():
    print("=== SpotifyScraper - 3 canciones por playlist (campos ingesta) ===\n")

    client = SpotifyClient()

    try:
        for pl_idx, (pl_id, pl_name) in enumerate(PLAYLISTS):
            url = f"https://open.spotify.com/playlist/{pl_id}"
            print(f"[{pl_idx+1}/{len(PLAYLISTS)}] {pl_name} ({pl_id})...", end=" ", flush=True)
            try:
                playlist = client.get_playlist_info(url)
                tracks = playlist.get("tracks", [])[:MAX_TRACKS_PER_PLAYLIST]
                print(f"OK - {len(tracks)} tracks")
            except Exception as e:
                print(f"ERROR: {e}")
                continue

            for i, track in enumerate(tracks):
                print(f"    Enriqueciendo {i+1}/{len(tracks)}: {track.get('name', '?')[:40]}...", end=" ", flush=True)
                full_track = enrich_track_with_full_info(client, track)
                full_track["spotify_id"] = get_spotify_id(full_track) or full_track.get("spotify_id", "")
                print("OK")

                # Solo campos para ingesta, con separación visual
                print("\n" + "-" * 60)
                print(f"  [{pl_name}] Track {i+1}: {full_track.get('name', 'N/A')}")
                print("-" * 60)
                print(format_ingesta_fields(full_track, pl_id, pl_name))
                print()

        print("=" * 60)
        print("OK - Prueba completada.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
