# Requirement: Live/Record Page — Real-Time Canvas Mirror

## Context
ReelPod Studio creators need to stream their visual output while composing music. Currently, the visual canvas is embedded in the main app alongside all controls and parameters. There is no way to show only the visuals in a clean, full-viewport view suitable for screen-sharing or streaming. A dedicated `/live` route will display just the canvas, mirroring whatever is playing in the main app in real-time from a separate browser tab.

## Goals
- Provide a distraction-free, full-viewport visual output page at `/live`
- Mirror the main app's visual state (image, visualizer, effects, audio timing) in real-time across tabs
- Enable creators to stream by sharing the `/live` tab while working in the main app tab

## User Stories

### US-001: Navigate to /live route
**As a** creator, **I want** to open `/live` in a new browser tab **so that** I get a dedicated page showing only the visual canvas.

**Acceptance Criteria:**
- [ ] A `/live` route exists and renders without errors
- [ ] The page shows only the R3F canvas — no parameter controls, no audio player, no header/branding, no other UI chrome
- [ ] The page has a dark/black background (no white flashes on load)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-002: Real-time canvas mirroring across tabs
**As a** creator, **I want** the `/live` page to mirror the visual state of the main app in real-time **so that** viewers see exactly what I see while I compose.

**Acceptance Criteria:**
- [ ] When audio plays in the main app, the `/live` tab receives and displays the current playback time and duration
- [ ] The `/live` tab renders the same image (or fallback SVG) as the main app
- [ ] The `/live` tab renders the same active visualizer and effects as the main app
- [ ] Visual updates appear on the `/live` tab with no perceptible delay (< 100ms)
- [ ] When audio is paused/stopped in the main app, the `/live` tab reflects the paused state
- [ ] Cross-tab communication uses `BroadcastChannel` API (or equivalent mechanism)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

### US-003: Full-viewport auto-resize canvas
**As a** creator, **I want** the `/live` canvas to fill the entire browser viewport and auto-resize **so that** it looks clean when screen-sharing a tab.

**Acceptance Criteria:**
- [ ] The canvas fills 100% of the viewport width and height (no scrollbars, no margins)
- [ ] Resizing the browser window causes the canvas to adapt immediately
- [ ] The visual content scales correctly (maintains aspect ratio of the image plane within the full canvas)
- [ ] Typecheck / lint passes
- [ ] Visually verified in browser

## Functional Requirements
- FR-1: Add client-side routing to the app (e.g. `react-router-dom`) with at least two routes: `/` (main app) and `/live` (live page)
- FR-2: The `/live` route renders a `VisualScene` component (or equivalent R3F Canvas) with no surrounding UI
- FR-3: The main app broadcasts visual state (audioCurrentTime, audioDuration, isPlaying, image data/URL, visualizer type, effect types) via `BroadcastChannel` on every relevant state change
- FR-4: The `/live` page listens on the same `BroadcastChannel` and feeds received state into its `VisualScene` as props
- FR-5: The `/live` page canvas uses `width: 100vw; height: 100vh` styling with no body margin/padding
- FR-6: No audio playback occurs on the `/live` page — it is visual-only

## Non-Goals (Out of Scope)
- Recording or exporting the canvas to a video file
- Audio playback on the `/live` page
- Any UI controls or overlays on the `/live` page
- Multi-viewer or networked streaming (this is local same-browser tab sharing only)
- OBS or third-party streaming tool integration

## Design Decisions
- **Image sync via base64:** Since `blob:` URLs are scoped to the tab that created them, the main app will convert the image blob to a base64 data URL and send it over `BroadcastChannel`. The `/live` tab will reconstruct it as a local `blob:` URL via `URL.createObjectURL`. This keeps the feature purely frontend with no backend changes.

## Open Questions
- None
