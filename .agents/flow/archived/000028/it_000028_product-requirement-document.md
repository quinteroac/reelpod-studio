# Requirement: Dusk Study Session Color Palette

## Context
The current lofi palette (`#1c1714` background, `#c08457` amber accent) reads as a warm late-night scene. The goal is to shift the mood toward **the threshold of dusk** — a study session caught between golden hour and nightfall. This means introducing deep muted purples and indigos in the background, warm ochre/amber remnants of the setting sun as the accent, and a slightly cooler but still warm text color. All color tokens live exclusively in `src/index.css` as CSS custom properties and are referenced throughout the app via Tailwind utilities (`bg-lofi-bg`, `text-lofi-text`, etc.), so the change is a single-file token update.

## Goals
- Replace the current warm-brown night palette with a dusk palette that evokes fading golden light giving way to deep violet-indigo shadows.
- Maintain the lofi aesthetic and readability — sufficient contrast between background, panel, and text.
- Keep the palette change contained to the CSS custom property definitions (`src/index.css`) so no component files need to change.

## User Stories

### US-001: Background and panel adopt dusk tones
**As a** creator using ReelPod Studio, **I want** the app background and panel surfaces to use deep dusk colors (muted indigo-violet) **so that** the interface feels like sitting at a desk as the sky turns dark outside.

**Acceptance Criteria:**
- [ ] `--color-lofi-bg` is updated to a deep indigo-violet (dark, desaturated — e.g. around `#1a1625` or similar; exact value chosen for best dusk feel).
- [ ] `--color-lofi-panel` is updated to a slightly lighter muted violet-gray that reads clearly as a raised surface against `--color-lofi-bg`.
- [ ] `--color-lofi-shadow-ring` is updated to complement the new background (cooler, slightly purple-tinted shadow).
- [ ] Visually verified in browser: panels are clearly distinguishable from the page background.

### US-002: Accent adopts warm ochre/amber of the last sunlight
**As a** creator, **I want** the accent color to evoke the warm remnant glow of dusk (golden ochre/amber) **so that** interactive elements feel alive against the cooler background.

**Acceptance Criteria:**
- [ ] `--color-lofi-accent` is updated to a warm golden ochre/amber (e.g. around `#d4a054` or similar — warm but slightly dustier than the current tone to harmonize with the purple background).
- [ ] `--color-lofi-accent-muted` is updated to a softer, more desaturated version of the accent that still reads as "warm" against the indigo background.
- [ ] Active tab indicators, focused borders, and radio button selections use the new accent and are visually clear.
- [ ] Visually verified in browser: accent contrast against the new background is comfortable and evokes dusk light.

### US-003: Typography reflects soft dusk light
**As a** creator, **I want** the text color to feel like reading under soft fading daylight — slightly cooler and more neutral than the current warm cream **so that** it harmonizes with the indigo-violet background without losing legibility.

**Acceptance Criteria:**
- [ ] `--color-lofi-text` is updated to a soft cool-leaning off-white or pale lavender-gray (e.g. around `#e8e4f0` or similar) that provides clear contrast against `--color-lofi-bg` and `--color-lofi-panel`.
- [ ] All labels, headings, and body copy remain fully legible (no low-contrast text).
- [ ] Visually verified in browser: the header "ReelPod Studio" and all panel labels read cleanly.

## Functional Requirements
- FR-1: The five lofi color tokens (`--color-lofi-bg`, `--color-lofi-panel`, `--color-lofi-accent`, `--color-lofi-accent-muted`, `--color-lofi-text`) and the shadow helper (`--color-lofi-shadow-ring`) in `src/index.css` are the **only** values that change. No component TSX files are modified.
- FR-2: The new hex values must be chosen so that WCAG AA contrast (≥ 4.5:1) is met between `--color-lofi-text` and both `--color-lofi-bg` and `--color-lofi-panel`.
- FR-3: Typecheck (`bun tsc --noEmit`) and lint pass without new errors after the change.

## Non-Goals (Out of Scope)
- Adding new color tokens or renaming existing ones.
- Changing fonts, font sizes, layout, spacing, or any component structure.
- Adding a dark/light mode toggle or theming system.
- Modifying visualizer or effect GLSL shader colors.

## Open Questions
- None
