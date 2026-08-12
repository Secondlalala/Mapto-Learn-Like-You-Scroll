from pathlib import Path

import chardet


ALLOWED_EXTENSIONS = {".md", ".txt"}


def validate_book_file(filename: str) -> str:
    # 扩展名统一转小写，允许用户上传 BOOK.MD 等大小写不同的文件名。
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("仅支持 .md 和 .txt 文件")
    return ext.lstrip(".")


def read_text_file(path: Path) -> str:
    # 先读取原始字节并通过 chardet 猜测编码，兼容 UTF-8、GBK 等常见电子书文本。
    data = path.read_bytes()
    detected = chardet.detect(data)
    encoding = detected.get("encoding") or "utf-8"
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError:
        # 探测结果不可靠时回退 UTF-8 容错解码，避免单个坏字节导致整本书无法上传。
        text = data.decode("utf-8", errors="ignore")
    # 统一 Windows、Linux 和旧式 Mac 换行，后续章节切分不再依赖操作系统格式。
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()
