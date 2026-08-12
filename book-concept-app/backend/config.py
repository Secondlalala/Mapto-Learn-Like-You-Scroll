from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # DeepSeek 配置既可以来自项目根目录的 .env，也可以由运行时设置覆盖。
    # 默认不填写密钥，避免源码和安装包意外携带用户的私密凭据。
    deepseek_api_key: str = ""
    deepseek_api_base: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_mock: bool = False
    database_url: str = "sqlite:///./app.db"
    upload_dir: str = "uploads"
    frontend_origin: str = "http://localhost:5173"

    # TTS 配置统一描述浏览器、Kokoro、Sherpa 和兼容 HTTP 服务。
    # tts_device 使用 auto 时由后端探测 CUDA，无法使用 GPU 才回退 CPU。
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
    # 配置对象在进程内只创建一次，保证所有路由读取到一致的环境配置。
    # 网页中可修改的设置另存于 runtime_settings.json，不依赖重启后端。
    return Settings()
