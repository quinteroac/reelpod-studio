---
name: strudel-pattern-generator
description: Generates a valid Strudel REPL pattern string for lofi music given mood, tempo, and style parameters. Returns only the pattern string with no explanation.
disable-model-invocation: true
---

# Strudel Pattern Generator

## Purpose

This skill instructs an LLM to generate a single, valid Strudel pattern string for in-browser playback via the Strudel REPL. The LLM must return only the raw pattern string — no explanation, no markdown, no code fences, no commentary.

## Valid Strudel Mini-Notation Syntax

### Sound Names

| Name | Instrument     |
|------|----------------|
| `bd` | Bass drum      |
| `sd` | Snare drum     |
| `hh` | Hi-hat         |
| `cp` | Clap           |

### Rhythm Notation

| Notation | Meaning                                  | Example          |
|----------|------------------------------------------|------------------|
| `~`      | Rest (silence for one step)              | `"bd ~ ~ sd"`    |
| `*N`     | Repeat sound N times within the step     | `"hh*4"`         |
| `[]`     | Subdivide a step into sub-steps          | `"[bd sd] ~ ~ ~"` |

### Chaining Methods

| Method            | Description                          | Example                       |
|-------------------|--------------------------------------|-------------------------------|
| `.stack(pattern)` | Layer a second pattern on top        | `.stack(sound("hh*4"))`       |
| `.slow(N)`        | Slow down the cycle by factor N      | `.slow(2)`                    |
| `.gain(N)`        | Set volume (0.0 to 1.0)              | `.gain(0.7)`                  |
| `.cpm(N)`         | Set cycles per minute (tempo)        | `.cpm(90)`                    |

## Parameter Mappings

### Mood

| Mood value     | Pattern characteristics                                                  |
|----------------|--------------------------------------------------------------------------|
| `calm`         | Sparse kicks, minimal snare, low gain (~0.5), slower feel                |
| `melancholic`  | Medium density, off-beat snare, medium gain (~0.7)                       |
| `energetic`    | Dense hi-hats, strong kick/snare on beats, higher gain (~0.85)           |

### Tempo

Map the `tempo` value directly to `.cpm(tempo)`. Valid range: 60–120.

### Style

| Style value | Pattern characteristics                                                      |
|-------------|------------------------------------------------------------------------------|
| `jazz`      | Swing-influenced rhythms; use `[bd sd]` subdivisions; ride-cymbal feel       |
| `hip-hop`   | Boom-bap kick on beats 1 and 3, snare on 2 and 4; off-beat hi-hats          |
| `ambient`   | Minimal percussion; long cycles with `.slow(2)` or `.slow(4)`; very low gain |

## Example Patterns

### Jazz (mood: melancholic, tempo: 90)

```
sound("bd ~ [~ bd] ~").stack(sound("~ ~ sd ~")).stack(sound("hh*2")).gain(0.7).cpm(90)
```

### Hip-Hop (mood: energetic, tempo: 85)

```
sound("bd ~ bd ~").stack(sound("~ sd ~ sd")).stack(sound("hh ~ hh ~")).gain(0.8).cpm(85)
```

### Ambient (mood: calm, tempo: 70)

```
sound("bd ~ ~ ~").stack(sound("~ ~ sd ~")).stack(sound("~ hh ~ hh")).gain(0.5).slow(2).cpm(70)
```

## Output Format

Return **only** a single-line Strudel pattern string. The response must be the raw pattern and nothing else.

### Correct output

```
sound("bd ~ ~ sd").stack(sound("hh*4")).gain(0.7).cpm(90)
```

### Incorrect output (do NOT do these)

- Do NOT explain the pattern — no phrases like `Here is your lofi pattern: ...`
- Do NOT wrap in code fences — no triple backticks around the pattern
- Do NOT add newlines — the entire pattern must be on one line
- Do NOT add labels — no `pattern:` prefix
