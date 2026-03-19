"""Tests for wan_first_last_frame_to_video in wan_comfy_helpers.

AC05: output shapes are consistent with a same-duration call to wan_image_to_video.
"""

from __future__ import annotations

import types
from typing import Any
from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Fake helpers
# ---------------------------------------------------------------------------


class _FakeTensor:
    def __init__(
        self,
        shape: tuple[int, ...],
        *,
        device: str = "fake-device",
        dtype: str = "fake-dtype",
    ) -> None:
        self.shape = shape
        self.device = device
        self.dtype = dtype

    def __getitem__(self, _: Any) -> _FakeTensor:
        return _FakeTensor(self.shape, device=self.device, dtype=self.dtype)

    def __setitem__(self, _: Any, __: Any) -> None:
        pass

    def movedim(self, _: int, __: int) -> _FakeTensor:
        return self

    def __mul__(self, _: float) -> _FakeTensor:
        return self


class _FakeTorchModule:
    def zeros(self, shape: list[int], *, device: str) -> _FakeTensor:
        return _FakeTensor(tuple(shape), device=device)

    def ones(
        self,
        shape: tuple[int, ...],
        *,
        device: str | None = None,
        dtype: str | None = None,
    ) -> _FakeTensor:
        return _FakeTensor(shape, device=device or "fake-device", dtype=dtype or "fake-dtype")


class _FakeModelManagement:
    @staticmethod
    def intermediate_device() -> str:
        return "fake-device"


class _FakeComfyUtils:
    @staticmethod
    def common_upscale(
        image: _FakeTensor,
        width: int,
        height: int,
        method: str,
        crop: str,
    ) -> _FakeTensor:
        return image


class _FakeNodeHelpers:
    @staticmethod
    def conditioning_set_values(conditioning: Any, values: dict[str, Any]) -> list[Any]:
        updated: list[Any] = []
        for token, metadata in conditioning:
            copied = metadata.copy()
            copied.update(values)
            updated.append([token, copied])
        return updated


class _FakeVae:
    def encode(self, image: Any) -> _FakeTensor:
        return _FakeTensor((1, 16, 5, 60, 104), device="latent-device", dtype="latent-dtype")


