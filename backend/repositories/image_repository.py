from __future__ import annotations

from typing import Any

from models.constants import IMAGE_MODEL_ID


def load_image_pipeline() -> Any:
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for image generation. Install it with: uv add torch torchvision"
        ) from exc

    from diffusers import DiffusionPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    pipeline = DiffusionPipeline.from_pretrained(IMAGE_MODEL_ID, torch_dtype=dtype)

    if device == "cuda":
        pipeline.enable_sequential_cpu_offload()
        if hasattr(pipeline, "enable_vae_slicing"):
            pipeline.enable_vae_slicing()
        if hasattr(pipeline, "enable_vae_tiling"):
            pipeline.enable_vae_tiling()
        return pipeline

    return pipeline.to(device)


def _truncate_prompt_to_token_limit(pipeline: Any, prompt: str, max_tokens: int = 75) -> str:
    """Truncate a prompt so it fits within the CLIP tokenizer token limit.

    Some model/tokenizer combinations raise an index-out-of-bounds error when
    the prompt tokenises to exactly ``max_length`` (77 tokens including
    BOS/EOS).  We truncate to *max_tokens* (default 75, leaving room for the
    two special tokens) and decode back to text so the pipeline never hits the
    boundary condition.
    """
    tokenizer = getattr(pipeline, "tokenizer", None)
    if tokenizer is None:
        return prompt

    token_ids = tokenizer.encode(prompt, add_special_tokens=False)
    if len(token_ids) <= max_tokens:
        return prompt

    truncated_ids = token_ids[:max_tokens]
    return tokenizer.decode(truncated_ids, skip_special_tokens=True).strip()


def run_image_inference(
    pipeline: Any,
    *,
    prompt: str,
    width: int,
    height: int,
    num_inference_steps: int,
) -> Any:
    safe_prompt = _truncate_prompt_to_token_limit(pipeline, prompt)
    result = pipeline(
        prompt=safe_prompt,
        width=width,
        height=height,
        num_inference_steps=num_inference_steps,
    )
    images = getattr(result, "images", None)
    if not isinstance(images, list) or not images:
        raise RuntimeError("No generated image returned by model")
    return images[0]
