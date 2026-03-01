from __future__ import annotations

import threading
from collections import deque
from uuid import uuid4
from urllib.error import HTTPError, URLError
import json
import logging
import time

from models.constants import DEFAULT_DURATION_SECONDS, QUEUE_WAIT_TIMEOUT_SECONDS
from models.errors import (
    AudioGenerationFailedError,
    AudioGenerationTimeoutError,
    QueueItemNotFoundError,
    AudioNotReadyError,
)
from models.queue import GenerationQueueItem
from models.schemas import GenerateRequestBody
from repositories import acestep_repository

logger = logging.getLogger(__name__)

queue_items: dict[str, GenerationQueueItem] = {}
queue_order: deque[str] = deque()
queue_condition = threading.Condition()
queue_worker_thread: threading.Thread | None = None
queue_stop_event = threading.Event()


def build_prompt(body: GenerateRequestBody) -> str:
    if body.mode == "text":
        return body.prompt or ""
    if body.mode in ("text+params", "text-and-parameters"):
        return f"{body.prompt or ''}, {body.mood}, {body.style}, {body.tempo} BPM"

    return f"{body.mood} lofi {body.style}, {body.tempo} BPM"


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
            duration=item.duration,
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
        duration=body.duration,
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
                    duration=item.duration,
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


def _queue_worker() -> None:
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
            wav_bytes = acestep_repository.generate_audio_bytes_for_prompt(
                item.prompt,
                tempo=item.tempo,
                duration=item.duration,
            )
        except (RuntimeError, URLError, HTTPError, json.JSONDecodeError, TimeoutError) as exc:
            logger.error("ACE-Step API error: %s: %s", type(exc).__name__, exc)
            with queue_condition:
                failed_item = queue_items.get(next_item_id)
                if failed_item is not None:
                    failed_item.status = "failed"
                    failed_item.error_message = "Audio generation failed"
                    failed_item.wav_bytes = None
                queue_condition.notify_all()
        except Exception as exc:  # pragma: no cover - safety net
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
        queue_worker_thread = threading.Thread(target=_queue_worker, daemon=True)
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


def generate_audio_for_request(body: GenerateRequestBody) -> bytes:
    ensure_queue_worker_running()
    item = enqueue_generation_request(body)
    completed_item = wait_for_terminal_status(item.id, timeout_seconds=QUEUE_WAIT_TIMEOUT_SECONDS)

    if completed_item is None:
        raise AudioGenerationTimeoutError("Audio generation timed out")
    if completed_item.status == "failed" or completed_item.wav_bytes is None:
        raise AudioGenerationFailedError("Audio generation failed")

    return completed_item.wav_bytes


def create_generation_request(body: GenerateRequestBody) -> dict[str, str]:
    ensure_queue_worker_running()
    item = enqueue_generation_request(body)
    return {"id": item.id, "status": item.status}


def get_generation_request_status(item_id: str) -> dict[str, str | None]:
    item = get_queue_item_snapshot(item_id)
    if item is None:
        raise QueueItemNotFoundError("Queue item not found")
    return {"id": item.id, "status": item.status, "error": item.error_message}


def get_generation_request_audio(item_id: str) -> bytes:
    item = get_queue_item_snapshot(item_id)
    if item is None:
        raise QueueItemNotFoundError("Queue item not found")
    if item.status == "failed":
        raise AudioGenerationFailedError("Audio generation failed")
    if item.status != "completed" or item.wav_bytes is None:
        raise AudioNotReadyError("Audio not ready")
    return item.wav_bytes


def startup() -> None:
    ensure_queue_worker_running()


def shutdown() -> None:
    stop_queue_worker()
