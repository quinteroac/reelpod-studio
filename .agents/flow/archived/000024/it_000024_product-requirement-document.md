# Requirement: ACEStep Separate Model Loading

## Context
The current audio generation pipeline loads ACEStep via a single all-in-one (AIO) checkpoint file using `manager.load_checkpoint()`. This prevents users from using individually distributed model files (diffusion model, text encoder, VAE). The `comfy_diffusion` vendor already supports separate loading via `load_unet()`, `load_vae()`, and `load_clip()`, but `audio_repository.py` does not use them. This iteration wires up that support and removes the checkpoint path entirely.

## Goals
- Enable loading ACEStep components from separate model files (diffusion model, text encoder, VAE)
- Remove the monolithic checkpoint loading path
- Keep `/api/generate` fully functional with no visible change to callers

## User Stories

### US-001: Backend loads ACEStep from separate model files
**As a** backend system, **I want** to initialise the ACEStep pipeline by loading diffusion model, text encoder, and VAE from separate files **so that** operators can use individually distributed model weights without needing an AIO checkpoint.

**Acceptance Criteria:**
- [ ] `audio_repository.py` calls `manager.load_unet(diffusion_model_name)` to load the diffusion model from the `diffusion_models/` folder
- [ ] `audio_repository.py` calls `manager.load_clip(text_encoder_name)` to load the text encoder from the `text_encoders/` folder (normal clip loader, single file, no second checkpoint)
- [ ] `audio_repository.py` calls `manager.load_vae(vae_name)` to load the VAE from the `vae/` folder
- [ ] `AceComfyPipeline` is constructed with the three components loaded above
- [ ] The old `load_checkpoint()` call and its associated `ACE_COMFY_CHECKPOINT` constant are removed
- [ ] Typecheck / lint passes

### US-002: `/api/generate` endpoint continues to work
**As a** caller of the audio API, **I want** `POST /api/generate` to return a valid audio stream **so that** the pipeline change is transparent to the rest of the system.

**Acceptance Criteria:**
- [ ] `POST /api/generate` returns HTTP 200 with a valid audio stream when all three model env vars are set and model files are present
- [ ] Missing or misconfigured model env vars produce a clear `RuntimeError` on startup or at first request (before inference is attempted)
- [ ] Typecheck / lint passes

### US-003: Separate model paths are configurable via environment variables
**As an** operator, **I want** to specify each model file name via an environment variable **so that** I can point the backend to whichever model files I have downloaded.

**Acceptance Criteria:**
- [ ] `constants.py` exposes `ACE_COMFY_DIFFUSION_MODEL` (filename inside `diffusion_models/`)
- [ ] `constants.py` exposes `ACE_COMFY_TEXT_ENCODER` (filename inside `text_encoders/`)
- [ ] `constants.py` exposes `ACE_COMFY_VAE` (filename inside `vae/`)
- [ ] `ACE_COMFY_CHECKPOINT` is removed from `constants.py`
- [ ] `backend/.env.example` is updated to document the three new env vars and remove the checkpoint var
- [ ] Typecheck / lint passes

## Functional Requirements
- **FR-1:** Remove `ACE_COMFY_CHECKPOINT` from `constants.py` and `.env.example`; add `ACE_COMFY_DIFFUSION_MODEL`, `ACE_COMFY_TEXT_ENCODER`, and `ACE_COMFY_VAE`
- **FR-2:** In `audio_repository.py`, replace the `load_checkpoint()` call with sequential calls to `manager.load_unet()`, `manager.load_clip()`, and `manager.load_vae()` using the new constants
- **FR-3:** The pipeline cache (`_cached_pipeline`) continues to work — models are loaded once on first request and reused
- **FR-4:** If any required env var is empty, raise a `RuntimeError` with a descriptive message before attempting to load models

## Non-Goals (Out of Scope)
- No fallback to checkpoint mode — checkpoint support is removed entirely
- No UI changes of any kind
- No changes to audio generation parameters (steps, CFG, sampler, scheduler, trim)
- No changes to the ACEStep REST API flow or the `audio_service.py` orchestration layer

## Open Questions
- None
