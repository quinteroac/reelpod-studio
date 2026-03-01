# Requirement: Music Generation Mode Selector (Text Prompt Support)

## Context

Currently, ReelPod Studio generates music exclusively by building an ACEStep prompt from
structured parameters (mood, tempo, style) via `build_prompt()`. Users have no way to
describe the music they want in natural language. This iteration adds a **generation mode
selector** giving users three options: free-form text prompt only, text combined with
structured parameters, or the existing parameters-only flow. Existing parameter-only
generation must remain fully backward-compatible.

## Goals

- Allow creators to describe music in their own words via a free-form text prompt.
- Let creators combine natural language with structured parameters for richer control.
- Preserve the existing parameters-only path without any regression.
- Keep the UI change minimal and consistent with the warm lofi theme.

## User Stories

### US-001: Generation Mode Selector

**As a** creator, **I want** to choose a generation mode (Text, Text + Parameters, or
Parameters) before clicking Generate **so that** I can control whether my request is
driven by free-form description, structured controls, or both.

**Acceptance Criteria:**
- [ ] A segmented control / radio group with three labeled options is rendered inside the
  "Generation parameters" section: **"Text"**, **"Text + Params"**, **"Params"** (default).
- [ ] The selected mode is reflected in the UI immediately on click.
- [ ] The mode selector is disabled while a generation is in progress (`status === 'loading'`).
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: all three mode labels are visible and selectable.

---

### US-002: Text-Only Generation

**As a** creator, **I want** to type a free-form music description and generate audio
without touching the mood/style/tempo controls **so that** I can express exactly the sound
I have in mind.

**Acceptance Criteria:**
- [ ] When mode is "Text", a textarea / text input labeled **"Music prompt"** is shown
  above the Generate button.
- [ ] When mode is "Text", the mood, style, and tempo parameter controls are hidden.
- [ ] Clicking Generate with an empty prompt shows an inline validation error ("Please
  enter a music prompt.") and does not enqueue a request.
- [ ] Clicking Generate with a non-empty prompt enqueues a request; the backend uses the
  user's text verbatim as the ACEStep `prompt`; `bpm` defaults to 80.
- [ ] The queue entry summary displays a truncated version of the text prompt (≤ 60 chars,
  ellipsised) instead of the "Mood · Tempo · Style" summary.
- [ ] A completed generation plays back without errors.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: text input visible, parameter controls hidden, audio
  plays after generation.

---

### US-003: Text + Parameters Generation

**As a** creator, **I want** to combine a free-form prompt with mood/style/tempo
parameters **so that** I can blend descriptive intent with structured musical constraints.

**Acceptance Criteria:**
- [ ] When mode is "Text + Params", both the "Music prompt" text input and the
  mood/style/tempo controls are shown.
- [ ] Clicking Generate with an empty prompt shows an inline validation error and does not
  enqueue a request.
- [ ] Clicking Generate with a non-empty prompt sends a request where the backend
  constructs the ACEStep prompt as:
  `"{user_prompt}, {mood}, {style}, {tempo} BPM"`.
- [ ] `bpm` sent to ACEStep is the user-selected `tempo` value.
- [ ] The queue entry summary shows both the truncated prompt and the parameter values.
- [ ] A completed generation plays back without errors.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: both text input and parameter controls visible.

---

### US-004: Parameters-Only Generation (Backward-Compatible)

**As a** creator, **I want** to generate music using only the existing mood/style/tempo
controls (the current default) **so that** my existing workflow is unaffected.

**Acceptance Criteria:**
- [ ] When mode is "Params" (default on load), no text input is shown.
- [ ] Generation behaves identically to the pre-iteration behavior: prompt built as
  `"{mood} lofi {style}, {tempo} BPM"`.
- [ ] Existing tests pass without modification.
- [ ] Typecheck / lint passes.
- [ ] Visually verified in browser: parameter controls visible, text input hidden.

---

## Functional Requirements

- **FR-1:** Add `GenerationMode = 'text' | 'text+params' | 'params'` type to
  `src/App.tsx`; default state is `'params'`.
- **FR-2:** Render a mode selector (e.g., three-button toggle) inside the
  `aria-label="Generation parameters"` section.
- **FR-3:** Show the "Music prompt" text input (`<textarea>` or `<input type="text">`)
  only when mode is `'text'` or `'text+params'`.
- **FR-4:** Show the mood/tempo/style fieldsets only when mode is `'params'` or
  `'text+params'`.
- **FR-5:** Validate that the music prompt is non-empty before enqueuing in text-based
  modes; display a user-visible error message inline (not an alert dialog).
- **FR-6:** Extend `GenerationParams` (frontend) with optional `prompt?: string` and
  required `mode: GenerationMode`. Update `requestGeneratedAudio` to include both fields
  in the JSON body.
- **FR-7:** In text mode, always send `tempo: 80` (the ACEStep default) in the request
  body; the slider value is irrelevant because the slider is hidden.
- **FR-8:** Update `buildQueueSummary` to render the prompt (truncated to 60 chars) for
  text-based modes and the existing "Mood · Tempo · Style" string for params mode.
- **FR-9:** Extend `GenerateRequestBody` in `backend/main.py` with:
  - `mode: Literal['text', 'text+params', 'params'] = 'params'`
  - `prompt: Optional[StrictStr] = None` (with validator: non-empty when provided)
- **FR-10:** Update `build_prompt(body)` in `backend/main.py` to branch by mode:
  - `'params'` → `"{mood} lofi {style}, {tempo} BPM"` (unchanged)
  - `'text'` → `body.prompt` (verbatim; raise 422 if absent or empty)
  - `'text+params'` → `"{body.prompt}, {mood}, {style}, {tempo} BPM"` (raise 422 if
    prompt absent or empty)
- **FR-11:** Update `INVALID_PAYLOAD_ERROR` constant and the 422 error message in the
  backend to reflect the new optional fields.
- **FR-12:** `mood` and `style` fields in `GenerateRequestBody` become optional (with
  defaults `'chill'` and `'jazz'` respectively) so text-only requests do not require them.
  Validation (non-empty string) still applies when they are provided.

## Non-Goals (Out of Scope)

- Saving or recalling prompt history.
- Preset / template prompts ("lofi chill", "epic cinematic", etc.).
- Streaming partial audio while generation is in progress.
- Changing the ACEStep inference parameters (duration, steps) via the UI.
- Any changes to the image generation or visual pipeline.

## Open Questions

- Should "Text + Params" append the parameter string suffix always, or only when the
  user has changed the parameters from their defaults? (Assumed: always append for MVP.)
- Should the music prompt textarea have a character limit enforced in the UI? (Not
  specified — no limit for MVP; ACEStep handles long prompts gracefully.)
