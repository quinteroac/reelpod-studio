from __future__ import annotations

import io
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from models.constants import INVALID_PAYLOAD_ERROR
from models.errors import (
    AudioGenerationFailedError,
    AudioGenerationTimeoutError,
    AudioNotReadyError,
    ImageGenerationFailedError,
    QueueItemNotFoundError,
)
from models.schemas import GenerateImageRequestBody, GenerateRequestBody
from services import audio_service, image_service

router = APIRouter()


@router.post("/api/generate")
def generate_audio(body: GenerateRequestBody) -> StreamingResponse:
    try:
        wav_bytes = audio_service.generate_audio_for_request(body)
    except AudioGenerationTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except AudioGenerationFailedError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


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


async def handle_validation_error(_request: Any, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": INVALID_PAYLOAD_ERROR})


async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
