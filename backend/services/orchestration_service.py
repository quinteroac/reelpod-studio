from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

from models.errors import OrchestrationFailedError

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

llm_pipeline: Any | None = None
llm_pipeline_load_error: str | None = None

QUALITY_PREFIXES = ("score_9", "masterpiece", "best quality")
JSON_PARSE_RETRIES = 2

CREATIVE_DIRECTOR_SYSTEM_PROMPT = (
    "You are the creative director for ReelPod Studio. Given a short user brief, invent a complete "
    "audiovisual concept rather than rephrasing it. Make autonomous creative decisions for genre, mood, "
    "tempo, instrumentation, lyrical theme, visual style, character or scene composition. Prefer static or "
    "minimal camera motion so the video feels like a seamless loop rather than an action sequence. "
    "Return ONLY valid JSON with keys song_title, audio_prompt, image_prompt, video_prompt, "
    "youtube_title, youtube_description.\n"
    "Rules:\n"
    "0) song_title: a short, evocative name for the track (max 60 characters, no special characters "
    "except spaces, hyphens, and apostrophes).\n"
    "1) audio_prompt: ACEStep-ready music brief including genre, mood, tempo hint (e.g. 90 BPM), "
    "instrumentation, and lyrical theme.\n"
    "2) image_prompt: Danbooru tags in strict order: [quality/meta/year/safety tags] [count tag] "
    "[character] [series] [artist] [general tags]. The quality section MUST start with "
    "'score_9, score_8, best quality, highres'.\n"
    "3) video_prompt: short, static or slow-loop scene intent (e.g. ambient, idle motion, subtle loop) "
    "that can be expanded into LTX-Video 2 format. Aim for a calm, loopable clip, not an action movie.\n"
    "4) youtube_title: a YouTube-optimised title for the track (max 100 characters). Must be human-readable "
    "with no underscores and no file-extension suffixes (e.g. no .mp3, .mp4, .wav).\n"
    "5) youtube_description: a short paragraph (1–3 sentences) describing the song concept, mood, and "
    "listening context. Max 5000 characters. Do NOT include hashtags here.\n"
    "6) youtube_hashtags: a JSON array of 3–7 relevant hashtags for the track "
    "(e.g. [\"#lofi\", \"#chillhop\", \"#studymusic\"]). Each entry must start with # and contain no spaces.\n"
    "7) No markdown, no code fences, no explanations, JSON only."
)


_FILE_EXTENSION_PATTERN = re.compile(r"\.[a-zA-Z0-9]{2,4}$")


