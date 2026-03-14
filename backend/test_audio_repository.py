"""Tests for audio_repository (ACE Step 1.5 via comfy-diffusion)."""

from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Any

import pytest

from models import constants as audio_constants
from models.constants import DEFAULT_DURATION_SECONDS
from repositories import audio_repository


def test_audio_repository_uses_separate_component_loading_only() -> None:
    source = Path(audio_repository.__file__).read_text(encoding="utf-8")
    constants_source = Path(audio_repository.__file__).resolve().parents[1].joinpath("models", "constants.py").read_text(
        encoding="utf-8"
    )

    assert "load_unet(" in source
    assert "load_clip(" in source
    assert "load_vae(" in source
    assert "load_checkpoint(" not in source
    assert "ACE_COMFY_CHECKPOINT" not in source
    assert "ACE_COMFY_DIFFUSION_MODEL" in source
    assert "ACE_COMFY_CHECKPOINT" not in constants_source
    assert "ACE_COMFY_DIFFUSION_MODEL" in constants_source


def test_load_audio_pipeline_loads_separate_components(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pytest.TempPathFactory,
) -> None:
    (tmp_path / "diffusion_models").mkdir()
    (tmp_path / "text_encoders").mkdir()
    (tmp_path / "vae").mkdir()
    (tmp_path / "diffusion_models" / "ace-unet.safetensors").write_bytes(b"unet")
    (tmp_path / "text_encoders" / "ace-text-encoder.safetensors").write_bytes(b"clip")
    (tmp_path / "vae" / "ace-vae.safetensors").write_bytes(b"vae")

    monkeypatch.setattr(audio_repository, "ACE_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(audio_repository, "ACE_COMFY_DIFFUSION_MODEL", "ace-unet.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_TEXT_ENCODER", "ace-text-encoder.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_VAE", "ace-vae.safetensors")
    monkeypatch.setattr(audio_repository, "_cached_pipeline", None)
    monkeypatch.setattr(audio_repository, "_cached_load_error", None)
    monkeypatch.setattr(audio_repository, "_ensure_comfyui_vendor_on_path", lambda: None)
    monkeypatch.setattr("comfy_diffusion.check_runtime", lambda: {})

    calls: list[tuple[str, str]] = []
    model = object()
    clip = object()
    vae = object()

    class FakeManager:
        def __init__(self, models_dir: str) -> None:
            assert models_dir == str(tmp_path)

        def load_unet(self, name: str) -> Any:
            calls.append(("load_unet", name))
            return model

        def load_clip(self, name: str) -> Any:
            calls.append(("load_clip", name))
            return clip

        def load_vae(self, name: str) -> Any:
            calls.append(("load_vae", name))
            return vae

    monkeypatch.setattr("comfy_diffusion.models.ModelManager", FakeManager)

    pipeline = audio_repository.load_audio_pipeline()

    assert calls == [
        ("load_unet", "ace-unet.safetensors"),
        ("load_clip", "ace-text-encoder.safetensors"),
        ("load_vae", "ace-vae.safetensors"),
    ]
    assert pipeline == audio_repository.AceComfyPipeline(model=model, clip=clip, vae=vae)


@pytest.mark.parametrize(
    ("attribute_name", "attribute_value", "expected_message"),
    [
        (
            "ACE_COMFY_DIFFUSION_MODEL",
            "",
            "ACE_COMFY_DIFFUSION_MODEL or PYCOMFY_ACE_DIFFUSION_MODEL must be set",
        ),
        (
            "ACE_COMFY_TEXT_ENCODER",
            "",
            "ACE_COMFY_TEXT_ENCODER or PYCOMFY_ACE_TEXT_ENCODER must be set",
        ),
        ("ACE_COMFY_VAE", "", "ACE_COMFY_VAE or PYCOMFY_ACE_VAE must be set"),
    ],
)
def test_load_audio_pipeline_requires_each_separate_component_name(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pytest.TempPathFactory,
    attribute_name: str,
    attribute_value: str,
    expected_message: str,
) -> None:
    (tmp_path / "diffusion_models").mkdir()
    (tmp_path / "text_encoders").mkdir()
    (tmp_path / "vae").mkdir()
    (tmp_path / "diffusion_models" / "ace-unet.safetensors").write_bytes(b"unet")
    (tmp_path / "text_encoders" / "ace-text-encoder.safetensors").write_bytes(b"clip")
    (tmp_path / "vae" / "ace-vae.safetensors").write_bytes(b"vae")

    monkeypatch.setattr(audio_repository, "ACE_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(audio_repository, "ACE_COMFY_DIFFUSION_MODEL", "ace-unet.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_TEXT_ENCODER", "ace-text-encoder.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_VAE", "ace-vae.safetensors")
    monkeypatch.setattr(audio_repository, attribute_name, attribute_value)
    monkeypatch.setattr(audio_repository, "_cached_pipeline", None)
    monkeypatch.setattr(audio_repository, "_cached_load_error", None)
    monkeypatch.setattr(audio_repository, "_ensure_comfyui_vendor_on_path", lambda: None)
    monkeypatch.setattr("comfy_diffusion.check_runtime", lambda: {})

    with pytest.raises(RuntimeError, match=expected_message):
        audio_repository.load_audio_pipeline()


def test_validate_audio_pipeline_configuration_requires_component_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pytest.TempPathFactory,
) -> None:
    (tmp_path / "diffusion_models").mkdir()
    (tmp_path / "text_encoders").mkdir()
    (tmp_path / "vae").mkdir()
    (tmp_path / "diffusion_models" / "ace-unet.safetensors").write_bytes(b"unet")
    (tmp_path / "vae" / "ace-vae.safetensors").write_bytes(b"vae")

    monkeypatch.setattr(audio_repository, "ACE_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(audio_repository, "ACE_COMFY_DIFFUSION_MODEL", "ace-unet.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_TEXT_ENCODER", "missing-text-encoder.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_VAE", "ace-vae.safetensors")

    with pytest.raises(RuntimeError, match="ACE_COMFY_TEXT_ENCODER points to a missing model file"):
        audio_repository.validate_audio_pipeline_configuration()


def test_audio_constants_expose_separate_model_env_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    original_env = {
        env_name: os.environ.get(env_name)
        for env_name in (
            "ACE_COMFY_DIFFUSION_MODEL",
            "ACE_COMFY_TEXT_ENCODER",
            "ACE_COMFY_VAE",
            "PYCOMFY_ACE_DIFFUSION_MODEL",
            "PYCOMFY_ACE_UNET",
        )
    }
    monkeypatch.setenv("ACE_COMFY_DIFFUSION_MODEL", "ace-diffusion.safetensors")
    monkeypatch.setenv("ACE_COMFY_TEXT_ENCODER", "ace-text-encoder.safetensors")
    monkeypatch.setenv("ACE_COMFY_VAE", "ace-vae.safetensors")
    monkeypatch.delenv("PYCOMFY_ACE_DIFFUSION_MODEL", raising=False)
    monkeypatch.delenv("PYCOMFY_ACE_UNET", raising=False)

    reloaded_constants = importlib.reload(audio_constants)

    try:
        assert reloaded_constants.ACE_COMFY_DIFFUSION_MODEL == "ace-diffusion.safetensors"
        assert reloaded_constants.ACE_COMFY_TEXT_ENCODER == "ace-text-encoder.safetensors"
        assert reloaded_constants.ACE_COMFY_VAE == "ace-vae.safetensors"
        assert not hasattr(reloaded_constants, "ACE_COMFY_CHECKPOINT")
    finally:
        for env_name, original_value in original_env.items():
            if original_value is None:
                os.environ.pop(env_name, None)
            else:
                os.environ[env_name] = original_value
        importlib.reload(audio_constants)


def test_backend_env_example_documents_separate_audio_model_variables() -> None:
    env_example = Path(audio_repository.__file__).resolve().parents[1].joinpath(".env.example").read_text(encoding="utf-8")

    assert "ACE_COMFY_DIFFUSION_MODEL=" in env_example
    assert "ACE_COMFY_TEXT_ENCODER=" in env_example
    assert "ACE_COMFY_VAE=" in env_example
    assert "ACE_COMFY_CHECKPOINT" not in env_example


def test_generate_audio_bytes_for_prompt_returns_wav_bytes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pytest.TempPathFactory,
) -> None:
    monkeypatch.setattr(audio_repository, "ACE_COMFY_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(audio_repository, "ACE_COMFY_DIFFUSION_MODEL", "ace-unet.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_TEXT_ENCODER", "ace-text-encoder.safetensors")
    monkeypatch.setattr(audio_repository, "ACE_COMFY_VAE", "ace-vae.safetensors")
    monkeypatch.setattr(audio_repository, "_cached_pipeline", None)
    monkeypatch.setattr(audio_repository, "_cached_load_error", None)

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
