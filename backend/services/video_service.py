from __future__ import annotations

import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any, Callable, TypeVar

from models.constants import (
    IMAGE_SIZE,
    MP4_DURATION_TOLERANCE_SECONDS,
    VIDEO_GENERATION_TIMEOUT_SECONDS,
)
from models.errors import (
    AudioGenerationTimeoutError,
    ImageGenerationFailedError,
    VideoGenerationFailedError,
    VideoGenerationTimeoutError,
)
from models.schemas import GenerateImageRequestBody, GenerateRequestBody
from repositories import media_repository
from services import audio_service, image_service

T = TypeVar("T")


def build_image_prompt(body: GenerateRequestBody) -> str:
    if body.prompt is not None:
        return body.prompt
    return f"{body.mood} {body.style} lofi artwork"


def _run_with_timeout(func: Callable[[], T], timeout_seconds: float, timeout_message: str) -> T:
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(func)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        raise VideoGenerationTimeoutError(timeout_message) from exc
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _parse_duration_seconds(probe_data: dict[str, Any]) -> float:
    format_section = probe_data.get("format")
    if not isinstance(format_section, dict):
        raise VideoGenerationFailedError("Missing ffprobe format data")
    duration_value = format_section.get("duration")
    if not isinstance(duration_value, str):
        raise VideoGenerationFailedError("Missing duration in ffprobe data")
    try:
        return float(duration_value)
    except ValueError as exc:
        raise VideoGenerationFailedError("Invalid duration in ffprobe data") from exc


def _validate_mp4_streams(mp4_probe_data: dict[str, Any]) -> None:
    streams = mp4_probe_data.get("streams")
    if not isinstance(streams, list):
        raise VideoGenerationFailedError("Missing stream metadata")

    video_streams = [
        item
        for item in streams
        if isinstance(item, dict) and item.get("codec_type") == "video"
    ]
    audio_streams = [
        item
        for item in streams
        if isinstance(item, dict) and item.get("codec_type") == "audio"
    ]
    if len(video_streams) != 1 or len(audio_streams) != 1:
        raise VideoGenerationFailedError("Muxed MP4 must contain one video and one audio stream")

    if video_streams[0].get("codec_name") != "h264":
        raise VideoGenerationFailedError("Muxed MP4 video stream must use H.264")
    if audio_streams[0].get("codec_name") != "aac":
        raise VideoGenerationFailedError("Muxed MP4 audio stream must use AAC")


def generate_video_mp4_for_request(body: GenerateRequestBody) -> bytes:
    deadline = time.monotonic() + VIDEO_GENERATION_TIMEOUT_SECONDS
    temp_dir = Path(tempfile.mkdtemp(prefix="reelpod-video-"))
    temp_dir.mkdir(parents=True, exist_ok=True)
    audio_path = temp_dir.joinpath("audio.wav")
    image_path = temp_dir.joinpath("image.png")
    output_path = temp_dir.joinpath("output.mp4")

    def remaining_seconds() -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise VideoGenerationTimeoutError("Video generation timed out")
        return remaining

    try:
        audio_bytes = _run_with_timeout(
            lambda: audio_service.generate_audio_for_request(body),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while generating audio",
        )
        audio_path.write_bytes(audio_bytes)

        image_request = GenerateImageRequestBody(
            prompt=build_image_prompt(body),
            targetWidth=IMAGE_SIZE,
            targetHeight=IMAGE_SIZE,
        )
        image_bytes = _run_with_timeout(
            lambda: image_service.generate_image_png(image_request),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while generating image",
        )
        image_path.write_bytes(image_bytes)

        _run_with_timeout(
            lambda: media_repository.mux_image_and_audio_to_mp4(image_path, audio_path, output_path),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while muxing",
        )

        mp4_probe_data = media_repository.probe_media(output_path)
        _validate_mp4_streams(mp4_probe_data)

        source_audio_probe_data = media_repository.probe_media(audio_path)
        source_audio_duration = _parse_duration_seconds(source_audio_probe_data)
        mp4_duration = _parse_duration_seconds(mp4_probe_data)
        if abs(source_audio_duration - mp4_duration) > MP4_DURATION_TOLERANCE_SECONDS:
            raise VideoGenerationFailedError("Muxed MP4 duration does not match generated audio")

        return output_path.read_bytes()
    except (AudioGenerationTimeoutError, ImageGenerationFailedError, VideoGenerationTimeoutError):
        raise
    except Exception as exc:
        raise VideoGenerationFailedError(f"Video generation failed: {exc}") from exc
    finally:
        for file_path in (audio_path, image_path, output_path):
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                pass
        shutil.rmtree(temp_dir, ignore_errors=True)
