#!/usr/bin/env python3
"""
Notificacion diaria de Web Push: avisa a los usuarios que aun NO han completado el reto del dia.

"Completado" = existe fila en `ecos_scores` para (user_id, game_id de hoy). Los usuarios
in-progress (sin score aun) SI reciben la notificacion.

Cuándo corre: el cron de send-daily-notifications.yml es `23 11 * * *` UTC (12:23 en invierno,
13:23 en verano, hora de Madrid), pero los crons de GitHub Actions se retrasan entre 2 y 7 h
(medido: mediana +2 h, p90 +4,8 h, máximo +6,8 h). Con esa hora la notificación llega, en la
práctica, entre las ~14:00 y las ~20:00 de Madrid. El texto dice «estás a tiempo», así que una
notificación a las 23:47 (que fue lo que pasaba con el cron de las 15:00 UTC) es peor que ninguna:
el script no envía fuera de la ventana [WINDOW_START, WINDOW_END) de Madrid, y lo deja
registrado como `partial` para que se vea. El TTL llega hasta medianoche de Madrid como mucho:
una notificación retenida por un móvil apagado no se entrega ya con el juego cambiado.

Uso:
  python scripts/send-daily-notifications.py                   # envío real (con ventana horaria)
  python scripts/send-daily-notifications.py --sin-ventana     # envía a cualquier hora
                                                               # (lo usa el lanzamiento manual)
  python scripts/send-daily-notifications.py --dry-run         # no envía ni escribe nada
  python scripts/send-daily-notifications.py --dry-run --ahora 2026-10-07T23:47

Requiere: pip install -r scripts/requirements-notifications.txt
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, time, timedelta, timezone
from typing import Any

from common import (
    JOB_DAILY_NOTIFICATIONS,
    MADRID,
    get_supabase,
    gh_annotation,
    load_env,
    log_job,
    now_ms,
    require_env,
    setup_logging,
)
from db_paging import fetch_all

# El emoji va en título; el campo `icon` del sistema sigue siendo una URL (ver service worker).
NOTIFICATION_TITLE = "\U0001f3a7 Tu reto ECOS de hoy"  # 🎧
NOTIFICATION_BODY = (
    "Aún no has completado la canción del día de hoy, ¡estás a tiempo! \U0001f644"
)  # 🙄
NOTIFICATION_URL = "/play"
NOTIFICATION_TAG = "ecos-daily-game"

# Ventana de envío, hora de Madrid. Fuera de ella no se manda (ver el docstring).
WINDOW_START = time(12, 0)
WINDOW_END = time(21, 0)
# Tiempo máximo que el servicio push retiene el aviso si el dispositivo no está disponible.
MAX_TTL_S = 12 * 60 * 60
MIN_TTL_S = 60


def seconds_until_midnight_madrid(now: datetime) -> int:
    """
    Segundos hasta la próxima medianoche de Madrid. Se resta en UTC: restar dos datetimes con la
    misma zona horaria ignora el cambio de horario y se equivoca una hora los dos días del año
    en que cambia.
    """
    midnight = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=MADRID)
    return int((midnight.astimezone(timezone.utc) - now.astimezone(timezone.utc)).total_seconds())


def ttl_seconds(now: datetime) -> int:
    return max(MIN_TTL_S, min(MAX_TTL_S, seconds_until_midnight_madrid(now)))


def in_window(now: datetime) -> bool:
    return WINDOW_START <= now.timetz().replace(tzinfo=None) < WINDOW_END


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Envía el aviso diario a quien aún no ha jugado hoy.")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="simulación: lee la base de datos y cuenta, pero no envía nada ni escribe nada",
    )
    p.add_argument(
        "--sin-ventana",
        action="store_true",
        help=f"enviar aunque no sea entre las {WINDOW_START:%H:%M} y las {WINDOW_END:%H:%M} de Madrid",
    )
    p.add_argument(
        "--ahora",
        metavar="AAAA-MM-DDTHH:MM",
        help="(solo con --dry-run) simula que ahora es esta hora de Madrid",
    )
    args = p.parse_args()
    if args.ahora and not args.dry_run:
        p.error("--ahora solo se admite con --dry-run")
    return args


def main() -> None:
    args = parse_args()
    load_env()
    log = setup_logging("daily-notifications")
    start_ms = now_ms()
    dry_run: bool = args.dry_run

    now_madrid = (
        datetime.fromisoformat(args.ahora).replace(tzinfo=MADRID) if args.ahora else datetime.now(MADRID)
    )
    log.info("Ejecutando a las %s hora Madrid", now_madrid.strftime("%H:%M"))
    if dry_run:
        log.info("SIMULACIÓN: no se envía ni se escribe nada")

    vapid_private = vapid_subject = ""
    if not dry_run:
        env = require_env(log, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
        vapid_private, vapid_subject = env["VAPID_PRIVATE_KEY"], env["VAPID_SUBJECT"]
        try:
            from pywebpush import WebPushException, webpush
        except ImportError:
            log.error("Falta pywebpush: pip install -r scripts/requirements-notifications.txt")
            sys.exit(1)
    supabase = get_supabase(log, read_only=dry_run)
    today = now_madrid.date().isoformat()

    def record(status: str, summary: str, details: dict[str, Any], errors: list[str] | None = None) -> None:
        if dry_run:
            log.info("[simulación] registro %s: %s %s", status, summary, details)
            return
        # Si el registro falla, log_job ya lo ha dicho en el log y como anotación. El run se pone
        # en rojo igualmente: los avisos ya se enviaron, así que no hay que relanzarlo.
        if not log_job(
            supabase, JOB_DAILY_NOTIFICATIONS, status, summary,
            start_ms=start_ms, details=details, errors=errors, log=log,
        ):
            log.error("La ejecución terminó, pero no quedó registrada. No relanzar: ya se ha enviado.")
            sys.exit(1)

    if not args.sin_ventana and not in_window(now_madrid):
        msg = (
            f"Omitida: son las {now_madrid:%H:%M} en Madrid, fuera de la ventana "
            f"{WINDOW_START:%H:%M}-{WINDOW_END:%H:%M} (casi siempre, un cron de Actions con retraso)"
        )
        log.warning(msg)
        gh_annotation("warning", msg)
        record("partial", msg, {"target_date": today, "skipped": "outside_window", "madrid_time": f"{now_madrid:%H:%M}"})
        return

    r_game = supabase.table("ecos_games").select("id").eq("date", today).limit(1).execute()
    games = r_game.data or []
    if not games:
        msg = f"No hay juego para {today}, no se envia nada"
        log.warning(msg)
        gh_annotation("warning", msg)
        record("partial", msg, {"target_date": today, "skipped": "no_game"})
        return
    game_id = games[0]["id"]

    completed_rows = fetch_all(
        lambda: supabase.table("ecos_scores").select("user_id", count="exact").eq("game_id", game_id)
    )
    completed_user_ids = {row["user_id"] for row in completed_rows}
    log.info("Usuarios que ya completaron hoy: %d", len(completed_user_ids))

    all_subs = fetch_all(
        lambda: supabase.table("ecos_push_subscriptions")
        .select("id, user_id, subscription, endpoint", count="exact")
        .eq("enabled", True)
        .eq("notification_daily_game", True)
    )
    pending_subs = [s for s in all_subs if s["user_id"] not in completed_user_ids]
    log.info(
        "Suscripciones totales activas: %d, pendientes de jugar: %d", len(all_subs), len(pending_subs)
    )

    if not pending_subs:
        record(
            "success",
            f"Sin destinatarios para {today}",
            {"target_date": today, "total_subscriptions": len(all_subs)},
        )
        return

    ttl = ttl_seconds(now_madrid)
    log.info("TTL de los avisos: %d min (hasta medianoche de Madrid como mucho)", ttl // 60)

    if dry_run:
        log.info("[simulación] se enviarían %d notificaciones", len(pending_subs))
        record(
            "success",
            f"Simulación {today}: {len(pending_subs)} destinatarios",
            {"target_date": today, "pending": len(pending_subs), "ttl_seconds": ttl},
        )
        return

    payload = json.dumps(
        {
            "title": NOTIFICATION_TITLE,
            "body": NOTIFICATION_BODY,
            "url": NOTIFICATION_URL,
            "tag": NOTIFICATION_TAG,
        }
    )

    sent = 0
    expired = 0
    errors: list[str] = []
    expired_ids: list[str] = []

    for sub_row in pending_subs:
        subscription_info = sub_row.get("subscription")
        if not isinstance(subscription_info, dict):
            errors.append(f"Suscripcion mal formada para id={sub_row.get('id')}")
            continue
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=vapid_private,
                vapid_claims={"sub": vapid_subject},
                ttl=ttl,
                timeout=10,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None) if exc.response is not None else None
            if status in (404, 410):
                expired += 1
                expired_ids.append(sub_row["id"])
            else:
                errors.append(f"sub_id={sub_row.get('id')} status={status} err={exc}")
        except Exception as exc:
            errors.append(f"sub_id={sub_row.get('id')} err={exc}")

    if expired_ids:
        try:
            supabase.table("ecos_push_subscriptions").update({"enabled": False}).in_(
                "id", expired_ids
            ).execute()
        except Exception as exc:
            errors.append(f"No se pudo desactivar expired_ids: {exc}")

    summary = (
        f"Daily notifications {today}: enviadas={sent} expiradas={expired} "
        f"errores={len(errors)} totales={len(pending_subs)}"
    )
    log.info(summary)
    if errors:
        gh_annotation("warning", f"{len(errors)} errores al enviar notificaciones (detalle en ecos_system_logs)")

    record(
        "success" if not errors else "partial",
        summary,
        {
            "target_date": today,
            "game_id": game_id,
            "sent": sent,
            "expired": expired,
            "total_subscriptions": len(all_subs),
            "pending": len(pending_subs),
            "completed": len(completed_user_ids),
            "ttl_seconds": ttl,
            "madrid_time": f"{now_madrid:%H:%M}",
        },
        errors,
    )

    # Si había destinatarios y NO se envió ni una sola notificación (p. ej. VAPID
    # inválida), fallar para que el workflow lo marque en rojo y alguien lo vea.
    if sent == 0 and expired == 0 and errors:
        log.error("Ninguna notificación enviada de %d pendientes", len(pending_subs))
        sys.exit(1)


if __name__ == "__main__":
    main()
