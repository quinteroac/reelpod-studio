# Requirement: Single-Prompt LLM Orchestrator (Local)

## Context
ReelPod Studio currently requires users to fill in multiple parameter fields (mood, style, tempo,
duration) plus an optional free-text prompt. This is technical and friction-heavy for content
creators. A local LLM (via `comfy_diffusion.textgen`) takes on the role of **creative director**:
given a short user brief, it autonomously proposes a complete video with a synchronized soundtrack —
choosing the musical style and mood, the visual aesthetic, and the animated scene — then hands off
three specialized prompts to the respective generation pipelines (ACEStep audio, Anima image,
WAN video). The user only needs to express a seed idea; the LLM does the creative work.

## Goals
- Reduce creator friction: one free-text brief replaces all parameter fields.
- Delegate creative decisions: the LLM acts as a creative director, proposing a cohesive
  audiovisual vision rather than merely rephrasing user input.
- Ensure cross-pipeline coherence: music, image, and video prompts share a unified artistic concept
  because they are all derived from the same creative proposal.
- Run 100% locally: no cloud API calls; the LLM is loaded via `comfy_diffusion.textgen` and the
  existing `ModelManager`.

## User Stories

### US-001: Frontend single-prompt input
**As a** content creator, **I want** to type a single free-text description of my idea **so that**
I do not need to fill in mood, style, tempo, or duration fields.

**Acceptance Criteria:**
- [ ] When the app is in `"llm"` mode, all parameter controls (mood, style, tempo, duration) are
  hidden and replaced by a single full-width textarea labeled "Describe your idea".
- [ ] The textarea accepts any non-empty text (no character limit enforced client-side beyond
  trimming whitespace).
- [ ] Clicking "Generate" sends `{ mode: "llm", prompt: "<user text>", targetWidth, targetHeight }`
  to `POST /api/generate`. No other generation parameters are sent.
- [ ] A loading indicator is shown during generation (same as existing loading state).
- [ ] On success the generated video plays in the existing player UI.
- [ ] On error an error message is shown (same as existing error handling).
- [ ] The textarea placeholder text reflects the creative director role, e.g.
  "Describe an idea — the AI will compose the music, visuals, and video.".
- [ ] Visually verified in browser: parameter form is hidden, textarea is visible, generation
  completes and video plays.
- [ ] Typecheck / lint passes.

### US-002: Backend LLM orchestration service — creative director role
**As a** backend system, **I want** the LLM to act as a creative director that proposes a complete
video-with-soundtrack from a short user brief **so that** each generation pipeline receives a
purposeful, coherent prompt it did not need the user to spell out.

**Acceptance Criteria:**
- [ ] A new module `backend/services/orchestration_service.py` exposes:
  - `load_llm_pipeline() -> Any` — loads the LLM model via `comfy_diffusion`; called at startup.
  - `orchestrate(user_prompt: str) -> OrchestrationResult` — returns a Pydantic model with
    three fields: `audio_prompt: str`, `image_prompt: str`, `video_prompt: str`.
- [ ] The LLM system prompt instructs the model to act as a **creative director**: given the user's
  brief it must invent and propose a complete audiovisual concept, not merely rephrase. It should
  decide the musical genre, tempo, mood, lyrical theme, visual art style, character or scene
  composition, and camera motion independently, as long as the result is consistent with the brief.
- [ ] `audio_prompt` is a creative music brief for ACEStep: genre, mood, tempo hint (e.g. "90 BPM"),
  instrumentation, and lyrical theme — written as a descriptive sentence or comma-separated tags.
- [ ] `image_prompt` follows Danbooru tag order strictly:
  `[quality/meta/year/safety tags] [count tag] [character] [series] [artist] [general tags]`.
  The quality section MUST start with `score_9, score_8, best quality, highres`.
- [ ] `video_prompt` is a single-paragraph action-focused scene description in LTX-Video 2 format
  (uses `comfy_diffusion.textgen.generate_ltx2_prompt`).
- [ ] If the LLM pipeline failed to load at startup, `orchestrate()` raises
  `OrchestrationFailedError` with a descriptive message.
- [ ] Unit tests in `backend/test_orchestration_service.py` cover: successful orchestration
  (mocked LLM), LLM load failure raises correct error, Danbooru tag order is preserved in
  `image_prompt`.
- [ ] `cd backend && uv run pytest test_orchestration_service.py` passes.

### US-003: Wire LLM orchestration into the video generation pipeline
**As a** backend system, **I want** `"llm"` mode requests to run LLM orchestration before invoking
ACEStep, Anima, and WAN **so that** all three pipelines use LLM-derived prompts automatically.

