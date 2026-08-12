from __future__ import annotations

import json
from pathlib import Path

from config import get_settings


SETTINGS_PATH = Path(__file__).resolve().parents[1] / "runtime_settings.json"


def read_runtime_settings() -> dict:
    if not SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def update_runtime_settings(values: dict) -> dict:
    current = read_runtime_settings()
    current.update({key: value for key, value in values.items() if value is not None})
    SETTINGS_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current


def get_deepseek_config() -> dict:
    env = get_settings()
    runtime = read_runtime_settings()
    api_key = runtime.get("deepseek_api_key") or env.deepseek_api_key
    api_base = runtime.get("deepseek_api_base") or env.deepseek_api_base
    model = runtime.get("deepseek_model") or env.deepseek_model
    mock = bool(runtime.get("deepseek_mock", env.deepseek_mock))
    return {
        "api_key": api_key,
        "api_base": api_base,
        "model": model,
        "mock": mock,
    }


def get_tts_config() -> dict:
    env = get_settings()
    runtime = read_runtime_settings()
    api_style = runtime.get("tts_api_style") or env.tts_api_style
    lang_code = runtime.get("tts_lang_code") or env.tts_lang_code or "z"
    if api_style == "kokoro" and lang_code == "auto":
        lang_code = "z"
    return {
        "enabled": bool(runtime.get("tts_enabled", env.tts_enabled)),
        "api_url": runtime.get("tts_api_url") or env.tts_api_url,
        "api_style": api_style,
        "voice": runtime.get("tts_voice") or env.tts_voice,
        "english_voice": runtime.get("tts_english_voice") or env.tts_english_voice,
        "model": runtime.get("tts_model") or env.tts_model,
        "lang_code": lang_code,
        "device": runtime.get("tts_device") or env.tts_device,
        "speed": float(runtime.get("tts_speed", env.tts_speed)),
    }


def masked_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}****{api_key[-4:]}"
