# Requirement: Live Visual Scene Switcher

## Context
The active visualizer and post-processing effects are currently hardcoded as constants inside `VisualScene` (`currentVisualizerType = 'glitch'`, `currentEffects = ['colorDrift']`). Creators have no way to change them without editing source code. This iteration adds a live UI panel that lets any creator choose a visualizer and configure effects in real time, with the R3F canvas updating instantly.

## Goals
- Replace hardcoded visualizer/effects values with reactive state driven by UI controls.
- Let creators explore all 10 visualizers and 7 effects without a page reload.
- Keep the new controls consistent with the existing warm lofi theme and panel layout.

## User Stories

### US-001: Select Active Visualizer
**As a** creator, **I want** to pick any visualizer from a list **so that** I can choose the animation style that best fits my content.

**Acceptance Criteria:**
- [ ] A labeled control (e.g. `<select>` or radio-button group) lists all 10 visualizer types: `waveform`, `rain`, `scene-rain`, `starfield`, `aurora`, `circle-spectrum`, `glitch`, `smoke`, `contour`, `none`.
- [ ] The control is placed in the Visual Scene section of the page, above or below the canvas, within the existing `aria-label="Visual prompt"` section.
- [ ] Selecting a visualizer updates the canvas immediately without any page reload.
- [ ] The selected visualizer is the one displayed in the R3F canvas (i.e. the hardcoded `currentVisualizerType` constant is removed and replaced by state).
- [ ] Default selection on load is `glitch` (preserves current behaviour).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: switching between at least three visualizers updates the canvas live.

### US-002: Toggle Effects On/Off
**As a** creator, **I want** to enable or disable individual post-processing effects **so that** I can mix and match the look of my scene.

**Acceptance Criteria:**
- [ ] A section lists all 7 effect types: `zoom`, `flicker`, `vignette`, `filmGrain`, `chromaticAberration`, `scanLines`, `colorDrift`.
- [ ] Each effect has a checkbox (or toggle button) that adds it to or removes it from the active effects array.
- [ ] Toggling an effect updates the canvas immediately without a page reload.
- [ ] The active effects array passed to `EffectComposer` reflects exactly the enabled effects in the order they appear in the list.
- [ ] Default state on load: only `colorDrift` is enabled (preserves current behaviour).
- [ ] The hardcoded `currentEffects` constant is removed and replaced by state.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: enabling and disabling at least two effects shows the visual change on the canvas live.

### US-003: Reorder Active Effects
**As a** creator, **I want** to change the order of enabled effects in the stack **so that** I can control how the effects layer on top of each other.

**Acceptance Criteria:**
- [ ] Each effect row in the list has an "Up" button and a "Down" button.
- [ ] Clicking "Up" moves the effect one position earlier in the effects array; clicking "Down" moves it one position later.
- [ ] The "Up" button is disabled (or absent) for the first item; the "Down" button is disabled (or absent) for the last item.
- [ ] Reordering updates the canvas immediately without a page reload.
- [ ] The order in the UI matches the order in which effects are passed to `EffectComposer`.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: reordering two stackable effects (e.g. `filmGrain` and `vignette`) produces a visually different result on the canvas.

## Functional Requirements
- FR-1: `VisualScene` must accept `visualizerType: VisualizerType` and `effects: EffectType[]` as props instead of deriving them from internal constants.
- FR-2: The parent component (`App`) must own the `visualizerType` state (default `'glitch'`) and `effects` state (default `['colorDrift']`) and pass them down to `VisualScene`.
- FR-3: The visualizer selector and effects list controls must live inside the `aria-label="Visual prompt"` section, below the canvas element, so the visual scene remains the focal point.
- FR-4: The visualizer selector must render all values of `VisualizerType` (sourced from the existing type union) so adding a new visualizer in future only requires updating the type, not the UI code.
- FR-5: The effects list must render all values of `EffectType` (sourced from the existing type union), excluding `'none'`, as individually toggleable rows.
- FR-6: Up/Down reorder buttons must be keyboard-accessible (focusable, activatable with Enter/Space).
- FR-7: The new controls must follow existing Tailwind class patterns (`bg-lofi-panel`, `border-stone-600`, `text-lofi-text`, `focus-visible:ring-2 focus-visible:ring-lofi-accent`, etc.).

## Non-Goals (Out of Scope)
- Drag-and-drop reordering (up/down buttons are sufficient for MVP).
- Persisting the creator's selections to localStorage or any backend.
- Adding new visualizer or effect types in this iteration.
- A UI for the `'none'` effect type (it has no visual contribution and can be omitted from the list).
- Mobile / responsive layout optimisation beyond what Tailwind provides by default.

## Open Questions
- None. All requirements confirmed with creator.
