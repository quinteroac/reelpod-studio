from __future__ import annotations

from fastapi.testclient import TestClient

import main

WAV_HEADER = b"RIFF" + b"\x00" * 100
PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_post_generate_preserves_contract(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_generate_audio_for_request(body):  # noqa: ANN001
        seen["mode"] = body.mode
        seen["mood"] = body.mood
        seen["tempo"] = body.tempo
        seen["duration"] = body.duration
        seen["style"] = body.style
        return WAV_HEADER

    monkeypatch.setattr(main.audio_service, "generate_audio_for_request", fake_generate_audio_for_request)

    with TestClient(app=main.app, raise_server_exceptions=False) as client:
        response = client.post("/api/generate", json={"mood": "warm", "tempo": 95, "duration": 90, "style": "hip-hop"})
        wrong_method = client.get("/api/generate")

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content.startswith(b"RIFF")
    assert seen == {
        "mode": "params",
        "mood": "warm",
        "tempo": 95,
        "duration": 90,
        "style": "hip-hop",
    }
    assert wrong_method.status_code == 405


def test_post_generate_requests_preserves_contract(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_create_generation_request(body):  # noqa: ANN001
        seen["mode"] = body.mode
        seen["mood"] = body.mood
        seen["tempo"] = body.tempo
        seen["duration"] = body.duration
        seen["style"] = body.style
        return {"id": "req-123", "status": "queued"}

    monkeypatch.setattr(main.audio_service, "create_generation_request", fake_create_generation_request)

    with TestClient(app=main.app, raise_server_exceptions=False) as client:
        response = client.post("/api/generate-requests", json={"mood": "chill", "tempo": 80, "style": "jazz"})
        wrong_method = client.get("/api/generate-requests")

    assert response.status_code == 200
    assert response.json() == {"id": "req-123", "status": "queued"}
    assert set(response.json().keys()) == {"id", "status"}
    assert seen == {
        "mode": "params",
        "mood": "chill",
        "tempo": 80,
        "duration": 40,
        "style": "jazz",
    }
    assert wrong_method.status_code == 405


def test_get_generate_request_status_preserves_contract(monkeypatch) -> None:
    def fake_get_generation_request_status(item_id: str) -> dict[str, str | None]:
        assert item_id == "req-123"
        return {"id": item_id, "status": "completed", "error": None}

    monkeypatch.setattr(main.audio_service, "get_generation_request_status", fake_get_generation_request_status)

    with TestClient(app=main.app, raise_server_exceptions=False) as client:
        response = client.get("/api/generate-requests/req-123")
        wrong_method = client.post("/api/generate-requests/req-123", json={})

    assert response.status_code == 200
    assert response.json() == {"id": "req-123", "status": "completed", "error": None}
    assert set(response.json().keys()) == {"id", "status", "error"}
    assert wrong_method.status_code == 405


def test_get_generate_request_audio_preserves_contract(monkeypatch) -> None:
    def fake_get_generation_request_audio(item_id: str) -> bytes:
        assert item_id == "req-123"
        return WAV_HEADER

    monkeypatch.setattr(main.audio_service, "get_generation_request_audio", fake_get_generation_request_audio)

    with TestClient(app=main.app, raise_server_exceptions=False) as client:
        response = client.get("/api/generate-requests/req-123/audio")
        wrong_method = client.post("/api/generate-requests/req-123/audio", json={})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content.startswith(b"RIFF")
    assert wrong_method.status_code == 405


def test_post_generate_image_preserves_contract(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_generate_image_png(body):  # noqa: ANN001
        seen["prompt"] = body.prompt
        seen["target_width"] = body.target_width
        seen["target_height"] = body.target_height
        return PNG_HEADER

    monkeypatch.setattr(main.image_service, "generate_image_png", fake_generate_image_png)

    with TestClient(app=main.app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/generate-image",
            json={"prompt": "misty mountains", "targetWidth": 1080, "targetHeight": 1920},
        )
        wrong_method = client.get("/api/generate-image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert seen == {"prompt": "misty mountains", "target_width": 1080, "target_height": 1920}
    assert wrong_method.status_code == 405
