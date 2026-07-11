from pathlib import Path

import chardet


ALLOWED_EXTENSIONS = {".md", ".txt"}


def validate_book_file(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("仅支持 .md 和 .txt 文件")
    return ext.lstrip(".")


def read_text_file(path: Path) -> str:
    data = path.read_bytes()
    detected = chardet.detect(data)
    encoding = detected.get("encoding") or "utf-8"
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="ignore")
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()

