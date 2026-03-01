from __future__ import annotations

import io
import json
import time
import tomllib
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from models.schemas import GenerateRequestBody
from repositories import acestep_repository, image_repository
from services import audio_service, image_service

WAV_HEADER = b"RIFF" + b"\x00" * 100


class FakeHTTPResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeImageResult:
    def __init__(self, images: list[Image.Image]):
        self.images = images


@pytest.fixture
def client() -> TestClient:
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
        body = GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        assert body.mood == "chill"
        assert body.tempo == 80
        assert body.duration == 40
        assert body.style == "jazz"

    def test_tempo_below_minimum_rejected(self) -> None:
        with pytest.raises(Exception):
            GenerateRequestBody(mood="chill", tempo=59, style="jazz")

    def test_text_mode_without_prompt_rejected(self) -> None:
        with pytest.raises(Exception):
            GenerateRequestBody(mode="text")


class TestBuildPrompt:
    def test_prompt_follows_template(self) -> None:
        body = GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        assert audio_service.build_prompt(body) == "chill lofi jazz, 80 BPM"

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


class TestGenerateEndpoint:
    def test_generate_calls_release_query_and_audio_endpoints(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ACESTEP_API_URL", "http://localhost:9000")
        monkeypatch.setattr(acestep_repository.time, "sleep", lambda _seconds: None)

        seen_release_payloads: list[dict[str, object]] = []
        query_call_count = 0
        audio_urls: list[str] = []

        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            nonlocal query_call_count
            url = request.full_url
            method = request.get_method()
            if url.endswith("/release_task"):
                assert method == "POST"
                payload = json.loads(request.data.decode("utf-8"))
                seen_release_payloads.append(payload)
                return FakeHTTPResponse(json.dumps({"task_id": "task-123"}).encode("utf-8"))
            if url.endswith("/query_result"):
                assert method == "POST"
                payload = json.loads(request.data.decode("utf-8"))
                assert payload == {"task_id_list": ["task-123"]}
                query_call_count += 1
                if query_call_count == 1:
                    return FakeHTTPResponse(json.dumps({"data": [{"status": 0}]}).encode("utf-8"))
                return FakeHTTPResponse(
                    json.dumps(
                        {"data": [{"status": 1, "result": json.dumps({"file": "/v1/audio?path=out.wav"})}]}
                    ).encode("utf-8")
                )
            if "/v1/audio?path=out.wav" in url:
                assert method == "GET"
                audio_urls.append(url)
                return FakeHTTPResponse(WAV_HEADER)
            raise AssertionError(f"Unexpected URL: {url}")

        monkeypatch.setattr(acestep_repository, "urlopen", fake_urlopen)

        response = client.post(
            "/api/generate",
            json={"mood": "warm", "tempo": 95, "duration": 95, "style": "hip-hop"},
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert response.content.startswith(b"RIFF")
        assert query_call_count == 2
        assert audio_urls == ["http://localhost:9000/v1/audio?path=out.wav"]
        assert seen_release_payloads == [
            {
                "prompt": "warm lofi hip-hop, 95 BPM",
                "lyrics": "",
                "bpm": 95,
                "audio_duration": 95,
                "inference_steps": 20,
                "audio_format": "wav",
                "thinking": True,
            }
        ]

    def test_connection_error_returns_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def raise_url_error(*args, **kwargs):  # noqa: ANN002, ANN003
            raise URLError("connection refused")

        monkeypatch.setattr(acestep_repository, "urlopen", raise_url_error)
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    def test_non_ok_status_returns_500(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        def raise_http_error(request, timeout=30):  # noqa: ANN001, ARG001
            raise HTTPError(request.full_url, 502, "Bad Gateway", hdrs=None, fp=None)

        monkeypatch.setattr(acestep_repository, "urlopen", raise_http_error)
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    def test_validation_error_returns_422(self, client: TestClient) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 30, "style": "jazz"})
        assert response.status_code == 422


class TestGenerationQueue:
    def test_generation_request_is_queued_in_memory(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(audio_service, "ensure_queue_worker_running", lambda: None)
        item = audio_service.enqueue_generation_request(
            GenerateRequestBody(mood="chill", tempo=80, style="jazz")
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
            acestep_repository,
            "generate_audio_bytes_for_prompt",
            fake_generate_audio_bytes_for_prompt,
        )

        first = audio_service.enqueue_generation_request(
            GenerateRequestBody(mood="mellow", tempo=70, style="jazz")
        )
        second = audio_service.enqueue_generation_request(
            GenerateRequestBody(mood="warm", tempo=90, style="ambient")
        )

        audio_service.ensure_queue_worker_running()
        first_result = audio_service.wait_for_terminal_status(first.id, timeout_seconds=2.0)
        second_result = audio_service.wait_for_terminal_status(second.id, timeout_seconds=2.0)

        assert first_result is not None and first_result.status == "completed"
        assert second_result is not None and second_result.status == "completed"
        assert max_active_count == 1
        assert order == [
            "generate:mellow lofi jazz, 70 BPM:70",
            "generate:warm lofi ambient, 90 BPM:90",
        ]

    def test_queue_status_endpoint_returns_item_status(self, client: TestClient) -> None:
        created = client.post("/api/generate-requests", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert created.status_code == 200
        item_id = created.json()["id"]

        status_response = client.get(f"/api/generate-requests/{item_id}")
        assert status_response.status_code == 200
        payload = status_response.json()
        assert payload["id"] == item_id
        assert payload["status"] in ("queued", "generating", "completed", "failed")


class TestGenerateImageEndpoint:
    def test_generate_image_returns_png_binary_and_uses_1024_square_resolution(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_calls: list[dict[str, object]] = []

        class Pipeline:
            def __call__(self, *, prompt: str, width: int, height: int, **kwargs: object) -> FakeImageResult:
                seen_calls.append({"prompt": prompt, "width": width, "height": height})
                return FakeImageResult([Image.new("RGB", (width, height), color=(80, 120, 200))])

        monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: Pipeline())
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post("/api/generate-image", json={"prompt": "misty mountains"})
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            assert response.content.startswith(b"\x89PNG\r\n\x1a\n")

            second = test_client.post("/api/generate-image", json={"prompt": "city sunset"})
            assert second.status_code == 200

        assert seen_calls == [
            {"prompt": "misty mountains", "width": 1024, "height": 1024},
            {"prompt": "city sunset", "width": 1024, "height": 1024},
        ]

    def test_generate_image_uses_requested_target_resolution(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class Pipeline:
            def __call__(self, *, prompt: str, width: int, height: int, **kwargs: object) -> FakeImageResult:
                return FakeImageResult([Image.new("RGB", (width, height), color=(255, 255, 255))])

        monkeypatch.setattr(image_repository, "load_image_pipeline", lambda: Pipeline())
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post(
                "/api/generate-image",
                json={"prompt": "vertical neon alley", "targetWidth": 1080, "targetHeight": 1920},
            )
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            output = Image.open(io.BytesIO(response.content))
            assert output.size == (1080, 1920)

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


class TestViteProxyConfiguration:
    def test_generate_image_proxy_routes_to_backend_port_8000(self) -> None:
        vite_config = Path(__file__).resolve().parents[1].joinpath("vite.config.ts").read_text(encoding="utf-8")
        assert "'/api/generate-image'" in vite_config
        assert "target: 'http://127.0.0.1:8000'" in vite_config
