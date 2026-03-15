from __future__ import annotations

import logging
import sys
import urllib.error
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from PIL import Image

from models import constants
from repositories import image_repository
from services import image_service


class _FakeAnimaComfyPipeline:
    """Fake pipeline (model, clip, vae) for tests."""

    pass


def _install_fake_comfy_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_torch = ModuleType("torch")
    fake_torch.bfloat16 = object()

    class _FakeCuda:
        @staticmethod
        def is_available() -> bool:
            return True

        @staticmethod
        def mem_get_info() -> tuple[int, int]:
            gib = 1024**3
            return (10 * gib, 16 * gib)

    fake_torch.cuda = _FakeCuda()

    def fake_check_runtime() -> dict[str, Any]:
        return {"comfyui_version": "0.16.3", "device": "cuda:0"}

    class FakeModelManager:
        def __init__(self, models_dir: str) -> None:
            self.models_dir = models_dir

        def load_unet(self, path: str) -> Any:
            return "unet"

        def load_clip(self, path: str, *, clip_type: str = "stable_diffusion") -> Any:
            return "clip"

        def load_vae(self, path: str) -> Any:
            return "vae"

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr("comfy_diffusion.check_runtime", fake_check_runtime)
    monkeypatch.setattr("comfy_diffusion.models.ModelManager", FakeModelManager)


