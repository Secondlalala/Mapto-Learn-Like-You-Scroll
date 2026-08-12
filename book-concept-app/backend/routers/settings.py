from fastapi import APIRouter

from schemas import DeepSeekSettingsIn, DeepSeekSettingsOut, TTSSettingsIn, TTSSettingsOut
from services.runtime_settings import get_deepseek_config, get_tts_config, masked_key, update_runtime_settings


router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/deepseek", response_model=DeepSeekSettingsOut)
def get_deepseek_settings():
    config = get_deepseek_config()
    # 接口只返回掩码后的密钥，设置页面能够确认已配置，但无法读取完整 API Key。
    return DeepSeekSettingsOut(
        configured=bool(config["api_key"]),
        api_key_masked=masked_key(config["api_key"]),
        api_base=config["api_base"],
        model=config["model"],
        mock=config["mock"],
    )


@router.put("/deepseek", response_model=DeepSeekSettingsOut)
def update_deepseek_settings(payload: DeepSeekSettingsIn):
    updates = {
        "deepseek_api_base": payload.api_base,
        "deepseek_model": payload.model,
        "deepseek_mock": payload.mock,
    }
    # 密钥输入留空表示保留旧值，防止用户只调整模型名称时意外清空密钥。
    if payload.api_key and payload.api_key.strip():
        updates["deepseek_api_key"] = payload.api_key.strip()
    update_runtime_settings(updates)
    return get_deepseek_settings()


@router.get("/tts", response_model=TTSSettingsOut)
def get_tts_settings():
    config = get_tts_config()
    return TTSSettingsOut(**config)


@router.put("/tts", response_model=TTSSettingsOut)
def update_tts_settings(payload: TTSSettingsIn):
    # 所有可选字段由服务层过滤 None，因此可以只提交语速等单项设置。
    update_runtime_settings(
        {
            "tts_enabled": payload.enabled,
            "tts_api_url": payload.api_url,
            "tts_api_style": payload.api_style,
            "tts_voice": payload.voice,
            "tts_english_voice": payload.english_voice,
            "tts_model": payload.model,
            "tts_lang_code": payload.lang_code,
            "tts_device": payload.device,
            "tts_speed": payload.speed,
        }
    )
    return get_tts_settings()
