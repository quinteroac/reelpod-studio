from __future__ import annotations

import json
import time
import tomllib
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

import main

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


class FakeImage:
    def save(self, output, format: str) -> None:  # noqa: ANN001
        assert format == "PNG"
        output.write(b"\x89PNG\r\n\x1a\nfake")


class FakeImageResult:
    def __init__(self, images: list[FakeImage]):
        self.images = images


@pytest.fixture
def client() -> TestClient:
    with TestClient(app=main.app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_queue_state() -> None:
    main.stop_queue_worker()
    main.reset_generation_queue_for_tests()
    yield
    main.stop_queue_worker()
    main.reset_generation_queue_for_tests()


class TestGenerateRequestBody:
    def test_valid_request_body(self) -> None:
        body = main.GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        assert body.mood == "chill"
        assert body.tempo == 80
        assert body.style == "jazz"

    def test_tempo_below_minimum_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="chill", tempo=59, style="jazz")

    def test_tempo_above_maximum_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="chill", tempo=121, style="jazz")

    def test_empty_mood_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="", tempo=80, style="jazz")

    def test_whitespace_only_style_rejected(self) -> None:
        with pytest.raises(Exception):
            main.GenerateRequestBody(mood="calm", tempo=80, style="   ")


class TestBuildPrompt:
    def test_prompt_follows_template(self) -> None:
        body = main.GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        assert main.build_prompt(body) == "chill lofi jazz, 80 BPM"

    def test_prompt_template_documented_in_source(self) -> None:
        source = Path(__file__).parent.joinpath("main.py").read_text(encoding="utf-8")
        assert '# Prompt template for params mode: "{mood} lofi {style}, {tempo} BPM"' in source

    def test_text_mode_prompt_uses_user_text_verbatim(self) -> None:
        body = main.GenerateRequestBody(mode="text", prompt="  crunchy drums with vinyl hiss  ")
        assert main.build_prompt(body) == "crunchy drums with vinyl hiss"


