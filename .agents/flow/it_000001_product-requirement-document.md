# Requirement: Lofi Music Generator (Strudel REPL)

## Context
Content creators and streamers need lofi music for their streams, videos, and study sessions, but lack the musical knowledge or time to compose it manually. This tool lets them generate lofi tracks automatically through a friendly web interface powered by Strudel REPL — a fully browser-based live-coding audio engine — with zero musical input required: just pick some parameters and hit generate.

## Assumptions
- MVP runs fully client-side in the browser using Strudel REPL; no backend services are required.
- Target environment is modern desktop browsers with Web Audio API support (e.g. latest Chrome, Firefox, Edge); mobile browsers are not required for MVP.

## Goals
- Enable content creators to generate lofi music tracks in seconds via a browser-based UI.
- Abstract Strudel pattern complexity behind a friendly parameter interface (mood, tempo, style).
- Provide in-browser audio playback so the user can hear the result immediately.

## User Stories

### US-001: Configure Lofi Parameters
**As a** content creator, **I want** to configure lofi generation parameters (mood, tempo, style) through a visual UI **so that** I can shape the character of the track without knowing Strudel syntax.

**Acceptance Criteria:**
- [ ] UI exposes at minimum: mood selector (e.g. chill, melancholic, upbeat), tempo control (BPM range), and style preset (e.g. jazz, hip-hop, ambient).
- [ ] All controls have sensible default values so the user can generate without touching anything.
- [ ] Changing a control does not trigger generation automatically — user must explicitly click Generate.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-002: Generate a Lofi Track
**As a** content creator, **I want** to click a "Generate" button **so that** the system produces a lofi track based on my selected parameters.

**Acceptance Criteria:**
- [ ] Clicking "Generate" translates the selected parameters into a Strudel pattern and executes it in the browser via the Strudel REPL.
- [ ] A loading/progress indicator is shown while the REPL initialises and begins playback.
- [ ] On success, the UI shows the playback controls (play, pause, seek) as enabled and the user can start playback; no error message is shown.
- [ ] On failure, a clear error message is displayed and the user can retry.
- [ ] If the user clicks "Generate" while a generation is in progress, the behaviour is defined (e.g. ignore second click, or cancel and restart); the UI does not enter an inconsistent state.
- [ ] If the browser blocks audio (e.g. autoplay policy) or lacks Web Audio support, the user sees a clear message explaining the limitation and how to enable audio, rather than a generic failure.
- [ ] If the REPL reports success but no audible output is produced, the UI shows an error or warning so the user knows the result was not playable.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-003: Play Back the Generated Track
**As a** content creator, **I want** to play back the generated lofi track directly in the browser **so that** I can evaluate it immediately without downloading anything.

**Acceptance Criteria:**
- [ ] An audio player appears (or updates) after successful generation.
- [ ] Player supports play, pause, and seek; playback controls are those provided by the Strudel REPL integration (no separate custom audio pipeline).
- [ ] Audio plays without requiring any browser plugin beyond standard Web Audio / HTML5 audio.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

## Functional Requirements
- FR-1: Web frontend with parameter controls: mood (enum/select), tempo (BPM slider or number input), style preset (enum/select).
- FR-2: "Generate" button that triggers client-side parameter-to-Strudel-pattern translation and starts REPL execution.
- FR-3: Client-side logic that maps UI parameter values to a valid Strudel pattern string (no backend required for MVP).
- FR-4: Strudel REPL execution in the browser renders audio via the Web Audio API.
- FR-5: Strudel REPL exposes playback controls (play, pause, seek) natively; no custom audio pipeline required.
- FR-6: Loading state and error handling communicated to the user in the UI.

## Non-Goals (Out of Scope)
- Video generation (deferred to a future iteration).
- Downloading / exporting the audio file.
- User accounts, saved tracks, or history.
- Manual Strudel code editing by the user.
- Real-time live-coding or pattern tweaking after generation.
- Showing the generated Strudel pattern (read-only code viewer); deferred to a future iteration.
- Explicit control over track/loop duration (e.g. fixed length or number of bars); MVP may use a default or engine-defined length.
- Accessibility compliance (e.g. WCAG) or screen-reader optimization beyond basic HTML semantics.
- Mobile-specific layout optimization.
- Backend integration (deferred to a future iteration).

## Open Questions
_None at this time — all architectural questions for the current iteration have been resolved._
