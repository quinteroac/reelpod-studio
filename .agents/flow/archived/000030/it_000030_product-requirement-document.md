# Requirement: Video Upscaling with Real-ESRGAN (realesr-animevideov3)

## Context
The WAN I2V model generates video at low resolution (832×480 for 16:9, 480×832 for 9:16, 720×720 for 1:1). The current pipeline muxes these frames directly, applying only letterboxing to reach the target platform resolution (1920×1080, 1080×1920, 1080×1080). This results in upsampled frames that lack sharpness. Adding a Real-ESRGAN video upscaling step (4x) on the raw WAN clip before looping and muxing produces crisper output at the selected platform resolution. Pipeline: `WAN I2V → Real-ESRGAN 4x → Resize to target → Loop → Mux`.

## Goals
- Insert a frame-level 4x upscaling step using `realesr-animevideov3.pth` into the backend video pipeline, between the loop stage and the mux stage.
- Ensure the final MP4 matches the platform resolution selected by the user (YouTube 1920×1080, TikTok/Reels 1080×1920, Instagram 1080×1080).
- Auto-download the video upscale model weights on backend startup if not already present.

## User Stories

### US-001: Model weights downloaded on startup
**As a** backend process, **I want** to download `realesr-animevideov3.pth` at startup if the file is absent **so that** the video upscaling step has the model available without manual intervention.

**Acceptance Criteria:**
- [ ] On startup, the backend checks for `realesr-animevideov3.pth` under `backend/.realesrgan/` (or `REAL_ESRGAN_WEIGHTS_DIR` env var).
- [ ] If missing, it downloads from `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth`.
- [ ] Download is logged with progress indication (file size / completion).
- [ ] If the file already exists, no download occurs.
- [ ] If download fails, the backend logs an error but does NOT crash — video generation proceeds without upscaling (graceful degradation).
- [ ] Typecheck / lint passes.

### US-002: Video frames upscaled 4x after loop, before mux
**As a** backend pipeline, **I want** to upscale the looped video 4x with `realesr-animevideov3.pth` and resize the result to the target platform resolution **so that** the final MP4 has full-resolution frames matching the selected platform.

**Acceptance Criteria:**
- [ ] Pipeline order is: `WAN I2V → upscale 4x → resize to target → loop to audio duration → mux`.
- [ ] Upscaling uses `SRVGGNetCompact` architecture (not `RRDBNet`) with the `realesr-animevideov3.pth` weights.
- [ ] Input frames are upscaled 4x (e.g., 480×832 → 1920×3328).
- [ ] After upscaling, frames are resized (lanczos or area) to the exact target resolution (e.g., 1080×1920 for TikTok/Reels).
- [ ] Tile-based processing is used (tile=256, tile_pad=10) to manage VRAM.
- [ ] GPU (half precision) is used when available; fallback to CPU.
- [ ] If upscaling fails (model absent, OOM, etc.), the pipeline falls back to the pre-upscale video and logs a warning — no crash.
- [ ] Typecheck / lint passes.

### US-003: Final video plays at platform resolution in R3F canvas
**As an** end user, **I want** the generated video to play in the R3F canvas at the resolution matching my selected platform **so that** what I see reflects the true output quality.

**Acceptance Criteria:**
- [ ] The MP4 returned by `POST /api/generate` has width × height equal to the selected platform resolution (1920×1080, 1080×1920, or 1080×1080).
- [ ] `ffprobe` on the downloaded MP4 confirms the expected resolution.
- [ ] The video plays correctly in the R3F canvas `<VideoTexture>` without distortion or black bars.
- [ ] Visually verified in browser for each of the three platform presets.
- [ ] Typecheck / lint passes.

## Functional Requirements
- FR-1: Introduce `upscale_video_with_realesrgan_animevideo(input_path, output_path, target_width, target_height)` in `backend/repositories/media_repository.py` (or a new `upscale_repository.py`). It loads `SRVGGNetCompact` with `realesr-animevideov3.pth`, upscales all frames 4x, resizes to `(target_width, target_height)`, and writes the result as a video file.
- FR-2: Add `REAL_ESRGAN_VIDEO_WEIGHTS_FILENAME = "realesr-animevideov3.pth"` and `REAL_ESRGAN_VIDEO_WEIGHTS_URL` to `backend/models/constants.py`.
- FR-3: Add `_ensure_realesrgan_video_weights()` in the appropriate repository, following the same pattern as `_ensure_realesrgan_anime_weights()` in `image_repository.py`.
- FR-4: Call `_ensure_realesrgan_video_weights()` during backend startup (in `backend/main.py` lifespan or equivalent).
- FR-5: In `backend/services/video_service.py`, insert the upscale + resize step after WAN I2V generation and before `loop_video_to_duration()`. Final order: WAN I2V → upscale 4x → resize to target → loop → mux.
- FR-6: The mux step must NOT apply additional letterboxing if the video is already at target resolution.
- FR-7: Graceful fallback: if `upscale_video_with_realesrgan_animevideo` raises any exception, log a warning and continue with the pre-upscale looped video.

## Non-Goals (Out of Scope)
- No UI control to enable/disable upscaling — it is always on when the model is available.
- No upscaling of audio — only video frames are processed.
- No change to the image upscaling pipeline (images continue using `RealESRGAN_x4plus_anime_6B.pth` / `RRDBNet`).
- No support for upscale scales other than 4x.
- No batch/queue upscaling across multiple jobs simultaneously.

## Open Questions
- None
