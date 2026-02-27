# Test Plan - Iteration 000001

## Scope

- Validate the MVP browser flow from parameter input to generated lofi playback using Strudel REPL.
- Verify functional behavior and error handling for generation, playback controls, loading, retry, and audio capability constraints.
- Ensure all iteration functional requirements (FR-1 to FR-6) are covered with automated tests aligned to Vitest and React component/lib structure.

## Environment and data

- Runtime: modern desktop browser environment with Web Audio API support (plus mocked unsupported/autoplay-blocked scenarios).
- Tooling: `bun`, Vite, Vitest, and React Testing Library for automated UI and integration tests.
- Test data fixtures: representative parameter sets (mood: chill/melancholic/upbeat, tempo boundaries and nominal values, style: jazz/hip-hop/ambient).
- Strudel integration tests use deterministic mocks/stubs for REPL init/play/pause/seek and failure cases.

## User Story: US-001 - Configure Lofi Parameters

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-US001-001 | Render parameter controls for mood selector, tempo input/slider, and style preset with required options. | integration | automated | US-001, FR-1 | UI exposes all required controls and allowed values; controls are enabled on first render. |
| TC-US001-002 | Verify sensible default values are preselected for mood, tempo, and style on initial load. | integration | automated | US-001, FR-1 | Defaults are present and valid so generation can run without prior edits. |
| TC-US001-003 | Update each control and assert no generation call is triggered until Generate is clicked. | integration | automated | US-001, FR-1, FR-2 | Parameter edits only update local UI/state and do not start REPL execution. |
| TC-US001-004 | Assess subjective UX clarity of control affordances and rhythm of visual feedback while adjusting controls. Manual justification: subjective perception of visual feel and interaction comfort is not reliably measurable via DOM/state assertions. | e2e | manual | US-001, FR-1 | Human reviewer confirms controls feel clear and intuitive; no confusing motion or ambiguous affordances. |

## User Story: US-002 - Generate a Lofi Track

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-US002-001 | Map selected parameters to a Strudel pattern string and invoke REPL execution when Generate is clicked. | integration | automated | US-002, FR-2, FR-3, FR-4 | Generate click produces a valid pattern and triggers Strudel execution exactly once for the request. |
| TC-US002-002 | Show loading indicator during REPL initialization and clear it on terminal success/failure states. | integration | automated | US-002, FR-6 | Loading/progress state appears only while generation is active and is removed when generation resolves. |
| TC-US002-003 | Success path enables playback controls and suppresses error state. | integration | automated | US-002, FR-4, FR-5, FR-6 | On successful generation, play/pause/seek controls are enabled and no error message is displayed. |
| TC-US002-004 | Failure path shows actionable error message and supports retry that reattempts generation cleanly. | integration | automated | US-002, FR-6 | User sees clear failure guidance; clicking retry attempts generation again without stale loading/error state. |
| TC-US002-005 | Click Generate repeatedly during in-progress run and verify defined concurrency behavior (ignore duplicate or queue policy) with consistent UI state. | integration | automated | US-002, FR-2, FR-6 | Multiple rapid clicks do not create inconsistent state or duplicate uncontrolled executions. |
| TC-US002-006 | Simulate autoplay-blocked or unsupported Web Audio environments and assert specific user-facing guidance message. | integration | automated | US-002, FR-4, FR-6 | UI shows explicit audio capability limitation guidance instead of generic failure text. |
| TC-US002-007 | Simulate REPL success callback with silent/no-output signal and assert warning/error is surfaced to user. | integration | automated | US-002, FR-4, FR-6 | UI indicates output is not playable despite technical completion signal. |

## User Story: US-003 - Play Back the Generated Track

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-US003-001 | After successful generation, verify player appears/updates and exposes native Strudel-backed play, pause, and seek actions. | integration | automated | US-003, FR-5 | Player is visible and control actions map to Strudel integration methods (no custom audio pipeline). |
| TC-US003-002 | Validate play/pause/seek command flow through `src/lib/strudel.ts` wrappers with mocked REPL responses. | unit | automated | US-003, FR-5 | Control commands invoke expected adapter methods and return consistent state transitions. |
| TC-US003-003 | End-to-end browser run confirms generated audio playback starts under supported Web Audio environment without extra plugins. | e2e | automated | US-003, FR-4, FR-5 | User can hear playback in-browser after generation using standard platform capabilities. |
