from __future__ import annotations

import time
from pathlib import Path

import pytest

from models.errors import VideoGenerationFailedError, VideoGenerationTimeoutError
from models.schemas import GenerateRequestBody
from services import video_service

WAV_HEADER = b"RIFF" + b"\x00" * 100
PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
MP4_HEADER = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 16


def test_generate_video_orchestrates_audio_image_and_muxing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    temp_dir = tmp_path.joinpath("video-run")
    calls: list[str] = []

    monkeypatch.setattr(video_service.tempfile, "mkdtemp", lambda prefix: str(temp_dir))

    def fake_generate_audio_for_request(body):  # noqa: ANN001
        assert body.mood == "warm"
        calls.append("audio")
        return WAV_HEADER

    def fake_generate_image_png(body):  # noqa: ANN001
        assert body.prompt == "warm ambient lofi artwork"
        calls.append("image")
        return PNG_HEADER

    def fake_mux_image_and_audio_to_mp4(image_path: Path, audio_path: Path, output_path: Path) -> None:
        assert image_path.read_bytes() == PNG_HEADER
        assert audio_path.read_bytes() == WAV_HEADER
        calls.append("mux")
        output_path.write_bytes(MP4_HEADER)

    def fake_probe_media(path: Path) -> dict[str, object]:
        calls.append(f"probe:{path.name}")
        if path.name == "audio.wav":
            return {"format": {"duration": "40.0"}}
        if path.name == "output.mp4":
            return {
                "streams": [
                    {"codec_type": "video", "codec_name": "h264"},
                    {"codec_type": "audio", "codec_name": "aac"},
                ],
                "format": {"duration": "40.0"},
            }
        raise AssertionError(f"Unexpected probe target: {path}")

    monkeypatch.setattr(
        video_service.audio_service,
        "generate_audio_for_request",
        fake_generate_audio_for_request,
    )
    monkeypatch.setattr(
        video_service.image_service,
        "generate_image_png",
        fake_generate_image_png,
    )
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_image_and_audio_to_mp4",
        fake_mux_image_and_audio_to_mp4,
    )
    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    body = GenerateRequestBody(mood="warm", style="ambient", tempo=90, duration=40)
    mp4_bytes = video_service.generate_video_mp4_for_request(body)

    assert mp4_bytes == MP4_HEADER
    assert calls == ["audio", "image", "mux", "probe:output.mp4", "probe:audio.wav"]
    assert not temp_dir.exists()


def test_generate_video_rejects_invalid_stream_layout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_image_and_audio_to_mp4",
        lambda _image, _audio, output: output.write_bytes(MP4_HEADER),
    )

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "mp3"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    with pytest.raises(VideoGenerationFailedError, match="AAC"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())


def test_generate_video_rejects_duration_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_image_and_audio_to_mp4",
        lambda _image, _audio, output: output.write_bytes(MP4_HEADER),
    )

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "45.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    with pytest.raises(VideoGenerationFailedError, match="duration"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())


def test_generate_video_times_out_when_audio_step_exceeds_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(video_service, "VIDEO_GENERATION_TIMEOUT_SECONDS", 0.05)

    def slow_audio(_body):  # noqa: ANN001
        time.sleep(0.2)
        return WAV_HEADER

    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", slow_audio)

    with pytest.raises(VideoGenerationTimeoutError, match="timed out while generating audio"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())


def test_generate_video_cleans_intermediate_files_when_muxing_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    temp_dir = tmp_path.joinpath("video-run-failure")
    monkeypatch.setattr(video_service.tempfile, "mkdtemp", lambda prefix: str(temp_dir))
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)

    def fail_mux(_image_path: Path, _audio_path: Path, _output_path: Path) -> None:
        raise RuntimeError("mux failed")

    monkeypatch.setattr(video_service.media_repository, "mux_image_and_audio_to_mp4", fail_mux)

    with pytest.raises(VideoGenerationFailedError, match="mux failed"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())

    assert not temp_dir.exists()
