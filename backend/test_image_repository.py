from __future__ import annotations

import logging
import sys
from types import ModuleType
from typing import Any

import pytest
from PIL import Image

from models import constants
from repositories import image_repository
from services import image_service


class _FakeModelConfig:
    def __init__(self, model_id: str, origin_file_pattern: str, **kwargs: Any) -> None:
        self.model_id = model_id
        self.origin_file_pattern = origin_file_pattern
        self.__dict__.update(kwargs)


class _FakePipeline:
    pass


class _FakeAnimaImagePipeline:
    last_kwargs: dict[str, Any] | None = None

    @classmethod
    def from_pretrained(cls, **kwargs: Any) -> _FakePipeline:
        cls.last_kwargs = kwargs
        return _FakePipeline()


class _FakeInferenceResult:
    def __init__(self, image: Image.Image) -> None:
        self.images = [image]


def _install_fake_modules(monkeypatch: pytest.MonkeyPatch) -> None:
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

    fake_diffsynth = ModuleType("diffsynth")
    fake_diffsynth_pipelines = ModuleType("diffsynth.pipelines")
    fake_anima_module = ModuleType("diffsynth.pipelines.anima_image")
    fake_anima_module.AnimaImagePipeline = _FakeAnimaImagePipeline
    fake_anima_module.ModelConfig = _FakeModelConfig

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "diffsynth", fake_diffsynth)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines", fake_diffsynth_pipelines)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines.anima_image", fake_anima_module)


def test_load_image_pipeline_uses_anima_with_expected_model_and_tokenizer_configs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_modules(monkeypatch)

    pipeline = image_repository.load_image_pipeline()
    kwargs = _FakeAnimaImagePipeline.last_kwargs

    assert kwargs is not None
    assert isinstance(pipeline, _FakePipeline)

    model_configs = kwargs["model_configs"]
    assert len(model_configs) == 3
    assert model_configs[0].model_id == constants.IMAGE_DIFFUSION_MODEL_ID
    assert model_configs[0].origin_file_pattern == constants.IMAGE_DIFFUSION_ORIGIN_PATTERN
    assert model_configs[1].model_id == constants.IMAGE_TEXT_ENCODER_MODEL_ID
    assert model_configs[1].origin_file_pattern == constants.IMAGE_TEXT_ENCODER_ORIGIN_PATTERN
    assert model_configs[2].model_id == constants.IMAGE_VAE_MODEL_ID
    assert model_configs[2].origin_file_pattern == constants.IMAGE_VAE_ORIGIN_PATTERN

    assert kwargs["tokenizer_config"].model_id == constants.IMAGE_QWEN_TOKENIZER_ID
    assert kwargs["tokenizer_config"].origin_file_pattern == constants.IMAGE_QWEN_TOKENIZER_ORIGIN_PATTERN
    assert kwargs["tokenizer_t5xxl_config"].model_id == constants.IMAGE_SD35_TOKENIZER_ID
    assert kwargs["tokenizer_t5xxl_config"].origin_file_pattern == constants.IMAGE_SD35_TOKENIZER_ORIGIN_PATTERN


def test_load_image_pipeline_applies_low_vram_cuda_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_modules(monkeypatch)

    image_repository.load_image_pipeline()
    kwargs = _FakeAnimaImagePipeline.last_kwargs

    assert kwargs is not None
    assert kwargs["device"] == "cuda"
    assert kwargs["torch_dtype"] is sys.modules["torch"].bfloat16
    assert kwargs["vram_limit"] == pytest.approx(15.5)
    first_model = kwargs["model_configs"][0]
    assert first_model.computation_device == "cuda"
    assert first_model.computation_dtype is sys.modules["torch"].bfloat16


def test_constants_define_anima_model_ids_and_default_steps() -> None:
    assert constants.IMAGE_DIFFUSION_MODEL_ID == "circlestone-labs/Anima"
    assert constants.IMAGE_TEXT_ENCODER_MODEL_ID == "circlestone-labs/Anima"
    assert constants.IMAGE_VAE_MODEL_ID == "circlestone-labs/Anima"
    assert constants.IMAGE_QWEN_TOKENIZER_ID == "Qwen/Qwen3-0.6B"
    assert constants.IMAGE_SD35_TOKENIZER_ID == "stabilityai/stable-diffusion-3.5-large"
    assert constants.IMAGE_NUM_INFERENCE_STEPS == 25


