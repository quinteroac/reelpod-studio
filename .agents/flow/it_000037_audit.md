# Audit — Iteration 000037

## Executive Summary

Iteration 000037 is functionally complete. All five user stories (US-001 through US-005) fully comply with their acceptance criteria: the default playlist is auto-created, recordings are auto-uploaded on completion, playlists can be renamed, users can create and switch between playlists, and tracks support play/download/delete with confirmation dialogs. The backend REST API (7 endpoints), service logic, and frontend state management are all correctly implemented and integrated. Two functional requirements show partial compliance on architectural naming conventions: FR-9 specifies a dedicated `playlist-panel.tsx` component (the panel is inlined in App.tsx instead), and FR-11 specifies routes in `backend/routes/playlists.py` and file I/O in `backend/repositories/playlist_repository.py` (routes live in `api.py` and file I/O is co-located in `playlist_service.py`). These deviations are structural rather than functional and do not impede any user-facing behaviour.

---

## Verification by FR

| FR | Assessment | Notes |
|----|-----------|-------|
| FR-1 | comply | `backend/playlists.json` persists playlist metadata with correct schema (id, name, tracks[]) |
| FR-2 | comply | Files stored at `backend/recordings/{playlist_id}/{track_id}.mp4`; dirs created on demand |
| FR-3 | comply | `GET /api/playlists` returns all playlists and auto-creates default if none exist |
| FR-4 | comply | `POST /api/playlists` accepts optional name, persists and returns the new playlist |
| FR-5 | comply | `PATCH /api/playlists/{id}` updates name in playlists.json and returns updated object |
| FR-6 | comply | `POST /api/playlists/{id}/tracks` accepts multipart MP4, saves to disk, appends metadata |
| FR-7 | comply | `GET .../tracks/{track_id}/file` streams MP4 with `Content-Type: video/mp4` |
| FR-8 | comply | `DELETE .../tracks/{track_id}` removes file from disk and entry from playlists.json |
| FR-9 | partially_comply | Playlist panel functionality is correct and in position; implemented inline in App.tsx rather than as a dedicated `playlist-panel.tsx` component |
| FR-10 | comply | `activePlaylistId` tracked in React state, initialised to the first playlist on mount |
| FR-11 | partially_comply | Service layer correctly isolated; routes in `api.py` (not `playlists.py`); no `playlist_repository.py` — file I/O is private helpers inside `playlist_service.py` |

---

## Verification by US

| US | Assessment | Notes |
|----|-----------|-------|
| US-001 | comply | All ACs satisfied — default playlist created, persisted, and displayed on first load |
| US-002 | comply | All ACs satisfied — auto-upload on recording completion, errors surfaced as visible alert |
| US-003 | comply | All ACs satisfied — pencil-icon rename, PATCH request, persists across reload |
| US-004 | comply | All ACs satisfied — New Playlist button, dropdown selector, track list updates on switch |
| US-005 | comply | All ACs satisfied — filename/size/timestamp row, Play/Download/Delete, confirmation dialog |

---

## Minor Observations

- `window.confirm()` is used for track deletion confirmation. Functional but not theming-consistent; a styled in-app modal would be preferable.
- App.tsx is ~2400 lines; inlining the playlist panel contributes significantly to this size.
- Rename input auto-saves on blur in addition to Enter, which may cause accidental saves on focus loss.
- Playlist selector uses a native `<select>` element, which is visually inconsistent with custom-styled controls elsewhere in the app.
- No concurrent write protection for `playlists.json` (acceptable for single-user desktop context).
- Empty playlist state shows only a plain text message; a visual empty-state with a call-to-action would improve discoverability.

---

## Conclusions and Recommendations

The iteration delivers full functional value with no user-facing gaps. Both partial-compliance findings are architectural:

1. The playlist panel should be extracted from App.tsx into `src/components/playlist-panel.tsx` to match FR-9 and reduce file size.
2. Playlist route handlers should move from `backend/routes/api.py` to `backend/routes/playlists.py`, and file I/O helpers should move from `playlist_service.py` to `backend/repositories/playlist_repository.py`, to match FR-11.
3. `window.confirm()` should be replaced with a themed in-app confirmation dialog for track deletion.

These are low-risk refactors with no change to user-visible behaviour.

---

## Refactor Plan

### Step 1 — Backend: extract `playlist_repository.py`
- Create `backend/repositories/playlist_repository.py` with the file I/O helpers currently private to `playlist_service.py`: `_read_store`, `_write_store`, `_normalize_playlists`, `_normalize_tracks`, `_normalize_playlist_entry`, `_safe_filename`, and the path constants (`PLAYLISTS_FILE`, `RECORDINGS_DIR`).
- Update `backend/services/playlist_service.py` to import from the new repository module instead of defining these helpers inline.

### Step 2 — Backend: extract `backend/routes/playlists.py`
- Create `backend/routes/playlists.py` with a FastAPI `APIRouter` containing all playlist-related route handlers currently in `backend/routes/api.py`.
- Update `backend/routes/api.py` (or the app factory) to include the new router.

### Step 3 — Frontend: extract `playlist-panel.tsx`
- Create `src/components/playlist-panel.tsx` receiving all playlist-related state and handlers as props from App.tsx.
- Remove the inlined panel JSX from App.tsx and replace with `<PlaylistPanel ... />`.

### Step 4 — Frontend: replace `window.confirm()` with a themed dialog
- Add a lightweight confirmation dialog component (or reuse any existing modal primitive).
- Replace the `window.confirm()` call in the Delete handler with the themed dialog.
