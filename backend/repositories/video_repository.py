from __future__ import annotations

from pathlib import Path
from typing import Any

from models.constants import (
    WAN_VIDEO_CLIP_DURATION_SECONDS,
    WAN_VIDEO_MODEL_ID,
    WAN_VIDEO_NUM_INFERENCE_STEPS,
    WAN_VIDEO_RESOLUTIONS,
)


def pick_wan_resolution(target_width: int, target_height: int) -> tuple[int, int]:
    """Choose the Wan-supported resolution whose aspect ratio best matches the target."""
    target_aspect = target_width / target_height
    best = min(
        WAN_VIDEO_RESOLUTIONS.values(),
        key=lambda wh: abs((wh[0] / wh[1]) - target_aspect),
    )
    return best


def load_video_pipeline() -> Any:
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for video generation. Install it with: uv add torch torchvision"
        ) from exc

    from diffsynth.pipelines.wan_video import ModelConfig, WanVideoPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required to run the Wan video pipeline.")

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
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern="diffusion_models/",
            **vram_config,
        ),
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern="text_encoders/",
            **vram_config,
        ),
        ModelConfig(
            model_id=WAN_VIDEO_MODEL_ID,
            origin_file_pattern="vae/",
            **vram_config,
        ),
    ]
    _free, _total = torch.cuda.mem_get_info()
    vram_limit = _total / (1024**3) - 0.5
    pipeline = WanVideoPipeline.from_pretrained(
        torch_dtype=torch.bfloat16,
        device="cuda",
        model_configs=model_configs,
        vram_limit=vram_limit,
    )
    return pipeline


def run_video_inference(
    pipeline: Any,
    *,
    input_image: Any,
    target_width: int,
    target_height: int,
    temp_dir: Path,
) -> Path:
    """Run Wan I2V inference and save the output clip as a temporary MP4.

    The input image is resized to a supported Wan resolution that best matches
    the target aspect ratio. Returns the path to the saved MP4 file.
    """
    from PIL import Image

    wan_width, wan_height = pick_wan_resolution(target_width, target_height)
    resized_image = input_image.resize((wan_width, wan_height), Image.Resampling.LANCZOS)

    video = pipeline(
        input_image=resized_image,
        num_inference_steps=WAN_VIDEO_NUM_INFERENCE_STEPS,
        height=wan_height,
        width=wan_width,
        num_frames=WAN_VIDEO_CLIP_DURATION_SECONDS * 16,  # ~16 fps for Wan
        seed=0,
    )

    output_path = temp_dir / "wan_clip.mp4"
    from diffsynth.pipelines.wan_video import save_video

    save_video(video, str(output_path))
    return output_path
