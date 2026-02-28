# Requirement: Full Lofi Track Generation (Drums + Melody/Bass/Chords)

## Context

The current LLM skill (`SKILL.md`) only teaches the model to generate drum-only Strudel patterns
(`bd`, `sd`, `hh`, `cp`). As a result every generated track is pure percussion with no melodic or
harmonic content. Users hear a beat but no bassline, chords, or melody — a far cry from a full
lofi track. This iteration extends the skill guide and example patterns to teach the model how to
layer melodic voices (bass, chords, lead) using native Strudel REPL capabilities, without adding
any new audio library.

## Goals

- The LLM generates multi-layer Strudel patterns that include at least one melodic or harmonic
  voice alongside the drum beat.
- All generated patterns remain within the 500-character limit and play without errors in the
  browser Strudel REPL.
- No new frontend UI changes or new audio libraries are introduced.

## User Stories

### US-001: Extend SKILL.md with melodic notation

**As an** end user, **I want** the AI to know how to write note-based and synth-based Strudel
layers **so that** the generated track includes melody, bass, or chords.

**Acceptance Criteria:**
- [ ] `SKILL.md` documents the `note()` function for pitch sequences (e.g. `note("c3 eb3 g3 bb3")`).
- [ ] `SKILL.md` documents at least two melodic/harmonic sound names available in the browser
      Strudel REPL (e.g. `superpiano` for chords/melody, `sawtooth` or `triangle` for bass).
- [ ] `SKILL.md` documents how to combine a note pattern with a sound:
      `note("c2 c2 g2 bb2").sound("sawtooth")`.
- [ ] `SKILL.md` documents how to stack melodic voices with the existing drum stack.
- [ ] `SKILL.md` maps each mood and style to recommended melodic characteristics (e.g. scale,
      note density, gain level for melodic layers).
- [ ] Typecheck / lint passes (Python tests in `backend/tests/` still pass).

### US-002: Add melodic example patterns to valid-patterns.md

**As an** end user, **I want** the few-shot examples sent to the LLM to demonstrate full-track
patterns **so that** the model produces similar multi-layer output.

**Acceptance Criteria:**
- [ ] `valid-patterns.md` is updated so that each of the three style sections (Jazz, Hip-Hop,
      Ambient) contains a pattern that includes at least one melodic or harmonic layer alongside
      the drums.
- [ ] Each example pattern plays in the browser Strudel REPL at `https://strudel.cc` without
      console errors and produces audible melodic sound (verified by ear).
- [ ] Each example pattern remains on a single line and does not exceed 500 characters.
- [ ] The `**Parameters:**` and fenced code block format required by `load_few_shot_examples()`
      is preserved — the existing parser must load all three examples without error.
- [ ] Existing Python unit tests in `backend/tests/` still pass.

### US-003: End-to-end verification of melodic generation

**As an** end user, **I want** the full generation pipeline to produce a multi-layer pattern when
I click Generate **so that** I can actually hear a lofi track with melody, not just a drum beat.

**Acceptance Criteria:**
- [ ] A manual test request to `POST /api/generate` (with any valid mood/style/tempo) returns a
      pattern string that contains at least one note-based or synth-based layer (i.e. the string
      includes `note(` or a non-percussion `sound(` / `s(` call beyond `bd`/`sd`/`hh`/`cp`).
- [ ] The returned pattern plays in the browser without JavaScript console errors.
- [ ] Melodic audio is audible in the browser alongside the drum beat — visually verified in
      browser.
- [ ] The pattern length does not exceed 500 characters (enforced by the existing
      `validate_pattern()` guard).

## Functional Requirements

- FR-1: `SKILL.md` must document the `note("...")` function for pitch sequences using scientific
  notation (e.g. `c3`, `eb3`, `g3`).
- FR-2: `SKILL.md` must document at least two melodic sound names valid in the browser Strudel
  REPL (`superpiano` for chords/melody; `sawtooth` or `triangle` for bass lines).
- FR-3: `SKILL.md` must provide at least one complete multi-layer example pattern (drums + at
  least one melodic voice) in its "Example Patterns" section.
- FR-4: `SKILL.md` must update the Mood and Style parameter mapping tables to include melodic
  guidance (recommended scale or chord voicing per mood; recommended melodic density per style).
- FR-5: `valid-patterns.md` must contain exactly three style sections (Jazz, Hip-Hop, Ambient),
  each with a `**Parameters:**` line and a fenced code block, as required by the existing
  `load_few_shot_examples()` parser (`len(examples) == 3` check must still pass).
- FR-6: Every pattern in `valid-patterns.md` must be verified to play in the browser Strudel REPL
  without console errors before being committed.
- FR-7: No changes to `main.py`, the FastAPI routes, or any frontend file are required or
  permitted in this iteration.
- FR-8: All new Strudel syntax documented in `SKILL.md` must use only functions and sound names
  natively available in the Strudel REPL (no custom samples, no external CDN assets).

## Non-Goals (Out of Scope)

- Adding new UI controls (e.g. key, scale, instrument selectors).
- Changing the backend API contract (`/api/generate` request/response shape stays the same).
- Adding audio-layer-count validation on the backend (no programmatic check that the pattern has
  a melodic layer).
- Streaming or real-time pattern updates.
- Supporting more than three styles or more than three mood values.
- Any changes to the frontend (`src/`).

## Open Questions

- Which specific Strudel synth names are confirmed to work in the hosted REPL at `strudel.cc`?
  The example patterns must be verified before committing (`superpiano`, `sawtooth`, `triangle`
  are candidates but must be confirmed).
- Should the melodic layer use a fixed key/scale per style, or should the LLM choose freely?
  (Recommendation: document a default scale per style in SKILL.md to reduce LLM variance, but
  allow the model to deviate slightly.)
