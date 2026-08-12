from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from models import Book, ChatMessage, ConceptCard


BOOK_COLUMNS = (
    "id",
    "title",
    "filename",
    "file_type",
    "raw_text",
    "chunks_json",
    "generation_cursor",
    "created_at",
)
CARD_COLUMNS = (
    "id",
    "book_id",
    "section_index",
    "card_type",
    "chapter",
    "title",
    "source_text",
    "one_sentence",
    "simple_explanation",
    "fable",
    "formula",
    "formula_explanation",
    "prerequisites",
    "related_concepts",
    "questions",
    "is_favorite",
    "created_at",
)
MESSAGE_COLUMNS = ("id", "card_id", "role", "content", "created_at")
REQUIRED_COLUMNS = {
    "books": set(BOOK_COLUMNS),
    "concept_cards": set(CARD_COLUMNS),
    "chat_messages": set(MESSAGE_COLUMNS),
}


class ImportValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ImportResult:
    book_ids: list[int]
    books: int
    cards: int
    messages: int


def import_database_file(db: Session, source_path: Path) -> ImportResult:
    # 外部数据库是不可信输入，只读打开并在任何目标写入前完成结构及关联校验。
    source = _open_readonly(source_path)
    try:
        _validate_schema(source)
        books = _read_rows(source, "books", BOOK_COLUMNS)
        cards = _read_rows(source, "concept_cards", CARD_COLUMNS)
        messages = _read_rows(source, "chat_messages", MESSAGE_COLUMNS)
        _validate_relationships(books, cards, messages)

        book_id_map: dict[int, int] = {}
        imported_book_ids: list[int] = []
        for row in books:
            copied_book = Book(
                title=_required_text(row, "title", "书籍标题"),
                filename=_required_text(row, "filename", "书籍文件名"),
                file_type=_required_text(row, "file_type", "书籍类型"),
                raw_text=str(row["raw_text"] or ""),
                chunks_json=_normalize_chunks(row["chunks_json"]),
                generation_cursor=max(_as_int(row["generation_cursor"]), 0),
                created_at=_parse_datetime(row["created_at"]),
            )
            db.add(copied_book)
            db.flush()
            book_id_map[_as_int(row["id"])] = copied_book.id
            imported_book_ids.append(copied_book.id)

        card_id_map: dict[int, int] = {}
        for row in cards:
            copied_card = ConceptCard(
                book_id=book_id_map[_as_int(row["book_id"])],
                section_index=max(_as_int(row["section_index"]), 0),
                card_type=str(row["card_type"] or "concept"),
                chapter=str(row["chapter"] or ""),
                title=_required_text(row, "title", "卡片标题"),
                source_text=str(row["source_text"] or ""),
                one_sentence=str(row["one_sentence"] or ""),
                simple_explanation=str(row["simple_explanation"] or ""),
                fable=str(row["fable"] or ""),
                formula=str(row["formula"] or ""),
                formula_explanation=str(row["formula_explanation"] or ""),
                prerequisites=_normalize_json_array(row["prerequisites"]),
                related_concepts=_normalize_json_array(row["related_concepts"]),
                questions=_normalize_json_array(row["questions"]),
                is_favorite=bool(row["is_favorite"]),
                created_at=_parse_datetime(row["created_at"]),
            )
            db.add(copied_card)
            db.flush()
            card_id_map[_as_int(row["id"])] = copied_card.id

        for row in messages:
            db.add(
                ChatMessage(
                    card_id=card_id_map[_as_int(row["card_id"])],
                    role=_required_text(row, "role", "追问角色"),
                    content=str(row["content"] or ""),
                    created_at=_parse_datetime(row["created_at"]),
                )
            )
        db.flush()
        return ImportResult(
            book_ids=imported_book_ids,
            books=len(books),
            cards=len(cards),
            messages=len(messages),
        )
    finally:
        source.close()


def _open_readonly(source_path: Path) -> sqlite3.Connection:
    source: sqlite3.Connection | None = None
    try:
        source = sqlite3.connect(f"file:{source_path.resolve().as_posix()}?mode=ro", uri=True)
        source.row_factory = sqlite3.Row
        # 强制读取数据库头和 schema；sqlite3.connect 本身不会验证文件内容。
        source.execute("SELECT name FROM sqlite_master LIMIT 1").fetchall()
        return source
    except (OSError, sqlite3.DatabaseError) as exc:
        if source is not None:
            source.close()
        raise ImportValidationError("文件不是有效的 SQLite 数据库。") from exc


def _validate_schema(source: sqlite3.Connection) -> None:
    try:
        table_names = {
            row[0]
            for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        missing_tables = set(REQUIRED_COLUMNS) - table_names
        if missing_tables:
            raise ImportValidationError(f"数据库缺少必需数据表：{', '.join(sorted(missing_tables))}。")

        for table_name, expected_columns in REQUIRED_COLUMNS.items():
            actual_columns = {
                row[1] for row in source.execute(f'PRAGMA table_info("{table_name}")').fetchall()
            }
            missing_columns = expected_columns - actual_columns
            if missing_columns:
                raise ImportValidationError(
                    f"数据表 {table_name} 缺少字段：{', '.join(sorted(missing_columns))}。"
                )
    except sqlite3.DatabaseError as exc:
        raise ImportValidationError("无法读取 SQLite 数据库结构。") from exc


def _read_rows(source: sqlite3.Connection, table_name: str, columns: tuple[str, ...]) -> list[sqlite3.Row]:
    quoted_columns = ", ".join(f'"{column}"' for column in columns)
    try:
        return source.execute(
            f'SELECT {quoted_columns} FROM "{table_name}" ORDER BY "id" ASC'
        ).fetchall()
    except sqlite3.DatabaseError as exc:
        raise ImportValidationError(f"无法读取数据表 {table_name}。") from exc


def _validate_relationships(books, cards, messages) -> None:
    book_ids = {_as_int(row["id"]) for row in books}
    card_ids = {_as_int(row["id"]) for row in cards}
    if any(_as_int(row["book_id"]) not in book_ids for row in cards):
        raise ImportValidationError("数据库中存在不属于任何书籍的卡片。")
    if any(_as_int(row["card_id"]) not in card_ids for row in messages):
        raise ImportValidationError("数据库中存在不属于任何卡片的追问记录。")


def _required_text(row: sqlite3.Row, key: str, label: str) -> str:
    value = str(row[key] or "").strip()
    if not value:
        raise ImportValidationError(f"{label}不能为空。")
    return value


def _normalize_chunks(value) -> str:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        return "[]"
    return json.dumps(parsed if isinstance(parsed, list) else [], ensure_ascii=False)


def _normalize_json_array(value) -> str:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        parsed = []
    return json.dumps(parsed if isinstance(parsed, list) else [], ensure_ascii=False)


def _parse_datetime(value) -> datetime:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def _as_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
