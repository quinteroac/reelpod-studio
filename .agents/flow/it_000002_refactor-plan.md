# Refactor Plan — Iteration 000002

## Refactor Items

### RI-001: Add error handling to playback handlers

**Description:** `handlePlay`, `handlePause`, and `handleSeekChange` in `App.tsx` call controller methods with no `try/catch`. Any audio error that surfaces during playback silently becomes an unhandled promise rejection with zero user feedback.

**Rationale:** Critical silent failure path. Low effort with high impact — wrapping the three handlers in try/catch and piping errors to the existing `errorMessage` state is the same pattern already used in `handleGenerate`. Fixes first to avoid user-facing regressions.

---

### RI-002: Surface REPL bootstrap errors to the user

**Description:** `main.tsx` catches `bootstrapStrudelRepl()` failures with `console.error` only. The code standard in `PROJECT_CONTEXT.md` explicitly requires user-visible error messages for all audio failures, including REPL initialisation errors.

**Rationale:** Violates a documented project standard. Low effort — the error can be propagated into a root-level error state that renders a styled full-screen message before mounting the rest of the app.

---

### RI-003: Encapsulate error message formatting inside the controller

**Description:** `App.tsx` directly imports and calls `getUserFriendlyError` from `strudel.ts`. Error message formatting is an implementation detail of the audio layer and should not leak into the component. The controller's public methods should throw `Error` objects that already carry human-readable messages.

**Rationale:** Fixes a leaky abstraction and tightens the boundary described in `PROJECT_CONTEXT.md` (`src/lib/` = pure logic, not UI concerns consumed by components). Medium priority — no user-visible behaviour change, but reduces coupling before the codebase grows.

---

### RI-004: Fix aria-pressed misuse on Play and Pause buttons

**Description:** Both Play (`aria-pressed={isPlaying}`) and Pause (`aria-pressed={!isPlaying}`) use `aria-pressed`, which is reserved for stateful toggle buttons. These are one-directional trigger buttons that become disabled after activation, so `aria-pressed` produces misleading screen-reader output.

**Rationale:** Accessibility correctness. The fix is to remove `aria-pressed` from both buttons (they are already semantically described by their visible labels and disabled states), or to consolidate them into a single toggle button. Low effort, medium accessibility impact.

---

### RI-005: Replace hardcoded hex values in seek-slider CSS with design tokens

**Description:** `index.css` contains four hardcoded hex values (`#c08457`, `#8b5e3c`, `#f5ede5`, `rgba(28,23,20,0.35)`) inside the `.seek-slider` pseudo-element rules. These duplicate the values already defined in `tailwind.config.ts`, creating drift risk on any palette change.

**Rationale:** Quick win. Introducing CSS custom properties (e.g. `--color-lofi-accent`) defined once and referenced in both Tailwind config and CSS rules eliminates the duplication.

---

### RI-006: Style the Seek label and subtitle paragraph with lofi palette tokens

**Description:** The `<label htmlFor="seek">Seek</label>` in the playback section has no Tailwind classes (plain unstyled text). The header subtitle uses `text-stone-300` instead of a lofi palette token. Both are visually inconsistent with the rest of the UI.

**Rationale:** Trivial cosmetic fix that brings all visible text in line with the design system. No logic changes required.

---

### RI-007: Document fake seek position and cap its range

**Description:** The seek slider auto-increments by 1 every 500 ms regardless of actual Strudel playback time. After 50 seconds the bar sits at maximum with no reset. This is a UX-visible artefact of the Strudel public API not exposing a timeline. The limitation should be documented with a TODO comment and the slider behaviour should reset on loop (when it reaches `SEEK_MAX`, reset to `SEEK_MIN`).

**Rationale:** Low effort improvement that prevents the seek bar from appearing "stuck" at 100 %. The underlying API limitation is acknowledged and tracked for a future iteration.

---

### RI-008: Resolve React Three Fiber tech stack gap (deferred)

**Description:** `PROJECT_CONTEXT.md` lists R3F as a key library for a visual/animation layer, but R3F is not installed and no such layer exists. The specific approach (implement a minimal visual component vs. remove R3F from the documented tech stack) is **deferred by the user** and should be decided before the next iteration's Define phase.

**Rationale:** Included for tracking. Not blocking any other refactor item. Should be resolved so that the tech stack documentation accurately reflects what is in use.

---

### RI-009: Update PROJECT_CONTEXT.md Implemented Capabilities

**Description:** The `Implemented Capabilities` section in `PROJECT_CONTEXT.md` still reads "(none yet — populated after first Refactor)". After this iteration it should list the capabilities that are now stable: lofi theme, parameter controls, audio generation, playback controls, and error handling.

**Rationale:** Documentation hygiene. Ensures future iterations (and agents) have an accurate baseline of what has already been built.
