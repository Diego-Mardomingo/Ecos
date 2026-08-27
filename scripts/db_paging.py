"""
Lectura paginada de Supabase.

La API REST corta cualquier select en 1.000 filas y no avisa: devuelve 206 con
`Content-Range: 0-999/N` y `.execute()` entrega un lote parcial que parece completo. Eso dejó
ciego al filtro de duplicados de la ingesta (insertó 9 canciones repetidas entre abril y agosto
de 2026) y recortó el pool del juego diario a 1.000 de 1.638 canciones. Cualquier select sobre
una tabla que pueda pasar de 1.000 filas tiene que venir por aquí.

Usado por ingest-weekly, select-daily-game y backfill-games.
Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

from typing import Any, Callable

PAGE_SIZE = 1000


def fetch_all(
    build_query: Callable[[], Any],
    *,
    order_by: str = "id",
    page_size: int = PAGE_SIZE,
) -> list[dict]:
    """
    Devuelve TODAS las filas del select, paginando con `.range()`.

    `build_query` es una lambda que construye el select desde cero en cada página (sin
    `.limit()`, sin `.range()` y sin `.order()`); se llama una vez por página en lugar de
    reutilizar el mismo builder, que en supabase-py es mutable.

    `order_by` tiene que ser una columna única —por defecto `id`— y no es opcional de facto:
    paginar sobre un orden no determinista puede repetir filas de una página y saltarse otras,
    porque Postgres no garantiza el orden entre dos consultas distintas.

    Si el select pide `count="exact"`, al terminar se comprueba que el número de filas cuadra
    con el total y si no se levanta RuntimeError. Un catálogo parcial es exactamente el fallo
    que este módulo viene a evitar, así que vale más romper que seguir en silencio.
    """
    rows: list[dict] = []
    total: int | None = None
    offset = 0

    while True:
        res = (
            build_query()
            .order(order_by)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = res.data or []
        if total is None:
            total = getattr(res, "count", None)
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if total is not None and len(rows) != total:
        raise RuntimeError(
            f"Lectura paginada incompleta: {len(rows)} filas de {total} en total. "
            "Abortando: seguir con un catálogo parcial genera duplicados."
        )

    return rows
