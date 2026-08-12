from datetime import datetime

from pydantic import BaseModel


class BookOut(BaseModel):
    # 书籍列表仅暴露元数据和生成进度，不把体积较大的 raw_text 返回给浏览器。
    id: int
    title: str
    filename: str
    file_type: str
    created_at: datetime
    card_count: int = 0
    generation_cursor: int = 0

    model_config = {"from_attributes": True}


class UploadOut(BaseModel):
    book_id: int
    title: str
    message: str


class GenerateCardsOut(BaseModel):
    book_id: int
    generated: int
    message: str
    done: bool = False
    cursor: int = 0
    total_sections: int = 0


class GenerationJobOut(BaseModel):
    id: int
    scope: str
    book_ids_json: str
    status: str
    current_book_id: int | None = None
    current_book_position: int = 0
    processed_sections: int = 0
    total_sections: int = 0
    generated_cards: int = 0
    message: str = ""
    error: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConceptCardOut(BaseModel):
    # 数据库中的三个 JSON 文本列表在服务层还原后，以强类型数组交给前端。
    id: int
    book_id: int
    section_index: int = 0
    card_type: str = "concept"
    chapter: str
    title: str
    source_text: str
    one_sentence: str
    simple_explanation: str
    fable: str
    formula: str
    formula_explanation: str
    prerequisites: list[str]
    related_concepts: list[str]
    questions: list[str]
    is_favorite: bool
    created_at: datetime


class FavoriteOut(BaseModel):
    card_id: int
    is_favorite: bool


class ChatIn(BaseModel):
    question: str


class ChatOut(BaseModel):
    answer: str


class ChatMessageOut(BaseModel):
    id: int
    card_id: int
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DeepSeekSettingsIn(BaseModel):
    # 设置字段允许局部更新；None 表示本次请求不改变该项。
    api_key: str | None = None
    api_base: str | None = None
    model: str | None = None
    mock: bool | None = None


class DeepSeekSettingsOut(BaseModel):
    configured: bool
    api_key_masked: str
    api_base: str
    model: str
    mock: bool


class TTSSettingsIn(BaseModel):
    enabled: bool | None = None
    api_url: str | None = None
    api_style: str | None = None
    voice: str | None = None
    english_voice: str | None = None
    model: str | None = None
    lang_code: str | None = None
    device: str | None = None
    speed: float | None = None


class TTSSettingsOut(BaseModel):
    enabled: bool
    api_url: str
    api_style: str
    voice: str
    english_voice: str
    model: str
    lang_code: str
    device: str
    speed: float


class SpeechIn(BaseModel):
    # 单次朗读允许覆盖全局语速，便于用户调节后立即试听而无需重启模型。
    text: str
    speed: float | None = None


class TTSPreloadOut(BaseModel):
    status: str
    detail: str


class OutlineItemOut(BaseModel):
    index: int
    title: str
    preview: str
    generated: bool
    card_count: int
