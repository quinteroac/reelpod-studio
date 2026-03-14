"""Audio generation via comfy-diffusion ACE Step 1.5 (text-to-audio)."""

from __future__ import annotations

import io
import logging
import sys
import tempfile
from pathlib import Path
from typing import Any, NamedTuple

from models.constants import (
    DEFAULT_DURATION_SECONDS,
    ACE_COMFY_MODELS_DIR,
    ACE_COMFY_UNET,
    ACE_COMFY_TEXT_ENCODER,
    ACE_COMFY_VAE,
    ACE_COMFY_STEPS,
    ACE_COMFY_CFG,
    ACE_COMFY_SAMPLER,
    ACE_COMFY_SCHEDULER,
    ACE_COMFY_TRIM_END_SECONDS,
)

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

_cached_pipeline: AceComfyPipeline | None = None
_cached_load_error: str | None = None

ACE_SAMPLE_RATE = 44100


class AceComfyPipeline(NamedTuple):
    """ACE Step 1.5 pipeline: separately loaded model, CLIP, and VAE."""

    model: Any
    clip: Any
    vae: Any


def _ensure_comfyui_vendor_on_path() -> None:
    """Prepend our vendor ComfyUI to sys.path so comfy-diffusion finds it."""
    backend_dir = Path(__file__).resolve().parents[1]
    comfyui_dir = backend_dir / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
    if comfyui_dir.is_dir() and (comfyui_dir / "comfyui_version.py").exists():
        path_str = str(comfyui_dir)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


def _get_ace_models_dir() -> Path:
    if not ACE_COMFY_MODELS_DIR or not ACE_COMFY_MODELS_DIR.strip():
        raise RuntimeError(
            "ACE_COMFY_MODELS_DIR or PYCOMFY_MODELS_DIR must be set to the comfy-diffusion models root "
            "(directory containing checkpoints/, diffusion_models/, vae/, etc.)"
        )
    path = Path(ACE_COMFY_MODELS_DIR.strip())
    if not path.is_dir():
        raise RuntimeError(f"ACE_COMFY_MODELS_DIR is not an existing directory: {path}")
    return path


def _negative_conditioning_ace(clip: Any, duration: float) -> Any:
    """Return negative conditioning for ACE (empty tags, minimal duration)."""
    from comfy_diffusion.audio import encode_ace_step_15_audio

    return encode_ace_step_15_audio(
        clip,
        tags="",
        lyrics="",
        seed=0,
        bpm=120,
        duration=min(1.0, duration),
        timesignature="4",
        language="en",
        keyscale="C major",
        generate_audio_codes=False,
        cfg_scale=2.0,
    )


def load_audio_pipeline() -> AceComfyPipeline:
    """Load ACE Step 1.5 model, CLIP, and VAE from separate files via comfy-diffusion."""
    global _cached_pipeline, _cached_load_error

    _ensure_comfyui_vendor_on_path()

    if _cached_pipeline is not None:
        return _cached_pipeline
    if _cached_load_error is not None:
        raise RuntimeError(_cached_load_error)

    try:
        from comfy_diffusion import check_runtime
        from comfy_diffusion.models import ModelManager
    except ImportError as exc:
        _cached_load_error = f"comfy-diffusion not available: {exc}"
        raise RuntimeError(_cached_load_error) from exc

    runtime = check_runtime()
    if runtime.get("error"):
        err = runtime["error"]
        comfyui_dir = Path(__file__).resolve().parents[1] / "vendor" / "comfy-diffusion" / "vendor" / "ComfyUI"
        if "comfyui_version" in str(err) and not (comfyui_dir / "comfyui_version.py").exists():
            _cached_load_error = (
                f"comfy-diffusion runtime check failed: {err}. "
                "Install ComfyUI vendor with: bash backend/scripts/setup-comfy-diffusion.sh"
            )
        else:
            _cached_load_error = f"comfy-diffusion runtime check failed: {err}"
        raise RuntimeError(_cached_load_error)

    models_dir = _get_ace_models_dir()
    if not ACE_COMFY_UNET.strip():
        _cached_load_error = "ACE_COMFY_UNET or PYCOMFY_ACE_UNET must be set"
        raise RuntimeError(_cached_load_error)
    if not ACE_COMFY_TEXT_ENCODER.strip():
        _cached_load_error = "ACE_COMFY_TEXT_ENCODER or PYCOMFY_ACE_TEXT_ENCODER must be set"
        raise RuntimeError(_cached_load_error)
    if not ACE_COMFY_VAE.strip():
        _cached_load_error = "ACE_COMFY_VAE or PYCOMFY_ACE_VAE must be set"
        raise RuntimeError(_cached_load_error)

    try:
        manager = ModelManager(str(models_dir))
        model = manager.load_unet(ACE_COMFY_UNET.strip())
        clip = manager.load_clip(ACE_COMFY_TEXT_ENCODER.strip())
        vae = manager.load_vae(ACE_COMFY_VAE.strip())
        _cached_pipeline = AceComfyPipeline(model=model, clip=clip, vae=vae)
        return _cached_pipeline
    except Exception as exc:
        _cached_load_error = str(exc)
        raise RuntimeError(_cached_load_error) from exc


