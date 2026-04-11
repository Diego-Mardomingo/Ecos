#!/usr/bin/env python3
"""
Rellena preview_duration_seconds en ecos_songs donde hay preview_url y la columna es NULL.
Descarga el MP3 y mide la duración (misma lógica que ingest-weekly).
Uso: python scripts/backfill-preview-duration.py [--dry-run] [--limit N]
Requiere: pip install -r scripts/requirements-ingest.txt
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

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
    from preview_audio import get_mp3_duration_seconds
except ImportError:
    print("Instala dependencias: pip install -r scripts/requirements-ingest.txt")
    sys.exit(1)

PAGE_SIZE = 150
DELAY_SEC = 0.35


def main() -> None:
    log = logging.getLogger("backfill-preview-duration")
    log.setLevel(logging.INFO)
    log.addHandler(logging.StreamHandler(sys.stdout))

    parser = argparse.ArgumentParser(description="Backfill preview_duration_seconds en ecos_songs")
    parser.add_argument("--dry-run", action="store_true", help="Solo listar cuántas filas, no actualizar")
    parser.add_argument("--limit", type=int, default=0, help="Máximo de filas a actualizar (0 = sin límite)")
    args = parser.parse_args()

    url_env = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url_env or not key_env:
        log.error("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos")
        sys.exit(1)

    supabase: Client = create_client(url_env, key_env)

    pending: list[dict] = []
    start = 0
    while True:
        res = (
            supabase.table("ecos_songs")
            .select("id, preview_url, preview_duration_seconds")
            .order("id")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        if not batch:
            break
        for row in batch:
            if row.get("preview_url") and row.get("preview_duration_seconds") is None:
                pending.append(row)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    log.info("Filas con preview_url y preview_duration_seconds NULL: %d", len(pending))

    if args.dry_run:
        return

    updated = 0
    failed = 0
    for row in pending:
        if args.limit and updated + failed >= args.limit:
            log.info("Límite %d alcanzado, fin.", args.limit)
            break
        pid = row["id"]
        url = row["preview_url"]
        dur = get_mp3_duration_seconds(url)
        if dur is None:
            log.warning("No se pudo medir id=%s", pid)
            failed += 1
        else:
            try:
                supabase.table("ecos_songs").update({"preview_duration_seconds": dur}).eq("id", pid).execute()
                updated += 1
                if updated % 25 == 0:
                    log.info("Actualizadas %d filas…", updated)
            except Exception as e:
                log.warning("Update error id=%s: %s", pid, e)
                failed += 1
        time.sleep(DELAY_SEC)

    log.info("Hecho: actualizadas=%d fallos_medición_o_update=%d", updated, failed)


if __name__ == "__main__":
    main()
