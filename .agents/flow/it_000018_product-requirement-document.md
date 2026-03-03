# Requirement: Unified Video Generation (Audio + Image → MP4)

## Context
Currently the generation flow produces audio and image as separate artifacts — the backend has two distinct endpoints (`POST /api/generate` for audio via ACE-Step, `POST /api/generate-image` for images via Diffusers/SDXL) and the frontend calls them in parallel, handling them as distinct elements (HTML5 `<audio>` + image plane in R3F canvas). This creates a fragmented experience and makes it harder for creators to get a ready-to-use video. The goal is to unify the pipeline so a single backend endpoint orchestrates both generation steps, merges the audio and image into an MP4 video file, and the frontend receives and displays that video directly in the canvas.

## Goals
- Eliminate the separate audio/image response in favor of a single MP4 video output
- Provide creators with a ready-to-consume video from a single Generate action
- Display the generated video inside the R3F canvas

## User Stories

### US-001: Backend combines audio and image into MP4 video
**As a** creator, **I want** the backend to generate audio and image and merge them into a single MP4 video file **so that** I get a ready-to-use video from one generation request.

**Acceptance Criteria:**
- [ ] A single backend endpoint orchestrates both audio generation (ACE-Step) and image generation (Diffusers) internally, producing both artifacts before muxing
- [ ] Given a successful generation request, the response is a valid MP4 file (verifiable by ffprobe) containing one H.264 video stream and one AAC audio stream
- [ ] The resulting MP4 has the same duration as the generated audio
- [ ] The endpoint returns the MP4 with `video/mp4` content type
- [ ] If audio or image generation fails, the endpoint returns an appropriate error response (4xx/5xx) with a JSON error body — no partial or corrupt MP4 is returned
- [ ] The endpoint responds within a reasonable timeout that accounts for both generation steps plus muxing
- [ ] Temporary intermediate files (audio, image) are cleaned up in a `finally` block, regardless of whether muxing succeeds or fails
- [ ] `ffmpeg-python` is added to `pyproject.toml` dependencies
- [ ] `ffmpeg` system binary with H.264 and AAC codec support is documented as a required system dependency
- [ ] Typecheck / lint passes

### US-002: Frontend receives and handles video response
**As a** creator, **I want** the frontend to receive the generated video as a single MP4 file **so that** I can interact with one unified media element instead of separate audio and image.

**Acceptance Criteria:**
- [ ] Frontend `POST /api/generate` (or new unified endpoint) call expects and handles a `video/mp4` response
- [ ] The frontend no longer calls the separate audio and image endpoints for the main generation flow
- [ ] A video object URL is created from the response blob and made available for playback
- [ ] Previous video blob URLs are revoked (`URL.revokeObjectURL`) before creating a new one to prevent memory leaks
- [ ] Typecheck / lint passes

### US-003: Display video in the R3F canvas
**As a** creator, **I want** to see the generated video playing inside the visual canvas **so that** I can preview my creation with visualizers and effects applied.

**Acceptance Criteria:**
- [ ] The MP4 video is rendered as a texture on the image plane inside the R3F `<Canvas>`
- [ ] Video plays back with audio (not muted)
- [ ] Playback controls (play, pause, seek) work with the video element
- [ ] Audio timing props (`audioCurrentTime`, `audioDuration`, `isPlaying`) are driven by the video element so visualizers/effects remain audio-reactive
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

## Functional Requirements
- FR-1: The backend must have `ffmpeg` available as a system dependency and use `ffmpeg-python` to produce MP4 (H.264 video + AAC audio) from the generated image and audio files
- FR-2: The unified endpoint must orchestrate audio generation (ACE-Step) and image generation (Diffusers) before muxing, and return a `StreamingResponse` (or equivalent) with content type `video/mp4`
- FR-3: The frontend must create an `HTMLVideoElement`, assign the blob URL, and use it as a `THREE.VideoTexture` for the R3F canvas image plane
- FR-4: All existing audio timing props (`audioCurrentTime`, `audioDuration`, `isPlaying`) must be sourced from the `HTMLVideoElement` instead of the `HTMLAudioElement`
- FR-5: The frontend must no longer call the separate `/api/generate` (audio) and `/api/generate-image` endpoints for the main generation flow

## Non-Goals (Out of Scope)
- Video download button or export-to-file functionality
- Multiple image frames or animated video track (only a single static image is used)
- Visualizer/effect selection UI
- Live streaming integration
- Video format options beyond MP4 (H.264 + AAC)
- Video resolution or quality settings
- Removing or modifying the async generation queue (`/api/generate-requests`) endpoints
- Removing the old `/api/generate` and `/api/generate-image` backend endpoints (they remain available but unused by the primary UI)
- Progress indicators or step-by-step status updates during the combined generation pipeline (existing loading UX is sufficient for MVP)

## Open Questions
- ~~What ffmpeg Python binding or subprocess approach should be used?~~ **Resolved:** Use `ffmpeg-python` library.
- ~~Should temporary files (intermediate audio/image before muxing) be cleaned up immediately or kept for debugging?~~ **Resolved:** Clean up immediately after muxing, using a `finally` block to ensure cleanup on failure.
