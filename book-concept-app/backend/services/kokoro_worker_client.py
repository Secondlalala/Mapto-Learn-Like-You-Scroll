from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from threading import Lock


class KokoroWorkerError(RuntimeError):
    pass


_process: subprocess.Popen | None = None
_lock = Lock()


def preload(payload: dict) -> dict:
    return _request({"op": "preload", **payload}, timeout=180)


def synthesize(payload: dict) -> tuple[bytes, str]:
    data = _request({"op": "tts", **payload}, timeout=180)
    audio = base64.b64decode(data["audio"])
    return audio, data.get("content_type") or "audio/wav"


def health() -> dict:
    return _request({"op": "health"}, timeout=30)


def _request(payload: dict, timeout: int) -> dict:
    with _lock:
        process = _ensure_process()
        try:
            assert process.stdin is not None
            assert process.stdout is not None
            process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
        except Exception:
            _stop_process()
            raise KokoroWorkerError("Kokoro GPU worker 连接失败，已重置。")
        if not line:
            _stop_process()
            raise KokoroWorkerError("Kokoro GPU worker 没有返回结果，已重置。")
        data = json.loads(line)
        if not data.get("ok"):
            raise KokoroWorkerError(data.get("error") or "Kokoro GPU worker 执行失败。")
        return data


def _ensure_process() -> subprocess.Popen:
    global _process
    if _process and _process.poll() is None:
        return _process

    frozen = bool(getattr(sys, "frozen", False))
    backend_dir = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1])) / "backend" if frozen else Path(__file__).resolve().parents[1]
    python_exe = backend_dir / ".venv" / "Scripts" / "python.exe"
    if frozen:
        command = [str(Path(sys.executable)), "--kokoro-worker"]
    else:
        if not python_exe.exists():
            python_exe = Path(sys.executable)
        command = [str(python_exe), "-m", "services.kokoro_worker"]

    log_dir = backend_dir / "logs"
    log_dir.mkdir(exist_ok=True)
    stderr = (log_dir / "kokoro_worker.err.log").open("a", encoding="utf-8")
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    _process = subprocess.Popen(
        command,
        cwd=str(backend_dir),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=stderr,
        text=True,
        encoding="utf-8",
        env=env,
        creationflags=creationflags,
    )
    return _process


def _stop_process() -> None:
    global _process
    if _process and _process.poll() is None:
        _process.kill()
    _process = None
