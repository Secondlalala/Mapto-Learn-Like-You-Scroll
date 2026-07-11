from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import get_settings


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()


def _apply_lightweight_migrations():
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "books" not in table_names or "concept_cards" not in table_names:
        return

    book_columns = {column["name"] for column in inspector.get_columns("books")}
    card_columns = {column["name"] for column in inspector.get_columns("concept_cards")}
    statements = []
    if "generation_cursor" not in book_columns:
        statements.append("ALTER TABLE books ADD COLUMN generation_cursor INTEGER DEFAULT 0")
    if "section_index" not in card_columns:
        statements.append("ALTER TABLE concept_cards ADD COLUMN section_index INTEGER DEFAULT 0")
    if "card_type" not in card_columns:
        statements.append("ALTER TABLE concept_cards ADD COLUMN card_type VARCHAR(30) DEFAULT 'concept'")

    if statements:
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))
