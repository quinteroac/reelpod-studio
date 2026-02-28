# Requirement: Replace OpenAI+Strudel with ACEStep Local Inference

## Context

The current audio pipeline uses OpenAI's Chat Completions API to generate a Strudel pattern string,
which is then executed by the Strudel REPL in the browser via Web Audio API. This creates a
dependency on an external paid API, requires an `OPENAI_API_KEY`, and produces synthesised
pattern-based audio rather than model-generated audio.

The goal is to replace both the OpenAI call and the Strudel REPL playback with ACEStep
(`ace-step` Python package), an open-source local music generation model. Inference runs fully
inside the FastAPI backend — no external API, no API key. The frontend is updated minimally to
play the returned WAV audio through an HTML5 `<audio>` element.

## Goals

- Eliminate the OpenAI dependency and `OPENAI_API_KEY` requirement.
- Generate audio locally using ACEStep weights running inside the FastAPI process.
- Return a playable WAV audio stream from `POST /api/generate`.
- Replace Strudel REPL playback in the frontend with an HTML5 `<audio>` element.
- Remove all dead code related to OpenAI, Strudel skill files, and pattern validation.

## User Stories

### US-001: Backend generates audio with ACEStep instead of OpenAI

**As a** backend service, **I want** to load ACEStep locally and run inference on each generate
request **so that** music is produced without any external API call or API key.

**Acceptance Criteria:**
- [ ] `ace-step` is listed as a backend Python dependency (e.g., in `requirements.txt` or `pyproject.toml`).
- [ ] The `ACEStep` model is instantiated once at FastAPI application startup (not per request).
- [ ] `POST /api/generate` accepts the same request body as before: `{ mood: string, tempo: integer, style: string }` with the same validation rules (tempo 60–120, non-empty strings).
- [ ] The handler builds an ACEStep `prompt` string from the three parameters, e.g. `"chill lofi jazz, 80 BPM"`. The exact template must be documented in a code comment.
- [ ] ACEStep is called with `lyrics=""` (instrumental — no lyrics input).
- [ ] `audio_duration` defaults to 30 seconds; `infer_step` defaults to 20.
- [ ] On success, the endpoint returns a `StreamingResponse` with `media_type="audio/wav"` containing the generated WAV bytes.
- [ ] On ACEStep inference failure, the endpoint returns HTTP 500 with `{ "error": "Audio generation failed" }`.
- [ ] All OpenAI imports (`from openai import OpenAI`), `OPENAI_API_KEY` env-var reads, and the `build_messages` / `load_skill_body` / `load_few_shot_examples` / `validate_pattern` / `extract_pattern_candidate` / `flatten_text_content` / `is_malformed_pattern` helper functions are removed.
- [ ] The `backend/llm-skills/` directory (Strudel skill files and examples) is removed.
- [ ] Typecheck / lint passes on the backend.

### US-002: Frontend plays the returned WAV audio via HTML5 `<audio>`

**As an** end user, **I want** the Generate button to produce audible music that plays immediately
in my browser **so that** I can hear the generated track without any Strudel REPL.

**Acceptance Criteria:**
- [ ] `requestGeneratedPattern` is replaced by a new function (e.g., `requestGeneratedAudio`) that `fetch`es `POST /api/generate` and, on success, creates an object URL from the response `Blob` (`URL.createObjectURL`).
- [ ] An HTML5 `<audio>` element (or a `new Audio(url)` instance) is used for playback; the Strudel controller (`createBrowserStrudelController`, `StrudelController`) is removed from `App.tsx`.
- [ ] After a successful generate, the audio plays automatically (equivalent to the previous auto-play behaviour).
- [ ] The existing Play / Pause buttons control the `<audio>` element's `play()` / `pause()` methods.
- [ ] The Seek slider controls `audio.currentTime` proportionally (0–100 mapped to 0–`audio.duration`).
- [ ] Error messages for network failures or non-OK responses remain user-visible (same error-display UI as before).
- [ ] The parameter controls (Mood, Tempo, Style selects/slider) are unchanged.
- [ ] All imports of `strudel-adapter`, `strudel.ts`, `strudel-repl.ts`, and related Strudel types are removed from `App.tsx`.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: clicking Generate produces audible audio; Play/Pause/Seek work.

### US-003: End-to-end smoke test

**As a** developer, **I want** an automated test that verifies the new generate endpoint returns
valid WAV audio **so that** regressions are caught without manual testing.

**Acceptance Criteria:**
- [ ] A test file (e.g., `backend/test_main.py`) contains at least one test for `POST /api/generate`.
- [ ] The test mocks the ACEStep model's `infer()` call so it returns a minimal valid WAV byte sequence without loading GPU weights.
- [ ] The test asserts: HTTP status 200, `content-type: audio/wav`, and non-empty response body.
- [ ] A second test asserts: when ACEStep `infer()` raises an exception, the endpoint returns HTTP 500 with `{"error": "Audio generation failed"}`.
- [ ] All tests pass.

## Functional Requirements

- **FR-1** The `ace-step` Python package is the sole audio generation dependency; no OpenAI SDK.
- **FR-2** The `ACEStep` model instance is created once at startup (module-level or via FastAPI `lifespan`) to avoid per-request model loading latency.
- **FR-3** The ACEStep `prompt` is built from all three UI parameters using a fixed template: `"{mood} lofi {style}, {tempo} BPM"`.
- **FR-4** ACEStep inference uses `lyrics=""`, `audio_duration=30`, `infer_step=20` as defaults (constants, easy to change).
- **FR-5** `POST /api/generate` returns `StreamingResponse(content=wav_bytes, media_type="audio/wav")` on success.
- **FR-6** On inference error the endpoint returns HTTP 500 with JSON body `{"error": "Audio generation failed"}`.
- **FR-7** The frontend creates a Blob URL from the audio response and passes it to an HTML5 `<audio>` element for playback.
- **FR-8** The existing request-body validation (tempo range 60–120, non-empty mood/style strings, 422 on invalid payload) is preserved unchanged.
- **FR-9** All removed files (`backend/llm-skills/` tree, Strudel source files if unused) must be deleted; no orphaned imports remain.

## Non-Goals (Out of Scope)

- Keeping the Strudel REPL, Strudel pattern generation, or any Strudel-related code.
- Keeping the R3F visual/animation layer (not touched in this iteration).
- Exposing `audio_duration`, `infer_step`, or ACEStep model variant as user-configurable UI controls.
- Persisting generated audio files to disk beyond the lifetime of a single request.
- Lyrics input from the user.
- Running ACEStep as a separate REST server (`acestep-api`) — inference must be in-process.
- GPU/hardware configuration UI or automatic hardware detection beyond what `ace-step` does by default.

## Open Questions

- What is the minimum WAV byte sequence needed to satisfy the smoke test mock? (A 44-byte RIFF/WAV header with zero samples is sufficient for content-type testing.)
- Does `ace-step` expose a `.to_wav_bytes()` method or does the handler need to call `save_wav()` to a `tempfile` and read it back? (Investigate at prototype time.)
- Should `audio_duration` be derived from `tempo` (e.g., longer clip for slower tempos) in a future iteration?