**Acceptance Criteria:**
- [ ] `GenerateRequestBody` accepts `mode: "llm"` as a valid literal; `prompt` is required when
  `mode == "llm"`.
- [ ] `video_service.generate_video_mp4_for_request()` detects `mode == "llm"`, calls
  `orchestration_service.orchestrate(body.prompt)`, and uses the returned prompts:
  - `audio_prompt` → passed to `audio_service` (overriding `build_prompt`).
  - `image_prompt` → passed to `image_service` (instead of `build_image_prompt`).
  - `video_prompt` → passed to `video_repository.run_video_inference` as `prompt`.
- [ ] For all other modes (`"text"`, `"text-and-parameters"`, `"parameters"`), existing behaviour
  is unchanged.
- [ ] `cd backend && uv run pytest` passes (all existing tests remain green).

## Functional Requirements
- FR-1: A new `"llm"` literal is added to the `mode` field of `GenerateRequestBody`; `prompt` is
  required for this mode.
- FR-2: `orchestration_service.load_llm_pipeline()` uses `comfy_diffusion` (specifically
  `comfy_diffusion.textgen.generate_text` / `generate_ltx2_prompt`) with the LLM model path
  configured via the environment variable `REELPOD_LLM_MODEL_PATH`.
- FR-3: The Anima image prompt generated by the LLM MUST follow Danbooru tag order:
  `[quality/meta/year/safety] [count] [character] [series] [artist] [general tags]`.
  The LLM system prompt for image generation must enforce this ordering explicitly.
- FR-4: `video_service.generate_video_mp4_for_request()` must remain the single orchestration
  entry point; no new HTTP endpoints are required.
- FR-5: `orchestration_service` startup is registered in `backend/main.py` alongside
  `audio_service.startup` and `image_service.startup`.
- FR-6: If `REELPOD_LLM_MODEL_PATH` is not set, `load_llm_pipeline()` logs a warning and returns
  `None`; `orchestrate()` then raises `OrchestrationFailedError` with a clear message.
- FR-7: The LLM model checkpoint and type are operator-supplied via environment variables:
  `REELPOD_LLM_MODEL_PATH` (required — path to the GGUF/safetensors checkpoint) and
  `REELPOD_LLM_CLIP_TYPE` (optional, default `"llm"`). No specific checkpoint is mandated;
  any ComfyUI-compatible LLM supported by `comfy_diffusion.models.ModelManager.load_clip()`
  is valid (e.g. Gemma-3, SmolLM, Qwen).
- FR-8: LLM output for each pipeline MUST be sanitised and validated using **Pydantic** (the
  Python equivalent of Zod) before being passed downstream:
  - The LLM system prompt establishes the creative director role and instructs it to respond
    with a JSON object containing the keys `audio_prompt`, `image_prompt`, and `video_prompt`.
    The prompt must explicitly tell the LLM to make creative decisions autonomously (genre,
    tempo, visual style, scene narrative) rather than asking for user clarification.
  - The raw string returned by `generate_text()` is parsed with `json.loads()`; if parsing
    fails, the service retries up to 2 times before raising `OrchestrationFailedError`.
  - The parsed object is validated against a `Pydantic` model (`OrchestrationResult`) with
    these field-level rules:
    - `audio_prompt`: `str`, stripped, min length 10, max length 500.
    - `image_prompt`: `str`, stripped, min length 10, max length 500; must start with one of
      the known quality tag prefixes (`score_9`, `masterpiece`, `best quality`) — enforced via
      a `@field_validator`.
    - `video_prompt`: `str`, stripped, min length 20, max length 1000; must be a single
      paragraph (no newlines) — enforced via a `@field_validator`.
  - If Pydantic validation fails, `OrchestrationFailedError` is raised with the validation
    error detail.

## Non-Goals (Out of Scope)
- Displaying the LLM-generated prompts to the user (no readonly preview fields in this MVP).
- Allowing the user to edit the LLM-generated prompts before generation.
- Supporting cloud LLM APIs (OpenAI, Anthropic) — local only.
- Changing the MCP `set_song_parameters` / `generate_audio` / `add_to_queue` tool signatures.
- Adding a UI toggle to switch between `"llm"` mode and `"parameters"` mode at runtime — `"llm"`
  is the only mode shown in the UI for this iteration.
- Tuning LLM sampling hyperparameters (temperature, top_k, etc.) — defaults from
  `comfy_diffusion.textgen.generate_text` are used.

## Open Questions
- None
