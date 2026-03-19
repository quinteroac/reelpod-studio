"""Video generation via comfy-diffusion (Wan 2.2 image-to-video).

Pipeline is loaded from WAN_COMFY_MODELS_DIR (or PYCOMFY_MODELS_DIR).
Set WAN_COMFY_UNET_HIGH, WAN_COMFY_UNET_LOW, WAN_COMFY_CLIP, WAN_COMFY_VAE to model filenames.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, NamedTuple

from models.constants import (
    REAL_ESRGAN_VIDEO_WEIGHTS_FILENAME,
    REAL_ESRGAN_VIDEO_WEIGHTS_URL,
    WAN_VIDEO_CLIP_DURATION_SECONDS,
    WAN_VIDEO_FPS,
    WAN_VIDEO_RESOLUTIONS,
    WAN_COMFY_MODELS_DIR,
    WAN_COMFY_UNET_HIGH,
    WAN_COMFY_UNET_LOW,
    WAN_COMFY_LORA_LOW,
    WAN_COMFY_LORA_LOW_STRENGTH,
    WAN_COMFY_LORA_LOW_TRIGGER,
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
    wan_first_last_frame_to_video,
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


class RealEsrganVideoUpsamplerConfig(NamedTuple):
    upsampler: Any
    gpu_id: int | None
    half: bool


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


def _apply_lora_to_model(
    models_dir: Path,
    model: Any,
    clip: Any,
    lora_name: str,
    strength_model: float,
    strength_clip: float = 0.0,
) -> tuple[Any, Any]:
    """Load a LoRA file and apply it to the model and CLIP via comfy-diffusion apply_lora."""
    from comfy_diffusion.lora import apply_lora

    lora_path: str | None = None
    p = Path(lora_name.strip())
    if p.is_absolute() and p.is_file():
        lora_path = str(p)
    elif p.is_file():
        lora_path = str(p.resolve())
    elif models_dir:
        fallback = models_dir / "loras" / p.name
        if fallback.is_file():
            lora_path = str(fallback)
    if lora_path is None:
        raise FileNotFoundError(
            f"LoRA file not found: {lora_name!r} (tried cwd and <models-dir>/loras/)"
        )
    model_patched, clip_patched = apply_lora(model, clip, lora_path, strength_model, strength_clip)
    return model_patched, clip_patched


def pick_wan_resolution(target_width: int, target_height: int) -> tuple[int, int]:
    """Choose the Wan-supported resolution whose aspect ratio best matches the target."""
    target_aspect = target_width / target_height
    best = min(
        WAN_VIDEO_RESOLUTIONS.values(),
        key=lambda wh: abs((wh[0] / wh[1]) - target_aspect),
    )
    return best


def _ensure_comfyui_vendor_on_path() -> None:
    """Prepend our vendor ComfyUI to sys.path so comfy-diffusion finds it (PyPI wheel has no vendor)."""
    backend_dir = Path(__file__).resolve().parents[1]
    comfyui_dir = backend_dir / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
    if comfyui_dir.is_dir() and (comfyui_dir / "comfyui_version.py").exists():
        path_str = str(comfyui_dir)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


def load_video_pipeline() -> WanComfyPipeline:
    """Load Wan 2.2 I2V models via comfy-diffusion ModelManager.

    Requires WAN_COMFY_MODELS_DIR (or PYCOMFY_MODELS_DIR) and model filenames
    (WAN_COMFY_UNET_HIGH, WAN_COMFY_UNET_LOW, WAN_COMFY_CLIP, WAN_COMFY_VAE).
    """
    global _cached_pipeline, _cached_load_error

    _ensure_comfyui_vendor_on_path()

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
        err = runtime["error"]
        comfyui_dir = Path(__file__).resolve().parents[1] / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
        if "comfyui_version" in str(err) and not (comfyui_dir / "comfyui_version.py").exists():
            raise RuntimeError(
                f"comfy-diffusion runtime check failed: {err}. "
                "Install ComfyUI vendor with: bash backend/scripts/setup-comfy-diffusion.sh"
            )
        raise RuntimeError(f"comfy-diffusion runtime check failed: {err}")

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
    try:
        model_high = manager.load_unet(WAN_COMFY_UNET_HIGH.strip())
    except Exception as exc:
        raise RuntimeError(f"Wan pipeline failed while loading UNET (high): {exc}") from exc
    try:
        model_low = manager.load_unet(WAN_COMFY_UNET_LOW.strip())
    except Exception as exc:
        raise RuntimeError(f"Wan pipeline failed while loading UNET (low): {exc}") from exc
    try:
        clip = manager.load_clip(WAN_COMFY_CLIP.strip(), clip_type="wan")
    except Exception as exc:
        raise RuntimeError(f"Wan pipeline failed while loading CLIP: {exc}") from exc
    if WAN_COMFY_LORA_LOW and WAN_COMFY_LORA_LOW.strip():
        try:
            model_low, clip = _apply_lora_to_model(
                models_dir, model_low, clip, WAN_COMFY_LORA_LOW.strip(), WAN_COMFY_LORA_LOW_STRENGTH
            )
        except Exception as exc:
            raise RuntimeError(f"Wan pipeline failed while applying LoRA (low): {exc}") from exc
    try:
        vae = manager.load_vae(WAN_COMFY_VAE.strip())
    except Exception as exc:
        raise RuntimeError(f"Wan pipeline failed while loading VAE: {exc}") from exc

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

    # If low LoRA trigger keyword is set, prepend it to the prompt
    effective_prompt = prompt
    if WAN_COMFY_LORA_LOW_TRIGGER and WAN_COMFY_LORA_LOW_TRIGGER.strip():
        effective_prompt = f"{WAN_COMFY_LORA_LOW_TRIGGER.strip()}, {prompt}"

    # Encode prompts
    positive = encode_prompt(pipeline.clip, effective_prompt)
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


def _normalize_bridge_frame_colors(
    frames: list[Any],
    start_ref: "Image.Image",
    end_ref: "Image.Image",
) -> list[Any]:
    """Per-channel mean/std normalization with a linear gradient across frames.

    Frame 0 is normalized so its channel statistics match start_ref (clip1_last).
    The last frame is normalized to match end_ref (clip1_first).
    Intermediate frames interpolate between the two references.
    This eliminates WAN-generated brightness flashes at the join and loop points.
    """
    import numpy as np
    from PIL import Image

    n = len(frames)
    if n == 0:
        return frames

    ref_start = np.array(start_ref.convert("RGB")).astype(np.float32)
    ref_end = np.array(end_ref.convert("RGB")).astype(np.float32)

    def _stats(arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        mean = arr.mean(axis=(0, 1))
        std = arr.std(axis=(0, 1)) + 1e-6
        return mean, std

    start_mean, start_std = _stats(ref_start)
    end_mean, end_std = _stats(ref_end)

    normalized: list[Any] = []
    for i, pil_img in enumerate(frames):
        t = i / max(n - 1, 1)
        ref_mean = (1.0 - t) * start_mean + t * end_mean
        ref_std = (1.0 - t) * start_std + t * end_std

        arr = np.array(pil_img.convert("RGB")).astype(np.float32)
        frame_mean, frame_std = _stats(arr)

        for c in range(3):
            arr[:, :, c] = (arr[:, :, c] - frame_mean[c]) / frame_std[c] * ref_std[c] + ref_mean[c]

        normalized.append(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)))
    return normalized


def run_bridge_inference(
    pipeline: WanComfyPipeline,
    *,
    clip1_path: Path,
    prompt: str,
    target_width: int,
    target_height: int,
    temp_dir: Path,
) -> Path:
    """Generate a bridge clip animating from the last frame of clip1 back to its first frame.

    Extracts frame 0 (first) and the last frame from clip1_path via PyAV, then calls
    wan_first_last_frame_to_video with start_image=last_frame, end_image=first_frame.
    Output duration matches WAN_VIDEO_CLIP_DURATION_SECONDS.
    """
    import av
    from PIL import Image
    import numpy as np

    from comfy_diffusion import vae_decode_batch
    from comfy_diffusion.conditioning import encode_prompt
    from comfy_diffusion.sampling import sample_advanced
    from comfy_diffusion._runtime import ensure_comfyui_on_path

    ensure_comfyui_on_path()
    import comfy.model_management
    import torch

    # Extract first and last frames from clip1 via PyAV
    first_frame_pil: Image.Image | None = None
    last_frame_pil: Image.Image | None = None
    container = av.open(str(clip1_path))
    try:
        video_stream = container.streams.video[0]
        for frame in container.decode(video_stream):
            arr = frame.to_ndarray(format="rgb24")
            pil = Image.fromarray(arr)
            if first_frame_pil is None:
                first_frame_pil = pil
            last_frame_pil = pil
    finally:
        container.close()

    if first_frame_pil is None or last_frame_pil is None:
        raise RuntimeError(f"Could not extract frames from clip: {clip1_path}")

    wan_width, wan_height = pick_wan_resolution(target_width, target_height)
    first_resized = first_frame_pil.resize((wan_width, wan_height), Image.Resampling.LANCZOS)
    last_resized = last_frame_pil.resize((wan_width, wan_height), Image.Resampling.LANCZOS)

    # Number of frames: must be (4*n)+1 for Wan latent; match clip duration at 16 fps
    target_frames = int(WAN_VIDEO_CLIP_DURATION_SECONDS * WAN_VIDEO_FPS)
    length = max(5, ((target_frames - 1) // 4) * 4 + 1)

    # If low LoRA trigger keyword is set, prepend it to the prompt
    effective_prompt = prompt
    if WAN_COMFY_LORA_LOW_TRIGGER and WAN_COMFY_LORA_LOW_TRIGGER.strip():
        effective_prompt = f"{WAN_COMFY_LORA_LOW_TRIGGER.strip()}, {prompt}"

    # Encode prompts
    positive = encode_prompt(pipeline.clip, effective_prompt)
    negative = encode_prompt(pipeline.clip, WAN_COMFY_NEGATIVE_PROMPT)

    device = comfy.model_management.intermediate_device()

    def _to_tensor(img: Image.Image) -> Any:
        arr = np.array(img.convert("RGB"))
        return (torch.from_numpy(arr).float().to(device=device) / 255.0).unsqueeze(0)

    # Bridge: last frame → first frame (start=last, end=first)
    last_frame_tensor = _to_tensor(last_resized)
    first_frame_tensor = _to_tensor(first_resized)

    positive, negative, latent = wan_first_last_frame_to_video(
        positive,
        negative,
        pipeline.vae,
        wan_width,
        wan_height,
        length,
        batch_size=1,
        start_image=last_frame_tensor,
        end_image=first_frame_tensor,
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

    # Color-normalize each bridge frame so the join (bridge_start ≈ clip1_last)
    # and the loop boundary (bridge_end ≈ clip1_first) are chromatically consistent,
    # removing any WAN-generated brightness flash at the transition points.
    frames = _normalize_bridge_frame_colors(
        frames,
        start_ref=last_resized,  # bridge should start looking like clip1_last
        end_ref=first_resized,   # bridge should end looking like clip1_first
    )

    output_path = temp_dir / "wan_bridge.mp4"
    save_frames_as_video(frames, output_path, fps=WAN_VIDEO_FPS)
    return output_path


def _apply_torchvision_compat_shim() -> None:
    """Shim for torchvision 0.17+: basicsr expects torchvision.transforms.functional_tensor."""
    if "torchvision.transforms.functional_tensor" in sys.modules:
        return
    try:
        from torchvision.transforms import functional as _functional
    except ImportError:
        return

    import types

    shim = types.ModuleType("torchvision.transforms.functional_tensor")
    shim.rgb_to_grayscale = getattr(_functional, "rgb_to_grayscale", None)
    if shim.rgb_to_grayscale is not None:
        sys.modules["torchvision.transforms.functional_tensor"] = shim


def _ensure_realesrgan_video_weights() -> Path:
    """Ensure Real-ESRGAN anime-video weights exist under backend/.realesrgan/, downloading if needed."""
    from repositories.image_repository import _download_realesrgan_weights, _get_realesrgan_weights_dir

    weights_dir = _get_realesrgan_weights_dir()
    weights_path = weights_dir / REAL_ESRGAN_VIDEO_WEIGHTS_FILENAME
    if weights_path.is_file():
        logger.info("Real-ESRGAN video weights already available at %s", weights_path)
        return weights_path
    weights_dir.mkdir(parents=True, exist_ok=True)
    _download_realesrgan_weights(
        download_url=REAL_ESRGAN_VIDEO_WEIGHTS_URL,
        destination=weights_path,
    )
    return weights_path


def ensure_realesrgan_video_weights() -> Path:
    return _ensure_realesrgan_video_weights()


def build_realesrgan_video_upsampler(
    *,
    tile: int = 256,
    tile_pad: int = 10,
) -> RealEsrganVideoUpsamplerConfig:
    """Build Real-ESRGAN upsampler for anime video using SRVGGNetCompact."""
    _apply_torchvision_compat_shim()
    import torch
    from realesrgan import RealESRGANer
    from realesrgan.archs.srvgg_arch import SRVGGNetCompact

    weights_path = _ensure_realesrgan_video_weights()
    gpu_available = torch.cuda.is_available()
    gpu_id = 0 if gpu_available else None
    half = gpu_available
    model = SRVGGNetCompact(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_conv=16,
        upscale=4,
        act_type="prelu",
    )
    upsampler = RealESRGANer(
        scale=4,
        model_path=str(weights_path),
        model=model,
        tile=tile,
        tile_pad=tile_pad,
        pre_pad=0,
        half=half,
        gpu_id=gpu_id,
    )
    return RealEsrganVideoUpsamplerConfig(
        upsampler=upsampler,
        gpu_id=gpu_id,
        half=half,
    )


def upscale_video_with_realesrgan_and_resize(
    input_path: Path,
    output_path: Path,
    *,
    target_width: int,
    target_height: int,
    tile: int = 256,
    tile_pad: int = 10,
) -> None:
    """Upscale each frame 4x with Real-ESRGAN, then resize to exact target dimensions."""
    import av
    from fractions import Fraction

    import numpy as np
    from PIL import Image

    config = build_realesrgan_video_upsampler(tile=tile, tile_pad=tile_pad)
    input_container = av.open(str(input_path))
    output_container = av.open(str(output_path), mode="w")
    output_stream = None
    frame_count = 0
    fps_value = float(WAN_VIDEO_FPS)

    try:
        input_video_stream = input_container.streams.video[0]
        if input_video_stream.average_rate is not None:
            fps_value = float(input_video_stream.average_rate)

        # PyAV add_stream(rate=...) expects a rational (Fraction), not float
        rate_rational = Fraction(str(fps_value))
        output_stream = output_container.add_stream("libx264", rate=rate_rational)
        output_stream.width = target_width
        output_stream.height = target_height
        output_stream.pix_fmt = "yuv420p"

        for frame in input_container.decode(input_video_stream):
            frame_count += 1
            rgb = frame.to_ndarray(format="rgb24")
            bgr = rgb[..., ::-1].copy()
            upscaled_bgr, _ = config.upsampler.enhance(bgr, outscale=4)
            upscaled_rgb = upscaled_bgr[..., ::-1].copy()
            resized_rgb = np.array(
                Image.fromarray(upscaled_rgb).resize(
                    (target_width, target_height),
                    Image.Resampling.LANCZOS,
                )
            )
            encoded_frame = av.VideoFrame.from_ndarray(resized_rgb, format="rgb24")
            for packet in output_stream.encode(encoded_frame):
                output_container.mux(packet)

        if frame_count == 0:
            raise RuntimeError("Video upscale failed: no frames decoded")

        for packet in output_stream.encode():
            output_container.mux(packet)
    finally:
        try:
            input_container.close()
        except Exception:
            pass
        try:
            output_container.close()
        except Exception:
            pass
