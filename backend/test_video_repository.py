from __future__ import annotations

import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from models import constants
from repositories import video_repository
from repositories.video_repository import WanComfyPipeline


# ---------------------------------------------------------------------------
# Fakes for comfy-diffusion pipeline
# ---------------------------------------------------------------------------

_run_video_inference_calls: list[dict[str, Any]] = []
_save_frames_as_video_calls: list[dict[str, Any]] = []


def _fake_save_frames_as_video(
    frames: list[Any], path: str | Path, fps: float = 16.0
) -> None:
    _save_frames_as_video_calls.append({"path": path, "frames": frames, "fps": fps})
    Path(path).write_bytes(b"\x00\x00\x00\x20ftypisom")


def _install_fake_modules(monkeypatch: pytest.MonkeyPatch, tmp_path: Path | None = None) -> None:
    """Patch comfy_diffusion, wan_comfy_helpers, and constants so load/run use fakes."""
    models_dir = tmp_path / "models_root" if tmp_path else Path("/tmp/fake-models")
    if tmp_path:
        models_dir.mkdir(parents=True, exist_ok=True)

    # Patch the module that uses them (video_repository imports from models.constants)
    monkeypatch.setattr(video_repository, "WAN_COMFY_MODELS_DIR", str(models_dir))
    monkeypatch.setattr(video_repository, "WAN_COMFY_UNET_HIGH", "high.safetensors")
    monkeypatch.setattr(video_repository, "WAN_COMFY_UNET_LOW", "low.safetensors")
    monkeypatch.setattr(video_repository, "WAN_COMFY_CLIP", "umt5_xxl")
    monkeypatch.setattr(video_repository, "WAN_COMFY_VAE", "wan_2.1_vae.safetensors")

    # Use real torch so run_video_inference can use torch.from_numpy; patch cuda for load_video_pipeline
    import torch as real_torch
    if not hasattr(real_torch, "cuda") or not real_torch.cuda.is_available():
        class _FakeCuda:
            @staticmethod
            def is_available() -> bool:
                return True
            @staticmethod
            def mem_get_info() -> tuple[int, int]:
                return (10 * 1024**3, 16 * 1024**3)
        monkeypatch.setattr(real_torch, "cuda", _FakeCuda())

    def check_runtime() -> dict:
        return {}

    class _FakeModelManager:
        def __init__(self, root: str) -> None:
            self._root = root

        def load_unet(self, name: str) -> Any:
            return type("FakeUNet", (), {})()

        def load_clip(self, name: str, clip_type: str = "wan") -> Any:
            return type("FakeCLIP", (), {})()

        def load_vae(self, name: str) -> Any:
            return type("FakeVAE", (), {})()

    fake_comfy_diffusion = ModuleType("comfy_diffusion")
    fake_comfy_diffusion.check_runtime = check_runtime
    fake_comfy_diffusion.ModelManager = _FakeModelManager
    fake_comfy_diffusion.vae_decode_batch = lambda vae, latent: []
    fake_comfy_diffusion.encode_prompt = lambda clip, text: ("positive", "negative")
    fake_comfy_diffusion.sample_advanced = lambda *a, **k: {"samples": None}

    fake_conditioning = ModuleType("comfy_diffusion.conditioning")
    fake_conditioning.encode_prompt = lambda clip, text: "cond"

    fake_sampling = ModuleType("comfy_diffusion.sampling")
    fake_sampling.sample_advanced = lambda *a, **k: {"samples": None}

    fake_models = ModuleType("comfy_diffusion.models")
    fake_models.ModelManager = _FakeModelManager

    def ensure_comfyui_on_path() -> None:
        pass

    fake_runtime = ModuleType("comfy_diffusion._runtime")
    fake_runtime.ensure_comfyui_on_path = ensure_comfyui_on_path

    fake_model_management = ModuleType("comfy.model_management")
    fake_model_management.intermediate_device = lambda: "cpu"

    fake_comfy = ModuleType("comfy")
    fake_comfy.model_management = fake_model_management

    monkeypatch.setitem(sys.modules, "comfy", fake_comfy)
    monkeypatch.setitem(sys.modules, "comfy_diffusion", fake_comfy_diffusion)
    monkeypatch.setitem(sys.modules, "comfy_diffusion.conditioning", fake_conditioning)
    monkeypatch.setitem(sys.modules, "comfy_diffusion.models", fake_models)
    monkeypatch.setitem(sys.modules, "comfy_diffusion.sampling", fake_sampling)
    monkeypatch.setitem(sys.modules, "comfy_diffusion._runtime", fake_runtime)
    monkeypatch.setitem(sys.modules, "comfy.model_management", fake_model_management)

    # Wan helpers: stub so run_video_inference completes without real ComfyUI
    def fake_wan_image_to_video(*args: Any, **kwargs: Any) -> tuple[Any, Any, dict]:
        return ("pos", "neg", {"samples": None})

    def fake_wan22_latent(latent: dict, width: int, height: int) -> dict:
        return latent

    def fake_apply_shift(model: Any, shift: float = 5.0, multiplier: float = 1000.0) -> Any:
        return model

    monkeypatch.setattr(video_repository, "apply_model_sampling_shift", fake_apply_shift)
    monkeypatch.setattr(video_repository, "wan_image_to_video", fake_wan_image_to_video)
    monkeypatch.setattr(video_repository, "wan22_latent_to_wan21_for_decode", fake_wan22_latent)
    monkeypatch.setattr(video_repository, "save_frames_as_video", _fake_save_frames_as_video)

    fake_wan_helpers = ModuleType("repositories.wan_comfy_helpers")
    fake_wan_helpers.wan_image_to_video = fake_wan_image_to_video
    fake_wan_helpers.wan22_latent_to_wan21_for_decode = fake_wan22_latent
    fake_wan_helpers.apply_model_sampling_shift = fake_apply_shift
    fake_wan_helpers.save_frames_as_video = _fake_save_frames_as_video

    monkeypatch.setitem(sys.modules, "repositories.wan_comfy_helpers", fake_wan_helpers)

    # vae_decode_batch must return a list of PIL Images for save_frames_as_video
    from PIL import Image as PILImage
    fake_comfy_diffusion.vae_decode_batch = lambda vae, latent: [
        PILImage.new("RGB", (832, 480), color=(i, i, i)) for i in range(5)
    ]


