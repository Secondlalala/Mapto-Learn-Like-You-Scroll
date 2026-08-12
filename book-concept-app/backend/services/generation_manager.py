from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timezone
from typing import Awaitable, Callable

from sqlalchemy.orm import Session

from database import SessionLocal
from models import Book, GenerationJob
from services.card_generator import generate_cards_for_book, section_count_for_book


GenerateStep = Callable[[Session, Book, bool], Awaitable[tuple[int, bool, int, int]]]
ACTIVE_JOB_STATUSES = ("queued", "running", "paused")


class GenerationManager:
    # 单例管理器拥有两类锁：任务创建锁避免并发创建多个队列，生成锁串行 DeepSeek 调用。
    def __init__(self, session_factory=SessionLocal, generate_step: GenerateStep = generate_cards_for_book):
        self._session_factory = session_factory
        self._generate_step = generate_step
        self._generation_lock = asyncio.Lock()
        self._job_lock = threading.Lock()
        self._worker_task: asyncio.Task | None = None

    def create_job(self, scope: str, book_ids: list[int]) -> int:
        # 创建时冻结书籍顺序，之后新增/删除书籍不会改变这次任务的范围。
        normalized_ids = [int(book_id) for book_id in book_ids]
        with self._job_lock:
            db = self._session_factory()
            try:
                active = self._find_active_job(db)
                if active:
                    return active.id

                books = {book.id: book for book in db.query(Book).filter(Book.id.in_(normalized_ids)).all()}
                remaining_sections = sum(
                    max(section_count_for_book(book) - max(book.generation_cursor or 0, 0), 0)
                    for book_id in normalized_ids
                    if (book := books.get(book_id)) is not None
                )
                status = "queued" if remaining_sections else "completed"
                message = "等待后台生成。" if remaining_sections else "没有待生成的小节。"
                job = GenerationJob(
                    scope=scope,
                    book_ids_json=json.dumps(normalized_ids),
                    status=status,
                    total_sections=remaining_sections,
                    message=message,
                )
                db.add(job)
                db.commit()
                return job.id
            finally:
                db.close()

    def pause_job(self, job_id: int) -> GenerationJob | None:
        # 暂停不会中断正在等待 DeepSeek 的请求；当前小节结束后 worker 读取该状态并停止。
        with self._job_lock:
            db = self._session_factory()
            try:
                job = db.get(GenerationJob, job_id)
                if not job or job.status in {"completed", "failed"}:
                    return job
                job.status = "paused"
                job.message = "已请求暂停，当前小节结束后停止。"
                db.commit()
                db.refresh(job)
                return job
            finally:
                db.close()

    def resume_job(self, job_id: int) -> GenerationJob | None:
        with self._job_lock:
            db = self._session_factory()
            try:
                job = db.get(GenerationJob, job_id)
                if not job or job.status != "paused":
                    return job
                job.status = "queued"
                job.error = ""
                job.message = "等待继续生成。"
                db.commit()
                db.refresh(job)
                return job
            finally:
                db.close()

    def recover_interrupted_jobs(self) -> None:
        # 进程重启不会重放未知状态的网络调用；保留进度并显式交给用户继续。
        with self._job_lock:
            db = self._session_factory()
            try:
                jobs = (
                    db.query(GenerationJob)
                    .filter(GenerationJob.status.in_(("queued", "running")))
                    .all()
                )
                for job in jobs:
                    job.status = "paused"
                    job.message = "服务重启后已暂停，可继续生成。"
                    job.updated_at = datetime.now(timezone.utc)
                if jobs:
                    db.commit()
            finally:
                db.close()

    async def ensure_worker(self) -> None:
        # 同一事件循环内只创建一个后台 task；页面刷新不会额外启动并发 worker。
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self.process_pending_jobs())

    async def generate_one_step(self, db: Session, book: Book, force: bool = False) -> tuple[int, bool, int, int]:
        # 手动“继续生成”和后台队列共用这把锁，优先保证用户阅读时不会被并发 API 拖慢。
        async with self._generation_lock:
            return await self._generate_step(db, book, force)

    async def process_pending_jobs(self) -> None:
        # 每轮重新建 session，避免长时间后台运行持有失效的 SQLite 事务或 ORM 对象。
        try:
            while True:
                job_id = self._next_runnable_job_id()
                if job_id is None:
                    return
                should_continue = await self._process_job_step(job_id)
                if not should_continue:
                    return
        finally:
            current = asyncio.current_task()
            if self._worker_task is current:
                self._worker_task = None

    async def _process_job_step(self, job_id: int) -> bool:
        db = self._session_factory()
        try:
            job = db.get(GenerationJob, job_id)
            if not job or job.status not in {"queued", "running"}:
                return False

            job.status = "running"
            book_ids = _load_book_ids(job)
            if job.current_book_position >= len(book_ids):
                _complete_job(job)
                db.commit()
                return True

            book_id = book_ids[job.current_book_position]
            book = db.get(Book, book_id)
            if not book:
                # 任务运行期间书籍可能被删除，跳过它而不让整个队列永久卡住。
                job.current_book_position += 1
                job.message = "已跳过不存在的书籍。"
                db.commit()
                return True

            job.current_book_id = book.id
            job.message = f"正在生成《{book.title}》的下一小节。"
            cursor_before = max(book.generation_cursor or 0, 0)
            db.commit()

            try:
                generated, done, cursor, _total_sections = await self.generate_one_step(db, book)
            except Exception as exc:
                db.rollback()
                failed_job = db.get(GenerationJob, job_id)
                if failed_job:
                    failed_job.status = "failed"
                    failed_job.error = f"{type(exc).__name__}: {exc}"
                    failed_job.message = "生成失败，已保留进度，可重新开始任务。"
                    db.commit()
                return False

            # pause_job 可能在 DeepSeek 调用期间用另一个 session 更新了状态，先失效本地缓存再判断。
            db.expire_all()
            refreshed_job = db.get(GenerationJob, job_id)
            if not refreshed_job or refreshed_job.status == "paused":
                if refreshed_job:
                    refreshed_job.message = "已暂停，已生成内容和进度已保存。"
                    db.commit()
                return False

            refreshed_job.generated_cards += generated
            refreshed_job.processed_sections += max(cursor - cursor_before, 0)
            if done:
                refreshed_job.current_book_position += 1
                if refreshed_job.current_book_position >= len(book_ids):
                    _complete_job(refreshed_job)
                else:
                    refreshed_job.message = "当前书籍完成，继续生成下一本。"
            else:
                refreshed_job.message = f"《{book.title}》本节完成，正在准备下一小节。"
            db.commit()
            return refreshed_job.status == "running"
        finally:
            db.close()

    def _next_runnable_job_id(self) -> int | None:
        db = self._session_factory()
        try:
            job = (
                db.query(GenerationJob)
                .filter(GenerationJob.status.in_(("queued", "running")))
                .order_by(GenerationJob.id.asc())
                .first()
            )
            return job.id if job else None
        finally:
            db.close()

    @staticmethod
    def _find_active_job(db: Session) -> GenerationJob | None:
        return (
            db.query(GenerationJob)
            .filter(GenerationJob.status.in_(ACTIVE_JOB_STATUSES))
            .order_by(GenerationJob.id.desc())
            .first()
        )


def _load_book_ids(job: GenerationJob) -> list[int]:
    try:
        parsed = json.loads(job.book_ids_json or "[]")
    except json.JSONDecodeError:
        return []
    return [int(book_id) for book_id in parsed if isinstance(book_id, int) or str(book_id).isdigit()]


def _complete_job(job: GenerationJob) -> None:
    job.status = "completed"
    job.message = "全部待生成小节已完成。"
    job.error = ""


generation_manager = GenerationManager()