def _make_fake_modules() -> dict[str, Any]:
    """Return a sys.modules patch dict for all comfy/torch dependencies."""
    fake_torch = _FakeTorchModule()

    comfy_pkg = types.ModuleType("comfy")
    comfy_mm = types.ModuleType("comfy.model_management")
    comfy_mm.intermediate_device = _FakeModelManagement.intermediate_device  # type: ignore[attr-defined]
    comfy_utils = types.ModuleType("comfy.utils")
    comfy_utils.common_upscale = _FakeComfyUtils.common_upscale  # type: ignore[attr-defined]
    comfy_pkg.model_management = comfy_mm  # type: ignore[attr-defined]
    comfy_pkg.utils = comfy_utils  # type: ignore[attr-defined]

    node_helpers_mod = types.ModuleType("node_helpers")
    node_helpers_mod.conditioning_set_values = _FakeNodeHelpers.conditioning_set_values  # type: ignore[attr-defined]

    comfy_diffusion_mod = types.ModuleType("comfy_diffusion")
    runtime_mod = types.ModuleType("comfy_diffusion._runtime")
    runtime_mod.ensure_comfyui_on_path = lambda: None  # type: ignore[attr-defined]
    comfy_diffusion_mod._runtime = runtime_mod  # type: ignore[attr-defined]

    return {
        "torch": fake_torch,
        "comfy": comfy_pkg,
        "comfy.model_management": comfy_mm,
        "comfy.utils": comfy_utils,
        "node_helpers": node_helpers_mod,
        "comfy_diffusion": comfy_diffusion_mod,
        "comfy_diffusion._runtime": runtime_mod,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_wan_first_last_frame_to_video_output_shapes_match_wan_image_to_video() -> None:
    """AC05: output shapes are consistent with a same-duration call to wan_image_to_video."""
    fake_modules = _make_fake_modules()
    with patch.dict("sys.modules", fake_modules):
        from backend.repositories.wan_comfy_helpers import (  # noqa: PLC0415
            wan_first_last_frame_to_video,
            wan_image_to_video,
        )

        positive = [["p", {"seed": 1}]]
        negative = [["n", {"seed": 2}]]
        vae = _FakeVae()

        _, _, i2v_latent = wan_image_to_video(
            positive=positive,
            negative=negative,
            vae=vae,
            width=832,
            height=480,
            length=81,
            batch_size=1,
        )
        _, _, flfv_latent = wan_first_last_frame_to_video(
            positive=positive,
            negative=negative,
            vae=vae,
            width=832,
            height=480,
            length=81,
            batch_size=1,
        )

        assert i2v_latent["samples"].shape == flfv_latent["samples"].shape


def test_wan_first_last_frame_to_video_encodes_concat_for_start_and_end_images() -> None:
    """AC02/AC03: start and end images produce concat_latent_image and correct mask."""
    fake_modules = _make_fake_modules()
    with patch.dict("sys.modules", fake_modules):
        from backend.repositories.wan_comfy_helpers import (  # noqa: PLC0415
            wan_first_last_frame_to_video,
        )

        positive = [["p", {"seed": 1}]]
        negative = [["n", {"seed": 2}]]
        vae = _FakeVae()
        start_image = _FakeTensor((1, 480, 832, 3), device="start-device", dtype="start-dtype")
        end_image = _FakeTensor((1, 480, 832, 3), device="end-device", dtype="end-dtype")

        out_pos, out_neg, latent = wan_first_last_frame_to_video(
            positive=positive,
            negative=negative,
            vae=vae,
            width=832,
            height=480,
            length=81,
            batch_size=1,
            start_image=start_image,
            end_image=end_image,
        )

        assert "concat_latent_image" in out_pos[0][1]
        assert "concat_mask" in out_pos[0][1]
        assert "concat_latent_image" in out_neg[0][1]
        assert "concat_mask" in out_neg[0][1]
        assert latent["samples"].shape == (1, 16, 21, 60, 104)


def test_wan_first_last_frame_to_video_applies_clip_vision_output() -> None:
    """AC02: optional clip_vision_output is injected into both conditionings."""
    fake_modules = _make_fake_modules()
    with patch.dict("sys.modules", fake_modules):
        from backend.repositories.wan_comfy_helpers import (  # noqa: PLC0415
            wan_first_last_frame_to_video,
        )

        clip_vision = object()
        start_image = _FakeTensor((1, 480, 832, 3), device="img-device", dtype="img-dtype")
        positive = [["p", {}]]
        negative = [["n", {}]]

        out_pos, out_neg, _ = wan_first_last_frame_to_video(
            positive=positive,
            negative=negative,
            vae=_FakeVae(),
            width=832,
            height=480,
            length=81,
            batch_size=1,
            start_image=start_image,
            clip_vision_output=clip_vision,
        )

        assert out_pos[0][1]["clip_vision_output"] is clip_vision
        assert out_neg[0][1]["clip_vision_output"] is clip_vision


def test_wan_first_last_frame_to_video_no_images_returns_unchanged_conditioning() -> None:
    """When no start/end image is given, conditioning passes through unchanged."""
    fake_modules = _make_fake_modules()
    with patch.dict("sys.modules", fake_modules):
        from backend.repositories.wan_comfy_helpers import (  # noqa: PLC0415
            wan_first_last_frame_to_video,
        )

        positive = [["p", {"key": "val"}]]
        negative = [["n", {"key": "val2"}]]

        out_pos, out_neg, latent = wan_first_last_frame_to_video(
            positive=positive,
            negative=negative,
            vae=_FakeVae(),
            width=832,
            height=480,
            length=81,
            batch_size=1,
        )

        assert out_pos is positive
        assert out_neg is negative
        assert "samples" in latent


def test_wan_image_to_video_behavior_unchanged() -> None:
    """AC04: existing wan_image_to_video behavior is not affected."""
    fake_modules = _make_fake_modules()
    with patch.dict("sys.modules", fake_modules):
        from backend.repositories.wan_comfy_helpers import (  # noqa: PLC0415
            wan_image_to_video,
        )

        positive = [["p", {"seed": 99}]]
        negative = [["n", {"seed": 0}]]

        out_pos, out_neg, latent = wan_image_to_video(
            positive=positive,
            negative=negative,
            vae=_FakeVae(),
            width=832,
            height=480,
            length=81,
            batch_size=1,
        )

        assert out_pos is positive
        assert out_neg is negative
        assert latent["samples"].shape == (1, 16, 21, 60, 104)
