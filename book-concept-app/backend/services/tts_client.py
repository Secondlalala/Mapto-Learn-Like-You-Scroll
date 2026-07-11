from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import httpx

from services.runtime_settings import get_tts_config


class TTSNotConfiguredError(RuntimeError):
    pass


CACHE_DIR = Path(__file__).resolve().parents[1] / "tts_cache"


async def synthesize_speech(text: str, speed: float | None = None) -> tuple[bytes, str, bool]:
    config = get_tts_config()
    if not config["enabled"]:
        raise TTSNotConfiguredError("TTS 未启用。")
    if config["api_style"] == "browser":
        raise TTSNotConfiguredError("当前设置为浏览器 TTS，不需要调用后端语音服务。")

    payload = _build_payload(text, config, speed=speed)
    cache_key = _cache_key(payload, config)
    cache_path = CACHE_DIR / f"{cache_key}.wav"
    if cache_path.exists():
        return cache_path.read_bytes(), "audio/wav", True

    if config["api_style"] == "kokoro":
        from services.kokoro_worker_client import KokoroWorkerError, preload, synthesize

        try:
            preload({"device": config.get("device", "auto"), "lang_code": config.get("lang_code", "z")})
            audio, content_type = synthesize(payload)
        except KokoroWorkerError as exc:
            raise RuntimeError(str(exc)) from exc
        _write_cache(cache_path, audio, content_type)
        return audio, content_type, False

    if not config["api_url"]:
        raise TTSNotConfiguredError("请先配置 TTS 服务地址。")

    response = await _post_tts(config, payload)
    content_type = response.headers.get("content-type", "audio/wav").split(";")[0]
    if content_type.startswith("audio/"):
        audio = response.content
        _write_cache(cache_path, audio, content_type)
        return audio, content_type, False

    data = response.json()
    audio_base64 = data.get("audio") or data.get("audio_base64") or data.get("data") or data.get("wav")
    if isinstance(audio_base64, str) and audio_base64:
        if "," in audio_base64 and audio_base64.startswith("data:"):
            header, audio_base64 = audio_base64.split(",", 1)
            content_type = header.split(";")[0].removeprefix("data:") or "audio/wav"
        audio = base64.b64decode(audio_base64)
        _write_cache(cache_path, audio, content_type)
        return audio, content_type or "audio/wav", False

    raise RuntimeError(f"TTS 返回格式无法识别：{response.text[:300]}")


async def preload_tts() -> str:
    config = get_tts_config()
    if not config["enabled"]:
        raise TTSNotConfiguredError("TTS 未启用。")
    if config["api_style"] == "browser":
        return "浏览器 TTS 不需要预加载模型。"
    if config["api_style"] != "kokoro":
        return "当前 TTS 服务不是 Kokoro，本地预加载已跳过。"

    from services.kokoro_worker_client import KokoroWorkerError, preload

    try:
        data = preload({"device": config.get("device", "auto"), "lang_code": config.get("lang_code", "z")})
    except KokoroWorkerError as exc:
        raise RuntimeError(str(exc)) from exc
    loaded = data.get("loaded_pipelines") or []
    if loaded:
        summary = "，".join(f"{item.get('lang_code')}:{item.get('device')}" for item in loaded)
        return f"Kokoro 模型已加载：{summary}。"
    return "Kokoro 模型已启动。"


def _build_payload(text: str, config: dict, speed: float | None = None) -> dict:
    clean_text = text.strip()
    resolved_speed = _clamp_speed(speed if speed is not None else config.get("speed", 0.8))
    if config["api_style"] == "openai":
        return {
            "model": config["model"],
            "input": clean_text,
            "voice": config["voice"],
            "response_format": "mp3",
            "speed": resolved_speed,
        }
    return {
        "text": clean_text,
        "prompt": clean_text,
        "voice": config["voice"],
        "english_voice": config.get("english_voice", "af_heart"),
        "model": config["model"],
        "lang_code": config.get("lang_code", "z"),
        "device": config.get("device", "auto"),
        "speed": resolved_speed,
        "stream": False,
    }


def _clamp_speed(value: float | str | None) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.8
    return min(2.0, max(0.2, parsed))


async def _post_tts(config: dict, payload: dict, path: str | None = None) -> httpx.Response:
    url = _service_url(config, path)
    async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
        try:
            response = await client.post(url, json=payload)
            if response.status_code >= 400:
                raise RuntimeError(f"TTS 服务返回错误：HTTP {response.status_code} {response.text[:300]}")
            return response
        except httpx.TimeoutException as exc:
            raise RuntimeError("TTS 生成超时，请稍后重试或缩短朗读文本。") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"TTS 服务连接失败：{exc}") from exc


def _service_url(config: dict, path: str | None) -> str:
    if not path:
        return config["api_url"]
    base = config["api_url"].rsplit("/", 1)[0]
    return f"{base}{path}"


def _cache_key(payload: dict, config: dict) -> str:
    material = {"style": config.get("api_style"), "url": config.get("api_url"), "payload": payload}
    raw = json.dumps(material, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _write_cache(cache_path: Path, audio: bytes, content_type: str) -> None:
    if not audio or not content_type.startswith("audio/"):
        return
    CACHE_DIR.mkdir(exist_ok=True)
    cache_path.write_bytes(audio)