def test_image_service_startup_logs_model_loading_completion(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class _Pipeline:
        pass

    monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: _Pipeline())
    caplog.set_level(logging.INFO)

    image_service.startup()

    assert image_service.image_pipeline is not None
    assert image_service.image_model_load_error is None
    assert "Image generation model loading completed" in caplog.text


def test_run_image_inference_calls_anima_pipeline_with_seed_and_default_steps() -> None:
    seen: dict[str, Any] = {}

    def pipeline(*args: Any, **kwargs: Any) -> _FakeInferenceResult:
        seen["args"] = args
        seen["kwargs"] = kwargs
        return _FakeInferenceResult(Image.new("RGB", (64, 64), color=(1, 2, 3)))

    output = image_repository.run_image_inference(
        pipeline,
        prompt="misty mountains",
        seed=42,
    )

    assert output.size == (64, 64)
    assert seen["args"] == ("misty mountains",)
    assert seen["kwargs"] == {
        "seed": 42,
        "num_inference_steps": constants.IMAGE_NUM_INFERENCE_STEPS,
    }


def test_run_image_inference_passes_negative_prompt_when_provided() -> None:
    seen: dict[str, Any] = {}

    def pipeline(*args: Any, **kwargs: Any) -> _FakeInferenceResult:
        seen["args"] = args
        seen["kwargs"] = kwargs
        return _FakeInferenceResult(Image.new("RGB", (32, 32), color=(1, 1, 1)))

    image_repository.run_image_inference(
        pipeline,
        prompt="city skyline",
        seed=7,
        negative_prompt="low quality, blurry",
    )

    assert seen["args"] == ("city skyline",)
    assert seen["kwargs"] == {
        "seed": 7,
        "num_inference_steps": constants.IMAGE_NUM_INFERENCE_STEPS,
        "negative_prompt": "low quality, blurry",
    }


def test_run_image_inference_passes_width_height_rounded_to_multiple_of_16() -> None:
    seen: dict[str, Any] = {}

    def pipeline(*args: Any, **kwargs: Any) -> _FakeInferenceResult:
        seen["kwargs"] = kwargs
        return _FakeInferenceResult(Image.new("RGB", (1920, 1088), color=(0, 0, 0)))

    image_repository.run_image_inference(
        pipeline,
        prompt="sunset",
        seed=1,
        width=1920,
        height=1080,
    )

    assert seen["kwargs"]["width"] == 1920
    assert seen["kwargs"]["height"] == 1088  # 1080 rounded up to multiple of 16


def test_clip_token_truncation_helper_is_not_exposed() -> None:
    assert not hasattr(image_repository, "_truncate_prompt_to_token_limit")


def test_upscale_image_with_realesrgan_anime_uses_expected_model_and_scale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import numpy as np

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
    """Minimal test that runs the real Real-ESRGAN anime upscaler (no mocks). Uses a small image for speed."""
    small = Image.new("RGB", (64, 64), color=(40, 80, 120))
    out = image_repository.upscale_image_with_realesrgan_anime(small)
    assert out is not None
    assert out.size == (256, 256)
    assert out.mode == "RGB"


# ---------------------------------------------------------------------------
# US-004 – Wan pipeline loader in image_repository
# ---------------------------------------------------------------------------


class _FakeWanPipeline:
    last_call_kwargs: dict[str, Any] | None = None

    def __call__(self, **kwargs: Any) -> list[Any]:
        _FakeWanPipeline.last_call_kwargs = kwargs
        return ["frame_1", "frame_2", "frame_3"]


class _FakeWanVideoPipeline:
    last_kwargs: dict[str, Any] | None = None

    @classmethod
    def from_pretrained(cls, **kwargs: Any) -> _FakeWanPipeline:
        cls.last_kwargs = kwargs
        return _FakeWanPipeline()


def _install_wan_fake_modules(monkeypatch: pytest.MonkeyPatch) -> None:
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

    fake_diffsynth = ModuleType("diffsynth")
    fake_diffsynth_pipelines = ModuleType("diffsynth.pipelines")
    fake_wan_module = ModuleType("diffsynth.pipelines.wan_video")
    fake_wan_module.WanVideoPipeline = _FakeWanVideoPipeline
    fake_wan_module.ModelConfig = _FakeModelConfig

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "diffsynth", fake_diffsynth)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines", fake_diffsynth_pipelines)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines.wan_video", fake_wan_module)


