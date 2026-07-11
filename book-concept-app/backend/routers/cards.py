from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ConceptCard
from schemas import ConceptCardOut, FavoriteOut
from services.card_generator import card_to_dict


router = APIRouter(prefix="/api", tags=["cards"])


@router.get("/books/{book_id}/cards", response_model=list[ConceptCardOut])
def list_cards(book_id: int, db: Session = Depends(get_db)):
    cards = (
        db.query(ConceptCard)
        .filter(ConceptCard.book_id == book_id)
        .order_by(ConceptCard.section_index.asc(), ConceptCard.id.asc())
        .all()
    )
    return [card_to_dict(card) for card in cards]


@router.post("/cards/{card_id}/favorite", response_model=FavoriteOut)
def toggle_favorite(card_id: int, db: Session = Depends(get_db)):
    card = db.get(ConceptCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="知识卡片不存在")
    card.is_favorite = not card.is_favorite
    db.commit()
    return FavoriteOut(card_id=card.id, is_favorite=card.is_favorite)

