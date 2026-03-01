# Requirement: Unified Music + Image Generation with Social Format Support

## Context
Currently, ReelPod Studio generates music via ACEStep and requires the user to upload a separate image. There is no duration control, no aspect ratio/format selection, and no way to generate images from within the app. This iteration introduces a unified generation flow where a single "Generate" action produces a paired audio track + image, with duration control, social format/aspect ratio selection, an upscale/refiner step, and an optional shared-prompt mode.

## Goals
- Allow creators to produce a complete audio-visual pair (track + image) in a single action.
- Give creators control over output duration and social media format (aspect ratio + resolution).
- Ensure each generated track is permanently bound to its generated image so playback always shows the correct visual.
- Provide an optional shared-prompt toggle so music and image prompts can be linked or kept independent.

---

## User Stories

### US-001: Set Generation Duration
**As a** content creator, **I want** to specify the desired duration before generating **so that** the produced audio matches my target platform's length requirements.

**Acceptance Criteria:**
- [ ] A duration input (numeric, in seconds) is visible in the generation parameters UI.
- [ ] The generated audio length matches the specified duration (within ±2 s tolerance).
- [ ] Duration field defaults to 40 s and is labeled "Duration (s)".
- [ ] Duration field enforces a minimum of 40 s and a maximum of 300 s; values outside this range are rejected with a validation message.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-002: Select Aspect Ratio / Social Format
**As a** content creator, **I want** to pick a social media format before generating **so that** the output image is sized and shaped for my target platform.

**Acceptance Criteria:**
- [ ] A format selector offers at minimum three presets: YouTube (16:9 · 1920×1080), TikTok/Reels (9:16 · 1080×1920), Instagram Square (1:1 · 1080×1080).
- [ ] The selected format determines the target resolution sent to the image generation + upscale step.
- [ ] The R3F Canvas / VisualScene viewport reflects the selected aspect ratio.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-003: Generate Music and Image in One Action
**As a** content creator, **I want** a single "Generate" button to trigger both music and image generation **so that** I receive a cohesive audio-visual pair without separate steps.

**Acceptance Criteria:**
- [ ] Clicking "Generate" triggers music generation (ACEStep) and image generation as a unified action.
- [ ] The Generate button remains enabled during active generation. Each submitted generation request appears immediately in the Queue panel with status "Queued". While being processed, its status updates to "Generating" with a loading indicator. On completion, status updates to "Completed" and the paired audio is ready for playback. On failure, status updates to "Failed" with a descriptive error message shown in the Queue panel entry.
- [ ] On completion, the paired image appears in the visual scene and the audio is ready for playback.
- [ ] If either generation fails, a descriptive error message is shown and the pair is not committed to the session.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-004: Upscale / Refine Generated Image to Target Resolution
**As a** content creator, **I want** the generated image to be automatically upscaled/refined to the selected social format resolution **so that** I get a high-quality image ready for upload.

**Acceptance Criteria:**
- [ ] After initial image generation, a refiner/upscale pass is applied if needed before the image is displayed.
- [ ] The final image resolution matches the target of the selected social format.
- [ ] The final image respects the correct aspect ratio (no distortion, no black bars).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-005: Shared Prompt Toggle for Music and Image
**As a** content creator, **I want** the option to share the same text prompt for both music and image generation **so that** both outputs are thematically aligned without re-entering the same text.

**Acceptance Criteria:**
- [ ] By default, music and image prompts are independent input fields.
- [ ] A visible toggle/checkbox labeled "Use same prompt for image" is available.
- [ ] When the toggle is enabled, the image prompt field is hidden/disabled and the music prompt value is used for both.
- [ ] When the toggle is disabled, the image prompt field is restored with the value it held before the toggle was enabled (if the field was empty before enabling, it is restored as empty).
- [ ] This toggle works for both the text-only and text+parameters generation modes.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-006: Track + Image Pair Binding and Playback Switching
**As a** content creator, **I want** each generated track to be permanently bound to its generated image **so that** the correct image is always displayed when I play any specific track.

