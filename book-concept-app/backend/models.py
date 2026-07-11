from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(20))
    raw_text: Mapped[str] = mapped_column(Text)
    chunks_json: Mapped[str] = mapped_column(Text, default="[]")
    generation_cursor: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    cards: Mapped[list["ConceptCard"]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan",
    )


class ConceptCard(Base):
    __tablename__ = "concept_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), index=True)
    section_index: Mapped[int] = mapped_column(Integer, default=0, index=True)
    card_type: Mapped[str] = mapped_column(String(30), default="concept")
    chapter: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), index=True)
    source_text: Mapped[str] = mapped_column(Text)
    one_sentence: Mapped[str] = mapped_column(Text, default="")
    simple_explanation: Mapped[str] = mapped_column(Text, default="")
    fable: Mapped[str] = mapped_column(Text, default="")
    formula: Mapped[str] = mapped_column(Text, default="")
    formula_explanation: Mapped[str] = mapped_column(Text, default="")
    prerequisites: Mapped[str] = mapped_column(Text, default="[]")
    related_concepts: Mapped[str] = mapped_column(Text, default="[]")
    questions: Mapped[str] = mapped_column(Text, default="[]")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    book: Mapped[Book] = relationship(back_populates="cards")
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("concept_cards.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    card: Mapped[ConceptCard] = relationship(back_populates="messages")
