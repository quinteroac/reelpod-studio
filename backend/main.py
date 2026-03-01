from __future__ import annotations

import io
import json
import logging
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Literal
from typing import Any
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from uuid import uuid4

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StrictInt, StrictStr, field_validator, model_validator

MIN_TEMPO = 60
MAX_TEMPO = 120

INVALID_PAYLOAD_ERROR = (
    "Invalid payload. Expected { mode?: 'text'|'text+params'|'text-and-parameters'|'params'|'parameters', "
    f"prompt?: string, mood?: string, tempo?: number ({MIN_TEMPO}-{MAX_TEMPO}), style?: string }}"
)

DEFAULT_ACESTEP_API_URL = "http://localhost:8001"
RELEASE_TASK_PATH = "/release_task"
QUERY_RESULT_PATH = "/query_result"
POLL_INTERVAL_SECONDS = 0.25
MAX_POLL_ATTEMPTS = 120
IMAGE_MODEL_ID = "Ine007/waiIllustriousSDXL_v160"
IMAGE_SIZE = 1024
IMAGE_NUM_INFERENCE_STEPS = 25  # 25 vs default 50 — faster, acceptable quality
QUEUE_WAIT_TIMEOUT_SECONDS = 300.0

QueueItemStatus = Literal["queued", "generating", "completed", "failed"]

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
image_pipeline: Any | None = None
image_model_load_error: str | None = None


@dataclass
class GenerationQueueItem:
    id: str
    prompt: str
    status: QueueItemStatus
    tempo: int = 80
    wav_bytes: bytes | None = None
    error_message: str | None = None


queue_items: dict[str, GenerationQueueItem] = {}
queue_order: deque[str] = deque()
queue_condition = threading.Condition()
queue_worker_thread: threading.Thread | None = None
queue_stop_event = threading.Event()


class GenerateRequestBody(BaseModel):
    mode: Literal["text", "text+params", "text-and-parameters", "params", "parameters"] = "params"
    prompt: Optional[StrictStr] = None
    mood: StrictStr = "chill"
    tempo: StrictInt = Field(default=80, ge=MIN_TEMPO, le=MAX_TEMPO)
    style: StrictStr = "jazz"

    @field_validator("prompt")
    @classmethod
    def validate_prompt_if_provided(cls, value: str | None) -> str | None:
        if value is None:
            return None

        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed

    @field_validator("mood", "style")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed

    @model_validator(mode="after")
    def validate_prompt_for_mode(self) -> "GenerateRequestBody":
        if self.mode in ("text", "text+params", "text-and-parameters") and self.prompt is None:
            raise ValueError("prompt is required in text modes.")
        return self


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
    if body.mode == "text":
        return body.prompt or ""
    if body.mode in ("text+params", "text-and-parameters"):
        return f"{body.prompt or ''}, {body.mood}, {body.style}, {body.tempo} BPM"

    # Prompt template for params mode: "{mood} lofi {style}, {tempo} BPM"
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
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "PyTorch is required for image generation. "
            "Install it with: uv add torch torchvision"
        ) from exc

    from diffusers import DiffusionPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    pipeline = DiffusionPipeline.from_pretrained(IMAGE_MODEL_ID, torch_dtype=dtype)
    
    if device == "cuda":
        # Sequential offload uses minimal GPU at a time (one submodel at a time), allowing
        # image generation to run when ACE-Step holds GPU memory. Slower than model_cpu_offload
        # but necessary for shared GPU with ACE-Step.
        pipeline.enable_sequential_cpu_offload()
        if hasattr(pipeline, "enable_vae_slicing"):
            pipeline.enable_vae_slicing()
        if hasattr(pipeline, "enable_vae_tiling"):
            pipeline.enable_vae_tiling()

        return pipeline
        
    return pipeline.to(device)


