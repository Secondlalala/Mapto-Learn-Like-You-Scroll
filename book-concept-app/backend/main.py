import sys
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from database import init_db
from routers import books, cards, chat, settings as settings_router, tts, upload
from services.kokoro_manager import start_kokoro_if_enabled


settings = get_settings()
app = FastAPI(title="Book Concept App API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:5173"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    start_kokoro_if_enabled()


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(upload.router)
app.include_router(books.router)
app.include_router(cards.router)
app.include_router(chat.router)
app.include_router(settings_router.router)
app.include_router(tts.router)


def _find_frontend_dist() -> Path:
    configured = os.getenv("BOOK_CONCEPT_FRONTEND_DIST")
    if configured:
        configured_path = Path(configured)
        if configured_path.exists():
            return configured_path
    candidates = [
        Path(__file__).resolve().parents[1] / "frontend" / "dist",
    ]
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.append(Path(bundle_root) / "frontend" / "dist")
    executable_dir = Path(sys.executable).resolve().parent
    candidates.extend(
        [
            executable_dir / "_internal" / "frontend" / "dist",
            executable_dir / "frontend" / "dist",
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


FRONTEND_DIST = _find_frontend_dist()
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/")
def root():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "name": "Book Concept App API",
        "status": "ok",
        "docs": "/docs",
        "health": "/api/health",
        "frontend": settings.frontend_origin,
    }


@app.get("/{full_path:path}")
def frontend_fallback(full_path: str):
    if full_path.startswith("api/"):
        return {"detail": "Not Found"}
    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"detail": "Frontend build not found. Run npm run build first."}
