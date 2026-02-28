# Requirement: Image-Driven Video (Three.js) with Music Playback

## Context
Users can already generate lofi audio and play it in the browser. This iteration adds a new capability: the user uploads an image, and the app produces a video-like experience (Three.js animation) that uses that image and runs in sync with the generated music. The goal is to provide a cohesive audiovisual experience where the animation duration matches the music duration.

## Decisions (resolved from Open Questions)
- **Image aspect ratio / resolution:** The uploaded image SHALL be displayed with **fit to canvas** (scale to fit the viewport while preserving aspect ratio; letterboxing or pillarboxing as needed).
- **Animation style:** The visual SHALL be a **waveform overlay on the image**, Napster-style (waveform visualization drawn or rendered on top of the fitted image).

## Goals
- Allow the end user to upload an image and use it as the visual basis for an on-screen animation.
- Render a Three.js animation that incorporates the uploaded image and runs for the same duration as the currently loaded/playing audio.
- Keep animation and audio playback in sync so that when the user plays or pauses the music, the visual experience stays aligned.

## User Stories
Each story is scoped so it can be implemented in one focused session.

### US-001: Upload image for the visual
**As a** user, **I want** to upload an image file **so that** it can be used as the visual for my generated track.

**Acceptance Criteria:**
- [ ] A control (e.g. file input or upload area) allows selecting an image file (e.g. JPEG, PNG, WebP).
- [ ] After selection, the chosen image is available to the app (e.g. as object URL or texture source) and is displayed with fit-to-canvas (aspect ratio preserved, scaled to fit viewport); invalid or non-image files show a clear error message.
- [ ] Typecheck / lint passes.
- [ ] **Visually verified in browser**

### US-002: Three.js scene with uploaded image and animation
**As a** user, **I want** to see a Three.js animation that uses my uploaded image **so that** I have a visual experience while the music plays.

**Acceptance Criteria:**
- [ ] A Three.js (R3F) scene is rendered that uses the uploaded image (e.g. as texture on a plane or background) with fit-to-canvas.
- [ ] The scene includes a waveform overlay on the image (Napster-style): a waveform visualization is visible and animates over time in sync with the music.
- [ ] If no image has been uploaded, the scene still renders (e.g. with a placeholder or default visual) without breaking.
- [ ] Typecheck / lint passes.
- [ ] **Visually verified in browser**

### US-003: Animation duration equals music duration and stays in sync
**As a** user, **I want** the animation to last the same time as the music and stay in sync with play/pause **so that** the experience feels cohesive.

**Acceptance Criteria:**
- [ ] The animation’s total duration is driven by the current audio track’s duration (animation length = music length).
- [ ] When the user presses play, both the audio and the animation start together (or animation is clearly driven by audio time).
- [ ] When the user pauses, the animation pauses or reflects the same playback state (e.g. no visible “running ahead” of the audio).
- [ ] When the track ends, the animation reaches its end (no indefinite looping of the same full-length cycle unless by design).
- [ ] Typecheck / lint passes.
- [ ] **Visually verified in browser**

## Functional Requirements
- FR-1: The app SHALL provide an image upload control and accept at least one common image format (e.g. JPEG, PNG, or WebP). The image SHALL be displayed with fit-to-canvas (aspect ratio preserved).
- FR-2: The app SHALL render a Three.js (R3F) scene that uses the uploaded image as background (fit-to-canvas) and displays a Napster-style waveform overlay that animates in sync with the audio.
- FR-3: The animation SHALL run for the same duration as the currently loaded generated audio.
- FR-4: Playback controls (play/pause) SHALL keep the animation in sync with the audio (start together, pause together, end together).

## Non-Goals (Out of Scope)
- Exporting or downloading the video as a file (e.g. WebM/MP4).
- Multiple images or slideshows in one session.
- User-editable animation parameters (e.g. speed, style) beyond what is needed for duration/sync.
- Server-side processing of the image (beyond any existing backend); image use is client-side unless otherwise specified.

## Open Questions
- None (previous questions resolved; see Decisions above).
