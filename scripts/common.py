"""
Piezas comunes de los scripts de datos (los crons de GitHub Actions): entorno, cliente de
Supabase, logging y registro de la ejecución en `ecos_system_logs`.

Solo depende de `supabase` (y lo importa tarde), así que sirve con cualquiera de los
`requirements-*.txt`. Los scripts ya importan módulos hermanos (`db_paging`, `song_key`), así
que basta con `from common import ...` desde `scripts/`.
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from supabase import Client

MADRID = ZoneInfo("Europe/Madrid")
REPO_ROOT = Path(__file__).resolve().parent.parent

# Valores de `ecos_system_logs.job_type`. Tienen que estar admitidos por el CHECK
# `ecos_system_logs_job_type_check` (supabase/schema/01_tables.sql): un valor que no esté ahí
# hace fallar el insert del registro. La lista de la app está en src/lib/system-logger.ts.
JOB_INGESTION = "ingestion"
JOB_DAILY_GAME = "daily_game"
JOB_DAILY_NOTIFICATIONS = "daily_notifications"
JOB_GAMES_CHECK = "games_check"
JOB_DEEZER_BACKFILL = "deezer_backfill"


def load_env() -> None:
    """
    Carga `.env.local` de la raíz del repo, si existe (en local; en Actions no hay fichero y
    las variables llegan de los secrets). No pisa variables ya definidas en el entorno.
    """
    env_file = REPO_ROOT / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k:
            os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def setup_logging(name: str, *, verbose: bool = False) -> logging.Logger:
    """Logger a stdout con hora, nivel y mensaje. Llamarlo dos veces no duplica la salida."""
    log = logging.getLogger(name)
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    if not log.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
        )
        log.addHandler(h)
    log.propagate = False
    return log


def require_env(log: logging.Logger, *names: str) -> dict[str, str]:
    """Devuelve las variables pedidas o sale con 1 si falta alguna."""
    values = {n: os.environ.get(n, "") for n in names}
    missing = [n for n, v in values.items() if not v]
    if missing:
        log.error("Variables de entorno requeridas faltantes: %s", ", ".join(missing))
        sys.exit(1)
    return values


def get_supabase(log: logging.Logger, *, read_only: bool = False) -> Client:
    """
    Cliente con la service role key (bypass total de RLS). Sale con 1 si faltan las variables
    o la dependencia.

    Con `read_only=True` devuelve un envoltorio que rechaza cualquier escritura: es lo que usan
    los modos de simulación, para que un fallo en el propio script no pueda escribir en
    producción.
    """
    env = require_env(log, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    try:
        from supabase import create_client
    except ImportError:
        log.error("Falta el paquete supabase: pip install -r scripts/requirements-<script>.txt")
        sys.exit(1)
    client = create_client(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    return ReadOnlyClient(client) if read_only else client  # type: ignore[return-value]


class _ReadOnlyTable:
    _WRITES = frozenset({"insert", "update", "upsert", "delete"})

    def __init__(self, table: Any, name: str) -> None:
        self._table = table
        self._name = name

    def __getattr__(self, attr: str) -> Any:
        if attr in self._WRITES:
            raise RuntimeError(f"Modo solo lectura: se intentó {attr} en {self._name}")
        return getattr(self._table, attr)


class ReadOnlyClient:
    """Envoltorio de `Client` que solo deja hacer `table(...).select(...)`."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def table(self, name: str) -> _ReadOnlyTable:
        return _ReadOnlyTable(self._client.table(name), name)

    from_ = table

    def __getattr__(self, attr: str) -> Any:
        # rpc, storage, auth...: una RPC puede escribir, así que fuera también.
        raise RuntimeError(f"Modo solo lectura: {attr} no está permitido")


def now_ms() -> int:
    return int(datetime.now().timestamp() * 1000)


def gh_annotation(level: str, message: str) -> None:
    """
    Anotación de GitHub Actions (`notice`, `warning` o `error`): sale en el resumen del run sin
    tener que abrir el log. Fuera de Actions no hace nada (el mensaje ya va por el logger).
    """
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{level}::{escaped}", flush=True)


def log_job(
    supabase: Client,
    job_type: str,
    status: str,
    summary: str,
    *,
    start_ms: int,
    details: dict | None = None,
    errors: list[str] | None = None,
    log: logging.Logger | None = None,
) -> bool:
    """
    Registra una ejecución en `ecos_system_logs`, que es lo que enseña el panel de admin.

    Devuelve False si el insert falla, y nunca se traga el error en silencio: lo escribe en el
    log y como anotación de Actions. Qué hacer después (seguir o salir con 1) lo decide quien
    llama. Antes, un `job_type` que el CHECK no admitía dejó las notificaciones sin registrar
    durante meses sin que nadie lo viera.
    """
    payload: dict[str, Any] = {
        "job_type": job_type,
        "status": status,
        "summary": summary,
        "duration_ms": now_ms() - start_ms,
        "details": details or {},
        "errors": errors[:20] if errors else None,
    }
    try:
        supabase.table("ecos_system_logs").insert(payload).execute()
        return True
    except Exception as exc:
        msg = f"No se pudo guardar el registro {job_type}/{status} en ecos_system_logs: {exc}"
        if log:
            log.error(msg)
        else:
            print(f"[ERROR] {msg}", file=sys.stderr)
        gh_annotation("warning", msg)
        return False
