import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models import Book
from schemas import UploadOut
from services.concept_splitter import split_into_chunks
from services.file_parser import read_text_file, validate_book_file


router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload", response_model=UploadOut)
async def upload_book(file: UploadFile = File(...), db: Session = Depends(get_db)):
    # 先依据扩展名拒绝不支持的格式，MVP 明确只接收 Markdown 与纯文本。
    try:
        file_type = validate_book_file(file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    # 使用随机前缀避免同名书籍覆盖；Path.name 同时剥离客户端提交的目录部分。
    safe_name = f"{uuid4().hex}_{Path(file.filename or 'book').name}"
    path = upload_dir / safe_name
    path.write_bytes(await file.read())

    # 文件服务负责编码探测和换行统一，后续切分逻辑始终处理规范化 Unicode 文本。
    raw_text = read_text_file(path)
    if not raw_text:
        raise HTTPException(status_code=400, detail="文件内容为空")

    # 上传阶段先完成确定性的章节切分并保存，生成卡片时无需重复解析整本书。
    chunks = split_into_chunks(raw_text)
    title = Path(file.filename or "未命名书籍").stem
    book = Book(
        title=title,
        filename=file.filename or safe_name,
        file_type=file_type,
        raw_text=raw_text,
        chunks_json=json.dumps(chunks, ensure_ascii=False),
    )
    # 原文与切分结果同时落库，后续生成、追问和恢复进度都以本地数据库为准。
    db.add(book)
    db.commit()
    db.refresh(book)
    return UploadOut(book_id=book.id, title=book.title, message="上传成功")
