import os
import sqlite3
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker
from starlette.background import BackgroundTask

from database import Base, get_db
from models import Book, ChatMessage, ConceptCard


router = APIRouter(tags=["exports"])


@router.get("/api/exports/app-database")
def export_application_database(db: Session = Depends(get_db)):
    # SQLite backup API 在数据库仍有写入时生成一致快照，不直接复制可能处于 WAL 状态的 app.db。
    export_path = _new_export_path("maptolearn-app")
    try:
        source = _raw_sqlite_connection(db)
        with sqlite3.connect(export_path) as destination:
            source.backup(destination)
    except Exception as exc:
        _remove_export(export_path.parent)
        raise HTTPException(status_code=500, detail=f"导出应用数据库失败：{type(exc).__name__}: {exc}") from exc
    return _database_download(export_path)


@router.get("/api/books/{book_id}/export-database")
def export_book_database(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")

    export_path = _new_export_path(f"maptolearn-book-{book_id}")
    export_engine = create_engine(f"sqlite:///{export_path.as_posix()}")
    try:
        Base.metadata.create_all(bind=export_engine)
        target_session = sessionmaker(bind=export_engine, autoflush=False, autocommit=False)()
        try:
            # 保留主键，使卡片、追问和书籍之间的关联在独立数据库中无需额外重映射。
            target_session.add(Book(**_column_values(book)))
            cards = db.query(ConceptCard).filter(ConceptCard.book_id == book.id).all()
            for card in cards:
                target_session.add(ConceptCard(**_column_values(card)))
            card_ids = [card.id for card in cards]
            if card_ids:
                messages = db.query(ChatMessage).filter(ChatMessage.card_id.in_(card_ids)).all()
                for message in messages:
                    target_session.add(ChatMessage(**_column_values(message)))
            target_session.commit()
        finally:
            target_session.close()
    except Exception as exc:
        _remove_export(export_path.parent)
        raise HTTPException(status_code=500, detail=f"导出本书数据库失败：{type(exc).__name__}: {exc}") from exc
    finally:
        export_engine.dispose()

    return _database_download(export_path)


def _raw_sqlite_connection(db: Session) -> sqlite3.Connection:
    if db.bind is None or db.bind.dialect.name != "sqlite":
        raise RuntimeError("当前导出仅支持 SQLite 数据库。")
    connection = db.connection().connection
    return getattr(connection, "driver_connection", connection)


def _column_values(instance) -> dict:
    return {
        attribute.key: getattr(instance, attribute.key)
        for attribute in inspect(instance).mapper.column_attrs
    }


def _new_export_path(prefix: str) -> Path:
    export_dir = Path(tempfile.mkdtemp(prefix="maptolearn-export-"))
    return export_dir / f"{prefix}.db"


def _database_download(path: Path) -> FileResponse:
    return FileResponse(
        path,
        media_type="application/x-sqlite3",
        filename=path.name,
        background=BackgroundTask(_remove_export, path.parent),
    )


def _remove_export(export_dir: Path) -> None:
    # 临时目录只装本次导出快照；下载完成或异常后清理，避免本地积累用户书籍副本。
    for _ in range(4):
        try:
            for child in export_dir.iterdir():
                child.unlink(missing_ok=True)
            os.rmdir(export_dir)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            # Windows 文件流关闭略晚于响应完成时，短暂重试即可避免把清理异常冒泡给下载请求。
            time.sleep(0.1)
