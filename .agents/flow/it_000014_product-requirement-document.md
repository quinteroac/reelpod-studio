# Requirement: Backend Three-Layer Architecture Refactor

## Context
The entire backend lives in a single `backend/main.py` file (~570 lines) that mixes HTTP routing, business logic, queue orchestration, and external I/O (ACEStep HTTP calls, ML pipeline calls). This makes the code hard to test in isolation and difficult to extend. This iteration restructures the backend into three clear layers — Routes, Services, and Repositories — without changing any observable behaviour or public API contract.

## Goals
- Separate HTTP routing, business logic, and external I/O into distinct, independently testable modules.
- Preserve the existing public HTTP API (no endpoint, request schema, or response schema changes).
- Increase test coverage by enabling unit tests for the service and repository layers in isolation.
- Update the project context to reflect the new backend architecture.

---

## User Stories

### US-001: Split `main.py` into Route, Service, and Repository Modules
**As a** developer, **I want** the backend source split across `routes/`, `services/`, and `repositories/` sub-packages **so that** each layer has a single, well-defined responsibility.

**Acceptance Criteria:**
- [ ] The following directory structure exists inside `backend/`:
  ```
  backend/
  ├── main.py                          ← composition root only
  ├── models.py                        ← shared Pydantic models + dataclasses
  ├── routes/
  │   ├── __init__.py
  │   ├── generate.py                  ← audio endpoints (APIRouter)
  │   └── images.py                    ← image endpoint (APIRouter)
  ├── services/
  │   ├── __init__.py
  │   ├── audio_service.py             ← prompt building, queue logic, worker
  │   └── image_service.py             ← refiner / crop-and-resize logic
  └── repositories/
      ├── __init__.py
      ├── acestep_repository.py        ← ACEStep HTTP submit/poll/fetch
      └── image_pipeline_repository.py ← model loading + pipeline state
  ```
- [ ] `main.py` only creates the `FastAPI` app, registers `APIRouter`s, and registers `startup`/`shutdown` lifecycle events — no business logic or I/O.
- [ ] Route modules contain only FastAPI endpoint functions and exception handlers; they delegate to services.
- [ ] Service modules contain only business logic and orchestration; they call repositories but contain no `urllib` or ML pipeline calls.
- [ ] Repository modules contain all external I/O (`urllib` calls, `DiffusionPipeline` usage); they contain no business logic.
- [ ] Typecheck / lint passes.

---

### US-002: Existing HTTP API Contract Is Preserved
**As a** developer, **I want** all existing endpoints to keep exactly the same URL, HTTP method, request schema, and response schema **so that** the frontend requires zero changes.

**Acceptance Criteria:**
- [ ] `POST /api/generate` — accepts the same `GenerateRequestBody` schema, returns `audio/wav` stream.
- [ ] `POST /api/generate-requests` — same request schema, returns `{ id, status }`.
- [ ] `GET /api/generate-requests/{item_id}` — returns `{ id, status, error }`.
- [ ] `GET /api/generate-requests/{item_id}/audio` — returns `audio/wav` stream.
- [ ] `POST /api/generate-image` — accepts the same `GenerateImageRequestBody` schema, returns `image/png` stream.
- [ ] All existing `test_main.py` tests pass without modification (no test code changes for this story).
- [ ] Typecheck / lint passes.

---

### US-003: Unit Tests for the Service Layer
**As a** developer, **I want** isolated unit tests for the service layer **so that** business logic can be verified without standing up HTTP or ML infrastructure.

**Acceptance Criteria:**
- [ ] A test file `backend/test_audio_service.py` (or equivalent co-located file) covers at minimum:
  - [ ] `build_prompt` produces the correct string for `params`, `text`, `text+params`, and `text-and-parameters` modes.
  - [ ] `enqueue_generation_request` adds an item to the queue with status `"queued"`.
  - [ ] `wait_for_terminal_status` returns the item once its status is `"completed"` or `"failed"`.
  - [ ] Queue worker processes items sequentially (max one active at a time) and transitions statuses correctly (`queued` → `generating` → `completed`/`failed`).
- [ ] Tests mock repository functions; no real HTTP calls or ML model loads occur.
- [ ] All new tests pass.
- [ ] Typecheck / lint passes.

---

### US-004: Unit Tests for the Repository Layer
**As a** developer, **I want** isolated unit tests for the repository layer **so that** external I/O adapters can be verified independently of business logic.

