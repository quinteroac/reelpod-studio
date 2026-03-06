from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from PIL import Image

from models.errors import VideoGenerationFailedError, VideoGenerationTimeoutError
from models.schemas import GenerateRequestBody
from services import video_service

WAV_HEADER = b"RIFF" + b"\x00" * 100
MP4_HEADER = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 16


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color=(1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


PNG_HEADER = _make_png_bytes()


def _patch_trim_trailing_silence_to_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_trim_trailing_silence(audio_path: Path, output_path: Path) -> None:
        output_path.write_bytes(audio_path.read_bytes())

    monkeypatch.setattr(
        video_service.media_repository,
        "trim_trailing_silence",
        fake_trim_trailing_silence,
    )


def _patch_wan_i2v_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub out the Wan I2V step so existing tests are not affected."""

    def fake_load_video_pipeline() -> object:
        return object()

    def fake_run_video_inference(
        pipeline: object,
        *,
        input_image: object,
        target_width: int,
        target_height: int,
        temp_dir: Path,
    ) -> Path:
        clip_path = temp_dir / "wan_clip.mp4"
        clip_path.write_bytes(MP4_HEADER)
        return clip_path

    monkeypatch.setattr(video_service.video_repository, "load_video_pipeline", fake_load_video_pipeline)
    monkeypatch.setattr(video_service.video_repository, "run_video_inference", fake_run_video_inference)


def _patch_loop_and_mux_noop(
    monkeypatch: pytest.MonkeyPatch,
    calls: list[str] | None = None,
    *,
    target_width: int = 1024,
    target_height: int = 1024,
) -> None:
    """Stub loop_video_to_duration and mux_video_and_audio_to_mp4."""

    def fake_loop_video_to_duration(
        video_path: Path,
        target_duration: float,
        output_path: Path,
    ) -> None:
        if calls is not None:
            calls.append("loop")
        output_path.write_bytes(video_path.read_bytes())

    def fake_mux_video_and_audio_to_mp4(
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        *,
        target_width: int,
        target_height: int,
    ) -> None:
        if calls is not None:
            calls.append("mux")
        output_path.write_bytes(MP4_HEADER)

    monkeypatch.setattr(
        video_service.media_repository,
        "loop_video_to_duration",
        fake_loop_video_to_duration,
    )
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_video_and_audio_to_mp4",
        fake_mux_video_and_audio_to_mp4,
    )


def test_generate_video_orchestrates_audio_image_and_muxing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    temp_dir = tmp_path.joinpath("video-run")
    calls: list[str] = []
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)

    monkeypatch.setattr(video_service.tempfile, "mkdtemp", lambda prefix: str(temp_dir))

    def fake_generate_audio_for_request(body):  # noqa: ANN001
        assert body.mood == "warm"
        calls.append("audio")
        return WAV_HEADER

    def fake_generate_image_png(body):  # noqa: ANN001
        assert body.__class__.__name__ == "GenerateImageRequestBody"
        assert body.prompt == "warm ambient lofi artwork"
        assert body.target_width == 1024
        assert body.target_height == 1024
        calls.append("image")
        return PNG_HEADER

    def fake_loop_video_to_duration(
        video_path: Path,
        target_duration: float,
        output_path: Path,
    ) -> None:
        calls.append("loop")
        output_path.write_bytes(video_path.read_bytes())

    def fake_mux_video_and_audio_to_mp4(
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        *,
        target_width: int,
        target_height: int,
    ) -> None:
        assert audio_path.read_bytes() == WAV_HEADER
        assert target_width == 1024
        assert target_height == 1024
        calls.append("mux")
        output_path.write_bytes(MP4_HEADER)

    def fake_probe_media(path: Path) -> dict[str, object]:
        calls.append(f"probe:{path.name}")
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        if path.name == "output.mp4":
            return {
                "streams": [
                    {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
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
        "loop_video_to_duration",
        fake_loop_video_to_duration,
    )
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_video_and_audio_to_mp4",
        fake_mux_video_and_audio_to_mp4,
    )
    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    body = GenerateRequestBody(mood="warm", style="ambient", tempo=90, duration=40)
    mp4_bytes = video_service.generate_video_mp4_for_request(body)

    assert mp4_bytes == MP4_HEADER
    # New pipeline order: audio → image → wan_i2v → probe_audio → loop → mux → probe_output
    assert calls == [
        "audio",
        "image",
        "probe:audio_trimmed.wav",
        "loop",
        "mux",
        "probe:output.mp4",
    ]
    assert not temp_dir.exists()


def test_generate_video_uses_user_prompt_for_image_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    seen: dict[str, object] = {}

    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)

    def fake_generate_image_png(body):  # noqa: ANN001
        seen["prompt"] = body.prompt
        seen["target_width"] = body.target_width
        seen["target_height"] = body.target_height
        return PNG_HEADER

    monkeypatch.setattr(video_service.image_service, "generate_image_png", fake_generate_image_png)
    _patch_loop_and_mux_noop(monkeypatch, target_width=1080, target_height=1920)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    body = GenerateRequestBody(
        mode="text",
        prompt=" cinematic skyline at blue hour ",
        mood="warm",
        style="ambient",
        tempo=90,
        duration=40,
        targetWidth=1080,
        targetHeight=1920,
    )

    mp4_bytes = video_service.generate_video_mp4_for_request(body)

    assert mp4_bytes == MP4_HEADER
    assert seen == {
        "prompt": "cinematic skyline at blue hour",
        "target_width": 1080,
        "target_height": 1920,
    }


def test_generate_video_rejects_invalid_stream_layout(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
                {"codec_type": "audio", "codec_name": "mp3"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    with pytest.raises(VideoGenerationFailedError, match="AAC"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())


def test_generate_video_rejects_duration_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
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
    _patch_trim_trailing_silence_to_copy(monkeypatch)
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
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.tempfile, "mkdtemp", lambda prefix: str(temp_dir))
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)

    # Stub loop to succeed so the failure happens in mux
    monkeypatch.setattr(
        video_service.media_repository,
        "loop_video_to_duration",
        lambda video_path, target_duration, output_path: output_path.write_bytes(video_path.read_bytes()),
    )

    # Stub probe for audio duration (needed before loop)
    monkeypatch.setattr(
        video_service.media_repository,
        "probe_media",
        lambda path: {"format": {"duration": "40.0"}},
    )

    def fail_mux(
        _video_path: Path,
        _audio_path: Path,
        _output_path: Path,
        *,
        target_width: int,
        target_height: int,
    ) -> None:
        assert target_width == 1024
        assert target_height == 1024
        raise RuntimeError("mux failed")

    monkeypatch.setattr(video_service.media_repository, "mux_video_and_audio_to_mp4", fail_mux)

    with pytest.raises(VideoGenerationFailedError, match="mux failed"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())

    assert not temp_dir.exists()


@pytest.mark.parametrize(
    ("target_width", "target_height"),
    [(1920, 1080), (1080, 1920), (1080, 1080)],
)
def test_generate_video_completes_for_platform_presets(
    target_width: int,
    target_height: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)

    seen_mux: dict[str, int] = {}

    def fake_mux_video_and_audio_to_mp4(
        _video_path: Path,
        _audio_path: Path,
        output_path: Path,
        *,
        target_width: int,
        target_height: int,
    ) -> None:
        seen_mux["target_width"] = target_width
        seen_mux["target_height"] = target_height
        output_path.write_bytes(MP4_HEADER)

    monkeypatch.setattr(
        video_service.media_repository,
        "loop_video_to_duration",
        lambda video_path, target_duration, output_path: output_path.write_bytes(video_path.read_bytes()),
    )

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": target_width,
                    "height": target_height,
                },
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(
        video_service.media_repository,
        "mux_video_and_audio_to_mp4",
        fake_mux_video_and_audio_to_mp4,
    )
    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    mp4_bytes = video_service.generate_video_mp4_for_request(
        GenerateRequestBody(
            mood="warm",
            style="ambient",
            tempo=90,
            duration=40,
            targetWidth=target_width,
            targetHeight=target_height,
        )
    )

    assert mp4_bytes == MP4_HEADER
    assert seen_mux == {"target_width": target_width, "target_height": target_height}


def test_generate_video_rejects_mismatched_final_frame_dimensions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    with pytest.raises(VideoGenerationFailedError, match="frame dimensions"):
        video_service.generate_video_mp4_for_request(
            GenerateRequestBody(targetWidth=1080, targetHeight=1920)
        )


# ---------------------------------------------------------------------------
# US-003 – Mux looped animated clip with audio
# ---------------------------------------------------------------------------


def test_us003_ac01_muxed_output_has_one_h264_and_one_aac_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC01: The muxed output contains exactly one H.264 video stream and one AAC audio stream."""
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    validated_streams: dict[str, object] = {}

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        probe_data = {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.0"},
        }
        validated_streams["data"] = probe_data
        return probe_data

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    mp4_bytes = video_service.generate_video_mp4_for_request(GenerateRequestBody())

    assert mp4_bytes == MP4_HEADER
    # Verify that _validate_mp4_streams was reached and passed
    assert "data" in validated_streams
    streams = validated_streams["data"]["streams"]
    video_streams = [s for s in streams if s["codec_type"] == "video"]
    audio_streams = [s for s in streams if s["codec_type"] == "audio"]
    assert len(video_streams) == 1
    assert video_streams[0]["codec_name"] == "h264"
    assert len(audio_streams) == 1
    assert audio_streams[0]["codec_name"] == "aac"


def test_us003_ac02_frame_dimensions_match_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC02: Frame dimensions of the output MP4 match body.image_target_width x body.image_target_height."""
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)

    mux_calls: list[dict[str, int]] = []

    def fake_loop(video_path: Path, target_duration: float, output_path: Path) -> None:
        output_path.write_bytes(video_path.read_bytes())

    def fake_mux(
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        *,
        target_width: int,
        target_height: int,
    ) -> None:
        mux_calls.append({"target_width": target_width, "target_height": target_height})
        output_path.write_bytes(MP4_HEADER)

    monkeypatch.setattr(video_service.media_repository, "loop_video_to_duration", fake_loop)
    monkeypatch.setattr(video_service.media_repository, "mux_video_and_audio_to_mp4", fake_mux)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    body = GenerateRequestBody(targetWidth=1080, targetHeight=1920)
    mp4_bytes = video_service.generate_video_mp4_for_request(body)

    assert mp4_bytes == MP4_HEADER
    assert len(mux_calls) == 1
    assert mux_calls[0] == {"target_width": 1080, "target_height": 1920}


def test_us003_ac03_duration_within_tolerance_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC03: Small duration diff within tolerance succeeds."""
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "40.1"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)
    mp4_bytes = video_service.generate_video_mp4_for_request(GenerateRequestBody())
    assert mp4_bytes == MP4_HEADER


