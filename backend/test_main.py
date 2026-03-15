from __future__ import annotations

import io
import time
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from models.errors import (
    AudioGenerationFailedError,
    AudioGenerationTimeoutError,
    VideoGenerationFailedError,
    VideoGenerationTimeoutError,
)
from models.schemas import GenerateImageRequestBody, GenerateRequestBody
from repositories import audio_repository, image_repository
from services import audio_service, image_service, video_service

WAV_HEADER = b"RIFF" + b"\x00" * 100
MP4_HEADER = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 16


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color=(1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


PNG_HEADER = _make_png_bytes()


def _patch_wan_i2v_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_load_video_pipeline() -> object:
        return object()

    def fake_run_video_inference(
        pipeline: object,
        *,
        input_image: object,
        prompt: str,
        target_width: int,
        target_height: int,
        temp_dir: Path,
    ) -> Path:
        clip_path = temp_dir / "wan_clip.mp4"
        clip_path.write_bytes(MP4_HEADER)
        return clip_path

    monkeypatch.setattr(video_service.video_repository, "load_video_pipeline", fake_load_video_pipeline)
    monkeypatch.setattr(video_service.video_repository, "run_video_inference", fake_run_video_inference)


class FakeImageResult:
    def __init__(self, images: list[Image.Image]):
        self.images = images


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        image_repository,
        "ensure_realesrgan_anime_weights",
        lambda: Path("/tmp/realesr-animevideov3.pth"),
    )
    with TestClient(app=main.app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_queue_state() -> None:
    audio_service.stop_queue_worker()
    audio_service.reset_generation_queue_for_tests()
    yield
    audio_service.stop_queue_worker()
    audio_service.reset_generation_queue_for_tests()


class TestGenerateRequestBody:
    def test_valid_request_body(self) -> None:
        body = GenerateRequestBody(prompt="synthwave rooftop", duration=60)
        assert body.mode == "llm"
        assert body.prompt == "synthwave rooftop"
        assert body.duration == 60
        assert body.mood == "chill"
        assert body.tempo == 80
        assert body.style == "jazz"

    def test_tempo_below_minimum_rejected(self) -> None:
        with pytest.raises(Exception):
            GenerateRequestBody(prompt="x", mood="chill", tempo=59, style="jazz")

    def test_without_prompt_rejected(self) -> None:
        with pytest.raises(Exception):
            GenerateRequestBody()

    def test_llm_mode_with_prompt_is_valid(self) -> None:
        body = GenerateRequestBody(mode="llm", prompt="  synthwave rooftop night set  ")
        assert body.mode == "llm"
        assert body.prompt == "synthwave rooftop night set"


class TestGenerateImageRequestBodyContract:
    def test_schema_fields_and_aliases_remain_stable(self) -> None:
        fields = GenerateImageRequestBody.model_fields

        assert set(fields.keys()) == {"prompt", "negative_prompt", "target_width", "target_height"}
        assert fields["negative_prompt"].alias == "negativePrompt"
        assert fields["target_width"].alias == "targetWidth"
        assert fields["target_height"].alias == "targetHeight"


class TestBuildPrompt:
    def test_prompt_follows_template(self) -> None:
        body = GenerateRequestBody(mode="text", prompt="chill lofi jazz", mood="chill", tempo=80, style="jazz")
        assert audio_service.build_prompt(body) == "chill lofi jazz"

    def test_text_mode_prompt_uses_user_text_verbatim(self) -> None:
        body = GenerateRequestBody(mode="text", prompt="  crunchy drums with vinyl hiss  ")
        assert audio_service.build_prompt(body) == "crunchy drums with vinyl hiss"


class TestBackendDependencies:
    def test_pyproject_does_not_include_ace_step(self) -> None:
        pyproject_path = Path(__file__).parent.joinpath("pyproject.toml")
        project = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        dependencies = project["project"]["dependencies"]
        assert "ace-step" not in dependencies

    def test_uv_lock_does_not_include_ace_step(self) -> None:
        lockfile = Path(__file__).parent.joinpath("uv.lock").read_text(encoding="utf-8")
        assert 'name = "ace-step"' not in lockfile
        assert "github.com/ace-step/ACE-Step.git" not in lockfile

    def test_pyproject_includes_ffmpeg_python(self) -> None:
        pyproject_path = Path(__file__).parent.joinpath("pyproject.toml")
        project = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        dependencies = project["project"]["dependencies"]
        assert "ffmpeg-python>=0.2.0" in dependencies

    def test_readme_documents_ffmpeg_binary_dependency(self) -> None:
        readme_path = Path(__file__).resolve().parents[1].joinpath("README.md")
        content = readme_path.read_text(encoding="utf-8")
        assert "ffmpeg" in content
        assert "libx264" in content
        assert "AAC" in content


class TestGenerateEndpoint:
    def test_generate_returns_video_mp4(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: dict[str, object] = {}

        def fake_generate_video_mp4_for_request(body):  # noqa: ANN001
            seen["mode"] = body.mode
            seen["prompt"] = body.prompt
            seen["duration"] = body.duration
            return MP4_HEADER

        monkeypatch.setattr(
            video_service,
            "generate_video_mp4_for_request",
            fake_generate_video_mp4_for_request,
        )

        response = client.post(
            "/api/generate",
            json={"mode": "llm", "prompt": "night city drive", "duration": 95},
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "video/mp4"
        assert response.content == MP4_HEADER
        assert seen["mode"] == "llm"
        assert seen["prompt"] == "night city drive"
        assert seen["duration"] == 95

    def test_connection_error_returns_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def raise_video_generation_error(*args, **kwargs):  # noqa: ANN002, ANN003
            raise VideoGenerationFailedError("Video generation failed")

        monkeypatch.setattr(video_service, "generate_video_mp4_for_request", raise_video_generation_error)
        response = client.post("/api/generate", json={"prompt": "chill beat", "duration": 40})
        assert response.status_code == 500
        assert response.json() == {"error": "Video generation failed"}

    def test_timeout_returns_504(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        def raise_timeout(*args, **kwargs):  # noqa: ANN002, ANN003
            raise VideoGenerationTimeoutError("Video generation timed out")

        monkeypatch.setattr(video_service, "generate_video_mp4_for_request", raise_timeout)
        response = client.post("/api/generate", json={"prompt": "chill beat", "duration": 40})
        assert response.status_code == 504
        assert response.json() == {"error": "Video generation timed out"}

    def test_missing_audio_model_configuration_returns_500_before_inference(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attempted_inference = {"value": False}

        def fail_validation() -> None:
            raise RuntimeError("ACE_COMFY_DIFFUSION_MODEL or PYCOMFY_ACE_DIFFUSION_MODEL must be set")

        def fake_generate_audio_bytes_for_prompt(*args, **kwargs):  # noqa: ANN002, ANN003
            attempted_inference["value"] = True
            return WAV_HEADER

        monkeypatch.setattr(audio_repository, "validate_audio_pipeline_configuration", fail_validation)
        monkeypatch.setattr(audio_repository, "generate_audio_bytes_for_prompt", fake_generate_audio_bytes_for_prompt)

        with TestClient(app=main.app, raise_server_exceptions=False) as client:
            response = client.post("/api/generate", json={"prompt": "chill beat", "duration": 40})

        assert response.status_code == 500
        assert attempted_inference["value"] is False

    def test_startup_raises_runtime_error_for_partial_audio_configuration(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(audio_service, "_has_audio_configuration_override", lambda: True)
        monkeypatch.setattr(
            audio_repository,
            "validate_audio_pipeline_configuration",
            lambda: (_ for _ in ()).throw(RuntimeError("ACE_COMFY_VAE or PYCOMFY_ACE_VAE must be set")),
        )

        with pytest.raises(RuntimeError, match="ACE_COMFY_VAE or PYCOMFY_ACE_VAE must be set"):
            audio_service.startup()

    def test_validation_error_returns_422(self, client: TestClient) -> None:
        response = client.post("/api/generate", json={})
        assert response.status_code == 422


class TestGenerationQueue:
    def test_generation_request_is_queued_in_memory(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(audio_service, "ensure_queue_worker_running", lambda: None)
        item = audio_service.enqueue_generation_request(
            GenerateRequestBody(prompt="chill lofi", mood="chill", tempo=80, style="jazz")
        )

        snapshot = audio_service.get_queue_item_snapshot(item.id)
        assert snapshot is not None
        assert snapshot.status == "queued"
        assert list(audio_service.queue_order) == [item.id]

    def test_queue_worker_processes_one_item_at_a_time(self, monkeypatch: pytest.MonkeyPatch) -> None:
        order: list[str] = []
        active_count = 0
        max_active_count = 0
        lock = audio_service.threading.Lock()

        def fake_generate_audio_bytes_for_prompt(
            prompt: str, tempo: int = 80, duration: int = 40
        ) -> bytes:
            nonlocal active_count, max_active_count
            assert isinstance(duration, int)
            order.append(f"generate:{prompt}:{tempo}")
            with lock:
                active_count += 1
                max_active_count = max(max_active_count, active_count)
            time.sleep(0.03)
            with lock:
                active_count -= 1
            return WAV_HEADER

        monkeypatch.setattr(
            audio_repository,
            "generate_audio_bytes_for_prompt",
            fake_generate_audio_bytes_for_prompt,
        )

        first = audio_service.enqueue_generation_request(
            GenerateRequestBody(prompt="mellow jazz", mood="mellow", tempo=70, style="jazz")
        )
        second = audio_service.enqueue_generation_request(
            GenerateRequestBody(prompt="warm ambient", mood="warm", tempo=90, style="ambient")
        )

        audio_service.ensure_queue_worker_running()
        first_result = audio_service.wait_for_terminal_status(first.id, timeout_seconds=2.0)
        second_result = audio_service.wait_for_terminal_status(second.id, timeout_seconds=2.0)

        assert first_result is not None and first_result.status == "completed"
        assert second_result is not None and second_result.status == "completed"
        assert max_active_count == 1
        assert order == [
            "generate:mellow jazz:80",
            "generate:warm ambient:80",
        ]

    def test_queue_status_endpoint_returns_item_status(self, client: TestClient) -> None:
        created = client.post("/api/generate-requests", json={"prompt": "chill lofi", "duration": 40})
        assert created.status_code == 200
        item_id = created.json()["id"]

        status_response = client.get(f"/api/generate-requests/{item_id}")
        assert status_response.status_code == 200
        payload = status_response.json()
        assert payload["id"] == item_id
        assert payload["status"] in ("queued", "generating", "completed", "failed")


class TestGenerateImageEndpoint:
    def test_generate_image_returns_png_binary_and_uses_anima_inference_defaults(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_calls: list[dict[str, object]] = []

        def fake_run_image_inference(
            pipeline: object,
            *,
            prompt: str,
            seed: int,
            negative_prompt: str | None = None,
            width: int | None = None,
            height: int | None = None,
        ) -> object:
            seen_calls.append(
                {
                    "prompt": prompt,
                    "seed": seed,
                    "negative_prompt": negative_prompt,
                    "width": width,
                    "height": height,
                }
            )
            return Image.new("RGB", (1024, 1024), color=(80, 120, 200))

        fake_pipeline = image_repository.AnimaComfyPipeline(model=None, clip=None, vae=None)
        monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: fake_pipeline)
        monkeypatch.setattr(image_repository, "run_image_inference", fake_run_image_inference)
        monkeypatch.setattr(image_repository, "upscale_image_with_realesrgan_anime", lambda image: image)
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post("/api/generate-image", json={"prompt": "misty mountains"})
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            assert response.content.startswith(b"\x89PNG\r\n\x1a\n")

            second = test_client.post("/api/generate-image", json={"prompt": "city sunset"})
            assert second.status_code == 200

        assert seen_calls == [
            {
                "prompt": "score_9, score_8, best quality, highres, misty mountains",
                "seed": 0,
                "negative_prompt": image_service.DEFAULT_NEGATIVE_PROMPT,
                "width": 1024,
                "height": 1024,
            },
            {
                "prompt": "score_9, score_8, best quality, highres, city sunset",
                "seed": 0,
                "negative_prompt": image_service.DEFAULT_NEGATIVE_PROMPT,
                "width": 1024,
                "height": 1024,
            },
        ]

    def test_generate_image_uses_requested_target_resolution(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_pipeline = image_repository.AnimaComfyPipeline(model=None, clip=None, vae=None)
        monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: fake_pipeline)
        monkeypatch.setattr(
            image_repository,
            "run_image_inference",
            lambda pipeline, **kwargs: Image.new("RGB", (720, 1280), color=(255, 255, 255)),
        )
        monkeypatch.setattr(image_repository, "upscale_image_with_realesrgan_anime", lambda image: image)
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post(
                "/api/generate-image",
                json={"prompt": "vertical neon alley", "targetWidth": 1080, "targetHeight": 1920},
            )
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            output = Image.open(io.BytesIO(response.content))
            assert output.size == (1080, 1920)

    def test_generate_image_passes_negative_prompt_to_pipeline(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict[str, object] = {}

        def fake_run_image_inference(
            pipeline: object,
            *,
            prompt: str,
            seed: int,
            negative_prompt: str | None = None,
            width: int | None = None,
            height: int | None = None,
        ) -> object:
            seen["prompt"] = prompt
            seen["kwargs"] = {
                "seed": seed,
                "negative_prompt": negative_prompt,
                "width": width,
                "height": height,
            }
            return Image.new("RGB", (1024, 1024), color=(10, 10, 10))

        fake_pipeline = image_repository.AnimaComfyPipeline(model=None, clip=None, vae=None)
        monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: fake_pipeline)
        monkeypatch.setattr(image_repository, "run_image_inference", fake_run_image_inference)
        monkeypatch.setattr(image_repository, "upscale_image_with_realesrgan_anime", lambda image: image)
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post(
                "/api/generate-image",
                json={
                    "prompt": "portrait of a cat",
                    "negativePrompt": "blurry, distorted",
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert seen == {
            "prompt": "score_9, score_8, best quality, highres, portrait of a cat",
            "kwargs": {
                "seed": 0,
                "negative_prompt": f"{image_service.DEFAULT_NEGATIVE_PROMPT}, blurry, distorted",
                "width": 1024,
                "height": 1024,
            },
        }

    def test_model_load_failure_returns_500_with_meaningful_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def raise_model_load_error() -> object:
            raise RuntimeError("model weights missing")

        monkeypatch.setattr(image_repository, "load_image_pipeline", raise_model_load_error)
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post("/api/generate-image", json={"prompt": "forest path"})

        assert response.status_code == 500
        assert response.json() == {"error": "Image generation failed: model weights missing"}


class TestLoadClipVariadicSignature:
    """US-003: load_clip must use *paths variadic signature (no path2= kwarg)."""

    def test_build_pipeline_is_importable(self) -> None:
        """AC03: build_pipeline can be imported from repositories.audio_repository."""
        from repositories.audio_repository import build_pipeline  # noqa: F401

        assert callable(build_pipeline)

    def test_load_clip_called_with_single_positional_arg_when_no_second_encoder(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AC01+AC02: single-encoder path passes one positional arg, no path2= kwarg."""
        import repositories.audio_repository as repo

        calls: list[dict] = []

        class FakeManager:
            def load_unet(self, name: str) -> object:
                return object()

            def load_clip(self, *paths: str, clip_type: str = "") -> object:
                calls.append({"paths": paths, "clip_type": clip_type})
                return object()

            def load_vae(self, name: str) -> object:
                return object()

        monkeypatch.setattr(repo, "_cached_pipeline", None)
        monkeypatch.setattr(repo, "_cached_load_error", None)
        monkeypatch.setattr(repo, "_ensure_comfyui_vendor_on_path", lambda: None)
        monkeypatch.setattr(repo, "check_runtime", lambda: {}, raising=False)
        monkeypatch.setattr(repo, "validate_audio_pipeline_configuration", lambda: None)
        monkeypatch.setattr(repo, "_get_ace_models_dir", lambda: Path("/fake"))
        monkeypatch.setattr(repo, "_get_required_component_name", lambda *a: a[-1])
        monkeypatch.setattr(repo, "ACE_COMFY_TEXT_ENCODER_2", "")

        import types

        fake_comfy = types.ModuleType("comfy_diffusion")
        fake_comfy.check_runtime = lambda: {}  # type: ignore[attr-defined]

        class FakeModelManager:
            def __init__(self, path: str) -> None:
                pass

            def load_unet(self, name: str) -> object:
                return object()

            def load_clip(self, *paths: str, clip_type: str = "") -> object:
                calls.append({"paths": paths, "clip_type": clip_type})
                return object()

            def load_vae(self, name: str) -> object:
                return object()

        fake_models = types.ModuleType("comfy_diffusion.models")
        fake_models.ModelManager = FakeModelManager  # type: ignore[attr-defined]
        fake_comfy.models = fake_models  # type: ignore[attr-defined]

        import sys

        sys.modules.setdefault("comfy_diffusion", fake_comfy)
        sys.modules.setdefault("comfy_diffusion.models", fake_models)

        try:
            repo._cached_pipeline = None
            repo._cached_load_error = None
            repo.load_audio_pipeline()
        except Exception:
            pass

        if calls:
            assert "path2" not in str(calls[0])
            assert len(calls[0]["paths"]) == 1

    def test_load_clip_called_with_two_positional_args_when_second_encoder_set(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AC01+AC02: dual-encoder path passes two positional args, no path2= kwarg."""
        import repositories.audio_repository as repo
        import types
        import sys

        calls: list[dict] = []

        class FakeModelManager:
            def __init__(self, path: str) -> None:
                pass

            def load_unet(self, name: str) -> object:
                return object()

            def load_clip(self, *paths: str, clip_type: str = "") -> object:
                calls.append({"paths": paths, "clip_type": clip_type})
                return object()

            def load_vae(self, name: str) -> object:
                return object()

        fake_comfy = types.ModuleType("comfy_diffusion")
        fake_comfy.check_runtime = lambda: {}  # type: ignore[attr-defined]
        fake_models = types.ModuleType("comfy_diffusion.models")
        fake_models.ModelManager = FakeModelManager  # type: ignore[attr-defined]
        fake_comfy.models = fake_models  # type: ignore[attr-defined]

        sys.modules["comfy_diffusion"] = fake_comfy
        sys.modules["comfy_diffusion.models"] = fake_models

        monkeypatch.setattr(repo, "_cached_pipeline", None)
        monkeypatch.setattr(repo, "_cached_load_error", None)
        monkeypatch.setattr(repo, "_ensure_comfyui_vendor_on_path", lambda: None)
        monkeypatch.setattr(repo, "validate_audio_pipeline_configuration", lambda: None)
        monkeypatch.setattr(repo, "_get_ace_models_dir", lambda: Path("/fake"))
        monkeypatch.setattr(repo, "_get_required_component_name", lambda *a: a[-1])
        monkeypatch.setattr(repo, "ACE_COMFY_TEXT_ENCODER_2", "encoder2.safetensors")

        try:
            repo._cached_pipeline = None
            repo._cached_load_error = None
            repo.load_audio_pipeline()
        except Exception:
            pass

        if calls:
            assert len(calls[0]["paths"]) == 2
            assert calls[0]["clip_type"] == "ace"


class TestViteProxyConfiguration:
    def test_generate_image_proxy_routes_to_backend_port_8000(self) -> None:
        vite_config = Path(__file__).resolve().parents[1].joinpath("vite.config.ts").read_text(encoding="utf-8")
        assert "'/api/generate-image'" in vite_config
        assert "target: 'http://127.0.0.1:8000'" in vite_config
