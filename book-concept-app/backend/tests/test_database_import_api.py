import json
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Book, ConceptCard
from routers import imports


def test_database_upload_imports_book_cards_and_returns_counts(tmp_path):
    source_path = tmp_path / "qft.db"
    _create_source_database(source_path)
    target_engine, session_factory = _target_database(tmp_path / "target.db")
    client = _client(session_factory)

    response = client.post(
        "/api/imports/database",
        files={"file": ("qft.db", source_path.read_bytes(), "application/x-sqlite3")},
    )

    assert response.status_code == 200
    assert response.json()["imported_books"] == 1
    assert response.json()["imported_cards"] == 1
    assert response.json()["imported_messages"] == 0
    assert len(response.json()["imported_book_ids"]) == 1
    verify = session_factory()
    assert verify.query(Book).count() == 1
    assert verify.query(ConceptCard).count() == 1
    verify.close()
    target_engine.dispose()


def test_database_upload_rejects_wrong_extension_without_writes(tmp_path):
    target_engine, session_factory = _target_database(tmp_path / "target.db")
    client = _client(session_factory)

    response = client.post(
        "/api/imports/database",
        files={"file": ("cards.txt", b"not a database", "text/plain")},
    )

    assert response.status_code == 400
    assert "db" in response.json()["detail"]
    verify = session_factory()
    assert verify.query(Book).count() == 0
    verify.close()
    target_engine.dispose()


def test_database_upload_rejects_malformed_database_without_writes(tmp_path):
    target_engine, session_factory = _target_database(tmp_path / "target.db")
    client = _client(session_factory)

    response = client.post(
        "/api/imports/database",
        files={"file": ("broken.db", b"not sqlite", "application/octet-stream")},
    )

    assert response.status_code == 400
    verify = session_factory()
    assert verify.query(Book).count() == 0
    verify.close()
    target_engine.dispose()


def test_database_upload_stops_when_stream_exceeds_limit(tmp_path, monkeypatch):
    target_engine, session_factory = _target_database(tmp_path / "target.db")
    client = _client(session_factory)
    monkeypatch.setattr(imports, "MAX_DATABASE_BYTES", 4)

    response = client.post(
        "/api/imports/database",
        files={"file": ("large.db", b"12345", "application/octet-stream")},
    )

    assert response.status_code == 413
    verify = session_factory()
    assert verify.query(Book).count() == 0
    verify.close()
    target_engine.dispose()


def _client(session_factory):
    app = FastAPI()
    app.include_router(imports.router)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _create_source_database(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    source = sessionmaker(bind=engine)()
    now = datetime.now(timezone.utc)
    book = Book(
        title="qft",
        filename="qft.md",
        file_type="md",
        raw_text="原文",
        chunks_json=json.dumps([{"chapter": "第一节", "text": "原文"}], ensure_ascii=False),
        generation_cursor=1,
        created_at=now,
    )
    source.add(book)
    source.flush()
    source.add(
        ConceptCard(
            book_id=book.id,
            section_index=0,
            card_type="concept",
            chapter="第一节",
            title="量子场",
            source_text="原文",
            created_at=now,
        )
    )
    source.commit()
    source.close()
    engine.dispose()


def _target_database(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False)
