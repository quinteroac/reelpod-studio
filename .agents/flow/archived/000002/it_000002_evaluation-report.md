# Evaluation Report — Iteration 000002

## Strengths

- **Clean separation of concerns.** Pattern generation (`pattern-generator.ts`), controller abstraction (`strudel.ts`), browser adapter (`strudel-adapter.ts`), and REPL engine (`strudel-repl.ts`) each have clear, single responsibilities.
- **Dependency injection throughout.** `App` accepts an optional `controller` prop; `createStrudelController` accepts an injectable `runtime`. Both make unit testing straightforward without mocking globals.
- **Custom error classes with user-friendly messages.** `AudioSupportError`, `AudioBlockedError`, `SilentOutputError` give precise failure modes, and `getUserFriendlyError` maps them to human-readable text.
- **Comprehensive test suite.** Four test files (~382 lines) cover pattern logic, controller error paths, UI integration flows, and Tailwind theme correctness.
- **Tailwind theme well-configured.** `tailwind.config.ts` centralises the lofi palette (`lofi-bg`, `lofi-panel`, `lofi-accent`, `lofi-text`) and typography (Nunito, Merriweather).
- **Accessible UI foundations.** `sr-only` labels on all inputs, `role="alert"` on error messages, `role="status"` + `aria-live` on the loading indicator, and visible focus rings throughout.
- **Responsive grid layout.** `md:grid-cols-3` for parameter controls degrades gracefully to single-column on mobile.
- **Loading spinner and styled error/retry banner.** Both acceptance criteria US-003-AC03 and US-003-AC04 are met with styled components, not raw text.

## Technical Debt

- **Hardcoded hex values in `index.css` seek-slider rules** (`#c08457`, `#8b5e3c`, `#f5ede5`). These duplicate values already in `tailwind.config.ts`; any palette change requires manual edits in two places. _Impact: medium drift risk. Effort: low._
- **Fake seek position.** The `useEffect` interval increments `seekPosition` by 1 every 500 ms regardless of actual audio timeline. The seek slider visually moves, but the value has no relationship to real Strudel playback time. _Impact: misleading UX. Effort: medium (blocked by Strudel API limitation, but should be documented)._
- **Unhandled promise rejections in playback handlers.** `handlePlay`, `handlePause`, and `handleSeekChange` call controller methods with no `try/catch`. Any audio error during play/pause will surface as an unhandled rejection, with no user-visible feedback. _Impact: silent failure path. Effort: low._
- **REPL init errors not surfaced to the user.** `main.tsx` catches the `bootstrapStrudelRepl()` rejection with only a `console.error`. The code standard requires "user-visible error messages for audio failures". _Impact: violates error-handling standard. Effort: low._
- **`getUserFriendlyError` exposed to the component layer.** `App.tsx` imports and calls this function directly from `strudel.ts`. Error message formatting is an implementation detail that should be encapsulated inside the controller. _Impact: leaky abstraction, couples component to lib internals. Effort: low._
- **`stone-300` colour used outside the lofi palette.** Subtitle (`p.text-stone-300`) and the `Seek` label (unstyled plain text) do not use `text-lofi-text` or `text-stone-400`-equivalent palette tokens, creating minor visual inconsistency. _Impact: cosmetic. Effort: low._
- **Unstyled `<label>` for seek slider.** `<label htmlFor="seek">Seek</label>` (App.tsx line 224) has no Tailwind classes, making it visually inconsistent with the fieldset legends in the parameter controls section. _Impact: cosmetic. Effort: trivial._

## Violations of PROJECT_CONTEXT.md

- **React Three Fiber (R3F) listed in tech stack but not present.** `PROJECT_CONTEXT.md` states "React Three Fiber (R3F)" as a key library "used for visual/animation layer alongside audio playback". Neither `@react-three/fiber` nor `three` appear in `package.json`, and no visual/3D layer exists in the codebase. This is the most significant gap between the documented architecture and the actual implementation.
- **Error handling standard not fully met.** `main.tsx` REPL bootstrap errors are logged to console only. PROJECT_CONTEXT.md requires "user-visible error messages for audio failures (autoplay policy, Web Audio support, REPL errors)".
- **`src/lib/` module leaks error-formatting API to components.** PROJECT_CONTEXT.md describes `src/lib/` as containing "pure logic (pattern generation, parameter mapping)". Exporting `getUserFriendlyError` for consumption by `App.tsx` blurs this boundary.
- **`Implemented Capabilities` in PROJECT_CONTEXT.md not updated.** The section still reads "(none yet — populated after first Refactor)", which is inaccurate after this iteration's implementation work.
- **`aria-pressed` misuse on Play/Pause trigger buttons.** Play has `aria-pressed={isPlaying}` and Pause has `aria-pressed={!isPlaying}`. `aria-pressed` is intended for stateful toggle buttons; these are one-directional trigger buttons that become disabled after activation. This violates WAI-ARIA semantics and creates confusing screen-reader output.

## Recommendations

| # | Description | Impact | Urgency | Effort | Scope |
|---|-------------|--------|---------|--------|-------|
| 1 | Add try/catch to `handlePlay`, `handlePause`, `handleSeekChange` in `App.tsx` to display user-visible errors | High | High | Low | App.tsx |
| 2 | Surface REPL bootstrap errors in the UI (e.g. a full-screen error message rendered by `main.tsx` or App root error state) | High | High | Low | main.tsx / App.tsx |
| 3 | Decide fate of React Three Fiber: either add a minimal R3F visual layer (spectrum visualiser, ambient particle, etc.) or remove it from the documented tech stack | High | Medium | Medium–High | PROJECT_CONTEXT.md / new component |
| 4 | Encapsulate `getUserFriendlyError` inside the controller — `StrudelController.generate/play/pause` should throw pre-formatted error messages, removing the need for the component to import lib internals | Medium | Medium | Low | strudel.ts / App.tsx |
| 5 | Replace `aria-pressed` on Play/Pause with correct semantics (no `aria-pressed`, or consolidate into a single toggle button) | Medium | Medium | Low | App.tsx |
| 6 | Replace hardcoded hex values in seek-slider CSS with CSS custom properties sourced from the Tailwind config, eliminating colour duplication | Medium | Low | Low | index.css |
| 7 | Document the seek-position limitation (fake timeline) with a TODO comment in `strudel-repl.ts` and consider capping the seek bar at a fixed loop length rather than incrementing indefinitely | Low | Low | Low | strudel-repl.ts / App.tsx |
| 8 | Style the `Seek` label and subtitle paragraph consistently using lofi palette tokens | Low | Low | Trivial | App.tsx |
| 9 | Update `Implemented Capabilities` in `PROJECT_CONTEXT.md` after the refactor | Low | Low | Trivial | PROJECT_CONTEXT.md |
