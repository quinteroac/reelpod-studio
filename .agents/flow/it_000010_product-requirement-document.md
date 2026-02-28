# Requirement: Replace Image Upload with AI Image Generation (Anima Model)

## Context
The lofi-maker currently allows users to upload an image (JPEG, PNG, WebP) that is displayed as the visual background behind audio visualizers. This requires users to find and provide their own images. By replacing the upload flow with AI image generation using the [Anima model](https://huggingface.co/circlestone-labs/Anima) via the `diffusers` library, users can type a text prompt and generate a custom background image on-demand, creating a more seamless and creative experience.

## Goals
- Replace the existing image upload UI with a text prompt input and "Generate" button
- Add a `/api/generate-image` endpoint to the FastAPI backend that runs inference with the Anima model via `diffusers`
- Display the generated image as the visual background (same role the uploaded image currently fills)
- Provide loading feedback while the model generates the image
- Allow re-generation with a different prompt without reloading the page

## User Stories

### US-001: Generate background image from text prompt
**As a** lofi-maker user, **I want** to type an image prompt and click a generate button **so that** an AI-generated image appears as my visual background.

**Acceptance Criteria:**
- [ ] The image upload file input is removed from the UI
- [ ] A text input field for the image prompt is displayed in its place
- [ ] A "Generate Image" button triggers image generation
- [ ] The generated image is displayed as the visual background (same plane/texture used by visualizers)
- [ ] All existing visualizer animations and post-processing effects work with the generated image exactly as they do with an uploaded image
- [ ] The image is rendered correctly with proper aspect-ratio scaling (existing `computeContainScale` logic)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-002: Loading indicator during image generation
**As a** user, **I want** to see a loading indicator while the image is being generated **so that** I know the system is working and haven't encountered an error.

**Acceptance Criteria:**
- [ ] A loading/spinner indicator is shown while the `/api/generate-image` request is in progress
- [ ] The generate button is disabled during generation to prevent duplicate requests
- [ ] The loading indicator disappears once the image is ready or an error occurs
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-003: Re-generate image with new prompt
**As a** user, **I want** to change my prompt and generate a new image without reloading the page **so that** I can experiment with different visual styles.

**Acceptance Criteria:**
- [ ] After an image is generated, the prompt input remains editable
- [ ] Clicking "Generate Image" again with a new prompt replaces the current background with the newly generated image
- [ ] The previous image blob URL is properly cleaned up (no memory leaks)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-004: Backend image generation endpoint
**As a** frontend client, **I want** a `POST /api/generate-image` endpoint **so that** I can send a text prompt and receive a generated image.

**Acceptance Criteria:**
- [ ] `POST /api/generate-image` accepts a JSON body with a `prompt` field (string)
- [ ] The endpoint loads the `circlestone-labs/Anima` model using the `diffusers` library
- [ ] The model is loaded once at application startup (same pattern as ACEStep)
- [ ] The generated image resolution is 1024×1024
- [ ] The endpoint returns the generated image as a binary response with appropriate content type (e.g., `image/png`)
- [ ] If the model is not available or inference fails, the endpoint returns a meaningful error response (HTTP 500 with error message)
- [ ] The Vite dev proxy forwards `/api/generate-image` to the backend (port 8000)

### US-005: Error handling for image generation
**As a** user, **I want** to see a clear error message if image generation fails **so that** I understand what went wrong.

**Acceptance Criteria:**
- [ ] If the backend returns an error, an error message is displayed in the UI near the prompt input
- [ ] The error message is cleared when the user submits a new generation request
- [ ] The generate button is re-enabled after an error so the user can retry
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

## Functional Requirements
- FR-1: Remove the image upload file input (`<input type="file">`) and related validation logic (`SUPPORTED_IMAGE_TYPES`, `handleVisualUpload`) from `App.tsx`
- FR-2: Add a text input field for the image prompt and a "Generate Image" button to the UI in `App.tsx`
- FR-3: Add a `POST /api/generate-image` endpoint in `backend/main.py` that accepts `{ "prompt": string }` and returns a generated image as binary (`image/png`)
- FR-4: Load the `circlestone-labs/Anima` model at FastAPI startup using `diffusers`, following the same startup-loading pattern used for ACEStep
- FR-5: Add `diffusers`, `torch`, `transformers`, and `accelerate` to `pyproject.toml`
- FR-6: The frontend sends a `POST` request to `/api/generate-image` with the prompt, receives the image blob, creates a blob URL via `URL.createObjectURL()`, and passes it to `VisualScene` as `imageUrl`
- FR-7: Show a loading indicator and disable the generate button while the request is in flight
- FR-8: Display user-visible error messages for generation failures (network errors, non-OK responses, inference errors)
- FR-9: Clean up previous blob URLs via `URL.revokeObjectURL()` before setting a new one (existing pattern)
- FR-10: Ensure the Vite dev proxy configuration forwards `/api/generate-image` to the backend
- FR-11: The generated image must be passed through the same rendering pipeline as uploaded images, so all visualizer animations and post-processing effects (e.g., rain, glitch, bloom) apply identically

## Non-Goals (Out of Scope)
- Image editing or inpainting capabilities
- Saving/persisting generated images across sessions
- Image generation parameter controls (steps, guidance scale, seed) — use model defaults
- Keeping the image upload as a fallback option alongside generation
- Batch generation (multiple images at once)
- Image generation queue or progress percentage reporting

## Open Questions
_None — all resolved._

## Resolved Questions
- **Image resolution:** Generate at 1024×1024.
- **Backend dependencies:** `torch`, `transformers`, `accelerate`, and `diffusers` need to be added to `pyproject.toml`.
