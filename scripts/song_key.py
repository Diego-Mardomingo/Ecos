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

Usado por ingest-weekly, select-daily-game y backfill-games.
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


def _normalize(s: str | None) -> str:
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
    t = _normalize(title)
    a = _normalize(artist)
    if not t and not a:
        return None
    return f"{t}{SEPARATOR}{a}"