def test_us003_ac03_duration_outside_tolerance_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC03: Duration diff exceeding tolerance raises error."""
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)
    _patch_loop_and_mux_noop(monkeypatch)

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "40.0"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "41.0"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)
    with pytest.raises(VideoGenerationFailedError, match="duration"):
        video_service.generate_video_mp4_for_request(GenerateRequestBody())


def test_us003_ac04_validate_mp4_streams_and_parse_dimensions_unchanged() -> None:
    """AC04: Existing _validate_mp4_streams and _parse_video_dimensions checks pass without modification."""
    # Verify _validate_mp4_streams accepts correct data
    valid_probe = {
        "streams": [
            {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "aac"},
        ],
    }
    video_service._validate_mp4_streams(valid_probe)  # should not raise

    # Verify _parse_video_dimensions returns correct dimensions
    w, h = video_service._parse_video_dimensions(valid_probe)
    assert (w, h) == (1920, 1080)

    # Verify _validate_mp4_streams rejects non-H.264
    bad_codec = {
        "streams": [
            {"codec_type": "video", "codec_name": "vp9", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "aac"},
        ],
    }
    with pytest.raises(VideoGenerationFailedError, match="H.264"):
        video_service._validate_mp4_streams(bad_codec)

    # Verify _validate_mp4_streams rejects non-AAC
    bad_audio = {
        "streams": [
            {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "mp3"},
        ],
    }
    with pytest.raises(VideoGenerationFailedError, match="AAC"):
        video_service._validate_mp4_streams(bad_audio)

    # Verify _validate_mp4_streams rejects multiple video streams
    double_video = {
        "streams": [
            {"codec_type": "video", "codec_name": "h264"},
            {"codec_type": "video", "codec_name": "h264"},
            {"codec_type": "audio", "codec_name": "aac"},
        ],
    }
    with pytest.raises(VideoGenerationFailedError, match="one video and one audio"):
        video_service._validate_mp4_streams(double_video)


def test_us003_pipeline_loops_wan_clip_to_audio_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify the pipeline loops the Wan clip to the audio duration before muxing."""
    _patch_trim_trailing_silence_to_copy(monkeypatch)
    _patch_wan_i2v_noop(monkeypatch)
    monkeypatch.setattr(video_service.audio_service, "generate_audio_for_request", lambda _body: WAV_HEADER)
    monkeypatch.setattr(video_service.image_service, "generate_image_png", lambda _body: PNG_HEADER)

    loop_calls: list[dict[str, object]] = []

    def fake_loop(video_path: Path, target_duration: float, output_path: Path) -> None:
        loop_calls.append({
            "video_name": video_path.name,
            "target_duration": target_duration,
            "output_name": output_path.name,
        })
        output_path.write_bytes(video_path.read_bytes())

    monkeypatch.setattr(video_service.media_repository, "loop_video_to_duration", fake_loop)
    monkeypatch.setattr(
        video_service.media_repository,
        "mux_video_and_audio_to_mp4",
        lambda _v, _a, output, **_kw: output.write_bytes(MP4_HEADER),
    )

    def fake_probe_media(path: Path) -> dict[str, object]:
        if path.name == "audio_trimmed.wav":
            return {"format": {"duration": "42.5"}}
        return {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1024, "height": 1024},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "42.5"},
        }

    monkeypatch.setattr(video_service.media_repository, "probe_media", fake_probe_media)

    video_service.generate_video_mp4_for_request(GenerateRequestBody())

    assert len(loop_calls) == 1
    assert loop_calls[0]["video_name"] == "wan_clip.mp4"
    assert loop_calls[0]["target_duration"] == 42.5
    assert loop_calls[0]["output_name"] == "looped_clip.mp4"
