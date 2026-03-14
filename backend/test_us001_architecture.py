from __future__ import annotations

from pathlib import Path


BACKEND_DIR = Path(__file__).parent


def test_us001_ac01_directory_structure_exists() -> None:
    assert BACKEND_DIR.joinpath("routes").is_dir()
    assert BACKEND_DIR.joinpath("services").is_dir()
    assert BACKEND_DIR.joinpath("repositories").is_dir()


def test_us001_ac02_main_only_wires_app_router_and_lifecycle() -> None:
    source = BACKEND_DIR.joinpath("main.py").read_text(encoding="utf-8")
    assert "FastAPI(" in source
    assert "include_router(" in source
    assert "@app.on_event(\"startup\")" in source
    assert "@app.on_event(\"shutdown\")" in source
    assert "urllib" not in source
    assert "DiffusionPipeline" not in source
    assert "generate_audio" not in source


def test_us001_ac03_routes_delegate_to_services() -> None:
    source = BACKEND_DIR.joinpath("routes", "api.py").read_text(encoding="utf-8")
    assert "from services import audio_service, image_service" in source
    assert "audio_service." in source
    assert "image_service." in source
    assert "urllib" not in source
    assert "DiffusionPipeline" not in source


def test_us001_ac04_services_have_no_urllib_or_pipeline_calls() -> None:
    audio_source = BACKEND_DIR.joinpath("services", "audio_service.py").read_text(encoding="utf-8")
    image_source = BACKEND_DIR.joinpath("services", "image_service.py").read_text(encoding="utf-8")

    assert "urlopen" not in audio_source
    assert "Request(" not in audio_source
    assert "urllib" not in image_source
    assert "DiffusionPipeline" not in image_source


def test_us001_ac05_repositories_use_comfy_diffusion() -> None:
    audio_source = BACKEND_DIR.joinpath("repositories", "audio_repository.py").read_text(encoding="utf-8")
    image_source = BACKEND_DIR.joinpath("repositories", "image_repository.py").read_text(encoding="utf-8")

    assert "generate_audio_bytes_for_prompt" in audio_source
    assert "comfy_diffusion" in audio_source
    assert "AnimaComfyPipeline" in image_source
    assert "comfy_diffusion" in image_source
    assert "from fastapi" not in audio_source
    assert "from fastapi" not in image_source
