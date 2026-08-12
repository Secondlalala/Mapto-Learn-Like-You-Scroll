from __future__ import annotations

import re
from dataclasses import dataclass


HEADING_RE = re.compile(
    # 同时识别 Markdown 标题、中文章节目次以及英文 Chapter/Lecture 标题。
    r"^(#{1,6}\s+.+|第[一二三四五六七八九十百千万0-9]+[章节篇部].*|Chapter\s+\d+.*|Lecture\s+\d+.*)$",
    re.I,
)


@dataclass
class TextChunk:
    chapter: str
    text: str


def split_into_chunks(text: str, max_chars: int = 4200) -> list[dict]:
    # current_chapter 保存最近一次识别到的标题，后续普通段落都归入该章节。
    current_chapter = "未命名章节"
    current_parts: list[str] = []
    chunks: list[TextChunk] = []

    def flush():
        nonlocal current_parts
        # 遇到新标题或文本结束时，将当前章节按长度落为一个或多个稳定片段。
        joined = "\n\n".join(part for part in current_parts if part.strip()).strip()
        if joined:
            for piece in _split_long_text(joined, max_chars):
                chunks.append(TextChunk(chapter=current_chapter, text=piece))
        current_parts = []

    # 先按空行划分自然段；只有“单独占一段”的标题才改变章节，减少正文误判。
    blocks = re.split(r"\n\s*\n", text)
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) == 1 and HEADING_RE.match(lines[0]):
            flush()
            current_chapter = re.sub(r"^#{1,6}\s*", "", lines[0]).strip()
            continue
        current_parts.append(block.strip())
    flush()

    # 没有识别到任何结构时仍按长度生成片段，保证普通 TXT 文件可用。
    if not chunks and text.strip():
        chunks = [TextChunk(chapter=current_chapter, text=piece) for piece in _split_long_text(text, max_chars)]
    return [{"chapter": chunk.chapter, "text": chunk.text} for chunk in chunks]


def _split_long_text(text: str, max_chars: int) -> list[str]:
    # 超长段落退化为按中英文句末标点切分，尽量保持完整句子进入同一请求。
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
