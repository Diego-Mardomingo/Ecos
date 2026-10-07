"""
Clave de duplicado de una canción (título + artista).

La fuente de verdad es `public.ecos_dedupe_key()` en Postgres: la columna `ecos_songs.dedupe_key`
la mantiene un trigger y un índice único parcial la impone sobre las canciones activas (ver
supabase/schema/01_tables.sql). Aquí se calcula una versión para que la ingesta descarte
duplicados ANTES de gastar una petición de enriquecimiento y una descarga de preview por
canción.

Las dos claves NO son idénticas y no hace falta que lo sean. Postgres usa `unaccent`, cuyo
diccionario pliega bastante más que los acentos: convierte '¿' en '?', '’' en "'", '—' en '-',
'ø' en 'o', 'ß' en 'ss'... Replicar esa tabla entera en Python sería copiar unos 300 casos y
mantenerlos sincronizados a mano.

En su lugar se garantiza la propiedad que de verdad importa: **esta clave es igual o más fina
que la de Postgres**. Solo pliega mayúsculas, marcas diacríticas (descomposición canónica NFD,
que es un subconjunto de lo que quita `unaccent`) y los espacios de sobra. Consecuencias:

- Nunca junta dos canciones que Postgres consideraría distintas, así que la ingesta no puede
  descartar una canción legítima por error.
- Como mucho se le escapa algún duplicado con puntuación exótica. Ese insert choca contra el
  índice único, devuelve 23505 y la ingesta ya lo cuenta como duplicado.

Usado por ingest-weekly, select-daily-game (vía selection.py) y backfill-games.

Además de `dedupe_key` hay dos claves más gruesas que solo usa el selector diario, nunca la
ingesta ni el índice único: `artist_names` (para no repetir artista) y `version_key` (para no
sacar dos versiones de la misma canción). Ver selection.py.
"""
from __future__ import annotations

import re
import unicodedata

# Separador entre título y artista. U+001F (unit separator) porque no aparece en un título y
# porque Postgres no admite el byte NUL dentro de un `text`.
SEPARATOR = "\x1f"

# Solo los espacios que colapsa Postgres con '\s+': el `\s` de Python también incluye espacios
# Unicode como U+00A0, que `unaccent` deja intactos. Plegarlos aquí haría esta clave MÁS gruesa
# que la de la base de datos, que es justo lo que no puede pasar.
_ESPACIOS = re.compile(r"[ \t\n\r\f\v]+")


def normalize(s: str | None) -> str:
    """Minúsculas, sin marcas diacríticas y con los espacios colapsados."""
    if not s:
        return ""
    descompuesto = unicodedata.normalize("NFD", s)
    sin_marcas = "".join(ch for ch in descompuesto if not unicodedata.combining(ch))
    return _ESPACIOS.sub(" ", sin_marcas).strip().lower()


def dedupe_key(title: str | None, artist: str | None) -> str | None:
    """
    Clave de duplicado, o None si no hay ni título ni artista.

    Ignora mayúsculas, acentos y espacios de sobra, así que "Enamorado De La Moda Juvenil" y
    "Enamorado de la moda juvenil" son la misma canción. Conserva la puntuación y los sufijos:
    "DROGA" y "DROGA - Remix" siguen siendo distintas, igual que "Perro Negro" y
    "Perro Negro (feat. Feid)".
    """
    t = normalize(title)
    a = normalize(artist)
    if not t and not a:
        return None
    return f"{t}{SEPARATOR}{a}"


def artist_names(artist: str | None) -> set[str]:
    """
    Artistas individuales de `artist_name`, normalizados.

    La ingesta guarda los artistas de Spotify unidos por ", " (`ingest-weekly.py`), así que se
    parte solo por comas: "Luny Tunes, Daddy Yankee, Wisin & Yandel" da tres artistas y comparte
    "wisin & yandel" con "Wisin & Yandel". No se parte por "&" ni por "y" porque forman parte del
    nombre de muchos dúos y grupos.
    """
    if not artist:
        return set()
    return {n for n in (normalize(part) for part in artist.split(",")) if n}


# Partes entre paréntesis o corchetes: "(feat. Beyoncé)", "(Featuring Daddy Yankee)", "[Live]"...
_ENTRE_PARENTESIS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
# Sufijo tras " - ": " - Remasterizado", " - Versión 2016", " - Spanish", " - Remix"...
_SUFIJO_GUION = re.compile(r"\s+-\s+.*$")


def version_key(title: str | None, artist: str | None) -> str | None:
    """
    Clave de "la misma canción en otra versión": título sin lo que va entre paréntesis ni tras
    " - ", más el primer artista. "Despacito" y "Despacito (Featuring Daddy Yankee)" de Luis Fonsi
    comparten clave; "Hey" y "Hey - Spanish" de Julio Iglesias, también.

    Es mucho más gruesa que `dedupe_key` a propósito, y por eso solo sirve para descartar
    candidatos en el selector: si junta de más, el coste es una canción menos en el sorteo. Nunca
    debe usarse para no insertar en la ingesta ni en el índice único.

    Devuelve None si no hay título.
    """
    if not title:
        return None
    base = _SUFIJO_GUION.sub("", _ENTRE_PARENTESIS.sub("", title))
    t = normalize(base) or normalize(title)
    if not t:
        return None
    first_artist = normalize((artist or "").split(",")[0])
    return f"{t}{SEPARATOR}{first_artist}"
