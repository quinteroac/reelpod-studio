# Requirement: Upload Recorded Videos to YouTube

## Context
Users generate AI music videos in ReelPod Studio and record them as MP4 files. Currently the only action available on a completed recording is downloading it locally. This feature adds a direct upload path to YouTube, reducing friction for content creators publishing to that platform.

## Goals
- Allow the end user to connect their YouTube account via OAuth (YouTube Data API v3) from within the app.
- Allow the end user to upload any completed recording (entries in the recording queue) to their connected YouTube channel with one click.
- Display a YouTube link to the published video once the upload completes.

## User Stories

### US-001: User connects their YouTube account
**As a** content creator, **I want** to authenticate with my YouTube account inside ReelPod Studio **so that** the app can upload videos on my behalf.

**Acceptance Criteria:**
- [ ] A "Connect YouTube" button is visible in the UI (e.g. in a settings area or in the recording queue header) when no account is connected.
- [ ] Clicking "Connect YouTube" initiates the Google OAuth 2.0 consent flow using the YouTube Data API v3 scope (`https://www.googleapis.com/auth/youtube.upload`).
- [ ] After successful authorization the button changes to a connected state (e.g. shows the channel name or a "Connected" label).
- [ ] The OAuth token is persisted in the browser (localStorage or sessionStorage) so the user does not need to re-authenticate on every page reload within the same session.
- [ ] If authorization fails or is cancelled the UI shows a user-visible error message and returns to the disconnected state.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-002: User uploads a completed recording to YouTube
**As a** content creator, **I want** to click "Upload to YouTube" on a completed recording in the queue **so that** the video is published to my YouTube channel without leaving the app.

**Acceptance Criteria:**
- [ ] Each entry in the recording queue displays an "Upload to YouTube" button only when a YouTube account is connected.
- [ ] The button is only rendered for completed recordings (entries that already have a downloadable MP4 blob); it must not appear on in-progress or failed recordings.
- [ ] Clicking the button starts a `resumable upload` (or direct upload) via the YouTube Data API v3 `videos.insert` endpoint using the stored OAuth token.
- [ ] During upload the button is replaced by a progress indicator (percentage or spinner) and is non-interactive.
- [ ] On success the progress indicator is replaced by a clickable YouTube URL that opens the video in a new tab.
- [ ] On failure a user-visible error message is shown next to the recording entry and the button is re-enabled so the user can retry.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

## Functional Requirements
- FR-1: The app must use the YouTube Data API v3 for all YouTube interactions.
- FR-2: The OAuth flow must use Google's OAuth 2.0 authorization endpoint; client credentials (client ID) are configured via an environment variable (e.g. `VITE_YOUTUBE_CLIENT_ID`).
- FR-3: Upload must target only recordings present in the recording queue (MP4 blobs produced by `use-recorder.ts`); no other files can be uploaded through this path.
- FR-4: The video metadata sent on upload must include at minimum a non-empty title (default: the recording filename) and a privacy status (default: `"unlisted"`).
- FR-5: The stored OAuth token must be cleared/refreshed if a 401 response is received from the YouTube API, prompting the user to reconnect.

## Non-Goals (Out of Scope)
- Letting the user customize title, description, tags, category, or privacy before uploading (post-MVP).
- Uploading to platforms other than YouTube (TikTok, Facebook — post-MVP).
- Automatic upload triggered without user action.
- Server-side OAuth token storage or proxy; all API calls happen from the browser.
- Displaying or managing the user's existing YouTube uploads inside the app.

## Open Questions
- None.