**Acceptance Criteria:**
- [ ] Each "Generate" action creates a numbered pair (Track 1 → Image 1, Track 2 → Image 2, etc.).
- [ ] When Track 1 is playing, Image 1 is displayed in the visual scene.
- [ ] When Track 2 is playing, Image 2 is displayed in the visual scene.
- [ ] Switching from one track to another while audio is playing immediately updates the displayed image without a page reload.
- [ ] Previously generated pairs are preserved in the session (generating a new pair does not overwrite existing ones).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

## Functional Requirements

- **FR-1:** The generation UI must expose a numeric duration field (seconds). Default: 40 s. Allowed range: 40 s – 300 s; values outside this range must be rejected with a validation message.
- **FR-2:** A social format selector must offer three presets: YouTube 16:9 (1920×1080), TikTok/Reels 9:16 (1080×1920), Instagram 1:1 (1080×1080). The selected format is passed to both image generation and the R3F Canvas.
- **FR-3:** A single "Generate" action must orchestrate sequentially: (a) image generation at or toward the target resolution using the image/music prompt and selected format, (b) a refiner/upscale pass if needed to reach the target resolution, (c) music generation via ACEStep — all before committing the pair to session state.
- **FR-4:** Each generated pair must be stored in session state with a sequential index, the audio URL/blob, the image URL/blob, and the metadata used (duration, format, prompt(s)). When the total cumulative audio duration of all stored pairs exceeds 7,200 s (2 hours), the oldest pair(s) must be evicted until the total is within the limit. Eviction must occur immediately before committing the new pair to session state, so the session never holds more than 7,200 s of cumulative audio. The user must not receive any notification of eviction — it is silent.
- **FR-5:** The final image must match the pixel dimensions of the selected social format target resolution. If the refiner/upscale output exceeds the target resolution, a downscale step must be applied maintaining aspect ratio before displaying the image.
- **FR-6:** The `VisualScene` component must accept the active pair's image as its source and update whenever the active track index changes.
- **FR-7:** A "Use same prompt for image" toggle must synchronise the image prompt with the music prompt when active; the prompts are independent when inactive.
- **FR-8:** The R3F Canvas must adapt its viewport aspect ratio dynamically to reflect the selected social format.

---

## Non-Goals (Out of Scope)

- Video export / rendering the output to a downloadable video file.
- Batch generation of multiple pairs in a single click.
- Persistent storage across browser sessions (no localStorage or database).
- Regenerating only one half of a pair (track-only or image-only regeneration).
- Custom resolution input — only the three predefined social format presets.
- Real-time image updates during audio playback (the image is static per pair).
- Preserving or migrating the existing manual image upload workflow — this iteration replaces it with generated images; the upload UI is removed as part of this change.
- Notifying the user when old pairs are evicted from the session.

---

## Open Questions

- **OQ-1:** ~~Which image generation model/API will be used for the initial image generation step?~~ **Resolved:** Use the existing image generation model/API already in the app — no change required.
- **OQ-2:** ~~Which upscale/refiner model/API will be used?~~ **Resolved:** The upscale strategy is flexible — Illustrious second-pass inference or an external upscaler may be used. The implementation must ensure the final image matches the target resolution (FR-5).
- **OQ-3:** ~~Sequential or parallel generation?~~ **Resolved:** Sequential — image generation (+ upscale if needed) runs first, then music generation.
- **OQ-4:** ~~Minimum and maximum allowed duration values?~~ **Resolved:** Minimum 40 s, maximum 300 s.
- **OQ-5:** ~~Maximum number of track+image pairs per session?~~ **Resolved:** No fixed pair count limit; oldest pairs are evicted once the total cumulative audio duration in the session exceeds 2 hours (7,200 s).