class OrchestrationResult(BaseModel):
    song_title: str = Field(min_length=1, max_length=60)
    audio_prompt: str = Field(min_length=10, max_length=10000)
    image_prompt: str = Field(min_length=10, max_length=10000)
    video_prompt: str = Field(min_length=20, max_length=10000)
    youtube_title: str = Field(min_length=1, max_length=100)
    youtube_description: str = Field(min_length=10, max_length=5000)
    youtube_hashtags: list[str] = Field(default_factory=list)

    @field_validator("song_title", "audio_prompt", "image_prompt", "video_prompt", "youtube_title", "youtube_description")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed

    @field_validator("image_prompt")
    @classmethod
    def _validate_image_quality_prefix(cls, value: str) -> str:
        lower_value = value.lower()
        if not any(lower_value.startswith(prefix) for prefix in QUALITY_PREFIXES):
            allowed = ", ".join(QUALITY_PREFIXES)
            raise ValueError(f"image_prompt must start with one of: {allowed}")
        return value

    @field_validator("video_prompt")
    @classmethod
    def _validate_video_single_paragraph(cls, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("video_prompt must be a single paragraph with no newlines.")
        return value

    @field_validator("youtube_title")
    @classmethod
    def _validate_youtube_title(cls, value: str) -> str:
        if "_" in value:
            raise ValueError("youtube_title must not contain underscores.")
        if _FILE_EXTENSION_PATTERN.search(value):
            raise ValueError("youtube_title must not end with a file extension (e.g. .mp3, .mp4).")
        return value

    @field_validator("youtube_hashtags")
    @classmethod
    def _validate_youtube_hashtags(cls, tags: list[str]) -> list[str]:
        result = []
        for tag in tags:
            t = tag.strip().replace(" ", "")
            if not t:
                continue
            if not t.startswith("#"):
                t = f"#{t}"
            result.append(t)
        return result


def _ensure_comfyui_vendor_on_path() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    comfyui_dir = backend_dir / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
    if comfyui_dir.is_dir() and (comfyui_dir / "comfyui_version.py").exists():
        path_str = str(comfyui_dir)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


def load_llm_pipeline() -> Any:
    _ensure_comfyui_vendor_on_path()

    model_path_raw = os.environ.get("REELPOD_LLM_MODEL_PATH", "").strip()
    if not model_path_raw:
        logger.warning("REELPOD_LLM_MODEL_PATH is not set; llm orchestration is unavailable.")
        return None

    model_path = Path(model_path_raw)
    if not model_path.is_file():
        raise RuntimeError(f"REELPOD_LLM_MODEL_PATH does not point to a file: {model_path}")

    from comfy_diffusion import check_runtime
    from comfy_diffusion.models import ModelManager

    runtime = check_runtime()
    if runtime.get("error"):
        raise RuntimeError(f"comfy-diffusion runtime check failed: {runtime['error']}")

    # Use models_dir from the LLM file's parent so folder_paths can resolve embeddings, etc.
    models_dir = model_path.parent
    manager = ModelManager(str(models_dir))
    return manager.load_llm(model_path)


def startup() -> None:
    global llm_pipeline, llm_pipeline_load_error
    try:
        llm_pipeline = load_llm_pipeline()
        llm_pipeline_load_error = None
    except Exception as exc:  # pragma: no cover - startup fallback safety
        llm_pipeline = None
        llm_pipeline_load_error = str(exc)
        logger.error("LLM orchestration pipeline failed to load: %s", exc)


def _build_orchestration_prompt(user_prompt: str) -> str:
    return (
        f"<start_of_turn>system\n{CREATIVE_DIRECTOR_SYSTEM_PROMPT}<end_of_turn>\n"
        f"<start_of_turn>user\nUser brief: {user_prompt.strip()}<end_of_turn>\n"
        "<start_of_turn>model\n"
    )


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    direct = raw_text.strip()
    try:
        parsed = json.loads(direct)
    except json.JSONDecodeError:
        start = direct.find("{")
        end = direct.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(direct[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("LLM output JSON must be an object.")
    return parsed


def _generate_json_concept(clip: Any, user_prompt: str) -> str:
    from comfy_diffusion.textgen import generate_text

    return generate_text(
        clip,
        _build_orchestration_prompt(user_prompt),
        max_length=700,
        seed=random.randint(0, 999_999),
    )


def _generate_video_prompt_ltx2(clip: Any, video_seed_prompt: str) -> str:
    from comfy_diffusion.textgen import generate_ltx2_prompt

    return generate_ltx2_prompt(
        clip,
        video_seed_prompt,
        max_length=700,
    )


def orchestrate(user_prompt: str) -> OrchestrationResult:
    if not user_prompt.strip():
        raise OrchestrationFailedError("Prompt cannot be empty for llm orchestration.")

    if llm_pipeline is None:
        reason = llm_pipeline_load_error or "LLM pipeline unavailable. Check REELPOD_LLM_MODEL_PATH."
        raise OrchestrationFailedError(f"LLM orchestration unavailable: {reason}")

    last_error: Exception | None = None
    validated: OrchestrationResult | None = None
    attempts = JSON_PARSE_RETRIES + 1

    for _ in range(attempts):
        raw_output = _generate_json_concept(llm_pipeline, user_prompt)
        logger.info("LLM JSON output: %s", raw_output)
        try:
            payload = _extract_json_object(raw_output)
            validated = OrchestrationResult.model_validate(payload)
            break
        except (json.JSONDecodeError, ValueError, ValidationError) as exc:
            last_error = exc

    if validated is None:
        reason = str(last_error) if last_error is not None else "Invalid output."
        raise OrchestrationFailedError(f"LLM orchestration returned invalid output: {reason}")

    try:
        ltx2_prompt = _generate_video_prompt_ltx2(llm_pipeline, validated.video_prompt)
        return OrchestrationResult.model_validate(
            {
                "song_title": validated.song_title,
                "audio_prompt": validated.audio_prompt,
                "image_prompt": validated.image_prompt,
                ##Use the same image prompt for video to produce more static videos as we are looking for loopable videos.
                "video_prompt": validated.image_prompt,
                #"video_prompt": ltx2_prompt,
                "youtube_title": validated.youtube_title,
                "youtube_description": validated.youtube_description,
                "youtube_hashtags": validated.youtube_hashtags,
            }
        )
    except ValidationError as exc:
        raise OrchestrationFailedError(f"Invalid LTX video prompt output: {exc}") from exc
    except Exception as exc:
        raise OrchestrationFailedError(f"Failed to generate LTX video prompt: {exc}") from exc
