from __future__ import annotations

import io
import os
import re
import shutil
import tarfile
import threading
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf


MODEL_ROOT = Path(__file__).resolve().parents[1] / "tts_models" / "sherpa"
MODEL_RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
DEFAULT_CHINESE_MODEL = "zh_CN-xiao_ya-medium"
DEFAULT_ENGLISH_MODEL = "en_US-lessac-medium"


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    archive_name: str
    directory_name: str
    model_name: str
    language: str
    use_lexicon: bool = False
    use_espeak_data: bool = False

    @property
    def archive_url(self) -> str:
        return f"{MODEL_RELEASE_BASE}/{self.archive_name}"


MODEL_SPECS = {
    DEFAULT_CHINESE_MODEL: ModelSpec(
        model_id=DEFAULT_CHINESE_MODEL,
        archive_name="vits-piper-zh_CN-xiao_ya-medium.tar.bz2",
        directory_name="vits-piper-zh_CN-xiao_ya-medium",
        model_name="zh_CN-xiao_ya-medium.onnx",
        language="zh",
        use_lexicon=True,
    ),
    "zh_CN-chaowen-medium": ModelSpec(
        model_id="zh_CN-chaowen-medium",
        archive_name="vits-piper-zh_CN-chaowen-medium.tar.bz2",
        directory_name="vits-piper-zh_CN-chaowen-medium",
        model_name="zh_CN-chaowen-medium.onnx",
        language="zh",
        use_lexicon=True,
    ),
    DEFAULT_ENGLISH_MODEL: ModelSpec(
        model_id=DEFAULT_ENGLISH_MODEL,
        archive_name="vits-piper-en_US-lessac-medium.tar.bz2",
        directory_name="vits-piper-en_US-lessac-medium",
        model_name="en_US-lessac-medium.onnx",
        language="en",
        use_espeak_data=True,
    ),
}

_instances: dict[str, object] = {}
_instance_lock = threading.RLock()
_generation_lock = threading.Lock()


def preload(chinese_model: str, english_model: str) -> list[str]:
    loaded = []
    for model_id in (chinese_model, english_model):
        _get_tts(model_id)
        loaded.append(model_id)
    return loaded


def synthesize(payload: dict) -> tuple[bytes, str]:
    text = str(payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("朗读文本不能为空。")

    chinese_model = _resolve_model(payload.get("voice"), DEFAULT_CHINESE_MODEL, "zh")
    english_model = _resolve_model(payload.get("english_voice"), DEFAULT_ENGLISH_MODEL, "en")
    speed = float(payload.get("speed") or 1.0)
    segments = split_language_segments(text)
    generated: list[tuple[np.ndarray, int]] = []

    with _generation_lock:
        for language, segment in segments:
            model_id = chinese_model if language == "zh" else english_model
            tts = _get_tts(model_id)
            audio = _generate(tts, segment, speed)
            if len(audio.samples):
                generated.append((np.asarray(audio.samples, dtype=np.float32), int(audio.sample_rate)))

    if not generated:
        raise RuntimeError("Sherpa 没有生成有效音频。")

    target_rate = generated[0][1]
    combined: list[np.ndarray] = []
    silence = np.zeros(max(1, int(target_rate * 0.08)), dtype=np.float32)
    for index, (samples, sample_rate) in enumerate(generated):
        if sample_rate != target_rate:
            samples = _resample(samples, sample_rate, target_rate)
        if index:
            combined.append(silence)
        combined.append(samples)

    output = io.BytesIO()
    sf.write(output, np.concatenate(combined), target_rate, format="WAV", subtype="PCM_16")
    return output.getvalue(), "audio/wav"


def split_language_segments(text: str) -> list[tuple[str, str]]:
    chunks: list[tuple[str, str]] = []
    current_language: str | None = None
    current: list[str] = []

    for char in text:
        language = _character_language(char)
        if language and current_language and language != current_language:
            value = "".join(current).strip()
            if value:
                chunks.append((current_language, value))
            current = []
        if language:
            current_language = language
        current.append(char)

    value = "".join(current).strip()
    if value:
        chunks.append((current_language or "zh", value))
    return _merge_short_segments(chunks)


def _character_language(char: str) -> str | None:
    if re.match(r"[\u3400-\u4dbf\u4e00-\u9fff]", char):
        return "zh"
    if re.match(r"[A-Za-z]", char):
        return "en"
    return None


def _merge_short_segments(chunks: list[tuple[str, str]]) -> list[tuple[str, str]]:
    merged: list[tuple[str, str]] = []
    for language, value in chunks:
        if merged and merged[-1][0] == language:
            merged[-1] = (language, f"{merged[-1][1]} {value}".strip())
        elif len(value.strip(" ,，.。")) <= 1 and merged:
            previous_language, previous_value = merged[-1]
            merged[-1] = (previous_language, previous_value + value)
        else:
            merged.append((language, value))
    return merged


def _resolve_model(value: object, fallback: str, language: str) -> str:
    model_id = str(value or "")
    spec = MODEL_SPECS.get(model_id)
    if spec and spec.language == language:
        return model_id
    return fallback


def _get_tts(model_id: str):
    with _instance_lock:
        if model_id in _instances:
            return _instances[model_id]
        spec = MODEL_SPECS.get(model_id)
        if not spec:
            raise RuntimeError(f"不支持的 Sherpa 模型：{model_id}")
        model_dir = ensure_model(spec)
        try:
            import sherpa_onnx
        except ImportError as exc:
            raise RuntimeError("未安装 sherpa-onnx，请执行 pip install -r requirements-sherpa.txt。") from exc

        vits = sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(model_dir / spec.model_name),
            lexicon=str(model_dir / "lexicon.txt") if spec.use_lexicon else "",
            data_dir=str(model_dir / "espeak-ng-data") if spec.use_espeak_data else "",
            tokens=str(model_dir / "tokens.txt"),
        )
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=vits,
                provider="cpu",
                debug=False,
                num_threads=max(1, min(4, (os.cpu_count() or 2) // 2)),
            ),
            rule_fsts=_rule_fsts(model_dir),
            max_num_sentences=2,
        )
        if not config.validate():
            raise RuntimeError(f"Sherpa 模型配置无效：{model_id}")
        instance = sherpa_onnx.OfflineTts(config)
        _instances[model_id] = instance
        return instance


