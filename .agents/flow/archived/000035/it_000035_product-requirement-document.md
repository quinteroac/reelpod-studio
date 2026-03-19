# Requirement: SEO-Friendly YouTube Title and Description on Upload

## Context
When a video is published to YouTube, the title is currently derived from the MP4 filename
(underscores intact, extension stripped). There is no description. This produces titles like
`lofi_chill_vibes_2026-03-18T16-30` instead of something a human would search for.
The goal is to have the LLM generate a human-readable, SEO-optimised YouTube title and a
structured description that includes the song concept, generation parameters, and an AI-model
credit block read from a static YAML file in the backend.

## Goals
- YouTube videos uploaded from ReelPod Studio have a polished, search-friendly title.
- Descriptions include the song concept, mood/genre, and transparent AI model attribution.
- Users can review and edit the title and description before confirming the upload.
- Model credits are maintained in a single YAML file — easy to update without touching code.

## User Stories

### US-001: LLM generates a YouTube title and description during orchestration
**As a** creator, **I want** the orchestration LLM to produce a YouTube-optimised title and
description for my track **so that** I don't have to write metadata manually before publishing.

**Acceptance Criteria:**
- [ ] `OrchestrationResult` gains two new fields: `youtube_title` (max 100 chars) and
  `youtube_description` (max 4 900 chars, leaving room for the model-credits footer).
- [ ] The `CREATIVE_DIRECTOR_SYSTEM_PROMPT` is updated to instruct the LLM to return these
  two extra keys alongside the existing ones.
- [ ] `youtube_title` is a human-readable string with no underscores and no file-extension
  artifacts (e.g. "Midnight Rain — Lo-fi Chill Beat").
- [ ] `youtube_description` contains a short paragraph describing the song concept, mood, and
  genre. It must NOT duplicate the credits block (which is appended separately).
- [ ] Both fields are validated by Pydantic (non-empty, within length limits).
- [ ] Existing fields (`song_title`, `audio_prompt`, `image_prompt`, `video_prompt`) are
  unaffected.
- [ ] Backend unit tests cover valid output and the case where the LLM omits these keys.
- [ ] Typecheck / lint passes.

---

### US-002: Backend exposes a model-credits YAML and appends it to the description
**As a** developer, **I want** model credits defined in a plain YAML file **so that** I can
update the model list without touching Python or TypeScript code.

**Acceptance Criteria:**
- [ ] A new file `backend/config/model_credits.yaml` exists with at least the following
  structure (values are examples, real names to be confirmed):
  ```yaml
  models:
    - role: Music
      name: ACE Step
    - role: Image
      name: Anima Preview
    - role: Orchestration
      name: Qwen 3 0.6B
  footer: "🎵 AI-generated with ReelPod Studio"
  ```
- [ ] A backend helper reads this file at startup (or lazily) and exposes a function
  `build_credits_block() -> str` that returns a formatted string, e.g.:
  ```
  🎵 AI-generated with ReelPod Studio
  Models used:
  • Music: ACE Step
  • Image: Anima Preview
  • Orchestration: Qwen 3 0.6B
  ```
- [ ] The `/api/generate` response (or a new `/api/youtube-metadata` endpoint) returns both
  `youtube_title` and the full `youtube_description` (LLM description + credits block).
- [ ] If the YAML file is missing or malformed, a clear startup warning is logged and
  `build_credits_block()` returns an empty string (graceful degradation).
- [ ] Backend unit tests cover: valid YAML, missing file, malformed YAML.
- [ ] Typecheck / lint passes.

---

### US-003: Queue entries carry YouTube metadata to the frontend
**As a** creator, **I want** the generated YouTube title and description to be available in
the recording queue **so that** they can be shown in the preview dialog.

**Acceptance Criteria:**
- [ ] The `QueueEntry` type in `App.tsx` gains optional fields `youtubeTitle: string | null`
  and `youtubeDescription: string | null`.