def submit_task(prompt: str, tempo: int = 80) -> str:
    payload = {
        "prompt": prompt,
        "lyrics": "",
        "bpm": tempo,
        "audio_duration": 30,
        "inference_steps": 20,
        "audio_format": "wav",
        "thinking": True,
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


def generate_audio_bytes_for_prompt(prompt: str, tempo: int = 80) -> bytes:
    task_id = submit_task(prompt, tempo=tempo)
    completed_task = poll_until_complete(task_id)
    file_path = extract_file_path(completed_task)
    return get_bytes(make_absolute_url(file_path))


def get_queue_item_snapshot(item_id: str) -> GenerationQueueItem | None:
    with queue_condition:
        item = queue_items.get(item_id)
        if item is None:
            return None
        return GenerationQueueItem(
            id=item.id,
            prompt=item.prompt,
            status=item.status,
            tempo=item.tempo,
            wav_bytes=item.wav_bytes,
            error_message=item.error_message,
        )


def enqueue_generation_request(body: GenerateRequestBody) -> GenerationQueueItem:
    tempo = 80 if body.mode == "text" else body.tempo
    item = GenerationQueueItem(
        id=str(uuid4()),
        prompt=build_prompt(body),
        status="queued",
        tempo=tempo,
    )
    with queue_condition:
        queue_items[item.id] = item
        queue_order.append(item.id)
        queue_condition.notify_all()
    return item


def wait_for_terminal_status(
    item_id: str, timeout_seconds: float | None = None
) -> GenerationQueueItem | None:
    deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds

    with queue_condition:
        while True:
            item = queue_items.get(item_id)
            if item is None:
                return None
            if item.status in ("completed", "failed"):
                return GenerationQueueItem(
                    id=item.id,
                    prompt=item.prompt,
                    status=item.status,
                    tempo=item.tempo,
                    wav_bytes=item.wav_bytes,
                    error_message=item.error_message,
                )

            if deadline is None:
                queue_condition.wait()
                continue

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            queue_condition.wait(timeout=remaining)


def queue_worker() -> None:
    while not queue_stop_event.is_set():
        next_item_id: str | None = None
        with queue_condition:
            while not queue_stop_event.is_set() and not queue_order:
                queue_condition.wait(timeout=0.1)

            if queue_stop_event.is_set():
                return

            next_item_id = queue_order.popleft()
            item = queue_items.get(next_item_id)
            if item is None:
                continue
            item.status = "generating"
            item.error_message = None
            queue_condition.notify_all()

        try:
            wav_bytes = generate_audio_bytes_for_prompt(item.prompt, tempo=item.tempo)
        except (RuntimeError, URLError, HTTPError, json.JSONDecodeError, TimeoutError) as exc:
            logger.error("ACE-Step API error: %s: %s", type(exc).__name__, exc)
            with queue_condition:
                failed_item = queue_items.get(next_item_id)
                if failed_item is not None:
                    failed_item.status = "failed"
                    failed_item.error_message = "Audio generation failed"
                    failed_item.wav_bytes = None
                queue_condition.notify_all()
        except Exception as exc:  # pragma: no cover - final safety net
            logger.error("Unexpected audio generation error: %s: %s", type(exc).__name__, exc)
            with queue_condition:
                failed_item = queue_items.get(next_item_id)
                if failed_item is not None:
                    failed_item.status = "failed"
                    failed_item.error_message = "Audio generation failed"
                    failed_item.wav_bytes = None
                queue_condition.notify_all()
        else:
            with queue_condition:
                completed_item = queue_items.get(next_item_id)
                if completed_item is not None:
                    completed_item.status = "completed"
                    completed_item.error_message = None
                    completed_item.wav_bytes = wav_bytes
                queue_condition.notify_all()


def ensure_queue_worker_running() -> None:
    global queue_worker_thread

    with queue_condition:
        if queue_worker_thread is not None and queue_worker_thread.is_alive():
            return
        queue_stop_event.clear()
        queue_worker_thread = threading.Thread(target=queue_worker, daemon=True)
        queue_worker_thread.start()


def stop_queue_worker() -> None:
    global queue_worker_thread
    queue_stop_event.set()
    with queue_condition:
        queue_condition.notify_all()
    if queue_worker_thread is not None:
        queue_worker_thread.join(timeout=1.0)
    queue_worker_thread = None


def reset_generation_queue_for_tests() -> None:
    with queue_condition:
        queue_items.clear()
        queue_order.clear()
        queue_condition.notify_all()


@app.on_event("startup")
def startup_load_image_model() -> None:
    ensure_queue_worker_running()

    global image_pipeline, image_model_load_error
    try:
        image_pipeline = load_image_pipeline()
        image_model_load_error = None
    except Exception as exc:  # pragma: no cover - startup fallback safety
        image_pipeline = None
        image_model_load_error = str(exc)
        logger.error("Image model load failed: %s: %s", type(exc).__name__, exc)


@app.on_event("shutdown")
def shutdown_stop_queue_worker() -> None:
    stop_queue_worker()


@app.post("/api/generate")
def generate_audio(body: GenerateRequestBody) -> StreamingResponse:
    ensure_queue_worker_running()
    item = enqueue_generation_request(body)
    logger.debug("Queued ACE-Step request: %s", item.id)
    completed_item = wait_for_terminal_status(item.id, timeout_seconds=QUEUE_WAIT_TIMEOUT_SECONDS)

    if completed_item is None:
        raise HTTPException(status_code=504, detail="Audio generation timed out")
    if completed_item.status == "failed" or completed_item.wav_bytes is None:
        raise HTTPException(status_code=500, detail="Audio generation failed")

    return StreamingResponse(io.BytesIO(completed_item.wav_bytes), media_type="audio/wav")


@app.post("/api/generate-requests")
def create_generation_request(body: GenerateRequestBody) -> dict[str, str]:
    ensure_queue_worker_running()
    item = enqueue_generation_request(body)
    return {"id": item.id, "status": item.status}


@app.get("/api/generate-requests/{item_id}")
def get_generation_request(item_id: str) -> dict[str, str | None]:
    item = get_queue_item_snapshot(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Queue item not found")
    return {"id": item.id, "status": item.status, "error": item.error_message}


@app.get("/api/generate-requests/{item_id}/audio")
def get_generation_request_audio(item_id: str) -> StreamingResponse:
    item = get_queue_item_snapshot(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if item.status == "failed":
        raise HTTPException(status_code=500, detail="Audio generation failed")
    if item.status != "completed" or item.wav_bytes is None:
        raise HTTPException(status_code=409, detail="Audio not ready")

    return StreamingResponse(io.BytesIO(item.wav_bytes), media_type="audio/wav")


@app.post("/api/generate-image")
def generate_image(body: GenerateImageRequestBody) -> StreamingResponse:
    if image_pipeline is None:
        reason = image_model_load_error or "model unavailable"
        raise HTTPException(status_code=500, detail=f"Image generation failed: {reason}")

    try:
        result = image_pipeline(
            prompt=body.prompt,
            width=IMAGE_SIZE,
            height=IMAGE_SIZE,
            num_inference_steps=IMAGE_NUM_INFERENCE_STEPS,
        )
        images = getattr(result, "images", None)
        if not isinstance(images, list) or not images:
            raise RuntimeError("No generated image returned by model")

        output = io.BytesIO()
        images[0].save(output, format="PNG")
        output.seek(0)
        return StreamingResponse(output, media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Image inference error: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
