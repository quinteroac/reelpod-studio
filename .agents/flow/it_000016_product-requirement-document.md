# Requirement: Two-Column Layout Redesign

## Context

ReelPod Studio currently renders all UI in a single centered column (`max-w-3xl`). The visual scene canvas is embedded inside the "Visual prompt" section, making it feel secondary to the controls. The goal is to reorganize the page into two columns: all controls (prompts, parameters, generate button, queue, image/visualizer/effects settings) on the left, and the visual scene with playback controls on the right. No controls, logic, or styling should change — only the spatial arrangement.

## Goals

- Give the visual scene a prominent, persistent position on screen while the user interacts with controls.
- Reduce scrolling by placing the video panel alongside the controls rather than below them.
- Keep the existing warm lofi theme and all existing functionality unchanged.

## User Stories

### US-001: Controls Panel in Left Column

**As a** content creator, **I want** all generation controls stacked in a left column **so that** I can configure and queue tracks without losing sight of the visual scene.

**Acceptance Criteria:**
- [ ] On wide screens (≥ 1024 px), the page header spans full-width above the grid, and the left column contains, in order: the Generation parameters section (mode, music prompt, mood/tempo/style, duration, format), the Generation actions section (Generate button + errors), the Generation queue section, and the Visual prompt section (image prompt, visualizer selector, effects list).
- [ ] None of the existing controls, labels, inputs, or interactive behaviours are removed or altered.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: left column renders all controls with no missing elements.

### US-002: Video Panel and Playback Controls in Right Column

**As a** content creator, **I want** the visual scene canvas and playback controls (Play, Pause, Seek) displayed in a right column **so that** I can preview and control playback while managing settings on the left.

**Acceptance Criteria:**
- [ ] On wide screens (≥ 1024 px), the right column contains the `VisualScene` canvas followed immediately below by the playback controls section (Play, Pause, Seek slider).
- [ ] The right column is sticky / top-aligned so the video stays visible while the user scrolls the left column.
- [ ] The `VisualScene` canvas preserves its aspect ratio based on the selected social format (16:9, 9:16, 1:1).
- [ ] The playback controls section is only rendered when `hasGeneratedTrack` is true (unchanged behaviour).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: right column shows the canvas and playback controls side-by-side with the left column.

### US-003: Responsive Single-Column Fallback

**As a** content creator on a narrow screen (tablet / mobile), **I want** the layout to collapse to a single column **so that** controls and the video panel remain usable on small viewports.

**Acceptance Criteria:**
- [ ] Below 1024 px viewport width, the layout stacks into a single column: controls on top, video panel and playback below.
- [ ] No horizontal overflow or clipped content occurs at 375 px, 768 px, and 1024 px breakpoints.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser at a narrow viewport: single-column layout with no overflow.

## Functional Requirements

- FR-1: The top-level wrapper changes from `max-w-3xl` single-column to a two-column CSS grid or flexbox layout using Tailwind's `lg:grid-cols-[…]` or equivalent responsive utility.
- FR-2: The left column contains all existing sections except the `VisualScene` canvas and the playback controls section.
- FR-3: The `VisualScene` canvas (`data-testid="visual-canvas"`) is moved out of the Visual prompt section and into the right column.
- FR-4: The playback controls section (`aria-label="Playback controls"`) is placed directly below the canvas in the right column.
- FR-5: The right column uses `sticky top-0` (or equivalent) so the video panel stays in view while the user scrolls the left column.
- FR-6: No TypeScript types, state, event handlers, component props, or Tailwind theme tokens are changed — only JSX structure and layout class names.
- FR-7: The header (`<header>`) spans the full width above the two-column grid, outside and before the grid container.

## Non-Goals (Out of Scope)

- No new controls, parameters, or features are added.
- No theme colours, typography, or spacing tokens are changed.
- No changes to backend, API, or any file outside `src/App.tsx`.
- No animations or transitions on the layout itself.
- No export / video-render functionality.

## Layout Decisions

- **Header placement:** The `<header>` spans both columns full-width as a page-level masthead. It sits above the two-column grid so the right column never starts with empty space above the canvas.
- **Column ratio:** `lg:grid-cols-[minmax(320px,2fr)_3fr]`. The 2:3 ratio keeps the controls panel readable at mid-range widths while giving the canvas the larger share of the viewport. The `minmax(320px,…)` floor prevents the left column from collapsing below a usable width before the single-column breakpoint kicks in.
