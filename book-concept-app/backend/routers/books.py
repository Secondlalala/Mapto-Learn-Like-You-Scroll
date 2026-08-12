from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Book, ConceptCard
from schemas import BookOut, GenerateCardsOut, OutlineItemOut
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


@router.get("/{book_id}/outline", response_model=list[OutlineItemOut])
def get_outline(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在。")
    # 大纲同时返回每节生成状态和卡片数，供阅读页显示后台生成进度。
    cards = db.query(ConceptCard).filter(ConceptCard.book_id == book.id).all()
    return build_outline(book, cards)


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
