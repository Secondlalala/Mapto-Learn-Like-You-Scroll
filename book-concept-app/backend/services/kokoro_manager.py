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
    # 仅当用户选择 Kokoro 时启动独立服务，其他 TTS 模式不占用模型内存和显存。
    config = get_tts_config()
    if not config["enabled"] or config["api_style"] != "kokoro":
        return

    parsed = urlparse(config["api_url"])
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 9977
    # 自动启动只针对本机地址；远程 TTS 服务应由其服务器独立维护。
    if host not in {"127.0.0.1", "localhost"}:
        return
    # 端口已有服务时直接复用，避免后端重载产生重复模型进程。
    if _port_open(host, port):
        return

    backend_dir = Path(__file__).resolve().parents[1]
    python_exe = backend_dir / ".venv" / "Scripts" / "python.exe"
    if not python_exe.exists():
        python_exe = Path(sys.executable)

    # 子进程隐藏运行，标准输出和错误写入日志，便于排查模型下载或 CUDA 问题。
    log_dir = backend_dir / "logs"
    log_dir.mkdir(exist_ok=True)
    stdout = (log_dir / "kokoro.log").open("a", encoding="utf-8")
    stderr = (log_dir / "kokoro.err.log").open("a", encoding="utf-8")

    global _process
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    creationflags |= getattr(subprocess, "DETACHED_PROCESS", 0)

    # 强制 UTF-8 可避免中文语音文本在 Windows 子进程管道中被本地代码页破坏。
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
    # 使用短连接做轻量存活探测，启动流程不会因不可达端口长时间阻塞。
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False
