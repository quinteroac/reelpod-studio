"""Wan 2.2 image-to-video helpers for comfy-diffusion.

Logic adapted from:
https://github.com/quinteroac/comfy-diffusion/blob/master/examples/wan_video_example.py
Uses ComfyUI node WanImageToVideo: empty 16ch @ 1/8 latent + concat_latent_image/concat_mask.
Two-stage sampling with high-noise and low-noise UNets.
"""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any

from PIL import Image


def _ensure_comfy() -> None:
    from comfy_diffusion._runtime import ensure_comfyui_on_path
    ensure_comfyui_on_path()


def wan22_latent_to_wan21_for_decode(latent: dict, width: int, height: int) -> dict:
    """Convert Wan 2.2 latent to 16ch @ 1/8 for Wan 2.1 VAE decode.

    Wan 2.2 is decoded with Wan 2.1 VAE. The 2.1 VAE expects 16ch @ 1/8 spatial.
    If the sampler returns 48ch @ 1/16 or 16ch @ 1/16, convert to 16ch @ 1/8.
    """
    _ensure_comfy()
    import torch

    samples = latent["samples"]
    b, c, t, h, w = samples.shape
    target_h, target_w = height // 8, width // 8
    is_spatial_1_16 = (h, w) == (height // 16, width // 16)

    if samples.shape[1] == 48 and is_spatial_1_16:
        s16 = samples[:, :16, :, :, :].contiguous()
    elif samples.shape[1] == 16 and is_spatial_1_16:
        s16 = samples
    else:
        return latent

    s16 = torch.nn.functional.interpolate(
        s16.reshape(b * t, 16, h, w),
        size=(target_h, target_w),
        mode="bilinear",
        align_corners=False,
    )
    s16 = s16.reshape(b, 16, t, target_h, target_w).to(samples.device, dtype=samples.dtype)
    out = latent.copy()
    out["samples"] = s16
    return out


def wan_image_to_video(
    positive: Any,
    negative: Any,
    vae: Any,
    width: int,
    height: int,
    length: int,
    batch_size: int,
    start_image: Any | None = None,
    clip_vision_output: Any | None = None,
) -> tuple[Any, Any, dict]:
    """Exact logic of ComfyUI node WanImageToVideo.

    Returns (positive, negative, out_latent). Latent is empty 16ch @ 1/8;
    when start_image is provided, encodes it and injects concat_latent_image + concat_mask.
    """
    _ensure_comfy()
    import torch
    import comfy.model_management
    import comfy.utils
    import node_helpers

    latent = torch.zeros(
        [batch_size, 16, ((length - 1) // 4) + 1, height // 8, width // 8],
        device=comfy.model_management.intermediate_device(),
    )
    if start_image is not None:
        start_image = comfy.utils.common_upscale(
            start_image[:length].movedim(-1, 1), width, height, "bilinear", "center"
        ).movedim(1, -1)
        image = torch.ones(
            (length, height, width, start_image.shape[-1]),
            device=start_image.device,
            dtype=start_image.dtype,
        ) * 0.5
        image[: start_image.shape[0]] = start_image

        concat_latent_image = vae.encode(image[:, :, :, :3])
        mask = torch.ones(
            (1, 1, latent.shape[2], concat_latent_image.shape[-2], concat_latent_image.shape[-1]),
            device=start_image.device,
            dtype=start_image.dtype,
        )
        mask[:, :, : ((start_image.shape[0] - 1) // 4) + 1] = 0.0

        positive = node_helpers.conditioning_set_values(
            positive, {"concat_latent_image": concat_latent_image, "concat_mask": mask}
        )
        negative = node_helpers.conditioning_set_values(
            negative, {"concat_latent_image": concat_latent_image, "concat_mask": mask}
        )

        if clip_vision_output is not None:
            positive = node_helpers.conditioning_set_values(
                positive, {"clip_vision_output": clip_vision_output}
            )
            negative = node_helpers.conditioning_set_values(
                negative, {"clip_vision_output": clip_vision_output}
            )

    out_latent = {"samples": latent}
    return positive, negative, out_latent


def wan_first_last_frame_to_video(
    positive: Any,
    negative: Any,
    vae: Any,
    width: int,
    height: int,
    length: int,
    batch_size: int,
    start_image: Any | None = None,
    end_image: Any | None = None,
    clip_vision_output: Any | None = None,
) -> tuple[Any, Any, dict]:
    """Conditions the Wan I2V latent on both a start image and an end image.

    Returns (positive, negative, out_latent). Latent is empty 16ch @ 1/8;
    encodes start_image into the first latent position and end_image into the
    last latent position using the same 16ch @ 1/8 concat pattern as
    wan_image_to_video. The concat mask marks [:1] and [-1:] as 0.0
    (conditioned) and everything else as 1.0 (free to denoise).
    """
    _ensure_comfy()
    import torch
    import comfy.model_management
    import comfy.utils
    import node_helpers

    latent = torch.zeros(
        [batch_size, 16, ((length - 1) // 4) + 1, height // 8, width // 8],
        device=comfy.model_management.intermediate_device(),
    )

    if start_image is not None or end_image is not None:
        ref = start_image if start_image is not None else end_image
        image = torch.ones(
            (length, height, width, ref.shape[-1]),
            device=ref.device,
            dtype=ref.dtype,
        ) * 0.5

        if start_image is not None:
            start_image = comfy.utils.common_upscale(
                start_image[:length].movedim(-1, 1), width, height, "bilinear", "center"
            ).movedim(1, -1)
            image[: start_image.shape[0]] = start_image

        if end_image is not None:
            end_image = comfy.utils.common_upscale(
                end_image[:length].movedim(-1, 1), width, height, "bilinear", "center"
            ).movedim(1, -1)
            image[length - end_image.shape[0] :] = end_image

        concat_latent_image = vae.encode(image[:, :, :, :3])
        mask = torch.ones(
            (1, 1, latent.shape[2], concat_latent_image.shape[-2], concat_latent_image.shape[-1]),
            device=image.device,
            dtype=image.dtype,
        )
        mask[:, :, :1] = 0.0
        mask[:, :, -1:] = 0.0

        positive = node_helpers.conditioning_set_values(
            positive, {"concat_latent_image": concat_latent_image, "concat_mask": mask}
        )
        negative = node_helpers.conditioning_set_values(
            negative, {"concat_latent_image": concat_latent_image, "concat_mask": mask}
        )

        if clip_vision_output is not None:
            positive = node_helpers.conditioning_set_values(
                positive, {"clip_vision_output": clip_vision_output}
            )
            negative = node_helpers.conditioning_set_values(
                negative, {"clip_vision_output": clip_vision_output}
            )

    out_latent = {"samples": latent}
    return positive, negative, out_latent


def apply_model_sampling_shift(
    model: Any, shift: float = 5.0, multiplier: float = 1000.0
) -> Any:
    """Apply ModelSamplingSD3-style patch for flow models (Wan uses FLOW sampling)."""
    _ensure_comfy()
    import comfy.model_sampling

    m = model.clone()
    sampling_base = comfy.model_sampling.ModelSamplingDiscreteFlow
    sampling_type = comfy.model_sampling.CONST

    class ModelSamplingAdvanced(sampling_base, sampling_type):
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift, multiplier=multiplier)
    m.add_object_patch("model_sampling", model_sampling)
    return m


def save_frames_as_video(
    frames: list[Image.Image],
    path: str | Path,
    fps: float = 16.0,
) -> None:
    """Write a list of PIL images to an MP4 file using PyAV (av)."""
    try:
        import av
    except ImportError:
        out_dir = Path(path).with_suffix("")
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, img in enumerate(frames):
            img.save(out_dir / f"frame_{i:04d}.png")
        raise RuntimeError(
            "PyAV (av) not available; install with: uv add av. "
            f"Saved {len(frames)} frames to {out_dir}/"
        ) from None

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not frames:
        raise ValueError("frames must not be empty")

    w, h = frames[0].size
    container = av.open(str(path), "w")
    rate = Fraction(int(fps), 1) if fps == int(fps) else Fraction(round(fps * 1000), 1000)
    stream = container.add_stream("libx264", rate=rate, options={"crf": "18"})
    stream.width = w
    stream.height = h
    stream.pix_fmt = "yuv420p"

    for i, pil_img in enumerate(frames):
        frame = av.VideoFrame.from_image(pil_img)
        frame.pts = i
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
