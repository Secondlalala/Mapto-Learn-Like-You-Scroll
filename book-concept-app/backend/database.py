from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import get_settings


settings = get_settings()
# SQLite 默认限制连接只能在创建它的线程中使用。FastAPI 会在线程池中执行
# 同步依赖，因此本地 SQLite 模式需要关闭该限制；换成其他数据库时不传此参数。
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    # 每个请求获得独立会话，并在响应结束后可靠关闭连接。
    # 路由只负责 commit 业务事务，不需要重复处理连接释放。
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # 延迟导入模型，确保 SQLAlchemy 已收集全部表定义后再建表。
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    # MVP 不引入完整迁移框架；仅对历史数据库补充向后兼容的新字段。
    _apply_lightweight_migrations()


def _apply_lightweight_migrations():
    # 先检查表和字段是否存在，使迁移可以在每次启动时幂等执行。
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
        # engine.begin 会将本轮 ALTER TABLE 放入同一个提交范围，发生异常时回滚。
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))
