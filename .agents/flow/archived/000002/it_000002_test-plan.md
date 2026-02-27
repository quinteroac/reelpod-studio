# Test Plan - Iteration 000002

## Scope

- Lofi-themed styling: Tailwind setup, dark/warm palette, typography, and visual consistency.
- Parameter controls layout: grouping, labels, spacing, Generate button prominence, and hover/focus states.
- Playback section: Play/Pause buttons, seek slider, loading indicator, and error UI styling.
- Regression: all existing Vitest tests must pass after styling changes.
- Typecheck and lint (ESLint, Prettier) for the modified codebase.

## Environment and data

- Node.js runtime with bun; run tests with `bun test` (Vitest).
- Browser or jsdom environment for component tests that assert DOM structure and classes.
- No backend or DB; no fixtures required beyond existing test setup.
- Tailwind build pipeline (Vite/PostCSS) must be in place so utility classes are available in tests where components are rendered.

---

## User Story: US-001 - Lofi-Themed Color Palette and Typography

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-001 | Verify Tailwind CSS is listed in package.json and tailwind.config file exists | unit | automated | US-001, FR-1 | Tailwind dependency present; tailwind.config.* exists in project root. |
| TC-002 | Verify entry CSS (e.g. main.css or index.css) imports Tailwind directives | unit | automated | US-001, FR-1 | Entry CSS contains @tailwind base/components/utilities or equivalent. |
| TC-003 | Verify root/App container uses dark warm background utility classes | integration | automated | US-001, FR-2 | Rendered app has element with dark/warm background classes (e.g. bg-stone-900, bg-neutral-900, or theme-based equivalent). |
| TC-004 | Verify headings and body text use lofi-appropriate font classes | integration | automated | US-001, FR-3 | Headings and main content use expected font-family classes (e.g. font-serif or custom font utility). |
| TC-005 | Run typecheck and lint on the project | unit | automated | US-001-AC05, US-002-AC05, US-003-AC05 | `bun run typecheck` and `bun run lint` (or equivalent) pass with no errors. |
| TC-006 | Visual verification of contrast and lofi aesthetic in browser | e2e | manual | US-001-AC02, US-001-AC03, US-001-AC06 | **Manual justification:** Subjective assessment of contrast and “lofi feel” cannot be reliably encoded in DOM/state assertions; human check required. Tester confirms background is dark/warm, text is readable, and overall look matches lofi theme. |

---

## User Story: US-002 - Styled Parameter Controls Layout

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-007 | Verify Mood, Tempo, and Style controls are each in a labelled section/card | integration | automated | US-002, FR-4 | DOM contains distinct labelled regions (e.g. by aria-label, heading, or data-testid) for Mood, Tempo, and Style. |
| TC-008 | Verify Generate button exists and has accent/prominent styling classes | integration | automated | US-002, FR-5 | Generate button is present and has accent-related Tailwind classes (e.g. bg-amber, bg-orange, or theme accent). |
| TC-009 | Verify interactive elements (button, sliders, selects) are focusable and have focus-visible styling | integration | automated | US-002-AC04 | Focusable controls have focus-visible styles (e.g. ring, outline) when focused; tab order is sane. |
| TC-010 | Visual verification of layout, spacing, and button prominence in browser | e2e | manual | US-002-AC01, US-002-AC02, US-002-AC03, US-002-AC06 | **Manual justification:** “Clean layout” and “visually prominent” are subjective; automation cannot reliably assert design quality. Tester confirms grouped layout, consistent spacing, and prominent Generate button. |

---

## User Story: US-003 - Polished Playback Section

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-011 | Verify Play and Pause buttons are rendered with styled classes | integration | automated | US-003, FR-6 | Play and Pause buttons exist and have Tailwind styling classes (not unstyled). |
| TC-012 | Verify seek slider is present and has theme-related styling (track/thumb) | integration | automated | US-003, FR-6 | Seek slider element exists and has theme-consistent classes (e.g. track/thumb colors). |
| TC-013 | Verify loading state shows a styled indicator (e.g. spinner/skeleton), not raw text only | integration | automated | US-003, FR-7 | When loading state is active, UI shows a styled indicator component or styled container, not only plain unstyled text. |
| TC-014 | Verify error state shows a styled alert/banner | integration | automated | US-003, FR-7 | When error state is active, error message is inside a styled alert/banner element (e.g. role="alert", or class for alert/notification). |
| TC-015 | Visual verification of playback section polish and theme consistency in browser | e2e | manual | US-003-AC01, US-003-AC02, US-003-AC06 | **Manual justification:** “Polished” and “consistent with theme” are subjective; automation validates presence and classes, not perceived quality. Tester confirms buttons and slider look cohesive and on-theme. |
| TC-016 | Run full Vitest test suite and ensure all tests pass | integration | automated | FR-8 | `bun test` (Vitest) completes with all existing tests passing; no regressions from styling changes. |

---

## Checklist

- [x] Read `it_000002_PRD.json`
- [x] Read `.agents/PROJECT_CONTEXT.md`
- [x] Plan includes **Scope** section with at least one bullet
- [x] Plan includes **Environment and data** section with at least one bullet
- [x] Test cases are grouped by user story
- [x] Every `FR-N` (FR-1 through FR-8) is covered by automated test cases
- [x] Every test case includes correlated requirement IDs (`US-XXX`, `FR-X`)
- [x] Manual tests are only UI/UX nuance checks with explicit justification for why automation is not reliable
- [x] File written to `.agents/flow/it_000002_test-plan.md`
