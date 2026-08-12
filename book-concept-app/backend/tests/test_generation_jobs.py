import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base


def test_generation_job_model_is_available():
    assert hasattr(models, "GenerationJob")


def test_generation_job_persists_queue_progress(tmp_path):
    job_model = getattr(models, "GenerationJob", None)
    assert job_model is not None

    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    job = job_model(
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

    reloaded = sessionmaker(bind=engine)().get(job_model, job_id)

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
