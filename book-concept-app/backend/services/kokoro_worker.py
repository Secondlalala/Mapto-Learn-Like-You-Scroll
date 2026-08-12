from __future__ import annotations

import base64
import contextlib
import json
import re
import sys
from io import BytesIO
from threading import Lock

import numpy as np
import soundfile as sf


_pipelines: dict[tuple[str, str], object] = {}
_lock = Lock()
SAMPLE_RATE = 24000
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")
SPEECH_SYMBOL_RE = re.compile(r"[“”„\"‘’'（）()\[\]【】{}《》〈〉<>_#`~^/@\\+=\-—–•·]")


def main() -> None:
    # worker 使用“一行一个 JSON”的协议与主进程通信，模型可常驻并跨请求复用。
    for line in sys.stdin:
        try:
            payload = json.loads(line)
            op = payload.get("op")
            if op == "health":
                result = health()
            elif op == "preload":
                result = preload(payload)
            elif op == "tts":
                result = tts(payload)
            else:
                result = {"ok": False, "error": f"未知操作：{op}"}
        except Exception as exc:
            result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        # stdout 只输出协议响应；模型自身日志被重定向到 stderr，避免污染 JSON。
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def health() -> dict:
    device = _resolve_device("auto")
    return {
        "ok": True,
        "engine": "kokoro-worker",
        "device": device,
        "loaded_pipelines": [{"lang_code": lang, "device": item_device} for lang, item_device in sorted(_pipelines.keys())],
        "torch": _torch_status(),
    }


def preload(payload: dict) -> dict:
    # 预加载只构建管线，不产生音频；auto 模式同时准备中英文模型。
    requested_device = _resolve_device(payload.get("device", "auto"))
    lang_code = _normalize_lang_code(payload.get("lang_code", "auto"))
    lang_codes = ["z", "a"] if lang_code == "auto" else [lang_code]
    for code in lang_codes:
        _get_pipeline(code, requested_device)
    return {
        "ok": True,
        "device": requested_device,
        "lang_code": lang_code,
        "loaded_pipelines": [{"lang_code": lang, "device": item_device} for lang, item_device in sorted(_pipelines.keys())],
    }


def tts(payload: dict) -> dict:
    # 长文本先按句号拆分，再按语言分段，逐段推理后拼接成一个 WAV 响应。
    sentences = _split_sentences(_sanitize_for_speech(payload.get("text", "")))
    if not sentences:
        return {"ok": False, "error": "朗读文本不能为空。"}

    requested_device = _resolve_device(payload.get("device", "auto"))
    request = TTSLike(payload)
    pieces: list[np.ndarray] = []
    for sentence in sentences:
        for segment_text, lang_code, voice in _segments_for_text(sentence, request):
            pipeline = _get_pipeline(lang_code, requested_device)
            # Kokoro 可能向 stdout 打印下载进度，必须重定向以保护进程通信协议。
            with contextlib.redirect_stdout(sys.stderr):
                generator = pipeline(
                    segment_text,
                    voice=voice,
                    speed=request.speed,
                    split_pattern=r"$^",
                )
                pieces.extend(_to_numpy(result.audio) for result in generator if getattr(result, "audio", None) is not None)

    if not pieces:
        return {"ok": False, "error": "Kokoro 没有返回音频。"}

    # 音频以 Base64 放入 JSON 返回；主进程解码后再写入缓存或交给浏览器。
    audio = np.concatenate(pieces).astype(np.float32)
    buffer = BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
    return {
        "ok": True,
        "content_type": "audio/wav",
        "audio": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


class TTSLike:
    def __init__(self, payload: dict):
        self.voice = payload.get("voice") or "zf_xiaoxiao"
        self.english_voice = payload.get("english_voice") or "af_heart"
        self.lang_code = payload.get("lang_code") or "auto"
        self.speed = float(payload.get("speed") or 1.0)


def _split_sentences(text: str) -> list[str]:
    return [f"{item.strip()}。" for item in text.split("。") if item.strip()]


def _segments_for_text(text: str, payload: TTSLike) -> list[tuple[str, str, str]]:
    # 中文使用 z 管线和中文音色，英文使用 a/b 管线和独立英文音色。
    lang_code = _normalize_lang_code(payload.lang_code)
    if lang_code != "auto":
        return [(text, lang_code, _voice_for_lang(lang_code, payload))]

    segments: list[tuple[str, str, str]] = []
    current_lang = "z" if _has_chinese(text[:1]) else "a"
    current = ""
    for char in text:
        char_lang = "z" if _has_chinese(char) else "a"
        if current and char_lang != current_lang and not char.isspace():
            if current.strip():
                segments.append((current.strip(), current_lang, _voice_for_lang(current_lang, payload)))
            current = char
            current_lang = char_lang
        else:
            current += char
    if current.strip():
        segments.append((current.strip(), current_lang, _voice_for_lang(current_lang, payload)))
    return segments


def _normalize_lang_code(lang_code: str | None) -> str:
    value = (lang_code or "auto").strip().lower()
    aliases = {"zh": "z", "cn": "z", "mandarin": "z", "en": "a", "us": "a", "american": "a", "uk": "b", "british": "b"}
    value = aliases.get(value, value)
    if value not in {"auto", "z", "a", "b"}:
        return "auto"
    return value


def _voice_for_lang(lang_code: str, payload: TTSLike) -> str:
    if lang_code == "z":
        return payload.voice
    return payload.english_voice


def _has_chinese(text: str) -> bool:
    return bool(CHINESE_RE.search(text))


def _sanitize_for_speech(text: str) -> str:
    # 清洗规则与 HTTP 服务保持一致，确保两种部署路径得到相同停顿和发音。
    cleaned = str(text or "")
    cleaned = re.sub(r"[，、]", "，", cleaned)
    cleaned = re.sub(r"[：:]", "，", cleaned)
    cleaned = re.sub(r"[。.!?！？；;\n\r]+", "。", cleaned)
    cleaned = SPEECH_SYMBOL_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[^\w\u3400-\u9fff，。\s]", " ", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s*，\s*", "，", cleaned)
    cleaned = re.sub(r"\s*。\s*", "。", cleaned)
    cleaned = re.sub(r"，+", "，", cleaned)
    cleaned = re.sub(r"。+", "。", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _resolve_device(device: str | None) -> str:
    # auto 优先选择可用的 NVIDIA CUDA；显卡不可用时回退 CPU 保持功能可用。
    value = (device or "auto").strip().lower()
    if value in {"cpu", "cuda"}:
        if value == "cuda" and not _cuda_available():
            return "cpu"
        return value
    return "cuda" if _cuda_available() else "cpu"


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _torch_status() -> dict:
    try:
        import torch

        return {
            "version": torch.__version__,
            "cuda_available": bool(torch.cuda.is_available()),
            "cuda_version": torch.version.cuda,
            "device_count": torch.cuda.device_count(),
            "devices": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
        }
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


def _get_pipeline(lang_code: str, device: str):
    key = (lang_code, device)
    # 同一进程只加载一份相同语言和设备的模型，锁避免并发初始化耗尽显存。
    with _lock:
        if key in _pipelines:
            return _pipelines[key]
        with contextlib.redirect_stdout(sys.stderr):
            from kokoro import KPipeline

            pipeline = KPipeline(lang_code=lang_code, device=device)
        _pipelines[key] = pipeline
        return pipeline


def _to_numpy(audio) -> np.ndarray:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    elif hasattr(audio, "cpu"):
        audio = audio.cpu().numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)


if __name__ == "__main__":
    main()
