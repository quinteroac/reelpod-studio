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
    assert constants.IMAGE_NUM_INFERENCE_STEPS == 50


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
