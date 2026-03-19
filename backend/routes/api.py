from __future__ import annotations

import io
import json as json_lib
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pathlib import Path
import uuid

from models.constants import INVALID_PAYLOAD_ERROR
from models.errors import (
    AudioGenerationFailedError,
    AudioGenerationTimeoutError,
    AudioNotReadyError,
    ImageGenerationFailedError,
    QueueItemNotFoundError,
    VideoGenerationFailedError,
    VideoGenerationTimeoutError,
)
from models.schemas import GenerateImageRequestBody, GenerateRequestBody
from services import audio_service, image_service
from services import video_service
from repositories import media_repository

router = APIRouter()

_MULTIPART_BOUNDARY = "reelpod"


def _build_multipart_response(mp4_bytes: bytes, metadata: dict[str, str]) -> Response:
    meta_json = json_lib.dumps(metadata).encode()
    sep = f"--{_MULTIPART_BOUNDARY}\r\n".encode()
    body = (
        sep
        + b"Content-Type: application/json\r\n\r\n"
        + meta_json
        + b"\r\n"
        + sep
        + b"Content-Type: video/mp4\r\n\r\n"
        + mp4_bytes
        + b"\r\n"
        + f"--{_MULTIPART_BOUNDARY}--\r\n".encode()
    )
    return Response(
        content=body,
        media_type=f"multipart/mixed; boundary={_MULTIPART_BOUNDARY}",
    )


@router.post("/api/generate")
def generate_video(body: GenerateRequestBody) -> Response:
    try:
        mp4_bytes, song_title, youtube_title, youtube_description = video_service.generate_video_mp4_for_request(body)
    except (AudioGenerationTimeoutError, VideoGenerationTimeoutError) as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (AudioGenerationFailedError, ImageGenerationFailedError, VideoGenerationFailedError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    metadata: dict[str, str] = {}
    if song_title:
        metadata["song_title"] = song_title
    if youtube_title:
        metadata["youtube_title"] = youtube_title
    if youtube_description:
        metadata["youtube_description"] = youtube_description
    return _build_multipart_response(mp4_bytes, metadata)


@router.post("/api/generate-requests")
def create_generation_request(body: GenerateRequestBody) -> dict[str, str]:
    return audio_service.create_generation_request(body)


@router.get("/api/generate-requests/{item_id}")
def get_generation_request(item_id: str) -> dict[str, str | None]:
    try:
        return audio_service.get_generation_request_status(item_id)
    except QueueItemNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/generate-requests/{item_id}/audio")
def get_generation_request_audio(item_id: str) -> StreamingResponse:
    try:
        wav_bytes = audio_service.get_generation_request_audio(item_id)
    except QueueItemNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AudioGenerationFailedError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except AudioNotReadyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


@router.post("/api/generate-image")
def generate_image(body: GenerateImageRequestBody) -> StreamingResponse:
    try:
        image_bytes = image_service.generate_image_png(body)
    except ImageGenerationFailedError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return StreamingResponse(io.BytesIO(image_bytes), media_type="image/png")


@router.post("/api/recordings/convert-mp4")
async def convert_recording_to_mp4(file: UploadFile = File(...)) -> FileResponse:
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video")

    tmp_dir = Path("media/tmp_recordings")
    tmp_dir.mkdir(parents=True, exist_ok=True)

    input_id = uuid.uuid4().hex
    input_path = tmp_dir / f"{input_id}.webm"
    contents = await file.read()
    input_path.write_bytes(contents)

    try:
        output_path = media_repository.transcode_to_mp4(input_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename="recording.mp4",
    )


async def handle_validation_error(_request: Any, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": INVALID_PAYLOAD_ERROR})


async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
