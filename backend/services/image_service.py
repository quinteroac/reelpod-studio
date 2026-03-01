from __future__ import annotations

import io
from typing import Any

from models.constants import IMAGE_ASPECT_TOLERANCE, IMAGE_NUM_INFERENCE_STEPS
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
    except Exception as exc:  # pragma: no cover - startup fallback safety
        image_pipeline = None
        image_model_load_error = str(exc)


def get_optimal_sdxl_size(target_width: int, target_height: int) -> tuple[int, int]:
    target_aspect = target_width / target_height
    valid_sizes = [
        (1024, 1024),
        (1152, 896),
        (1216, 832),
        (1344, 768),
        (1536, 640),
        (896, 1152),
        (832, 1216),
        (768, 1344),
        (640, 1536),
    ]
    
    best_size = valid_sizes[0]
    min_diff = float("inf")
    
    for w, h in valid_sizes:
        aspect = w / h
        diff = abs(aspect - target_aspect)
        if diff < min_diff:
            min_diff = diff
            best_size = (w, h)
            
    return best_size


def generate_image_png(body: GenerateImageRequestBody) -> bytes:
    if image_pipeline is None:
        reason = image_model_load_error or "model unavailable"
        raise ImageGenerationFailedError(f"Image generation failed: {reason}")

    try:
        gen_width, gen_height = get_optimal_sdxl_size(body.target_width, body.target_height)
        source_image = image_repository.run_image_inference(
            image_pipeline,
            prompt=body.prompt,
            width=gen_width,
            height=gen_height,
            num_inference_steps=IMAGE_NUM_INFERENCE_STEPS,
        )
        source_width, source_height = source_image.size

        if needs_image_refiner_pass(
            source_width=source_width,
            source_height=source_height,
            target_width=body.target_width,
            target_height=body.target_height,
        ):
            final_image = letterbox_and_resize_to_target(
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
