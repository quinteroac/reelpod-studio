from __future__ import annotations

from pathlib import Path
from typing import Any


def mux_image_and_audio_to_mp4(image_path: Path, audio_path: Path, output_path: Path) -> None:
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


def _load_ffmpeg_module() -> Any:
    try:
        import ffmpeg as ffmpeg_module
    except ImportError as exc:
        raise RuntimeError("ffmpeg-python is required. Install backend dependencies first.") from exc
    return ffmpeg_module
