import asyncio
import importlib
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Book, GenerationJob
from database import Base


def test_generation_job_persists_queue_progress(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    job = GenerationJob(
        scope="single_book",
        book_ids_json=json.dumps([7, 9]),
        status="paused",
        current_book_id=7,
        current_book_position=0,
        processed_sections=3,
        total_sections=8,
        generated_cards=11,
        message="等待继续",
    )
    session.add(job)
    session.commit()
    job_id = job.id
    session.close()

    reloaded = sessionmaker(bind=engine)().get(GenerationJob, job_id)

    assert reloaded.scope == "single_book"
    assert json.loads(reloaded.book_ids_json) == [7, 9]
    assert reloaded.status == "paused"
    assert reloaded.current_book_id == 7
    assert reloaded.current_book_position == 0
    assert reloaded.processed_sections == 3
    assert reloaded.total_sections == 8
    assert reloaded.generated_cards == 11
    assert reloaded.message == "等待继续"
    assert reloaded.error == ""
    assert reloaded.created_at is not None
    assert reloaded.updated_at is not None


class GenerationManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.temp_dir.name}/jobs.db")
        Base.metadata.create_all(bind=self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.called_book_ids: list[int] = []

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_worker_processes_frozen_book_order_until_every_book_is_done(self):
        first_book, second_book = self._create_books()
        manager = self._manager()

        job_id = manager.create_job("all_books", [first_book.id, second_book.id])
        asyncio.run(manager.process_pending_jobs())

        job = self._get_job(job_id)
        self.assertEqual(self.called_book_ids, [first_book.id, first_book.id, second_book.id, second_book.id])
        self.assertEqual(job.status, "completed")
        self.assertEqual(job.current_book_position, 2)
        self.assertEqual(job.processed_sections, 4)
        self.assertEqual(job.total_sections, 4)
        self.assertEqual(job.generated_cards, 8)

    def test_paused_job_keeps_progress_and_can_resume(self):
        first_book, _ = self._create_books()
        manager = self._manager()

        job_id = manager.create_job("single_book", [first_book.id])
        manager.pause_job(job_id)
        asyncio.run(manager.process_pending_jobs())

        self.assertEqual(self.called_book_ids, [])
        self.assertEqual(self._get_job(job_id).status, "paused")

        manager.resume_job(job_id)
        asyncio.run(manager.process_pending_jobs())

        completed = self._get_job(job_id)
        self.assertEqual(completed.status, "completed")
        self.assertEqual(self.called_book_ids, [first_book.id, first_book.id])

    def test_recovery_pauses_interrupted_jobs(self):
        first_book, _ = self._create_books()
        session = self.session_factory()
        job = GenerationJob(
            scope="single_book",
            book_ids_json=json.dumps([first_book.id]),
            status="running",
        )
        session.add(job)
        session.commit()
        job_id = job.id
        session.close()

        self._manager().recover_interrupted_jobs()

        recovered = self._get_job(job_id)
        self.assertEqual(recovered.status, "paused")
        self.assertEqual(recovered.message, "服务重启后已暂停，可继续生成。")

    def _manager(self):
        module_spec = importlib.util.find_spec("services.generation_manager")
        self.assertIsNotNone(module_spec, "需要提供后台生成任务管理器。")
        module = importlib.import_module("services.generation_manager")
        manager_class = getattr(module, "GenerationManager", None)
        self.assertIsNotNone(manager_class, "任务管理器需要暴露 GenerationManager。")
        return manager_class(self.session_factory, generate_step=self._generate_one_section)

    async def _generate_one_section(self, db, book, force=False):
        del force
        self.called_book_ids.append(book.id)
        total_sections = 2
        book.generation_cursor += 1
        db.commit()
        return 2, book.generation_cursor >= total_sections, book.generation_cursor, total_sections

    def _create_books(self):
        session = self.session_factory()
        books = []
        for title in ("第一本", "第二本"):
            book = Book(
                title=title,
                filename=f"{title}.md",
                file_type="md",
                raw_text="章节内容",
                created_at=datetime.now(timezone.utc),
                chunks_json=json.dumps(
                    [
                        {"chapter": "第一节", "text": "第一段内容"},
                        {"chapter": "第二节", "text": "第二段内容"},
                    ],
                    ensure_ascii=False,
                ),
            )
            session.add(book)
            books.append(book)
        session.commit()
        for book in books:
            session.refresh(book)
        session.expunge_all()
        session.close()
        return books

    def _get_job(self, job_id):
        session = self.session_factory()
        job = session.get(GenerationJob, job_id)
        session.expunge(job)
        session.close()
        return job
