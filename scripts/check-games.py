#!/usr/bin/env python3
"""
Comprobación de juegos: avisa (con un run rojo, que GitHub manda por email) si falta el juego de
hoy o de mañana en Madrid, o si su preview no responde.

La lanza check-games.yml cada pocas horas. Como mira hasta pasado mañana, que el cron llegue con
horas de retraso no importa: el hueco se ve con más de un día de margen.

Niveles:
- error (sale con 1): falta el juego de hoy o de mañana, o su preview no responde.
- aviso (anotación en el run, sale con 0): falta el de pasado mañana, el preview de pasado
  mañana no responde, hay filas failure/partial en ecos_system_logs en las últimas 24 h, o las
  notificaciones diarias llevan más de 36 h sin registrar ejecución.

Registra su resultado en ecos_system_logs (job_type games_check) cuando cambia respecto a la
última fila, y si no cambia, una vez al día de Madrid, para no llenar el panel.

Uso:
  python scripts/check-games.py            # comprobación completa
  python scripts/check-games.py --previa   # solo cobertura, sin registro y siempre sale con 0
  python scripts/check-games.py --dry-run  # completa, pero sin escribir el registro

Con --previa escribe `missing_dates=<fechas>` en $GITHUB_OUTPUT: el workflow lo usa para
lanzar el selector y repetir la comprobación completa después.

No escribe nunca título ni artista en la salida: los logs de Actions de un repo público los
puede leer cualquiera.

Requiere: pip install -r scripts/requirements-selector.txt
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta

from common import (
    JOB_DAILY_NOTIFICATIONS,
    JOB_GAMES_CHECK,
    MADRID,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    setup_logging,
)
from selection import DAYS_AHEAD

# Las notificaciones salen una vez al día y su cron llega con hasta ~6 h de retraso.
NOTIFICATIONS_MAX_AGE_H = 36
RECENT_PROBLEMS_H = 24
PREVIEW_TIMEOUT_S = 15


def preview_alive(url: str) -> tuple[bool, str]:
    """HEAD al preview de Spotify. Devuelve (vivo, detalle)."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ecos-check-games"})
    try:
        with urllib.request.urlopen(req, timeout=PREVIEW_TIMEOUT_S) as resp:
            ctype = resp.headers.get("Content-Type", "")
            if resp.status == 200 and "audio" in ctype:
                return True, f"{resp.status} {ctype}"
            return False, f"{resp.status} {ctype or 'sin Content-Type'}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except Exception as exc:  # timeout, DNS, TLS...
        return False, f"{type(exc).__name__}: {exc}"


