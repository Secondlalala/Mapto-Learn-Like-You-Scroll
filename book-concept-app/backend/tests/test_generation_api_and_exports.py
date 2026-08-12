import importlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Book, ChatMessage, ConceptCard
from services.generation_manager import GenerationManager


class RecordingGenerationManager(GenerationManager):
    def __init__(self, session_factory):
        super().__init__(session_factory, generate_step=self._generate_step)
        self.worker_requested = False

    async def ensure_worker(self):
        self.worker_requested = True

    async def _generate_step(self, db, book, force=False):
        del force
        book.generation_cursor += 1
        db.commit()
        return 1, True, book.generation_cursor, 1


class GenerationJobRouterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.temp_dir.name}/api.db")
        Base.metadata.create_all(bind=self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.books = _create_sample_books(self.session_factory)
        self.manager = RecordingGenerationManager(self.session_factory)

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_all_books_endpoint_creates_one_resumable_job(self):
        client, router_module = self._client()
        original_manager = router_module.generation_manager
        router_module.generation_manager = self.manager
        try:
            response = client.post("/api/generation-jobs/all-books")
            current = client.get("/api/generation-jobs/current")
        finally:
            router_module.generation_manager = original_manager

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["scope"], "all_books")
        self.assertEqual(json.loads(response.json()["book_ids_json"]), [self.books[0].id, self.books[1].id])
        self.assertTrue(self.manager.worker_requested)
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.json()["id"], response.json()["id"])

    def test_single_book_endpoint_pause_and_resume_same_job(self):
        client, router_module = self._client()
        original_manager = router_module.generation_manager
        books_router_module = importlib.import_module("routers.books")
        original_books_manager = books_router_module.generation_manager
        router_module.generation_manager = self.manager
        books_router_module.generation_manager = self.manager
        try:
            created = client.post(f"/api/books/{self.books[0].id}/generation-job")
            paused = client.post(f"/api/generation-jobs/{created.json()['id']}/pause")
            resumed = client.post(f"/api/generation-jobs/{created.json()['id']}/resume")
        finally:
            router_module.generation_manager = original_manager
            books_router_module.generation_manager = original_books_manager

        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["scope"], "single_book")
        self.assertEqual(paused.status_code, 200)
        self.assertEqual(paused.json()["status"], "paused")
        self.assertEqual(resumed.status_code, 200)
        self.assertEqual(resumed.json()["id"], created.json()["id"])
        self.assertEqual(resumed.json()["status"], "queued")

    def _client(self):
        module_spec = importlib.util.find_spec("routers.generation_jobs")
        self.assertIsNotNone(module_spec, "需要提供批量生成任务 API。")
        router_module = importlib.import_module("routers.generation_jobs")
        app = FastAPI()
        app.include_router(importlib.import_module("routers.books").router)
        app.include_router(router_module.router)
        app.dependency_overrides[get_db] = _session_override(self.session_factory)
        return TestClient(app), router_module


class DatabaseExportRouterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.engine = create_engine(f"sqlite:///{self.temp_path / 'source.db'}")
        Base.metadata.create_all(bind=self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.books = _create_sample_books(self.session_factory, include_cards=True)

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_application_export_is_a_readable_full_database_snapshot(self):
        response = self._client().get("/api/exports/app-database")
        exported = self._write_export("app-export.db", response.content)

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["content-disposition"])
        db = sqlite3.connect(exported)
        try:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM books").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM concept_cards").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0], 1)
        finally:
            db.close()

    def test_book_export_contains_only_target_book_and_related_records(self):
        response = self._client().get(f"/api/books/{self.books[0].id}/export-database")
        exported = self._write_export("book-export.db", response.content)

        self.assertEqual(response.status_code, 200)
        db = sqlite3.connect(exported)
        try:
            exported_book_ids = [row[0] for row in db.execute("SELECT id FROM books").fetchall()]
            exported_card_book_ids = [row[0] for row in db.execute("SELECT DISTINCT book_id FROM concept_cards").fetchall()]
            self.assertEqual(exported_book_ids, [self.books[0].id])
            self.assertEqual(exported_card_book_ids, [self.books[0].id])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0], 1)
        finally:
            db.close()

    def _client(self):
        module_spec = importlib.util.find_spec("routers.exports")
        self.assertIsNotNone(module_spec, "需要提供数据库导出 API。")
        router_module = importlib.import_module("routers.exports")
        app = FastAPI()
        app.include_router(router_module.router)
        app.dependency_overrides[get_db] = _session_override(self.session_factory)
        return TestClient(app)

    def _write_export(self, filename, content):
        path = self.temp_path / filename
        path.write_bytes(content)
        return path


def _create_sample_books(session_factory, include_cards=False):
    session = session_factory()
    now = datetime.now(timezone.utc)
    books = []
    for title in ("第一本", "第二本"):
        book = Book(
            title=title,
            filename=f"{title}.md",
            file_type="md",
            raw_text="章节内容",
            chunks_json=json.dumps([{"chapter": "第一节", "text": "内容"}], ensure_ascii=False),
            created_at=now,
        )
        session.add(book)
        books.append(book)
    session.commit()
    for book in books:
        session.refresh(book)

    if include_cards:
        for index, book in enumerate(books):
            card = ConceptCard(
                book_id=book.id,
                section_index=0,
                chapter="第一节",
                title=f"概念{index + 1}",
                source_text="原文",
                created_at=now,
            )
            session.add(card)
            session.flush()
            if index == 0:
                session.add(ChatMessage(card_id=card.id, role="user", content="为什么？", created_at=now))
        session.commit()

    for book in books:
        session.refresh(book)
        session.expunge(book)
    session.close()
    return books


def _session_override(session_factory):
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    return override_get_db