def ensure_model(spec: ModelSpec) -> Path:
    model_dir = MODEL_ROOT / spec.directory_name
    archive_path = MODEL_ROOT / spec.archive_name
    partial_path = archive_path.with_suffix(archive_path.suffix + ".part")
    required = [model_dir / spec.model_name, model_dir / "tokens.txt"]
    if spec.use_lexicon:
        required.append(model_dir / "lexicon.txt")
    if spec.use_espeak_data:
        required.append(model_dir / "espeak-ng-data")
    if all(path.exists() for path in required):
        archive_path.unlink(missing_ok=True)
        partial_path.unlink(missing_ok=True)
        return model_dir

    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    if not archive_path.exists():
        _download(spec.archive_url, partial_path)
        partial_path.replace(archive_path)
    _safe_extract(archive_path, MODEL_ROOT)
    if not all(path.exists() for path in required):
        raise RuntimeError(f"Sherpa 模型文件不完整：{model_dir}")
    archive_path.unlink(missing_ok=True)
    return model_dir


def _download(url: str, destination: Path) -> None:
    proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or "http://127.0.0.1:7897"
    try:
        with httpx.Client(proxy=proxy, timeout=httpx.Timeout(30, read=300), follow_redirects=True) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                with destination.open("wb") as output:
                    for chunk in response.iter_bytes(1024 * 1024):
                        output.write(chunk)
    except (httpx.HTTPError, OSError) as exc:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Sherpa 模型下载失败：{exc}") from exc


def _safe_extract(archive_path: Path, destination: Path) -> None:
    destination_resolved = destination.resolve()
    with tarfile.open(archive_path, "r:bz2") as archive:
        for member in archive.getmembers():
            target = (destination / member.name).resolve()
            if destination_resolved not in target.parents and target != destination_resolved:
                raise RuntimeError("Sherpa 模型压缩包包含不安全路径。")
        archive.extractall(destination, filter="data")


def _rule_fsts(model_dir: Path) -> str:
    paths = [model_dir / name for name in ("phone.fst", "date.fst", "number.fst")]
    return ",".join(str(path) for path in paths if path.exists())


def _generate(tts, text: str, speed: float):
    import sherpa_onnx

    config = sherpa_onnx.GenerationConfig()
    config.sid = 0
    config.speed = max(0.2, min(2.0, speed))
    config.silence_scale = 0.2
    return tts.generate(text, config)


def _resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if not len(samples) or source_rate == target_rate:
        return samples
    duration = len(samples) / source_rate
    source_positions = np.linspace(0, duration, num=len(samples), endpoint=False)
    target_length = max(1, round(duration * target_rate))
    target_positions = np.linspace(0, duration, num=target_length, endpoint=False)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)
