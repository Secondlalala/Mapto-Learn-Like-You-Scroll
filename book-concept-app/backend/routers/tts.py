from fastapi import APIRouter, HTTPException, Response

from schemas import SpeechIn, TTSPreloadOut
from services.tts_client import TTSNotConfiguredError, preload_tts, synthesize_speech


router = APIRouter(prefix="/api/tts", tags=["tts"])


@router.post("/speech")
async def speech(payload: SpeechIn):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="朗读文本不能为空。")
    # 服务层统一处理引擎选择、模型懒加载和磁盘缓存，路由只负责 HTTP 语义。
    try:
        audio, content_type, cache_hit = await synthesize_speech(text, speed=payload.speed)
    except TTSNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # X-TTS-Cache 便于前端和诊断工具确认本次是否直接复用了已生成音频。
    return Response(content=audio, media_type=content_type, headers={"X-TTS-Cache": "HIT" if cache_hit else "MISS"})


@router.post("/preload", response_model=TTSPreloadOut)
async def preload():
    # 预加载只初始化模型，不合成正文；用户可在开始阅读前主动消除首次等待。
    try:
        detail = await preload_tts()
    except TTSNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return TTSPreloadOut(status="ok", detail=detail)
