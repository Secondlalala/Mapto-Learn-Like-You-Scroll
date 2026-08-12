import json
import sqlite3
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Book, ChatMessage, ConceptCard
from services.database_transfer import ImportValidationError, import_database_file


def test_import_twice_creates_distinct_books_and_remaps_relations(tmp_path):
    source_path = tmp_path / "source.db"
    _create_source_database(source_path)
    target_engine, target = _target_session(tmp_path / "target.db")

    first = import_database_file(target, source_path)
    target.commit()
    second = import_database_file(target, source_path)
    target.commit()

    books = target.query(Book).order_by(Book.id.asc()).all()
    cards = target.query(ConceptCard).order_by(ConceptCard.id.asc()).all()
    messages = target.query(ChatMessage).order_by(ChatMessage.id.asc()).all()
    first_card_ids = {card.id for card in cards if card.book_id == books[0].id}
    second_card_ids = {card.id for card in cards if card.book_id == books[1].id}

    assert first.books == second.books == 1
    assert first.cards == second.cards == 2
    assert first.messages == second.messages == 1
    assert first.book_ids != second.book_ids
    assert [book.title for book in books] == ["qft", "qft"]
    assert [book.generation_cursor for book in books] == [15, 15]
    assert len(cards) == 4
    assert len(messages) == 2
    assert first_card_ids.isdisjoint(second_card_ids)
    assert messages[0].card_id in first_card_ids
    assert messages[1].card_id in second_card_ids
    assert sum(1 for card in cards if card.is_favorite) == 2
    assert cards[0].prerequisites == "[]"
    assert cards[0].related_concepts == "[]"
    assert cards[0].questions == '["为什么？"]'

    target.close()
    target_engine.dispose()


@pytest.mark.parametrize(
    "source_name,source_builder",
    [
        ("broken.db", lambda path: path.write_bytes(b"this is not sqlite")),
        ("missing-tables.db", lambda path: sqlite3.connect(path).close()),
    ],
)
def test_invalid_database_is_rejected_without_partial_import(tmp_path, source_name, source_builder):
    source_path = tmp_path / source_name
    source_builder(source_path)
    target_engine, target = _target_session(tmp_path / "target.db")

    with pytest.raises(ImportValidationError):
        import_database_file(target, source_path)
    target.rollback()

    assert target.query(Book).count() == 0
    assert target.query(ConceptCard).count() == 0
    assert target.query(ChatMessage).count() == 0

    target.close()
    target_engine.dispose()


def test_orphan_card_is_rejected_before_target_writes(tmp_path):
    source_path = tmp_path / "orphan.db"
    source_engine = create_engine(f"sqlite:///{source_path.as_posix()}")
    Base.metadata.create_all(bind=source_engine)
    source_engine.dispose()
    with sqlite3.connect(source_path) as source:
        source.execute(
            """
            INSERT INTO concept_cards (
                id, book_id, section_index, card_type, chapter, title, source_text,
                one_sentence, simple_explanation, fable, formula, formula_explanation,
                prerequisites, related_concepts, questions, is_favorite, created_at
            ) VALUES (1, 999, 0, 'concept', '第一节', '孤立卡片', '原文', '', '', '', '', '', '[]', '[]', '[]', 0, ?)
            """,
            (datetime.now(timezone.utc).isoformat(),),
        )
        source.commit()
    target_engine, target = _target_session(tmp_path / "target.db")

    with pytest.raises(ImportValidationError, match="卡片"):
        import_database_file(target, source_path)

    assert target.query(Book).count() == 0
    target.close()
    target_engine.dispose()


def _create_source_database(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    source = sessionmaker(bind=engine, expire_on_commit=False)()
    now = datetime.now(timezone.utc)
    book = Book(
        title="qft",
        filename="qft.md",
        file_type="md",
        raw_text="量子场论原文",
        chunks_json=json.dumps([{"chapter": "第一节", "text": "原文"}], ensure_ascii=False),
        generation_cursor=15,
        created_at=now,
    )
    source.add(book)
    source.flush()
    first_card = ConceptCard(
        book_id=book.id,
        section_index=0,
        card_type="concept",
        chapter="第一节",
        title="场与粒子",
        source_text="原文",
        one_sentence="场是基本对象。",
        prerequisites="not-json",
        related_concepts='{"invalid": true}',
        questions='["为什么？"]',
        is_favorite=True,
        created_at=now,
    )
    second_card = ConceptCard(
        book_id=book.id,
        section_index=0,
        card_type="concept",
        chapter="第一节",
        title="量子化",
        source_text="原文",
        one_sentence="量子化把场提升为算符。",
        created_at=now,
    )
    source.add_all([first_card, second_card])
    source.flush()
    source.add(ChatMessage(card_id=first_card.id, role="user", content="为什么？", created_at=now))
    source.commit()
    source.close()
    engine.dispose()


def _target_session(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False)()
