# Requirement: Seamless Video Loop via Wan First-Last-Frame Bridge

## Context
The current video pipeline generates a single Wan I2V clip and loops it to match the audio duration. Because the last frame of the clip doesn't match the first frame, the loop point has a visible jump. Adding a second "bridge" clip — generated with the frames inverted (last→start, first→end) — and concatenating both clips before the loop step produces a seamless ping-pong loop with no visible cut.

## Goals
- Produce a seamless video loop by generating a reverse bridge clip (clip 2) that transitions from the last frame of clip 1 back to its first frame.
- Keep the change transparent to the user: the pipeline runs automatically with no new controls.
- Apply Real-ESRGAN upscaling once on the concatenated clip (not per-clip) to avoid redundant GPU work.

## User Stories

Each story must be small enough to implement in one focused session.

### US-001: `wan_first_last_frame_to_video` helper in `wan_comfy_helpers.py`
**As a** backend pipeline, **I want** a helper that conditions the Wan I2V latent on both a start image and an end image **so that** the generated clip transitions smoothly from the start frame to the end frame.

**Acceptance Criteria:**
- [ ] New function `wan_first_last_frame_to_video(positive, negative, vae, width, height, length, batch_size, start_image, end_image, clip_vision_output=None)` added to `wan_comfy_helpers.py`.
- [ ] The function encodes `start_image` into the first latent position and `end_image` into the last latent position using the same 16ch @ 1/8 concat pattern as `wan_image_to_video`.
- [ ] The concat mask marks the first frame's latent region (`[:1]`) and the last frame's region as 0.0 (conditioned) and everything else as 1.0 (free to denoise).
- [ ] Existing `wan_image_to_video` behavior is unchanged.
- [ ] Unit test for the new helper verifies output shapes are consistent with a same-duration call to `wan_image_to_video`.
- [ ] Typecheck / lint passes.

### US-002: `run_bridge_inference` in `video_repository.py`
**As a** backend pipeline, **I want** a function that, given the path of clip 1, extracts its first and last frames, swaps them, and generates a bridge clip of the same duration **so that** the bridge animates from the last frame of clip 1 back to its first frame.

**Acceptance Criteria:**
- [ ] New function `run_bridge_inference(pipeline, clip1_path, prompt, target_width, target_height, temp_dir)` added to `video_repository.py`.
- [ ] Uses PyAV (`av`) to decode `clip1_path` and extract frame 0 (first frame) and the last frame as PIL images.
- [ ] Calls `run_video_inference`-equivalent logic using `wan_first_last_frame_to_video` with `start_image=last_frame`, `end_image=first_frame`.
- [ ] Output clip duration equals `WAN_VIDEO_CLIP_DURATION_SECONDS` (same as clip 1).
- [ ] Returns the `Path` to the saved bridge MP4.
- [ ] Typecheck / lint passes.

### US-003: Pipeline integration in `video_service.py`
**As a** backend pipeline, **I want** the video pipeline to automatically generate the bridge clip and concatenate it with clip 1 before upscaling **so that** the final looped video has a seamless transition at the loop point.

**Acceptance Criteria:**
- [ ] After `run_video_inference` produces `wan_clip_path`, `video_service.py` calls `run_bridge_inference` to produce `wan_bridge_clip_path`.
- [ ] Both clips are concatenated (clip 1 first, bridge second) into `wan_concat_clip_path` using a `media_repository` helper (`concatenate_videos` or equivalent ffmpeg concat).
- [ ] Real-ESRGAN upscaling is applied to `wan_concat_clip_path` (not to individual clips).
- [ ] If `run_bridge_inference` raises any exception, the pipeline logs a warning and falls back to `wan_clip_path` alone (same behavior as the current upscale fallback).
- [ ] `VIDEO_GENERATION_TIMEOUT_SECONDS` in `models/constants.py` is increased to account for the second Wan inference (e.g. from 1800s to 3600s).
- [ ] Pipeline logs include: bridge clip generation start/end, concatenation start/end, each with file sizes.
- [ ] Backend test in `backend/test_orchestration_service.py` or `backend/test_api_contract.py` is updated/added to cover the bridge step being called and the fallback path.
- [ ] Typecheck / lint passes.

## Functional Requirements
- FR-1: `wan_first_last_frame_to_video` must accept both a `start_image` and an `end_image` tensor and inject both into the latent conditioning, conditioning the last temporal latent position for the end image.
- FR-2: `run_bridge_inference` must extract video frames using PyAV (already a project dependency) and reuse the two-stage sampling already in `run_video_inference`.
- FR-3: Clip concatenation must be done at the raw video level (no re-encode) using ffmpeg concat demuxer or PyAV stream copy to preserve quality.
- FR-4: Upscaling with Real-ESRGAN is applied once to the concatenated clip; the per-clip upscale is removed from the individual clip steps.
- FR-5: `VIDEO_GENERATION_TIMEOUT_SECONDS` must be raised to at least 3600s (60 min) to accommodate two Wan inference passes.
- FR-6: If bridge generation fails, the pipeline must not raise; it must log a warning and continue with clip 1 only.

## Non-Goals (Out of Scope)
- UI controls to enable/disable the seamless loop feature.
- Per-clip upscaling or independent export of clip 1 and clip 2.
- Using a different duration for the bridge clip than `WAN_VIDEO_CLIP_DURATION_SECONDS`.
- Changing the audio generation or image generation steps.
- SeedVR or any other upscaler beyond Real-ESRGAN.

## Open Questions
- None
