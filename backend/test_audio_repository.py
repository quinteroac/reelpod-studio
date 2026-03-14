"""Tests for audio_repository (ACE Step 1.5 via comfy-diffusion)."""

from __future__ import annotations

import pytest

from models.constants import DEFAULT_DURATION_SECONDS
from repositories import audio_repository


def test_generate_audio_bytes_for_prompt_returns_wav_bytes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pytest.TempPathFactory,
) -> None:
    monkeypatch.setattr(audio_repository, "ACE_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(audio_repository, "ACE_COMFY_CHECKPOINT", "ace.safetensors")
    monkeypatch.setattr(audio_repository, "_cached_pipeline", None)
    monkeypatch.setattr(audio_repository, "_cached_load_error", None)

    def fake_load() -> audio_repository.AceComfyPipeline:
        return audio_repository.AceComfyPipeline(model=None, clip=None, vae=None)

    def fake_encode(*args: object, **kwargs: object) -> object:
        return "positive"

    def fake_negative(*args: object, **kwargs: object) -> object:
        return "negative"

    def fake_empty(*args: object, **kwargs: object) -> dict:
        return {"samples": None}

    def fake_sample(*args: object, **kwargs: object) -> dict:
        return {"samples": None}

    class FakeVae:
        def decode(self, x: object) -> object:
            import torch
            return torch.zeros(1, 1, 44100 * 5)

    monkeypatch.setattr(audio_repository, "load_audio_pipeline", lambda: audio_repository.AceComfyPipeline(model=None, clip=None, vae=FakeVae()))
    monkeypatch.setattr("comfy_diffusion.audio.encode_ace_step_15_audio", fake_encode)
    monkeypatch.setattr(audio_repository, "_negative_conditioning_ace", fake_negative)
    monkeypatch.setattr("comfy_diffusion.audio.empty_ace_step_15_latent_audio", fake_empty)
    monkeypatch.setattr("comfy_diffusion.sampling.sample", fake_sample)

    result = audio_repository.generate_audio_bytes_for_prompt(
        "lofi jazz, 80 BPM",
        tempo=80,
        duration=10,
    )

    assert isinstance(result, bytes)
    assert result.startswith(b"RIFF")


def test_generate_audio_bytes_for_prompt_uses_default_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    def capture_empty(*args: object, **kwargs: object) -> dict:
        seen["empty_seconds"] = kwargs.get("seconds")
        return {"samples": None}

    def fake_load() -> audio_repository.AceComfyPipeline:
        import torch
        class Vae:
            def decode(self, x: object) -> object:
                return torch.zeros(1, 1, 44100 * 2)
        return audio_repository.AceComfyPipeline(model=None, clip=None, vae=Vae())

    monkeypatch.setattr(audio_repository, "load_audio_pipeline", fake_load)
    monkeypatch.setattr("comfy_diffusion.audio.encode_ace_step_15_audio", lambda *a, **k: "pos")
    monkeypatch.setattr(audio_repository, "_negative_conditioning_ace", lambda *a, **k: "neg")
    monkeypatch.setattr("comfy_diffusion.audio.empty_ace_step_15_latent_audio", capture_empty)
    monkeypatch.setattr("comfy_diffusion.sampling.sample", lambda *a, **k: {"samples": None})

    audio_repository.generate_audio_bytes_for_prompt("chill", tempo=70)

    assert seen.get("empty_seconds") == float(DEFAULT_DURATION_SECONDS)
