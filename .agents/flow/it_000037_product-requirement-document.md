# Requirement: Video Generation Persistence with Playlists

## Context
Currently, completed video recordings exist only as in-memory blobs in the browser's recording queue (`recording-queue.tsx`). They are lost on page reload and cannot be organised. This iteration replaces the ephemeral queue with a persistent playlist system: every completed recording is uploaded to the backend, stored on disk, and associated with a named playlist. The concept of "queue" and "playlist" are unified — the recording queue *is* the playlist.

## Goals
- Persist completed video recordings across browser sessions by storing them on the backend filesystem.
- Allow users to organise recordings into named playlists.
- Replace the ephemeral recording queue with a playlist-aware UI backed by the server.

## User Stories

### US-001: Default playlist auto-created on first launch
**As a** creator, **I want** a default playlist to exist when I open the app for the first time **so that** I don't have to set anything up before my first recording is saved.

**Acceptance Criteria:**
- [ ] On `GET /api/playlists`, if no playlists exist on disk, the backend creates and returns a default playlist named `"My Playlist"` with a generated UUID.
- [ ] The default playlist is persisted to `playlists.json` so it survives a server restart.
- [ ] The frontend displays the default playlist name in the playlist header on load.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-002: Completed recording auto-uploaded to active playlist
**As a** creator, **I want** each completed recording to be automatically uploaded and attached to the active playlist **so that** I never lose a generated video.

**Acceptance Criteria:**
- [ ] When a recording finalises in `use-recorder.ts`, the frontend immediately posts the MP4 blob to `POST /api/playlists/{id}/tracks` (where `{id}` is the active playlist ID).
- [ ] The backend saves the file under `backend/recordings/{playlist_id}/{track_id}.mp4` and appends the track metadata (id, filename, created_at, size_bytes) to `playlists.json`.
- [ ] The new track appears in the playlist UI without requiring a page reload.
- [ ] Upload errors are surfaced as a visible error message to the user.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-003: User can rename a playlist
**As a** creator, **I want** to rename a playlist **so that** I can give it a meaningful name (e.g. "Lofi Session March").

**Acceptance Criteria:**
- [ ] The playlist header shows the current playlist name with an edit affordance (e.g. inline editable field or pencil icon).
- [ ] Submitting a new name sends `PATCH /api/playlists/{id}` with `{ "name": "..." }`.
- [ ] The backend updates the name in `playlists.json` and returns the updated playlist.
- [ ] The new name is reflected in the UI immediately and persists after a full page reload.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-004: User can create a new playlist and switch between playlists
**As a** creator, **I want** to create additional playlists and switch between them **so that** I can organise recordings by project or session.

**Acceptance Criteria:**
- [ ] A "New Playlist" button sends `POST /api/playlists` with a default name (e.g. `"New Playlist"`), and the backend persists it and returns the new playlist object.
- [ ] A playlist selector (dropdown or tab list) displays all existing playlists.
- [ ] Selecting a playlist sets it as the active playlist; subsequent recordings are uploaded to it.
- [ ] The active playlist's tracks are fetched from `GET /api/playlists/{id}/tracks` and displayed.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

### US-005: User can play, download, and delete tracks within a playlist
**As a** creator, **I want** to play, download, or delete any track in the active playlist **so that** I can manage my recordings.

**Acceptance Criteria:**
- [ ] Each track row shows: filename, size (MB), created_at timestamp, and action buttons (Play, Download, Delete).
- [ ] **Play:** clicking Play opens/plays the track video via a URL served by `GET /api/playlists/{playlist_id}/tracks/{track_id}/file`.
- [ ] **Download:** clicking Download triggers a browser download of the MP4 file.
- [ ] **Delete:** clicking Delete sends `DELETE /api/playlists/{playlist_id}/tracks/{track_id}`; the backend removes the file from disk and the entry from `playlists.json`; the track disappears from the UI immediately.
- [ ] A confirmation dialog is shown before deleting a track.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

---

## Functional Requirements

- **FR-1:** Backend stores playlist metadata in `backend/playlists.json` — a JSON array of playlist objects, each with `id` (UUID), `name`, `created_at`, and a `tracks` array.
- **FR-2:** Backend stores video files at `backend/recordings/{playlist_id}/{track_id}.mp4`; directories are created on demand.
- **FR-3:** `GET /api/playlists` — returns all playlists (without track file bytes); creates default playlist if none exist.
- **FR-4:** `POST /api/playlists` — creates a new playlist with a provided or default name; returns the created playlist object.
- **FR-5:** `PATCH /api/playlists/{id}` — updates the playlist name; returns the updated object.
- **FR-6:** `POST /api/playlists/{id}/tracks` — accepts `multipart/form-data` with the MP4 file; saves to disk; appends track metadata to `playlists.json`; returns the new track object.
- **FR-7:** `GET /api/playlists/{id}/tracks/{track_id}/file` — streams the MP4 file from disk with correct `Content-Type: video/mp4` header.
- **FR-8:** `DELETE /api/playlists/{id}/tracks/{track_id}` — removes the file from disk and the entry from `playlists.json`.
- **FR-9:** Frontend replaces `recording-queue.tsx` with a new `playlist-panel.tsx` component that occupies the same position in the UI (below the audio player); it fetches and displays the active playlist.
- **FR-10:** Frontend tracks `activePlaylitId` in React state; initialised to the first playlist returned by `GET /api/playlists` on app load.
- **FR-11:** Backend layering: routes in `backend/routes/playlists.py`, service logic in `backend/services/playlist_service.py`, file I/O in `backend/repositories/playlist_repository.py`.

## Non-Goals (Out of Scope)
- Playlist deletion (deferred — accidental deletion risk without recycle bin).
- Track reordering within a playlist.
- Video thumbnail / preview image generation.
- Cloud or remote storage — local filesystem only.
- Multi-user or authentication.
- Pagination of track lists.

## Open Questions
- None.
