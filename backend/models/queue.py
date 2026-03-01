from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from models.constants import DEFAULT_DURATION_SECONDS

QueueItemStatus = Literal["queued", "generating", "completed", "failed"]


@dataclass
class GenerationQueueItem:
    id: str
    prompt: str
    status: QueueItemStatus
    tempo: int = 80
    duration: int = DEFAULT_DURATION_SECONDS
    wav_bytes: bytes | None = None
    error_message: str | None = None
