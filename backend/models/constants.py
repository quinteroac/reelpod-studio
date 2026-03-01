from __future__ import annotations

MIN_TEMPO = 60
MAX_TEMPO = 120
MIN_DURATION_SECONDS = 40
MAX_DURATION_SECONDS = 300
DEFAULT_DURATION_SECONDS = 40

INVALID_PAYLOAD_ERROR = (
    "Invalid payload. Expected { mode?: 'text'|'text+params'|'text-and-parameters'|'params'|'parameters', "
    f"prompt?: string, mood?: string, tempo?: number ({MIN_TEMPO}-{MAX_TEMPO}), "
    f"duration?: number ({MIN_DURATION_SECONDS}-{MAX_DURATION_SECONDS}), style?: string }}"
)

DEFAULT_ACESTEP_API_URL = "http://localhost:8001"
RELEASE_TASK_PATH = "/release_task"
QUERY_RESULT_PATH = "/query_result"
POLL_INTERVAL_SECONDS = 0.5
MAX_POLL_ATTEMPTS = 1200

IMAGE_MODEL_ID = "Ine007/waiIllustriousSDXL_v160"
IMAGE_SIZE = 1024
IMAGE_NUM_INFERENCE_STEPS = 25
IMAGE_ASPECT_TOLERANCE = 1e-6

QUEUE_WAIT_TIMEOUT_SECONDS = 300.0
