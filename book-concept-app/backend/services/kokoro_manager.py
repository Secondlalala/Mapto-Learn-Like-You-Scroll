from __future__ import annotations

import socket
import subprocess
import sys
import os
from pathlib import Path
from urllib.parse import urlparse

from services.runtime_settings import get_tts_config


_process: subprocess.Popen | None = None


def start_kokoro_if_enabled() -> None:
    config = get_tts_config()
    if not config["enabled"] or config["api_style"] != "kokoro":
        return
    from services.kokoro_worker_client import health

    try:
        health()
        return
    except Exception:
        return

    parsed = urlparse(config["api_url"])
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 9977
    if host not in {"127.0.0.1", "localhost"}:
        return
    if _port_open(host, port):
        return

    backend_dir = Path(__file__).resolve().parents[1]
    python_exe = backend_dir / ".venv" / "Scripts" / "python.exe"
    if not python_exe.exists():
        python_exe = Path(sys.executable)

    log_dir = backend_dir / "logs"
    log_dir.mkdir(exist_ok=True)
    stdout = (log_dir / "kokoro.log").open("a", encoding="utf-8")
    stderr = (log_dir / "kokoro.err.log").open("a", encoding="utf-8")

    global _process
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    creationflags |= getattr(subprocess, "DETACHED_PROCESS", 0)

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    _process = subprocess.Popen(
        [
            str(python_exe),
            "-m",
            "uvicorn",
            "services.kokoro_service:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=str(backend_dir),
        stdout=stdout,
        stderr=stderr,
        env=env,
        creationflags=creationflags,
    )


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False
