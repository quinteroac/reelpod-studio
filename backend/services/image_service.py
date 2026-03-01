from __future__ import annotations

import io
from typing import Any

from models.constants import IMAGE_ASPECT_TOLERANCE, IMAGE_NUM_INFERENCE_STEPS, IMAGE_SIZE
from models.errors import ImageGenerationFailedError
from models.schemas import GenerateImageRequestBody
from repositories import image_repository

image_pipeline: Any | None = None
image_model_load_error: str | None = None


def needs_image_refiner_pass(
    source_width: int, source_height: int, target_width: int, target_height: int
) -> bool:
    if source_width != target_width or source_height != target_height:
        return True

    source_aspect = source_width / source_height
    target_aspect = target_width / target_height
    return abs(source_aspect - target_aspect) > IMAGE_ASPECT_TOLERANCE


def center_crop_and_resize_to_target(image: Any, target_width: int, target_height: int) -> Any:
    from PIL import Image

    source_width, source_height = image.size
    source_aspect = source_width / source_height
    target_aspect = target_width / target_height

    if abs(source_aspect - target_aspect) <= IMAGE_ASPECT_TOLERANCE:
        cropped = image
    elif source_aspect > target_aspect:
        crop_width = max(1, int(round(source_height * target_aspect)))
        left = max(0, (source_width - crop_width) // 2)
        cropped = image.crop((left, 0, left + crop_width, source_height))
    else:
        crop_height = max(1, int(round(source_width / target_aspect)))
        top = max(0, (source_height - crop_height) // 2)
        cropped = image.crop((0, top, source_width, top + crop_height))

    if cropped.size == (target_width, target_height):
        return cropped

    resampling = Image.Resampling.LANCZOS
    return cropped.resize((target_width, target_height), resampling)


def startup() -> None:
    global image_pipeline, image_model_load_error
    try:
        image_pipeline = image_repository.load_image_pipeline()
        image_model_load_error = None
    except Exception as exc:  # pragma: no cover - startup fallback safety
        image_pipeline = None
        image_model_load_error = str(exc)


def generate_image_png(body: GenerateImageRequestBody) -> bytes:
    if image_pipeline is None:
        reason = image_model_load_error or "model unavailable"
        raise ImageGenerationFailedError(f"Image generation failed: {reason}")

    try:
        source_image = image_repository.run_image_inference(
            image_pipeline,
            prompt=body.prompt,
            width=IMAGE_SIZE,
            height=IMAGE_SIZE,
            num_inference_steps=IMAGE_NUM_INFERENCE_STEPS,
        )
        source_width, source_height = source_image.size

        if needs_image_refiner_pass(
            source_width=source_width,
            source_height=source_height,
            target_width=body.target_width,
            target_height=body.target_height,
        ):
            final_image = center_crop_and_resize_to_target(
                source_image,
                target_width=body.target_width,
                target_height=body.target_height,
            )
        else:
            final_image = source_image

        output = io.BytesIO()
        final_image.save(output, format="PNG")
        return output.getvalue()
    except ImageGenerationFailedError:
        raise
    except Exception as exc:
        raise ImageGenerationFailedError(f"Image generation failed: {exc}") from exc
