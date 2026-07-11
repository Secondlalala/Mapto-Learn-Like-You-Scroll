from __future__ import annotations

import re
from io import BytesIO
from threading import Lock

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel


app = FastAPI(title="Local Kokoro TTS Service")

_pipelines: dict[tuple[str, str], object] = {}
_pipeline_lock = Lock()
_load_error = ""
SAMPLE_RATE = 24000
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")
SPEECH_SYMBOL_RE = re.compile(r"[“”„‟\"＂‘’‚‛'＇()（）\[\]【】{}｛｝<>《》〈〉|｜*_#`~^/@\\+=\-—–…·•]")


class TTSRequest(BaseModel):
    text: str
    voice: str | None = "zf_xiaoxiao"
    english_voice: str | None = "af_heart"
    model: str | None = "kokoro-82m"
    lang_code: str | None = "auto"
    device: str | None = "auto"
    speed: float | None = 1.0
    stream: bool | None = False


@app.get("/health")
def health():
    auto_device = _resolve_device("auto")
    return {
        "status": "ok" if not _load_error else "error",
        "engine": "kokoro",
        "loaded_pipelines": [{"lang_code": lang, "device": device} for lang, device in sorted(_pipelines.keys())],
        "default_lang_code": "auto",
        "supported_lang_codes": ["auto", "z", "zh", "a", "b"],
        "default_device": "auto",
        "resolved_auto_device": auto_device,
        "default_chinese_voice": "zf_xiaoxiao",
        "default_english_voice": "af_heart",
        "chinese_device": auto_device,
        "english_device": auto_device,
        "torch": _torch_status(),
        "error": _load_error,
    }


@app.post("/tts")
async def tts(payload: TTSRequest):
    sentences = _split_sentences(_sanitize_for_speech(payload.text))
    if not sentences:
        raise HTTPException(status_code=400, detail="朗读文本不能为空。")

    requested_device = _resolve_device(payload.device)
    pieces: list[np.ndarray] = []
    for sentence in sentences:
        for segment_text, lang_code, voice in _segments_for_text(sentence, payload):
            pipeline = _get_pipeline(lang_code, requested_device)
            try:
                generator = pipeline(
                    segment_text,
                    voice=voice,
                    speed=payload.speed or 1.0,
                    split_pattern=r"$^",
                )
                pieces.extend(_to_numpy(result.audio) for result in generator if getattr(result, "audio", None) is not None)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Kokoro 推理失败：{type(exc).__name__}: {exc}") from exc

    if not pieces:
        raise HTTPException(status_code=500, detail="Kokoro 没有返回音频。")

    audio = np.concatenate(pieces).astype(np.float32)
    buffer = BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.post("/preload")
async def preload(payload: dict | None = None):
    payload = payload or {}
    requested_device = _resolve_device(payload.get("device", "auto"))
    lang_code = _normalize_lang_code(payload.get("lang_code", "auto"))
    lang_codes = ["z", "a"] if lang_code == "auto" else [lang_code]
    for code in lang_codes:
        _get_pipeline(code, requested_device)
    return {
        "status": "ok",
        "device": requested_device,
        "lang_code": lang_code,
        "loaded_pipelines": [{"lang_code": lang, "device": device} for lang, device in sorted(_pipelines.keys())],
    }


def _split_sentences(text: str) -> list[str]:
    return [f"{item.strip()}。" for item in text.split("。") if item.strip()]


def _segments_for_text(text: str, payload: TTSRequest) -> list[tuple[str, str, str]]:
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


def _voice_for_lang(lang_code: str, payload: TTSRequest) -> str:
    if lang_code == "z":
        return payload.voice or "zf_xiaoxiao"
    return payload.english_voice or "af_heart"


def _has_chinese(text: str) -> bool:
    return bool(CHINESE_RE.search(text))


def _sanitize_for_speech(text: str) -> str:
    cleaned = str(text or "")
    cleaned = re.sub(r"[，,、]", "，", cleaned)
    cleaned = re.sub(r"[。.!?！？；;：:\n\r]+", "。", cleaned)
    cleaned = SPEECH_SYMBOL_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[^\w\u3400-\u9fff，。\s]", " ", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s*，\s*", "，", cleaned)
    cleaned = re.sub(r"\s*。\s*", "。", cleaned)
    cleaned = re.sub(r"，+", "，", cleaned)
    cleaned = re.sub(r"。+", "。", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _resolve_device(device: str | None) -> str:
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
    global _load_error
    key = (lang_code, device)
    with _pipeline_lock:
        if key in _pipelines:
            return _pipelines[key]
        try:
            from kokoro import KPipeline

            pipeline = KPipeline(lang_code=lang_code, device=device)
            _pipelines[key] = pipeline
            _load_error = ""
            return pipeline
        except Exception as exc:
            _load_error = f"{type(exc).__name__}: {exc}"
            raise HTTPException(status_code=503, detail=f"Kokoro 未就绪：{_load_error}") from exc


def _to_numpy(audio) -> np.ndarray:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    elif hasattr(audio, "cpu"):
        audio = audio.cpu().numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)
