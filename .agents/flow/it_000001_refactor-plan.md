# Refactor Plan — Iteration 000001

## Refactor Items

---

### RI-001: Fix Eager Engine Lookup — Make `defaultEngine` Lazy

**Description:** `createStrudelController(engine = defaultEngine())` evaluates `defaultEngine()` at call time, not lazily. In production, `App.tsx` calls `createStrudelController()` inside `useMemo` on mount; if `window.__strudelRepl` is not yet available, this throws during render, crashing the app to a blank page and bypassing all error handling.

**Rationale:** This is the most critical fix — it affects every production mount. Low effort (change default to a factory or defer the lookup inside each method), high blast radius if left untouched. Must be resolved before the Strudel library integration so that any timing issue during REPL initialisation surfaces as a user-visible error rather than a render crash.

---

### RI-002: Integrate the Strudel Library and Wire `window.__strudelRepl`

**Description:** The app currently has no Strudel npm package and no script loading Strudel in `index.html`. `window.__strudelRepl` is never populated, so `generate`, `play`, `pause`, and `seek` all fail silently at runtime. Strudel must be installed (or loaded via CDN in `index.html`) and a concrete `StrudelReplEngine` implementation must be wired up in `main.tsx` or a dedicated bootstrap module.

**Rationale:** Without Strudel, the app produces no audio — it cannot satisfy its core purpose. This is a functional blocker. Doing it after RI-001 ensures the controller is robust to any timing gap between page load and REPL readiness.

---

### RI-003: Add ESLint and Prettier Configuration

**Description:** `package.json` has no ESLint or Prettier packages; the `lint` script is only `tsc --noEmit`. PROJECT_CONTEXT.md mandates "Prettier + ESLint defaults." ESLint (with the React and TypeScript plugins) and Prettier must be installed, and appropriate config files (`.eslintrc.cjs` / `eslint.config.js` and `.prettierrc`) must be added. The `lint` script should run ESLint and the `format` (or `lint:fix`) script Prettier.

**Rationale:** Convention compliance is required from iteration 2 onward. This is low-effort and unblocks the enforcement of consistent code style across all future contributions. Doing it early in the refactor means all subsequent items in this plan are written to the enforced standard.

---

### RI-004: Create `src/components/` and Decompose `App.tsx`

**Description:** `App.tsx` currently contains all UI — parameter controls, generate button/status, error display, and playback controls — in a single 130-line component. PROJECT_CONTEXT.md specifies `src/components/` for UI components. The UI should be decomposed into at least: `ParameterControls`, `GenerateButton` (or `GenerationPanel`), and `Player` (or `PlaybackControls`). `App.tsx` becomes the orchestrator holding state and wiring these together.

**Rationale:** Required by the project's module structure. Decomposition reduces per-component cognitive load, makes individual components independently testable, and aligns the codebase with the conventions that all future iterations will assume are in place.

---

### RI-005: Enrich the Pattern Generator (Melody, Chords, Bass)

**Description:** `generatePattern` currently stacks two drum patterns (mood-selected kick/snare and style-selected hi-hat/clap) with no melody, harmony, or bass. The resulting output is percussive only and lacks the characteristic lofi feel. The function should be extended to produce at minimum a chord voicing layer and a bass line, using mood and style to select appropriate note patterns. The function must remain a pure function with no side effects.

**Rationale:** The user explicitly requested this for the refactor. Richer patterns significantly increase the core product value demonstrated by the prototype. The `pattern-generator.ts` module is self-contained and its test suite can be extended in parallel, making this a well-scoped improvement even at higher effort.

---

### RI-006: Install React Three Fiber (Defer Visual Integration)

**Description:** React Three Fiber is listed in PROJECT_CONTEXT.md as a key library but is absent from `package.json`. Per the decision made during planning, R3F and its peer dependencies (`three`, `@react-three/fiber`) should be installed now to make the declared tech stack accurate, but no canvas or animation code will be written in this iteration. A follow-up iteration will implement the visual layer.

**Rationale:** Installing the package aligns the dependency manifest with the declared tech stack and avoids a version-compatibility surprise when the visual layer is finally added. Zero-code cost in this iteration.

---

### RI-007: Fix Seek Control and Add Playback State Tracking

**Description:** The seek `<input>` uses `defaultValue={0}` (uncontrolled) and is not backed by any playback-position state. There is also no `isPlaying` boolean, so Play and Pause buttons are always rendered identically regardless of playback status. The seek input should become a controlled component driven by a `seekPosition` state value updated via a `StrudelController` callback or polling mechanism; an `isPlaying` flag should toggle the enabled/active state of the Play and Pause buttons.

**Rationale:** Without these fixes, the playback section communicates nothing about current playback state and the seek handle resets to 0 on any re-render. This is a functional UX gap that would confuse end users. Lower priority than the structural and compliance items above, but important before the refactor is considered complete.

---

### RI-008: Decouple `window` Access from `strudel.ts` Pure Logic

**Description:** `strudel.ts` accesses `window.__strudelRepl` and `window.webkitAudioContext` directly. PROJECT_CONTEXT.md designates `src/lib/` as the home of "pure logic." The window-coupling should be lifted out of the module — either into a thin adapter in `src/lib/strudel-adapter.ts` or into `main.tsx` — so that the controller and error classes remain environment-agnostic. Tests would no longer need `Object.defineProperty` workarounds.

**Rationale:** A clean pure-logic boundary makes the library layer independently testable without DOM manipulation. Lower priority than the items above because the current tests pass, but completing this aligns `src/lib/strudel.ts` with the architecture and is low effort.
