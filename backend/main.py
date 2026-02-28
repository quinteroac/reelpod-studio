from __future__ import annotations

import io
import json
import logging
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StrictInt, StrictStr, field_validator

MIN_TEMPO = 60
MAX_TEMPO = 120

INVALID_PAYLOAD_ERROR = (
    f"Invalid payload. Expected {{ mood: string, tempo: number ({MIN_TEMPO}-{MAX_TEMPO}), style: string }}"
)

DEFAULT_ACESTEP_API_URL = "http://localhost:8001"
RELEASE_TASK_PATH = "/release_task"
QUERY_RESULT_PATH = "/query_result"
POLL_INTERVAL_SECONDS = 0.25
MAX_POLL_ATTEMPTS = 120
IMAGE_MODEL_ID = "circlestone-labs/Anima"
IMAGE_SIZE = 1024

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
image_pipeline: Any | None = None
image_model_load_error: str | None = None


class GenerateRequestBody(BaseModel):
    mood: StrictStr
    tempo: StrictInt = Field(ge=MIN_TEMPO, le=MAX_TEMPO)
    style: StrictStr

    @field_validator("mood", "style")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed


class GenerateImageRequestBody(BaseModel):
    prompt: StrictStr

    @field_validator("prompt")
    @classmethod
    def validate_non_empty_prompt(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Any, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": INVALID_PAYLOAD_ERROR})


def build_prompt(body: GenerateRequestBody) -> str:
    # Prompt template: "{mood} lofi {style}, {tempo} BPM"
    return f"{body.mood} lofi {body.style}, {body.tempo} BPM"


def get_acestep_api_url() -> str:
    return os.getenv("ACESTEP_API_URL", DEFAULT_ACESTEP_API_URL).rstrip("/")


def make_absolute_url(path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return urljoin(f"{get_acestep_api_url()}/", path.lstrip("/"))


def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        url=url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise RuntimeError("Unexpected JSON response")
    return parsed


def get_bytes(url: str) -> bytes:
    request = Request(url=url, method="GET")
    with urlopen(request, timeout=30) as response:
        return response.read()


def load_image_pipeline() -> Any:
    from diffusers import DiffusionPipeline

    return DiffusionPipeline.from_pretrained(IMAGE_MODEL_ID)


def submit_task(prompt: str) -> str:
    payload = {
        "prompt": prompt,
        "lyrics": "",
        "audio_duration": 30,
        "inference_steps": 20,
        "audio_format": "wav",
    }
    response = post_json(make_absolute_url(RELEASE_TASK_PATH), payload)
    # API wraps response: { "code": 200, "data": { "task_id": "..." } }
    data = response.get("data") or response
    task_id = data.get("task_id") if isinstance(data, dict) else None
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError(f"Missing task_id in response: {response}")
    return task_id


def poll_until_complete(task_id: str) -> dict[str, Any]:
    for _ in range(MAX_POLL_ATTEMPTS):
        # API expects task_id_list and wraps response in { "code": 200, "data": [...] }
        response = post_json(make_absolute_url(QUERY_RESULT_PATH), {"task_id_list": [task_id]})
        data = response.get("data") or []
        item = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else {}
        status = item.get("status")
        if status == 1:
            return item
        if status == 2:
            raise RuntimeError("ACE-Step task failed")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("ACE-Step task polling timed out")


def extract_file_path(response: dict[str, Any]) -> str:
    result_json = response.get("result")
    if not isinstance(result_json, str):
        raise RuntimeError("Missing result JSON")
    parsed_result = json.loads(result_json)
    # API returns a list of {file, wave, status} dicts — take the first with a valid path
    if isinstance(parsed_result, list):
        for item in parsed_result:
            file_path = item.get("file") if isinstance(item, dict) else None
            if isinstance(file_path, str) and file_path:
                return file_path
        raise RuntimeError("No valid file path in result list")
    if isinstance(parsed_result, dict):
        file_path = parsed_result.get("file")
        if isinstance(file_path, str) and file_path:
            return file_path
    raise RuntimeError(f"Missing file path in result: {parsed_result}")


@app.on_event("startup")
def startup_load_image_model() -> None:
    global image_pipeline, image_model_load_error
    try:
        image_pipeline = load_image_pipeline()
        image_model_load_error = None
    except Exception as exc:  # pragma: no cover - startup fallback safety
        image_pipeline = None
        image_model_load_error = str(exc)
        logger.error("Image model load failed: %s: %s", type(exc).__name__, exc)


@app.post("/api/generate")
def generate_audio(body: GenerateRequestBody) -> StreamingResponse:
    prompt = build_prompt(body)
    logger.debug("ACE-Step prompt: %s", prompt)

    try:
        task_id = submit_task(prompt)
        completed_task = poll_until_complete(task_id)
        file_path = extract_file_path(completed_task)
        wav_bytes = get_bytes(make_absolute_url(file_path))
    except HTTPException:
        raise
    except (RuntimeError, URLError, HTTPError, json.JSONDecodeError, TimeoutError) as exc:
        logger.error("ACE-Step API error: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail="Audio generation failed") from exc
    except Exception as exc:  # pragma: no cover - final safety net
        logger.error("Unexpected audio generation error: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail="Audio generation failed") from exc

    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


@app.post("/api/generate-image")
def generate_image(body: GenerateImageRequestBody) -> StreamingResponse:
    if image_pipeline is None:
        reason = image_model_load_error or "model unavailable"
        raise HTTPException(status_code=500, detail=f"Image generation failed: {reason}")

    try:
        result = image_pipeline(prompt=body.prompt, width=IMAGE_SIZE, height=IMAGE_SIZE)
        images = getattr(result, "images", None)
        if not isinstance(images, list) or not images:
            raise RuntimeError("No generated image returned by model")

        output = io.BytesIO()
        images[0].save(output, format="PNG")
        output.seek(0)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Image inference error: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc

    return StreamingResponse(output, media_type="image/png")


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
