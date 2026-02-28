# Requirement: Upgrade to ACE-Step 1.5 External API

## Context
The backend currently loads ACEStep 1.3 in-process via `ACEStepPipeline` from the `ace-step` Python package. ACE-Step 1.5 ships with a built-in REST API server (`uv run acestep-api`, default port 8001) that offers better performance and newer model capabilities. The goal is to decouple the ML model from the FastAPI backend by calling the external ACE-Step 1.5 API instead, and provide a startup script to launch that API from the repo located at `ACE_STEP_API_HOME`.

## Goals
- Replace in-process ACEStep 1.3 inference with HTTP calls to the ACE-Step 1.5 REST API
- Provide a reusable startup script for the ACE-Step 1.5 API server
- Remove the `ace-step` direct dependency from the backend

## User Stories

### US-001: Startup script for ACE-Step 1.5 API
**As a** developer, **I want** a script that launches the ACE-Step 1.5 API server from the path specified by `ACE_STEP_API_HOME` **so that** I can start the ML backend independently.

**Acceptance Criteria:**
- [ ] A shell script (e.g. `start-acestep.sh`) exists at the project root
- [ ] The script reads the `ACE_STEP_API_HOME` environment variable to locate the ACE-Step 1.5 repo
- [ ] The script exits with a clear error message if `ACE_STEP_API_HOME` is not set or the directory does not exist
- [ ] The script runs `uv run acestep-api` inside the `ACE_STEP_API_HOME` directory to start the API on its default port (8001)
- [ ] The script is executable (`chmod +x`)

### US-002: Backend calls ACE-Step 1.5 REST API instead of in-process pipeline
**As a** end user, **I want** audio generation to use ACE-Step 1.5 **so that** I get higher-quality lofi music.

**Acceptance Criteria:**
- [ ] `backend/main.py` no longer imports `ACEStepPipeline` or any `acestep` module
- [ ] `backend/main.py` sends a `POST` to `{ACESTEP_API_URL}/release_task` with JSON body containing `prompt`, `lyrics`, `audio_duration`, `inference_steps`, and `audio_format` fields
- [ ] After submitting, the backend polls `POST {ACESTEP_API_URL}/query_result` with the returned `task_id` until `status == 1` (succeeded) or `status == 2` (failed)
- [ ] On success, the backend parses the `result` JSON string from the poll response, extracts the `file` URL (e.g. `/v1/audio?path=...`), and fetches the raw audio bytes via `GET {ACESTEP_API_URL}{file}`
- [ ] The ACE-Step 1.5 API base URL is configurable via `ACESTEP_API_URL` env var, defaulting to `http://localhost:8001`
- [ ] The prompt template (`"{mood} lofi {style}, {tempo} BPM"`) is preserved and sent in the `prompt` field
- [ ] Existing parameters are mapped: `lyrics=""`, `audio_duration=30`, `inference_steps=20`, `audio_format="wav"`
- [ ] The endpoint still returns a WAV `StreamingResponse` to the frontend
- [ ] Errors from the ACE-Step 1.5 API (connection refused, non-OK status, task failure) are caught and returned as HTTP 500 with `"Audio generation failed"`
- [ ] The FastAPI lifespan no longer loads a model at startup

### US-003: Remove ace-step dependency from backend
**As a** developer, **I want** the `ace-step` package removed from backend dependencies **so that** the backend is lightweight and does not bundle the ML model.

**Acceptance Criteria:**
- [ ] `ace-step` is removed from `backend/pyproject.toml` dependencies
- [ ] `backend/uv.lock` is regenerated without `ace-step`
- [ ] An HTTP client library (e.g. `httpx`) is added to `backend/pyproject.toml` if needed for calling the ACE-Step 1.5 API
- [ ] Typecheck / lint passes

## Functional Requirements
- FR-1: The startup script must use `ACE_STEP_API_HOME` env var to locate the ACE-Step 1.5 installation and run `uv run acestep-api` from that directory.
- FR-2: The backend must call the ACE-Step 1.5 REST API over HTTP using an async 3-step flow: (1) `POST /release_task` to submit, (2) `POST /query_result` to poll until done, (3) `GET /v1/audio?path=...` to download the WAV bytes.
- FR-3: The ACE-Step 1.5 API base URL must be configurable via `ACESTEP_API_URL` env var, defaulting to `http://localhost:8001`.
- FR-4: The existing `/api/generate` request/response contract (accepts `{mood, tempo, style}`, returns WAV audio) must remain unchanged from the frontend's perspective.
- FR-5: The `ace-step` Python package must be removed from `backend/pyproject.toml`.

## Non-Goals (Out of Scope)
- Changing the frontend UI or adding new parameters
- Exposing ACE-Step 1.5's advanced features (reference audio, key/scale, time signature, CFG scale)
- Dockerizing or containerizing the ACE-Step 1.5 API
- Automated tests (manual end-to-end verification is sufficient for this iteration)
- Managing ACE-Step 1.5 installation or model downloads

## Open Questions
None — all resolved.

## Appendix: ACE-Step 1.5 API Reference

### POST /release_task — Submit generation task
**Request body (JSON):**
| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | Yes | Music description |
| `lyrics` | string | No | `""` for instrumental |
| `audio_duration` | float | No | 10–600 seconds |
| `inference_steps` | integer | No | 1–20 (turbo) / 1–200 (base) |
| `audio_format` | string | No | `"wav"`, `"mp3"`, or `"flac"` |

**Response:**
```json
{ "data": { "task_id": "<uuid>", "status": "queued", "queue_position": 1 }, "code": 200 }
```

### POST /query_result — Poll task status
**Request body:** `{ "task_id_list": ["<uuid>"] }`
**Response:** `data[0].status`: `0` = queued/running, `1` = succeeded, `2` = failed. On success, `data[0].result` is a JSON string containing `[{"file": "/v1/audio?path=...", "metas": {...}}]`.

### GET /v1/audio?path=\<encoded-path\> — Download audio
Returns raw audio bytes (no JSON wrapper).

### GET /health — Health check
Returns `{ "status": "ok" }`.
