from __future__ import annotations

import json

import pytest

from repositories import acestep_repository


class FakeHTTPResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class TestSubmitTask:
    def test_submit_task_posts_expected_payload_and_returns_task_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_requests: list[dict[str, object]] = []

        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            seen_requests.append(
                {
                    "url": request.full_url,
                    "method": request.get_method(),
                    "payload": json.loads(request.data.decode("utf-8")),
                }
            )
            return FakeHTTPResponse(json.dumps({"task_id": "task-123"}).encode("utf-8"))

        monkeypatch.setenv("ACESTEP_API_URL", "http://localhost:9000")
        monkeypatch.setattr(acestep_repository, "urlopen", fake_urlopen)

        task_id = acestep_repository.submit_task("warm lofi hip-hop, 95 BPM", tempo=95, duration=95)

        assert task_id == "task-123"
        assert seen_requests == [
            {
                "url": "http://localhost:9000/release_task",
                "method": "POST",
                "payload": {
                    "prompt": "warm lofi hip-hop, 95 BPM",
                    "lyrics": "",
                    "bpm": 95,
                    "audio_duration": 95,
                    "inference_steps": 20,
                    "audio_format": "wav",
                    "thinking": True,
                },
            }
        ]


class TestPollUntilComplete:
    def test_poll_until_complete_returns_completed_task_when_status_is_1(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_payloads: list[dict[str, object]] = []
        call_count = 0

        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            nonlocal call_count
            seen_payloads.append(json.loads(request.data.decode("utf-8")))
            call_count += 1
            if call_count == 1:
                body = {"data": [{"status": 0}]}
            else:
                body = {"data": [{"status": 1, "result": json.dumps({"file": "/v1/audio?path=out.wav"})}]}
            return FakeHTTPResponse(json.dumps(body).encode("utf-8"))

        monkeypatch.setenv("ACESTEP_API_URL", "http://localhost:9000")
        monkeypatch.setattr(acestep_repository.time, "sleep", lambda _seconds: None)
        monkeypatch.setattr(acestep_repository, "urlopen", fake_urlopen)

        result = acestep_repository.poll_until_complete("task-123")

        assert result == {"status": 1, "result": json.dumps({"file": "/v1/audio?path=out.wav"})}
        assert seen_payloads == [
            {"task_id_list": ["task-123"]},
            {"task_id_list": ["task-123"]},
        ]

    def test_poll_until_complete_raises_when_status_is_2(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            return FakeHTTPResponse(json.dumps({"data": [{"status": 2}]}).encode("utf-8"))

        monkeypatch.setattr(acestep_repository, "urlopen", fake_urlopen)

        with pytest.raises(RuntimeError, match="ACE-Step task failed"):
            acestep_repository.poll_until_complete("task-123")


class TestGetBytes:
    def test_get_bytes_fetches_url_via_get_and_returns_response_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_requests: list[dict[str, str]] = []

        def fake_urlopen(request, timeout=30):  # noqa: ANN001, ARG001
            seen_requests.append({"url": request.full_url, "method": request.get_method()})
            return FakeHTTPResponse(b"WAV-BYTES")

        monkeypatch.setattr(acestep_repository, "urlopen", fake_urlopen)

        body = acestep_repository.get_bytes("http://localhost:9000/v1/audio?path=out.wav")

        assert body == b"WAV-BYTES"
        assert seen_requests == [
            {"url": "http://localhost:9000/v1/audio?path=out.wav", "method": "GET"}
        ]
