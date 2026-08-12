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
    # 首次预加载允许较长超时，因为模型可能需要从本地缓存读取并初始化 GPU。
    return _request({"op": "preload", **payload}, timeout=180)


def synthesize(payload: dict) -> tuple[bytes, str]:
    # worker 返回 Base64 JSON，客户端在进入 HTTP 层之前还原为原始 WAV 字节。
    data = _request({"op": "tts", **payload}, timeout=180)
    audio = base64.b64decode(data["audio"])
    return audio, data.get("content_type") or "audio/wav"


def health() -> dict:
    return _request({"op": "health"}, timeout=30)


def _request(payload: dict, timeout: int) -> dict:
    # stdin/stdout 是单通道协议，锁保证不同请求的写入和读取不会交叉配对。
    with _lock:
        process = _ensure_process()
        try:
            assert process.stdin is not None
            assert process.stdout is not None
            process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
        except Exception:
            # 管道异常后立即销毁进程，下次请求将创建全新 worker，避免持续卡死。
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
    # 已存在健康子进程时直接复用，从而保留其模型和 GPU 缓存。
    if _process and _process.poll() is None:
        return _process

    # 安装包模式由当前 EXE 进入 worker 分支；源码模式使用后端虚拟环境解释器。
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
    # 显式固定管道编码为 UTF-8，保证中文句子和错误信息可无损往返。
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
    # 重置全局引用，确保故障恢复时不会误用已经退出的旧进程对象。
    global _process
    if _process and _process.poll() is None:
        _process.kill()
    _process = None
