# Audit Report — Iteration 000026

## Executive Summary

Iteration 000026 was substantially implemented in the backend but critically incomplete in the frontend at the time of audit. US-002 (Backend LLM orchestration service) and US-003 (Wire LLM orchestration into the video generation pipeline) were fully implemented and tested, satisfying all 8 functional requirements. US-001 (Frontend single-prompt input) was not implemented: the commit labeled `feat: implement US-001` only modified progress-tracking JSON files with zero changes to frontend source. Following the audit, the user chose to follow recommendations and US-001 was implemented in `src/App.tsx`.

## Verification by FR

| FR | Assessment | Notes |
|---|---|---|
| FR-1 | comply | `GenerateRequestBody` in `backend/models/schemas.py` includes `"llm"` as a valid Literal; a model validator enforces `prompt` is required when `mode == "llm"`. |
| FR-2 | comply | `load_llm_pipeline()` imports and uses `comfy_diffusion.textgen` (`generate_text`, `generate_ltx2_prompt`). |
| FR-3 | comply | `CREATIVE_DIRECTOR_SYSTEM_PROMPT` instructs strict Danbooru tag order; the `image_prompt` field validator enforces the `score_9, score_8, best quality, highres` quality prefix. |
| FR-4 | comply | `video_service.generate_video_mp4_for_request()` remains the single orchestration entry point for all modes including `llm`. |
| FR-5 | comply | `orchestration_service.startup()` is called in `backend/main.py` alongside other service startups. |
| FR-6 | comply | `load_llm_pipeline()` logs a warning and returns `None` if `REELPOD_LLM_MODEL_PATH` is not set, enabling graceful degradation. |
| FR-7 | comply | `REELPOD_LLM_MODEL_PATH` controls the model checkpoint and `REELPOD_LLM_CLIP_TYPE` controls the model type (defaults to `"llm"`). |
| FR-8 | comply | LLM output is validated through the `OrchestrationResult` Pydantic model in two passes; `ValidationError` is caught and re-raised as `OrchestrationFailedError`. |

## Verification by US

| US | Assessment | Notes |
|---|---|---|
| US-001 | comply (post-remediation) | All AC met after implementing the frontend changes: `'llm'` added to `GenerationMode` type; LLM option added to mode selector; parameter controls (mood, style, tempo, duration) hidden in llm mode; image prompt section hidden in llm mode; textarea label changes to "Creative brief" with a creative director placeholder; Generate sends `{ mode: "llm", prompt, targetWidth, targetHeight }`. TypeScript typechecks pass with no errors. |
| US-002 | comply | All 8 AC met. `orchestration_service.py` exposes `load_llm_pipeline()` and `orchestrate()`. Creative director system prompt present. `audio_prompt`, `image_prompt` (Danbooru order), `video_prompt` (LTX-Video 2 single paragraph) are prompted and validated. Graceful failure when pipeline not loaded. 4/4 unit tests pass. |
| US-003 | comply | All 4 AC met. `GenerateRequestBody` includes `"llm"` literal. `generate_video_mp4_for_request()` detects `mode == "llm"`, calls `orchestrate()`, and uses resulting prompts for audio, image, and video pipelines. Existing modes unaffected. `pytest` passes. |

## Minor Observations

- `OrchestrationFailedError` has no dedicated HTTP handler in `backend/routes/api.py`; it falls through to the generic `VideoGenerationFailedError` handler, returning a generic HTTP 500 without distinguishing orchestration failures from other pipeline failures.
- Env var naming inconsistency: the PRD (FR-7) mentions `REELPOD_LLM_MODEL_TYPE` but the implementation uses `REELPOD_LLM_CLIP_TYPE`. This may cause operator confusion when configuring the service.
- `progress.json` incorrectly marked US-001 as `"completed"` (exit code 0) before any frontend code was written.
- 23 pre-existing test failures in `src/App.test.tsx` exist unrelated to this iteration's changes; they were present before and after the US-001 remediation.

## Conclusions and Recommendations

All three user stories are now compliant. The backend is production-ready and the frontend has been updated to support the `llm` mode end-to-end. The remaining minor issues (OrchestrationFailedError handler, env var naming) should be addressed in a follow-up iteration or as technical debt. The pre-existing App.test.tsx failures should be investigated separately.

## Refactor Plan

1. **Add `OrchestrationFailedError` route handler** — Register a dedicated exception handler in `backend/routes/api.py` that returns HTTP 422 or 503 with a descriptive JSON error, distinguishing orchestration failures from generic video generation errors.
2. **Resolve env var naming** — Align `REELPOD_LLM_CLIP_TYPE` with the PRD-specified `REELPOD_LLM_MODEL_TYPE`, or update the PRD documentation to match the implementation. Add to operator setup documentation.
3. **Fix pre-existing App.test.tsx failures** — Investigate and resolve the 23 pre-existing test failures in `src/App.test.tsx` to restore a green test suite for the frontend.
4. **Add frontend llm mode tests** — Add tests in `src/App.test.tsx` covering: llm mode selected hides parameters; llm mode dispatches correct payload; empty brief shows error; generate with llm brief creates queue entry.