**Acceptance Criteria:**
- [ ] A test file `backend/test_acestep_repository.py` (or equivalent co-located file) covers at minimum:
  - [ ] `submit_task` sends the correct JSON payload to `POST /release_task` and returns the `task_id`.
  - [ ] `poll_until_complete` polls `POST /query_result` and returns the completed task on status `1`.
  - [ ] `poll_until_complete` raises on ACEStep failure status `2`.
  - [ ] `get_bytes` fetches a URL via `GET` and returns its body.
- [ ] Tests use a fake/stub for `urlopen`; no real network calls are made.
- [ ] All new tests pass.
- [ ] Typecheck / lint passes.

---

### US-005: Update Project Context
**As a** developer, **I want** `PROJECT_CONTEXT.md` updated to describe the new backend module structure **so that** future agents and contributors understand the architecture without reading the source.

**Acceptance Criteria:**
- [ ] `PROJECT_CONTEXT.md` → **Product Architecture** section describes the three-layer split (Routes, Services, Repositories) and the purpose of each layer.
- [ ] `PROJECT_CONTEXT.md` → **Modular Structure** section lists `backend/routes/`, `backend/services/`, `backend/repositories/` with a one-line description of each module.
- [ ] Old references to a monolithic `backend/main.py` are updated or removed where they no longer apply (entry point reference is retained — `main.py` is still the composition root).
- [ ] Typecheck / lint passes (not a code file, but the document must be accurate).

---

## Functional Requirements

- **FR-1:** All FastAPI route functions must live in `backend/routes/` modules and use `APIRouter`. Routers are registered on the `FastAPI` app in `main.py`.
- **FR-2:** Pydantic request/response models (`GenerateRequestBody`, `GenerateImageRequestBody`) and the `GenerationQueueItem` dataclass must live in `backend/models.py` and be imported by both routes and services.
- **FR-3:** `backend/services/audio_service.py` must own: `build_prompt`, `enqueue_generation_request`, `wait_for_terminal_status`, `get_queue_item_snapshot`, `queue_worker`, `ensure_queue_worker_running`, `stop_queue_worker`, and `reset_generation_queue_for_tests`. All queue state (`queue_items`, `queue_order`, `queue_condition`, etc.) moves here.
- **FR-4:** `backend/services/image_service.py` must own: `needs_image_refiner_pass` and `center_crop_and_resize_to_target`.
- **FR-5:** `backend/repositories/acestep_repository.py` must own: `post_json`, `get_bytes`, `make_absolute_url`, `get_acestep_api_url`, `submit_task`, `poll_until_complete`, and `extract_file_path`. All ACEStep constants (`RELEASE_TASK_PATH`, `QUERY_RESULT_PATH`, `POLL_INTERVAL_SECONDS`, `MAX_POLL_ATTEMPTS`, `DEFAULT_ACESTEP_API_URL`) move here.
- **FR-6:** `backend/repositories/image_pipeline_repository.py` must own: `load_image_pipeline`, the `image_pipeline` and `image_model_load_error` module-level state, and the `IMAGE_MODEL_ID`, `IMAGE_SIZE`, `IMAGE_NUM_INFERENCE_STEPS`, `IMAGE_ASPECT_TOLERANCE` constants.
- **FR-7:** `main.py` retains only: `FastAPI` app instantiation, router registration, `startup` and `shutdown` event handlers, and the `INVALID_PAYLOAD_ERROR` constant used by the global `RequestValidationError` handler.
- **FR-8:** `backend/routes/generate.py` handles `POST /api/generate`, `POST /api/generate-requests`, `GET /api/generate-requests/{item_id}`, and `GET /api/generate-requests/{item_id}/audio`.
- **FR-9:** `backend/routes/images.py` handles `POST /api/generate-image`.
- **FR-10:** Existing `test_main.py` must continue to pass without any modifications to its test logic (import paths for mocked symbols may be updated to reflect their new module locations).

---

## Non-Goals (Out of Scope)

- Any changes to the frontend (TypeScript / React).
- Adding new API endpoints or modifying existing request/response contracts.
- Switching the HTTP client (keep `urllib`).
- Introducing a dependency injection framework.
- Adding database or persistent storage.
- Changing the ML model or ACEStep integration logic (only moving the code, not altering it).
- CI/CD pipeline changes.

---

## Open Questions

- None — all decisions are resolved above.
