# Requirement: Replace Image Generation Model with DiffSynth Anima

## CRITICAL CONSTRAINT
**DiffSynth-Studio and the Anima model (`circlestone-labs/Anima`) are non-negotiable and MUST NOT be changed, replaced, or substituted with any other library or model. All implementation must use `diffsynth.pipelines.anima_image.AnimaImagePipeline` exactly as specified.**

## Context
The current image generation backend uses HuggingFace's WAI-Illustrious SDXL model (`Ine007/waiIllustriousSDXL_v160`) via the `diffusers` library. This iteration replaces it with the DiffSynth Anima model (`circlestone-labs/Anima`) using the `diffsynth-studio` library, which produces higher-quality anime-style artwork with low-VRAM optimizations (disk offloading, bfloat16 computation).

Reference implementation: https://github.com/modelscope/DiffSynth-Studio/blob/main/examples/anima/model_inference_low_vram/anima-preview.py

## Goals
- Replace the image generation model without changing any public API contracts
- Use DiffSynth Anima's low-VRAM configuration for efficient GPU memory usage
- Maintain full integration with the video generation pipeline

## User Stories

### US-001: Replace model loading with DiffSynth Anima pipeline
**As a** backend service, **I want** to load the DiffSynth Anima model at startup **so that** image generation uses the new model.

**Acceptance Criteria:**
- [ ] `backend/repositories/image_repository.py` uses `diffsynth.pipelines.anima_image.AnimaImagePipeline` instead of `diffusers.DiffusionPipeline`
- [ ] Pipeline is initialized with three `ModelConfig` entries (diffusion model, text encoder, VAE) pointing to `circlestone-labs/Anima`
- [ ] Tokenizer configs use `Qwen/Qwen3-0.6B` and `stabilityai/stable-diffusion-3.5-large` tokenizer_3
- [ ] Low-VRAM config is applied: disk offloading, `torch.bfloat16` computation dtype, CUDA computation device
- [ ] VRAM limit is calculated dynamically from available GPU memory (`torch.cuda.mem_get_info`)
- [ ] `backend/models/constants.py` is updated with new model identifiers and default inference steps (50)
- [ ] Backend starts successfully and logs model loading completion
- [ ] Typecheck / lint passes

### US-002: Replace inference call with Anima pipeline
**As a** backend service, **I want** to run inference using the Anima pipeline API **so that** image generation produces output from the new model.

**Acceptance Criteria:**
- [ ] `run_image_inference()` in `image_repository.py` calls `pipe(prompt, seed=N, num_inference_steps=50)` using the Anima API
- [ ] Negative prompt support is included (Anima supports `negative_prompt` or it is passed appropriately)
- [ ] The old CLIP token truncation logic (`_truncate_prompt_to_token_limit`) is removed or adapted for the new tokenizer (Qwen-based, not CLIP)
- [ ] Output is a PIL Image that is converted to PNG bytes as before
- [ ] `/api/generate-image` returns a valid PNG for a test prompt
- [ ] Typecheck / lint passes

### US-003: Update Python dependencies
**As a** developer, **I want** the project dependencies updated **so that** the DiffSynth library is available and unused HuggingFace dependencies are removed.

**Acceptance Criteria:**
- [ ] `diffsynth-studio` is added to `requirements.txt` (or equivalent dependency file)
- [ ] `diffusers` and `transformers` are removed from dependencies (if no longer used elsewhere)
- [ ] `pip install -r requirements.txt` succeeds cleanly
- [ ] Typecheck / lint passes

### US-004: Verify video generation pipeline integration
**As a** backend service, **I want** the video generation pipeline to continue working with the new image model **so that** `/api/generate` still produces MP4 videos with generated images.

**Acceptance Criteria:**
- [ ] `video_service.py` calls `image_service.generate_image_png()` without changes to its interface
- [ ] `/api/generate` returns a valid MP4 containing an Anima-generated image muxed with audio
- [ ] The image prompt flow (user-provided or auto-generated from mood/style) still works
- [ ] No changes needed to `GenerateImageRequestBody` schema or API routes

## Functional Requirements
- FR-1: The `AnimaImagePipeline` must be loaded once at startup via `image_service.startup()` and reused for all requests
- FR-2: VRAM configuration must use disk offloading with `torch.bfloat16` computation on CUDA, matching the reference low-VRAM script
- FR-3: Dynamic VRAM limit must be calculated as `torch.cuda.mem_get_info("cuda")[1] / (1024 ** 3) - 0.5`
- FR-4: Default inference steps must be 50 (Anima's recommended value, up from 25 for WAI-Illustrious)
- FR-5: The `/api/generate-image` endpoint contract (request schema, PNG response) must remain unchanged
- FR-6: The `image_service.generate_image_png()` interface must remain unchanged so `video_service` requires no modifications
- FR-7: SDXL-specific size optimization logic (`get_optimal_sdxl_size`, valid SDXL sizes list) should be reviewed and adapted or removed if Anima supports different resolutions

## Non-Goals (Out of Scope)
- CPU fallback support (CUDA-only for this iteration)
- Changing the frontend image prompt UI or API schema
- Adding new image generation parameters to the API (e.g., negative prompt exposed to users)
- Performance benchmarking or optimization beyond the reference low-VRAM config
- Updating frontend components or MCP server tooling

## Open Questions
All resolved:
- **Resolution strategy:** Keep the SDXL size optimization logic as-is (assume similar resolution constraints apply to Anima).
- **Negative prompt:** Hardcode a default negative prompt: `"worst quality, low quality, monochrome, zombie, interlocked fingers"`.
- **Seed strategy:** Random seed per request (non-deterministic, varied outputs).
