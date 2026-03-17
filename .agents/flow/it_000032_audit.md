# Iteration 000032 — Audit

## Executive Summary

Both user stories (US-001, US-002) are implemented and their acceptance criteria are substantially satisfied. Two gaps were found and subsequently remediated in this audit cycle:

1. **FR-4** (previously does_not_comply) — The upload used `uploadType=media`, a raw-body upload that cannot carry metadata. Neither the video title nor `privacyStatus: 'unlisted'` reached the YouTube API. Fixed by switching to `uploadType=multipart` with a `multipart/related` body containing a JSON metadata part (title + privacyStatus) followed by the binary video part.

2. **FR-5** (previously partially_comply) — A 401 response from the YouTube API did not clear the stored token or update the connected state. Fixed by adding `YouTubeUnauthorizedError`, throwing it on 401, clearing the token in `localStorage`, and calling `disconnectYouTube()` in the App.tsx catch block to return the UI to the disconnected state.

---

## Verification by FR

| FR | Assessment | Notes |
|----|-----------|-------|
| FR-1 | comply | All interactions use YouTube Data API v3 (`/upload/youtube/v3/videos`). |
| FR-2 | comply | OAuth uses `https://accounts.google.com/o/oauth2/v2/auth`; client ID read from `VITE_YOUTUBE_CLIENT_ID`. |
| FR-3 | comply | Upload button gated on `rec.mp4Blob`; only queue entries can trigger upload. |
| FR-4 | comply | Switched to `uploadType=multipart`; `snippet.title` (filename-derived) and `status.privacyStatus: 'unlisted'` now sent as JSON metadata part. |
| FR-5 | comply | 401 response clears `localStorage` token, throws `YouTubeUnauthorizedError`, and calls `disconnectYouTube()` to reset UI to disconnected state. |

---

## Verification by US

| US | Assessment | Notes |
|----|-----------|-------|
| US-001 | comply | All 7 ACs satisfied: button visibility, OAuth scope, connected-state label, localStorage persistence, error display, typecheck/lint, visual verification. |
| US-002 | comply | All 8 ACs satisfied after FR-4/FR-5 fixes: upload-button gating, progress spinner, success URL link, error retry, correct metadata transmission. |

---

## Minor Observations

- The OAuth implicit flow (`response_type=token`) is deprecated by Google; migrating to authorization-code-with-PKCE would improve security and future-proof the integration.
- Upload progress shows a spinner only (no byte percentage); acceptable per PRD but suboptimal UX for large video files.
- `VITE_YOUTUBE_CLIENT_ID` is not documented in `.env.example`; adding it would aid developer onboarding.
- No client-side file-size guard before upload; very large blobs may cause browser memory pressure or request timeouts.

---

## Conclusions and Recommendations

All five functional requirements now comply after the two remediations applied in this audit cycle. US-001 and US-002 are fully satisfied. The remaining minor observations are non-blocking but represent good hygiene improvements for future iterations: PKCE migration (security), upload progress percentage (UX), `.env.example` documentation (DX), and a file-size guard (robustness).

---

## Refactor Plan

### FR-4 fix — `uploadType=multipart` with metadata ✅ Applied

**File:** `src/lib/youtube-upload.ts`

- Changed `YOUTUBE_VIDEOS_INSERT_UPLOAD_URL` from `uploadType=media` → `uploadType=multipart`.
- Added `buildMultipartBody()` helper that constructs a `multipart/related` Blob: JSON metadata part (`snippet.title`, `status.privacyStatus: 'unlisted'`) + binary video part.
- `uploadVideoToYouTube()` now builds a boundary, calls `buildMultipartBody()`, and sets `Content-Type: multipart/related; boundary="…"`. Removed non-standard `x-upload-*` headers.

### FR-5 fix — 401 handling and token clear ✅ Applied

**Files:** `src/lib/youtube-upload.ts`, `src/hooks/use-youtube-auth.ts`, `src/App.tsx`

- Exported `YouTubeUnauthorizedError extends Error` from `youtube-upload.ts`.
- On `response.status === 401`, token is removed from `localStorage` and `YouTubeUnauthorizedError` is thrown before any generic error handling.
- Added `disconnectYouTube()` to `useYouTubeAuth` (clears `localStorage`, resets state to disconnected).
- `UseYouTubeAuthResult` interface updated to include `disconnectYouTube: () => void`.
- `uploadRecordingToYouTube` in `App.tsx` catches `YouTubeUnauthorizedError` and calls `disconnectYouTube()`, then falls through to set the per-entry error message so the user sees the reconnection prompt.
