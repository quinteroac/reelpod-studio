from __future__ import annotations

from pathlib import Path

import pytest

from repositories import media_repository


def test_mux_image_and_audio_to_mp4_uses_h264_and_aac(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    class FakeFfmpegError(Exception):
        def __init__(self, stderr: bytes = b""):
            super().__init__("ffmpeg error")
            self.stderr = stderr

    class FakeRunner:
        def overwrite_output(self) -> "FakeRunner":
            seen["overwrite_output"] = True
            return self

        def run(self, capture_stdout: bool, capture_stderr: bool) -> tuple[bytes, bytes]:
            seen["capture_stdout"] = capture_stdout
            seen["capture_stderr"] = capture_stderr
            return (b"", b"")

    def fake_input(path: str, **kwargs: object) -> str:
        seen.setdefault("inputs", []).append({"path": path, "kwargs": kwargs})
        return f"input:{path}"

    def fake_output(video_input: str, audio_input: str, output_path: str, **kwargs: object) -> FakeRunner:
        seen["video_input"] = video_input
        seen["audio_input"] = audio_input
        seen["output_path"] = output_path
        seen["output_kwargs"] = kwargs
        return FakeRunner()

    class FakeFfmpegModule:
        Error = FakeFfmpegError

        @staticmethod
        def input(path: str, **kwargs: object) -> str:
            return fake_input(path, **kwargs)

        @staticmethod
        def output(video_input: str, audio_input: str, output_path: str, **kwargs: object) -> FakeRunner:
            return fake_output(video_input, audio_input, output_path, **kwargs)

    monkeypatch.setattr(media_repository, "_load_ffmpeg_module", lambda: FakeFfmpegModule)

    media_repository.mux_image_and_audio_to_mp4(
        Path("/tmp/image.png"),
        Path("/tmp/audio.wav"),
        Path("/tmp/output.mp4"),
    )

    assert seen["inputs"] == [
        {"path": "/tmp/image.png", "kwargs": {"loop": 1, "framerate": 30}},
        {"path": "/tmp/audio.wav", "kwargs": {}},
    ]
    assert seen["output_path"] == "/tmp/output.mp4"
    assert seen["output_kwargs"] == {
        "vcodec": "libx264",
        "acodec": "aac",
        "pix_fmt": "yuv420p",
        "shortest": None,
        "movflags": "+faststart",
    }
    assert seen["overwrite_output"] is True
    assert seen["capture_stdout"] is True
    assert seen["capture_stderr"] is True


def test_probe_media_returns_ffprobe_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = {"streams": [{"codec_type": "video"}], "format": {"duration": "1.0"}}

    class FakeFfmpegError(Exception):
        def __init__(self, stderr: bytes = b""):
            super().__init__("ffmpeg error")
            self.stderr = stderr

    class FakeFfmpegModule:
        Error = FakeFfmpegError

        @staticmethod
        def probe(_path: str) -> dict[str, object]:
            return expected

    monkeypatch.setattr(media_repository, "_load_ffmpeg_module", lambda: FakeFfmpegModule)
    assert media_repository.probe_media(Path("/tmp/output.mp4")) == expected
