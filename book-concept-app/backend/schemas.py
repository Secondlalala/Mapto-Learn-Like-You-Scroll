from datetime import datetime

from pydantic import BaseModel


class BookOut(BaseModel):
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


class ConceptCardOut(BaseModel):
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
