from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    )
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)


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


def _parse_video_dimensions(mp4_probe_data: dict[str, Any]) -> tuple[int, int]:
    streams = mp4_probe_data.get("streams")
    if not isinstance(streams, list):
        raise VideoGenerationFailedError("Missing stream metadata")
    video_stream = next(
        (item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"),
        None,
    )
    if not isinstance(video_stream, dict):
        raise VideoGenerationFailedError("Missing video stream metadata")
    width = video_stream.get("width")
    height = video_stream.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        raise VideoGenerationFailedError("Missing MP4 frame dimensions")
    return width, height


def generate_video_mp4_for_request(body: GenerateRequestBody) -> bytes:
    deadline = time.monotonic() + VIDEO_GENERATION_TIMEOUT_SECONDS
    temp_dir = Path(tempfile.mkdtemp(prefix="reelpod-video-"))
    temp_dir.mkdir(parents=True, exist_ok=True)
    audio_path = temp_dir.joinpath("audio.wav")
    trimmed_audio_path = temp_dir.joinpath("audio_trimmed.wav")
    image_path = temp_dir.joinpath("image.png")
    output_path = temp_dir.joinpath("output.mp4")

    def remaining_seconds() -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise VideoGenerationTimeoutError("Video generation timed out")
        return remaining

    try:
        logger.info(
            "Video pipeline: starting audio generation (mode=%s, mood=%s, tempo=%s, duration=%s, style=%s)",
            body.mode,
            body.mood,
            body.tempo,
            body.duration,
            body.style,
        )
        audio_bytes = _run_with_timeout(
            lambda: audio_service.generate_audio_for_request(body),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while generating audio",
        )
        audio_path.write_bytes(audio_bytes)
        logger.info(
            "Video pipeline: wrote audio to %s (%d bytes)",
            audio_path,
            audio_path.stat().st_size,
        )

        logger.info("Video pipeline: trimming trailing silence from audio")
        media_repository.trim_trailing_silence(audio_path, trimmed_audio_path)
        audio_path = trimmed_audio_path
        logger.info(
            "Video pipeline: trimmed audio at %s (%d bytes)",
            audio_path,
            audio_path.stat().st_size,
        )

        image_request = GenerateImageRequestBody(
            prompt=build_image_prompt(body),
            targetWidth=body.image_target_width,
            targetHeight=body.image_target_height,
        )
        image_bytes = _run_with_timeout(
            lambda: image_service.generate_image_png(image_request),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while generating image",
        )
        image_path.write_bytes(image_bytes)
        logger.info(
            "Video pipeline: wrote image to %s (%d bytes)",
            image_path,
            image_path.stat().st_size,
        )

        logger.info(
            "Video pipeline: muxing image %s and audio %s into MP4 at %s",
            image_path,
            audio_path,
            output_path,
        )
        _run_with_timeout(
            lambda: media_repository.mux_image_and_audio_to_mp4(
                image_path,
                audio_path,
                output_path,
                target_width=body.image_target_width,
                target_height=body.image_target_height,
            ),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while muxing",
        )

        mp4_probe_data = media_repository.probe_media(output_path)
        _validate_mp4_streams(mp4_probe_data)
        actual_width, actual_height = _parse_video_dimensions(mp4_probe_data)
        if (actual_width, actual_height) != (body.image_target_width, body.image_target_height):
            raise VideoGenerationFailedError(
                "Muxed MP4 frame dimensions do not match requested target resolution"
            )

        source_audio_probe_data = media_repository.probe_media(audio_path)
        source_audio_duration = _parse_duration_seconds(source_audio_probe_data)
        mp4_duration = _parse_duration_seconds(mp4_probe_data)
        if abs(source_audio_duration - mp4_duration) > MP4_DURATION_TOLERANCE_SECONDS:
            raise VideoGenerationFailedError("Muxed MP4 duration does not match generated audio")
        logger.info(
            "Video pipeline: completed MP4 mux (audio_duration=%.3fs, video_duration=%.3fs, diff=%.3fs, frame_dimensions=%s, path=%s, size_bytes=%d)",
            source_audio_duration,
            mp4_duration,
            abs(source_audio_duration - mp4_duration),
            f"{actual_width}x{actual_height}",
            output_path,
            output_path.stat().st_size,
        )

        return output_path.read_bytes()
    except (AudioGenerationTimeoutError, ImageGenerationFailedError, VideoGenerationTimeoutError):
        raise
    except Exception as exc:
        raise VideoGenerationFailedError(f"Video generation failed: {exc}") from exc
    finally:
        for file_path in (audio_path, trimmed_audio_path, image_path, output_path):
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                pass
        shutil.rmtree(temp_dir, ignore_errors=True)
