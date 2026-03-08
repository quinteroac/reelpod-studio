"""Video generation via comfy-diffusion (Wan 2.2 image-to-video).

Pipeline is loaded from WAN_COMFY_MODELS_DIR (or PYCOMFY_MODELS_DIR).
Set WAN_COMFY_UNET_HIGH, WAN_COMFY_UNET_LOW, WAN_COMFY_CLIP, WAN_COMFY_VAE to model filenames.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, NamedTuple

from models.constants import (
    WAN_VIDEO_CLIP_DURATION_SECONDS,
    WAN_VIDEO_FPS,
    WAN_VIDEO_RESOLUTIONS,
    WAN_COMFY_MODELS_DIR,
    WAN_COMFY_UNET_HIGH,
    WAN_COMFY_UNET_LOW,
    WAN_COMFY_CLIP,
    WAN_COMFY_VAE,
    WAN_COMFY_HIGH_STEPS,
    WAN_COMFY_STEPS,
    WAN_COMFY_CFG,
    WAN_COMFY_SAMPLER,
    WAN_COMFY_SCHEDULER,
    WAN_COMFY_SAMPLING_SHIFT,
    WAN_COMFY_NEGATIVE_PROMPT,
)
from repositories.wan_comfy_helpers import (
    wan_image_to_video,
    wan22_latent_to_wan21_for_decode,
    apply_model_sampling_shift,
    save_frames_as_video,
)

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

_cached_pipeline: WanComfyPipeline | None = None
_cached_load_error: str | None = None


class WanComfyPipeline(NamedTuple):
    """Loaded Wan 2.2 I2V models (comfy-diffusion)."""

    model_high: Any
    model_low: Any
    clip: Any
    vae: Any


def _get_models_dir() -> Path:
    if not WAN_COMFY_MODELS_DIR or not WAN_COMFY_MODELS_DIR.strip():
        raise RuntimeError(
            "WAN_COMFY_MODELS_DIR or PYCOMFY_MODELS_DIR must be set to the comfy-diffusion models root "
            "(directory containing diffusion_models/, text_encoders/, vae/)"
        )
    path = Path(WAN_COMFY_MODELS_DIR.strip())
    if not path.is_dir():
        raise RuntimeError(f"WAN_COMFY_MODELS_DIR is not an existing directory: {path}")
    return path


def pick_wan_resolution(target_width: int, target_height: int) -> tuple[int, int]:
    """Choose the Wan-supported resolution whose aspect ratio best matches the target."""
    target_aspect = target_width / target_height
    best = min(
        WAN_VIDEO_RESOLUTIONS.values(),
        key=lambda wh: abs((wh[0] / wh[1]) - target_aspect),
    )
    return best


def load_video_pipeline() -> WanComfyPipeline:
    """Load Wan 2.2 I2V models via comfy-diffusion ModelManager.

    Requires WAN_COMFY_MODELS_DIR (or PYCOMFY_MODELS_DIR) and model filenames
    (WAN_COMFY_UNET_HIGH, WAN_COMFY_UNET_LOW, WAN_COMFY_CLIP, WAN_COMFY_VAE).
    """
    global _cached_pipeline, _cached_load_error

    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for video generation. Install it with: uv add torch torchvision"
        ) from exc

    from comfy_diffusion import check_runtime
    from comfy_diffusion.models import ModelManager

    runtime = check_runtime()
    if runtime.get("error"):
        raise RuntimeError(f"comfy-diffusion runtime check failed: {runtime['error']}")

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required to run the Wan video pipeline.")

    models_dir = _get_models_dir()
    if not WAN_COMFY_UNET_HIGH.strip() or not WAN_COMFY_UNET_LOW.strip():
        raise RuntimeError(
            "WAN_COMFY_UNET_HIGH and WAN_COMFY_UNET_LOW (or PYCOMFY_WAN_UNET_HIGH / PYCOMFY_WAN_UNET_LOW) must be set"
        )
    if not WAN_COMFY_CLIP.strip():
        raise RuntimeError("WAN_COMFY_CLIP (or PYCOMFY_WAN_CLIP) must be set")
    if not WAN_COMFY_VAE.strip():
        raise RuntimeError("WAN_COMFY_VAE (or PYCOMFY_WAN_VAE) must be set")

    if WAN_COMFY_HIGH_STEPS >= WAN_COMFY_STEPS:
        raise RuntimeError(
            "WAN_COMFY_HIGH_STEPS must be less than WAN_COMFY_STEPS for two-stage sampling"
        )

    manager = ModelManager(str(models_dir))
    model_high = manager.load_unet(WAN_COMFY_UNET_HIGH.strip())
    model_low = manager.load_unet(WAN_COMFY_UNET_LOW.strip())
    clip = manager.load_clip(WAN_COMFY_CLIP.strip(), clip_type="wan")
    vae = manager.load_vae(WAN_COMFY_VAE.strip())

    if WAN_COMFY_SAMPLING_SHIFT != 1.0:
        model_high = apply_model_sampling_shift(model_high, shift=WAN_COMFY_SAMPLING_SHIFT)
        model_low = apply_model_sampling_shift(model_low, shift=WAN_COMFY_SAMPLING_SHIFT)

    _cached_pipeline = WanComfyPipeline(
        model_high=model_high,
        model_low=model_low,
        clip=clip,
        vae=vae,
    )
    _cached_load_error = None
    return _cached_pipeline


def run_video_inference(
    pipeline: WanComfyPipeline,
    *,
    input_image: Any,
    prompt: str,
    target_width: int,
    target_height: int,
    temp_dir: Path,
) -> Path:
    """Run Wan 2.2 I2V with comfy-diffusion and save the clip as MP4.

    Resizes the input image to a supported Wan resolution, runs two-stage sampling,
    decodes with Wan 2.1 VAE, and writes MP4 via PyAV.
    """
    from PIL import Image
    import numpy as np

    from comfy_diffusion import vae_decode_batch
    from comfy_diffusion.conditioning import encode_prompt
    from comfy_diffusion.sampling import sample_advanced
    from comfy_diffusion._runtime import ensure_comfyui_on_path

    ensure_comfyui_on_path()
    import comfy.model_management
    import torch

    wan_width, wan_height = pick_wan_resolution(target_width, target_height)
    if isinstance(input_image, Image.Image):
        resized = input_image.resize((wan_width, wan_height), Image.Resampling.LANCZOS)
    else:
        resized = Image.fromarray(input_image).resize((wan_width, wan_height), Image.Resampling.LANCZOS)

    # Number of frames: must be (4*n)+1 for Wan latent; match clip duration at 16 fps
    target_frames = int(WAN_VIDEO_CLIP_DURATION_SECONDS * WAN_VIDEO_FPS)
    length = max(5, ((target_frames - 1) // 4) * 4 + 1)

    # Encode prompts
    positive = encode_prompt(pipeline.clip, prompt)
    negative = encode_prompt(pipeline.clip, WAN_COMFY_NEGATIVE_PROMPT)

    # Start image tensor (batch=1, [1, H, W, 3])
    arr = np.array(resized.convert("RGB"))
    device = comfy.model_management.intermediate_device()
    start_image_tensor = (
        torch.from_numpy(arr).float().to(device=device) / 255.0
    ).unsqueeze(0)

    positive, negative, latent = wan_image_to_video(
        positive,
        negative,
        pipeline.vae,
        wan_width,
        wan_height,
        length,
        batch_size=1,
        start_image=start_image_tensor,
        clip_vision_output=None,
    )

    # Two-stage sampling: high-noise then low-noise
    denoised = sample_advanced(
        pipeline.model_high,
        positive,
        negative,
        latent,
        steps=WAN_COMFY_STEPS,
        cfg=WAN_COMFY_CFG,
        sampler_name=WAN_COMFY_SAMPLER,
        scheduler=WAN_COMFY_SCHEDULER,
        noise_seed=0,
        add_noise=True,
        start_at_step=0,
        end_at_step=WAN_COMFY_HIGH_STEPS,
        denoise=1.0,
        return_with_leftover_noise=True,
    )
    denoised = sample_advanced(
        pipeline.model_low,
        positive,
        negative,
        denoised,
        steps=WAN_COMFY_STEPS,
        cfg=WAN_COMFY_CFG,
        sampler_name=WAN_COMFY_SAMPLER,
        scheduler=WAN_COMFY_SCHEDULER,
        noise_seed=0,
        add_noise=False,
        start_at_step=WAN_COMFY_HIGH_STEPS,
        end_at_step=WAN_COMFY_STEPS,
        denoise=1.0,
        return_with_leftover_noise=False,
    )

    to_decode = wan22_latent_to_wan21_for_decode(denoised, wan_width, wan_height)
    frames = vae_decode_batch(pipeline.vae, to_decode)

    output_path = temp_dir / "wan_clip.mp4"
    save_frames_as_video(frames, output_path, fps=WAN_VIDEO_FPS)
    return output_path