def write_github_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def main() -> None:
    p = argparse.ArgumentParser(description="Comprueba que existen los juegos de los próximos días.")
    p.add_argument(
        "--previa",
        action="store_true",
        help="solo cobertura: sin HEAD a los previews, sin registro y sin fallar",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="comprobación completa, pero sin escribir el registro en la base de datos",
    )
    args = p.parse_args()

    load_env()
    log = setup_logging("check-games")
    start_ms = now_ms()
    supabase = get_supabase(log, read_only=args.previa or args.dry_run)

    now_madrid = datetime.now(MADRID)
    today = now_madrid.date()
    dates = [(today + timedelta(days=i)).isoformat() for i in range(DAYS_AHEAD + 1)]
    # Hoy y mañana son críticos; a partir de ahí todavía hay margen para que el cron lo arregle.
    critical = set(dates[:2])

    r = (
        supabase.table("ecos_games")
        .select("date, game_number, song_id, ecos_songs(preview_url, is_active)")
        .in_("date", dates)
        .execute()
    )
    games = {g["date"]: g for g in (r.data or [])}
    missing = [d for d in dates if d not in games]

    errors: list[str] = []
    warnings: list[str] = []
    for d in missing:
        (errors if d in critical else warnings).append(f"Falta el juego del {d}")

    if args.previa:
        write_github_output("missing_dates", ",".join(missing))
        for msg in errors + warnings:
            log.warning(msg)
        log.info("Fechas comprobadas: %s; faltan: %s", ", ".join(dates), ", ".join(missing) or "ninguna")
        return

    previews: dict[str, str] = {}
    for d in dates:
        g = games.get(d)
        if not g:
            continue
        song = g.get("ecos_songs") or {}
        bucket = errors if d in critical else warnings
        url = song.get("preview_url")
        if not url:
            bucket.append(f"El juego del {d} (#{g.get('game_number')}) no tiene preview_url")
            continue
        if song.get("is_active") is False:
            warnings.append(f"La canción del juego del {d} (#{g.get('game_number')}) está desactivada")
        ok, detail = preview_alive(url)
        previews[d] = detail
        if not ok:
            bucket.append(f"El preview del juego del {d} (#{g.get('game_number')}) no responde: {detail}")

    # Problemas registrados por los otros jobs en las últimas horas: no hacen fallar este run
    # (los propios scripts ya salen con 1 cuando fallan), pero quedan a la vista en el resumen.
    since = (datetime.now(MADRID) - timedelta(hours=RECENT_PROBLEMS_H)).isoformat()
    r_bad = (
        supabase.table("ecos_system_logs")
        .select("job_type, status, summary, ran_at")
        .in_("status", ["failure", "partial"])
        .neq("job_type", JOB_GAMES_CHECK)
        .gte("ran_at", since)
        .order("ran_at", desc=True)
        .limit(10)
        .execute()
    )
    for row in r_bad.data or []:
        warnings.append(
            f"{row['job_type']} registró {row['status']} el {row['ran_at'][:16]}: "
            f"{(row.get('summary') or '')[:120]}"
        )

    r_notif = (
        supabase.table("ecos_system_logs")
        .select("ran_at")
        .eq("job_type", JOB_DAILY_NOTIFICATIONS)
        .order("ran_at", desc=True)
        .limit(1)
        .execute()
    )
    last_notif = r_notif.data[0].get("ran_at") if r_notif.data else None
    if not last_notif:
        warnings.append("Las notificaciones diarias no tienen ninguna ejecución registrada")
    else:
        age_h = (datetime.now(MADRID) - datetime.fromisoformat(last_notif)).total_seconds() / 3600
        if age_h > NOTIFICATIONS_MAX_AGE_H:
            warnings.append(f"Las notificaciones diarias no registran ejecución desde hace {age_h:.0f} h")

    for msg in errors:
        log.error(msg)
        gh_annotation("error", msg)
    for msg in warnings:
        log.warning(msg)
        gh_annotation("warning", msg)

    status = "failure" if errors else ("partial" if warnings else "success")
    present = [d for d in dates if d in games]
    summary = (
        f"Juegos de {len(present)}/{len(dates)} días"
        + (f"; faltan {', '.join(missing)}" if missing else "")
        + (f"; {len(errors)} errores" if errors else "")
        + (f"; {len(warnings)} avisos" if warnings else "")
    )
    log.info("%s", summary)

    # Una fila por cambio de estado y, si nada cambia, una al día como latido: el job corre cada
    # pocas horas y con una fila por ejecución taparía a los demás en el panel.
    r_last = (
        supabase.table("ecos_system_logs")
        .select("status, summary, ran_at")
        .eq("job_type", JOB_GAMES_CHECK)
        .order("ran_at", desc=True)
        .limit(1)
        .execute()
    )
    last = r_last.data[0] if r_last.data else None
    start_of_day = datetime.combine(today, time.min, tzinfo=MADRID)
    should_record = (
        last is None
        or last.get("status") != status
        or last.get("summary") != summary
        or datetime.fromisoformat(last["ran_at"]) < start_of_day
    )
    if should_record and args.dry_run:
        log.info("[simulación] se registraría %s: %s", status, summary)
    elif should_record:
        log_job(
            supabase, JOB_GAMES_CHECK, status, summary,
            start_ms=start_ms,
            details={
                "dates": dates,
                "missing": missing,
                "previews": previews,
                "warnings": warnings,
                "madrid_now": now_madrid.isoformat(),
            },
            errors=errors,
            log=log,
        )

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
