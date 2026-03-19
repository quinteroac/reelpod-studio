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
from models.schemas import (
    AddPlaylistTrackResponse,
    CreatePlaylistRequestBody,
    GenerateImageRequestBody,
    GenerateRequestBody,
    PlaylistItem,
    PlaylistTrackItem,
    PlaylistsListResponse,
    PlaylistTracksListResponse,
    UpdatePlaylistRequestBody,
)
from services import audio_service, image_service, playlist_service
from services import video_service
from repositories import media_repository

router = APIRouter()

_MULTIPART_BOUNDARY = "reelpod"


@router.get("/api/playlists", response_model=PlaylistsListResponse)
def list_playlists() -> PlaylistsListResponse:
    rows = playlist_service.get_playlists()
    return PlaylistsListResponse(playlists=[PlaylistItem(**row) for row in rows])


@router.post("/api/playlists", response_model=PlaylistItem)
def create_playlist(body: CreatePlaylistRequestBody = CreatePlaylistRequestBody()) -> PlaylistItem:
    row = playlist_service.create_playlist(body.name)
    return PlaylistItem(**row)


@router.patch("/api/playlists/{playlist_id}", response_model=PlaylistItem)
def update_playlist(playlist_id: str, body: UpdatePlaylistRequestBody) -> PlaylistItem:
    try:
        row = playlist_service.update_playlist_name(playlist_id, body.name)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PlaylistItem(**row)


@router.get("/api/playlists/{playlist_id}/tracks", response_model=PlaylistTracksListResponse)
def list_playlist_tracks(playlist_id: str) -> PlaylistTracksListResponse:
    try:
        rows = playlist_service.get_playlist_tracks(playlist_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PlaylistTracksListResponse(tracks=[PlaylistTrackItem(**row) for row in rows])


@router.post("/api/playlists/{playlist_id}/tracks", response_model=AddPlaylistTrackResponse)
async def add_playlist_track(playlist_id: str, file: UploadFile = File(...)) -> AddPlaylistTrackResponse:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty upload")
    try:
        row = playlist_service.add_track(playlist_id, contents, file.filename)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AddPlaylistTrackResponse(track=PlaylistTrackItem(**row))


@router.get("/api/playlists/{playlist_id}/tracks/{track_id}/file")
def get_playlist_track_file(playlist_id: str, track_id: str) -> FileResponse:
    try:
        path, filename = playlist_service.get_track_mp4_path(playlist_id, track_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except playlist_service.TrackNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Track file not found on disk")
    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        filename=filename,
    )


@router.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def delete_playlist_track(playlist_id: str, track_id: str) -> Response:
    try:
        playlist_service.delete_track(playlist_id, track_id)
    except playlist_service.PlaylistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except playlist_service.TrackNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


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
