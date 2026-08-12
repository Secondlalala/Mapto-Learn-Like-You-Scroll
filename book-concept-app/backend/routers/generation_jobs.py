from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Book
from schemas import GenerationJobOut
from services.generation_manager import generation_manager


router = APIRouter(prefix="/api/generation-jobs", tags=["generation-jobs"])


@router.post("/all-books", response_model=GenerationJobOut)
async def generate_all_books(db: Session = Depends(get_db)):
    # 首页任务按上传顺序冻结范围，之后再上传的书不会悄悄插入已经开始的队列。
    book_ids = [book.id for book in db.query(Book).order_by(Book.created_at.asc(), Book.id.asc()).all()]
    job_id = generation_manager.create_job("all_books", book_ids)
    await generation_manager.ensure_worker()
    job = generation_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=500, detail="创建生成任务后无法读取任务状态。")
    return GenerationJobOut.model_validate(job)


@router.get("/current", response_model=GenerationJobOut | None)
def get_current_generation_job():
    job = generation_manager.get_current_job()
    return GenerationJobOut.model_validate(job) if job else None


@router.post("/{job_id}/pause", response_model=GenerationJobOut)
def pause_generation_job(job_id: int):
    job = generation_manager.pause_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="生成任务不存在。")
    return GenerationJobOut.model_validate(job)


@router.post("/{job_id}/resume", response_model=GenerationJobOut)
async def resume_generation_job(job_id: int):
    job = generation_manager.resume_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="生成任务不存在。")
    if job.status == "queued":
        await generation_manager.ensure_worker()
    return GenerationJobOut.model_validate(job)
