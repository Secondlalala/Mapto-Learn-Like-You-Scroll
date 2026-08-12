import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Book, ChatMessage, ConceptCard, GenerationJob
from schemas import BookDeleteIn, BookDeleteOut, BookOut, GenerateCardsOut, GenerationJobOut, OutlineItemOut
from services.card_generator import build_outline
from services.deepseek_client import DeepSeekNotConfiguredError
from services.generation_manager import generation_manager


router = APIRouter(prefix="/api/books", tags=["books"])


@router.get("", response_model=list[BookOut])
def list_books(db: Session = Depends(get_db)):
    # 书籍表不冗余保存卡片总数，列表查询时按 book_id 统计，避免生成失败造成计数漂移。
    books = db.query(Book).order_by(Book.created_at.desc()).all()
    result = []
    for book in books:
        data = BookOut.model_validate(book)
        data.card_count = db.query(ConceptCard).filter(ConceptCard.book_id == book.id).count()
        result.append(data)
    return result


@router.get("/{book_id}", response_model=BookOut)
def get_book(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    data = BookOut.model_validate(book)
    data.card_count = db.query(ConceptCard).filter(ConceptCard.book_id == book.id).count()
    return data


@router.delete("/{book_id}", response_model=BookDeleteOut)
def delete_book(book_id: int, payload: BookDeleteIn, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    if payload.confirmation_title != book.title:
        raise HTTPException(status_code=400, detail="确认书名与当前书籍不一致。")

    active_jobs = (
        db.query(GenerationJob)
        .filter(GenerationJob.status.in_(("queued", "running")))
        .all()
    )
    if any(_job_contains_book(job, book_id) for job in active_jobs):
        raise HTTPException(status_code=409, detail="本书正在后台生成，请先暂停任务或等待任务完成。")

    card_ids = [
        row[0]
        for row in db.query(ConceptCard.id).filter(ConceptCard.book_id == book_id).all()
    ]
    try:
        deleted_messages = 0
        if card_ids:
            deleted_messages = (
                db.query(ChatMessage)
                .filter(ChatMessage.card_id.in_(card_ids))
                .delete(synchronize_session=False)
            )
        deleted_cards = (
            db.query(ConceptCard)
            .filter(ConceptCard.book_id == book_id)
            .delete(synchronize_session=False)
        )
        db.delete(book)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return BookDeleteOut(
        book_id=book_id,
        deleted_cards=deleted_cards,
        deleted_messages=deleted_messages,
        message=f"已删除《{book.title}》及其全部学习数据。",
    )


@router.get("/{book_id}/outline", response_model=list[OutlineItemOut])
def get_outline(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    # 大纲同时返回每节生成状态和卡片数，供阅读页显示后台生成进度。
    cards = db.query(ConceptCard).filter(ConceptCard.book_id == book.id).all()
    return build_outline(book, cards)


@router.post("/{book_id}/generation-job", response_model=GenerationJobOut)
async def generate_entire_book(book_id: int, db: Session = Depends(get_db)):
    # 单书批量生成始终从本书现有游标继续，不使用 force，也不会清理已完成卡片。
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    job_id = generation_manager.create_job("single_book", [book.id])
    await generation_manager.ensure_worker()
    job = generation_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=500, detail="创建生成任务后无法读取任务状态。")
    return GenerationJobOut.model_validate(job)


@router.post("/{book_id}/generate-cards", response_model=GenerateCardsOut)
async def generate_cards(
    book_id: int,
    force: bool = Query(False, description="是否清空旧卡片并从头生成"),
    db: Session = Depends(get_db),
):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    # 单次请求只处理一个小节，既缩短 DeepSeek 等待时间，也让断点游标及时落库。
    try:
        generated, done, cursor, total_sections = await generation_manager.generate_one_step(db, book, force=force)
    # 配置问题、上游服务问题和未知程序错误使用不同状态码，前端可以给出准确提示。
    except DeepSeekNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"生成失败：{type(exc).__name__}: {exc}") from exc

    if done:
        message = "本书全部小节已生成完成。"
    elif generated == 0:
        message = "本次没有生成新卡片，请继续点击生成或检查当前小节内容。"
    else:
        message = "本次生成完成，可继续生成后续小节。"
    return GenerateCardsOut(
        book_id=book.id,
        generated=generated,
        message=message,
        done=done,
        cursor=cursor,
        total_sections=total_sections,
    )


def _job_contains_book(job: GenerationJob, book_id: int) -> bool:
    try:
        parsed = json.loads(job.book_ids_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return False
    if not isinstance(parsed, list):
        return False
    for value in parsed:
        try:
            if int(value) == book_id:
                return True
        except (TypeError, ValueError):
            continue
    return False
