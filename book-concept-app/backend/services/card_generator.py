from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from models import Book, ChatMessage, ConceptCard
from services.deepseek_client import DeepSeekClient


MAX_CARDS_PER_RUN = 20
MAX_SECTION_CHARS = 5200
MAX_SECTIONS_PER_RUN = 1


async def generate_cards_for_book(db: Session, book: Book, force: bool = False) -> tuple[int, bool, int, int]:
    if force:
        _delete_book_cards(db, book.id)
        book.generation_cursor = 0
        db.commit()

    client = DeepSeekClient()
    sections = _load_sections(book)
    generated = 0
    cursor = max(book.generation_cursor or 0, 0)
    processed_sections = 0

    while cursor < len(sections) and generated < MAX_CARDS_PER_RUN and processed_sections < MAX_SECTIONS_PER_RUN:
        section = sections[cursor]
        if _is_probably_front_matter(section["text"], section["chapter"]):
            cursor += 1
            book.generation_cursor = cursor
            db.commit()
            continue

        remaining = MAX_CARDS_PER_RUN - generated
        target_count = min(6, remaining)
        cards = await client.generate_cards_from_section(
            section_text=section["text"],
            section_title=section["chapter"],
            target_count=target_count,
            include_overview=not _section_has_overview(db, book.id, cursor),
        )
        processed_sections += 1

        saved = 0
        for card_data in cards:
            if generated >= MAX_CARDS_PER_RUN:
                break
            card = _build_card(book.id, cursor, section["chapter"], section["text"], card_data)
            if not _is_valid_card_title(card.title):
                continue
            db.add(card)
            generated += 1
            saved += 1

        cursor += 1
        book.generation_cursor = cursor
        db.commit()

        if saved == 0 and generated > 0:
            break

    done = cursor >= len(sections)
    return generated, done, cursor, len(sections)


def build_outline(book: Book, cards: list[ConceptCard] | None = None) -> list[dict]:
    sections = _load_sections(book)
    card_counts: dict[int, int] = {}
    if cards:
        for card in cards:
            card_counts[card.section_index] = card_counts.get(card.section_index, 0) + 1
    return [
        {
            "index": index,
            "title": _clean_title(section["chapter"]),
            "preview": _preview(section["text"]),
            "generated": index < (book.generation_cursor or 0),
            "card_count": card_counts.get(index, 0),
        }
        for index, section in enumerate(sections)
        if not _is_probably_front_matter(section["text"], section["chapter"])
    ]


def card_to_dict(card: ConceptCard) -> dict:
    return {
        "id": card.id,
        "book_id": card.book_id,
        "section_index": card.section_index,
        "card_type": card.card_type,
        "chapter": card.chapter,
        "title": card.title,
        "source_text": card.source_text,
        "one_sentence": card.one_sentence,
        "simple_explanation": card.simple_explanation,
        "fable": card.fable,
        "formula": card.formula,
        "formula_explanation": card.formula_explanation,
        "prerequisites": _loads_list(card.prerequisites),
        "related_concepts": _loads_list(card.related_concepts),
        "questions": _loads_list(card.questions),
        "is_favorite": card.is_favorite,
        "created_at": card.created_at,
    }


def _load_sections(book: Book) -> list[dict]:
    chunks = json.loads(book.chunks_json or "[]")
    sections: list[dict] = []
    for chunk in chunks:
        text = str(chunk.get("text", "")).strip()
        title = str(chunk.get("chapter", "") or "未命名小节").strip()
        if not text:
            continue
        for index, part in enumerate(_split_section(text), start=1):
            clean_title = _clean_title(title)
            part_title = clean_title if index == 1 else f"{clean_title}（续 {index}）"
            sections.append({"chapter": part_title, "text": part})
    return sections


def _split_section(text: str) -> list[str]:
    if len(text) <= MAX_SECTION_CHARS:
        return [text]
    pieces = []
    paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
    buf = ""
    for paragraph in paragraphs:
        if len(buf) + len(paragraph) + 2 > MAX_SECTION_CHARS and buf:
            pieces.append(buf.strip())
            buf = paragraph
        else:
            buf = f"{buf}\n\n{paragraph}".strip()
    if buf:
        pieces.append(buf.strip())
    return pieces


def _delete_book_cards(db: Session, book_id: int) -> None:
    card_ids = [row[0] for row in db.query(ConceptCard.id).filter(ConceptCard.book_id == book_id).all()]
    if card_ids:
        db.query(ChatMessage).filter(ChatMessage.card_id.in_(card_ids)).delete(synchronize_session=False)
        db.query(ConceptCard).filter(ConceptCard.book_id == book_id).delete(synchronize_session=False)


def _section_has_overview(db: Session, book_id: int, section_index: int) -> bool:
    return (
        db.query(ConceptCard)
        .filter(
            ConceptCard.book_id == book_id,
            ConceptCard.section_index == section_index,
            ConceptCard.card_type == "section_overview",
        )
        .first()
        is not None
    )


def _build_card(book_id: int, section_index: int, chapter: str, section_text: str, card_data: dict) -> ConceptCard:
    card_type = str(card_data.get("card_type") or "concept").strip()
    if card_type not in {"section_overview", "concept"}:
        card_type = "concept"
    source_text = str(card_data.get("source_text") or section_text[:1200]).strip()
    return ConceptCard(
        book_id=book_id,
        section_index=section_index,
        card_type=card_type,
        chapter=chapter,
        title=str(card_data.get("title") or "").strip(),
        source_text=source_text,
        one_sentence=str(card_data.get("one_sentence") or "").strip(),
        simple_explanation=str(card_data.get("simple_explanation") or "").strip(),
        fable=str(card_data.get("fable") or "").strip(),
        formula=str(card_data.get("formula") or "").strip(),
        formula_explanation=str(card_data.get("formula_explanation") or "").strip(),
        prerequisites=json.dumps(_as_str_list(card_data.get("prerequisites")), ensure_ascii=False),
        related_concepts=json.dumps(_as_str_list(card_data.get("related_concepts")), ensure_ascii=False),
        questions=json.dumps(_as_str_list(card_data.get("questions")), ensure_ascii=False),
    )


def _is_valid_card_title(title: str) -> bool:
    if len(title) < 2 or len(title) > 100:
        return False
    lowered = title.lower().strip()
    blocked = {"department", "contents", "recommended books", "resources", "http://www", "this", "there"}
    return lowered not in blocked and not lowered.startswith("http")


def _is_probably_front_matter(text: str, chapter: str) -> bool:
    chapter_lowered = chapter.lower().strip()
    if any(signal in chapter_lowered for signal in ["contents", "recommended", "resources", "acknowledgement", "bibliography", "references"]):
        return True
    lowered = f"{chapter}\n{text}".lower()
    url_count = lowered.count("http://") + lowered.count("https://") + lowered.count("www.")
    front_signals = ["contents", "recommended books", "department", "copyright", "references", "bibliography"]
    signal_count = sum(1 for signal in front_signals if signal in lowered)
    return url_count >= 1 and signal_count >= 1


def _preview(text: str) -> str:
    collapsed = " ".join(text.split())
    return collapsed[:120]


def _clean_title(title: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", str(title or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "未命名小节"


def _loads_list(value: str) -> list[str]:
    try:
        data = json.loads(value or "[]")
        return _as_str_list(data)
    except json.JSONDecodeError:
        return []


def _as_str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]
