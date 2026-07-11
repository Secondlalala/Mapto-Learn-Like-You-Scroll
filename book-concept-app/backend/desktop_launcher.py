from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn


def _app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parents[1]


def _find_frontend_dist(root: Path) -> Path | None:
    executable_dir = Path(sys.executable).resolve().parent
    candidates = [
        root / "frontend" / "dist",
        executable_dir / "_internal" / "frontend" / "dist",
        executable_dir / "frontend" / "dist",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _prepare_environment() -> None:
    root = _app_root()
    backend_dir = root / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    frontend_dist = _find_frontend_dist(root)
    if frontend_dist:
        os.environ["BOOK_CONCEPT_FRONTEND_DIST"] = str(frontend_dist)
    os.chdir(backend_dir)
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def _open_browser(url: str) -> None:
    time.sleep(2)
    webbrowser.open(url)


def _find_available_port(start: int = 8000, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"无法找到可用端口：{start}-{start + attempts - 1}")


def main() -> None:
    if "--kokoro-worker" in sys.argv:
        _prepare_environment()
        from services.kokoro_worker import main as worker_main

        worker_main()
        return

    _prepare_environment()
    from main import app

    port = _find_available_port()
    url = f"http://127.0.0.1:{port}"
    threading.Thread(target=_open_browser, args=(url,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
