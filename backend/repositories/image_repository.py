from __future__ import annotations

from typing import Any

from models.constants import (
    IMAGE_DIFFUSION_MODEL_ID,
    IMAGE_NUM_INFERENCE_STEPS,
    IMAGE_QWEN_TOKENIZER_ID,
    IMAGE_SD35_TOKENIZER_ID,
    IMAGE_TEXT_ENCODER_MODEL_ID,
    IMAGE_VAE_MODEL_ID,
)


def _compute_vram_limit_gb(torch_module: Any) -> int:
    free_bytes, _ = torch_module.cuda.mem_get_info()
    free_gib = free_bytes / (1024**3)
    return max(1, int(free_gib * 0.9))


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

    model_configs = [
        ModelConfig(role="diffusion_model", model_id=IMAGE_DIFFUSION_MODEL_ID),
        ModelConfig(role="text_encoder", model_id=IMAGE_TEXT_ENCODER_MODEL_ID),
        ModelConfig(role="vae", model_id=IMAGE_VAE_MODEL_ID),
    ]
    tokenizer_configs = [
        {"role": "tokenizer", "model_id": IMAGE_QWEN_TOKENIZER_ID},
        {
            "role": "tokenizer_3",
            "model_id": IMAGE_SD35_TOKENIZER_ID,
            "subfolder": "tokenizer_3",
        },
    ]
    vram_limit_gb = _compute_vram_limit_gb(torch)
    pipeline = AnimaImagePipeline.from_pretrained(
        model_configs=model_configs,
        tokenizer_configs=tokenizer_configs,
        enable_disk_offload=True,
        computation_dtype=torch.bfloat16,
        computation_device="cuda",
        vram_limit_gb=vram_limit_gb,
    )

    if hasattr(pipeline, "enable_disk_offload"):
        pipeline.enable_disk_offload()
    return pipeline


def run_image_inference(
    pipeline: Any,
    *,
    prompt: str,
    seed: int,
    negative_prompt: str | None = None,
) -> Any:
    inference_kwargs: dict[str, Any] = {
        "seed": seed,
        "num_inference_steps": IMAGE_NUM_INFERENCE_STEPS,
    }
    if negative_prompt:
        inference_kwargs["negative_prompt"] = negative_prompt

    result = pipeline(prompt, **inference_kwargs)
    images = getattr(result, "images", None)
    if not isinstance(images, list) or not images:
        raise RuntimeError("No generated image returned by model")
    return images[0]
