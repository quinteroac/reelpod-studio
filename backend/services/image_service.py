from __future__ import annotations

import io
import logging
from typing import Any

from models.constants import ANIMA_PREVIEW_SIZES, IMAGE_ASPECT_TOLERANCE
from models.errors import ImageGenerationFailedError
from models.schemas import GenerateImageRequestBody
from repositories import image_repository

image_pipeline: Any | None = None
image_model_load_error: str | None = None
logger = logging.getLogger(__name__)

# Anima quality tags for prompt enrichment
QUALITY_TAGS = "score_9, score_8, best quality, highres"
DEFAULT_NEGATIVE_PROMPT = "worst quality, low quality, lowres, jpeg artifacts, signature, watermark, artist name"


def enrich_prompt_with_quality_tags(prompt: str) -> str:
    """Concatenate Anima quality tags to user prompt following Hugging Face guidelines."""
    return f"{QUALITY_TAGS}, {prompt}"


def enrich_negative_prompt(user_negative: str | None = None) -> str:
    """Enhance negative prompt with Anima-specific limitations and defaults."""
    if user_negative:
        return f"{DEFAULT_NEGATIVE_PROMPT}, {user_negative}"
    return DEFAULT_NEGATIVE_PROMPT


def pick_anima_resolution(target_width: int, target_height: int) -> tuple[int, int]:
    """Choose an Anima ~1MP resolution whose aspect ratio is closest to target; then we pad to target."""
    target_aspect = target_width / target_height
    best = min(
        ANIMA_PREVIEW_SIZES,
        key=lambda wh: abs((wh[0] / wh[1]) - target_aspect),
    )
    return best[0], best[1]


def needs_image_refiner_pass(
    source_width: int, source_height: int, target_width: int, target_height: int
) -> bool:
    if source_width != target_width or source_height != target_height:
        return True

    source_aspect = source_width / source_height
    target_aspect = target_width / target_height
    return abs(source_aspect - target_aspect) > IMAGE_ASPECT_TOLERANCE


def letterbox_and_resize_to_target(image: Any, target_width: int, target_height: int) -> Any:
    from PIL import Image

    source_width, source_height = image.size
    source_aspect = source_width / source_height
    target_aspect = target_width / target_height

    resampling = Image.Resampling.LANCZOS

    if abs(source_aspect - target_aspect) <= IMAGE_ASPECT_TOLERANCE and source_width == target_width and source_height == target_height:
        return image

    if source_aspect > target_aspect:
        new_width = target_width
        new_height = max(1, int(round(target_width / source_aspect)))
    else:
        new_height = target_height
        new_width = max(1, int(round(target_height * source_aspect)))

    resized_image = image.resize((new_width, new_height), resampling)
    new_image = Image.new("RGB", (target_width, target_height), (0, 0, 0))

    paste_x = (target_width - new_width) // 2
    paste_y = (target_height - new_height) // 2
    new_image.paste(resized_image, (paste_x, paste_y))

    return new_image


def startup() -> None:
    global image_pipeline, image_model_load_error
    try:
        image_pipeline = image_repository.load_image_pipeline()
        image_model_load_error = None
        logger.info("Image generation model loading completed")
    except Exception as exc:  # pragma: no cover - startup fallback safety
        image_pipeline = None
        image_model_load_error = str(exc)


def generate_image_png(body: GenerateImageRequestBody) -> bytes:
    if image_pipeline is None:
        reason = image_model_load_error or "model unavailable"
        raise ImageGenerationFailedError(f"Image generation failed: {reason}")

    try:
        # Enrich prompt with quality tags following Anima guidelines
        enriched_prompt = enrich_prompt_with_quality_tags(body.prompt)
        enriched_negative = enrich_negative_prompt(body.negative_prompt)

        # Generate at an Anima preview ~1MP resolution (1024x1024, 896x1152, 1152x896), then pad to target
        gen_width, gen_height = pick_anima_resolution(body.target_width, body.target_height)
        source_image = image_repository.run_image_inference(
            image_pipeline,
            prompt=enriched_prompt,
            seed=0,
            negative_prompt=enriched_negative,
            width=gen_width,
            height=gen_height,
        )

        # Upscale first using Real-ESRGAN anime model before final resize/letterbox.
        try:
            working_image = image_repository.upscale_image_with_realesrgan_anime(source_image)
        except Exception as exc:
            logger.warning(
                "Real-ESRGAN upscale failed; falling back to original generated image: %s",
                exc,
            )
            working_image = source_image

        # Always letterbox/pad to the requested target resolution.
        final_image = letterbox_and_resize_to_target(
            working_image,
            target_width=body.target_width,
            target_height=body.target_height,
        )

        output = io.BytesIO()
        final_image.save(output, format="PNG")
        return output.getvalue()
    except ImageGenerationFailedError:
        raise
    except Exception as exc:
        raise ImageGenerationFailedError(f"Image generation failed: {exc}") from exc
