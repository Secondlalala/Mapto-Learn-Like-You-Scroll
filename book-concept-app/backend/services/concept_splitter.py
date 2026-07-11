from __future__ import annotations

import re
from dataclasses import dataclass


HEADING_RE = re.compile(
    r"^(#{1,6}\s+.+|第[一二三四五六七八九十百千万0-9]+[章节篇部].*|Chapter\s+\d+.*|Lecture\s+\d+.*)$",
    re.I,
)


@dataclass
class TextChunk:
    chapter: str
    text: str


def split_into_chunks(text: str, max_chars: int = 4200) -> list[dict]:
    current_chapter = "未命名章节"
    current_parts: list[str] = []
    chunks: list[TextChunk] = []

    def flush():
        nonlocal current_parts
        joined = "\n\n".join(part for part in current_parts if part.strip()).strip()
        if joined:
            for piece in _split_long_text(joined, max_chars):
                chunks.append(TextChunk(chapter=current_chapter, text=piece))
        current_parts = []

    blocks = re.split(r"\n\s*\n", text)
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) == 1 and HEADING_RE.match(lines[0]):
            flush()
            current_chapter = re.sub(r"^#{1,6}\s*", "", lines[0]).strip()
            continue
        current_parts.append(block.strip())
    flush()

    if not chunks and text.strip():
        chunks = [TextChunk(chapter=current_chapter, text=piece) for piece in _split_long_text(text, max_chars)]
    return [{"chapter": chunk.chapter, "text": chunk.text} for chunk in chunks]


def _split_long_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[。！？.!?])\s+", text)
    pieces: list[str] = []
    buf = ""
    for sentence in sentences:
        if len(buf) + len(sentence) + 1 > max_chars and buf:
            pieces.append(buf.strip())
            buf = sentence
        else:
            buf = f"{buf} {sentence}".strip()
    if buf:
        pieces.append(buf.strip())
    return pieces

