from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Book(Base):
    # Book 保存原始全文、解析后的小节 JSON，以及可断点续生成的游标。
    # generation_cursor 指向下一待生成小节，关闭网页后仍能从数据库恢复进度。
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
        # 删除书籍时级联删除其知识卡片，避免留下失去归属的记录。
        back_populates="book",
        cascade="all, delete-orphan",
    )


class ConceptCard(Base):
    # 每张卡片绑定书籍和小节序号。card_type 区分章节导览卡与普通概念卡。
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
    # SQLite 不依赖数据库专用数组类型，列表字段以 JSON 文本保存，API 输出时再还原。
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
    # 追问记录绑定具体卡片，保证切换概念后不会混用另一张卡片的上下文。
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("concept_cards.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    card: Mapped[ConceptCard] = relationship(back_populates="messages")


class GenerationJob(Base):
    # 应用始终只运行一个生成队列；任务状态落库后，即使关闭网页也能继续查看进度。
    __tablename__ = "generation_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    scope: Mapped[str] = mapped_column(String(30))
    book_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    current_book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_book_position: Mapped[int] = mapped_column(Integer, default=0)
    processed_sections: Mapped[int] = mapped_column(Integer, default=0)
    total_sections: Mapped[int] = mapped_column(Integer, default=0)
    generated_cards: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
