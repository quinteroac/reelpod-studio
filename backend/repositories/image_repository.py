from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, NamedTuple

from models.constants import (
    ANIMA_COMFY_CFG,
    ANIMA_COMFY_CLIP,
    ANIMA_COMFY_CLIP_TYPE,
    ANIMA_COMFY_MODELS_DIR,
    ANIMA_COMFY_SAMPLER,
    ANIMA_COMFY_SCHEDULER,
    ANIMA_COMFY_STEPS,
    ANIMA_COMFY_UNET,
    ANIMA_COMFY_VAE,
    IMAGE_NUM_INFERENCE_STEPS,
    REAL_ESRGAN_ANIME_WEIGHTS_FILENAME,
    REAL_ESRGAN_ANIME_WEIGHTS_URL,
    REAL_ESRGAN_SCALE,
)


class AnimaComfyPipeline(NamedTuple):
    """Anima image pipeline: UNet + CLIP + VAE loaded via comfy-diffusion ModelManager."""

    model: Any
    clip: Any
    vae: Any


def _ensure_comfyui_vendor_on_path() -> None:
    """Prepend our vendor ComfyUI to sys.path so comfy-diffusion finds it (PyPI wheel has no vendor)."""
    backend_dir = Path(__file__).resolve().parents[1]
    comfyui_dir = backend_dir / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
    if comfyui_dir.is_dir() and (comfyui_dir / "comfyui_version.py").exists():
        path_str = str(comfyui_dir)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


def _get_anima_models_dir() -> Path:
    if not ANIMA_COMFY_MODELS_DIR or not ANIMA_COMFY_MODELS_DIR.strip():
        raise RuntimeError(
            "ANIMA_COMFY_MODELS_DIR or PYCOMFY_MODELS_DIR must be set to the comfy-diffusion models root "
            "(directory containing diffusion_models/, text_encoders/, vae/)"
        )
    path = Path(ANIMA_COMFY_MODELS_DIR.strip())
    if not path.is_dir():
        raise RuntimeError(f"ANIMA_COMFY_MODELS_DIR is not an existing directory: {path}")
    return path


def _round_to_multiple_of_8(value: int) -> int:
    """Latent dimensions must be multiples of 8."""
    return max(8, (value + 4) // 8 * 8)


def _empty_latent(width: int, height: int, batch_size: int = 1) -> dict[str, Any]:
    """Build empty LATENT dict for txt2img (ComfyUI contract)."""
    _ensure_comfyui_vendor_on_path()
    from comfy_diffusion._runtime import ensure_comfyui_on_path

    ensure_comfyui_on_path()
    import torch
    import comfy.model_management

    device = comfy.model_management.intermediate_device()
    latent = torch.zeros(
        [batch_size, 4, height // 8, width // 8],
        device=device,
    )
    return {"samples": latent, "downscale_ratio_spacial": 8}


def load_image_pipeline() -> AnimaComfyPipeline:
    """Load Anima UNet, CLIP, VAE via comfy-diffusion ModelManager (separate components)."""
    _ensure_comfyui_vendor_on_path()

    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for image generation. Install it with: uv add torch torchvision"
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
        raise RuntimeError("CUDA is required to run the Anima image pipeline.")

    models_dir = _get_anima_models_dir()
    if not ANIMA_COMFY_UNET.strip():
        raise RuntimeError("ANIMA_COMFY_UNET or PYCOMFY_ANIMA_UNET must be set")
    if not ANIMA_COMFY_CLIP.strip():
        raise RuntimeError("ANIMA_COMFY_CLIP or PYCOMFY_ANIMA_CLIP must be set")
    if not ANIMA_COMFY_VAE.strip():
        raise RuntimeError("ANIMA_COMFY_VAE or PYCOMFY_ANIMA_VAE must be set")

    manager = ModelManager(str(models_dir))
    model = manager.load_unet(ANIMA_COMFY_UNET.strip())
    clip = manager.load_clip(ANIMA_COMFY_CLIP.strip(), clip_type=ANIMA_COMFY_CLIP_TYPE)
    vae = manager.load_vae(ANIMA_COMFY_VAE.strip())
    return AnimaComfyPipeline(model=model, clip=clip, vae=vae)


def run_image_inference(
    pipeline: AnimaComfyPipeline,
    *,
    prompt: str,
    seed: int,
    negative_prompt: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> Any:
    """Run txt2img with comfy-diffusion sample + vae_decode. Returns a single PIL Image."""
    from comfy_diffusion import vae_decode
    from comfy_diffusion.conditioning import encode_prompt
    from comfy_diffusion.sampling import sample

    steps = IMAGE_NUM_INFERENCE_STEPS
    w = _round_to_multiple_of_8(width) if width is not None else 1024
    h = _round_to_multiple_of_8(height) if height is not None else 1024

    positive = encode_prompt(pipeline.clip, prompt)
    negative = encode_prompt(pipeline.clip, negative_prompt or "blurry, low quality, distorted")

    latent = _empty_latent(w, h, batch_size=1)
    denoised = sample(
        pipeline.model,
        positive,
        negative,
        latent,
        steps=steps,
        cfg=ANIMA_COMFY_CFG,
        sampler_name=ANIMA_COMFY_SAMPLER,
        scheduler=ANIMA_COMFY_SCHEDULER,
        seed=seed,
        denoise=1.0,
    )
    image = vae_decode(pipeline.vae, denoised)
    if image is None:
        raise RuntimeError("No generated image returned by model")
    return image


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