# ---------------------------------------------------------------------------
# load_video_pipeline uses ModelManager and returns WanComfyPipeline
# ---------------------------------------------------------------------------


def test_load_video_pipeline_returns_wan_comfy_pipeline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch, tmp_path)

    pipeline = video_repository.load_video_pipeline()

    assert isinstance(pipeline, WanComfyPipeline)
    assert pipeline.model_high is not None
    assert pipeline.model_low is not None
    assert pipeline.clip is not None
    assert pipeline.vae is not None


def test_load_video_pipeline_requires_models_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WAN_COMFY_MODELS_DIR", raising=False)
    monkeypatch.delenv("PYCOMFY_MODELS_DIR", raising=False)
    _install_fake_modules(monkeypatch, None)
    monkeypatch.setattr(constants, "WAN_COMFY_MODELS_DIR", "")
    monkeypatch.setattr(constants, "WAN_COMFY_UNET_HIGH", "h")
    monkeypatch.setattr(constants, "WAN_COMFY_UNET_LOW", "l")
    monkeypatch.setattr(constants, "WAN_COMFY_CLIP", "c")
    monkeypatch.setattr(constants, "WAN_COMFY_VAE", "v")

    with pytest.raises(RuntimeError, match="WAN_COMFY_MODELS_DIR"):
        video_repository.load_video_pipeline()


# ---------------------------------------------------------------------------
# run_video_inference uses pipeline and saves MP4
# ---------------------------------------------------------------------------


def test_run_video_inference_saves_mp4_in_temp_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch, tmp_path)
    _save_frames_as_video_calls.clear()
    from PIL import Image

    pipeline = video_repository.load_video_pipeline()
    fake_image = Image.new("RGB", (720, 720), color=(5, 5, 5))

    result_path = video_repository.run_video_inference(
        pipeline,
        input_image=fake_image,
        prompt="save mp4 test prompt",
        target_width=1080,
        target_height=1080,
        temp_dir=tmp_path,
    )

    assert result_path == tmp_path / "wan_clip.mp4"
    assert result_path.suffix == ".mp4"
    assert len(_save_frames_as_video_calls) > 0
    assert _save_frames_as_video_calls[-1]["path"] == result_path
    assert _save_frames_as_video_calls[-1]["fps"] == constants.WAN_VIDEO_FPS


def test_run_video_inference_resizes_image_to_wan_resolution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch, tmp_path)
    from PIL import Image

    pipeline = video_repository.load_video_pipeline()
    fake_image = Image.new("RGB", (1920, 1080), color=(10, 20, 30))

    video_repository.run_video_inference(
        pipeline,
        input_image=fake_image,
        prompt="resize test prompt",
        target_width=1920,
        target_height=1080,
        temp_dir=tmp_path,
    )

    # 16:9 → 832×480
    assert _save_frames_as_video_calls[-1]["frames"]
    first_frame = _save_frames_as_video_calls[-1]["frames"][0]
    assert first_frame.size == (832, 480)


# ---------------------------------------------------------------------------
# pick_wan_resolution
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("target_w", "target_h", "expected_wan"),
    [
        (1920, 1080, (832, 480)),
        (1080, 1920, (480, 832)),
        (1080, 1080, (720, 720)),
    ],
)
def test_pick_wan_resolution_selects_closest_aspect_ratio(
    target_w: int, target_h: int, expected_wan: tuple[int, int]
) -> None:
    assert video_repository.pick_wan_resolution(target_w, target_h) == expected_wan


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


def test_constants_define_wan_video_clip_duration_and_resolutions() -> None:
    assert constants.WAN_VIDEO_CLIP_DURATION_SECONDS == 1
    assert constants.WAN_VIDEO_FPS == 16.0
    assert len(constants.WAN_VIDEO_RESOLUTIONS) >= 3
    assert constants.WAN_VIDEO_RESOLUTIONS["16:9"] == (832, 480)
    assert constants.WAN_VIDEO_RESOLUTIONS["9:16"] == (480, 832)
    assert constants.WAN_VIDEO_RESOLUTIONS["1:1"] == (720, 720)


def test_constants_define_comfy_sampling_params() -> None:
    assert constants.WAN_COMFY_HIGH_STEPS < constants.WAN_COMFY_STEPS
    assert constants.WAN_COMFY_CFG == 7.0
    assert constants.WAN_COMFY_SAMPLER == "euler"
    assert constants.WAN_COMFY_SCHEDULER == "normal"
