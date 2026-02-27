# Evaluation Report — Iteration 000001

## Strengths

- **Clean architectural separation**: `pattern-generator.ts` is a true pure function; `strudel.ts` defines a controller abstraction; `App.tsx` owns UI/state — the layers are distinct.
- **Well-typed throughout**: `Mood`, `Style`, `GenerationParams`, `StrudelController`, and `StrudelReplEngine` are all explicitly typed; `strict: true` is enabled in tsconfig.
- **Strong error hierarchy**: `AudioSupportError`, `AudioBlockedError`, `SilentOutputError` map precisely to the three edge cases required by US-002-AC06 and US-002-AC07, with user-friendly messages in `getUserFriendlyError`.
- **Dependency-injectable controller**: The `controller` prop in `App` enables clean unit testing without mocking globals.
- **Good test coverage**: `App.test.tsx`, `strudel.test.ts`, and `pattern-generator.test.ts` cover all acceptance criteria paths including error states, duplicate-click prevention, and retry flow.
- **Loading state correctly blocks duplicate generates**: `status === 'loading'` guard at the top of `handleGenerate` satisfies US-002-AC05.
- **Vitest + jsdom + @testing-library/react setup is correct**: The `setup.ts` file registers `jest-dom` matchers and runs cleanup after each test.

---

## Technical Debt

- **Strudel library is not installed** (impact: critical; effort: medium): `package.json` has no Strudel dependency. The app relies on `window.__strudelRepl` being populated externally, but `index.html` loads no Strudel script and no npm package is present. The app cannot produce audio at runtime.

- **Eager `defaultEngine()` evaluation crashes the app on mount** (impact: critical; effort: low): `createStrudelController(engine = defaultEngine())` evaluates `defaultEngine()` immediately when called without an argument. In `App.tsx`, `useMemo(() => controller ?? createStrudelController(), [controller])` runs this on mount. If `window.__strudelRepl` is not set, the component throws during render — bypassing all error handling and producing a blank page.

- **ESLint and Prettier are not installed** (impact: medium; effort: low): The `lint` script is just `tsc --noEmit`. No `.eslintrc` or `.prettierrc` exists; no ESLint/Prettier packages in `package.json`.

- **React Three Fiber (R3F) is in the tech stack but absent from the codebase** (impact: medium; effort: variable): Listed in PROJECT_CONTEXT.md as a key library. Not in `package.json`, not imported anywhere. The visual/animation layer mandated by the architecture is entirely missing.

- **`src/components/` directory does not exist** (impact: low-medium; effort: low): All UI lives in `App.tsx`. No component decomposition has occurred.

- **`strudel.ts` accesses `window` directly** (impact: low; effort: low): PROJECT_CONTEXT.md designates `src/lib/` as "pure logic." `strudel.ts` references `window.__strudelRepl` and `window.webkitAudioContext`, making it side-effectful. Tests work around this via `Object.defineProperty` manipulation rather than clean injection.

- **Seek input is uncontrolled and not connected to playback position** (impact: low; effort: medium): Uses `defaultValue={0}` with no state backing. Playback position is never tracked; the seek handle will not move during playback, and seeking resets visually when the component re-renders.

- **No playback state tracking** (impact: low; effort: low): There is no `isPlaying` state. Play and Pause buttons have no active/disabled distinction based on current playback status.

- **Pattern generator is drum-only and very minimal** (impact: medium; effort: high): Only two superimposed drum patterns are generated. No melody, chords, or bass are present. The "lofi" character of the output is very limited.

- **`window.__strudelRepl` global is undocumented** (impact: low; effort: low): No comment or note explains how or when this global is expected to be set — a future contributor would not know.

---

## Violations of PROJECT_CONTEXT.md

| Convention | Expected | Actual |
|---|---|---|
| Formatting | Prettier + ESLint defaults | Neither installed; lint = tsc only |
| Tech stack | React Three Fiber (R3F) | Not installed, not used |
| Module organisation | `src/components/` for UI components | Directory does not exist; all UI in `App.tsx` |
| Module organisation | `src/lib/` for pure logic | `strudel.ts` references `window` (side effects) |
| Error handling | User-visible messages for audio failures | Covered for known error types; but mount crash from eager engine evaluation is unhandled |

> Note: PROJECT_CONTEXT.md states "adhere to this file from iteration 2 onward." The prototype (iteration 1) is explicitly exempt from strict enforcement. These violations must be addressed in the refactor before iteration 2 begins.

---

## Recommendations

| # | Description | Impact | Urgency | Effort | Scope |
|---|---|---|---|---|---|
| 1 | Integrate actual Strudel library (npm package or CDN) and wire `window.__strudelRepl` in `main.tsx` or `index.html` | Critical — app produces no audio at runtime | Blocker | Medium | `index.html`, `src/main.tsx`, `package.json` |
| 2 | Fix eager `defaultEngine()` evaluation — make engine lookup lazy (inside each controller method or via a factory) | Critical — app crashes on mount in production | Blocker | Low | `src/lib/strudel.ts` |
| 3 | Add ESLint + Prettier configuration | High — mandated by PROJECT_CONTEXT.md | High | Low | `package.json`, config files |
| 4 | Create `src/components/` and extract ParameterControls, GenerateButton/status, and Player into separate components | Medium — required by module structure; improves maintainability | High | Low-Medium | `src/App.tsx`, new component files |
| 5 | Resolve R3F: either install and add a basic visual animation layer, or explicitly defer it to a future iteration | Medium — tech stack mismatch; missing visual layer | Medium | Variable | `package.json`, new component |
| 6 | Enrich pattern generator (add melody, chords, bass) | Medium — current output is musically thin | Medium | High | `src/lib/pattern-generator.ts` |
| 7 | Fix seek control: make it controlled, track playback position, and add `isPlaying` state | Low-Medium — functional UX gap | Low | Medium | `src/App.tsx`, `src/lib/strudel.ts` |
| 8 | Separate `strudel.ts` window coupling from controller logic (extract `findEngine` or pass engine factory) | Low — cleaner pure-logic boundary | Low | Low | `src/lib/strudel.ts` |