class TestAceStepApiConfiguration:
    def test_api_url_defaults_to_localhost(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ACESTEP_API_URL", raising=False)
        assert main.get_acestep_api_url() == "http://localhost:8001"

    def test_api_url_comes_from_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ACESTEP_API_URL", "http://127.0.0.1:8765/")
        assert main.get_acestep_api_url() == "http://127.0.0.1:8765"


class TestSourceGuards:
    def test_main_does_not_import_acestep_pipeline(self) -> None:
        source = Path(__file__).parent.joinpath("main.py").read_text(encoding="utf-8")
        assert "ACEStepPipeline" not in source
        assert "import acestep" not in source
        assert "from acestep" not in source

    def test_no_model_load_happens_at_startup(self) -> None:
        with pytest.MonkeyPatch.context() as mp:
            calls: list[object] = []

            def fake_urlopen(*args, **kwargs):  # noqa: ANN002, ANN003
                calls.append((args, kwargs))
                raise AssertionError("urlopen should not be called during startup")

            mp.setattr(main, "urlopen", fake_urlopen)
            with TestClient(app=main.app):
                pass
            assert calls == []


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

    def test_backend_has_http_client_for_acestep_api_calls(self) -> None:
        source = Path(__file__).parent.joinpath("main.py").read_text(encoding="utf-8")
        pyproject_path = Path(__file__).parent.joinpath("pyproject.toml")
        project = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        dependencies = project["project"]["dependencies"]

        has_httpx_dependency = any(dep == "httpx" or dep.startswith("httpx") for dep in dependencies)
        has_urllib_client = "from urllib.request import Request, urlopen" in source

        assert has_httpx_dependency or has_urllib_client


class TestGenerateEndpoint:
    def test_generate_calls_release_query_and_audio_endpoints(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ACESTEP_API_URL", "http://localhost:9000")
        monkeypatch.setattr(main.time, "sleep", lambda _seconds: None)

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

        monkeypatch.setattr(main, "urlopen", fake_urlopen)

        response = client.post("/api/generate", json={"mood": "warm", "tempo": 95, "style": "hip-hop"})

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
                "audio_duration": 30,
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

        monkeypatch.setattr(main, "urlopen", raise_url_error)
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    def test_non_ok_status_returns_500(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        def raise_http_error(request, timeout=30):  # noqa: ANN001, ARG001
            raise HTTPError(request.full_url, 502, "Bad Gateway", hdrs=None, fp=None)

        monkeypatch.setattr(main, "urlopen", raise_http_error)
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    def test_task_failure_status_returns_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            if request.full_url.endswith("/release_task"):
                return FakeHTTPResponse(json.dumps({"task_id": "task-123"}).encode("utf-8"))
            if request.full_url.endswith("/query_result"):
                return FakeHTTPResponse(
                    json.dumps({"status": 2, "result": json.dumps({"message": "failed"})}).encode("utf-8")
                )
            raise AssertionError(f"Unexpected URL: {request.full_url}")

        monkeypatch.setattr(main, "urlopen", fake_urlopen)
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        assert response.status_code == 500
        assert response.json() == {"error": "Audio generation failed"}

    def test_validation_error_returns_422(self, client: TestClient) -> None:
        response = client.post("/api/generate", json={"mood": "chill", "tempo": 30, "style": "jazz"})
        assert response.status_code == 422
        assert response.json() == {
            "error": "Invalid payload. Expected { mode?: 'text'|'text+params'|'text-and-parameters'|'params'|'parameters', prompt?: string, mood?: string, tempo?: number (60-120), style?: string }"
        }

    def test_text_mode_without_prompt_returns_422(self, client: TestClient) -> None:
        response = client.post("/api/generate", json={"mode": "text"})
        assert response.status_code == 422
        assert response.json() == {
            "error": "Invalid payload. Expected { mode?: 'text'|'text+params'|'text-and-parameters'|'params'|'parameters', prompt?: string, mood?: string, tempo?: number (60-120), style?: string }"
        }


class TestGenerationQueue:
    def test_generation_request_is_queued_in_memory(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(main, "ensure_queue_worker_running", lambda: None)
        item = main.enqueue_generation_request(
            main.GenerateRequestBody(mood="chill", tempo=80, style="jazz")
        )

        snapshot = main.get_queue_item_snapshot(item.id)
        assert snapshot is not None
        assert snapshot.status == "queued"
        assert list(main.queue_order) == [item.id]

    def test_text_mode_queue_item_uses_default_bpm_80(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(main, "ensure_queue_worker_running", lambda: None)
        item = main.enqueue_generation_request(
            main.GenerateRequestBody(mode="text", prompt="slow nostalgic tape wobble", tempo=110)
        )

        snapshot = main.get_queue_item_snapshot(item.id)
        assert snapshot is not None
        assert snapshot.status == "queued"
        assert snapshot.prompt == "slow nostalgic tape wobble"
        assert snapshot.tempo == 80

    def test_queue_worker_processes_one_item_at_a_time_and_uses_submit_poll_flow(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        order: list[str] = []
        active_count = 0
        max_active_count = 0
        lock = main.threading.Lock()

        def fake_submit_task(prompt: str, tempo: int = 80) -> str:
            order.append(f"submit:{prompt}")
            return f"task-{prompt}"

        def fake_poll_until_complete(task_id: str) -> dict[str, str]:
            nonlocal active_count, max_active_count
            order.append(f"poll:{task_id}")
            with lock:
                active_count += 1
                max_active_count = max(max_active_count, active_count)
            time.sleep(0.03)
            with lock:
                active_count -= 1
            return {"result": json.dumps({"file": f"/audio/{task_id}.wav"})}

        def fake_get_bytes(url: str) -> bytes:
            order.append(f"get:{url}")
            return WAV_HEADER

        monkeypatch.setattr(main, "submit_task", fake_submit_task)
        monkeypatch.setattr(main, "poll_until_complete", fake_poll_until_complete)
        monkeypatch.setattr(main, "get_bytes", fake_get_bytes)

        first = main.enqueue_generation_request(main.GenerateRequestBody(mood="mellow", tempo=70, style="jazz"))
        second = main.enqueue_generation_request(main.GenerateRequestBody(mood="warm", tempo=90, style="ambient"))

        main.ensure_queue_worker_running()
        first_result = main.wait_for_terminal_status(first.id, timeout_seconds=2.0)
        second_result = main.wait_for_terminal_status(second.id, timeout_seconds=2.0)

        assert first_result is not None and first_result.status == "completed"
        assert second_result is not None and second_result.status == "completed"
        assert max_active_count == 1
        assert order == [
            "submit:mellow lofi jazz, 70 BPM",
            "poll:task-mellow lofi jazz, 70 BPM",
            "get:http://localhost:8001/audio/task-mellow lofi jazz, 70 BPM.wav",
            "submit:warm lofi ambient, 90 BPM",
            "poll:task-warm lofi ambient, 90 BPM",
            "get:http://localhost:8001/audio/task-warm lofi ambient, 90 BPM.wav",
        ]

    def test_next_item_starts_after_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        prompts_seen: list[str] = []

        def fake_generate_audio_bytes_for_prompt(prompt: str, tempo: int = 80) -> bytes:
            prompts_seen.append(prompt)
            if prompt.startswith("fail"):
                raise RuntimeError("inference failed")
            return WAV_HEADER

        monkeypatch.setattr(main, "generate_audio_bytes_for_prompt", fake_generate_audio_bytes_for_prompt)

        failed = main.enqueue_generation_request(main.GenerateRequestBody(mood="fail", tempo=80, style="jazz"))
        succeeded = main.enqueue_generation_request(main.GenerateRequestBody(mood="calm", tempo=88, style="ambient"))

        main.ensure_queue_worker_running()
        failed_result = main.wait_for_terminal_status(failed.id, timeout_seconds=2.0)
        succeeded_result = main.wait_for_terminal_status(succeeded.id, timeout_seconds=2.0)

        assert failed_result is not None and failed_result.status == "failed"
        assert succeeded_result is not None and succeeded_result.status == "completed"
        assert prompts_seen == ["fail lofi jazz, 80 BPM", "calm lofi ambient, 88 BPM"]

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
    def test_model_is_loaded_once_at_startup_with_expected_model_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []

        def fake_load_image_pipeline() -> object:
            calls.append(main.IMAGE_MODEL_ID)
            return object()

        monkeypatch.setattr(main, "load_image_pipeline", fake_load_image_pipeline)
        with TestClient(app=main.app, raise_server_exceptions=False):
            pass

        assert calls == ["circlestone-labs/Anima"]

    def test_generate_image_returns_png_binary_and_uses_1024_square_resolution(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_calls: list[dict[str, object]] = []

        class Pipeline:
            def __call__(self, *, prompt: str, width: int, height: int, **kwargs: object) -> FakeImageResult:
                seen_calls.append({"prompt": prompt, "width": width, "height": height})
                return FakeImageResult([FakeImage()])

        monkeypatch.setattr(main, "load_image_pipeline", lambda: Pipeline())
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

    def test_model_load_failure_returns_500_with_meaningful_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def raise_model_load_error() -> object:
            raise RuntimeError("model weights missing")

        monkeypatch.setattr(main, "load_image_pipeline", raise_model_load_error)
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post("/api/generate-image", json={"prompt": "forest path"})

        assert response.status_code == 500
        assert response.json() == {"error": "Image generation failed: model weights missing"}

    def test_inference_failure_returns_500_with_meaningful_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class Pipeline:
            def __call__(self, *, prompt: str, width: int, height: int, **kwargs: object) -> FakeImageResult:
                raise RuntimeError("inference error")

        monkeypatch.setattr(main, "load_image_pipeline", lambda: Pipeline())
        with TestClient(app=main.app, raise_server_exceptions=False) as test_client:
            response = test_client.post("/api/generate-image", json={"prompt": "forest path"})

        assert response.status_code == 500
        assert response.json() == {"error": "Image generation failed: inference error"}


class TestViteProxyConfiguration:
    def test_generate_image_proxy_routes_to_backend_port_8000(self) -> None:
        vite_config = Path(__file__).resolve().parents[1].joinpath("vite.config.ts").read_text(encoding="utf-8")
        assert "'/api/generate-image'" in vite_config
        assert "target: 'http://127.0.0.1:8000'" in vite_config
