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

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


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


def submit_task(prompt: str) -> str:
    payload = {
        "prompt": prompt,
        "lyrics": "",
        "audio_duration": 30,
        "inference_steps": 20,
        "audio_format": "wav",
    }
    response = post_json(make_absolute_url(RELEASE_TASK_PATH), payload)
    task_id = response.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError("Missing task_id in response")
    return task_id


def poll_until_complete(task_id: str) -> dict[str, Any]:
    for _ in range(MAX_POLL_ATTEMPTS):
        response = post_json(make_absolute_url(QUERY_RESULT_PATH), {"task_id": task_id})
        status = response.get("status")
        if status == 1:
            return response
        if status == 2:
            raise RuntimeError("ACE-Step task failed")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("ACE-Step task polling timed out")


def extract_file_path(response: dict[str, Any]) -> str:
    result_json = response.get("result")
    if not isinstance(result_json, str):
        raise RuntimeError("Missing result JSON")
    parsed_result = json.loads(result_json)
    if not isinstance(parsed_result, dict):
        raise RuntimeError("Invalid result JSON")
    file_path = parsed_result.get("file")
    if not isinstance(file_path, str) or not file_path:
        raise RuntimeError("Missing file path")
    return file_path


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


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
