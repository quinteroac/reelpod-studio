# Requirement: Update comfy-diffusion vendor to v1.1.0

## Context
`backend/vendor/comfy-diffusion` is a local git clone of `https://github.com/quinteroac/comfy-diffusion`,
previously on `master` at version `0.1.1` (commit `ef3332c`).
The upstream repository progressed to `v1.1.0` across 10 new iterations (it_000012–it_000021),
adding modules for advanced conditioning, ControlNet, latent utilities, image utilities, masks,
model patches, packaging, variadic `load_clip`, LLM/VLM text generation, and ComfyUI auto-bootstrap.

The update was performed manually (`git pull origin master`) to identify integration issues before
handing off to the prototype phase. One breaking change was found and fixed: `audio_repository.py`
called `load_clip(path, path2=path2, ...)` but it_000019 changed the signature to `*paths` variadic.

## Goals
- Confirm `backend/vendor/comfy-diffusion` is at `v1.1.0` and all its tests pass (or failures are documented).
- Fix the one breaking change in the ReelPod backend caused by the `load_clip` signature change.
- Verify the ReelPod backend still loads correctly after the fix.

## User Stories

### US-001: vendor/comfy-diffusion is updated to v1.1.0
**As a** developer, **I want** `backend/vendor/comfy-diffusion` to be at `v1.1.0` **so that** LLM/VLM
capabilities (and all other new modules) are available for future iterations.

**Acceptance Criteria:**
- [ ] `git -C backend/vendor/comfy-diffusion log --oneline -1` shows commit `1386a33` (v1.1.0).
- [ ] `cd backend/vendor/comfy-diffusion && uv run python -c "import comfy_diffusion; print(comfy_diffusion.check_runtime())"` exits without error.

### US-002: comfy-diffusion pytest suite passes
**As a** developer, **I want** the full `uv run pytest` suite in `comfy-diffusion` to pass (or all
failures to be explained) **so that** I know no regressions were introduced.

**Acceptance Criteria:**
- [ ] `cd backend/vendor/comfy-diffusion && uv run pytest` reports at most the one known environmental
  failure: `test_path_insertion_is_minimal_and_not_duplicated` (false positive — the project resides
  at a path containing `/vendor/`, which confuses the test's `sys.path` filter; not a code regression).
- [ ] All other tests pass (baseline: 269 passing before this story is considered done).

### US-003: Fix ReelPod backend `load_clip` call to use new variadic signature
**As a** developer, **I want** `audio_repository.py` to call `load_clip` using the new `*paths`
variadic signature **so that** the backend does not crash on startup after the comfy-diffusion update.

**Acceptance Criteria:**
- [ ] `backend/repositories/audio_repository.py` no longer passes `path2=` as a keyword argument.
- [ ] The call passes both encoder paths as positional args when `text_encoder_2_name` is set, and a
  single path otherwise.
- [ ] `cd backend && uv run python -c "from repositories.audio_repository import build_pipeline"` imports without error.

## Functional Requirements
- FR-1: `backend/vendor/comfy-diffusion` MUST be at commit `1386a33` (v1.1.0).
- FR-2: `comfy_diffusion.check_runtime()` MUST return a non-error result.
- FR-3: `ModelManager.load_clip(*paths, clip_type=...)` MUST be called with positional paths — `path2=` keyword is no longer valid.
- FR-4: No other ReelPod backend files require changes from this update.

## Non-Goals (Out of Scope)
- Implementing or exposing the LLM/VLM text generation API in ReelPod — deferred to the next iteration.
- Adding new tests to comfy-diffusion or the ReelPod backend.
- Fixing the environmental test failure `test_path_insertion_is_minimal_and_not_duplicated` upstream.

## Open Questions
- None
