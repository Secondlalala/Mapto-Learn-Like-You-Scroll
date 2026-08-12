import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Book, ChatMessage, ConceptCard, GenerationJob
from routers import books


def test_confirmed_delete_removes_only_selected_book_and_related_data(tmp_path):
    engine, session_factory = _database(tmp_path / "delete.db")
    target_id, preserved_id = _seed_two_books(session_factory)
    client = _client(session_factory)

    response = client.request(
        "DELETE",
        f"/api/books/{target_id}",
        json={"confirmation_title": "需要删除的书"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "book_id": target_id,
        "deleted_cards": 1,
        "deleted_messages": 2,
        "message": "已删除《需要删除的书》及其全部学习数据。",
    }
    verify = session_factory()
    assert verify.get(Book, target_id) is None
    assert verify.get(Book, preserved_id) is not None
    assert verify.query(ConceptCard).filter(ConceptCard.book_id == preserved_id).count() == 1
    assert verify.query(ChatMessage).count() == 1
    verify.close()
    engine.dispose()


def test_delete_rejects_mismatched_title_without_writes(tmp_path):
    engine, session_factory = _database(tmp_path / "delete.db")
    target_id, _ = _seed_two_books(session_factory)
    client = _client(session_factory)

    response = client.request(
        "DELETE",
        f"/api/books/{target_id}",
        json={"confirmation_title": "少了一个字"},
    )

    assert response.status_code == 400
    verify = session_factory()
    assert verify.query(Book).count() == 2
    assert verify.query(ConceptCard).count() == 2
    assert verify.query(ChatMessage).count() == 3
    verify.close()
    engine.dispose()


@pytest.mark.parametrize("status", ["queued", "running"])
def test_delete_rejects_book_in_active_generation_job(tmp_path, status):
    engine, session_factory = _database(tmp_path / f"delete-{status}.db")
    target_id, _ = _seed_two_books(session_factory)
    session = session_factory()
    session.add(
        GenerationJob(
            scope="single_book",
            book_ids_json=json.dumps([target_id]),
            status=status,
        )
    )
    session.commit()
    session.close()
    client = _client(session_factory)

    response = client.request(
        "DELETE",
        f"/api/books/{target_id}",
        json={"confirmation_title": "需要删除的书"},
    )

    assert response.status_code == 409
    verify = session_factory()
    assert verify.get(Book, target_id) is not None
    verify.close()
    engine.dispose()


def _client(session_factory):
    app = FastAPI()
    app.include_router(books.router)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _database(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _seed_two_books(session_factory):
    session = session_factory()
    now = datetime.now(timezone.utc)
    target = Book(
        title="需要删除的书",
        filename="target.md",
        file_type="md",
        raw_text="target",
        chunks_json="[]",
        created_at=now,
    )
    preserved = Book(
        title="保留的书",
        filename="preserved.md",
        file_type="md",
        raw_text="preserved",
        chunks_json="[]",
        created_at=now,
    )
    session.add_all([target, preserved])
    session.flush()
    target_card = ConceptCard(
        book_id=target.id,
        chapter="第一节",
        title="删除卡片",
        source_text="target",
        created_at=now,
    )
    preserved_card = ConceptCard(
        book_id=preserved.id,
        chapter="第一节",
        title="保留卡片",
        source_text="preserved",
        created_at=now,
    )
    session.add_all([target_card, preserved_card])
    session.flush()
    session.add_all(
        [
            ChatMessage(card_id=target_card.id, role="user", content="问题", created_at=now),
            ChatMessage(card_id=target_card.id, role="assistant", content="回答", created_at=now),
            ChatMessage(card_id=preserved_card.id, role="user", content="保留", created_at=now),
        ]
    )
    session.commit()
    target_id, preserved_id = target.id, preserved.id
    session.close()
    return target_id, preserved_id
