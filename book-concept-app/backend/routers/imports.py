from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from schemas import DatabaseImportOut
from services.database_transfer import ImportValidationError, import_database_file


router = APIRouter(prefix="/api/imports", tags=["imports"])

ALLOWED_DATABASE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}
MAX_DATABASE_BYTES = 200 * 1024 * 1024
READ_CHUNK_BYTES = 1024 * 1024


@router.post("/database", response_model=DatabaseImportOut)
async def import_database(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() not in ALLOWED_DATABASE_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 .db、.sqlite 或 .sqlite3 数据库文件。")

    try:
        with TemporaryDirectory(prefix="maptolearn-import-") as temp_dir:
            database_path = Path(temp_dir) / "uploaded.db"
            total_bytes = 0
            with database_path.open("wb") as target:
                while chunk := await file.read(READ_CHUNK_BYTES):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_DATABASE_BYTES:
                        raise HTTPException(status_code=413, detail="数据库文件超过 200 MB 大小限制。")
                    target.write(chunk)

            result = import_database_file(db, database_path)
            db.commit()
            return DatabaseImportOut(
                imported_book_ids=result.book_ids,
                imported_books=result.books,
                imported_cards=result.cards,
                imported_messages=result.messages,
                message=f"成功导入 {result.books} 本书和 {result.cards} 张卡片。",
            )
    except HTTPException:
        db.rollback()
        raise
    except ImportValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="数据库导入失败，请稍后重试。") from exc
    finally:
        await file.close()