- [ ] When the backend returns `youtube_title` / `youtube_description` (via the
  `x-youtube-title` and `x-youtube-description` response headers, or JSON body — to be
  decided in implementation), `App.tsx` stores them on the queue entry.
- [ ] Existing queue entries where orchestration was not used (manual params, no LLM) have
  these fields as `null`.
- [ ] Typecheck / lint passes.

---

### US-004: Preview/edit dialog before YouTube publish
**As a** creator, **I want** to review and optionally edit the YouTube title and description
before the video is uploaded **so that** I can correct any LLM mistakes.

**Acceptance Criteria:**
- [ ] Clicking the "Publish to YouTube" button for a queue entry opens a modal dialog (not a
  new page) containing:
  - A text input pre-filled with `youtubeTitle` (or the filename-derived title if null).
  - A `<textarea>` pre-filled with `youtubeDescription` (or empty if null).
- [ ] The dialog has a **Cancel** button (closes without uploading) and a **Publish** button
  (proceeds with the current field values).
- [ ] Field values edited by the user are sent verbatim to `uploadVideoToYouTube` — no
  further LLM processing after user confirmation.
- [ ] If `youtubeTitle` is empty in the dialog, the Publish button is disabled with a visible
  tooltip or helper text ("Title is required").
- [ ] Visually verified in browser: dialog opens, pre-fills correctly, edits are preserved on
  submit.
- [ ] Typecheck / lint passes.

---

### US-005: `publish_to_youtube` MCP tool uses the generated metadata
**As an** automated agent, **I want** the `publish_to_youtube` MCP tool to default to the
LLM-generated title and description **so that** publishing via MCP is also SEO-friendly
without manual arguments.

**Acceptance Criteria:**
- [ ] When `title` and `description` are omitted from the MCP call, the tool reads
  `youtubeTitle` and `youtubeDescription` from the most-recently-completed queue entry and
  uses them as the upload metadata.
- [ ] When `title` or `description` are explicitly passed, those values take precedence
  (existing behaviour preserved).
- [ ] If no metadata is available (null), the tool falls back to the filename-derived title
  and an empty description (current behaviour).
- [ ] Typecheck / lint passes.

---

## Functional Requirements
- FR-1: `OrchestrationResult` must include `youtube_title` and `youtube_description` fields
  generated by the LLM.
- FR-2: A `backend/config/model_credits.yaml` file defines model roles, names, and a footer
  string used to build the credits block appended to every YouTube description.
- FR-3: `build_credits_block()` reads the YAML and returns a formatted plain-text string;
  gracefully returns empty string on error.
- FR-4: The backend returns `youtube_title` and `youtube_description` to the frontend as part
  of the generate response (mechanism: response headers or JSON body — see Open Questions).
- FR-5: `QueueEntry` stores `youtubeTitle` and `youtubeDescription` for each completed entry.
- FR-6: A preview/edit modal in the UI lets the user review and optionally modify title and
  description before confirming YouTube upload.
- FR-7: `uploadVideoToYouTube` sends the final (possibly user-edited) `snippet.description`
  field in the YouTube API multipart metadata, in addition to `snippet.title`.
- FR-8: The `publish_to_youtube` MCP tool defaults to queue-entry metadata when no arguments
  are provided.

## Non-Goals (Out of Scope)
- Auto-selecting YouTube tags/keywords (separate feature).
- Generating a custom thumbnail (separate feature).
- Storing or versioning historical YouTube metadata.
- Localisation / multi-language title or description generation.
- Automatic re-upload or title update after a video is already published.

## Open Questions
- ~~Should `youtube_title` and `youtube_description` be returned as HTTP response headers
  or a sidecar endpoint?~~ **Resolved:** Use response headers `x-youtube-title` and
  `x-youtube-description`, percent-encoded (consistent with `x-song-title`). Decode with
  `decodeURIComponent` on the frontend and `urllib.parse.quote` on the backend.
- ~~What are the exact model names for `model_credits.yaml`?~~ **Resolved:** Use
  `Music: ACE Step`, `Image: Anima Preview`, `Orchestration: Qwen 3 0.6B`.