def test_load_image_pipeline_returns_anima_comfy_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(image_repository, "ANIMA_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(image_repository, "ANIMA_COMFY_UNET", "unet.safetensors")
    monkeypatch.setattr(image_repository, "ANIMA_COMFY_CLIP", "clip.safetensors")
    monkeypatch.setattr(image_repository, "ANIMA_COMFY_VAE", "vae.safetensors")
    _install_fake_comfy_modules(monkeypatch)
    monkeypatch.setattr(image_repository, "_ensure_comfyui_vendor_on_path", lambda: None)

    pipeline = image_repository.load_image_pipeline()

    assert isinstance(pipeline, image_repository.AnimaComfyPipeline)
    assert pipeline.model == "unet"
    assert pipeline.clip == "clip"
    assert pipeline.vae == "vae"


def test_load_image_pipeline_requires_models_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANIMA_COMFY_MODELS_DIR", raising=False)
    monkeypatch.delenv("PYCOMFY_MODELS_DIR", raising=False)
    _install_fake_comfy_modules(monkeypatch)
    monkeypatch.setattr(image_repository, "_ensure_comfyui_vendor_on_path", lambda: None)

    with pytest.raises(RuntimeError, match="ANIMA_COMFY_MODELS_DIR"):
        image_repository.load_image_pipeline()


def test_constants_define_anima_comfy_env_defaults() -> None:
    assert constants.ANIMA_COMFY_STEPS == 25
    assert constants.IMAGE_NUM_INFERENCE_STEPS == constants.ANIMA_COMFY_STEPS
    assert constants.ANIMA_PREVIEW_SIZES == ((1280, 720), (720, 1280), (1024, 1024))


def test_get_realesrgan_weights_dir_uses_env_override_or_backend_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    env_dir = tmp_path / "env-weights"
    monkeypatch.setenv("REAL_ESRGAN_WEIGHTS_DIR", str(env_dir))
    assert image_repository._get_realesrgan_weights_dir() == env_dir

    monkeypatch.delenv("REAL_ESRGAN_WEIGHTS_DIR", raising=False)
    assert image_repository._get_realesrgan_weights_dir().as_posix().endswith(
        "backend/.realesrgan"
    )


def test_ensure_realesrgan_anime_weights_skips_download_when_file_exists(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    weights_dir = tmp_path / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    existing = weights_dir / constants.REAL_ESRGAN_ANIME_WEIGHTS_FILENAME
    existing.write_bytes(b"already-there")
    monkeypatch.setenv("REAL_ESRGAN_WEIGHTS_DIR", str(weights_dir))

    called = {"download": False}

    def fake_download(*args: Any, **kwargs: Any) -> None:
        called["download"] = True

    monkeypatch.setattr(image_repository, "_download_realesrgan_weights", fake_download)

    resolved = image_repository.ensure_realesrgan_anime_weights()
    assert resolved == existing
    assert called["download"] is False


def test_ensure_realesrgan_anime_weights_downloads_missing_file_with_progress(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    class _FakeResponse:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self._offset = 0
            self.headers = {"Content-Length": str(len(payload))}

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

        def read(self, size: int = -1) -> bytes:
            if self._offset >= len(self._payload):
                return b""
            if size < 0:
                size = len(self._payload) - self._offset
            chunk = self._payload[self._offset : self._offset + size]
            self._offset += len(chunk)
            return chunk

    weights_dir = tmp_path / "weights"
    monkeypatch.setenv("REAL_ESRGAN_WEIGHTS_DIR", str(weights_dir))
    caplog.set_level(logging.INFO)
    seen: dict[str, Any] = {}
    payload = (b"abcdef" * 300_000)[:1_500_000]

    def fake_urlopen(url: str) -> _FakeResponse:
        seen["url"] = url
        return _FakeResponse(payload)

    monkeypatch.setattr(image_repository.urllib.request, "urlopen", fake_urlopen)

    resolved = image_repository.ensure_realesrgan_anime_weights()
    assert resolved == weights_dir / constants.REAL_ESRGAN_ANIME_WEIGHTS_FILENAME
    assert resolved.read_bytes() == payload
    assert seen["url"] == constants.REAL_ESRGAN_ANIME_WEIGHTS_URL
    assert "Downloading Real-ESRGAN weights" in caplog.text
    assert "Real-ESRGAN weights download progress:" in caplog.text


def test_constants_define_realesrgan_animevideov3_weights_source() -> None:
    assert constants.REAL_ESRGAN_ANIME_WEIGHTS_FILENAME == "realesr-animevideov3.pth"
    assert (
        constants.REAL_ESRGAN_ANIME_WEIGHTS_URL
        == "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth"
    )


def test_image_service_startup_logs_model_loading_completion(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class _Pipeline:
        pass

    monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: _Pipeline())
    monkeypatch.setattr(
        image_repository,
        "ensure_realesrgan_anime_weights",
        lambda: Path("/tmp/realesr-animevideov3.pth"),
    )
    caplog.set_level(logging.INFO)

    image_service.startup()

    assert image_service.image_pipeline is not None
    assert image_service.image_model_load_error is None
    assert "Image generation model loading completed" in caplog.text


def test_image_service_startup_logs_weights_failure_but_does_not_crash(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class _Pipeline:
        pass

    monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: _Pipeline())
    monkeypatch.setattr(
        image_repository,
        "ensure_realesrgan_anime_weights",
        lambda: (_ for _ in ()).throw(urllib.error.URLError("network down")),
    )
    caplog.set_level(logging.INFO)

    image_service.startup()

    assert image_service.image_pipeline is not None
    assert image_service.image_model_load_error is None
    assert (
        "Real-ESRGAN startup weights check failed; continuing without guaranteed upscaling"
        in caplog.text
    )


def test_run_image_inference_calls_encode_and_sample_then_returns_pil(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    def fake_encode_prompt(clip: Any, text: str) -> Any:
        seen.setdefault("encode", []).append(("positive" if "blurry" not in text else "negative", text))
        return "cond"

    def fake_sample(
        model: Any,
        pos: Any,
        neg: Any,
        latent: Any,
        *,
        steps: int,
        cfg: float,
        sampler_name: str,
        scheduler: str,
        seed: int,
        denoise: float,
    ) -> Any:
        seen["sample"] = {
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "seed": seed,
            "denoise": denoise,
        }
        return {"samples": None}

    def fake_vae_decode(vae: Any, latent: Any) -> Image.Image:
        seen["vae_decode"] = True
        return Image.new("RGB", (64, 64), color=(1, 2, 3))

    def fake_empty_latent(width: int, height: int, batch_size: int = 1) -> dict[str, Any]:
        seen["empty_latent"] = (width, height, batch_size)
        return {"samples": None, "downscale_ratio_spacial": 8}

    pipeline = image_repository.AnimaComfyPipeline(model="m", clip="c", vae="v")
    monkeypatch.setattr("comfy_diffusion.conditioning.encode_prompt", fake_encode_prompt)
    monkeypatch.setattr("comfy_diffusion.sampling.sample", fake_sample)
    monkeypatch.setattr("comfy_diffusion.vae_decode", fake_vae_decode)
    monkeypatch.setattr(image_repository, "_empty_latent", fake_empty_latent)

    output = image_repository.run_image_inference(
        pipeline,
        prompt="misty mountains",
        seed=42,
    )

    assert output.size == (64, 64)
    assert seen["empty_latent"] == (1024, 1024, 1)
    assert seen["sample"]["steps"] == constants.IMAGE_NUM_INFERENCE_STEPS
    assert seen["sample"]["seed"] == 42
    assert seen["sample"]["denoise"] == 1.0
    assert seen["vae_decode"] is True


def test_run_image_inference_passes_negative_prompt_and_dimensions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    def fake_encode_prompt(clip: Any, text: str) -> Any:
        seen.setdefault("encode_texts", []).append(text)
        return "cond"

    def fake_sample(*args: Any, **kwargs: Any) -> Any:
        return {"samples": None}

    def fake_vae_decode(vae: Any, latent: Any) -> Image.Image:
        return Image.new("RGB", (32, 32), color=(1, 1, 1))

    def fake_empty_latent(width: int, height: int, batch_size: int = 1) -> dict[str, Any]:
        seen["empty_latent"] = (width, height, batch_size)
        return {"samples": None, "downscale_ratio_spacial": 8}

    pipeline = image_repository.AnimaComfyPipeline(model="m", clip="c", vae="v")
    monkeypatch.setattr("comfy_diffusion.conditioning.encode_prompt", fake_encode_prompt)
    monkeypatch.setattr("comfy_diffusion.sampling.sample", fake_sample)
    monkeypatch.setattr("comfy_diffusion.vae_decode", fake_vae_decode)
    monkeypatch.setattr(image_repository, "_empty_latent", fake_empty_latent)

    image_repository.run_image_inference(
        pipeline,
        prompt="city skyline",
        seed=7,
        negative_prompt="low quality, blurry",
        width=1920,
        height=1080,
    )

    assert "city skyline" in seen["encode_texts"][0]
    assert "low quality, blurry" in seen["encode_texts"][1]
    assert seen["empty_latent"] == (1920, 1080, 1)  # 1080 already multiple of 8


def test_upscale_image_with_realesrgan_anime_uses_expected_model_and_scale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import numpy as np

    image_repository._apply_torchvision_compat_shim()
    seen: dict[str, Any] = {}
    weights_dir = image_repository._get_realesrgan_weights_dir()
    weights_path = weights_dir / constants.REAL_ESRGAN_ANIME_WEIGHTS_FILENAME

    def fake_ensure_weights() -> Any:
        seen["ensure_weights_called"] = True
        return weights_path

    class FakeRealESRGANer:
        def __init__(self, *, scale: int, model_path: str, model: Any, **kwargs: Any) -> None:
            seen["scale"] = scale
            seen["model_path"] = model_path

        def enhance(self, img: Any, outscale: int = 4) -> tuple[Any, int]:
            h, w = img.shape[:2]
            out = np.zeros((h * outscale, w * outscale, 3), dtype=img.dtype)
            out[:] = img[0, 0]
            return out, outscale

    monkeypatch.setattr(
        image_repository,
        "_ensure_realesrgan_anime_weights",
        fake_ensure_weights,
    )
    monkeypatch.setattr("realesrgan.RealESRGANer", FakeRealESRGANer)
    monkeypatch.setattr(
        "basicsr.archs.rrdbnet_arch.RRDBNet",
        lambda **kwargs: None,
    )

    output = image_repository.upscale_image_with_realesrgan_anime(
        Image.new("RGB", (64, 64), color=(1, 2, 3))
    )

    assert output.size == (256, 256)
    assert seen.get("ensure_weights_called") is True
    assert seen.get("scale") == constants.REAL_ESRGAN_SCALE
    assert str(seen.get("model_path")) == str(weights_path)


def test_upscale_image_with_realesrgan_anime_runs_real_upscale() -> None:
    """Minimal test that runs the real RealESRGAN anime upscaler (no mocks). Uses a small image for speed."""
    small = Image.new("RGB", (64, 64), color=(40, 80, 120))
    out = image_repository.upscale_image_with_realesrgan_anime(small)
    assert out is not None
    assert out.size == (256, 256)
    assert out.mode == "RGB"
