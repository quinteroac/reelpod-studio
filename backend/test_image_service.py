from __future__ import annotations

import io
from typing import Any

import pytest
from PIL import Image

from models.schemas import GenerateImageRequestBody
from repositories import image_repository
from services import image_service


@pytest.fixture(autouse=True)
def _restore_image_service_state() -> None:
    previous_pipeline = image_service.image_pipeline
    previous_error = image_service.image_model_load_error
    image_service.image_pipeline = object()
    image_service.image_model_load_error = None
    yield
    image_service.image_pipeline = previous_pipeline
    image_service.image_model_load_error = previous_error


def test_generate_image_png_runs_realesrgan_before_letterbox(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    source_image = Image.new("RGB", (896, 1152), color=(10, 20, 30))
    upscaled_image = Image.new("RGB", (3584, 4608), color=(40, 50, 60))

    def fake_run_image_inference(
        _pipeline: Any,
        *,
        prompt: str,
        seed: int,
        negative_prompt: str | None,
        width: int | None,
        height: int | None,
    ) -> Image.Image:
        calls.append("inference")
        assert prompt.startswith(image_service.QUALITY_TAGS)
        assert seed == 0
        assert negative_prompt == image_service.DEFAULT_NEGATIVE_PROMPT
        assert width == 896
        assert height == 1152
        return source_image

    def fake_upscale_image_with_realesrgan_anime(image: Image.Image) -> Image.Image:
        calls.append("upscale")
        assert image is source_image
        return upscaled_image

    def fake_letterbox_and_resize_to_target(image: Any, target_width: int, target_height: int) -> Image.Image:
        calls.append("letterbox")
        assert image is upscaled_image
        assert target_width == 1080
        assert target_height == 1920
        return Image.new("RGB", (1080, 1920), color=(70, 80, 90))

    monkeypatch.setattr(image_repository, "run_image_inference", fake_run_image_inference)
    monkeypatch.setattr(
        image_repository,
        "upscale_image_with_realesrgan_anime",
        fake_upscale_image_with_realesrgan_anime,
    )
    monkeypatch.setattr(
        image_service,
        "letterbox_and_resize_to_target",
        fake_letterbox_and_resize_to_target,
    )

    result = image_service.generate_image_png(
        GenerateImageRequestBody(prompt="anime skyline", targetWidth=1080, targetHeight=1920)
    )

    image = Image.open(io.BytesIO(result))
    assert image.size == (1080, 1920)
    assert calls == ["inference", "upscale", "letterbox"]


def test_generate_image_png_outputs_exact_requested_size_after_upscale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        image_repository,
        "run_image_inference",
        lambda *args, **kwargs: Image.new("RGB", (1024, 1024), color=(120, 120, 120)),
    )
    monkeypatch.setattr(
        image_repository,
        "upscale_image_with_realesrgan_anime",
        lambda image: image.resize((4096, 4096), Image.Resampling.LANCZOS),
    )

    result = image_service.generate_image_png(
        GenerateImageRequestBody(prompt="anime portrait", targetWidth=1920, targetHeight=1080)
    )

    image = Image.open(io.BytesIO(result))
    assert image.size == (1920, 1080)
