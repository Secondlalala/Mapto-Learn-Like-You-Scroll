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
# 模型管线按“语言 + 设备”缓存；锁用于阻止多个请求同时重复加载同一份模型。
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
    # 输入先清洗特殊符号，再按句号拆句，降低长文本一次推理造成的停顿和显存峰值。
    sentences = _split_sentences(_sanitize_for_speech(payload.text))
    if not sentences:
        raise HTTPException(status_code=400, detail="朗读文本不能为空。")

    # auto 优先使用 CUDA；每句话再按中英文切段，为不同语言选择对应音色。
    requested_device = _resolve_device(payload.device)
    pieces: list[np.ndarray] = []
    for sentence in sentences:
        for segment_text, lang_code, voice in _segments_for_text(sentence, payload):
            pipeline = _get_pipeline(lang_code, requested_device)
            try:
                # 已由本层完成分句，因此禁用 Kokoro 内部分割，避免产生双重停顿。
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

    # 各句音频按顺序无缝拼接成标准 WAV，浏览器可直接播放并进行磁盘缓存。
    audio = np.concatenate(pieces).astype(np.float32)
    buffer = BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.post("/preload")
async def preload(payload: dict | None = None):
    # auto 语言会同时预热中文和英文管线，首次遇到混合文本时无需再次加载。
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
    # 为每段补回句号，让模型保留自然的句末语调。
    return [f"{item.strip()}。" for item in text.split("。") if item.strip()]


def _segments_for_text(text: str, payload: TTSRequest) -> list[tuple[str, str, str]]:
    # 指定语言时整句使用固定管线；auto 模式才逐字符识别中英文边界。
    lang_code = _normalize_lang_code(payload.lang_code)
    if lang_code != "auto":
        return [(text, lang_code, _voice_for_lang(lang_code, payload))]

    segments: list[tuple[str, str, str]] = []
    current_lang = "z" if _has_chinese(text[:1]) else "a"
    current = ""
    # 空格不触发语言切换，避免英文单词之间被拆成大量短音频。
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
    # 冒号、分号等统一为可控停顿，只保留中英文、数字、中文逗号和句号。
    # 此转换仅影响送入语音模型的副本，不修改页面显示的原始卡片内容。
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
    # 用户强制 CUDA 但环境不可用时安全回退 CPU，避免整个 TTS 接口直接崩溃。
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
    # 加载过程串行化；加载完成后后续请求直接复用内存中的 KPipeline。
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
    # 兼容 PyTorch Tensor 与 NumPy 数组，并统一成一维 float32 音频数据。
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    elif hasattr(audio, "cpu"):
        audio = audio.cpu().numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)
