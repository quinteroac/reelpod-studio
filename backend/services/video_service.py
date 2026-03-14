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
from repositories import media_repository, video_repository
from services import audio_service, image_service, orchestration_service

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

wan_pipeline: Any | None = None
wan_pipeline_load_error: str | None = None


def startup() -> None:
    global wan_pipeline, wan_pipeline_load_error
    try:
        wan_pipeline = video_repository.load_video_pipeline()
        wan_pipeline_load_error = None
        logger.info("Video generation model loading completed")
    except Exception as exc:  # pragma: no cover - startup fallback safety
        wan_pipeline = None
        wan_pipeline_load_error = str(exc)
        logger.error("Wan video pipeline failed to load: %s", exc)


def build_image_prompt(body: GenerateRequestBody) -> str:
    if body.prompt is not None:
        return body.prompt
    return f"{body.mood} {body.style} lofi artwork"


def _resolve_pipeline_prompts(
    body: GenerateRequestBody,
) -> tuple[GenerateRequestBody, str, str]:
    image_prompt = build_image_prompt(body)
    video_prompt = image_prompt
    audio_request_body = body

    if body.mode == "llm":
        orchestration = orchestration_service.orchestrate(body.prompt or "")
        audio_request_body = body.model_copy(
            update={
                "mode": "text",
                "prompt": orchestration.audio_prompt,
            }
        )
        image_prompt = orchestration.image_prompt
        video_prompt = orchestration.video_prompt

    return audio_request_body, image_prompt, video_prompt


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
    wan_clip_path = temp_dir.joinpath("wan_clip.mp4")
    looped_clip_path = temp_dir.joinpath("looped_clip.mp4")
    output_path = temp_dir.joinpath("output.mp4")

    def remaining_seconds() -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise VideoGenerationTimeoutError("Video generation timed out")
        return remaining

    try:
        audio_request_body, image_prompt, video_prompt = _resolve_pipeline_prompts(body)
        logger.info(
            "Video pipeline: starting audio generation (mode=%s, mood=%s, tempo=%s, duration=%s, style=%s)",
            audio_request_body.mode,
            audio_request_body.mood,
            audio_request_body.tempo,
            audio_request_body.duration,
            audio_request_body.style,
        )
        audio_bytes = _run_with_timeout(
            lambda: audio_service.generate_audio_for_request(audio_request_body),
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
            prompt=image_prompt,
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

        logger.info("Video pipeline: generating Wan I2V animated clip")
        if wan_pipeline is None:
            reason = wan_pipeline_load_error or "model unavailable"
            raise VideoGenerationFailedError(f"Video generation failed: {reason}")

        from PIL import Image as _PILImage

        _pil_image = _PILImage.open(image_path)
        _video_prompt = video_prompt
        _wan_pipeline = wan_pipeline
        wan_clip_path = _run_with_timeout(
            lambda: video_repository.run_video_inference(
                _wan_pipeline,
                input_image=_pil_image,
                prompt=_video_prompt,
                target_width=body.image_target_width,
                target_height=body.image_target_height,
                temp_dir=temp_dir,
            ),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while generating Wan I2V clip",
        )
        logger.info(
            "Video pipeline: Wan I2V clip saved to %s (%d bytes)",
            wan_clip_path,
            wan_clip_path.stat().st_size,
        )

        logger.info("Video pipeline: probing trimmed audio for duration")
        source_audio_probe_data = media_repository.probe_media(audio_path)
        source_audio_duration = _parse_duration_seconds(source_audio_probe_data)
        logger.info("Video pipeline: audio duration = %.3fs", source_audio_duration)

        logger.info(
            "Video pipeline: looping Wan clip to %.3fs",
            source_audio_duration,
        )
        _run_with_timeout(
            lambda: media_repository.loop_video_to_duration(
                wan_clip_path,
                target_duration=source_audio_duration,
                output_path=looped_clip_path,
            ),
            timeout_seconds=remaining_seconds(),
            timeout_message="Video generation timed out while looping clip",
        )
        logger.info(
            "Video pipeline: looped clip saved to %s (%d bytes)",
            looped_clip_path,
            looped_clip_path.stat().st_size,
        )

        logger.info(
            "Video pipeline: muxing looped clip %s and audio %s into MP4 at %s (no scaling, native Wan resolution)",
            looped_clip_path,
            audio_path,
            output_path,
        )
        _run_with_timeout(
            lambda: media_repository.mux_video_and_audio_to_mp4(
                looped_clip_path,
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
        if actual_width != body.image_target_width or actual_height != body.image_target_height:
            raise VideoGenerationFailedError(
                "Muxed MP4 frame dimensions do not match target"
            )

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
        for file_path in (audio_path, trimmed_audio_path, image_path, wan_clip_path, looped_clip_path, output_path):
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                pass
        shutil.rmtree(temp_dir, ignore_errors=True)
