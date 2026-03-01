from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from models.constants import (
    DEFAULT_ACESTEP_API_URL,
    DEFAULT_DURATION_SECONDS,
    MAX_POLL_ATTEMPTS,
    POLL_INTERVAL_SECONDS,
    QUERY_RESULT_PATH,
    RELEASE_TASK_PATH,
)


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


def submit_task(
    prompt: str,
    tempo: int = 80,
    duration: int = DEFAULT_DURATION_SECONDS,
) -> str:
    payload = {
        "prompt": prompt,
        "lyrics": "",
        "bpm": tempo,
        "audio_duration": duration,
        "inference_steps": 20,
        "audio_format": "wav",
        "thinking": True,
    }
    response = post_json(make_absolute_url(RELEASE_TASK_PATH), payload)
    data = response.get("data") or response
    task_id = data.get("task_id") if isinstance(data, dict) else None
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError(f"Missing task_id in response: {response}")
    return task_id


def poll_until_complete(task_id: str) -> dict[str, Any]:
    for _ in range(MAX_POLL_ATTEMPTS):
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


def generate_audio_bytes_for_prompt(
    prompt: str,
    tempo: int = 80,
    duration: int = DEFAULT_DURATION_SECONDS,
) -> bytes:
    task_id = submit_task(prompt, tempo=tempo, duration=duration)
    completed_task = poll_until_complete(task_id)
    file_path = extract_file_path(completed_task)
    return get_bytes(make_absolute_url(file_path))
