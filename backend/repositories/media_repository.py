from __future__ import annotations

from pathlib import Path
from typing import Any


def trim_trailing_silence(audio_path: Path, output_path: Path, silence_threshold: str = "-50dB", min_silence_duration: float = 0.5) -> None:
    ffmpeg_module = _load_ffmpeg_module()
    try:
        (
            ffmpeg_module.input(str(audio_path))
            .filter(
                "silenceremove",
                stop_periods=-1,
                stop_duration=min_silence_duration,
                stop_threshold=silence_threshold,
            )
            .output(str(output_path))
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg silence trim failed") from exc


def _build_letterbox_filter(target_width: int, target_height: int) -> str:
    return (
        f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black"
    )


def mux_image_and_audio_to_mp4(
    image_path: Path,
    audio_path: Path,
    output_path: Path,
    *,
    target_width: int,
    target_height: int,
) -> None:
    ffmpeg_module = _load_ffmpeg_module()
    video_input = ffmpeg_module.input(str(image_path), loop=1, framerate=30)
    audio_input = ffmpeg_module.input(str(audio_path))
    try:
        (
            ffmpeg_module.output(
                video_input,
                audio_input,
                str(output_path),
                vcodec="libx264",
                acodec="aac",
                pix_fmt="yuv420p",
                vf=_build_letterbox_filter(target_width, target_height),
                shortest=None,
                movflags="+faststart",
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg mux failed") from exc


def probe_media(path: Path) -> dict[str, Any]:
    ffmpeg_module = _load_ffmpeg_module()
    try:
        result = ffmpeg_module.probe(str(path))
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffprobe failed") from exc
    if not isinstance(result, dict):
        raise RuntimeError("ffprobe returned invalid metadata")
    return result


def loop_video_to_duration(
    video_path: Path,
    target_duration: float,
    output_path: Path,
) -> None:
    ffmpeg_module = _load_ffmpeg_module()
    try:
        (
            ffmpeg_module.input(str(video_path), stream_loop=-1)
            .output(str(output_path), t=target_duration, codec="copy")
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg loop failed") from exc


def mux_video_and_audio_to_mp4(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    *,
    target_width: int | None = None,
    target_height: int | None = None,
) -> None:
    ffmpeg_module = _load_ffmpeg_module()
    video_input = ffmpeg_module.input(str(video_path))
    audio_input = ffmpeg_module.input(str(audio_path))
    output_kwargs: dict[str, Any] = {
        "vcodec": "libx264",
        "acodec": "aac",
        "pix_fmt": "yuv420p",
        "shortest": None,
        "movflags": "+faststart",
    }
    if target_width is not None and target_height is not None:
        output_kwargs["vf"] = _build_letterbox_filter(target_width, target_height)
    try:
        (
            ffmpeg_module.output(
                video_input,
                audio_input,
                str(output_path),
                **output_kwargs,
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg video mux failed") from exc


def concatenate_videos(input_paths: list[Path], output_path: Path) -> None:
    ffmpeg_module = _load_ffmpeg_module()
    inputs = [ffmpeg_module.input(str(p)) for p in input_paths]
    try:
        (
            ffmpeg_module.concat(*inputs, v=1, a=0)
            .output(str(output_path))
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg concat failed") from exc


def transcode_to_mp4(
    input_path: Path,
    output_path: Path | None = None,
) -> Path:
    """
    Transcode an arbitrary video file (e.g. WebM from the frontend) to a
    streaming-friendly MP4 (H.264 + AAC).
    """
    ffmpeg_module = _load_ffmpeg_module()
    if output_path is None:
        output_path = input_path.with_suffix(".mp4")

    try:
        (
            ffmpeg_module.input(str(input_path))
            .output(
                str(output_path),
                vcodec="libx264",
                acodec="aac",
                pix_fmt="yuv420p",
                vf="scale=trunc(iw/2)*2:trunc(ih/2)*2",
                audio_bitrate="192k",
                ac=2,
                movflags="+faststart",
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg_module.Error as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(detail or "ffmpeg transcode failed") from exc

    return output_path


def _load_ffmpeg_module() -> Any:
    try:
        import ffmpeg as ffmpeg_module
    except ImportError as exc:
        raise RuntimeError("ffmpeg-python is required. Install backend dependencies first.") from exc
    return ffmpeg_module