# AC01 – load_wan_pipeline returns WanVideoPipeline with four ModelConfig entries
def test_load_wan_pipeline_returns_pipeline_with_four_model_configs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_wan_fake_modules(monkeypatch)

    pipeline = image_repository.load_wan_pipeline()
    kwargs = _FakeWanVideoPipeline.last_kwargs

    assert kwargs is not None
    assert isinstance(pipeline, _FakeWanPipeline)

    model_configs = kwargs["model_configs"]
    assert len(model_configs) == 4

    assert model_configs[0].model_id == constants.WAN_VIDEO_MODEL_ID
    assert model_configs[0].origin_file_pattern == constants.WAN_PIPELINE_HIGH_NOISE_PATTERN
    assert model_configs[1].model_id == constants.WAN_VIDEO_MODEL_ID
    assert model_configs[1].origin_file_pattern == constants.WAN_PIPELINE_LOW_NOISE_PATTERN
    assert model_configs[2].model_id == constants.WAN_VIDEO_MODEL_ID
    assert model_configs[2].origin_file_pattern == constants.WAN_PIPELINE_T5_PATTERN
    assert model_configs[3].model_id == constants.WAN_VIDEO_MODEL_ID
    assert model_configs[3].origin_file_pattern == constants.WAN_PIPELINE_VAE_PATTERN


# AC01 – tokenizer_config points to Wan2.1-T2V-1.3B / google/umt5-xxl/
def test_load_wan_pipeline_has_tokenizer_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_wan_fake_modules(monkeypatch)

    image_repository.load_wan_pipeline()
    kwargs = _FakeWanVideoPipeline.last_kwargs

    assert kwargs is not None
    tc = kwargs["tokenizer_config"]
    assert tc.model_id == constants.WAN_PIPELINE_TOKENIZER_MODEL_ID
    assert tc.origin_file_pattern == constants.WAN_PIPELINE_TOKENIZER_ORIGIN


# AC02 – low-VRAM disk-offload pattern
def test_load_wan_pipeline_applies_low_vram_disk_offload_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_wan_fake_modules(monkeypatch)

    image_repository.load_wan_pipeline()
    kwargs = _FakeWanVideoPipeline.last_kwargs

    assert kwargs is not None
    assert kwargs["device"] == "cuda"
    assert kwargs["torch_dtype"] is sys.modules["torch"].bfloat16
    # 16 GiB total - 2 GiB headroom = 14.0
    assert kwargs["vram_limit"] == pytest.approx(14.0)

    first_model = kwargs["model_configs"][0]
    assert first_model.offload_dtype == "disk"
    assert first_model.offload_device == "disk"
    assert first_model.onload_dtype is sys.modules["torch"].bfloat16
    assert first_model.onload_device == "cpu"
    assert first_model.preparing_dtype is sys.modules["torch"].bfloat16
    assert first_model.preparing_device == "cuda"
    assert first_model.computation_dtype is sys.modules["torch"].bfloat16
    assert first_model.computation_device == "cuda"


# AC03 – run_wan_inference calls pipeline with expected arguments
def test_run_wan_inference_calls_pipeline_with_expected_kwargs() -> None:
    seen: dict[str, Any] = {}

    def fake_pipeline(**kwargs: Any) -> list[str]:
        seen.update(kwargs)
        return ["f1", "f2"]

    result = image_repository.run_wan_inference(
        fake_pipeline,
        image="test_img",
        prompt="a scenic view",
        seed=42,
        width=832,
        height=480,
    )

    assert result == ["f1", "f2"]
    assert seen["prompt"] == "a scenic view"
    assert seen["input_image"] == "test_img"
    assert seen["seed"] == 42
    assert seen["num_inference_steps"] == 20
    assert seen["tiled"] is True
    assert seen["switch_DiT_boundary"] == pytest.approx(0.9)


# AC01 – constants define expected values
def test_wan_pipeline_constants_defined() -> None:
    assert constants.WAN_PIPELINE_HIGH_NOISE_PATTERN == "high_noise_model/diffusion_pytorch_model*.safetensors"
    assert constants.WAN_PIPELINE_LOW_NOISE_PATTERN == "low_noise_model/diffusion_pytorch_model*.safetensors"
    assert constants.WAN_PIPELINE_T5_PATTERN == "models_t5_umt5-xxl-enc-bf16.pth"
    assert constants.WAN_PIPELINE_VAE_PATTERN == "Wan2.1_VAE.pth"
    assert constants.WAN_PIPELINE_TOKENIZER_MODEL_ID == "Wan-AI/Wan2.1-T2V-1.3B"
    assert constants.WAN_PIPELINE_TOKENIZER_ORIGIN == "google/umt5-xxl/"
    assert constants.WAN_PIPELINE_VRAM_HEADROOM_GB == 2