def generate_audio_bytes_for_prompt(
    prompt: str,
    tempo: int = 80,
    duration: int = DEFAULT_DURATION_SECONDS,
) -> bytes:
    """Generate WAV bytes using ACE Step 1.5 via comfy-diffusion.

    prompt: tags/description (e.g. "warm lofi ambient, 90 BPM")
    tempo: BPM
    duration: length in seconds
    """
    from comfy_diffusion.audio import encode_ace_step_15_audio, empty_ace_step_15_latent_audio
    from comfy_diffusion.sampling import sample

    pipeline = load_audio_pipeline()
    duration_f = float(duration)

    positive = encode_ace_step_15_audio(
        pipeline.clip,
        tags=prompt,
        lyrics="",
        seed=0,
        bpm=tempo,
        duration=duration_f,
        timesignature="4",
        language="en",
        keyscale="C major",
        generate_audio_codes=True,
        cfg_scale=ACE_COMFY_CFG,
    )
    negative = _negative_conditioning_ace(pipeline.clip, duration_f)

    latent = empty_ace_step_15_latent_audio(seconds=duration_f, batch_size=1)
    denoised = sample(
        pipeline.model,
        positive,
        negative,
        latent,
        steps=ACE_COMFY_STEPS,
        cfg=ACE_COMFY_CFG,
        sampler_name=ACE_COMFY_SAMPLER,
        scheduler=ACE_COMFY_SCHEDULER,
        seed=0,
        denoise=1.0,
    )

    samples_tensor = denoised["samples"]
    waveform = pipeline.vae.decode(samples_tensor)
    if hasattr(waveform, "cpu"):
        waveform = waveform.cpu()
    if waveform.dim() == 3:
        waveform = waveform[0]

    trim_end = ACE_COMFY_TRIM_END_SECONDS
    if trim_end > 0:
        total_samples = waveform.shape[-1]
        min_keep_samples = int(ACE_SAMPLE_RATE * 1.0)
        max_trim = max(0, total_samples - min_keep_samples)
        trim_samples = min(int(ACE_SAMPLE_RATE * trim_end), max_trim)
        if trim_samples > 0:
            waveform = waveform[..., :-trim_samples].contiguous()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_path = f.name
    try:
        try:
            import torchaudio
            torchaudio.save(tmp_path, waveform, ACE_SAMPLE_RATE)
        except ImportError:
            import numpy as np
            wav = waveform.numpy() if hasattr(waveform, "numpy") else np.asarray(waveform)
            wav = np.squeeze(wav)
            wav = (np.clip(wav, -1.0, 1.0) * 32767).astype(np.int16)
            try:
                from scipy.io import wavfile
                wavfile.write(tmp_path, ACE_SAMPLE_RATE, wav)
            except ImportError:
                raise RuntimeError("Install torchaudio or scipy to save WAV") from None
        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
