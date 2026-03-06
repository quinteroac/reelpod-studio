from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from models import constants
from repositories import video_repository


# ---------------------------------------------------------------------------
# Fake modules (same pattern as test_image_repository.py)
# ---------------------------------------------------------------------------

class _FakeModelConfig:
    def __init__(self, model_id: str, origin_file_pattern: str, **kwargs: Any) -> None:
        self.model_id = model_id
        self.origin_file_pattern = origin_file_pattern
        self.__dict__.update(kwargs)


class _FakePipeline:
    last_call_kwargs: dict[str, Any] | None = None

    def __call__(self, **kwargs: Any) -> list[Any]:
        _FakePipeline.last_call_kwargs = kwargs
        return ["fake_frame_1", "fake_frame_2"]


class _FakeWanVideoPipeline:
    last_kwargs: dict[str, Any] | None = None

    @classmethod
    def from_pretrained(cls, **kwargs: Any) -> _FakePipeline:
        cls.last_kwargs = kwargs
        return _FakePipeline()


_save_video_calls: list[dict[str, Any]] = []


def _fake_save_video(video: Any, path: str) -> None:
    _save_video_calls.append({"video": video, "path": path})
    Path(path).write_bytes(b"\x00\x00\x00\x20ftypisom")


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
    fake_wan_module = ModuleType("diffsynth.pipelines.wan_video")
    fake_wan_module.WanVideoPipeline = _FakeWanVideoPipeline
    fake_wan_module.ModelConfig = _FakeModelConfig
    fake_wan_module.save_video = _fake_save_video

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "diffsynth", fake_diffsynth)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines", fake_diffsynth_pipelines)
    monkeypatch.setitem(sys.modules, "diffsynth.pipelines.wan_video", fake_wan_module)


# ---------------------------------------------------------------------------
# AC01 – WanVideoPipeline produces a 3-second clip from the generated image
# ---------------------------------------------------------------------------


def test_run_video_inference_calls_pipeline_with_input_image_and_3s_frames(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch)
    from PIL import Image

    fake_image = Image.new("RGB", (1024, 1024), color=(10, 20, 30))
    pipeline = _FakePipeline()

    result_path = video_repository.run_video_inference(
        pipeline,
        input_image=fake_image,
        target_width=1920,
        target_height=1080,
        temp_dir=tmp_path,
    )

    assert result_path.exists()
    assert result_path.parent == tmp_path
    call_kwargs = _FakePipeline.last_call_kwargs
    assert call_kwargs is not None
    # 3 seconds × 16 fps = 48 frames
    assert call_kwargs["num_frames"] == constants.WAN_VIDEO_CLIP_DURATION_SECONDS * 16
    assert call_kwargs["num_inference_steps"] == constants.WAN_VIDEO_NUM_INFERENCE_STEPS
    assert call_kwargs["input_image"] is not None


# ---------------------------------------------------------------------------
# AC02 – Model weights loaded via from_pretrained with ModelConfig entries
# ---------------------------------------------------------------------------


def test_load_video_pipeline_uses_wan_model_id_and_model_configs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_modules(monkeypatch)

    pipeline = video_repository.load_video_pipeline()
    kwargs = _FakeWanVideoPipeline.last_kwargs

    assert kwargs is not None
    assert isinstance(pipeline, _FakePipeline)

    model_configs = kwargs["model_configs"]
    assert len(model_configs) == 3
    for mc in model_configs:
        assert mc.model_id == constants.WAN_VIDEO_MODEL_ID


def test_load_video_pipeline_applies_cuda_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_modules(monkeypatch)

    video_repository.load_video_pipeline()
    kwargs = _FakeWanVideoPipeline.last_kwargs

    assert kwargs is not None
    assert kwargs["device"] == "cuda"
    assert kwargs["torch_dtype"] is sys.modules["torch"].bfloat16
    assert kwargs["vram_limit"] == pytest.approx(15.5)


# ---------------------------------------------------------------------------
# AC03 – Input image resized to supported Wan resolution preserving aspect ratio
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("target_w", "target_h", "expected_wan"),
    [
        (1920, 1080, (832, 480)),   # 16:9
        (1080, 1920, (480, 832)),   # 9:16
        (1080, 1080, (720, 720)),   # 1:1
    ],
)
def test_pick_wan_resolution_selects_closest_aspect_ratio(
    target_w: int, target_h: int, expected_wan: tuple[int, int]
) -> None:
    assert video_repository.pick_wan_resolution(target_w, target_h) == expected_wan


def test_run_video_inference_resizes_image_to_wan_resolution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch)
    from PIL import Image

    fake_image = Image.new("RGB", (1920, 1080), color=(10, 20, 30))
    pipeline = _FakePipeline()

    video_repository.run_video_inference(
        pipeline,
        input_image=fake_image,
        target_width=1920,
        target_height=1080,
        temp_dir=tmp_path,
    )

    call_kwargs = _FakePipeline.last_call_kwargs
    assert call_kwargs is not None
    # 16:9 → 832×480
    assert call_kwargs["width"] == 832
    assert call_kwargs["height"] == 480
    resized = call_kwargs["input_image"]
    assert resized.size == (832, 480)


# ---------------------------------------------------------------------------
# AC04 – Output clip saved as temporary MP4 in the same temp directory
# ---------------------------------------------------------------------------


def test_run_video_inference_saves_mp4_in_temp_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_fake_modules(monkeypatch)
    _save_video_calls.clear()
    from PIL import Image

    fake_image = Image.new("RGB", (720, 720), color=(5, 5, 5))
    pipeline = _FakePipeline()

    result_path = video_repository.run_video_inference(
        pipeline,
        input_image=fake_image,
        target_width=1080,
        target_height=1080,
        temp_dir=tmp_path,
    )

    assert result_path == tmp_path / "wan_clip.mp4"
    assert result_path.suffix == ".mp4"
    assert len(_save_video_calls) > 0
    assert _save_video_calls[-1]["path"] == str(result_path)


# ---------------------------------------------------------------------------
# AC05 – Constants define expected Wan model ID and parameters
# ---------------------------------------------------------------------------


def test_constants_define_wan_video_model_id_and_clip_duration() -> None:
    assert constants.WAN_VIDEO_MODEL_ID == "Wan-AI/Wan2.2-I2V-A14B"
    assert constants.WAN_VIDEO_CLIP_DURATION_SECONDS == 3
    assert constants.WAN_VIDEO_NUM_INFERENCE_STEPS == 40
    assert len(constants.WAN_VIDEO_RESOLUTIONS) >= 3
    assert constants.WAN_VIDEO_RESOLUTIONS["16:9"] == (832, 480)
    assert constants.WAN_VIDEO_RESOLUTIONS["9:16"] == (480, 832)
    assert constants.WAN_VIDEO_RESOLUTIONS["1:1"] == (720, 720)
