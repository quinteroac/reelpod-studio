from __future__ import annotations

import json
import logging
import os
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
    "tempo, instrumentation, lyrical theme, visual style, character or scene composition, and camera motion "
    "while staying coherent with the user's brief. Return ONLY valid JSON with keys audio_prompt, image_prompt, "
    "video_prompt.\n"
    "Rules:\n"
    "1) audio_prompt: ACEStep-ready music brief including genre, mood, tempo hint (e.g. 90 BPM), "
    "instrumentation, and lyrical theme.\n"
    "2) image_prompt: Danbooru tags in strict order: [quality/meta/year/safety tags] [count tag] "
    "[character] [series] [artist] [general tags]. The quality section MUST start with "
    "'score_9, score_8, best quality, highres'.\n"
    "3) video_prompt: short action-focused scene intent that can be expanded into LTX-Video 2 format.\n"
    "4) No markdown, no code fences, no explanations, JSON only."
)


class OrchestrationResult(BaseModel):
    audio_prompt: str = Field(min_length=10, max_length=500)
    image_prompt: str = Field(min_length=10, max_length=500)
    video_prompt: str = Field(min_length=20, max_length=1000)

    @field_validator("audio_prompt", "image_prompt", "video_prompt")
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

    clip_type = os.environ.get("REELPOD_LLM_CLIP_TYPE", "llm").strip() or "llm"

    from comfy_diffusion import check_runtime
    from comfy_diffusion.models import ModelManager

    runtime = check_runtime()
    if runtime.get("error"):
        raise RuntimeError(f"comfy-diffusion runtime check failed: {runtime['error']}")

    manager = ModelManager(str(model_path.parent))
    return manager.load_clip(str(model_path.resolve()), clip_type=clip_type)


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

    last_json_error: Exception | None = None
    payload: dict[str, Any] | None = None
    attempts = JSON_PARSE_RETRIES + 1

    for _ in range(attempts):
        raw_output = _generate_json_concept(llm_pipeline, user_prompt)
        try:
            payload = _extract_json_object(raw_output)
            break
        except (json.JSONDecodeError, ValueError) as exc:
            last_json_error = exc

    if payload is None:
        reason = str(last_json_error) if last_json_error is not None else "Invalid JSON output."
        raise OrchestrationFailedError(f"LLM orchestration returned invalid JSON: {reason}")

    try:
        validated = OrchestrationResult.model_validate(payload)
    except ValidationError as exc:
        raise OrchestrationFailedError(f"Invalid orchestration output: {exc}") from exc

    try:
        ltx2_prompt = _generate_video_prompt_ltx2(llm_pipeline, validated.video_prompt)
        return OrchestrationResult.model_validate(
            {
                "audio_prompt": validated.audio_prompt,
                "image_prompt": validated.image_prompt,
                "video_prompt": ltx2_prompt,
            }
        )
    except ValidationError as exc:
        raise OrchestrationFailedError(f"Invalid LTX video prompt output: {exc}") from exc
    except Exception as exc:
        raise OrchestrationFailedError(f"Failed to generate LTX video prompt: {exc}") from exc
