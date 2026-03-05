# Requirement: Real-ESRGAN Anime Upscaling in Video Generation Pipeline

## Context

Anima generates images at native resolutions of ~1 MP (1024×1024, 896×1152, or 1152×896). When these are letterboxed or resized to target platform resolutions (e.g. 1920×1080 for YouTube, 1080×1920 for TikTok, 1080×1080 for Instagram), the result can appear soft or blurry due to the low source resolution. Inserting a Real-ESRGAN Anime 4× upscale step after generation and before resizing yields a much higher-quality source (~4096×4096) to downscale from, producing sharper final frames at any platform resolution.

## Goals

- Improve final MP4 image sharpness by upscaling the Anima-generated image 4× with `realesrgan-x4plus-anime` before fitting to the target resolution.
- Ensure the final video frame dimensions exactly match the selected platform resolution.
- Keep the change entirely within the existing generation pipeline — no new user-facing controls.

## User Stories

### US-001: Upscale Generated Image Before Muxing

**As an** end user generating a video, **I want** the image to be automatically upscaled using Real-ESRGAN Anime before it is resized and muxed, **so that** the final video has visibly sharper image quality at the target platform resolution.

**Acceptance Criteria:**
- [ ] After Anima generates the image, the backend runs `realesrgan-x4plus-anime` (4× scale) on the PNG before any resize/letterbox step.
- [ ] The upscaled image is then downscaled and letterboxed to exactly match `targetWidth × targetHeight` from the generation request.
- [ ] The final MP4 video frame dimensions exactly equal the requested platform resolution (e.g. 1920×1080, 1080×1920, or 1080×1080).
- [ ] The upscale step runs automatically — no new user action or UI control is required.
- [ ] Generation still completes successfully for all three platform presets (YouTube, TikTok/Reels, Instagram Square).
- [ ] Typecheck / lint passes.

### US-002: Graceful Fallback if Upscaler Fails

**As an** end user, **I want** video generation to still succeed (with a warning logged) if the upscale step fails, **so that** a model loading issue does not break the entire generation flow.

**Acceptance Criteria:**
- [ ] If Real-ESRGAN inference raises an exception, the backend logs the error and falls back to resizing the original Anima image directly.
- [ ] The API response is still a valid MP4; the HTTP status remains 200.
- [ ] Typecheck / lint passes.

## Functional Requirements

- FR-1: A new `upscale_repository` (or equivalent module) loads the `realesrgan-x4plus-anime` model and exposes a function `upscale_image(image: PIL.Image) -> PIL.Image` that returns the 4× upscaled image.
- FR-2: `image_service` calls `upscale_image` immediately after Anima generation and before the letterbox/resize step.
- FR-3: The letterbox/resize step (already implemented in `image_service`) receives the upscaled image and produces output at exactly `targetWidth × targetHeight`.
- FR-4: The `realesrgan-x4plus-anime` model weights are fetched or expected at a configurable path (env var or hardcoded default path under `backend/`).
- FR-5: If upscaling fails, the exception is caught, a warning is logged, and the pipeline continues with the original Anima image.
- FR-6: Model weights (`RealESRGAN_x4plus_anime_6B.pth`) are auto-downloaded to `backend/.realesrgan/` on first use if not already present.
- FR-7: The upscaler selects CUDA if `torch.cuda.is_available()`, otherwise falls back to CPU.
- FR-8: No changes to the API schema (`GenerateRequestBody`, response format) are required.
- FR-9: No frontend changes are required.

## Non-Goals (Out of Scope)

- User-controlled toggle to enable/disable upscaling.
- Configurable scale factor (always 4×).
- Upscaling user-uploaded images (no upload feature exists).
- Applying upscaling to audio or video effects.
- Any UI changes.

## ⚠️ CRITICAL CONSTRAINT — NON-NEGOTIABLE

The upscaling model **MUST** be `realesrgan-x4plus-anime`. No other model, variant, or substitute is permitted under any circumstance. Do not swap, alias, or fall back to a different model (e.g. `realesrgan-x4plus`, `swinir`, `ESRGAN`, or any other). If the model cannot be loaded, the implementation must fail loudly — do NOT silently substitute an alternative model.

---

## Decisions

- **Model weights:** Auto-downloaded on first run to `backend/.realesrgan/`. The repository checks for the file at startup or on first inference call and downloads it if absent.
- **Device:** CUDA if available, CPU fallback. The upscale repository detects `torch.cuda.is_available()` and selects the device accordingly.
