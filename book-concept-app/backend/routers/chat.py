from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ChatMessage, ConceptCard
from schemas import ChatIn, ChatMessageOut, ChatOut
from services.deepseek_client import DeepSeekClient, DeepSeekNotConfiguredError


router = APIRouter(prefix="/api/cards", tags=["chat"])


@router.get("/{card_id}/chat", response_model=list[ChatMessageOut])
def list_messages(card_id: int, db: Session = Depends(get_db)):
    # 按时间正序返回历史消息，前端可直接从上到下渲染对话。
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.card_id == card_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )


@router.post("/{card_id}/chat", response_model=ChatOut)
async def ask_card(card_id: int, payload: ChatIn, db: Session = Depends(get_db)):
    card = db.get(ConceptCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="知识卡片不存在")
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    # DeepSeekClient 会自动携带当前卡片原文、解释和公式，避免回答脱离本节上下文。
    try:
        answer = await DeepSeekClient().answer_question(card, question)
    except DeepSeekNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # 用户问题与模型回答在同一次事务中写入，避免只保存半段对话。
    db.add(ChatMessage(card_id=card.id, role="user", content=question))
    db.add(ChatMessage(card_id=card.id, role="assistant", content=answer))
    db.commit()
    return ChatOut(answer=answer)
