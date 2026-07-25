#!/usr/bin/env python3
"""
Notificacion diaria de Web Push: avisa a los usuarios que aun NO han
completado el reto del dia.

Corre a las 15:00 UTC (via GitHub Actions cron). "Completado" = existe fila
en `ecos_scores` para (user_id, game_id de hoy).
Los usuarios in-progress (sin score aun) SI reciben la notificacion.

Requiere: pip install -r scripts/requirements-notifications.txt
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

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
except ImportError:
    print("Instala dependencias: pip install -r scripts/requirements-notifications.txt")
    sys.exit(1)

try:
    from pywebpush import webpush, WebPushException
except ImportError:
    print("Instala dependencias: pip install -r scripts/requirements-notifications.txt")
    sys.exit(1)

MADRID = ZoneInfo("Europe/Madrid")

# El emoji va en título; el campo `icon` del sistema sigue siendo una URL (ver service worker).
NOTIFICATION_TITLE = "\U0001f3a7 Tu reto ECOS de hoy"  # 🎧
NOTIFICATION_BODY = (
    "Aún no has completado la canción del día de hoy, ¡estás a tiempo! \U0001f644"
)  # 🙄
NOTIFICATION_URL = "/play"
NOTIFICATION_TAG = "ecos-daily-game"


def setup_logging() -> logging.Logger:
    log = logging.getLogger("daily-notifications")
    log.setLevel(logging.INFO)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    )
    log.addHandler(h)
    return log


def main() -> None:
    log = setup_logging()
    start_ms = int(datetime.now().timestamp() * 1000)

    now_madrid = datetime.now(MADRID)
    log.info("Ejecutando a las %s hora Madrid", now_madrid.strftime("%H:%M"))

    url_env = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    vapid_private = os.environ.get("VAPID_PRIVATE_KEY")
    vapid_subject = os.environ.get("VAPID_SUBJECT")

    missing = [
        name
        for name, value in [
            ("NEXT_PUBLIC_SUPABASE_URL", url_env),
            ("SUPABASE_SERVICE_ROLE_KEY", key_env),
            ("VAPID_PRIVATE_KEY", vapid_private),
            ("VAPID_SUBJECT", vapid_subject),
        ]
        if not value
    ]
    if missing:
        log.error("Variables de entorno requeridas faltantes: %s", ", ".join(missing))
        sys.exit(1)

    assert url_env and key_env and vapid_private and vapid_subject
    supabase: Client = create_client(url_env, key_env)

    today = now_madrid.date().isoformat()

    r_game = (
        supabase.table("ecos_games")
        .select("id")
        .eq("date", today)
        .maybe_single()
        .execute()
    )
    game = r_game.data
    if not game:
        msg = f"No hay juego para {today}, no se envia nada"
        log.info(msg)
        _log_run(supabase, start_ms, "success", msg, {"target_date": today, "skipped": True})
        return

    game_id = game["id"]

    r_completed = (
        supabase.table("ecos_scores")
        .select("user_id")
        .eq("game_id", game_id)
        .execute()
    )
    completed_user_ids = {row["user_id"] for row in (r_completed.data or [])}
    log.info("Usuarios que ya completaron hoy: %d", len(completed_user_ids))

    r_subs = (
        supabase.table("ecos_push_subscriptions")
        .select("id, user_id, subscription, endpoint")
        .eq("enabled", True)
        .eq("notification_daily_game", True)
        .execute()
    )
    all_subs = r_subs.data or []
    pending_subs = [s for s in all_subs if s["user_id"] not in completed_user_ids]
    log.info(
        "Suscripciones totales activas: %d, pendientes de jugar: %d",
        len(all_subs),
        len(pending_subs),
    )

    if not pending_subs:
        _log_run(
            supabase,
            start_ms,
            "success",
            f"Sin destinatarios para {today}",
            {"target_date": today, "total_subscriptions": len(all_subs)},
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
                ttl=12 * 60 * 60,
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

    status = "success" if not errors else "partial"
    _log_run(
        supabase,
        start_ms,
        status,
        summary,
        {
            "target_date": today,
            "game_id": game_id,
            "sent": sent,
            "expired": expired,
            "total_subscriptions": len(all_subs),
            "pending": len(pending_subs),
            "completed": len(completed_user_ids),
        },
        errors=errors,
    )

    # Si había destinatarios y NO se envió ni una sola notificación (p. ej. VAPID
    # inválida), fallar para que el workflow lo marque en rojo y alguien lo vea.
    if sent == 0 and expired == 0 and errors:
        log.error("Ninguna notificación enviada de %d pendientes", len(pending_subs))
        sys.exit(1)


def _log_run(
    supabase: Client,
    start_ms: int,
    status: str,
    summary: str,
    details: dict,
    errors: list[str] | None = None,
) -> None:
    try:
        payload = {
            "job_type": "daily_notifications",
            "status": status,
            "summary": summary,
            "duration_ms": int(datetime.now().timestamp() * 1000) - start_ms,
            "details": details,
        }
        if errors:
            payload["errors"] = errors
        supabase.table("ecos_system_logs").insert(payload).execute()
    except Exception as log_err:
        print(f"[WARN] No se pudo guardar log: {log_err}", file=sys.stderr)


if __name__ == "__main__":
    main()
