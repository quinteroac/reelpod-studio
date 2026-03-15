# Requirement: Frontend Design Polish & Lofi Theme Improvement

## Context
The current ReelPod Studio UI is functional but lacks visual cohesion. Typography, spacing, and color usage are inconsistent across panels. The lofi warm-brown theme exists but isn't fully leveraged — controls mix raw Tailwind stone/gray classes with lofi CSS variables, creating a fragmented look. This iteration improves visual polish and design consistency without adding new features or breaking existing functionality.

## Assumptions
- All lofi CSS custom properties listed in FR-1 are already defined in `src/index.css` and mapped to Tailwind utilities in `tailwind.config.*`. If any are missing, defining them is in scope for this iteration before the visual migration begins.
- Disabled and loading states for the Generate button already exist as component props/state. This iteration only styles them — no new state or logic is introduced.

## Goals
- Establish a consistent design system (spacing scale, type scale, color usage) applied uniformly across the UI.
- Strengthen the lofi warm-brown aesthetic so every element feels intentional and on-brand.
- Improve readability and visual hierarchy in the parameter controls panel.
- Make the overall layout feel more polished and professional when viewed in a browser.

## User Stories

### US-001: Consistent lofi color palette and typography applied throughout
**As a** creator using ReelPod Studio, **I want** every UI element to use the lofi color tokens (`lofi-bg`, `lofi-panel`, `lofi-accent`, `lofi-accentMuted`, `lofi-text`) and a consistent type scale instead of raw Tailwind stone/gray overrides **so that** the interface feels cohesive and on-brand.

**Acceptance Criteria:**
- [ ] All background colors use `bg-lofi-bg` or `bg-lofi-panel`; raw `bg-stone-*` / `bg-gray-*` overrides replaced with lofi tokens or warm equivalents.
- [ ] All border colors use `border-lofi-accent`, `border-lofi-accentMuted`, or a warm stone tone consistent with the palette — no cool-gray borders.
- [ ] Interactive elements (inputs, textareas, selects, buttons) use accent color on hover/focus consistently.
- [ ] Tab bar active indicator uses `border-lofi-accent` (warm amber) instead of `border-white`.
- [ ] App title ("ReelPod Studio") uses `font-serif` (Merriweather) at `text-4xl font-bold`.
- [ ] Subtitle and secondary labels use `text-sm` with `lofi-accentMuted` color.
- [ ] Body/input text uses `text-sm` (Nunito via `font-sans`).
- [ ] No `text-xs` used for primary readable content (only for badges/tags).
- [ ] Typecheck / lint passes.
- [ ] A review of component files confirms no `stone-*` / `gray-*` class remains on backgrounds or borders; app title renders in Merriweather at `text-4xl`.

### US-002: Improved parameter controls panel layout and typography
**As a** creator, **I want** the Music Generation and Visual Settings panels to have clear visual hierarchy and comfortable spacing **so that** I can scan and use controls quickly without cognitive friction.

**Acceptance Criteria:**
- [ ] Section headings ("Creative brief", "Duration", "Format", "Visualizer", "Effects") use a consistent type style (size, weight, color) across all tabs.
- [ ] Heading hierarchy within panels (`h2`, section labels) is consistent in size and weight.
- [ ] Labels are visually distinct from input fields (e.g., slightly muted label color vs. full `lofi-text` for values).
- [ ] Control groups (e.g., duration input, format radio group, effect toggles) have consistent internal padding and gap of ≥ 8px.
- [ ] The Generate button is visually prominent — full-width on the controls column with clear disabled/loading states.
- [ ] Error and status messages use consistent styling: red-tinted for errors, accent-tinted for loading.
- [ ] The queue tab entries are easy to scan: status badge, truncated brief, and action button are well-spaced.
- [ ] Empty queue state displays a muted placeholder message (e.g., "No items in queue") using `lofi-accentMuted` color.
- [ ] Queue list is scrollable and does not overflow the panel when more than 3 entries are present.
- [ ] Typecheck / lint passes.
- [ ] All control groups have ≥ 8px internal gap; section headings are visually distinct from body text; no element uses more than 3 distinct font sizes outside badge/tag contexts.

### US-003: Visual scene panel framing improved
**As a** creator, **I want** the visual scene canvas on the right side to sit in a visually intentional frame **so that** the canvas area feels like a proper preview, not a raw floating element.

**Acceptance Criteria:**
- [ ] The scene panel has a consistent background (`bg-lofi-panel` or `bg-lofi-bg`) with subtle border or inset shadow using the lofi shadow ring token.
- [ ] The aspect-ratio container centers the canvas correctly at all viewport sizes (no layout shift).
- [ ] The playback controls below the scene use lofi accent colors for the play/pause button and seek slider thumb.
- [ ] The seek slider track uses the existing gradient style from `index.css`; no raw gray overrides on the track.
- [ ] Typecheck / lint passes.
- [ ] Canvas container has a visible border or shadow; no element bleeds outside the panel frame; playback controls use warm accent colors with no gray remnants.

## Functional Requirements
- FR-1: The lofi CSS custom properties (`--color-lofi-bg`, `--color-lofi-panel`, `--color-lofi-accent`, `--color-lofi-accent-muted`, `--color-lofi-text`, `--color-lofi-shadow-ring`) defined in `src/index.css` are the single source of truth for color; no duplicate color literals for these values in component files.
- FR-2: The Tailwind config must expose all lofi tokens as utility classes (`bg-lofi-*`, `text-lofi-*`, `border-lofi-*`) so that CSS custom properties are consumed via utilities, not inline styles.
- FR-3: All changes must be purely visual (CSS/Tailwind classes, `index.css` token values); no logic, state, or API changes. Disabled and loading states are assumed to already exist as component props/state — this iteration only styles them.
- FR-4: Existing functional behavior — audio generation, image upload, playback, queue, live mirror — must remain unaffected.
- FR-5: `tailwind.config.*` lofi color extension and `index.css` variable definitions must remain in sync.

## Non-Goals (Out of Scope)
- Adding a dark/light theme toggle — the lofi warm-brown theme is the only theme.
- Adding new UI controls, panels, or tabs.
- Changing layout structure (grid columns, sidebar vs. top-bar) beyond minor padding/spacing adjustments.
- Adding animations or transitions beyond what already exists.
- Changing the audio/video generation, queue, or live-mirror logic.
- Mobile-specific responsive redesign (improvements should not break mobile, but mobile layout is not the focus).
- WCAG accessibility audit — contrast ratios are not verified in this iteration; accessibility remediation is deferred.

## Open Questions
- None
