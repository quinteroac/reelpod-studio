from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from models.constants import (
    IMAGE_DIFFUSION_MODEL_ID,
    IMAGE_DIFFUSION_ORIGIN_PATTERN,
    IMAGE_NUM_INFERENCE_STEPS,
    REAL_ESRGAN_ANIME_WEIGHTS_FILENAME,
    REAL_ESRGAN_ANIME_WEIGHTS_URL,
    REAL_ESRGAN_SCALE,
    IMAGE_QWEN_TOKENIZER_ID,
    IMAGE_QWEN_TOKENIZER_ORIGIN_PATTERN,
    IMAGE_SD35_TOKENIZER_ID,
    IMAGE_SD35_TOKENIZER_ORIGIN_PATTERN,
    IMAGE_TEXT_ENCODER_MODEL_ID,
    IMAGE_TEXT_ENCODER_ORIGIN_PATTERN,
    IMAGE_VAE_MODEL_ID,
    IMAGE_VAE_ORIGIN_PATTERN,
    WAN_PIPELINE_HIGH_NOISE_PATTERN,
    WAN_PIPELINE_LOW_NOISE_PATTERN,
    WAN_PIPELINE_T5_PATTERN,
    WAN_PIPELINE_TOKENIZER_MODEL_ID,
    WAN_PIPELINE_TOKENIZER_ORIGIN,
    WAN_PIPELINE_VAE_PATTERN,
    WAN_PIPELINE_VRAM_HEADROOM_GB,
    WAN_VIDEO_MODEL_ID,
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


def _get_realesrgan_weights_dir() -> Path:
    env_dir = os.getenv("REAL_ESRGAN_WEIGHTS_DIR")
    if env_dir:
        return Path(env_dir)
    return Path(__file__).resolve().parent.parent / ".realesrgan"


def _ensure_realesrgan_anime_weights() -> Path:
    """Ensure RealESRGAN_x4plus_anime_6B.pth exists under backend/.realesrgan/, downloading if needed."""
    weights_dir = _get_realesrgan_weights_dir()
    weights_path = weights_dir / REAL_ESRGAN_ANIME_WEIGHTS_FILENAME
    if weights_path.is_file():
        return weights_path
    weights_dir.mkdir(parents=True, exist_ok=True)
    from basicsr.utils.download_util import load_file_from_url

    load_file_from_url(
        url=REAL_ESRGAN_ANIME_WEIGHTS_URL,
        model_dir=str(weights_dir),
        progress=True,
        file_name=REAL_ESRGAN_ANIME_WEIGHTS_FILENAME,
    )
    return weights_path


def _apply_torchvision_compat_shim() -> None:
    """Shim for torchvision 0.17+: basicsr expects torchvision.transforms.functional_tensor (removed)."""
    import sys
    import types

    if "torchvision.transforms.functional_tensor" in sys.modules:
        return
    try:
        from torchvision.transforms import functional as _F
    except ImportError:
        return
    shim = types.ModuleType("torchvision.transforms.functional_tensor")
    shim.rgb_to_grayscale = getattr(_F, "rgb_to_grayscale", None)
    if shim.rgb_to_grayscale is not None:
        sys.modules["torchvision.transforms.functional_tensor"] = shim


def upscale_image_with_realesrgan_anime(image: Any) -> Any:
    """Upscale image 4× with realesrgan-x4plus-anime. Weights auto-download to backend/.realesrgan/ if missing."""
    _apply_torchvision_compat_shim()
    import numpy as np
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from PIL import Image
    from realesrgan import RealESRGANer

    weights_path = _ensure_realesrgan_anime_weights()
    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=6,
        num_grow_ch=32,
        scale=REAL_ESRGAN_SCALE,
    )
    mem_before: dict[str, int] | None = None
    mem_after: dict[str, int] | None = None
    mem_after_empty: dict[str, int] | None = None
    torch_mod: Any | None = None
    try:
        import torch as _torch

        torch_mod = _torch
        if _torch.cuda.is_available():
            free, total = _torch.cuda.mem_get_info()
            mem_before = {"free": int(free), "total": int(total)}
            gpu_id = 0
        else:
            gpu_id = None
    except ImportError:
        gpu_id = None
    upsampler = RealESRGANer(
        scale=REAL_ESRGAN_SCALE,
        model_path=str(weights_path),
        model=model,
        tile=512,
        tile_pad=10,
        pre_pad=0,
        half=True,
        gpu_id=gpu_id,
    )
    pil_image = image.convert("RGB")
    in_w, in_h = pil_image.size
    rgb = np.array(pil_image)
    bgr = rgb[..., ::-1].copy()
    output_bgr, _ = upsampler.enhance(bgr, outscale=REAL_ESRGAN_SCALE)
    output_rgb = output_bgr[..., ::-1].copy()
    out_pil = Image.fromarray(output_rgb).convert("RGB").copy()
    if torch_mod is not None and getattr(torch_mod, "cuda", None) is not None and torch_mod.cuda.is_available():
        try:
            free2, total2 = torch_mod.cuda.mem_get_info()
            mem_after = {"free": int(free2), "total": int(total2)}
        except Exception:
            mem_after = None
        try:
            # Explicitly release references and empty CUDA cache to offload VRAM between requests.
            del upsampler, model, bgr, rgb, output_bgr, output_rgb
        except Exception:
            pass
        try:
            torch_mod.cuda.empty_cache()
            free3, total3 = torch_mod.cuda.mem_get_info()
            mem_after_empty = {"free": int(free3), "total": int(total3)}
        except Exception:
            mem_after_empty = None
    # #region agent log
    _out_w, _out_h = out_pil.size
    _log_path = Path(__file__).resolve().parent.parent.parent / ".cursor" / "debug.log"  # backend/repositories -> workspace
    try:
        _log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(_log_path, "a") as _f:
            _f.write(
                json.dumps(
                    {
                        "timestamp": int(time.time() * 1000),
                        "location": "image_repository.py:upscale_exit",
                        "message": "realesrgan exit",
                        "data": {
                            "input_size": [in_w, in_h],
                            "output_size": [_out_w, _out_h],
                            "mem_before": mem_before,
                            "mem_after": mem_after,
                            "mem_after_empty": mem_after_empty,
                        },
                        "hypothesisId": "H4",
                    }
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion
    return out_pil


def load_wan_pipeline() -> Any:
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for Wan video generation. Install it with: uv add torch torchvision"
        ) from exc

    from diffsynth.pipelines.wan_video import ModelConfig, WanVideoPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required to run the Wan video pipeline.")

    vram_config = {
        "offload_dtype": "disk",
        "offload_device": "disk",
        "onload_dtype": torch.bfloat16,
        "onload_device": "cpu",
        "preparing_dtype": torch.bfloat16,
        "preparing_device": "cuda",
        "computation_dtype": torch.bfloat16,
        "computation_device": "cuda",
    }
    model_configs = [
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern=WAN_PIPELINE_HIGH_NOISE_PATTERN,
            **vram_config,
        ),
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern=WAN_PIPELINE_LOW_NOISE_PATTERN,
            **vram_config,
        ),
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern=WAN_PIPELINE_T5_PATTERN,
            **vram_config,
        ),
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern=WAN_PIPELINE_VAE_PATTERN,
            **vram_config,
        ),
    ]
    _free, _total = torch.cuda.mem_get_info()
    vram_limit = _total / (1024**3) - WAN_PIPELINE_VRAM_HEADROOM_GB
    pipeline = WanVideoPipeline.from_pretrained(
        torch_dtype=torch.bfloat16,
        device="cuda",
        model_configs=model_configs,
        tokenizer_config=ModelConfig(
            model_id=WAN_PIPELINE_TOKENIZER_MODEL_ID,
            origin_file_pattern=WAN_PIPELINE_TOKENIZER_ORIGIN,
        ),
        vram_limit=vram_limit,
    )
    return pipeline


def run_wan_inference(
    pipeline: Any,
    *,
    image: Any,
    prompt: str,
    seed: int,
    width: int,
    height: int,
) -> list[Any]:
    frames: list[Any] = pipeline(
        prompt=prompt,
        input_image=image,
        seed=seed,
        num_inference_steps=20,
        tiled=True,
        switch_DiT_boundary=0.9,
    )
    return frames
