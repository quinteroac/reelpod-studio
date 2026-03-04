from __future__ import annotations

from typing import Any

from models.constants import (
    IMAGE_DIFFUSION_MODEL_ID,
    IMAGE_DIFFUSION_ORIGIN_PATTERN,
    IMAGE_NUM_INFERENCE_STEPS,
    IMAGE_QWEN_TOKENIZER_ID,
    IMAGE_QWEN_TOKENIZER_ORIGIN_PATTERN,
    IMAGE_SD35_TOKENIZER_ID,
    IMAGE_SD35_TOKENIZER_ORIGIN_PATTERN,
    IMAGE_TEXT_ENCODER_MODEL_ID,
    IMAGE_TEXT_ENCODER_ORIGIN_PATTERN,
    IMAGE_VAE_MODEL_ID,
    IMAGE_VAE_ORIGIN_PATTERN,
)


def load_image_pipeline() -> Any:
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for image generation. Install it with: uv add torch torchvision"
        ) from exc

    from diffsynth.pipelines.anima_image import AnimaImagePipeline, ModelConfig

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required to run the Anima image pipeline.")

    vram_config = {
        "offload_dtype": "disk",
        "offload_device": "disk",
        "onload_dtype": "disk",
        "onload_device": "disk",
        "preparing_dtype": torch.bfloat16,
        "preparing_device": "cuda",
        "computation_dtype": torch.bfloat16,
        "computation_device": "cuda",
    }
    model_configs = [
        ModelConfig(
            model_id=IMAGE_DIFFUSION_MODEL_ID,
            origin_file_pattern=IMAGE_DIFFUSION_ORIGIN_PATTERN,
            **vram_config,
        ),
        ModelConfig(
            model_id=IMAGE_TEXT_ENCODER_MODEL_ID,
            origin_file_pattern=IMAGE_TEXT_ENCODER_ORIGIN_PATTERN,
            **vram_config,
        ),
        ModelConfig(
            model_id=IMAGE_VAE_MODEL_ID,
            origin_file_pattern=IMAGE_VAE_ORIGIN_PATTERN,
            **vram_config,
        ),
    ]
    _free, _total = torch.cuda.mem_get_info()
    vram_limit = _total / (1024**3) - 0.5
    pipeline = AnimaImagePipeline.from_pretrained(
        torch_dtype=torch.bfloat16,
        device="cuda",
        model_configs=model_configs,
        tokenizer_config=ModelConfig(
            model_id=IMAGE_QWEN_TOKENIZER_ID,
            origin_file_pattern=IMAGE_QWEN_TOKENIZER_ORIGIN_PATTERN,
        ),
        tokenizer_t5xxl_config=ModelConfig(
            model_id=IMAGE_SD35_TOKENIZER_ID,
            origin_file_pattern=IMAGE_SD35_TOKENIZER_ORIGIN_PATTERN,
        ),
        vram_limit=vram_limit,
    )
    return pipeline


def _round_to_multiple_of_16(value: int) -> int:
    return max(16, (value + 8) // 16 * 16)


def run_image_inference(
    pipeline: Any,
    *,
    prompt: str,
    seed: int,
    negative_prompt: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> Any:
    inference_kwargs: dict[str, Any] = {
        "seed": seed,
        "num_inference_steps": IMAGE_NUM_INFERENCE_STEPS,
    }
    if negative_prompt:
        inference_kwargs["negative_prompt"] = negative_prompt
    if width is not None:
        inference_kwargs["width"] = _round_to_multiple_of_16(width)
    if height is not None:
        inference_kwargs["height"] = _round_to_multiple_of_16(height)

    result = pipeline(prompt, **inference_kwargs)
    images = getattr(result, "images", None)
    if isinstance(images, list) and images:
        return images[0]
    if hasattr(result, "size") and callable(getattr(result, "save", None)):
        return result
    raise RuntimeError("No generated image returned by model")
