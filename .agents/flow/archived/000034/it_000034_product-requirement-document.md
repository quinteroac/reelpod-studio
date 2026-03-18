# Requirement: LLM-Generated Song Title

## Context
The LLM orchestration pipeline already generates `audio_prompt`, `image_prompt`, and `video_prompt` from a user's creative brief. There is no song title in the pipeline — recordings are named with a generic timestamp (`recording-<timestamp>.mp4`). Creators need a meaningful title so they can identify their tracks and so exported files have descriptive filenames.

## Goals
- The LLM generates a concise, creative song title alongside the existing prompts in a single inference call.
- The title is surfaced in the UI so the creator can see it immediately after generation.
- The sanitized title is used as the MP4 recording filename (replacing the timestamp-based name).

## User Stories

### US-001: LLM generates a song title as part of orchestration
**As a** creator using LLM mode, **I want** the AI to produce a song title together with the audio/image/video prompts **so that** I don't have to name my track manually.

**Acceptance Criteria:**
- [ ] `CREATIVE_DIRECTOR_SYSTEM_PROMPT` instructs the LLM to include a `song_title` key in its JSON output — a short, evocative name (max 60 characters, no special characters except spaces, hyphens, and apostrophes).
- [ ] `OrchestrationResult` Pydantic model gains a `song_title: str` field with `min_length=1, max_length=60`.
- [ ] A `_strip_text` validator strips leading/trailing whitespace from `song_title`.
- [ ] The `orchestrate()` function returns the `song_title` in its result.
- [ ] If the LLM omits `song_title` or it fails validation, the existing retry logic attempts again (consistent with current `JSON_PARSE_RETRIES` behaviour); on persistent failure the error surfaces as `OrchestrationFailedError`.
- [ ] Typecheck / lint passes.

### US-002: Song title is displayed in the UI after generation completes
**As a** creator, **I want** to see the generated song title displayed in the UI **so that** I know what my track is called.

**Acceptance Criteria:**
- [ ] The backend propagates `song_title` from `OrchestrationResult` through to the API response (or queue entry metadata) accessible to the frontend.
- [ ] After a generation completes, the queue entry (or a dedicated label near the player) shows the song title as plain text.
- [ ] The displayed text is the raw title (e.g. "Midnight Rain Lofi") — not the sanitized filename version.
- [ ] If the generation used `text` mode (no LLM), no title is shown (field is absent/null).
- [ ] Visually verified in browser.
- [ ] Typecheck / lint passes.

### US-003: Song title is used as the MP4 recording filename
**As a** creator, **I want** the exported MP4 to be named after the generated song title **so that** my files are easy to identify without renaming them.

**Acceptance Criteria:**
- [ ] Before using the title as a filename, it is sanitized: lowercased, spaces replaced with underscores, characters outside `[a-z0-9_-]` removed, and the result trimmed to a reasonable length (max 80 chars).
- [ ] The recording filename becomes `<sanitized_title><fileExtension>` (e.g. `midnight_rain_lofi.mp4`).
- [ ] If no song title is available (text mode, or title is empty after sanitization), the existing fallback `recording-<timestamp><fileExtension>` is used.
- [ ] The download anchor (`download` attribute) and the displayed filename in the recording queue both reflect the new name.
- [ ] Typecheck / lint passes.

## Functional Requirements
- FR-1: Add `song_title` to `CREATIVE_DIRECTOR_SYSTEM_PROMPT` as a required JSON key with explicit constraints (max 60 chars, no special chars except spaces, hyphens, apostrophes).
- FR-2: Add `song_title: str` field to `OrchestrationResult` with Pydantic validation (`min_length=1`, `max_length=60`, `_strip_text` validator).
- FR-3: Propagate `song_title` from `OrchestrationResult` through the backend pipeline to the frontend (via API response payload or queue entry metadata).
- FR-4: Frontend stores `song_title` per queue entry in the generation queue state.
- FR-5: Frontend displays `song_title` per completed queue entry in the UI.
- FR-6: A pure `sanitizeTitle(title: string): string` utility function implements the filename sanitization rule: lowercase → replace spaces with `_` → strip non-`[a-z0-9_-]` characters → trim to 80 chars.
- FR-7: The `onFinalized` callback in `use-recorder.ts` (or its call-site in `App.tsx`) accepts an optional `songTitle` parameter and applies `sanitizeTitle` to derive the filename; falls back to timestamp name when `songTitle` is absent or sanitizes to an empty string.

## Non-Goals (Out of Scope)
- Allowing the user to manually edit or override the generated title in the UI.
- Persisting or indexing song titles in a database.
- Generating titles in text mode (no LLM).
- Displaying the title in the file manager or OS metadata (ID3 tags, MP4 metadata atoms).

## Open Questions
- None
