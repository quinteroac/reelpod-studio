# Requirement: Lofi UI Styling

## Context
The app currently has no visual styling applied. The raw HTML controls are functional but aesthetically bare. End users visiting the app in a browser get no lofi atmosphere or visual polish. This iteration applies a proper lofi-themed design using Tailwind CSS so the UI matches the mood of the music it generates.

## Goals
- Give the app a lofi aesthetic (dark/warm color palette, readable typography).
- Lay out the parameter controls in a clean, usable structure.
- Polish the playback section so it feels cohesive with the rest of the UI.
- Keep all existing Vitest tests passing after the styling changes.

## User Stories

### US-001: Lofi-Themed Color Palette and Typography
**As an** end user, **I want** the app to have a dark, warm lofi visual theme **so that** the visual atmosphere matches the music I'm generating.

**Acceptance Criteria:**
- [ ] Tailwind CSS is installed and configured (added to `package.json`, `tailwind.config.*` present, imported in the entry CSS).
- [ ] The app background uses a dark, warm tone (e.g. deep brown, charcoal, or dark slate).
- [ ] Text is readable against the background with sufficient contrast.
- [ ] A lofi-appropriate font (e.g. a serif or rounded sans-serif from Google Fonts or system stack) is applied to headings and body text.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-002: Styled Parameter Controls Layout
**As an** end user, **I want** the mood, tempo, and style controls to be laid out in a clean, structured section **so that** I can easily understand and adjust the generation parameters.

**Acceptance Criteria:**
- [ ] Each control (Mood, Tempo, Style) is grouped in a clearly labelled card or section.
- [ ] Controls are arranged in a readable vertical or grid layout with consistent spacing.
- [ ] The Generate button is visually prominent (e.g. accent color, adequate size).
- [ ] Hover and focus states are visible on interactive elements (buttons, sliders, selects).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

### US-003: Polished Playback Section
**As an** end user, **I want** the playback controls (Play, Pause, seek slider) to look polished and consistent with the overall theme **so that** the audio controls feel like part of the same designed experience.

**Acceptance Criteria:**
- [ ] Play and Pause buttons are clearly styled and distinguishable.
- [ ] The seek slider matches the app's color theme (track and thumb are styled).
- [ ] Loading state (while Strudel initialises) shows a styled indicator rather than raw text.
- [ ] Error messages are displayed in a styled alert/banner that is readable and not jarring.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser.

## Functional Requirements
- FR-1: Tailwind CSS must be added as a project dependency and fully configured (PostCSS plugin or Vite plugin, config file, base import).
- FR-2: The application background and surface colors must use a dark, warm lofi palette defined via Tailwind theme or utility classes.
- FR-3: Typography (font family, size scale, weight) must be applied consistently across headings, labels, and body text.
- FR-4: Parameter controls (Mood, Tempo, Style) must be visually grouped with clear labels and consistent spacing using Tailwind utility classes.
- FR-5: The Generate button must use an accent color that stands out from the background.
- FR-6: Playback controls (Play, Pause, seek slider) must be styled with Tailwind utility classes matching the overall palette.
- FR-7: Loading and error UI states must be styled (not raw unstyled text).
- FR-8: All existing Vitest tests must pass without modification after styling changes.

## Non-Goals (Out of Scope)
- No new audio or music-generation features.
- No changes to the Strudel pattern logic or parameter options.
- No React Three Fiber / 3D animations (deferred to a future iteration).
- No responsive/mobile-first layout beyond basic readability on a desktop browser.
- No dark/light mode toggle.
- No CSS Modules, styled-components, or any CSS library other than Tailwind.

## Open Questions
- None at this time.
