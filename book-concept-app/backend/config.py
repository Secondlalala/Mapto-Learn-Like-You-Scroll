from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    deepseek_api_base: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_mock: bool = False
    database_url: str = "sqlite:///./app.db"
    upload_dir: str = "uploads"
    frontend_origin: str = "http://localhost:5173"
    tts_enabled: bool = True
    tts_api_url: str = "http://127.0.0.1:9977/tts"
    tts_api_style: str = "kokoro"
    tts_voice: str = "zf_xiaoxiao"
    tts_english_voice: str = "af_heart"
    tts_model: str = "kokoro-82m"
    tts_lang_code: str = "z"
    tts_device: str = "auto"
    tts_speed: float = 0.8

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
